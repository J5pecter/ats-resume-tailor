"""What the rewrite left behind.

Trimming for length is allowed — a page budget sometimes forces it. Trimming
*invisibly* is not: a candidate who cannot see that four of their ten bullets
vanished has no way to put them back, and reads the omission as the tool's
judgement rather than an accident.

Matching is by substance, not by text. A tailored bullet is a rewrite of an
original, so the two are linked through the evidence the rewrite cites. An
original with no descendant anywhere in the output was dropped.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .evidence import relatedness

# Low bar on purpose: this asks "is this the same underlying item", not "is it
# worded the same way".
SAME_ITEM_THRESHOLD = 0.30

# Loose enough to flag a document worth a second look without rejecting it.
SUBSTANTIAL_LOSS = 0.25


@dataclass
class DroppedItem:
    kind: Literal["bullet", "skill", "role"]
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

    def headline(self) -> str:
        return (
            f"{self.kept_bullets} of {self.original_bullets} bullets, "
            f"{self.kept_skills} of {self.original_skills} skills kept"
        )


def _survives(original_text: str, candidates: list[str]) -> bool:
    return any(relatedness(original_text, c) >= SAME_ITEM_THRESHOLD for c in candidates)


def check_retention(original: dict[str, Any], tailored: dict[str, Any]) -> RetentionReport:
    report = RetentionReport()

    # Everything a bullet could have become: its own text, and the evidence it
    # cites, which quotes the original it came from.
    bullet_traces: list[str] = []
    for role in tailored.get("experience") or []:
        for bullet in role.get("bullets") or []:
            bullet_traces.append(bullet.get("text", ""))
            bullet_traces.append(bullet.get("sourceEvidence") or "")

    tailored_companies = {
        (role.get("company") or "").strip().lower() for role in tailored.get("experience") or []
    }

    for role in original.get("experience") or []:
        company = (role.get("company") or "").strip().lower()
        role_kept = company in tailored_companies
        if not role_kept:
            report.dropped.append(
                DroppedItem(
                    "role",
                    role.get("company", ""),
                    " at ".join(x for x in (role.get("role"), role.get("company")) if x),
                )
            )
        where = " — ".join(x for x in (role.get("company"), role.get("role")) if x)
        for bullet in role.get("bullets") or []:
            report.original_bullets += 1
            text = bullet.get("text", "")
            if not role_kept or not _survives(text, bullet_traces):
                report.dropped.append(DroppedItem("bullet", where, text))

    skill_traces: list[str] = []
    tailored_names: set[str] = set()
    for group in tailored.get("coreSkills") or []:
        for skill in group.get("skills") or []:
            skill_traces.append(skill.get("name", ""))
            skill_traces.append(skill.get("sourceEvidence") or "")
            tailored_names.add((skill.get("name") or "").strip().lower())

    for group in original.get("coreSkills") or []:
        for skill in group.get("skills") or []:
            report.original_skills += 1
            name = skill.get("name", "")
            # Survives by name, or by having been relabelled into the posting's
            # vocabulary with the same work behind it.
            if name.strip().lower() in tailored_names:
                continue
            if not _survives(name, skill_traces):
                report.dropped.append(DroppedItem("skill", group.get("category", ""), name))

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

    return report
