import { z } from "zod";

/** MatchAnalysis — output of the ATS screening simulator (§5.3). */

export const MatchAnalysisSchema = z.object({
  atsScore: z.coerce.number().min(0).max(100),
  matched: z
    .array(
      z.object({
        term: z.string(),
        weight: z.coerce.number().default(1),
        evidence: z.string().default(""),
      }),
    )
    .default([]),
  /** Adjacent/transferable experience exists but the exact term is absent — the highest-value fixes. */
  partial: z
    .array(
      z.object({
        term: z.string(),
        weight: z.coerce.number().default(1),
        closestEvidence: z.string().default(""),
        howToSurface: z.string().default(""),
      }),
    )
    .default([]),
  /** No supporting evidence at all. These are never to be inserted into the tailored resume. */
  missing: z
    .array(
      z.object({
        term: z.string(),
        weight: z.coerce.number().default(1),
        honestNote: z.string().default(""),
      }),
    )
    .default([]),
  blockers: z
    .array(z.object({ filter: z.string(), candidateStatus: z.string().default("") }))
    .default([]),
  topThreeFixes: z.array(z.string()).default([]),
});

export type MatchAnalysis = z.infer<typeof MatchAnalysisSchema>;
