import { describe, expect, it } from "vitest";
import { ResumeDocSchema } from "@/lib/schema/resume";
import { JDProfileSchema } from "@/lib/schema/jd";
import { MatchAnalysisSchema } from "@/lib/schema/analysis";
import { SAMPLE_RESUME } from "../fixtures/resume";

describe("schema tolerance", () => {
  it("round-trips the sample resume unchanged", () => {
    expect(ResumeDocSchema.parse(SAMPLE_RESUME)).toEqual(SAMPLE_RESUME);
  });

  it("rejects a resume with no name", () => {
    const broken = structuredClone(SAMPLE_RESUME) as { contact: { fullName: string } };
    broken.contact.fullName = "";
    expect(ResumeDocSchema.safeParse(broken).success).toBe(false);
  });

  it("accepts a missing email rather than failing the whole parse", () => {
    const result = ResumeDocSchema.safeParse({
      ...SAMPLE_RESUME,
      contact: { ...SAMPLE_RESUME.contact, email: "" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = ResumeDocSchema.safeParse({
      ...SAMPLE_RESUME,
      contact: { ...SAMPLE_RESUME.contact, email: "not-an-email" },
    });
    expect(result.success).toBe(false);
  });

  it("coerces a stringified keyword weight and clamps an unknown seniority", () => {
    const profile = JDProfileSchema.parse({
      roleTitle: "Product Manager",
      company: null,
      seniority: "principal",
      function: "Product",
      mustHaves: [],
      niceToHaves: [],
      hardFilters: { minYears: "5", degree: null, location: null, certifications: [] },
      atsKeywords: [{ term: "SQL", weight: "4", variants: [] }],
      responsibilities: [],
      tone: "corporate",
      impliedPriorities: [],
    });

    expect(profile.atsKeywords[0].weight).toBe(4);
    expect(profile.hardFilters.minYears).toBe(5);
    expect(profile.seniority).toBe("mid");
  });

  it("fills in the optional halves of an analysis", () => {
    const analysis = MatchAnalysisSchema.parse({ atsScore: 42 });
    expect(analysis.matched).toEqual([]);
    expect(analysis.missing).toEqual([]);
    expect(analysis.topThreeFixes).toEqual([]);
  });

  it("rejects an out-of-range ATS score", () => {
    expect(MatchAnalysisSchema.safeParse({ atsScore: 140 }).success).toBe(false);
  });

  it("upgrades a plain-string skill list to the evidence-carrying shape", () => {
    // Documents saved before skills carried evidence, and models that emit the
    // older shape, must still parse rather than failing the whole generation.
    const parsed = ResumeDocSchema.parse({
      ...SAMPLE_RESUME,
      coreSkills: [{ category: "Analytics", skills: ["SQL", "Mixpanel"] }],
    });

    expect(parsed.coreSkills[0].skills).toEqual([
      { name: "SQL", sourceEvidence: "" },
      { name: "Mixpanel", sourceEvidence: "" },
    ]);
  });

  it("accepts a mixed list of strings and objects", () => {
    const parsed = ResumeDocSchema.parse({
      ...SAMPLE_RESUME,
      coreSkills: [
        {
          category: "Product",
          skills: ["Discovery", { name: "Experimentation", sourceEvidence: "Ran A/B tests" }],
        },
      ],
    });

    expect(parsed.coreSkills[0].skills.map((s) => s.name)).toEqual([
      "Discovery",
      "Experimentation",
    ]);
    expect(parsed.coreSkills[0].skills[1].sourceEvidence).toBe("Ran A/B tests");
  });

  it("rejects a nameless skill", () => {
    const result = ResumeDocSchema.safeParse({
      ...SAMPLE_RESUME,
      coreSkills: [{ category: "Product", skills: [{ name: "", sourceEvidence: "x" }] }],
    });
    expect(result.success).toBe(false);
  });
});
