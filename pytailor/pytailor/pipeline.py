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

from dataclasses import dataclass, field
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


def run(
    raw_resume: str,
    raw_jd: str,
    *,
    say: Reporter = lambda msg: None,
) -> TailorOutcome:
    """The whole thing: four model calls, then the guards."""
    say("Reading the job posting...")
    system, user = prompts.jd_parser(raw_jd)
    jd = call_json(system, user, max_tokens=2000, on_event=say)

    say("Reading your resume...")
    system, user = prompts.resume_parser(raw_resume)
    parsed = call_json(system, user, max_tokens=3000, on_event=say)

    say("Scoring you against it...")
    system, user = prompts.gap_analysis(jd, parsed, raw_resume)
    analysis = call_json(system, user, max_tokens=2500, on_event=say)

    say("Tailoring...")
    system, user = prompts.tailor_engine(jd, analysis, parsed, raw_resume)
    result = call_json(system, user, max_tokens=4000, on_event=say)

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
