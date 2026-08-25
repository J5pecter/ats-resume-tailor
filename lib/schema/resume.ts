import { z } from "zod";
import { tolerantArray, tolerantOptional, tolerantString } from "./tolerant";

/**
 * ResumeDoc — the spine of the application (§4).
 *
 * The LLM never emits formatted prose. It emits this object. The on-screen
 * preview, the DOCX writer and the PDF writer all consume this same object,
 * which is what keeps the three renderers from drifting apart.
 */

const nonEmpty = z.string().trim().min(1);

/** Resumes almost always carry an email, but a bad extraction shouldn't hard-fail the parse. */
const looseEmail = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: "must be a valid email address or empty",
  });

export const BulletSchema = z.object({
  text: nonEmpty,
  keywordsHit: tolerantArray(z.string()).default([]),
  /** Verbatim fragment of the ORIGINAL resume that justifies this bullet. */
  sourceEvidence: tolerantString().default(""),
});

export const ExperienceSchema = z.object({
  company: nonEmpty,
  role: nonEmpty,
  location: tolerantOptional(z.string()),
  startDate: tolerantString().default(""),
  endDate: tolerantString().default(""),
  context: tolerantOptional(z.string()),
  bullets: z.preprocess((v) => v ?? [], z.array(BulletSchema).min(1).max(8)),
});

export const ContactSchema = z.object({
  fullName: nonEmpty,
  headline: tolerantString().default(""),
  email: looseEmail.default(""),
  phone: tolerantString().default(""),
  location: tolerantString().default(""),
  linkedin: tolerantOptional(z.string()),
  portfolio: tolerantOptional(z.string()),
});

/**
 * A skill carries its own evidence for the same reason a bullet does.
 *
 * Checking the skill *name* against the source resume is not enough: the
 * tailoring prompt is explicitly allowed to relabel a real skill into the job
 * description's vocabulary ("A/B tests" -> "Experimentation"), and a plain
 * string match would reject exactly that legitimate rewrite. The evidence
 * fragment is what distinguishes a relabelled true skill from an invented one.
 *
 * Accepts a bare string too, so that a model that emits the old shape — and
 * documents saved before this field existed — still parse.
 */
export const SkillSchema = z.preprocess(
  (value) => (typeof value === "string" ? { name: value, sourceEvidence: "" } : value),
  z.object({
    name: nonEmpty,
    sourceEvidence: tolerantString().default(""),
  }),
);

export const CoreSkillGroupSchema = z.object({
  category: nonEmpty,
  skills: z.preprocess((v) => v ?? [], z.array(SkillSchema).min(1)),
});

export const ProjectSchema = z.object({
  name: nonEmpty,
  description: tolerantString().default(""),
  stack: tolerantOptional(z.array(z.string())),
  link: tolerantOptional(z.string()),
});

export const EducationSchema = z.object({
  institution: nonEmpty,
  degree: tolerantString().default(""),
  field: tolerantOptional(z.string()),
  endDate: tolerantString().default(""),
  score: tolerantOptional(z.string()),
});

export const CertificationSchema = z.object({
  name: nonEmpty,
  issuer: tolerantOptional(z.string()),
  date: tolerantOptional(z.string()),
});

export const AdditionalSchema = z.object({
  label: nonEmpty,
  value: tolerantString().default(""),
});

export const ResumeDocSchema = z.object({
  contact: ContactSchema,
  summary: tolerantString().default(""),
  coreSkills: z.preprocess((v) => v ?? [], z.array(CoreSkillGroupSchema).max(5)).default([]),
  experience: tolerantArray(ExperienceSchema).default([]),
  projects: tolerantOptional(z.array(ProjectSchema)),
  education: tolerantArray(EducationSchema).default([]),
  certifications: tolerantOptional(z.array(CertificationSchema)),
  additional: tolerantOptional(z.array(AdditionalSchema)),
});

export type ResumeDoc = z.infer<typeof ResumeDocSchema>;
export type Bullet = z.infer<typeof BulletSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type CoreSkillGroup = z.infer<typeof CoreSkillGroupSchema>;

/** Empty document used as a safe render fallback. */
export const EMPTY_RESUME: ResumeDoc = {
  contact: { fullName: "", headline: "", email: "", phone: "", location: "" },
  summary: "",
  coreSkills: [],
  experience: [],
  education: [],
};
