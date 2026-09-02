"""The shared document model.

Neither exporter reads the resume directly. Both walk this block list, so a
change to section order, heading text or date formatting lands in both formats
at once and they cannot diverge. Built independently, a DOCX and a PDF drift
apart within a week and nobody notices until an employer sees one of them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from .tolerant import read

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

# LETTER, in points.
#
# The estimator works in POINTS, not "lines". A line is not a fixed height in
# this document — a section heading is 11pt, a contact line 9.5pt — and the
# spacers between blocks add vertical room that no line count can see at all.
# Counting lines under-measured a real CV by 18% (estimated 50, rendered 59)
# while assuming a page holds 40 lines when it actually holds 57. Both errors
# pointed the same way, and the result was a two-page PDF whose second page
# carried two lines: precisely the orphan this rule exists to prevent.
_PAGE_WIDTH_PT = 8.5 * 72
_PAGE_HEIGHT_PT = 11.0 * 72
USABLE_WIDTH_PT = _PAGE_WIDTH_PT - 2 * MARGIN_INCHES * 72
USABLE_HEIGHT_PT = _PAGE_HEIGHT_PT - 2 * MARGIN_INCHES * 72

# Helvetica's average advance over mixed-case prose is close to half the point
# size. Calibrated against rendered output, not assumed.
_AVG_CHAR_WIDTH_RATIO = 0.5

# Bullets are indented by this much in both writers, so they wrap earlier.
_BULLET_INDENT_PT = 12.0

# Tried in order; the first that reclaims a page wins. Below 0.68 the document
# stops being comfortable to read, and one more line is not worth that.
_DENSITY_STEPS = (0.85, 0.75, 0.68)

# What each block is actually set in. Kept beside the writers' own choices;
# if those change, this must too, which is why both read TYPE.
_BLOCK_FONT = {
    "name": TYPE["name"],
    "headline": TYPE["headline"],
    "contact": TYPE["contact"],
    "section": TYPE["section"],
    "role_meta": TYPE["meta"],
}

# The spacer that follows each block. `section` and `role_header` carry a
# leading spacer too and are handled separately, so they are absent here to
# keep them from being counted twice.
_BLOCK_AFTER = {
    "name": "after_name",
    "headline": "after_headline",
    "contact": "after_contact",
    "paragraph": "between_paragraphs",
    "skills": "between_skill_lines",
    "role_meta": "after_role_meta",
    "bullet": "between_bullets",
    "labelled": "between_bullets",
}


def _line_height_at(scale: float) -> float:
    return max(1.15, LINE_HEIGHT * (0.85 + 0.15 * scale))


def _spacing_at(scale: float) -> dict[str, float]:
    out = {}
    for key, value in SPACE.items():
        scaled = value * scale
        # Never below the floor that keeps the name out of the headline.
        out[key] = max(3.0, scaled) if key in ("after_name", "after_headline") else scaled
    return out


def _block_text(block: Block) -> str:
    """What the block actually renders as one run of text, for wrapping."""
    if block.kind in ("skills", "labelled"):
        return f"{block.label}: {block.text}"
    if block.kind == "role_header":
        return f"{block.left}  {block.right}"
    return block.text


def _wrapped(text: str, font_pt: float, width_pt: float) -> int:
    if not text:
        return 1
    per_line = max(1, int(width_pt / (font_pt * _AVG_CHAR_WIDTH_RATIO)))
    return max(1, -(-len(text) // per_line))


def estimate_height_pt(blocks: list[Block], scale: float = 1.0) -> float:
    """Rendered height of the document in points, at a given density."""
    leading = _line_height_at(scale)
    space = _spacing_at(scale)
    total = 0.0
    for block in blocks:
        font = _BLOCK_FONT.get(block.kind, TYPE["body"])
        width = USABLE_WIDTH_PT - (_BULLET_INDENT_PT if block.kind == "bullet" else 0.0)
        total += _wrapped(_block_text(block), font, width) * font * leading
        if block.kind == "section":
            total += space["before_section"] + space["after_section"]
        elif block.kind == "role_header":
            total += space["before_role"] + space["after_role_header"]
        else:
            key = _BLOCK_AFTER.get(block.kind)
            if key:
                total += space[key]
    return total


def pages_at(blocks: list[Block], scale: float = 1.0) -> int:
    height = estimate_height_pt(blocks, scale)
    return max(1, math.ceil(height / USABLE_HEIGHT_PT))


def density_scale(blocks: list[Block]) -> float:
    """How tightly to set this particular document.

    The rule is only about page boundaries: compress when doing so removes a
    page, and otherwise stay comfortable. Tightening a document that already
    fits buys nothing and costs legibility.

    Crucially, compress only when it ACTUALLY reclaims a page. The previous
    version compressed whenever the content landed just past a boundary,
    whether or not the compression was enough to pull it back — so a document
    that was going to spill regardless got cramped AND spilled, which is the
    worst of both. If no step reclaims a page, set it comfortably and let it
    run long.
    """
    natural = pages_at(blocks, 1.0)
    if natural <= 1:
        return 1.0
    for scale in _DENSITY_STEPS:
        if pages_at(blocks, scale) < natural:
            return scale
    return 1.0


def spacing_for(blocks: list[Block]) -> dict[str, float]:
    return _spacing_at(density_scale(blocks))


def line_height_for(blocks: list[Block]) -> float:
    return _line_height_at(density_scale(blocks))


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
    blocks.append(Block("name", text=read(contact, "fullName")))
    if (read(contact, "headline")).strip():
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
            names = ", ".join(read(s, "name").strip() for s in group.get("skills") or [] if s.get("name"))
            if names:
                blocks.append(Block("skills", label=read(group, "category"), text=names))

    if doc.get("experience"):
        blocks.append(Block("section", text=HEADINGS["experience"]))
        for role in doc["experience"]:
            blocks.append(
                Block(
                    "role_header",
                    left=" — ".join(x for x in (role.get("company"), role.get("role")) if x),
                    right=format_date_range(read(role, "startDate"), read(role, "endDate")),
                )
            )
            meta = "  |  ".join(x.strip() for x in (role.get("location"), role.get("context")) if x and x.strip())
            if meta:
                blocks.append(Block("role_meta", text=meta))
            for bullet in role.get("bullets") or []:
                if (read(bullet, "text")).strip():
                    blocks.append(Block("bullet", text=bullet["text"].strip()))

    if doc.get("projects"):
        blocks.append(Block("section", text=HEADINGS["projects"]))
        for project in doc["projects"]:
            blocks.append(Block("role_header", left=read(project, "name"), right=(read(project, "link")).strip()))
            stack = ", ".join(project.get("stack") or [])
            detail = " ".join(x for x in (read(project, "description"), f"Stack: {stack}" if stack else "") if x).strip()
            if detail:
                blocks.append(Block("bullet", text=detail))

    if doc.get("education"):
        blocks.append(Block("section", text=HEADINGS["education"]))
        for edu in doc["education"]:
            # Institution on the bold line: it is the anchor a human scans for
            # and the token an ATS matches, so it should not be demoted.
            blocks.append(Block("role_header", left=read(edu, "institution"), right=read(edu, "endDate")))
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
            certs.append(f"{cert.get('name', '')} ({detail})" if detail else read(cert, "name"))
        if certs:
            blocks.append(Block("paragraph", text="  •  ".join(c for c in certs if c)))

    if doc.get("additional"):
        blocks.append(Block("section", text=HEADINGS["additional"]))
        for item in doc["additional"]:
            if (read(item, "value")).strip():
                blocks.append(Block("labelled", label=read(item, "label"), text=item["value"].strip()))

    return blocks
