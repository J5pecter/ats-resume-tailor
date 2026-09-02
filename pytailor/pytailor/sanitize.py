"""Normalise what a model returns before anything measures it.

Models emit typographic look-alikes despite being told not to: a non-breaking
hyphen in "drop-off", curly quotes, an ellipsis character. Two things break as
a result. An ATS matching keywords literally misses them, and — the one that
actually bit — our own tokeniser splits "drop‑off" differently from "drop-off",
dragging a perfectly well-evidenced bullet under the overlap threshold and
getting it rejected.

So this runs first, before evidence, keywords or retention look at anything.
"""

from __future__ import annotations

import re
from typing import Any

# Every hyphen-like character a model reaches for, mapped to the ASCII one.
_REPLACEMENTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[‐-―−]"), "-"),
    (re.compile(r"[‘’‛]"), "'"),
    (re.compile(r"[“”‟]"), '"'),
    (re.compile(r"…"), "..."),
    # Non-breaking, en/em/thin, narrow no-break and ideographic spaces.
    (re.compile(r"[  -   　]"), " "),
    # Zero-width characters: invisible on screen, and they split tokens.
    (re.compile(r"[​‌‍﻿]"), ""),
    # Markdown emphasis the model was told not to emit.
    (re.compile(r"\*\*(.+?)\*\*"), r"\1"),
    (re.compile(r"__(.+?)__"), r"\1"),
    # Space before a comma or full stop. Usually the candidate's own typo,
    # carried through faithfully — "Kandivali ,Mumbai" — sitting on the contact
    # line under their name, where it is the one thing that looks careless.
    # Horizontal whitespace only: a greedy \s would match a newline and weld
    # two bullets into one line, a far worse edit than the typo.
    (re.compile(r"[ \t]+([,.;:])"), r"\1"),
    # The other half of the same typo. Restricted to a following LETTER on
    # purpose: a digit there is a thousands separator or a time, and a broader
    # rule turns "40,000 monthly applicants" into "40, 000" and "6:00" into
    # "6: 00". Mangling a metric is the failure this whole project exists to
    # prevent, so the narrow rule is the correct one.
    (re.compile(r"([,;:])(?=[A-Za-z])"), r"\1 "),
]

_LEADING_MARKER = re.compile(r"^\s*[•‣▪●·*\-–—]+\s+")
_RUNS_OF_SPACE = re.compile(r"[ \t]{2,}")


def sanitise_text(value: str) -> str:
    """ASCII-normalise a string, leaving line structure intact."""
    out = value
    for pattern, replacement in _REPLACEMENTS:
        out = pattern.sub(replacement, out)
    return _RUNS_OF_SPACE.sub(" ", out).strip()


def sanitise_bullet(value: str) -> str:
    """Same, plus dropping a list marker the model prefixed to a bullet.

    The renderer adds its own, so a leading bullet glyph here produces two.
    """
    return sanitise_text(_LEADING_MARKER.sub("", value))


def sanitise_document(doc: dict[str, Any]) -> dict[str, Any]:
    """Walk a resume document, normalising every string a reader will see.

    Returns a new dict. Mutating the caller's copy would mean the "before"
    used by the retention check had already been quietly rewritten.
    """
    out: dict[str, Any] = dict(doc)

    contact = dict(out.get("contact") or {})
    for key, value in list(contact.items()):
        if isinstance(value, str):
            contact[key] = sanitise_text(value)
    out["contact"] = contact

    if isinstance(out.get("summary"), str):
        out["summary"] = sanitise_text(out["summary"])

    groups = []
    for group in out.get("coreSkills") or []:
        skills = []
        for skill in group.get("skills") or []:
            if isinstance(skill, str):
                skills.append({"name": sanitise_text(skill), "sourceEvidence": ""})
            else:
                skills.append(
                    {
                        **skill,
                        "name": sanitise_text(skill.get("name", "")),
                        "sourceEvidence": sanitise_text(skill.get("sourceEvidence", "")),
                    }
                )
        groups.append({**group, "category": sanitise_text(group.get("category", "")), "skills": skills})
    out["coreSkills"] = groups

    experience = []
    for role in out.get("experience") or []:
        bullets = [
            {
                **bullet,
                "text": sanitise_bullet(bullet.get("text", "")),
                "sourceEvidence": sanitise_text(bullet.get("sourceEvidence", "")),
            }
            for bullet in role.get("bullets") or []
        ]
        cleaned = {k: (sanitise_text(v) if isinstance(v, str) else v) for k, v in role.items()}
        cleaned["bullets"] = bullets
        experience.append(cleaned)
    out["experience"] = experience

    for section in ("education", "certifications", "projects", "additional"):
        rows = out.get(section)
        if not rows:
            continue
        out[section] = [
            {k: (sanitise_text(v) if isinstance(v, str) else v) for k, v in row.items()}
            for row in rows
        ]

    return out
