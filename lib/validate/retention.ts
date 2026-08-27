import type { ResumeDoc } from "@/lib/schema/resume";
import { relatedness } from "./evidence";

/**
 * Reports what the rewrite left behind.
 *
 * Tailoring is allowed to drop content — a two-page budget sometimes forces it.
 * What it is not allowed to do is drop content *silently*. A candidate who
 * cannot see that four of their ten bullets vanished has no way to put them
 * back, and the omission reads to them as the tool's judgement rather than an
 * accident.
 *
 * Matching is by substance, not by text: a tailored bullet is a rewrite of an
 * original, so they are linked through the evidence the rewrite cites. An
 * original with no descendant anywhere in the output was dropped.
 */

/** Low bar — this asks "is this the same underlying item", not "is it worded the same". */
const SAME_ITEM_THRESHOLD = 0.3;

export interface DroppedItem {
  kind: "bullet" | "skill" | "role";
  where: string;
  text: string;
}

export interface RetentionReport {
  dropped: DroppedItem[];
  originalBullets: number;
  originalSkills: number;
  /**
   * How many of the originals survived — `originalBullets - dropped bullets`,
   * and the same for skills.
   *
   * Deliberately not the size of the tailored document, which is a different
   * quantity and was what these once held. Tailoring is allowed to consolidate:
   * "Financial Modeling" and "DCF Valuation" can legitimately merge into one
   * "Valuation & Modelling" entry that cites both. Counting the output made
   * that read as two skills lost, so a clean rewrite reported "21 of 28 skills
   * kept" while naming only four as dropped, and the 25% "substantial loss"
   * warning fired on a document that had lost nothing.
   */
  keptBullets: number;
  keptSkills: number;
  /** True when a meaningful share of the source did not survive. */
  substantialLoss: boolean;
}

function survives(originalText: string, candidates: string[]): boolean {
  return candidates.some((c) => relatedness(originalText, c) >= SAME_ITEM_THRESHOLD);
}

export function checkRetention(original: ResumeDoc, tailored: ResumeDoc): RetentionReport {
  const dropped: DroppedItem[] = [];

  // Every string in the output a bullet could have become: its own text, and
  // the evidence it cites (which quotes the original it was derived from).
  const tailoredBulletTraces = tailored.experience.flatMap((exp) =>
    exp.bullets.flatMap((b) => [b.text, b.sourceEvidence]),
  );
  const tailoredCompanies = new Set(
    tailored.experience.map((e) => e.company.trim().toLowerCase()),
  );

  let originalBullets = 0;
  for (const exp of original.experience) {
    const roleKept = tailoredCompanies.has(exp.company.trim().toLowerCase());
    if (!roleKept) {
      dropped.push({
        kind: "role",
        where: exp.company,
        text: [exp.role, exp.company].filter(Boolean).join(" at "),
      });
    }

    for (const bullet of exp.bullets) {
      originalBullets++;
      if (!roleKept || !survives(bullet.text, tailoredBulletTraces)) {
        dropped.push({
          kind: "bullet",
          where: [exp.company, exp.role].filter(Boolean).join(" — "),
          text: bullet.text,
        });
      }
    }
  }

  const tailoredSkillTraces = tailored.coreSkills.flatMap((g) =>
    g.skills.flatMap((s) => [s.name, s.sourceEvidence]),
  );
  const tailoredSkillNames = new Set(
    tailored.coreSkills.flatMap((g) => g.skills.map((s) => s.name.trim().toLowerCase())),
  );

  let originalSkills = 0;
  for (const group of original.coreSkills) {
    for (const skill of group.skills) {
      originalSkills++;
      const name = skill.name.trim().toLowerCase();
      // A skill survives by name, or by having been relabelled into the JD's
      // vocabulary with the same work behind it.
      if (!tailoredSkillNames.has(name) && !survives(skill.name, tailoredSkillTraces)) {
        dropped.push({ kind: "skill", where: group.category, text: skill.name });
      }
    }
  }

  // Counted from what was actually lost, so the figure and the list below it
  // can never disagree. `dropped` is the authority; these are derived from it.
  const droppedBullets = dropped.filter((d) => d.kind === "bullet").length;
  const droppedSkills = dropped.filter((d) => d.kind === "skill").length;
  const keptBullets = originalBullets - droppedBullets;
  const keptSkills = originalSkills - droppedSkills;

  // A short resume has no page pressure, so any loss there is suspect. The
  // thresholds are loose: this flags a document worth a second look, it does
  // not reject anything.
  const bulletLoss = originalBullets > 0 ? droppedBullets / originalBullets : 0;
  const skillLoss = originalSkills > 0 ? droppedSkills / originalSkills : 0;

  return {
    dropped,
    originalBullets,
    originalSkills,
    keptBullets,
    keptSkills,
    substantialLoss: bulletLoss > 0.25 || skillLoss > 0.25,
  };
}
