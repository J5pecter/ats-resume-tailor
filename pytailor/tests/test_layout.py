"""Page-fitting, tested against the orphan it once produced.

The estimator used to count "lines" and assume a page held 40 of them. Both
halves were wrong: a line has no fixed height in this document (an 11pt section
heading, a 9.5pt contact line, a 10pt bullet), and the spacers between blocks
add vertical room that a line count cannot see at all. On a real CV it
estimated 50 lines where 59 rendered, against a page that actually holds 57.

The visible result was the exact failure the density rule exists to prevent: a
two-page PDF whose second page carried two lines. The rule had fired, tightened
the whole document to its densest setting, and still spilled — the worst of
both outcomes.
"""

from __future__ import annotations

import copy

from pytailor.layout import (
    USABLE_HEIGHT_PT,
    Block,
    build_blocks,
    density_scale,
    estimate_height_pt,
    pages_at,
)


def _doc(bullets: int, *, skills: int = 6) -> dict:
    return {
        "contact": {"fullName": "Jayesh Mahajan", "email": "j@example.com", "location": "Mumbai"},
        "coreSkills": [
            {"category": "Product", "skills": [{"name": f"Skill number {i}"} for i in range(skills)]}
        ],
        "experience": [
            {
                "company": "Anand Rathi",
                "role": "Assistant Product Manager",
                "startDate": "Mar 2024",
                "endDate": "Present",
                "bullets": [
                    {"text": "Owned the digital onboarding funnel end to end, from "
                             f"requirement gathering through go-live readiness. Item {i}."}
                    for i in range(bullets)
                ],
            }
        ],
    }


def test_short_document_is_not_compressed():
    """A document that already fits is left comfortable. Tightening buys nothing."""
    blocks = build_blocks(_doc(3))
    assert pages_at(blocks, 1.0) == 1
    assert density_scale(blocks) == 1.0


def test_compression_fires_when_it_reclaims_the_page():
    """Just past a boundary, and recoverable: compress."""
    for bullets in range(4, 30):
        blocks = build_blocks(_doc(bullets))
        if pages_at(blocks, 1.0) == 2 and pages_at(blocks, 0.68) == 1:
            assert density_scale(blocks) < 1.0
            assert pages_at(blocks, density_scale(blocks)) == 1
            return
    raise AssertionError("no document in the swept range was recoverable by compression")


def test_the_loosest_density_that_works_is_chosen():
    """Never tighter than the page actually requires."""
    for bullets in range(4, 30):
        blocks = build_blocks(_doc(bullets))
        chosen = density_scale(blocks)
        if chosen == 1.0:
            continue
        for looser in (0.85, 0.75):
            if looser > chosen:
                assert pages_at(blocks, looser) > 1, (
                    f"{looser} would also have fitted; {chosen} is needlessly tight"
                )


def test_unrecoverable_document_is_not_cramped():
    """The bug this file exists for.

    A document too long to be saved by any density must be set comfortably and
    allowed to run long. Cramping it costs legibility and does not buy the page
    back — which is what shipped a second page holding two lines.
    """
    blocks = build_blocks(_doc(40))
    assert pages_at(blocks, 0.68) > 1, "fixture is not actually unrecoverable"
    assert density_scale(blocks) == 1.0


def test_height_grows_with_content():
    small = build_blocks(_doc(3))
    large = build_blocks(_doc(12))
    assert estimate_height_pt(large) > estimate_height_pt(small)


def test_compression_reduces_height():
    blocks = build_blocks(_doc(12))
    assert estimate_height_pt(blocks, 0.68) < estimate_height_pt(blocks, 1.0)


def test_bullets_wrap_earlier_than_full_width():
    """Bullets are indented in both writers, so they must be measured narrower.

    The length matters: at 206 characters a paragraph fits two lines and an
    indented bullet needs three. Pick a length where both wrap the same and the
    test measures the 1pt difference between the two spacers instead, which is
    not the property under test.
    """
    text = "x" * 206
    bullet = [Block("bullet", text=text)]
    para = [Block("paragraph", text=text)]
    assert estimate_height_pt(bullet) > estimate_height_pt(para)


def test_page_capacity_matches_the_rendered_page():
    """Guards the constant that was wrong.

    A page of plain body lines should hold roughly what the geometry says, not
    the 40 the old model assumed. LETTER minus 0.65in margins is 698.4pt; at
    10pt body and 1.3 leading that is ~53 lines.
    """
    one_line = 10.0 * 1.3
    assert 50 <= USABLE_HEIGHT_PT / one_line <= 56
