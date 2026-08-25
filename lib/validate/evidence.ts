import type { ResumeDoc } from "@/lib/schema/resume";

/**
 * The anti-hallucination mechanism (§4).
 *
 * Every generated claim must carry the verbatim fragment of the original
 * resume it was derived from. After generation we check that fragment really
 * does appear in the source text — fuzzy-matched at >=70% token overlap, so
 * whitespace and punctuation differences don't cause false rejections, but an
 * invented claim with no basis in the source cannot slip through.
 *
 * Both experience bullets and core skills are checked. Skills need it as much
 * as bullets do: "Kubernetes" in a skills list is a claim a candidate has to
 * defend in an interview exactly like a bullet is.
 */

export const EVIDENCE_THRESHOLD = 0.7;

const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "to", "in", "for", "on", "with", "by", "at",
  "from", "as", "is", "was", "were", "be", "been", "that", "this", "it", "its",
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%+.#/-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Fraction of the evidence's meaningful tokens that appear in the source text. */
export function tokenOverlap(evidence: string, sourceTokens: Set<string>): number {
  const tokens = tokenise(evidence);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => sourceTokens.has(t)).length;
  return hits / tokens.length;
}

export type EvidenceKind = "bullet" | "skill";

export interface EvidenceFailure {
  kind: EvidenceKind;
  /** Machine path into the document, used to strip the failing item. */
  path: string;
  /** Where the user should look: a role, or a skills category. */
  where: string;
  /** The claim itself — the bullet's text, or the skill's name. */
  text: string;
  sourceEvidence: string;
  overlap: number;
  reason: "empty" | "unsupported";
}

export interface EvidenceCheckResult {
  passed: boolean;
  failures: EvidenceFailure[];
  /** Total claims examined, across bullets and skills. */
  checked: number;
  checkedBullets: number;
  checkedSkills: number;
}

/**
 * A skill name that appears in the source verbatim needs no further proof.
 * Whole-word so "R" does not match "Roadmap" and "Go" does not match "Google".
 */
function nameAppearsInSource(name: string, rawSourceText: string): boolean {
  const cleaned = name.trim();
  if (cleaned.length < 2) return false;
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(rawSourceText);
}

export function checkEvidence(resume: ResumeDoc, rawSourceText: string): EvidenceCheckResult {
  const sourceTokens = new Set(tokenise(rawSourceText));
  const failures: EvidenceFailure[] = [];
  let checkedBullets = 0;
  let checkedSkills = 0;

  resume.experience.forEach((exp, ei) => {
    exp.bullets.forEach((bullet, bi) => {
      checkedBullets++;
      const path = `experience[${ei}].bullets[${bi}]`;
      const where = [exp.company, exp.role].filter(Boolean).join(" — ");
      const evidence = bullet.sourceEvidence?.trim() ?? "";

      if (evidence.length === 0) {
        failures.push({
          kind: "bullet",
          path,
          where,
          text: bullet.text,
          sourceEvidence: "",
          overlap: 0,
          reason: "empty",
        });
        return;
      }

      const overlap = tokenOverlap(evidence, sourceTokens);
      if (overlap < EVIDENCE_THRESHOLD) {
        failures.push({
          kind: "bullet",
          path,
          where,
          text: bullet.text,
          sourceEvidence: evidence,
          overlap,
          reason: "unsupported",
        });
      }
    });
  });

  resume.coreSkills.forEach((group, gi) => {
    group.skills.forEach((skill, si) => {
      checkedSkills++;
      const path = `coreSkills[${gi}].skills[${si}]`;
      const where = `Core skills · ${group.category}`;

      // Route one: the skill is named in the source resume, verbatim. Nothing
      // was invented and nothing was relabelled, so the claim stands on its own.
      if (nameAppearsInSource(skill.name, rawSourceText)) return;

      // Route two: the skill was relabelled into the job description's
      // vocabulary, which is permitted — but only if the underlying work is
      // cited and that citation traces back to the source.
      const evidence = skill.sourceEvidence?.trim() ?? "";
      if (evidence.length === 0) {
        failures.push({
          kind: "skill",
          path,
          where,
          text: skill.name,
          sourceEvidence: "",
          overlap: 0,
          reason: "empty",
        });
        return;
      }

      const overlap = tokenOverlap(evidence, sourceTokens);
      if (overlap < EVIDENCE_THRESHOLD) {
        failures.push({
          kind: "skill",
          path,
          where,
          text: skill.name,
          sourceEvidence: evidence,
          overlap,
          reason: "unsupported",
        });
      }
    });
  });

  return {
    passed: failures.length === 0,
    failures,
    checked: checkedBullets + checkedSkills,
    checkedBullets,
    checkedSkills,
  };
}

/**
 * Drop what failed, keeping roles and skill groups that still have content.
 * Empty groups are removed rather than left as a bare heading.
 */
export function stripUnsupported(resume: ResumeDoc, failures: EvidenceFailure[]): ResumeDoc {
  if (failures.length === 0) return resume;
  const failed = new Set(failures.map((f) => f.path));

  return {
    ...resume,
    coreSkills: resume.coreSkills
      .map((group, gi) => ({
        ...group,
        skills: group.skills.filter((_, si) => !failed.has(`coreSkills[${gi}].skills[${si}]`)),
      }))
      .filter((group) => group.skills.length > 0),
    experience: resume.experience
      .map((exp, ei) => ({
        ...exp,
        bullets: exp.bullets.filter(
          (_, bi) => !failed.has(`experience[${ei}].bullets[${bi}]`),
        ),
      }))
      .filter((exp) => exp.bullets.length > 0),
  };
}
