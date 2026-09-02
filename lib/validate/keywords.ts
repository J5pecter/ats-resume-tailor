import type { ResumeDoc } from "@/lib/schema/resume";
import type { MatchAnalysis } from "@/lib/schema/analysis";

/**
 * Guard for §5.4 rule 4: keywords from the MISSING list are honest gaps and
 * must never appear in the generated resume. Checked against the rendered
 * text of the whole document, not just the bullets.
 *
 * With one exemption, which matters more than the rule it qualifies.
 *
 * The MISSING list is produced by a model, and a model can be wrong about it.
 * The evaluation corpus caught exactly that: an electrician whose resume reads
 * "City and Guilds 2382 18th Edition, 2019" had "18th Edition" listed as a
 * gap. Applied literally, rule 4 would then delete a real, verbatim-evidenced
 * qualification from the candidate's own resume — the precise opposite of what
 * this app exists to do.
 *
 * So a term that appears in the source resume is not a gap, whatever the
 * analysis said; it is an analysis error. This is the same dual rule
 * SkillSchema already uses — name-appears-verbatim OR evidence-traces —
 * applied where it was missing.
 *
 * Rule 4 protects the candidate from claims they cannot defend. A credential
 * printed on their own resume is one they can.
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

export interface ForbiddenRemoval {
  kind: "bullet" | "skill" | "certification" | "project" | "additional";
  where: string;
  text: string;
  term: string;
}

/** Whole-word, case-insensitive match so "R" doesn't fire on "Reduced". */
function containsTerm(haystack: string, term: string): boolean {
  const cleaned = term.trim();
  if (cleaned.length < 2) return false;
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(haystack);
}

/**
 * The gap terms actually worth enforcing: those the candidate cannot support.
 *
 * Without the source text nothing can be exempted, so every term stands. That
 * is the conservative direction — it can over-strip, never under-strip — and it
 * keeps existing callers behaving exactly as they did.
 */
function enforceableTerms(analysis: MatchAnalysis, rawSourceText?: string): string[] {
  const terms = analysis.missing.map((m) => m.term);
  if (!rawSourceText) return terms;
  return terms.filter((t) => !containsTerm(rawSourceText, t));
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
  rawSourceText?: string,
): { resume: ResumeDoc; removed: ForbiddenRemoval[] } {
  const terms = enforceableTerms(analysis, rawSourceText);
  const removed: ForbiddenRemoval[] = [];

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

  // Certifications used to be searched but not strippable, so a hit there was
  // reported on every check and could never be acted on — a guard that can see
  // a problem and not fix it. With the source exemption above, a term reaching
  // here is absent from the candidate's own resume, which makes an invented
  // credential the single most dangerous thing in the document.
  const certifications = resume.certifications?.filter((cert) => {
    const term = offendingTerm([cert.name, cert.issuer ?? ""].join(" "));
    if (!term) return true;
    removed.push({ kind: "certification", where: "Certifications", text: cert.name, term });
    return false;
  });

  const additional = resume.additional?.filter((item) => {
    const term = offendingTerm(`${item.label} ${item.value}`);
    if (!term) return true;
    removed.push({ kind: "additional", where: item.label, text: item.value, term });
    return false;
  });

  const projects = resume.projects?.filter((project) => {
    const term = offendingTerm(
      [project.name, project.description, ...(project.stack ?? [])].join(" "),
    );
    if (!term) return true;
    removed.push({ kind: "project", where: "Projects", text: project.name, term });
    return false;
  });

  return {
    resume: { ...resume, summary, experience, coreSkills, certifications, additional, projects },
    removed,
  };
}

export function findForbiddenKeywords(
  resume: ResumeDoc,
  analysis: MatchAnalysis,
  rawSourceText?: string,
): ForbiddenHit[] {
  const text = resumeToSearchableText(resume);
  const hits: ForbiddenHit[] = [];

  // Same exemption as the stripper. If these two disagreed about what counts,
  // the finder would report hits the stripper had deliberately left alone.
  for (const term of enforceableTerms(analysis, rawSourceText)) {
    if (containsTerm(text, term)) {
      hits.push({ term, where: "tailored resume" });
    }
  }
  return hits;
}
