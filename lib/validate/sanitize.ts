import type { ResumeDoc } from "@/lib/schema/resume";

/**
 * Normalises document text to plain ASCII punctuation (§6.1, ATS rule 14).
 *
 * Models reach for typographic characters unprompted — non-breaking hyphens in
 * "drop‑off", curly quotes, ellipsis glyphs — and asking them not to in the
 * prompt does not reliably stop it. That matters twice over:
 *
 *  1. ATS keyword matching is literal. "drop‑off" (U+2011) and "drop-off"
 *     (U+002D) are different tokens, so a typographic hyphen silently costs a
 *     keyword match the candidate had earned.
 *  2. Our own evidence check tokenises on ASCII, so the same glyph depresses
 *     the overlap score and can get a legitimate bullet or skill rejected.
 *
 * Which is why this runs before the evidence check, not after it.
 */

// Written with \u escapes rather than literal glyphs: the entire point of this
// file is characters that are hard to tell apart by eye in source.
const REPLACEMENTS: [RegExp, string][] = [
  // Hyphen, non-breaking hyphen, figure/en/em/horizontal-bar dashes, minus.
  // An em dash reading as a plain hyphen is a cosmetic loss; a keyword failing
  // to match because of a look-alike codepoint is not.
  [/[\u2010-\u2015\u2212]/g, "-"],
  // Curly single quotes and prime.
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  // Curly double quotes and double prime.
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],
  [/\u2026/g, "..."],
  // Non-breaking, en/em/thin, narrow no-break and ideographic spaces.
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " "],
  // Zero-width characters: invisible on screen, and they split tokens.
  [/[\u200B\u200C\u200D\uFEFF]/g, ""],
  // Markdown emphasis markers the model was told not to emit.
  [/\*\*(.+?)\*\*/g, "$1"],
  [/__(.+?)__/g, "$1"],
];

/** A bullet glyph or list marker the renderer will add itself. */
const LEADING_MARKER = /^\s*[\u2022\u2023\u25AA\u25CF\u00B7*\-\u2013\u2014]+\s+/;

export function sanitiseText(value: string): string {
  let out = value;
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/** Same, plus stripping any list marker the model prefixed to a bullet. */
export function sanitiseBullet(value: string): string {
  return sanitiseText(value.replace(LEADING_MARKER, ""));
}

/** Drops keys whose value is undefined, so absent optionals stay absent. */
function prune<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

export function sanitiseResumeDoc(resume: ResumeDoc): ResumeDoc {
  return prune({
    ...resume,
    contact: prune({
      ...resume.contact,
      fullName: sanitiseText(resume.contact.fullName),
      headline: sanitiseText(resume.contact.headline),
      email: sanitiseText(resume.contact.email),
      phone: sanitiseText(resume.contact.phone),
      location: sanitiseText(resume.contact.location),
      linkedin: resume.contact.linkedin ? sanitiseText(resume.contact.linkedin) : undefined,
      portfolio: resume.contact.portfolio ? sanitiseText(resume.contact.portfolio) : undefined,
    }),
    summary: sanitiseText(resume.summary),
    coreSkills: resume.coreSkills.map((group) => ({
      ...group,
      category: sanitiseText(group.category),
      skills: group.skills.map((skill) => ({
        name: sanitiseText(skill.name),
        sourceEvidence: sanitiseText(skill.sourceEvidence),
      })),
    })),
    experience: resume.experience.map((exp) => prune({
      ...exp,
      company: sanitiseText(exp.company),
      role: sanitiseText(exp.role),
      location: exp.location ? sanitiseText(exp.location) : undefined,
      startDate: sanitiseText(exp.startDate),
      endDate: sanitiseText(exp.endDate),
      context: exp.context ? sanitiseText(exp.context) : undefined,
      bullets: exp.bullets.map((bullet) => ({
        ...bullet,
        text: sanitiseBullet(bullet.text),
        sourceEvidence: sanitiseText(bullet.sourceEvidence),
        keywordsHit: bullet.keywordsHit.map(sanitiseText),
      })),
    })),
    projects: resume.projects?.map((project) => prune({
      ...project,
      name: sanitiseText(project.name),
      description: sanitiseText(project.description),
      stack: project.stack?.map(sanitiseText),
    })),
    education: resume.education.map((edu) => prune({
      ...edu,
      institution: sanitiseText(edu.institution),
      degree: sanitiseText(edu.degree),
      field: edu.field ? sanitiseText(edu.field) : undefined,
      endDate: sanitiseText(edu.endDate),
      score: edu.score ? sanitiseText(edu.score) : undefined,
    })),
    certifications: resume.certifications?.map((cert) => prune({
      ...cert,
      name: sanitiseText(cert.name),
      issuer: cert.issuer ? sanitiseText(cert.issuer) : undefined,
      date: cert.date ? sanitiseText(cert.date) : undefined,
    })),
    additional: resume.additional?.map((item) => ({
      label: sanitiseText(item.label),
      value: sanitiseText(item.value),
    })),
  });
}
