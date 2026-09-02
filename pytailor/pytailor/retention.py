"""What the rewrite left behind.

Trimming for length is allowed — a page budget sometimes forces it. Trimming
*invisibly* is not: a candidate who cannot see that four of their ten bullets
vanished has no way to put them back, and reads the omission as the tool's
judgement rather than an accident.

Matching is by substance, not by text. A tailored bullet is a rewrite of an
original, so the two are linked through the evidence the rewrite cites. An
original with no descendant anywhere in the output was dropped.

Measured against the candidate's RAW TEXT as well as the parse, and the second
of those is the one that matters. Comparing only parse-to-output makes the
check blind to anything the PARSER lost, because a role it never saw cannot
appear as missing from a list built out of what it saw.

That is not hypothetical. On a real CV the parser silently dropped a
"Financial Analysis Intern" role, and this check cheerfully reported
"10 of 10 bullets kept" — the one number the candidate would have relied on to
notice. A guard that reports full retention while a job vanishes is worse than
no guard, because it is trusted.
"""

from __future__ import annotations

import re

from dataclasses import dataclass, field
from typing import Any, Literal

from .tolerant import read
from .evidence import relatedness, tokenise

# Low bar on purpose: this asks "is this the same underlying item", not "is it
# worded the same way".
SAME_ITEM_THRESHOLD = 0.30

# Loose enough to flag a document worth a second look without rejecting it.
SUBSTANTIAL_LOSS = 0.25

# Below this a line of the original is a heading, a date, or a fragment, and
# reporting it as "lost" would bury the real losses in noise.
_MIN_SOURCE_LINE = 30

# Higher than the item threshold on purpose. A rewrite keeps most of a line's
# substance even when it rewords heavily, so demanding half of it is not
# demanding a copy — and anything looser lets one surviving line vouch for
# several lost ones that merely share a verb.
SOURCE_COVERAGE_THRESHOLD = 0.5


@dataclass
class DroppedItem:
    kind: Literal["bullet", "skill", "role", "source line"]
    where: str
    text: str


@dataclass
class RetentionReport:
    dropped: list[DroppedItem] = field(default_factory=list)
    original_bullets: int = 0
    original_skills: int = 0
    # Originals that SURVIVED — not the size of the output, which is a
    # different quantity and was what an earlier version reported. Tailoring is
    # allowed to consolidate: two skills can legitimately merge into one entry
    # citing both. Counting the output read that as a loss, so a clean rewrite
    # announced "21 of 28 skills kept" while naming only four as dropped, and
    # tripped the loss warning on a document that had lost nothing.
    kept_bullets: int = 0
    kept_skills: int = 0
    substantial_loss: bool = False
    # Lines of the raw CV that reached nothing in the output. Separate from
    # `dropped` because these are measured against the candidate's own text
    # rather than against the parse, and can catch what the parse never held.
    lost_from_source: list[DroppedItem] = field(default_factory=list)

    def headline(self) -> str:
        return (
            f"{self.kept_bullets} of {self.original_bullets} bullets, "
            f"{self.kept_skills} of {self.original_skills} skills kept"
        )


def _survives(original_text: str, candidates: list[str]) -> bool:
    return any(relatedness(original_text, c) >= SAME_ITEM_THRESHOLD for c in candidates)


def _output_text(tailored: dict[str, Any]) -> list[str]:
    """Every string the finished document contains, plus the evidence behind it."""
    out: list[str] = [read(tailored, "summary")]
    contact = tailored.get("contact") or {}
    out.extend(str(v) for v in contact.values() if isinstance(v, str))
    for group in tailored.get("coreSkills") or []:
        out.append(read(group, "category"))
        for skill in group.get("skills") or []:
            out.append(read(skill, "name"))
            out.append(read(skill, "sourceEvidence"))
    for role in tailored.get("experience") or []:
        # Dates included: a CV line often welds the date range to the job title
        # ("Mar 2024 - PresentAssistant Product Manager"), and without them
        # that line looks half-lost even when the role plainly survived.
        out.extend([
            read(role, "company"), read(role, "role"), read(role, "context"),
            read(role, "startDate"), read(role, "endDate"),
        ])
        for bullet in role.get("bullets") or []:
            out.append(read(bullet, "text"))
            out.append(read(bullet, "sourceEvidence"))
    for section in ("education", "certifications", "projects", "additional"):
        for row in tailored.get(section) or []:
            out.extend(str(v) for v in row.values() if isinstance(v, str))
    return [x for x in out if x]


# PDF text extraction routinely welds a date to the title that follows it:
# "Mar 2024 - PresentAssistant Product Manager". The welded token matches
# nothing, so the line looks half-lost even when the role plainly survived.
# A lowercase letter immediately followed by an uppercase one is a reliable
# seam, and splitting it costs nothing on text that never had the problem.
_WELD = re.compile(r"(?<=[a-z])(?=[A-Z])")


