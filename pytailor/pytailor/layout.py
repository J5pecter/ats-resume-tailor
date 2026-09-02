"""The shared document model.

Neither exporter reads the resume directly. Both walk this block list, so a
change to section order, heading text or date formatting lands in both formats
at once and they cannot diverge. Built independently, a DOCX and a PDF drift
apart within a week and nobody notices until an employer sees one of them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

BlockKind = Literal[
    "name", "headline", "contact", "section", "paragraph",
    "skills", "role_header", "role_meta", "bullet", "labelled",
]


@dataclass
class Block:
    kind: BlockKind
    text: str = ""
    left: str = ""
    right: str = ""
    label: str = ""


# Standard ATS section headings only. A parser looks for these exact words.
HEADINGS = {
    "summary": "PROFESSIONAL SUMMARY",
    "skills": "CORE SKILLS",
    "experience": "PROFESSIONAL EXPERIENCE",
    "projects": "PROJECTS",
    "education": "EDUCATION",
    "certifications": "CERTIFICATIONS",
    "additional": "ADDITIONAL INFORMATION",
}

# Points. Arial (DOCX) and Helvetica (PDF) are metrically equivalent, which is
# what keeps the two documents looking the same without shipping a font binary.
TYPE = {
    "name": 17.0,
    "headline": 10.5,
    "contact": 9.5,
    "section": 11.0,
    "body": 10.0,
    "meta": 9.5,
}

SPACE = {
    # Not cosmetic. Below roughly 3pt, PDF text extraction merges the name into
    # the headline and an ATS reads "VYASInternal Auditor", losing the surname.
    "after_name": 3.5,
    "after_headline": 3.5,
    "after_contact": 10.0,
    "before_section": 10.5,
    "after_section": 5.0,
    "between_paragraphs": 4.0,
    "between_skill_lines": 3.0,
    "before_role": 7.5,
    "after_role_header": 1.5,
    "after_role_meta": 2.0,
    "between_bullets": 3.0,
}

LINE_HEIGHT = 1.3
MARGIN_INCHES = 0.65
_CHARS_PER_LINE = 100
_LINES_PER_PAGE = 40
# A last page under half full reads as unfinished and is worth crowding the
# rest to reclaim.
_ORPHAN_MARGIN = 0.5


def _wrapped(text: str, width: int = _CHARS_PER_LINE) -> int:
    return max(1, -(-len(text) // width))


def estimate_lines(blocks: list[Block]) -> int:
    total = 0
    for block in blocks:
        if block.kind == "paragraph":
            total += _wrapped(block.text)
        elif block.kind == "bullet":
            total += _wrapped(block.text, _CHARS_PER_LINE - 4)
        elif block.kind == "skills":
            total += _wrapped(f"{block.label}: {block.text}")
        elif block.kind == "labelled":
            total += _wrapped(f"{block.label}: {block.text}")
        else:
            total += 1
    return total


def density_scale(blocks: list[Block]) -> float:
    """How tightly to set this particular document.

    A fixed scale cannot serve both a one-year CV and a fifteen-year one. The
    rule is only about page boundaries: compress when the content sits just
    past one, because those last few lines are worth crowding to avoid an
    almost-empty extra sheet. Everywhere else stay comfortable — tightening a
    document that already fits buys nothing and costs legibility.
    """
    estimated = estimate_lines(blocks)
    overflow = estimated / _LINES_PER_PAGE
    past = overflow - int(overflow)
    if overflow <= 1 or past == 0 or past > _ORPHAN_MARGIN:
        return 1.0
    # Measured rather than guessed: swept against a real one-page-plus-six-lines
    # resume, 0.7 was the loosest setting that reclaimed the page and 0.75 was
    # not enough. Sitting just inside leaves margin for other shapes.
    return 0.68


def spacing_for(blocks: list[Block]) -> dict[str, float]:
    scale = density_scale(blocks)
    out = {}
    for key, value in SPACE.items():
        scaled = value * scale
        # Never below the floor that keeps the name out of the headline.
        out[key] = max(3.0, scaled) if key in ("after_name", "after_headline") else scaled
    return out


def line_height_for(blocks: list[Block]) -> float:
    return max(1.15, LINE_HEIGHT * (0.85 + 0.15 * density_scale(blocks)))


def format_date_range(start: str, end: str) -> str:
    start, end = (start or "").strip(), (end or "").strip()
    if not start and not end:
        return ""
    if not start:
        return end
    if not end:
        return start
    return f"{start} – {end}"


def build_blocks(doc: dict[str, Any]) -> list[Block]:
    blocks: list[Block] = []
    contact = doc.get("contact") or {}

    # The contact block sits in the body, never a header or footer: ATS parsers
    # frequently skip those entirely.
    blocks.append(Block("name", text=contact.get("fullName", "")))
    if (contact.get("headline") or "").strip():
        blocks.append(Block("headline", text=contact["headline"].strip()))

    line = "  |  ".join(
        x.strip()
        for x in (
            contact.get("location"),
            contact.get("phone"),
            contact.get("email"),
            contact.get("linkedin"),
            contact.get("portfolio"),
        )
        if x and x.strip()
    )
    if line:
        blocks.append(Block("contact", text=line))

    if (doc.get("summary") or "").strip():
        blocks.append(Block("section", text=HEADINGS["summary"]))
        blocks.append(Block("paragraph", text=doc["summary"].strip()))

    if doc.get("coreSkills"):
        blocks.append(Block("section", text=HEADINGS["skills"]))
        for group in doc["coreSkills"]:
            names = ", ".join(s.get("name", "").strip() for s in group.get("skills") or [] if s.get("name"))
            if names:
                blocks.append(Block("skills", label=group.get("category", ""), text=names))

    if doc.get("experience"):
        blocks.append(Block("section", text=HEADINGS["experience"]))
        for role in doc["experience"]:
            blocks.append(
                Block(
                    "role_header",
                    left=" — ".join(x for x in (role.get("company"), role.get("role")) if x),
                    right=format_date_range(role.get("startDate", ""), role.get("endDate", "")),
                )
            )
            meta = "  |  ".join(x.strip() for x in (role.get("location"), role.get("context")) if x and x.strip())
            if meta:
                blocks.append(Block("role_meta", text=meta))
            for bullet in role.get("bullets") or []:
                if (bullet.get("text") or "").strip():
                    blocks.append(Block("bullet", text=bullet["text"].strip()))

    if doc.get("projects"):
        blocks.append(Block("section", text=HEADINGS["projects"]))
        for project in doc["projects"]:
            blocks.append(Block("role_header", left=project.get("name", ""), right=(project.get("link") or "").strip()))
            stack = ", ".join(project.get("stack") or [])
            detail = " ".join(x for x in (project.get("description", ""), f"Stack: {stack}" if stack else "") if x).strip()
            if detail:
                blocks.append(Block("bullet", text=detail))

    if doc.get("education"):
        blocks.append(Block("section", text=HEADINGS["education"]))
        for edu in doc["education"]:
            # Institution on the bold line: it is the anchor a human scans for
            # and the token an ATS matches, so it should not be demoted.
            blocks.append(Block("role_header", left=edu.get("institution", ""), right=edu.get("endDate", "")))
            detail = "  |  ".join(
                x for x in (
                    ", ".join(y for y in (edu.get("degree"), edu.get("field")) if y),
                    edu.get("score"),
                ) if x
            )
            if detail:
                blocks.append(Block("role_meta", text=detail))

    if doc.get("certifications"):
        blocks.append(Block("section", text=HEADINGS["certifications"]))
        # Run together rather than one bullet each: an ATS reads the delimited
        # list just as well, a reader scans it faster, and one line each pushes
        # a short resume onto a second page for no benefit.
        certs = []
        for cert in doc["certifications"]:
            detail = ", ".join(x for x in (cert.get("issuer"), cert.get("date")) if x)
            certs.append(f"{cert.get('name', '')} ({detail})" if detail else cert.get("name", ""))
        if certs:
            blocks.append(Block("paragraph", text="  •  ".join(c for c in certs if c)))

    if doc.get("additional"):
        blocks.append(Block("section", text=HEADINGS["additional"]))
        for item in doc["additional"]:
            if (item.get("value") or "").strip():
                blocks.append(Block("labelled", label=item.get("label", ""), text=item["value"].strip()))

    return blocks
