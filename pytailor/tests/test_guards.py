"""The guards, tested against the failures that actually shipped.

Every case here corresponds to a bug that reached a real resume in the
TypeScript original. A port that does not carry these forward is not a port —
it is the same bugs, waiting to be rediscovered on somebody's job application.
"""

from __future__ import annotations

import copy

from pytailor.evidence import (
    RELATEDNESS_THRESHOLD,
    check_evidence,
    relatedness,
    strip_unsupported,
    token_overlap,
    tokenise,
)
from pytailor.keywords import find_forbidden, strip_forbidden
from pytailor.retention import check_retention
from pytailor.sanitize import sanitise_bullet, sanitise_text

SOURCE = """Priya Raman
Senior Product Manager

Arihant Securities - Senior Product Manager (Apr 2023 - Present)
- Owned the digital KYC onboarding funnel end to end, cutting drop-off 31% across 40,000 monthly applicants
- Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap

SKILLS
Product discovery, Roadmapping, SQL, Funnel optimisation, KYC
"""


def doc_with(bullets, skills=None):
    return {
        "contact": {"fullName": "Priya Raman", "headline": "Senior Product Manager"},
        "summary": "",
        "coreSkills": [{"category": "Product", "skills": skills or []}],
        "experience": [
            {
                "company": "Arihant Securities",
                "role": "Senior Product Manager",
                "startDate": "Apr 2023",
                "endDate": "Present",
                "bullets": bullets,
            }
        ],
        "education": [],
    }


class TestSanitise:
    def test_normalises_the_hyphen_that_broke_the_tokeniser(self):
        # A non-breaking hyphen splits "drop-off" differently and drags a
        # well-evidenced bullet under the overlap threshold.
        assert sanitise_text("cutting drop‑off 31%") == "cutting drop-off 31%"

    def test_strips_a_bullet_glyph_the_renderer_adds_itself(self):
        assert sanitise_bullet("•  Led the team") == "Led the team"

    def test_closes_a_space_before_a_comma(self):
        # Straight from a real CV, rendered directly under the candidate's name.
        assert sanitise_text("Kandivali ,Mumbai") == "Kandivali, Mumbai"

    def test_never_mangles_a_metric(self):
        # The first version of that rule produced "40, 000" and "6: 00".
        # Corrupting a number is the failure this project exists to prevent.
        assert sanitise_text("40,000 monthly applicants") == "40,000 monthly applicants"
        assert sanitise_text("CGPA 8.20") == "CGPA 8.20"
        assert sanitise_text("from 6:00 to 0:40") == "from 6:00 to 0:40"

    def test_never_welds_two_lines_together(self):
        # A greedy whitespace class would match the newline and join these.
        assert "\n" in sanitise_text("Led the team\nDelivered on time")


class TestEvidence:
    def test_accepts_a_reworded_bullet_that_cites_its_own_origin(self):
        doc = doc_with(
            [
                {
                    "text": "Cut KYC onboarding drop-off by 31% across 40,000 monthly applicants",
                    "sourceEvidence": "cutting drop-off 31% across 40,000 monthly applicants",
                }
            ]
        )
        assert check_evidence(doc, SOURCE).passed

    def test_rejects_an_invented_bullet(self):
        doc = doc_with(
            [{"text": "Led a team of 40 engineers", "sourceEvidence": "Led a team of 40 engineers"}]
        )
        report = check_evidence(doc, SOURCE)
        assert not report.passed
        assert report.failures[0].reason == "unsupported"

    def test_rejects_the_employer_header_cited_for_every_bullet(self):
        # THE bug. The quote is real and traces perfectly; it is simply not
        # about the claim. Traceability alone ships this.
        doc = doc_with(
            [
                {
                    "text": "Ran weekly discovery interviews with 60 relationship managers",
                    "sourceEvidence": "Arihant Securities - Senior Product Manager",
                }
            ]
        )
        report = check_evidence(doc, SOURCE)
        assert not report.passed
        assert report.failures[0].reason == "unrelated"
        assert token_overlap(
            "Arihant Securities - Senior Product Manager", set(tokenise(SOURCE))
        ) == 1.0

    def test_rejects_empty_evidence(self):
        doc = doc_with([{"text": "Did something", "sourceEvidence": ""}])
        assert check_evidence(doc, SOURCE).failures[0].reason == "empty"

    def test_relatedness_uses_the_shorter_side(self):
        # A long bullet citing a short quote and the reverse are both fine.
        long_claim = "Owned the digital KYC onboarding funnel end to end across many channels"
        short_evidence = "KYC onboarding funnel"
        assert relatedness(long_claim, short_evidence) >= RELATEDNESS_THRESHOLD
        assert relatedness(short_evidence, long_claim) >= RELATEDNESS_THRESHOLD

    def test_a_skill_named_verbatim_needs_no_evidence(self):
        # Relabelling a real skill into the posting's vocabulary is allowed, so
        # a name-only rule would reject that legitimate rewrite; a skill spelled
        # out in the resume needs no further proof.
        doc = doc_with([], skills=[{"name": "SQL", "sourceEvidence": ""}])
        assert check_evidence(doc, SOURCE).passed

    def test_an_invented_skill_is_caught(self):
        doc = doc_with([], skills=[{"name": "Kubernetes", "sourceEvidence": "ran clusters"}])
        assert not check_evidence(doc, SOURCE).passed

    def test_stripping_removes_a_role_left_with_no_bullets(self):
        doc = doc_with([{"text": "Invented", "sourceEvidence": "nothing like the source at all"}])
        report = check_evidence(doc, SOURCE)
        cleaned = strip_unsupported(doc, report.failures)
        assert cleaned["experience"] == []
        assert check_evidence(cleaned, SOURCE).passed


