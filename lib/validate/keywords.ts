import type { ResumeDoc } from "@/lib/schema/resume";
import type { MatchAnalysis } from "@/lib/schema/analysis";

/**
 * Guard for §5.4 rule 4: keywords from the MISSING list are honest gaps and
 * must never appear in the generated resume. Checked against the rendered
 * text of the whole document, not just the bullets.
 */

export function resumeToSearchableText(resume: ResumeDoc): string {
  const parts: string[] = [
    resume.contact.headline,
    resume.summary,
    ...resume.coreSkills.flatMap((g) => [g.category, ...g.skills.map((s) => s.name)]),
    ...resume.experience.flatMap((e) => [
      e.role,
      e.company,
      e.context ?? "",
      ...e.bullets.map((b) => b.text),
    ]),
    ...(resume.projects ?? []).flatMap((p) => [p.name, p.description, ...(p.stack ?? [])]),
    ...resume.education.flatMap((e) => [e.institution, e.degree, e.field ?? ""]),
    ...(resume.certifications ?? []).map((c) => c.name),
    ...(resume.additional ?? []).flatMap((a) => [a.label, a.value]),
  ];
  return parts.filter(Boolean).join("\n");
}

export interface ForbiddenHit {
  term: string;
  where: string;
}

/** Whole-word, case-insensitive match so "R" doesn't fire on "Reduced". */
function containsTerm(haystack: string, term: string): boolean {
  const cleaned = term.trim();
  if (cleaned.length < 2) return false;
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(haystack);
}

export function findForbiddenKeywords(
  resume: ResumeDoc,
  analysis: MatchAnalysis,
): ForbiddenHit[] {
  const text = resumeToSearchableText(resume);
  const hits: ForbiddenHit[] = [];

  for (const miss of analysis.missing) {
    if (containsTerm(text, miss.term)) {
      hits.push({ term: miss.term, where: "tailored resume" });
    }
  }
  return hits;
}
