import { JDProfileSchema, type JDProfile } from "@/lib/schema/jd";
import type { StructuredCallOptions } from "@/lib/llm/client";
import { JSON_ONLY } from "./shared/constraints";

/** JD_PARSER — raw JD -> JDProfile (§5.2). */
export function jdParserPrompt(
  rawJdText: string,
): Omit<StructuredCallOptions<JDProfile>, "userId"> {
  const system = `You are an ATS and recruitment analyst. Extract a structured requirement
profile from the job description you are given.

RULES
1. Separate genuine MUST-HAVEs from NICE-TO-HAVEs. "Required"/"must"/
   "minimum" signal must-have; "preferred"/"bonus"/"plus" signal nice-to-have.
2. atsKeywords must be VERBATIM terms from the JD — exact casing and phrasing.
   ATS keyword matching is literal. "Stakeholder Management" and
   "stakeholder mgmt" are different tokens.
3. Assign each keyword a weight 1-5 by how central it is to the role.
   Weight 5 = appears in the title or the first responsibility bullet.
4. Capture hard filters separately (years of experience, degree, location,
   certifications, work authorisation).
5. Infer seniority from scope language, not just title.
6. Note the JD's tone (corporate / startup / technical / consulting) so the
   resume can mirror its register.
7. Aim for 15-30 atsKeywords. Include the plausible surface variants of each
   term in "variants" (abbreviations, plurals, common spellings).

${JSON_ONLY}

Shape:
{
  "roleTitle": string,
  "company": string | null,
  "seniority": "entry"|"mid"|"senior"|"lead"|"executive",
  "function": string,
  "mustHaves": [{"requirement": string, "category": "skill"|"experience"|"education"|"tool"|"domain"}],
  "niceToHaves": [{"requirement": string, "category": string}],
  "hardFilters": {"minYears": number|null, "degree": string|null, "location": string|null, "certifications": string[]},
  "atsKeywords": [{"term": string, "weight": 1|2|3|4|5, "variants": string[]}],
  "responsibilities": string[],
  "tone": "corporate"|"startup"|"technical"|"consulting",
  "impliedPriorities": string[]
}`;

  const user = `<job_description>
${rawJdText}
</job_description>

Return the JDProfile JSON object for this job description.`;

  return {
    promptName: "JD_PARSER",
    system,
    user,
    schema: JDProfileSchema,
    temperature: 0.2,
    maxTokens: 2200,
    thinking: false,
  };
}
