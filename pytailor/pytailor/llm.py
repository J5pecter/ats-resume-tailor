"""Talking to a model, over stdlib only.

Deliberately no `openai` or `requests` dependency. This has to install and run
inside a GitHub Actions job with as little between the user and a working tool
as possible, and every dependency is a thing that can fail to resolve on
somebody's Python version.

Any OpenAI-compatible endpoint works — Groq, OpenRouter, a local Ollama —
because they all speak the same `/chat/completions`.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "openai/gpt-oss-120b"
DEFAULT_TPM = 8000
TIMEOUT_SECONDS = 90
USER_AGENT = "pytailor/1.0 (+https://github.com/J5pecter/ats-resume-tailor)"


class LlmError(RuntimeError):
    pass


class LlmConfigError(LlmError):
    pass


class LlmRateLimited(LlmError):
    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message)
        self.retry_after = retry_after


@dataclass
class Endpoint:
    name: str
    base_url: str
    api_key: str
    model: str
    tpm: int

    @property
    def is_local(self) -> bool:
        return bool(re.match(r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|/|$)", self.base_url, re.I))


def resolve_chain() -> list[Endpoint]:
    """Primary, then any spares named in LLM_FALLBACKS.

    A free tier is not a promise anyone made you — keys get revoked, limits get
    tightened, hosts go down. A spare costs two environment variables and turns
    an outage into a slower run.
    """
    primary = Endpoint(
        name="primary",
        base_url=(os.environ.get("OPENAI_COMPATIBLE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
        api_key=(os.environ.get("OPENAI_COMPATIBLE_API_KEY") or "").strip(),
        model=(os.environ.get("OPENAI_COMPATIBLE_MODEL") or DEFAULT_MODEL).strip(),
        tpm=_positive_int(os.environ.get("OPENAI_COMPATIBLE_TPM"), DEFAULT_TPM),
    )
    chain = [primary]

    for slot in (os.environ.get("LLM_FALLBACKS") or "").split(","):
        slot = slot.strip()
        if not slot:
            continue
        prefix = "LLM_" + re.sub(r"[^A-Z0-9]+", "_", slot.upper()) + "_"
        chain.append(
            Endpoint(
                name=slot,
                base_url=(os.environ.get(prefix + "BASE_URL") or primary.base_url).rstrip("/"),
                # Falls back to the shared key: pointing a spare at a different
                # model on the same provider should not need the key pasted twice.
                api_key=(os.environ.get(prefix + "API_KEY") or primary.api_key).strip(),
                model=(os.environ.get(prefix + "MODEL") or DEFAULT_MODEL).strip(),
                tpm=_positive_int(os.environ.get(prefix + "TPM"), DEFAULT_TPM),
            )
        )

    usable = [e for e in chain if e.api_key or e.is_local]
    if not usable:
        raise LlmConfigError(
            "No API key. Set OPENAI_COMPATIBLE_API_KEY — a free one from "
            "https://console.groq.com/keys works — or point "
            "OPENAI_COMPATIBLE_BASE_URL at a local Ollama, which needs none."
        )
    return usable


def _positive_int(raw: str | None, fallback: int) -> int:
    try:
        value = int(raw or "")
        return value if value > 0 else fallback
    except ValueError:
        return fallback


def _estimate_tokens(text: str) -> int:
    """Rough and deliberately pessimistic: English JSON runs ~3.6 chars/token."""
    return len(text) // 3 + 1


def _call_once(endpoint: Endpoint, system: str, user: str, max_tokens: int) -> str:
    # Metered tiers bill prompt + reserved completion whether the reservation
    # is used or not, so asking for a comfortable 8k on an 8k/min tier fails
    # with a 413 before a single token is generated.
    if not endpoint.is_local:
        headroom = endpoint.tpm - _estimate_tokens(system) - _estimate_tokens(user) - 200
        if headroom < 800:
            raise LlmError(
                f"This request needs more than {endpoint.name}'s {endpoint.tpm:,} tokens/minute "
                "allows. Shorten the resume or the job description."
            )
        max_tokens = min(max_tokens, headroom)

    payload = {
        "model": endpoint.model,
        "temperature": 0.2,
        "max_completion_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }

    request = urllib.request.Request(
        f"{endpoint.base_url}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "content-type": "application/json",
            # urllib sends no User-Agent by default, and providers behind
            # Cloudflare reject that outright with a 403 (error 1010). This
            # identifies the client honestly rather than imitating a browser.
            "user-agent": USER_AGENT,
            "accept": "application/json",
            **({"authorization": f"Bearer {endpoint.api_key}"} if endpoint.api_key else {}),
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode())
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:300]
        if err.code == 429:
            wait = 20
            match = re.search(r"try again in ([\d.]+)s", detail, re.I)
            if match:
                wait = int(float(match.group(1))) + 1
            raise LlmRateLimited(f"{endpoint.name} is rate limited.", wait) from err
        raise LlmError(f"{endpoint.name} returned {err.code}. {detail}") from err
    except urllib.error.URLError as err:
        raise LlmError(f"{endpoint.name} unreachable: {err.reason}") from err

    choice = (body.get("choices") or [{}])[0]
    if choice.get("finish_reason") == "length":
        raise LlmError(
            f"The reply was cut off at {max_tokens:,} tokens. The resume is likely too long "
            f"for {endpoint.name}'s tier."
        )
    return (choice.get("message") or {}).get("content") or ""


def call_json(
    system: str,
    user: str,
    *,
    max_tokens: int = 3000,
    on_event=lambda msg: None,
) -> dict:
    """One structured call, across the chain, with the JSON parsed.

    Any failure moves to the next endpoint. Deliberately any: every remaining
    free-tier failure mode is endpoint-specific — a revoked key, a suspended
    account, that provider's per-minute budget, an outage at that host — and
    none of them says anything about the request. Guessing wrong costs one
    wasted call; being clever costs the run.
    """
    chain = resolve_chain()
    failures: list[str] = []

    for index, endpoint in enumerate(chain):
        try:
            try:
                raw = _call_once(endpoint, system, user, max_tokens)
            except LlmRateLimited as limited:
                if limited.retry_after <= 45:
                    on_event(f"rate limited, waiting {limited.retry_after}s")
                    time.sleep(limited.retry_after)
                    raw = _call_once(endpoint, system, user, max_tokens)
                else:
                    raise

            if index > 0:
                on_event(f"served by fallback {endpoint.name} ({endpoint.model})")
            return _parse_json(raw)

        except LlmError as err:
            failures.append(f"{endpoint.name}: {err}")
            if index < len(chain) - 1:
                on_event(f"{endpoint.name} failed ({err}); trying the next endpoint")

    # A chain of one rethrows plainly, so nothing changed for a setup with no
    # spares configured.
    if len(failures) == 1:
        raise LlmError(failures[0])
    raise LlmError("Every endpoint failed. " + "; ".join(failures))


_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.I)


def _parse_json(raw: str) -> dict:
    """Parse, tolerating the fences a model adds despite being told not to."""
    text = _FENCE.sub("", raw).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Last resort: the outermost object, for a model that prefixed prose.
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise LlmError("The model did not return JSON.") from None
        return json.loads(text[start : end + 1])
