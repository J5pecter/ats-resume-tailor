import { describe, expect, it } from "vitest";
import {
  findForbiddenKeywords,
  resumeToSearchableText,
  stripForbiddenKeywords,
} from "@/lib/validate/keywords";
import { MatchAnalysisSchema, type MatchAnalysis } from "@/lib/schema/analysis";
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

/**
 * The MISSING list comes from a model, and the evaluation corpus caught it
 * being wrong: an electrician whose resume reads "City and Guilds 2382 18th
 * Edition, 2019" had "18th Edition" reported as a gap. Enforced literally,
 * rule 4 would delete a real qualification off the candidate's own resume.
 */
describe("a gap the candidate does not actually have", () => {
  const ANALYSIS = {
    atsScore: 50,
    matched: [],
    partial: [],
    missing: [
      { term: "18th Edition", importance: "high" },
      { term: "PLC fault-finding", importance: "high" },
    ],
    recommendations: [],
  } as unknown as MatchAnalysis;

  const SOURCE = `Wayne Prosser
QUALIFICATIONS
City and Guilds 2382 18th Edition, 2019
NVQ Level 3 Electrical Installation, 2018`;

  function resumeWith(skill: string, cert: string): ResumeDoc {
    const base = structuredClone(SAMPLE_RESUME);
    base.coreSkills[0].skills.push({ name: skill, sourceEvidence: "City and Guilds 2382" });
    base.certifications = [{ name: cert, issuer: "City and Guilds", date: "2019" }];
    return base;
  }

  it("does not strip a term printed on the candidate's own resume", () => {
    const doc = resumeWith("18th Edition", "City and Guilds 2382 18th Edition");
    const { resume, removed } = stripForbiddenKeywords(doc, ANALYSIS, SOURCE);

    expect(removed).toHaveLength(0);
    expect(resume.coreSkills.flatMap((g) => g.skills.map((s) => s.name))).toContain("18th Edition");
    expect(resume.certifications?.map((c) => c.name)).toContain(
      "City and Guilds 2382 18th Edition",
    );
  });

  it("does not report it as a violation either, so the two agree", () => {
    const doc = resumeWith("18th Edition", "City and Guilds 2382 18th Edition");
    expect(findForbiddenKeywords(doc, ANALYSIS, SOURCE)).toHaveLength(0);
  });

  it("still strips a term that is genuinely absent from the source", () => {
    const doc = resumeWith("PLC fault-finding", "PLC Programming Level 2");
    const { resume, removed } = stripForbiddenKeywords(doc, ANALYSIS, SOURCE);

    expect(removed.map((r) => r.term)).toContain("PLC fault-finding");
    expect(resume.coreSkills.flatMap((g) => g.skills.map((s) => s.name))).not.toContain(
      "PLC fault-finding",
    );
  });

  it("strips an invented certification, which used to be unreachable", () => {
    // Certifications were searched by the finder but not by the stripper, so a
    // hit there was reported on every check and could never be acted on.
    const doc = resumeWith("Fault finding", "PLC fault-finding Level 3");
    const { resume, removed } = stripForbiddenKeywords(doc, ANALYSIS, SOURCE);

    expect(removed.map((r) => r.kind)).toContain("certification");
    expect(resume.certifications ?? []).toHaveLength(0);
    expect(findForbiddenKeywords(resume, ANALYSIS, SOURCE)).toHaveLength(0);
  });

  it("enforces every term when no source text is given", () => {
    // The conservative direction: without the source nothing can be exempted,
    // so behaviour matches what it was before the exemption existed.
    const doc = resumeWith("18th Edition", "City and Guilds 2382 18th Edition");
    const { removed } = stripForbiddenKeywords(doc, ANALYSIS);
    expect(removed.length).toBeGreaterThan(0);
  });
});
