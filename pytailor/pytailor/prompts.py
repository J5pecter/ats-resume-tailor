"""The prompts, composed from shared fragments.

Never inline a prompt at a call site. These fragments are the main lever on
output quality, and several of the sentences here are load-bearing in a way
that is not obvious — each of the numbered notes below marks a rule that was
rewritten after a real failure, and softening one brings that failure back.
"""

from __future__ import annotations

import json
from typing import Any

NO_FABRICATION = """═══ ABSOLUTE CONSTRAINTS ═══
1. NEVER invent an employer, a job title, a date, a degree, a certification, a
   tool or a metric. If it is not in the candidate's resume, it does not exist.
2. Every bullet and every skill MUST carry sourceEvidence: a VERBATIM fragment
   of the original resume that supports it. It is checked after you answer, and
   anything that fails is deleted.
3. sourceEvidence must be evidence FOR THAT CLAIM. Never quote the company
   name, the job title, or the date line as evidence for a bullet — those are
   real text, so they pass a naive check, and they support nothing.
4. Preserve every original metric exactly. Do not round, inflate or estimate.
   Changing 31% to "roughly a third" is fabrication.
5. Rewriting, reordering, regrouping and relabelling are all encouraged.
   Inventing is not."""

WRITING_RULES = """═══ WRITING RULES ═══
6. Bullets follow Action -> Context -> Quantified Outcome. Open with a strong
   past-tense verb. Never "Responsible for".
7. One to two lines each. Cut adverbs and filler.
8. Summary: 40-70 words, third person, no pronouns, opening with the target
   role title where that is truthful.
9. coreSkills: CARRY OVER EVERY SKILL the candidate genuinely has. Group them
   into at most 5 categories, most relevant first. The 5-category cap limits
   GROUPS, never how many skills you keep — a group may hold ten or more.
   Dropping a real skill silently forfeits a keyword match and gains nothing.
   Use the posting's exact wording where the underlying skill matches:
   relabelling a real skill is encouraged, inventing one is not.
10. Order experience reverse-chronologically. Within a role, order bullets by
    relevance to THIS job rather than by date.
11. KEEP EVERY BULLET unless the page budget genuinely forces a cut — roughly
    18-20 bullets fit a page. Below that there is no pressure at all, so
    reorder and keep the lot. Deleting a bullet destroys evidence the candidate
    actually has; rewording it, merging two, or moving it down are all better.
12. Mirror the posting's register without copying its sentences."""

JSON_ONLY = "Return a single JSON object. No commentary, no markdown fences, no preamble."

RESUME_SHAPE = """{
  "contact": {"fullName": str, "headline": str, "email": str, "phone": str,
              "location": str, "linkedin": str|null, "portfolio": str|null},
  "summary": str,
  "coreSkills": [{"category": str, "skills": [{"name": str, "sourceEvidence": str}]}],
  "experience": [{"company": str, "role": str, "location": str, "startDate": str,
                  "endDate": str, "context": str|null,
                  "bullets": [{"text": str, "sourceEvidence": str}]}],
  "education": [{"institution": str, "degree": str, "field": str|null,
                 "endDate": str, "score": str|null}],
  "certifications": [{"name": str, "issuer": str|null, "date": str|null}],
  "projects": [{"name": str, "description": str, "stack": [str], "link": str|null}],
  "additional": [{"label": str, "value": str}]
}"""


def resume_parser(raw_resume: str) -> tuple[str, str]:
    system = f"""You are a resume parser. Convert the resume into structured JSON.

RULES
1. Extract only what is present. Never infer, embellish or add.
2. If a field is genuinely absent, omit it. Never write "N/A".
3. Preserve the candidate's own numbers, metrics and proper nouns exactly.
4. Normalise dates to "MMM YYYY". A current role ends "Present".
5. Keep bullets verbatim — this is extraction, not rewriting.
6. For each bullet, sourceEvidence is the bullet's own original text.
7. For each skill, sourceEvidence is the phrase where it appears. At this stage
   the skill's name must be the resume's own wording, never a synonym.
8. Read sections by CONTENT, not heading. QUALIFICATIONS, LICENCES,
   ACCREDITATIONS, TRAINING and MEMBERSHIPS all carry the same things as
   CERTIFICATIONS and EDUCATION. A line naming an award and a year is a
   credential: a degree goes under education, a licence under certifications.
9. NEVER discard a line because it does not fit neatly. If you cannot classify
   something, put it in additional with a label. Dropping it deletes the
   candidate's evidence — a lost credential forfeits a keyword match, and the
   gap analysis that runs next reports it as something they lack, telling them
   to explain away a qualification they actually hold.
10. Rule 2 lets you omit a field the resume does not have. It never lets you
    omit something the resume does have.

{JSON_ONLY}

<schema>
{RESUME_SHAPE}
</schema>"""
    return system, f"<resume>\n{raw_resume}\n</resume>\n\nReturn the ResumeDoc JSON."


