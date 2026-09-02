import { MatchAnalysisSchema, type MatchAnalysis } from "@/lib/schema/analysis";
import type { JDProfile } from "@/lib/schema/jd";
import type { ResumeDoc } from "@/lib/schema/resume";
import type { StructuredCallOptions } from "@/lib/llm/client";
import { JSON_ONLY } from "./shared/constraints";

/** GAP_ANALYSIS — ResumeDoc + JDProfile -> MatchAnalysis (§5.3). */
export function gapAnalysisPrompt(
  jdProfile: JDProfile,
  resume: ResumeDoc,
  /**
   * The candidate's own text, when the caller has it.
   *
   * The parse is lossy and this matters more than it sounds. An electrician
   * whose resume listed "City and Guilds 2382 18th Edition, 2019" under a
   * QUALIFICATIONS heading had it dropped by the parser entirely, so the
   * analysis — judging only the parse — reported the qualification as a gap
   * the candidate did not have. Every downstream guard then treated a real
   * credential as a forbidden keyword.
   *
   * Reading the source as well makes a parser slip cost a tidy field rather
   * than a false accusation. The same reasoning already puts rawResumeText in
   * front of the tailor and the evidence checker.
   */
  rawResumeText?: string,
): Omit<StructuredCallOptions<MatchAnalysis>, "userId"> {
  const system = `You are an ATS screening simulator. Compare the candidate profile against
the job requirements. Be blunt. Optimism here costs the candidate interviews.

RULES
1. A keyword counts as MATCHED only if the resume demonstrates it, not merely
   mentions it adjacently. Judge substance.
2. PARTIAL = adjacent or transferable experience exists but the exact term
   does not appear. These are the highest-value fixes — flag them clearly.
3. MISSING = no supporting evidence at all. Never suggest adding these.
   Before you put a term in missing, search the candidate's ORIGINAL TEXT for
   it, not just the structured profile. The structured profile is a parse and
   parses lose things — credentials filed under unusual headings go astray most
   often. If the term appears anywhere in the original text, it is MATCHED or
   PARTIAL, never MISSING. Calling something a gap the candidate demonstrably
   has is the worst error you can make here: it tells them to explain away a
   qualification they hold.
4. For each PARTIAL, cite the exact resume text that could legitimately carry
   the keyword, in closestEvidence. Quote it verbatim from the resume.
5. atsScore = weighted coverage: sum(weight of matched) + 0.5 *
   sum(weight of partial), divided by sum(all weights), as 0-100.
6. blockers = hard filters the candidate demonstrably fails.
7. Every term in the job profile's atsKeywords must appear in exactly one of
   matched, partial, or missing. Do not drop any.

${JSON_ONLY}

Shape:
{
  "atsScore": number,
  "matched":  [{"term": string, "weight": number, "evidence": string}],
  "partial":  [{"term": string, "weight": number, "closestEvidence": string, "howToSurface": string}],
  "missing":  [{"term": string, "weight": number, "honestNote": string}],
  "blockers": [{"filter": string, "candidateStatus": string}],
  "topThreeFixes": string[]
}`;

  const original = rawResumeText?.trim()
    ? `

<candidate_original_text>
${rawResumeText.trim()}
</candidate_original_text>`
    : "";

  const user = `<job_profile>
${JSON.stringify(jdProfile)}
</job_profile>

<candidate_resume>
${JSON.stringify(resume)}
</candidate_resume>${original}

Return the MatchAnalysis JSON object.`;

  return {
    promptName: "GAP_ANALYSIS",
    system,
    user,
    schema: MatchAnalysisSchema,
    temperature: 0.2,
    maxTokens: 3000,
    thinking: true,
  };
}
