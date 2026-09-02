import "server-only";

import { callStructured } from "@/lib/llm/client";
import { tailorEnginePrompt } from "@/lib/prompts";
import type { MatchAnalysis } from "@/lib/schema/analysis";
import type { JDProfile } from "@/lib/schema/jd";
import { ResumeDocSchema, type ResumeDoc } from "@/lib/schema/resume";
import type { ChangeLogEntry } from "@/lib/schema/tailor";
import { checkEvidence, stripUnsupported, type EvidenceCheckResult } from "@/lib/validate/evidence";
import {
  findForbiddenKeywords,
  stripForbiddenKeywords,
  type ForbiddenHit,
} from "@/lib/validate/keywords";
import { checkRetention, type RetentionReport } from "@/lib/validate/retention";
import { sanitiseResumeDoc } from "@/lib/validate/sanitize";

/**
 * Generate a tailored resume and put it through every guard, once.
 *
 * This lives apart from the route because two callers need it: the route, which
 * persists the result, and the evaluation harness, which scores it. A harness
 * that reimplemented the sequence would measure its own copy rather than the
 * code that runs in production — the same drift the shared export block model
 * exists to prevent, and worse here, because the drift would be invisible and
 * would flatter whichever copy was newer.
 *
 * Order is load-bearing and is the reason this is a function rather than a
 * list of steps repeated by hand:
 *
 *   1. sanitise  — before anything measures token overlap. A non-breaking
 *                  hyphen in "drop-off" splits the token and drags a
 *                  well-evidenced bullet under the threshold.
 *   2. evidence  — drop what cannot be traced to the original.
 *   3. keywords  — drop what smuggled in a declared gap. Evidence cannot catch
 *                  this: a real bullet with real evidence can carry an extra
 *                  clause the evidence does not support.
 *   4. retention — measure what the first three, plus the model, left behind.
 *                  Last, so it reports on the document that will actually ship.
 */
export interface TailorPipelineInput {
  jdProfile: JDProfile;
  analysis: MatchAnalysis;
  /** The parsed original. Retention is measured against this. */
  resume: ResumeDoc;
  /** The original as text. Evidence is traced against this, not the parse. */
  rawResumeText: string;
  /** Attributes the call in LlmCall. Omitted by the harness, which is nobody's. */
  userId?: string;
}

export interface TailorPipelineResult {
  /** Guarded and schema-parsed: what is safe to save or export. */
  resume: ResumeDoc;
  changeLog: ChangeLogEntry[];
  projectedAtsScore: number;
  remainingGaps: string[];
  /** Verdict on the model's output, before anything was stripped. */
  evidence: EvidenceCheckResult;
  /** Should always be empty: a hit here means a gap keyword survived stripping. */
  forbiddenHits: ForbiddenHit[];
  forbiddenRemoved: { kind: "bullet" | "skill"; where: string; text: string; term: string }[];
  retention: RetentionReport;
  meta: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    /** 1 means the model's first answer validated; 2 means it needed the retry. */
    attempts: number;
  };
}

export async function runTailorPipeline(
  input: TailorPipelineInput,
): Promise<TailorPipelineResult> {
  const { data: result, meta } = await callStructured({
    ...tailorEnginePrompt({
      jdProfile: input.jdProfile,
      analysis: input.analysis,
      resume: input.resume,
      rawResumeText: input.rawResumeText,
    }),
    userId: input.userId,
  });

  const normalised = sanitiseResumeDoc(result.resume);

  const evidence = checkEvidence(normalised, input.rawResumeText);
  const cleaned = evidence.passed ? normalised : stripUnsupported(normalised, evidence.failures);

  const { resume: guarded, removed: forbiddenRemoved } = stripForbiddenKeywords(
    cleaned,
    input.analysis,
  );
  const forbiddenHits = findForbiddenKeywords(guarded, input.analysis);

  const retention = checkRetention(input.resume, guarded);

  return {
    resume: ResumeDocSchema.parse(guarded),
    changeLog: result.changeLog,
    projectedAtsScore: result.projectedAtsScore,
    remainingGaps: result.remainingGaps,
    evidence,
    forbiddenHits,
    forbiddenRemoved,
    retention,
    meta: {
      provider: meta.provider,
      model: meta.model,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      latencyMs: meta.latencyMs,
      attempts: meta.attempts,
    },
  };
}
