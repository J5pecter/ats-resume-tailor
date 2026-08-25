import { z } from "zod";
import { tolerantArray, tolerantNullableNumber, tolerantString } from "./tolerant";

/** JDProfile — structured requirement profile extracted from a job description (§5.2). */

export const SENIORITY = ["entry", "mid", "senior", "lead", "executive"] as const;
export const TONE = ["corporate", "startup", "technical", "consulting"] as const;

export const RequirementSchema = z.object({
  requirement: z.string().trim().min(1),
  category: tolerantString("skill"),
});

export const AtsKeywordSchema = z.object({
  /** VERBATIM term from the JD — ATS matching is literal, so casing and phrasing are preserved. */
  term: z.string().trim().min(1),
  weight: z.coerce.number().int().min(1).max(5),
  variants: tolerantArray(z.string()).default([]),
});

export const JDProfileSchema = z.object({
  roleTitle: tolerantString("Untitled role").default("Untitled role"),
  company: z.string().nullable().default(null),
  seniority: z.enum(SENIORITY).catch("mid"),
  function: tolerantString().default(""),
  mustHaves: tolerantArray(RequirementSchema).default([]),
  niceToHaves: tolerantArray(RequirementSchema).default([]),
  hardFilters: z
    .object({
      minYears: tolerantNullableNumber().default(null),
      degree: z.string().nullable().default(null),
      location: z.string().nullable().default(null),
      certifications: tolerantArray(z.string()).default([]),
    })
    .default({ minYears: null, degree: null, location: null, certifications: [] }),
  atsKeywords: tolerantArray(AtsKeywordSchema).default([]),
  responsibilities: tolerantArray(z.string()).default([]),
  tone: z.enum(TONE).catch("corporate"),
  impliedPriorities: tolerantArray(z.string()).default([]),
});

export type JDProfile = z.infer<typeof JDProfileSchema>;
export type AtsKeyword = z.infer<typeof AtsKeywordSchema>;
