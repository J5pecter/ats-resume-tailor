/**
 * The ResumeDoc shape, as shown to the model.
 *
 * This is written by hand rather than generated from the Zod schema with
 * `z.toJSONSchema()`. The generated JSON Schema for ResumeDoc runs to a few
 * thousand tokens once every nested object, default and constraint is spelled
 * out, which on a rate-limited tier is most of the budget spent restating
 * things the annotations below convey in a fraction of the space. Models also
 * follow this compact form at least as reliably.
 *
 * It must stay in step with lib/schema/resume.ts. The schema is still the
 * enforcement boundary — anything the model gets wrong here is caught by
 * validation rather than shipped.
 */
export const RESUME_DOC_SHAPE = `{
  "contact": { "fullName": string, "headline": string, "email": string, "phone": string,
               "location": string, "linkedin"?: string, "portfolio"?: string },
  "summary": string,                                                  // 40-70 words
  "coreSkills": [{                                                    // at most 5 groups
    "category": string,
    "skills": [{ "name": string, "sourceEvidence": string }]
  }],
  "experience": [{
    "company": string, "role": string, "location"?: string,
    "startDate": "MMM YYYY", "endDate": "MMM YYYY" | "Present",
    "context"?: string,
    "bullets": [{ "text": string, "keywordsHit": string[], "sourceEvidence": string }]
  }],
  "projects"?: [{ "name": string, "description": string, "stack"?: string[], "link"?: string }],
  "education": [{ "institution": string, "degree": string, "field"?: string,
                  "endDate": string, "score"?: string }],
  "certifications"?: [{ "name": string, "issuer"?: string, "date"?: string }],
  "additional"?: [{ "label": string, "value": string }]
}`;

/** Kept as a function so call sites read the same as before. */
export function resumeDocSchemaText(): string {
  return RESUME_DOC_SHAPE;
}
