import { RefineResultSchema, type RefineResult } from "@/lib/schema/refine";
import type { JDProfile } from "@/lib/schema/jd";
import type { ResumeDoc } from "@/lib/schema/resume";
import type { StructuredCallOptions } from "@/lib/llm/client";
import { JSON_ONLY } from "./shared/constraints";
import { ATS_FORMATTING_RULES } from "./shared/atsRules";
import { RESUME_DOC_SHAPE } from "./shared/schemaText";

/** REFINE_ENGINE — tab 3 instruction handling (§5.5). */
export function refineEnginePrompt(input: {
  jdProfile: JDProfile;
  current: ResumeDoc;
  instruction: string;
}): Omit<StructuredCallOptions<RefineResult>, "userId"> {
  const system = `You are editing an existing tailored resume. Apply ONLY the change requested.

RULES
1. Change nothing the user did not ask you to change. Return the complete
   document, but every untouched field must be byte-identical to the input.
2. The no-fabrication rule still applies in full. Do not invent employers,
   dates, degrees, certifications, tools, or metrics.
3. If the user asks you to add something not in their history, add it as
   instructed — they are asserting it as fact — but flag it in
   needsVerification so they consciously confirm it.
4. If the request would hurt ATS performance against the target JD, apply it
   anyway (the user's document, their call) and note the tradeoff in warnings.
5. If the request is ambiguous, do not guess. Return needsClarification with
   a specific question and leave the document completely unchanged.
6. changesApplied must list every field you touched. An undeclared change is
   a bug and will be rejected.

${ATS_FORMATTING_RULES}

═══ OUTPUT ═══
${JSON_ONLY}

{
  "resume": ${RESUME_DOC_SHAPE},
  "changesApplied": [{"section": string, "before": string, "after": string}],
  "needsVerification": string[],
  "warnings": string[],
  "needsClarification": string | null
}`;

  const user = `<job_profile>
${JSON.stringify(input.jdProfile)}
</job_profile>

<current_document>
${JSON.stringify(input.current)}
</current_document>

<user_instruction>
${input.instruction}
</user_instruction>

Return the edited document JSON object.`;

  return {
    promptName: "REFINE_ENGINE",
    system,
    user,
    schema: RefineResultSchema,
    temperature: 0.4,
    maxTokens: 3800,
    thinking: true,
  };
}
