import { describe, expect, it } from "vitest";
import { jdParserPrompt } from "@/lib/prompts/jdParser";
import { resumeParserPrompt } from "@/lib/prompts/resumeParser";
import { gapAnalysisPrompt } from "@/lib/prompts/gapAnalysis";
import { tailorEnginePrompt } from "@/lib/prompts/tailorEngine";
import { refineEnginePrompt } from "@/lib/prompts/refineEngine";
import { JDProfileSchema } from "@/lib/schema/jd";
import { MatchAnalysisSchema } from "@/lib/schema/analysis";
import { SAMPLE_RAW_TEXT, SAMPLE_RESUME } from "../fixtures/resume";

/**
 * Free provider tiers meter tokens per minute, and — the part that catches
 * people out — the meter is charged `prompt_tokens + max_completion_tokens`,
 * not the tokens actually generated. So an over-generous reservation fails the
 * request outright before a single token is produced.
 *
 * These bounds exist so that bloating a prompt, or reserving optimistically,
 * fails here rather than in production against a real key. Groq's free tier is
 * 8,000 TPM; the ceiling below leaves room for the provider's tokeniser to
 * disagree with our estimate.
 */
const TPM_LIMIT = 8000;
const CEILING = 7600;

/** Deliberately pessimistic, matching the estimator in the provider adapter. */
const estimateTokens = (text: string) => Math.ceil(text.length / 3.6);

const jdProfile = JDProfileSchema.parse({
  roleTitle: "Senior Product Manager — Digital Onboarding",
  company: "Kotak Neo",
  seniority: "senior",
  function: "Product Management",
  mustHaves: Array.from({ length: 8 }, (_, i) => ({
    requirement: `Requirement ${i} covering onboarding, analytics and stakeholder work`,
    category: "skill",
  })),
  niceToHaves: Array.from({ length: 4 }, (_, i) => ({
    requirement: `Nice to have ${i} in a regulated financial context`,
    category: "domain",
  })),
  hardFilters: { minYears: 5, degree: "Bachelor's", location: "Mumbai", certifications: [] },
  atsKeywords: Array.from({ length: 30 }, (_, i) => ({
    term: `keyword phrase ${i}`,
    weight: 3,
    variants: [`kw${i}`, `k-${i}`],
  })),
  responsibilities: Array.from({ length: 10 }, (_, i) => `Responsibility ${i} in reasonable detail`),
  tone: "corporate",
  impliedPriorities: ["measurable funnel improvement", "regulatory comfort"],
});

const analysis = MatchAnalysisSchema.parse({
  atsScore: 70,
  matched: Array.from({ length: 15 }, (_, i) => ({
    term: `keyword phrase ${i}`,
    weight: 4,
    evidence: "A sentence of supporting evidence quoted from the resume",
  })),
  partial: Array.from({ length: 6 }, (_, i) => ({
    term: `partial ${i}`,
    weight: 3,
    closestEvidence: "The closest supporting sentence quoted from the resume",
    howToSurface: "How this could be surfaced honestly in the rewrite",
  })),
  missing: Array.from({ length: 6 }, (_, i) => ({
    term: `missing ${i}`,
    weight: 2,
    honestNote: "No supporting evidence at all in the source resume",
  })),
  blockers: [],
  topThreeFixes: ["first fix", "second fix", "third fix"],
});

const prompts = [
  ["JD_PARSER", jdParserPrompt(SAMPLE_RAW_TEXT)],
  ["RESUME_PARSER", resumeParserPrompt(SAMPLE_RAW_TEXT)],
  ["GAP_ANALYSIS", gapAnalysisPrompt(jdProfile, SAMPLE_RESUME)],
  [
    "TAILOR_ENGINE",
    tailorEnginePrompt({
      jdProfile,
      analysis,
      resume: SAMPLE_RESUME,
      rawResumeText: SAMPLE_RAW_TEXT,
    }),
  ],
  [
    "REFINE_ENGINE",
    refineEnginePrompt({
      jdProfile,
      current: SAMPLE_RESUME,
      instruction: "Make the professional summary shorter.",
    }),
  ],
] as const;

describe("prompt token budget", () => {
  it.each(prompts.map(([name, p]) => ({ name, p })))(
    "$name fits inside a single metered window",
    ({ name, p }) => {
      const input = estimateTokens(p.system) + estimateTokens(p.user);
      const reserved = p.maxTokens ?? 4096;
      const total = input + reserved;

      expect(
        total,
        `${name} would request ${total} tokens (input ~${input} + reserved ${reserved}), over the ${TPM_LIMIT} per-minute limit`,
      ).toBeLessThanOrEqual(CEILING);
    },
  );

  it("leaves every prompt enough headroom to answer", () => {
    for (const [name, p] of prompts) {
      const reserved = p.maxTokens ?? 4096;
      // Below roughly 2k there is no room for a full ResumeDoc reply.
      expect(reserved, `${name} reserves too little to answer`).toBeGreaterThanOrEqual(2000);
    }
  });

  it("does not embed a generated JSON Schema in the parser prompt", () => {
    // The generated schema ran to thousands of tokens; the compact shape does
    // the same job in a fraction of the budget.
    const { system } = resumeParserPrompt(SAMPLE_RAW_TEXT);
    expect(system).not.toContain('"$schema"');
    expect(system).not.toContain("additionalProperties");
    expect(system).toContain("sourceEvidence");
  });
});
