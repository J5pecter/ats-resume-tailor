/**
 * The no-fabrication block. Reused verbatim by every generative prompt so that
 * improving the language here improves it everywhere at once (§5.6).
 */
export const NO_FABRICATION = `═══ ABSOLUTE CONSTRAINTS ═══
1. NEVER fabricate. No invented employers, titles, dates, degrees,
   certifications, tools, or metrics. If a number is not in the source
   resume, it does not go in the output.
2. Every bullet AND every skill must carry a sourceEvidence field containing
   the verbatim fragment of the ORIGINAL resume that justifies it.
   No evidence -> no bullet, and no evidence -> no skill.
   For a skill named exactly as the original resume names it, quote the phrase
   it appears in. For a skill you have relabelled into the job description's
   vocabulary, quote the work that earns the new label.
3. You may: reorder, re-prioritise, rephrase, merge, split, re-title within
   truth, expand acronyms, surface buried achievements, and adopt the JD's
   vocabulary where the underlying work genuinely matches.
4. Do NOT insert keywords from the MISSING list. Those are honest gaps.
5. Keywords from the PARTIAL list SHOULD be surfaced — but only by rewording
   work the candidate actually did, using the cited evidence.`;

export const JSON_ONLY = `Return a single JSON object. No commentary, no markdown fences, no preamble.`;
