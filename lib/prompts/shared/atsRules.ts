/** Writing and ATS formatting rules, reused verbatim across generative prompts (§5.4, §5.6). */

export const WRITING_RULES = `═══ WRITING RULES ═══
6. Bullets follow Action -> Context -> Quantified Outcome. Start with a strong
   past-tense verb (Led, Shipped, Reduced, Architected). Never "Responsible for".
7. One to two lines each. Cut adverbs and filler.
8. Preserve every original metric exactly. Do not round, inflate, or estimate.
9. Summary: 40-70 words, third person, no pronouns, opens with the target
   role title where truthful.
10. coreSkills: CARRY OVER EVERY SKILL the candidate genuinely has. Group them
    into at most 5 categories, most JD-relevant first, and order skills within
    each group by relevance. The 5-category cap limits GROUPS, never how many
    skills you keep — a group may hold ten or more. Dropping a real skill
    silently forfeits a keyword match and gains nothing, so drop one only if it
    is a true duplicate of another. Use the JD's exact terminology where the
    underlying skill matches: relabelling a real skill into the JD's wording is
    encouraged, inventing one is not. Each skill's sourceEvidence must show
    which work earns it.
11. Order experience reverse-chronologically. Within each role, order bullets
    by relevance to THIS job, not by chronology.
12. Mirror the JD's register ({{TONE}}) without copying its sentences.
13. KEEP EVERY BULLET unless the page budget genuinely forces a cut. The budget
    is one page under 8 years of experience, two pages beyond it — and roughly
    18-20 bullets fit on a page. Below that count there is no pressure at all,
    so reorder by relevance and keep the lot. Only when the source genuinely
    overflows do you trim, least-relevant-first from the oldest role, and never
    below 2 bullets in any role you keep.
    Deleting a bullet destroys evidence the candidate actually has. Reword a
    weak bullet, merge two overlapping ones, or move it down the order — those
    are all better than dropping it. If you do drop one, say so explicitly in
    the changeLog with changeType "removed" and a rationale, so the candidate
    can put it back.`;

export const ATS_FORMATTING_RULES = `═══ ATS FORMATTING RULES ═══
14. Plain text values only — no markdown, no bold markers, no emoji, no special
    glyphs beyond standard punctuation.
15. Dates strictly "MMM YYYY". Present roles end with "Present".
16. Spell out an acronym on first use, then use the acronym: "Assets Under
    Management (AUM)".`;

export function withTone(rules: string, tone: string): string {
  return rules.replace("{{TONE}}", tone);
}
