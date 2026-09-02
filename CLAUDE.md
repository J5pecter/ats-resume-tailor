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

Evidence is checked on two independent axes, and both matter. Traceability
(>=70% token overlap with the source) proves the quote is real. Relatedness
(>=30% overlap with the claim, measured against the shorter side) proves the
quote is *about* that claim. A weak local model passed the first and failed the
second by citing "Arihant Securities - Senior Product Manager" as evidence for
every bullet, then copying a bullet onto the wrong employer. Traceability alone
would have shipped it.

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
- A MISSING keyword that appears verbatim in the source resume is exempt from
  rule 4. The list comes from a model and the model can be wrong: the eval
  corpus caught "18th Edition" reported as a gap for an electrician whose CV
  reads "City and Guilds 2382 18th Edition, 2019". Enforced literally, rule 4
  deletes a real qualification off the candidate's own resume, which inverts
  the point of the rule. Same dual logic as `SkillSchema`. Both
  `findForbiddenKeywords` and `stripForbiddenKeywords` take the source text so
  they cannot disagree about what counts.
- The keyword stripper covers every surface the finder searches — bullets,
  skills, summary, certifications, projects, additional. It previously read
  certifications and could not clean them, so a hit there was reported on every
  check and never actionable.
- `lib/validate/sanitize.ts` runs on every write path, BEFORE the evidence
  check. Models emit non-breaking hyphens and curly quotes despite ATS rule 14;
  those break both the ATS's literal keyword matching and our own tokeniser.
- Token reservations are tight on purpose — metered tiers bill
  `prompt + max_completion` whether used or not. See `tests/unit/prompt-budget.test.ts`.
- `lib/schema/tolerant.ts` — models express "none" as `null` as often as `[]`,
  and both are compliance. Rejecting one buys a retry on strong models and
  outright failure on weak ones. Tolerance is about shape only; every rule that
  matters is enforced after parsing.
- A metered provider (currently only `anthropic`) throws at startup unless
  `ALLOW_PAID_PROVIDERS=true`. This build is required to cost nothing, and the
  failure worth preventing is silent spend after an absent-minded env change.
  The same gate runs over the fallback chain, so an outage can never be the
  thing that starts a bill.
- `lib/llm/endpoints.ts` resolves an ordered chain, not a single provider.
  A free tier is not a promise anyone made us — keys get revoked, limits get
  tightened, hosts go down — so `callAcrossChain` in `client.ts` retries the
  next endpoint on any failure. Any failure, deliberately: everything reaching
  that layer has already exhausted the per-endpoint rate-limit wait and the
  one-off reservation growth, and every remaining free-tier failure mode is
  endpoint-specific rather than a statement about the request. Guessing wrong
  costs one wasted call; being clever costs the outage.
- A chain of one rethrows the original error untouched, so adding chains
  changed nothing for an install that does not use them. On exhaustion the
  error *class* is preserved — `routeError` maps it to the HTTP status, and
  flattening a 429 into a generic failure would report a recoverable pause as
  a broken app.
- `lib/pipeline/tailor.ts` holds generation plus every guard, in order. The
  route and the eval harness both call it, so neither can measure a pipeline
  the other does not run — the same reason `lib/export/layout.ts` exists.
  Order is load-bearing: sanitize before anything measures overlap, evidence
  before keywords, retention last so it reports on what will actually ship.
- `npm run eval` is the only way to know whether a prompt edit helped. Read
  `evals/README.md` before trusting a number from it: `projectedAtsScore` moves
  up to 8 points run-to-run on identical code, while forbidden hits, unrelated
  citations, retention and schema retries do not move at all. Tune against the
  stable ones.
- Every data route checks session AND row ownership via `lib/ownership.ts`.
- Never log resume or JD content. `LlmCall` stores counts and timings only.

`scripts/prepare-deploy.mjs` rewrites the Prisma datasource to Postgres at
build time, keyed off the host advertising itself (`VERCEL`, `RENDER`) rather
than off the connection string — someone pointing a local checkout at Postgres
should not find their schema file rewritten underneath them. `render.yaml`
describes the Render service; secrets are `sync: false` so they stay out of
the repo.

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
npm run llm:check    # resolve the endpoint chain, then run three prompts against it
npm run eval         # score the tailor pipeline across the synthetic corpus
npm run eval -- --save baseline      # record a run
npm run eval -- --baseline baseline  # deltas against it
RUN_LLM_E2E=1 npm run test:e2e   # include the generative steps in the E2E run
```

## Spec
Full build spec in `docs/prompt-spec.md`. Read it before touching `lib/prompts/`.
