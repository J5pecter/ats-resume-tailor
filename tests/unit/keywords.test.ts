import { describe, expect, it } from "vitest";
import { findForbiddenKeywords, resumeToSearchableText } from "@/lib/validate/keywords";
import { MatchAnalysisSchema } from "@/lib/schema/analysis";
import { SAMPLE_RESUME } from "../fixtures/resume";
import type { ResumeDoc } from "@/lib/schema/resume";

const analysis = MatchAnalysisSchema.parse({
  atsScore: 61,
  matched: [{ term: "SQL", weight: 4, evidence: "Analytics: SQL" }],
  partial: [],
  missing: [
    { term: "Kubernetes", weight: 4, honestNote: "No infrastructure experience in the source." },
    { term: "Series A fundraising", weight: 3, honestNote: "Never mentioned." },
  ],
  blockers: [],
  topThreeFixes: [],
});

describe("forbidden keyword guard", () => {
  it("passes a resume that respects the gap list", () => {
    expect(findForbiddenKeywords(SAMPLE_RESUME, analysis)).toHaveLength(0);
  });

  it("catches a gap keyword smuggled into a bullet", () => {
    const tampered: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tampered.experience[0].bullets[0].text += " Deployed services on Kubernetes.";
    expect(findForbiddenKeywords(tampered, analysis).map((h) => h.term)).toEqual(["Kubernetes"]);
  });

  it("catches a gap keyword hidden in the skills list", () => {
    const tampered: ResumeDoc = structuredClone(SAMPLE_RESUME);
    tampered.coreSkills[1].skills.push({ name: "Kubernetes", sourceEvidence: "" });
    expect(findForbiddenKeywords(tampered, analysis)).toHaveLength(1);
  });

  it("matches whole words only", () => {
    const shortTerm = MatchAnalysisSchema.parse({
      atsScore: 0,
      matched: [],
      partial: [],
      missing: [{ term: "Go", weight: 2, honestNote: "" }],
      blockers: [],
      topThreeFixes: [],
    });
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.summary = "Drove a programme of work across Google and Goldman.";
    expect(findForbiddenKeywords(doc, shortTerm)).toHaveLength(0);
  });

  it("searches the whole document, not just bullets", () => {
    const text = resumeToSearchableText(SAMPLE_RESUME);
    expect(text).toContain("Certified Scrum Product Owner");
    expect(text).toContain("University of Mumbai");
    expect(text).toContain("Languages");
  });
});

describe("stripping claims that smuggled a gap keyword", () => {
  it("removes a real bullet that had a gap keyword appended to it", async () => {
    const { stripForbiddenKeywords } = await import("@/lib/validate/keywords");
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    // The exact live failure: genuine work, genuine evidence, plus a clause the
    // evidence does not support. Both evidence checks pass on this.
    doc.experience[0].bullets[0] = {
      text: "Authored audit reports and coordinated discrepancy resolution, ensuring timely Kubernetes rollout.",
      keywordsHit: [],
      sourceEvidence: "Led redesign of digital onboarding journey",
    };

    const { resume, removed } = stripForbiddenKeywords(doc, analysis);
    expect(removed).toHaveLength(1);
    expect(removed[0].term).toBe("Kubernetes");
    expect(removed[0].kind).toBe("bullet");
    expect(findForbiddenKeywords(resume, analysis)).toHaveLength(0);
  });

  it("clears a summary that carries a gap keyword rather than dropping other content", async () => {
    const { stripForbiddenKeywords } = await import("@/lib/validate/keywords");
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.summary = "Product Manager experienced in Kubernetes and onboarding funnels.";

    const { resume, removed } = stripForbiddenKeywords(doc, analysis);
    expect(resume.summary).toBe("");
    expect(removed.some((r) => r.where === "Professional summary")).toBe(true);
    expect(resume.experience).toHaveLength(SAMPLE_RESUME.experience.length);
  });

  it("removes a skill that names a gap keyword", async () => {
    const { stripForbiddenKeywords } = await import("@/lib/validate/keywords");
    const doc: ResumeDoc = structuredClone(SAMPLE_RESUME);
    doc.coreSkills[1].skills.push({ name: "Kubernetes", sourceEvidence: "" });

    const { resume, removed } = stripForbiddenKeywords(doc, analysis);
    expect(removed.some((r) => r.kind === "skill" && r.text === "Kubernetes")).toBe(true);
    expect(findForbiddenKeywords(resume, analysis)).toHaveLength(0);
  });

  it("leaves a clean document completely untouched", async () => {
    const { stripForbiddenKeywords } = await import("@/lib/validate/keywords");
    const { resume, removed } = stripForbiddenKeywords(SAMPLE_RESUME, analysis);
    expect(removed).toHaveLength(0);
    expect(resume).toEqual(SAMPLE_RESUME);
  });
});
