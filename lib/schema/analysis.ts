import { z } from "zod";
import { tolerantArray, tolerantString } from "./tolerant";

/** MatchAnalysis — output of the ATS screening simulator (§5.3). */

export const MatchAnalysisSchema = z.object({
  atsScore: z.coerce.number().min(0).max(100),
  matched: tolerantArray(
      z.object({
        term: z.string(),
        weight: z.coerce.number().default(1),
        evidence: tolerantString().default(""),
      }),
    )
    .default([]),
  /** Adjacent/transferable experience exists but the exact term is absent — the highest-value fixes. */
  partial: tolerantArray(
      z.object({
        term: z.string(),
        weight: z.coerce.number().default(1),
        closestEvidence: tolerantString().default(""),
        howToSurface: tolerantString().default(""),
      }),
    )
    .default([]),
  /** No supporting evidence at all. These are never to be inserted into the tailored resume. */
  missing: tolerantArray(
      z.object({
        term: z.string(),
        weight: z.coerce.number().default(1),
        honestNote: tolerantString().default(""),
      }),
    )
    .default([]),
  blockers: tolerantArray(z.object({ filter: z.string(), candidateStatus: z.string().default("") }))
    .default([]),
  topThreeFixes: tolerantArray(z.string()).default([]),
});

export type MatchAnalysis = z.infer<typeof MatchAnalysisSchema>;
