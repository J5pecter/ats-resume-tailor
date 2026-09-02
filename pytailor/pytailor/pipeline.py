"""Generation plus every guard, in the order that matters.

The order is load-bearing, and is the reason this is one function rather than
four steps repeated by hand at each call site:

1. **sanitise** — before anything measures token overlap. A non-breaking hyphen
   in "drop-off" splits the token and drags a well-evidenced bullet under the
   threshold, rejecting a bullet that was perfectly fine.
2. **evidence** — drop what cannot be traced to the candidate's own words.
3. **keywords** — drop what smuggled in a declared gap. Evidence cannot catch
   this: a real bullet with real evidence can carry an extra clause the
   evidence does not support.
4. **retention** — measure what the first three, plus the model, left behind.
   Last, so it reports on the document that will actually ship.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import prompts
from .evidence import EvidenceReport, check_evidence, strip_unsupported
from .keywords import ForbiddenRemoval, find_forbidden, strip_forbidden
from .llm import call_json
from .retention import RetentionReport, check_retention
from .sanitize import sanitise_document


@dataclass
class TailorOutcome:
    resume: dict[str, Any]
    change_log: list[dict[str, Any]]
    projected_score: float
    remaining_gaps: list[str]
    evidence: EvidenceReport
    forbidden_removed: list[ForbiddenRemoval] = field(default_factory=list)
    forbidden_hits: list[str] = field(default_factory=list)
    retention: RetentionReport | None = None
    analysis: dict[str, Any] = field(default_factory=dict)
    jd_profile: dict[str, Any] = field(default_factory=dict)


Reporter = Callable[[str], None]


class _Cache:
    """Remembers completed steps so an interrupted run resumes instead of restarting.

    Without this, a retry on a metered free tier is self-defeating: each attempt
    spends the small amount of allowance that has trickled back on redoing the
    parses that already succeeded, dies at the same step, and never accumulates
    enough to reach the end. Observed exactly that — attempt one died at the
    gap analysis, attempt two died at the gap analysis, having burned the
    intervening refill on the two steps before it.

    Keyed by the content, so editing the resume or the posting correctly
    invalidates it and nothing stale is silently reused.
    """

    def __init__(self, directory: Path | None, resume_text: str, jd_text: str) -> None:
        self.dir = directory
        # A separator, so a resume ending "X" with a posting starting "Y" cannot
        # hash the same as one ending "XY" with a posting starting empty.
        joined = resume_text + chr(30) + jd_text
        digest = hashlib.sha256(joined.encode()).hexdigest()[:16]
        self.prefix = digest
        if self.dir is not None:
            self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, step: str) -> Path | None:
        return None if self.dir is None else self.dir / f"{self.prefix}.{step}.json"

    def load(self, step: str) -> dict | None:
        path = self._path(step)
        if path is None or not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def save(self, step: str, value: dict) -> None:
        path = self._path(step)
        if path is None:
            return
        try:
            path.write_text(json.dumps(value), encoding="utf-8")
        except OSError:
            # A cache that cannot be written is a lost optimisation, not a
            # failed run.
            pass


def run(
    raw_resume: str,
    raw_jd: str,
    *,
    say: Reporter = lambda msg: None,
    cache_dir: Path | None = None,
) -> TailorOutcome:
    """The whole thing: four model calls, then the guards.

    Pass `cache_dir` and completed steps survive a failure, so a retry picks up
    where it stopped rather than paying for the same parses again.
    """
    cache = _Cache(cache_dir, raw_resume, raw_jd)

    def step(name: str, label: str, build, max_tokens: int) -> dict:
        cached = cache.load(name)
        if cached is not None:
            say(f"{label} (from an earlier attempt)")
            return cached
        say(label)
        system, user = build()
        value = call_json(system, user, max_tokens=max_tokens, on_event=say)
        cache.save(name, value)
        return value

    jd = step("jd", "Reading the job posting...", lambda: prompts.jd_parser(raw_jd), 2000)
    parsed = step(
        "resume", "Reading your resume...", lambda: prompts.resume_parser(raw_resume), 3000
    )
    analysis = step(
        "analysis",
        "Scoring you against it...",
        lambda: prompts.gap_analysis(jd, parsed, raw_resume),
        2500,
    )
    result = step(
        "tailored",
        "Tailoring...",
        lambda: prompts.tailor_engine(jd, analysis, parsed, raw_resume),
        4000,
    )

    tailored = result.get("resume") or {}

    # 1. sanitise, before anything measures overlap.
    tailored = sanitise_document(tailored)
    original = sanitise_document(parsed)

    # 2. evidence.
    evidence = check_evidence(tailored, raw_resume)
    if not evidence.passed:
        say(f"Dropping {len(evidence.failures)} claim(s) that could not be traced to your resume")
        tailored = strip_unsupported(tailored, evidence.failures)

    # 3. gap keywords.
    missing = [m.get("term", "") for m in analysis.get("missing") or []]
    tailored, removed = strip_forbidden(tailored, missing, raw_resume)
    if removed:
        say(f"Dropping {len(removed)} item(s) that used a gap keyword")
    hits = find_forbidden(tailored, missing, raw_resume)

    # 4. retention, on what will actually ship.
    # The raw text as well as the parse: a role the parser lost is invisible
    # to a comparison built out of what the parser saw.
    retention = check_retention(original, tailored, raw_resume)

    return TailorOutcome(
        resume=tailored,
        change_log=result.get("changeLog") or [],
        projected_score=float(result.get("projectedAtsScore") or 0),
        remaining_gaps=result.get("remainingGaps") or [],
        evidence=evidence,
        forbidden_removed=removed,
        forbidden_hits=hits,
        retention=retention,
        analysis=analysis,
        jd_profile=jd,
    )
