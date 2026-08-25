import { z } from "zod";
import { ResumeDocSchema } from "./resume";

/** RefineResult — output of REFINE_ENGINE (§5.5). */

export const RefineResultSchema = z.object({
  resume: ResumeDocSchema,
  changesApplied: z
    .array(
      z.object({
        section: z.string().default(""),
        before: z.string().default(""),
        after: z.string().default(""),
      }),
    )
    .default([]),
  /** User-asserted facts the model could not trace to the source — surfaced for conscious confirmation. */
  needsVerification: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  needsClarification: z.string().nullable().default(null),
});

export type RefineResult = z.infer<typeof RefineResultSchema>;
