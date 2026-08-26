import { describe, expect, it } from "vitest";
import { checkRetention } from "@/lib/validate/retention";
import { SAMPLE_RESUME } from "../fixtures/resume";
import type { ResumeDoc } from "@/lib/schema/resume";

/**
 * Trimming for length is allowed. Trimming invisibly is not — the candidate is
 * the only one who knows whether the dropped bullet was the one that mattered.
 */
describe("retention check", () => {
  it("reports nothing dropped when the rewrite keeps everything", () => {
    const report = checkRetention(SAMPLE_RESUME, SAMPLE_RESUME);
    expect(report.dropped).toHaveLength(0);
    expect(report.substantialLoss).toBe(false);
    expect(report.keptBullets).toBe(report.originalBullets);
  });

  it("recognises a reworded bullet as the same bullet", () => {
    const tailored: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tailored.experience[0].bullets[0].text =
      "Owned the digital onboarding funnel end to end, cutting KYC drop-off 31% across 40,000 monthly applicants.";

    const report = checkRetention(SAMPLE_RESUME, tailored);
    expect(report.dropped.filter((d) => d.kind === "bullet")).toHaveLength(0);
  });

  it("catches a bullet that was silently removed", () => {
    const tailored: ResumeDoc = structuredClone(SAMPLE_RESUME);
    const removed = tailored.experience[0].bullets.pop()!;

    const report = checkRetention(SAMPLE_RESUME, tailored);
    const dropped = report.dropped.filter((d) => d.kind === "bullet");
    expect(dropped).toHaveLength(1);
    expect(dropped[0].text).toBe(removed.text);
    expect(dropped[0].where).toContain("Arihant Securities");
  });

  it("catches an entire role being cut, and its bullets with it", () => {
    const tailored: ResumeDoc = structuredClone(SAMPLE_RESUME);
    const cut = tailored.experience.pop()!;

    const report = checkRetention(SAMPLE_RESUME, tailored);
    expect(report.dropped.some((d) => d.kind === "role" && d.where === cut.company)).toBe(true);
    expect(report.dropped.filter((d) => d.kind === "bullet")).toHaveLength(cut.bullets.length);
  });

  it("recognises a skill relabelled into the posting's vocabulary", () => {
    const tailored: ResumeDoc = structuredClone(SAMPLE_RESUME);
    // "Discovery" renamed, but the same work is cited behind it.
    tailored.coreSkills[0].skills[0] = {
      name: "User research",
      sourceEvidence: "Ran weekly discovery interviews",
    };

    const report = checkRetention(SAMPLE_RESUME, tailored);
    expect(report.dropped.filter((d) => d.kind === "skill")).toHaveLength(0);
  });

  it("catches skills quietly dropped from the rewrite", () => {
    const tailored: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tailored.coreSkills = [tailored.coreSkills[0]];

    const report = checkRetention(SAMPLE_RESUME, tailored);
    const skills = report.dropped.filter((d) => d.kind === "skill");
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.map((s) => s.text)).toContain("SQL");
  });

  it("flags substantial loss, which is what earns a warning in the UI", () => {
    const tailored: ResumeDoc = structuredClone(SAMPLE_RESUME);
    // Reproduces the real failure: 10 bullets down to 6, 28 skills down to 9.
    tailored.experience[0].bullets = tailored.experience[0].bullets.slice(0, 1);
    tailored.coreSkills = [
      { ...tailored.coreSkills[0], skills: tailored.coreSkills[0].skills.slice(0, 1) },
    ];

    const report = checkRetention(SAMPLE_RESUME, tailored);
    expect(report.substantialLoss).toBe(true);
  });

  it("does not flag a rewrite that merely reorders", () => {
    const tailored: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tailored.experience[0].bullets.reverse();
    tailored.experience.reverse();

    const report = checkRetention(SAMPLE_RESUME, tailored);
    expect(report.dropped).toHaveLength(0);
    expect(report.substantialLoss).toBe(false);
  });
});
