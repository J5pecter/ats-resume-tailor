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

describe("tolerance to how models express emptiness", () => {
  // A local 3B model failed the whole job-description parse on exactly this:
  // it returned "certifications": null where the schema demanded []. Both mean
  // "there are none", so rejecting one of them bought nothing.
  it("accepts null for an absent array", () => {
    const profile = JDProfileSchema.parse({
      roleTitle: "Product Manager",
      seniority: "senior",
      hardFilters: { minYears: 5, degree: null, location: null, certifications: null },
      mustHaves: null,
      niceToHaves: null,
      atsKeywords: null,
      responsibilities: null,
      impliedPriorities: null,
      tone: "corporate",
    });

    expect(profile.hardFilters.certifications).toEqual([]);
    expect(profile.mustHaves).toEqual([]);
    expect(profile.atsKeywords).toEqual([]);
    expect(profile.responsibilities).toEqual([]);
  });

  it("accepts null for an unstated string", () => {
    const analysis = MatchAnalysisSchema.parse({
      atsScore: 60,
      matched: [{ term: "SQL", weight: 4, evidence: null }],
      missing: [{ term: "Kubernetes", weight: 3, honestNote: null }],
    });
    expect(analysis.matched[0].evidence).toBe("");
    expect(analysis.missing[0].honestNote).toBe("");
  });

  it("accepts null inside a resume document", () => {
    const doc = ResumeDocSchema.parse({
      ...SAMPLE_RESUME,
      summary: null,
      coreSkills: null,
      experience: [
        {
          company: "Arihant Securities",
          role: "Senior Product Manager",
          startDate: "Apr 2023",
          endDate: "Present",
          bullets: [{ text: "Led the redesign.", keywordsHit: null, sourceEvidence: null }],
        },
      ],
      education: null,
    });

    expect(doc.summary).toBe("");
    expect(doc.coreSkills).toEqual([]);
    expect(doc.education).toEqual([]);
    expect(doc.experience[0].bullets[0].keywordsHit).toEqual([]);
    expect(doc.experience[0].bullets[0].sourceEvidence).toBe("");
  });

  it("still rejects genuinely wrong shapes", () => {
    // Tolerance is about emptiness, not about accepting nonsense.
    expect(JDProfileSchema.safeParse({ roleTitle: "PM", atsKeywords: "SQL, Python" }).success).toBe(false);
    expect(ResumeDocSchema.safeParse({ ...SAMPLE_RESUME, experience: "none" }).success).toBe(false);
  });

  it("accepts null for absent optional sections", () => {
    // The local model failed the whole tailoring call on exactly this: it sent
    // "projects": null, "certifications": null, "additional": null to mean the
    // candidate has none. `.optional()` alone rejects null.
    const doc = ResumeDocSchema.parse({
      ...SAMPLE_RESUME,
      projects: null,
      certifications: null,
      additional: null,
      experience: [
        {
          company: "Arihant Securities",
          role: "Senior Product Manager",
          location: null,
          context: null,
          startDate: "Apr 2023",
          endDate: "Present",
          bullets: [{ text: "Led the redesign.", keywordsHit: [], sourceEvidence: "Led the redesign" }],
        },
      ],
    });

    expect(doc.projects).toBeUndefined();
    expect(doc.certifications).toBeUndefined();
    expect(doc.experience[0].location).toBeUndefined();
  });

  it("still enforces the constraints that matter", () => {
    // A skill group with no skills is meaningless, null or not.
    const result = ResumeDocSchema.safeParse({
      ...SAMPLE_RESUME,
      coreSkills: [{ category: "Product", skills: null }],
    });
    expect(result.success).toBe(false);
  });
});
