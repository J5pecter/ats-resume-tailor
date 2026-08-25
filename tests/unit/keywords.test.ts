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
