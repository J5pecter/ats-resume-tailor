import { describe, expect, it } from "vitest";
import {
  gapAnalysisPrompt,
  jdParserPrompt,
  refineEnginePrompt,
  resumeParserPrompt,
  tailorEnginePrompt,
} from "@/lib/prompts";
import { NO_FABRICATION, JSON_ONLY } from "@/lib/prompts/shared/constraints";
import { WRITING_RULES, ATS_FORMATTING_RULES, withTone } from "@/lib/prompts/shared/atsRules";
import { SAMPLE_RESUME } from "../fixtures/resume";
import type { JDProfile } from "@/lib/schema/jd";
import type { MatchAnalysis } from "@/lib/schema/analysis";

/**
 * The prompts are the main lever on output quality and had no tests at all, so
 * an edit to a shared fragment broke silently until a live run looked odd.
 *
 * These do not judge prose. They pin the load-bearing parts: that the rules
 * every generative prompt depends on are actually present, that the tone
 * placeholder gets substituted rather than shipped, and that the gap keywords
 * the model must not use are named in the prompt that must not use them.
 */

const JD: JDProfile = {
  roleTitle: "Senior Product Manager",
  company: "Kotak Neo",
  seniority: "senior",
  function: "Product",
  mustHaves: [{ requirement: "5+ years product management", category: "experience" }],
  niceToHaves: [{ requirement: "payments", category: "domain" }],
  hardFilters: { minYears: 5, degree: null, location: null, certifications: [] },
  atsKeywords: ["KYC", "onboarding", "SQL"],
  tone: "crisp and metric-led",
} as unknown as JDProfile;

const ANALYSIS: MatchAnalysis = {
  atsScore: 61,
  matched: [{ term: "SQL", where: "skills" }],
  partial: [{ term: "onboarding", where: "experience", note: "adjacent" }],
  missing: [
    { term: "corrective actions", importance: "high" },
    { term: "CIA", importance: "high" },
  ],
  recommendations: ["Surface the KYC funnel work"],
} as unknown as MatchAnalysis;

describe("shared prompt fragments", () => {
  it("states the anti-fabrication rule the whole app rests on", () => {
    expect(NO_FABRICATION).toMatch(/sourceEvidence/);
    // Added after a model cited the employer header line as evidence for every
    // bullet. If this sentence goes, that bug comes back.
    expect(NO_FABRICATION).toMatch(/company name|job title|date line/i);
  });

  it("asks for JSON with no wrapper, because the parser is not a chat client", () => {
    expect(JSON_ONLY).toMatch(/single JSON object/i);
    expect(JSON_ONLY).toMatch(/no markdown fences|no commentary/i);
  });

  it("keeps the skills rule that stops a real skill being silently dropped", () => {
    // Rule 10 was rewritten after the model read the 5-category cap as a cap on
    // the number of skills and threw away two thirds of them.
    expect(WRITING_RULES).toMatch(/CARRY OVER EVERY SKILL/);
    expect(WRITING_RULES).toMatch(/limits GROUPS, never how many/);
  });

  it("keeps the bullet-retention rule that stops over-trimming", () => {
    // Rule 13 was rewritten after a 10-bullet resume came back with 6.
    expect(WRITING_RULES).toMatch(/KEEP EVERY BULLET/);
    expect(WRITING_RULES).toMatch(/18-20 bullets/);
  });

  it("forbids rounding a metric, which is fabrication wearing a suit", () => {
    expect(WRITING_RULES).toMatch(/Preserve every original metric exactly/);
    expect(WRITING_RULES).toMatch(/Do not round, inflate, or estimate/);
  });

  it("substitutes the tone placeholder rather than shipping it", () => {
    const applied = withTone(WRITING_RULES, "crisp and metric-led");
    expect(applied).toContain("crisp and metric-led");
    expect(applied).not.toContain("{{TONE}}");
  });

  it("leaves nothing unsubstituted when the tone is empty", () => {
    expect(withTone(WRITING_RULES, "")).not.toContain("{{TONE}}");
  });

  it("carries the ATS formatting rules that keep a parser able to read the file", () => {
    expect(ATS_FORMATTING_RULES).toMatch(/ATS FORMATTING RULES/);
  });
});

describe("prompt builders", () => {
  it("every builder returns a system prompt, a user turn and a name", () => {
    const built = [
      resumeParserPrompt("Some resume text long enough to be plausible."),
      jdParserPrompt("Some job description text long enough to be plausible."),
      gapAnalysisPrompt(JD, SAMPLE_RESUME),
      tailorEnginePrompt({
        jdProfile: JD,
        analysis: ANALYSIS,
        resume: SAMPLE_RESUME,
        rawResumeText: "raw text",
      }),
      refineEnginePrompt({
        jdProfile: JD,
        current: SAMPLE_RESUME,
        instruction: "Make the summary shorter.",
      }),
    ];

    for (const p of built) {
      expect(p.promptName, JSON.stringify(p).slice(0, 80)).toBeTruthy();
      expect(p.system.length).toBeGreaterThan(200);
      expect(p.user.length).toBeGreaterThan(10);
      expect(p.schema).toBeTruthy();
      // A stray placeholder means a fragment was composed without substitution.
      expect(p.system).not.toContain("{{");
      expect(p.user).not.toContain("{{");
    }
  });

  it("names the forbidden keywords inside the prompt that must not use them", () => {
    // The gap analysis decides what is missing; the tailor prompt is the one
    // that must not write it. If the terms never reach the prompt, the model is
    // guessing and the keyword stripper is the only thing standing between the
    // candidate and a claim they cannot defend.
    const p = tailorEnginePrompt({
      jdProfile: JD,
      analysis: ANALYSIS,
      resume: SAMPLE_RESUME,
      rawResumeText: "raw text",
    });
    const whole = `${p.system}\n${p.user}`;
    expect(whole).toContain("corrective actions");
    expect(whole).toContain("CIA");
  });

  it("passes the candidate's own words to the tailor, not just the parse", () => {
    // Evidence is traced against the raw text, so the model has to see it.
    // Citing from the parse alone drifts from what the guard will accept.
    const raw = "Ran weekly discovery interviews with 60 relationship managers";
    const p = tailorEnginePrompt({
      jdProfile: JD,
      analysis: ANALYSIS,
      resume: SAMPLE_RESUME,
      rawResumeText: raw,
    });
    expect(`${p.system}\n${p.user}`).toContain(raw);
  });

  it("puts the user's instruction in the refine prompt verbatim", () => {
    const instruction = "Drop the second bullet at Paylane and lengthen the summary.";
    const p = refineEnginePrompt({ jdProfile: JD, current: SAMPLE_RESUME, instruction });
    expect(`${p.system}\n${p.user}`).toContain(instruction);
  });

  it("holds the no-fabrication rule in every generative prompt", () => {
    const generative = [
      tailorEnginePrompt({
        jdProfile: JD,
        analysis: ANALYSIS,
        resume: SAMPLE_RESUME,
        rawResumeText: "raw",
      }),
      refineEnginePrompt({ jdProfile: JD, current: SAMPLE_RESUME, instruction: "shorter" }),
    ];
    for (const p of generative) {
      expect(p.system, p.promptName).toMatch(/sourceEvidence/);
    }
  });
});