def jd_parser(raw_jd: str) -> tuple[str, str]:
    system = f"""You extract the requirement profile from a job posting.

RULES
1. Extract only what the posting states. Never infer a requirement it does not make.
2. atsKeywords are the exact terms an ATS would match — verbatim from the posting.
3. Separate must-haves from nice-to-haves as the posting separates them.
4. tone: describe the register in a few words.

{JSON_ONLY}

Shape:
{{
  "roleTitle": str, "company": str|null, "seniority": str, "function": str,
  "mustHaves": [{{"requirement": str, "category": str}}],
  "niceToHaves": [{{"requirement": str, "category": str}}],
  "atsKeywords": [str],
  "tone": str
}}"""
    return system, f"<job_posting>\n{raw_jd}\n</job_posting>\n\nReturn the JDProfile JSON."


def gap_analysis(jd: dict[str, Any], resume: dict[str, Any], raw_resume: str) -> tuple[str, str]:
    system = f"""You are an ATS screening simulator. Compare the candidate against the
requirements. Be blunt — optimism here costs the candidate interviews.

RULES
1. MATCHED only if the resume demonstrates it, not merely mentions it adjacently.
2. PARTIAL = adjacent or transferable experience exists but the exact term does not.
3. MISSING = no supporting evidence at all.
   Before putting a term in missing, search the candidate's ORIGINAL TEXT for
   it, not just the structured profile. The profile is a parse and parses lose
   things — credentials filed under unusual headings go astray most often. If
   the term appears anywhere in the original text it is MATCHED or PARTIAL,
   never MISSING. Calling something a gap the candidate demonstrably has is the
   worst error available here: it tells them to explain away a qualification
   they hold.
4. atsScore: weighted coverage of the posting's keywords, 0-100.

{JSON_ONLY}

Shape:
{{
  "atsScore": number,
  "matched": [{{"term": str, "evidence": str}}],
  "partial": [{{"term": str, "closestEvidence": str, "howToSurface": str}}],
  "missing": [{{"term": str, "honestNote": str}}],
  "topThreeFixes": [str]
}}"""
    user = (
        f"<job_profile>\n{json.dumps(jd)}\n</job_profile>\n\n"
        f"<candidate_resume>\n{json.dumps(resume)}\n</candidate_resume>\n\n"
        f"<candidate_original_text>\n{raw_resume}\n</candidate_original_text>\n\n"
        "Return the MatchAnalysis JSON."
    )
    return system, user


def _without_evidence(resume: dict[str, Any]) -> dict[str, Any]:
    """The parsed resume with the parser's own quotes stripped out.

    Those quotes are the parser echoing the raw text back, and the raw text is
    supplied in full alongside — so sending both is the same content twice. On
    a real CV that duplication cost about 2,000 tokens of an 8,000-per-minute
    budget, which left too little room for the answer: the reply came back
    truncated at 3,004 tokens and the run failed.
    """
    out = dict(resume)
    out["experience"] = [
        {
            **role,
            "bullets": [{"text": b.get("text", "")} for b in role.get("bullets") or []],
        }
        for role in resume.get("experience") or []
    ]
    out["coreSkills"] = [
        {
            **group,
            "skills": [{"name": s.get("name", "")} for s in group.get("skills") or []],
        }
        for group in resume.get("coreSkills") or []
    ]
    return out


def tailor_engine(
    jd: dict[str, Any],
    analysis: dict[str, Any],
    resume: dict[str, Any],
    raw_resume: str,
) -> tuple[str, str]:
    missing = [m.get("term", "") for m in analysis.get("missing") or []]
    tone = jd.get("tone") or "professional and direct"

    system = f"""You rewrite a resume for one specific job posting.

{NO_FABRICATION}

{WRITING_RULES.replace("the posting's register", f"the posting's register ({tone})")}

═══ THE GAP LIST ═══
These are things the candidate does NOT have. They must not appear anywhere in
your output, in any wording, however tempting:
{json.dumps(missing)}

{JSON_ONLY}

Shape:
{{
  "resume": {RESUME_SHAPE},
  "changeLog": [{{"section": str, "change": str, "rationale": str}}],
  "projectedAtsScore": number,
  "remainingGaps": [str]
}}"""

    user = (
        f"<job_profile>\n{json.dumps(jd)}\n</job_profile>\n\n"
        f"<gap_analysis>\n{json.dumps(analysis)}\n</gap_analysis>\n\n"
        f"<parsed_resume>\n{json.dumps(_without_evidence(resume))}\n</parsed_resume>\n\n"
        f"<candidate_original_text>\n{raw_resume}\n</candidate_original_text>\n\n"
        "Return the TailorResult JSON."
    )
    return system, user
