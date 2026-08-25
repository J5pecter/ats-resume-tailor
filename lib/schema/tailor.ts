import { z } from "zod";
import { ResumeDocSchema } from "./resume";

/** TailorResult — output of TAILOR_ENGINE (§5.4). */

export const CHANGE_TYPES = [
  "reworded",
  "reordered",
  "merged",
  "removed",
  "surfaced",
  "regrouped",
] as const;

export const ChangeLogEntrySchema = z.object({
  section: z.string().default(""),
  changeType: z.enum(CHANGE_TYPES).catch("reworded"),
  before: z.string().default(""),
  after: z.string().default(""),
  rationale: z.string().default(""),
  keywordsTargeted: z.array(z.string()).default([]),
});

export const TailorResultSchema = z.object({
  resume: ResumeDocSchema,
  changeLog: z.array(ChangeLogEntrySchema).default([]),
  projectedAtsScore: z.coerce.number().min(0).max(100).default(0),
  remainingGaps: z.array(z.string()).default([]),
});

export type ChangeLogEntry = z.infer<typeof ChangeLogEntrySchema>;
export type TailorResult = z.infer<typeof TailorResultSchema>;