class TestForbiddenKeywords:
    def test_removes_a_bullet_that_smuggled_a_gap_keyword(self):
        doc = doc_with(
            [
                {
                    "text": "Coordinated discrepancy resolution, ensuring timely corrective actions",
                    "sourceEvidence": "coordinated discrepancy resolution",
                }
            ]
        )
        cleaned, removed = strip_forbidden(doc, ["corrective actions"], SOURCE)
        assert [r.term for r in removed] == ["corrective actions"]
        assert cleaned["experience"] == []

    def test_does_not_delete_a_credential_the_candidate_actually_holds(self):
        # The MISSING list comes from a model and the model can be wrong. This
        # resume says "18th Edition" outright; deleting it inverts the point.
        source = "City and Guilds 2382 18th Edition, 2019"
        doc = doc_with([], skills=[{"name": "18th Edition", "sourceEvidence": source}])
        doc["certifications"] = [{"name": "City and Guilds 2382 18th Edition"}]

        cleaned, removed = strip_forbidden(doc, ["18th Edition"], source)
        assert removed == []
        assert find_forbidden(cleaned, ["18th Edition"], source) == []

    def test_still_strips_a_term_genuinely_absent_from_the_source(self):
        doc = doc_with([], skills=[{"name": "PLC fault-finding", "sourceEvidence": "x"}])
        _, removed = strip_forbidden(doc, ["PLC fault-finding"], "nothing relevant here")
        assert [r.term for r in removed] == ["PLC fault-finding"]

    def test_matches_across_a_typographic_hyphen(self):
        # A MISSING list came back with a non-breaking hyphen while the resume
        # used an ordinary one. Compared raw, those match nothing.
        doc = doc_with([], skills=[{"name": "PLC fault-finding", "sourceEvidence": "x"}])
        _, removed = strip_forbidden(doc, ["PLC fault‑finding"], "unrelated source")
        assert len(removed) == 1

    def test_reaches_certifications_which_the_finder_can_see(self):
        # Certifications were once searched but not strippable, so a hit there
        # was reported forever and could never be acted on.
        doc = doc_with([])
        doc["certifications"] = [{"name": "CIA Certified"}]
        cleaned, removed = strip_forbidden(doc, ["CIA"], "no such credential here")
        assert [r.kind for r in removed] == ["certification"]
        assert find_forbidden(cleaned, ["CIA"], "no such credential here") == []

    def test_enforces_everything_when_no_source_is_supplied(self):
        doc = doc_with([], skills=[{"name": "18th Edition", "sourceEvidence": "x"}])
        _, removed = strip_forbidden(doc, ["18th Edition"])
        assert len(removed) == 1


class TestRetention:
    def _original(self):
        return doc_with(
            [
                {"text": "Owned the digital KYC onboarding funnel end to end", "sourceEvidence": ""},
                {"text": "Ran weekly discovery interviews with 60 managers", "sourceEvidence": ""},
            ],
            skills=[
                {"name": "SQL", "sourceEvidence": ""},
                {"name": "Roadmapping", "sourceEvidence": ""},
            ],
        )

    def test_reports_nothing_dropped_when_everything_survives(self):
        original = self._original()
        report = check_retention(original, copy.deepcopy(original))
        assert report.dropped == []
        assert report.kept_bullets == report.original_bullets
        assert not report.substantial_loss

    def test_recognises_a_reworded_bullet_as_the_same_bullet(self):
        original = self._original()
        tailored = copy.deepcopy(original)
        tailored["experience"][0]["bullets"][0]["text"] = (
            "Owned digital KYC onboarding end to end, cutting drop-off"
        )
        assert [d for d in check_retention(original, tailored).dropped if d.kind == "bullet"] == []

    def test_catches_a_bullet_removed_silently(self):
        original = self._original()
        tailored = copy.deepcopy(original)
        tailored["experience"][0]["bullets"].pop()
        dropped = [d for d in check_retention(original, tailored).dropped if d.kind == "bullet"]
        assert len(dropped) == 1

    def test_kept_counts_survivors_not_the_size_of_the_output(self):
        # Consolidation is legitimate: two originals merging into one entry that
        # cites both loses nothing. Counting the output called that a loss.
        original = self._original()
        tailored = copy.deepcopy(original)
        tailored["coreSkills"][0]["skills"] = [
            {"name": "SQL and Roadmapping", "sourceEvidence": "SQL, Roadmapping"}
        ]
        report = check_retention(original, tailored)
        output_skills = sum(len(g["skills"]) for g in tailored["coreSkills"])

        assert output_skills < report.original_skills
        assert report.kept_skills == report.original_skills
        assert not report.substantial_loss

    def test_headline_and_the_dropped_list_always_agree(self):
        original = self._original()
        tailored = copy.deepcopy(original)
        tailored["experience"][0]["bullets"].pop()
        tailored["coreSkills"][0]["skills"].pop()

        report = check_retention(original, tailored)
        dropped_bullets = sum(1 for d in report.dropped if d.kind == "bullet")
        dropped_skills = sum(1 for d in report.dropped if d.kind == "skill")

        # The report prints "X of Y kept" beside the list of what went. If
        # those can disagree, one of them is lying to the candidate.
        assert report.kept_bullets == report.original_bullets - dropped_bullets
        assert report.kept_skills == report.original_skills - dropped_skills

    def test_a_dropped_role_takes_its_bullets_with_it(self):
        original = self._original()
        tailored = copy.deepcopy(original)
        tailored["experience"] = []
        report = check_retention(original, tailored)
        assert any(d.kind == "role" for d in report.dropped)
        assert sum(1 for d in report.dropped if d.kind == "bullet") == report.original_bullets
