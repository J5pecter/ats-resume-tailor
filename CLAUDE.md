# ATS Resume Tailor

## What this is
Dashboard where a user provides a JD + their resume and gets back an
ATS-optimised, JD-tailored resume, refinable in-app, exportable to DOCX/PDF.

## The rule that overrides everything
NEVER fabricate resume content. Reorder, rephrase, re-emphasise — yes.
Invent employers, dates, metrics, tools, or credentials — never.
Every generated bullet AND every skill carries `sourceEvidence` traceable to
the original, and `lib/validate/evidence.ts` verifies that link after
generation. Anything that fails is dropped and the rejection is shown.

Skills use a dual rule — name-appears-verbatim OR evidence-traces — because
relabelling a real skill into the JD's vocabulary is explicitly permitted, and
a name-only check would reject that legitimate rewrite. See `SkillSchema` in
`lib/schema/resume.ts`; it also accepts a bare string so documents saved before
skills carried evidence still parse.

## Architecture
- Next.js 16 App Router, TypeScript strict, Tailwind v4, hand-rolled shadcn-style primitives
- Prisma 6 + SQLite (schema is Postgres-compatible; change the datasource provider to deploy)
- NextAuth v5, Credentials (bcryptjs, cost 12) + optional Google, JWT sessions
- LLM behind an adapter (`lib/llm/providers.ts`): gemini | anthropic | groq, chosen by `LLM_PROVIDER`

## Deviations from the original spec, and why
- **LLM provider is pluggable, defaulting to Gemini.** The spec locks
  `@anthropic-ai/sdk` + `claude-sonnet-4-6`. That path still works
  (`LLM_PROVIDER=anthropic`) but needs paid credits, and this build was
  required to be free to run. Every provider goes through the identical
  prompt, Zod validation, evidence and drift pipeline.
- **bcryptjs instead of bcrypt.** Same API, same cost factor, no native
  toolchain needed on Windows.
- **Prisma 6, not 7.** Prisma 7 requires driver adapters, which for SQLite
  means `better-sqlite3` and a native build. Pinning 6 keeps setup to `npm i`.
- **Arial in DOCX, Helvetica in PDF.** Metrically equivalent, so the two
  documents look the same, and neither ships a font binary. `@react-pdf/renderer`
  fails silently when a registered font cannot be fetched; Helvetica is built
  into the PDF format, so there is no fetch to fail.

## Non-obvious conventions
- ALL LLM output is Zod-validated before use. No exceptions. `lib/llm/client.ts`
  is the only place a model is called, and it retries exactly once with the
  validation error appended before failing.
- Prompts live in `lib/prompts/*.ts`, composed from `lib/prompts/shared/`.
  Never inline a prompt in a route handler.
- `ResumeDoc` (`lib/schema/resume.ts`) is the single source of truth.
  Preview, DOCX and PDF all render from it. Never generate formatted text
  from the LLM.
- `lib/export/layout.ts` holds the shared block model. The preview, the DOCX
  writer and the PDF writer all walk it — that is what stops them drifting.
- `TailoredResume` rows are immutable — refinements, manual edits and
  rollbacks all create version+1.
- Refinement output is diffed field-by-field against the input
  (`lib/validate/drift.ts`). Undeclared changes are rejected, not trusted.
- `lib/validate/sanitize.ts` runs on every write path, BEFORE the evidence
  check. Models emit non-breaking hyphens and curly quotes despite ATS rule 14;
  those break both the ATS's literal keyword matching and our own tokeniser.
- Token reservations are tight on purpose — metered tiers bill
  `prompt + max_completion` whether used or not. See `tests/unit/prompt-budget.test.ts`.
- Every data route checks session AND row ownership via `lib/ownership.ts`.
- Never log resume or JD content. `LlmCall` stores counts and timings only.

Scripts that import server modules run under `node --conditions=react-server`,
because `server-only` throws outside that resolution condition.

## Commands
```
npm run dev          # dev server on :3000
npm run build        # production build
npm test             # vitest unit suite
npm run test:e2e     # playwright happy path (needs the dev server)
npm run typecheck    # tsc --noEmit
npm run db:migrate   # prisma migrate dev
npm run db:studio    # prisma studio
npm run demo:seed -- you@example.com   # seed a tailored workspace, no model calls
npm run llm:check    # run JD_PARSER, RESUME_PARSER, GAP_ANALYSIS against the live provider
RUN_LLM_E2E=1 npm run test:e2e   # include the generative steps in the E2E run
```

## Spec
Full build spec in `docs/prompt-spec.md`. Read it before touching `lib/prompts/`.
