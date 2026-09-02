"""Keywords the gap analysis called MISSING must not appear in the output.

A MISSING term is an honest gap: something the posting wants and the candidate
does not have. Writing it in anyway produces a resume they cannot defend in an
interview, which is worse than the gap.

The evidence check cannot catch this on its own. A model can take a real bullet
with real, traceable evidence and append a clause the evidence does not support
— "coordinated discrepancy resolution" becoming "...ensuring timely corrective
actions" — and every traceability test still passes, because the bullet really
is derived from that work. What fails is the narrower claim bolted on the end.

**With one exemption, which matters more than the rule it qualifies.** The
MISSING list comes from a model, and a model can be wrong about it. An
electrician whose resume reads "City and Guilds 2382 18th Edition, 2019" had
"18th Edition" reported as a gap. Enforced literally, this would then delete a
real, verbatim-evidenced qualification from the candidate's own resume — the
exact opposite of the point. So a term that appears in the source is treated as
an analysis error, not a gap.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from .sanitize import sanitise_text


@dataclass
class ForbiddenRemoval:
    kind: Literal["bullet", "skill", "certification", "project", "additional", "summary"]
    where: str
    text: str
    term: str


def contains_term(haystack: str, term: str) -> bool:
    """Whole-word, case-insensitive, both sides normalised first.

    Normalising matters here for the same reason it does before the evidence
    check: a MISSING list came back with "PLC fault‑finding" carrying a
    non-breaking hyphen while the resume used an ordinary one, and compared raw
    those match nothing. Both directions are dangerous — a real credential
    fails the source exemption and gets stripped, and a genuinely forbidden
    term goes undetected in the output.
    """
    cleaned = sanitise_text(term).strip()
    if len(cleaned) < 2:
        return False
    pattern = rf"(^|[^A-Za-z0-9]){re.escape(cleaned)}([^A-Za-z0-9]|$)"
    return re.search(pattern, sanitise_text(haystack), re.IGNORECASE) is not None


def enforceable_terms(missing: list[str], raw_source_text: str | None) -> list[str]:
    """The gap terms worth enforcing: those the candidate cannot support.

    Without the source nothing can be exempted, so every term stands. That is
    the conservative direction — it can over-strip, never under-strip.
    """
    if not raw_source_text:
        return list(missing)
    return [t for t in missing if not contains_term(raw_source_text, t)]


def searchable_text(doc: dict[str, Any]) -> str:
    """Every surface a reader — or an ATS — will see."""
    parts: list[str] = [
        (doc.get("contact") or {}).get("headline", ""),
        doc.get("summary", ""),
    ]
    for group in doc.get("coreSkills") or []:
        parts.append(group.get("category", ""))
        parts.extend(s.get("name", "") for s in group.get("skills") or [])
    for role in doc.get("experience") or []:
        parts.extend([role.get("role", ""), role.get("company", ""), role.get("context") or ""])
        parts.extend(b.get("text", "") for b in role.get("bullets") or [])
    for project in doc.get("projects") or []:
        parts.extend([project.get("name", ""), project.get("description", "")])
        parts.extend(project.get("stack") or [])
    for edu in doc.get("education") or []:
        parts.extend([edu.get("institution", ""), edu.get("degree", ""), edu.get("field") or ""])
    for cert in doc.get("certifications") or []:
        parts.append(cert.get("name", ""))
    for item in doc.get("additional") or []:
        parts.extend([item.get("label", ""), item.get("value", "")])
    return "\n".join(p for p in parts if p)


def strip_forbidden(
    doc: dict[str, Any],
    missing: list[str],
    raw_source_text: str | None = None,
) -> tuple[dict[str, Any], list[ForbiddenRemoval]]:
    """Remove anything carrying a gap keyword.

    Covers every surface `searchable_text` reads. An earlier version searched
    certifications but could not clean them, so a hit there was reported on
    every check and could never be acted on — a guard able to see a problem and
    not fix it.

    Since the offending phrase cannot be excised from a sentence safely, the
    whole item goes. Losing a real bullet is the lesser harm: a gap keyword the
    candidate cannot defend is the thing that ends an interview.
    """
    terms = enforceable_terms(missing, raw_source_text)
    removed: list[ForbiddenRemoval] = []

    def offending(text: str) -> str | None:
        return next((t for t in terms if contains_term(text, t)), None)

    out = dict(doc)

    experience = []
    for role in doc.get("experience") or []:
        where = " — ".join(x for x in (role.get("company"), role.get("role")) if x)
        kept = []
        for bullet in role.get("bullets") or []:
            term = offending(bullet.get("text", ""))
            if term:
                removed.append(ForbiddenRemoval("bullet", where, bullet.get("text", ""), term))
            else:
                kept.append(bullet)
        if kept:
            experience.append({**role, "bullets": kept})
    out["experience"] = experience

    groups = []
    for group in doc.get("coreSkills") or []:
        kept_skills = []
        for skill in group.get("skills") or []:
            term = offending(skill.get("name", ""))
            if term:
                removed.append(
                    ForbiddenRemoval("skill", group.get("category", ""), skill.get("name", ""), term)
                )
            else:
                kept_skills.append(skill)
        if kept_skills:
            groups.append({**group, "skills": kept_skills})
    out["coreSkills"] = groups

    # The summary is one field, so a hit is edited out by clearing it rather
    # than dropping content usable elsewhere.
    summary_term = offending(doc.get("summary", ""))
    if summary_term:
        removed.append(
            ForbiddenRemoval("summary", "Professional summary", doc.get("summary", ""), summary_term)
        )
        out["summary"] = ""

    if doc.get("certifications"):
        kept_certs = []
        for cert in doc["certifications"]:
            term = offending(f"{cert.get('name', '')} {cert.get('issuer') or ''}")
            if term:
                removed.append(
                    ForbiddenRemoval("certification", "Certifications", cert.get("name", ""), term)
                )
            else:
                kept_certs.append(cert)
        out["certifications"] = kept_certs

    if doc.get("projects"):
        kept_projects = []
        for project in doc["projects"]:
            blob = " ".join(
                [project.get("name", ""), project.get("description", ""), *(project.get("stack") or [])]
            )
            term = offending(blob)
            if term:
                removed.append(
                    ForbiddenRemoval("project", "Projects", project.get("name", ""), term)
                )
            else:
                kept_projects.append(project)
        out["projects"] = kept_projects

    if doc.get("additional"):
        kept_additional = []
        for item in doc["additional"]:
            term = offending(f"{item.get('label', '')} {item.get('value', '')}")
            if term:
                removed.append(
                    ForbiddenRemoval("additional", item.get("label", ""), item.get("value", ""), term)
                )
            else:
                kept_additional.append(item)
        out["additional"] = kept_additional

    return out, removed


def find_forbidden(
    doc: dict[str, Any],
    missing: list[str],
    raw_source_text: str | None = None,
) -> list[str]:
    """Gap terms still present after stripping. Should always be empty.

    Uses the same exemption as the stripper: if these two disagreed about what
    counts, this would report hits the stripper had deliberately spared.
    """
    text = searchable_text(doc)
    return [t for t in enforceable_terms(missing, raw_source_text) if contains_term(text, t)]
