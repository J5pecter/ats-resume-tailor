# Prompt specification

The authoritative description of the five prompts and the validation pipeline
around them. Read this before changing anything in `lib/prompts/`.

Implementation map:

| Concept | File |
|---|---|
| Provider adapter | `lib/llm/providers.ts` |
| Call wrapper, retry, validation, logging | `lib/llm/client.ts` |
| JSON salvage | `lib/llm/json.ts` |
| Shared no-fabrication block | `lib/prompts/shared/constraints.ts` |
| Shared writing + ATS rules | `lib/prompts/shared/atsRules.ts` |
| RESUME_PARSER | `lib/prompts/resumeParser.ts` |
| JD_PARSER | `lib/prompts/jdParser.ts` |
| GAP_ANALYSIS | `lib/prompts/gapAnalysis.ts` |
| TAILOR_ENGINE | `lib/prompts/tailorEngine.ts` |
| REFINE_ENGINE | `lib/prompts/refineEngine.ts` |
| Evidence check | `lib/validate/evidence.ts` |
| Forbidden-keyword guard | `lib/validate/keywords.ts` |
| ASCII sanitisation | `lib/validate/sanitize.ts` |
| Drift detection | `lib/validate/drift.ts` |

---

## 0. Universal calling conventions

Applied by `callStructured()` to every call:

- Model comes from `LLM_PROVIDER` + the matching `*_MODEL` env var.
- `max_tokens` 4096 by default; 8192 for parsing, tailoring and refinement.
- `temperature` 0.2 for parsing and analysis, 0.4 for tailoring and refinement.
- JSON is forced at the decoder where the provider supports it:
  - Anthropic — the assistant turn is prefilled with `{`.
  - Gemini — `responseMimeType: "application/json"`.
  - OpenAI-compatible — `response_format: { type: "json_object" }`.
- Variable inputs are wrapped in XML tags (`<job_description>`, `<resume>`,
  `<current_document>`). Models track those boundaries far more reliably than
  markdown fences.
- Parse → Zod-validate → on failure, **one** retry with the validation error
  appended as a user turn: *"Your previous output failed validation: {error}.
  Return corrected JSON only."* → on second failure, a clean user-facing error.
  Unvalidated output never reaches a renderer.
- Every call has a hard 60s timeout. Rate-limit waiting sits *outside* it: a
  metered pause is not the model being slow, so it gets its own budget (one
  wait of up to 45s, 90s in total) and each retry a fresh 60s window.
- Token reservations are deliberately tight. Metered tiers charge
  `prompt_tokens + max_completion_tokens` against the per-minute limit whether
  or not the tokens are used, so an optimistic reservation both fails outright
  when it exceeds the cap and starves the calls that follow it. If an answer is
  genuinely cut short, the reservation is grown once and retried rather than
  being set high by default. `tests/unit/prompt-budget.test.ts` fails the build
  if a prompt outgrows the budget.
- Logged: `{promptName, provider, model, inputTokens, outputTokens, latencyMs,
  attempts, ok}`. **Never** resume or JD content.

---

## 1. RESUME_PARSER — raw text → `ResumeDoc`

Extraction, not rewriting.

1. Extract only what is present. Never infer, embellish, or add.
2. If a field is genuinely absent, omit it. No "N/A", no placeholders.
3. Preserve the candidate's own numbers, metrics and proper nouns exactly.
4. Normalise dates to `MMM YYYY`. Current roles use `Present`.
5. Keep bullets verbatim at this stage.
6. `sourceEvidence` is set to the bullet's own original text.
7. Expand acronyms only where the resume itself defines them elsewhere.

**Failure mode to watch:** two-column PDF resumes extract as interleaved
fragments. `assessExtractionQuality()` flags this when more than 15% of
extracted lines are under four words, and the UI steers the user to paste.
Scanned/image-only PDFs produce an explicit "no text layer" error rather than
an empty parse.

## 2. JD_PARSER — raw JD → `JDProfile`

1. Separate genuine MUST-HAVEs from NICE-TO-HAVEs by their signal words.
2. `atsKeywords` are VERBATIM terms — ATS matching is literal, so
   "Stakeholder Management" and "stakeholder mgmt" are different tokens.
3. Weight 1–5 by centrality. Weight 5 = in the title or first responsibility.
4. Hard filters (years, degree, location, certifications) are captured separately.
5. Seniority is inferred from scope language, not just the title.
6. Tone is recorded so the rewrite can mirror the posting's register.

The user can delete mis-extracted keywords and requirements before anything
downstream runs; editing the profile invalidates the cached gap analysis.

## 3. GAP_ANALYSIS — `ResumeDoc` + `JDProfile` → `MatchAnalysis`

Blunt by instruction. Optimism here costs the candidate interviews.

- **MATCHED** — the resume demonstrates it, not merely mentions it adjacently.
- **PARTIAL** — adjacent or transferable experience exists but the exact term
  is absent. The highest-value fixes, and the only gaps the rewrite may close.
  Each carries the verbatim resume text that could legitimately carry the term.
