import { TailorResultSchema, type TailorResult } from "@/lib/schema/tailor";
import type { JDProfile } from "@/lib/schema/jd";
import type { MatchAnalysis } from "@/lib/schema/analysis";
import type { ResumeDoc } from "@/lib/schema/resume";
import type { StructuredCallOptions } from "@/lib/llm/client";
import { JSON_ONLY, NO_FABRICATION } from "./shared/constraints";
import { ATS_FORMATTING_RULES, WRITING_RULES, withTone } from "./shared/atsRules";
import { RESUME_DOC_SHAPE } from "./shared/schemaText";

/**
 * This call carries the most context of the five, which on a metered tier is
 * exactly where trimming pays. Both helpers below drop fields the *rewrite*
 * has no use for, while keeping everything the anti-fabrication rules depend
 * on — the partials with their cited evidence, and the full missing list.
 */

/** `variants` exist for keyword matching during analysis, not for writing prose. */
function compactProfile(profile: JDProfile) {
  return {
    roleTitle: profile.roleTitle,
    company: profile.company,
    seniority: profile.seniority,
    function: profile.function,
    tone: profile.tone,
    mustHaves: profile.mustHaves.map((m) => m.requirement),
    niceToHaves: profile.niceToHaves.map((n) => n.requirement),
    hardFilters: profile.hardFilters,
    atsKeywords: profile.atsKeywords.map((k) => `${k.term} (weight ${k.weight})`),
    responsibilities: profile.responsibilities,
    impliedPriorities: profile.impliedPriorities,
  };
}

/**
 * Matched keywords only need to be named — their evidence is already in the
 * resume the model is holding. Partials keep theirs, because rule 5 requires
 * the rewrite to surface them *using that citation* and nothing else.
 */
function compactAnalysis(analysis: MatchAnalysis) {
  return {
    atsScore: analysis.atsScore,
    alreadyMatched: analysis.matched.map((m) => m.term),
    partial: analysis.partial,
    missing: analysis.missing.map((m) => m.term),
    blockers: analysis.blockers,
    topThreeFixes: analysis.topThreeFixes,
  };
}

/** TAILOR_ENGINE — the core call (§5.4). */
export function tailorEnginePrompt(input: {
  jdProfile: JDProfile;
  analysis: MatchAnalysis;
  resume: ResumeDoc;
  rawResumeText: string;
}): Omit<StructuredCallOptions<TailorResult>, "userId"> {
  const system = `You are an expert resume writer who has placed candidates at top firms and
knows exactly how ATS parsers and human recruiters each read a resume.
Rewrite the candidate's resume to target this specific job description.

${NO_FABRICATION}

${withTone(WRITING_RULES, input.jdProfile.tone)}

${ATS_FORMATTING_RULES}

═══ OUTPUT ═══
${JSON_ONLY}

{
  "resume": ${RESUME_DOC_SHAPE},
  "changeLog": [
    {
      "section": string,
      "changeType": "reworded"|"reordered"|"merged"|"removed"|"surfaced"|"regrouped",
      "before": string,
      "after": string,
      "rationale": string,
      "keywordsTargeted": string[]
    }
  ],
  "projectedAtsScore": number,
  "remainingGaps": string[]
}

The changeLog is shown to the candidate as "What changed and why". Write the
rationale for them, not for a developer. Log every substantive change.`;

  const missingTerms = input.analysis.missing.map((m) => m.term);
  const partialTerms = input.analysis.partial.map((p) => p.term);

  const user = `<job_profile>
${JSON.stringify(compactProfile(input.jdProfile))}
</job_profile>

<gap_analysis>
${JSON.stringify(compactAnalysis(input.analysis))}
</gap_analysis>

<original_resume>
${JSON.stringify(input.resume)}
</original_resume>

<original_raw_text>
${input.rawResumeText}
</original_raw_text>

<forbidden_keywords>
These are the MISSING terms. They must not appear anywhere in your output resume,
in any form or variant: ${missingTerms.length ? missingTerms.join(", ") : "(none)"}
</forbidden_keywords>

<surface_these>
These are the PARTIAL terms. Surface them ONLY by rewording work the candidate
actually did, using the closestEvidence cited in the gap analysis:
${partialTerms.length ? partialTerms.join(", ") : "(none)"}
</surface_these>

Return the tailored resume JSON object.`;

  return {
    promptName: "TAILOR_ENGINE",
    system,
    user,
    schema: TailorResultSchema,
    temperature: 0.4,
    maxTokens: 3800,
    thinking: true,
  };
}