def _unweld(text: str) -> str:
    return _WELD.sub(" ", text)


def _covered(source_line: str, candidate: str) -> float:
    """How much of the SOURCE LINE survives in the candidate. Directional.

    Not `relatedness`, which divides by the shorter side. That is correct when
    comparing a claim with its evidence, because either can legitimately be the
    shorter. Here it is badly wrong: the two-token skill entry "Power BI"
    scored a perfect 1.00 against "Designed Power BI dashboards for real-time
    market and trading insights", so a whole lost bullet looked accounted for
    by a skill chip. What matters is whether the candidate's line survived, so
    the line's own tokens are the denominator.
    """
    line_tokens = set(tokenise(_unweld(source_line)))
    if not line_tokens:
        return 1.0
    return len(line_tokens & set(tokenise(candidate))) / len(line_tokens)


def _lost_source_lines(raw_source_text: str, tailored: dict[str, Any]) -> list[DroppedItem]:
    """Lines of the candidate's own CV with no descendant in the output.

    Deliberately end-to-end: it does not care whether the parser or the tailor
    lost something, only that the candidate wrote it and it is not there.
    """
    surviving = _output_text(tailored)
    lost: list[DroppedItem] = []

    for line in raw_source_text.splitlines():
        cleaned = line.strip()
        if len(cleaned) < _MIN_SOURCE_LINE:
            continue
        # An ALL-CAPS line is a section heading, not content.
        letters = [c for c in cleaned if c.isalpha()]
        if letters and all(c.isupper() for c in letters):
            continue
        if not any(_covered(cleaned, candidate) >= SOURCE_COVERAGE_THRESHOLD for candidate in surviving):
            lost.append(DroppedItem("source line", "Your original resume", cleaned))

    return lost


def check_retention(
    original: dict[str, Any],
    tailored: dict[str, Any],
    raw_source_text: str | None = None,
) -> RetentionReport:
    report = RetentionReport()

    # Everything a bullet could have become: its own text, and the evidence it
    # cites, which quotes the original it came from.
    bullet_traces: list[str] = []
    for role in tailored.get("experience") or []:
        for bullet in role.get("bullets") or []:
            bullet_traces.append(read(bullet, "text"))
            bullet_traces.append(read(bullet, "sourceEvidence"))

    tailored_companies = {
        (read(role, "company")).strip().lower() for role in tailored.get("experience") or []
    }

    for role in original.get("experience") or []:
        company = (read(role, "company")).strip().lower()
        role_kept = company in tailored_companies
        if not role_kept:
            report.dropped.append(
                DroppedItem(
                    "role",
                    read(role, "company"),
                    " at ".join(x for x in (role.get("role"), role.get("company")) if x),
                )
            )
        where = " — ".join(x for x in (role.get("company"), role.get("role")) if x)
        for bullet in role.get("bullets") or []:
            report.original_bullets += 1
            text = read(bullet, "text")
            if not role_kept or not _survives(text, bullet_traces):
                report.dropped.append(DroppedItem("bullet", where, text))

    skill_traces: list[str] = []
    tailored_names: set[str] = set()
    for group in tailored.get("coreSkills") or []:
        for skill in group.get("skills") or []:
            skill_traces.append(read(skill, "name"))
            skill_traces.append(read(skill, "sourceEvidence"))
            tailored_names.add((read(skill, "name")).strip().lower())

    for group in original.get("coreSkills") or []:
        for skill in group.get("skills") or []:
            report.original_skills += 1
            name = read(skill, "name")
            # Survives by name, or by having been relabelled into the posting's
            # vocabulary with the same work behind it.
            if name.strip().lower() in tailored_names:
                continue
            if not _survives(name, skill_traces):
                report.dropped.append(DroppedItem("skill", read(group, "category"), name))

    # Derived from `dropped` rather than measured separately, so the headline
    # figure and the list beneath it are the same measurement and cannot
    # contradict each other.
    dropped_bullets = sum(1 for d in report.dropped if d.kind == "bullet")
    dropped_skills = sum(1 for d in report.dropped if d.kind == "skill")
    report.kept_bullets = report.original_bullets - dropped_bullets
    report.kept_skills = report.original_skills - dropped_skills

    bullet_loss = dropped_bullets / report.original_bullets if report.original_bullets else 0.0
    skill_loss = dropped_skills / report.original_skills if report.original_skills else 0.0
    report.substantial_loss = bullet_loss > SUBSTANTIAL_LOSS or skill_loss > SUBSTANTIAL_LOSS

    # Appended last, and counted separately: these are lines the candidate
    # wrote that reached nothing in the output, whichever stage lost them. The
    # kept/original figures above describe the parse, so folding these into
    # them would make that headline mean two things at once.
    if raw_source_text:
        report.lost_from_source = _lost_source_lines(raw_source_text, tailored)
        if report.lost_from_source:
            report.substantial_loss = True

    return report