- **MISSING** — no supporting evidence at all. Never suggested, never inserted.
- `atsScore` = (Σ weight of matched + 0.5 × Σ weight of partial) ÷ Σ all weights.
- `blockers` = hard filters the candidate demonstrably fails.

## 4. TAILOR_ENGINE — the core call

Absolute constraints (shared block, `NO_FABRICATION`):

1. Never fabricate. If a number is not in the source resume, it does not go in
   the output.
2. Every bullet **and every skill** must carry a `sourceEvidence` fragment
   quoted verbatim from the original. No evidence → no bullet, no evidence →
   no skill.
3. Permitted: reorder, re-prioritise, rephrase, merge, split, re-title within
   truth, expand acronyms, surface buried achievements, adopt the JD's
   vocabulary where the work genuinely matches.
4. MISSING keywords must not appear. They are passed in explicitly as
   `<forbidden_keywords>`.
5. PARTIAL keywords should be surfaced — only by rewording real work, using the
   cited evidence. Passed in as `<surface_these>`.

Writing rules 6–13 and ATS formatting rules 14–16 are in
`lib/prompts/shared/atsRules.ts` and are reused by the refine prompt.

**Post-generation, in `app/api/tailor/route.ts`:**

- `sanitiseResumeDoc()` — normalises typographic look-alikes to ASCII. Models
  emit non-breaking hyphens, curly quotes and zero-width characters unprompted,
  and rule 14 does not reliably stop them. This runs **before** the evidence
  check, because the tokeniser splits on those codepoints: a non-breaking
  hyphen in "drop-off" turns one matching token into two non-matching ones and
  can reject a properly evidenced claim. It also protects the literal keyword
  matching an ATS performs.
- `checkEvidence()` — every bullet's `sourceEvidence` must reach ≥70% token
  overlap with the raw source resume. Failures are stripped from the document
  and reported to the user rather than silently dropped.
- The same function applies a second, independent bar: **relatedness**. The
  cited fragment must share at least 30% of its meaningful tokens with the
  claim it is attached to, measured against the shorter side. Traceability
  alone proved insufficient — a model will cite any real fragment, and one was
  observed attaching the employer's name line to every bullet and moving a
  bullet to the wrong employer. Every citation was genuinely present in the
  source. The threshold is deliberately low, because rewriting into the
  posting's vocabulary legitimately drops shared wording; it is set to catch
  evidence that is unrelated, not evidence that is reworded.
- Skills are checked by the same function, under a **dual rule**: a skill
  passes if its *name* appears verbatim in the source (whole-word), **or** if
  its `sourceEvidence` traces at ≥70% overlap. Both routes are needed. Rule 10
  explicitly encourages relabelling a real skill into the posting's vocabulary
  — "A/B tests" becoming "Experimentation" — and a name-only check would
  reject exactly that legitimate rewrite, while an evidence-only check would
  demand a citation for skills the resume already names outright. A skill that
  satisfies neither route is invented, and is stripped.
- A skill group left with no surviving skills is removed rather than left as a
  bare heading, the same way a role that loses every bullet is.
- `findForbiddenKeywords()` — whole-word search of the entire rendered
  document for any MISSING term. Hits are surfaced as an error banner.

The `changeLog` is a product feature, not debug output. It is shown in tab 3 as
"What changed and why", and its rationale is written for the candidate.

## 5. REFINE_ENGINE — tab 3 instruction handling

1. Change nothing the user did not ask to change.
2. No-fabrication still applies in full.
3. Content the user asserts as fact is added, but flagged in
   `needsVerification` for conscious confirmation.
4. A change that hurts ATS performance is applied anyway — their document,
   their call — with the tradeoff noted in `warnings`.
5. An ambiguous request returns `needsClarification` and leaves the document
   untouched. No version is written.

**Drift detection.** The declared `changesApplied` list is not trusted. The
output is diffed against the input field by field
(`lib/validate/drift.ts`); a changed path must be explained by a declared entry
that either names its section or quotes its text closely. Containment only
counts for quotes of 25+ characters, because a legitimate summary rewrite
contains common phrases like "Product Manager" that would otherwise excuse an
undeclared role rename elsewhere. Whitespace reflow is not a change;
`sourceEvidence` and `keywordsHit` are bookkeeping and are excluded.

A drifting response is discarded and retried once. If it drifts again, nothing
is persisted and the undeclared paths are reported to the user.

---

## 6. Validation pipeline

```
LLM response
  → strip any stray fences
  → extract the outermost balanced { } block (string-aware)
  → JSON.parse                    (fail → retry once)
  → Zod .safeParse                (fail → retry once with the error text)
  → ASCII sanitisation            (typographic look-alikes -> plain punctuation)
  → evidence check                (TAILOR: every bullet AND skill traces to the source)
  → forbidden-keyword check       (TAILOR: no MISSING term in the document)
  → drift check                   (REFINE: no undeclared field changed)
  → persist as a new immutable version
```
