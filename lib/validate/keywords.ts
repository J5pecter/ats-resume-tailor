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

/**
 * Removes the claims that smuggled a gap keyword in.
 *
 * The evidence check cannot catch this on its own. A model can take a real
 * bullet with real evidence and append a clause the evidence does not support
 * — "coordinated discrepancy resolution" becoming "...ensuring timely
 * corrective actions" — and every traceability test still passes, because the
 * bullet genuinely is derived from that work. What fails is the narrower claim
 * bolted onto the end.
 *
 * Since the offending text cannot be excised from a sentence safely, the whole
 * item goes. Losing a real bullet is the lesser harm: a gap keyword the
 * candidate cannot defend is the thing that ends an interview.
 */
export function stripForbiddenKeywords(
  resume: ResumeDoc,
  analysis: MatchAnalysis,
): { resume: ResumeDoc; removed: { kind: "bullet" | "skill"; where: string; text: string; term: string }[] } {
  const terms = analysis.missing.map((m) => m.term);
  const removed: { kind: "bullet" | "skill"; where: string; text: string; term: string }[] = [];

  const offendingTerm = (text: string) => terms.find((t) => containsTerm(text, t));

  const experience = resume.experience
    .map((exp) => ({
      ...exp,
      bullets: exp.bullets.filter((b) => {
        const term = offendingTerm(b.text);
        if (!term) return true;
        removed.push({
          kind: "bullet",
          where: [exp.company, exp.role].filter(Boolean).join(" — "),
          text: b.text,
          term,
        });
        return false;
      }),
    }))
    .filter((exp) => exp.bullets.length > 0);

  const coreSkills = resume.coreSkills
    .map((group) => ({
      ...group,
      skills: group.skills.filter((s) => {
        const term = offendingTerm(s.name);
        if (!term) return true;
        removed.push({ kind: "skill", where: group.category, text: s.name, term });
        return false;
      }),
    }))
    .filter((group) => group.skills.length > 0);

  // The summary is one field, so a gap keyword there is edited out by clearing
  // it rather than dropping content the candidate can still use elsewhere.
  const summaryTerm = offendingTerm(resume.summary);
  const summary = summaryTerm ? "" : resume.summary;
  if (summaryTerm) {
    removed.push({ kind: "bullet", where: "Professional summary", text: resume.summary, term: summaryTerm });
  }

  return { resume: { ...resume, summary, experience, coreSkills }, removed };
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
