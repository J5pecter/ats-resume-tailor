"""The anti-fabrication check. The reason this tool is worth using.

Every generated bullet and every skill must carry `sourceEvidence`: the
fragment of the original resume it came from. This verifies that link after the
model returns, on two independent axes.

**Traceability** — at least 70% of the evidence's tokens appear in the source.
Proves the quote is real rather than invented.

**Relatedness** — at least 30% overlap between the evidence and the claim it is
attached to, measured against the shorter of the two. Proves the quote is
*about* that claim.

Both are needed, and that is not a theoretical concern. A weak model once
passed traceability on every bullet by citing "Arihant Securities - Senior
Product Manager" — a real line, present verbatim in the resume — as the
evidence for all of them, and then copied a bullet onto the wrong employer.
Traceability alone would have shipped it. Only relatedness caught it.

Measuring relatedness against the *shorter* side matters too: a long bullet
citing a short quote, and a short bullet citing a long one, are both legitimate,
and dividing by the longer side would punish one of them arbitrarily.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .tolerant import read
from typing import Any, Literal

TRACEABILITY_THRESHOLD = 0.70
RELATEDNESS_THRESHOLD = 0.30

_WORD = re.compile(r"[a-z0-9]+")

# Words carried by every sentence in every resume. Left in, they inflate every
# comparison towards a match; the thresholds are calibrated with them removed.
_STOPWORDS = frozenset(
    """a an and are as at be by for from has have in into is it its of on or that the
    to was were will with within across over under this these those their our your""".split()
)


def tokenise(text: str) -> list[str]:
    """Lowercase alphanumeric words, stopwords dropped."""
    return [w for w in _WORD.findall(text.lower()) if w not in _STOPWORDS]


def token_overlap(evidence: str, source_tokens: set[str]) -> float:
    """Share of the evidence's tokens that appear in the source. Traceability."""
    tokens = tokenise(evidence)
    if not tokens:
        return 0.0
    return sum(1 for t in tokens if t in source_tokens) / len(tokens)


def relatedness(claim: str, evidence: str) -> float:
    """Overlap between a claim and its evidence, over the shorter side."""
    claim_tokens = set(tokenise(claim))
    evidence_tokens = set(tokenise(evidence))
    smaller = min(len(claim_tokens), len(evidence_tokens))
    if smaller == 0:
        return 0.0
    return len(claim_tokens & evidence_tokens) / smaller


Reason = Literal["empty", "unsupported", "unrelated"]


@dataclass
class EvidenceFailure:
    kind: Literal["bullet", "skill"]
    where: str
    text: str
    source_evidence: str
    overlap: float
    reason: Reason

    def describe(self) -> str:
        return f"{self.reason}: {self.where} — {self.text[:70]}"


@dataclass
class EvidenceReport:
    failures: list[EvidenceFailure] = field(default_factory=list)
    checked_bullets: int = 0
    checked_skills: int = 0

    @property
    def checked(self) -> int:
        return self.checked_bullets + self.checked_skills

    @property
    def passed(self) -> bool:
        return not self.failures


def _name_in_source(name: str, source_text: str) -> bool:
    """Whole-word, case-insensitive. Stops "R" matching "Reduced"."""
    cleaned = name.strip()
    if len(cleaned) < 2:
        return False
    pattern = rf"(^|[^A-Za-z0-9]){re.escape(cleaned)}([^A-Za-z0-9]|$)"
    return re.search(pattern, source_text, re.IGNORECASE) is not None


def check_evidence(doc: dict[str, Any], raw_source_text: str) -> EvidenceReport:
    """Verify every claim in the document against the candidate's own words.

    Traced against the RAW source rather than the parsed one. The parse is
    lossy — it has been observed dropping a qualification filed under an
    unexpected heading — and evidence measured against a lossy copy rejects
    claims the candidate can actually support.
    """
    source_tokens = set(tokenise(raw_source_text))
    report = EvidenceReport()

    for role in doc.get("experience") or []:
        where = " — ".join(x for x in (role.get("company"), role.get("role")) if x)
        for bullet in role.get("bullets") or []:
            report.checked_bullets += 1
            text = read(bullet, "text")
            evidence = read(bullet, "sourceEvidence").strip()

            if not evidence:
                report.failures.append(
                    EvidenceFailure("bullet", where, text, "", 0.0, "empty")
                )
                continue

            traced = token_overlap(evidence, source_tokens)
            if traced < TRACEABILITY_THRESHOLD:
                report.failures.append(
                    EvidenceFailure("bullet", where, text, evidence, traced, "unsupported")
                )
                continue

            related = relatedness(text, evidence)
            if related < RELATEDNESS_THRESHOLD:
                report.failures.append(
                    EvidenceFailure("bullet", where, text, evidence, related, "unrelated")
                )

    for group in doc.get("coreSkills") or []:
        where = f"Core skills · {group.get('category', '')}"
        for skill in group.get("skills") or []:
            report.checked_skills += 1
            name = read(skill, "name")
            evidence = read(skill, "sourceEvidence").strip()

            # A skill passes by either route. Relabelling a real skill into the
            # posting's vocabulary is explicitly allowed, so a name-only check
            # would reject that legitimate rewrite; and a skill named verbatim
            # in the resume needs no further proof.
            if _name_in_source(name, raw_source_text):
                continue

            if not evidence:
                report.failures.append(
                    EvidenceFailure("skill", where, name, "", 0.0, "empty")
                )
                continue

            traced = token_overlap(evidence, source_tokens)
            if traced < TRACEABILITY_THRESHOLD:
                report.failures.append(
                    EvidenceFailure("skill", where, name, evidence, traced, "unsupported")
                )

    return report


def strip_unsupported(doc: dict[str, Any], failures: list[EvidenceFailure]) -> dict[str, Any]:
    """Remove every claim that failed, leaving a document safe to ship.

    A role emptied of bullets goes with them: a company heading with nothing
    under it reads as an omission the candidate made, not one the tool made.
    """
    bad_bullets = {f.text for f in failures if f.kind == "bullet"}
    bad_skills = {f.text for f in failures if f.kind == "skill"}

    out = dict(doc)

    experience = []
    for role in doc.get("experience") or []:
        kept = [b for b in role.get("bullets") or [] if b.get("text") not in bad_bullets]
        if kept:
            experience.append({**role, "bullets": kept})
    out["experience"] = experience

    groups = []
    for group in doc.get("coreSkills") or []:
        kept = [s for s in group.get("skills") or [] if s.get("name") not in bad_skills]
        if kept:
            groups.append({**group, "skills": kept})
    out["coreSkills"] = groups

    return out
