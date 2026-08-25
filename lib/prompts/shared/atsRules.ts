/** Writing and ATS formatting rules, reused verbatim across generative prompts (§5.4, §5.6). */

export const WRITING_RULES = `═══ WRITING RULES ═══
6. Bullets follow Action -> Context -> Quantified Outcome. Start with a strong
   past-tense verb (Led, Shipped, Reduced, Architected). Never "Responsible for".
7. One to two lines each. Cut adverbs and filler.
8. Preserve every original metric exactly. Do not round, inflate, or estimate.
9. Summary: 40-70 words, third person, no pronouns, opens with the target
   role title where truthful.
10. coreSkills: use the JD's exact terminology for skills the candidate
    genuinely has. Group into at most 5 categories, most JD-relevant first.
    Relabelling a real skill into the JD's wording is encouraged; inventing a
    skill is not. Each skill's sourceEvidence must show which work earns it.
11. Order experience reverse-chronologically. Within each role, order bullets
    by relevance to THIS job, not by chronology.
12. Mirror the JD's register ({{TONE}}) without copying its sentences.
13. Target one page for <8 years experience, two pages beyond that. Trim the
    least relevant bullets from the oldest roles first.`;

export const ATS_FORMATTING_RULES = `═══ ATS FORMATTING RULES ═══
14. Plain text values only — no markdown, no bold markers, no emoji, no special
    glyphs beyond standard punctuation.
15. Dates strictly "MMM YYYY". Present roles end with "Present".
16. Spell out an acronym on first use, then use the acronym: "Assets Under
    Management (AUM)".`;

export function withTone(rules: string, tone: string): string {
  return rules.replace("{{TONE}}", tone);
}
