# ATS Resume Tailor

Paste a job description and your existing resume. Get back a rewritten,
ATS-optimised resume aimed at that specific role — then refine it
conversationally and export it as `.docx` and `.pdf`.

**The rule that overrides everything:** the system never fabricates. It
reorders, re-emphasises, rephrases, re-titles within truth, expands acronyms
and surfaces buried achievements. It does not invent employers, dates, degrees,
certifications, tools or metrics. When the posting demands something you
genuinely lack, it reports a gap instead of papering over it.

That is enforced, not just prompted: every generated bullet **and every skill**
carries the verbatim fragment of your original resume it was derived from, and
that link is verified after generation. Anything that fails is dropped and the
rejection is shown to you.

Skills get a little latitude that bullets do not, because the rewrite is
allowed to relabel a real skill into the posting's vocabulary. "Ran A/B tests"
can legitimately become the skill "Experimentation" — so a skill passes if
either its name appears in your resume outright, or its cited evidence traces
back. A skill that can do neither was invented, and gets removed.

---

## Setup

**Requirements:** Node 20+ and npm. Nothing else — the database is a local
SQLite file.

```bash
npm install
cp .env.example .env.local
```

Then fill in two values in `.env.local`:

**1. `AUTH_SECRET`** — any random string:

```bash
npx auth secret
```

**2. A model key.** Pick one provider and set `LLM_PROVIDER` to match:

| Preset | Free? | Limits | Trains on your resume? |
|---|---|---|---|
| **Cerebras** *(recommended)* | Yes, no card | ~60k tokens/min, ~1M/day | No |
| **Ollama**, on your machine | Yes, genuinely unlimited | None | No — nothing leaves the machine |
| Groq | Yes, no card | 8k tokens/min | No |
| Google AI Studio | Yes | Very high | **Yes** — free tier allows human review and training |
| Anthropic | No, ~cents per resume | High | No |

`.env.example` carries a ready-to-paste block for each. Free-tier numbers were
checked in August 2026 and move around.

> **On "unlimited free":** no hosted free tier is unlimited — every one of them
> meters you somewhere, and providers that advertise otherwise are rate-limiting
> you by another name. The only genuinely unlimited option is running the model
> yourself with Ollama, which is also the only option where your resume never
> leaves your computer. The trade is quality: a 7B local model writes noticeably
> weaker bullets than Cerebras' 70B. Cerebras is the best balance for most
> people; Ollama is the right answer if the resume is genuinely sensitive.
>
> Whatever you pick, read its data policy before pasting a real resume. Google's
> free tier is the one to be careful with.

Then:

```bash
npx prisma migrate dev
npm run dev
```

Open <http://localhost:3000>.

### Optional: "Continue with Google"

Leave `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` blank and the app uses email and
password only — no external setup at all. To enable the Google button, create
an OAuth client (free) in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
with authorised redirect URI `http://localhost:3000/api/auth/callback/google`,
and put the two values in `.env.local`.

### Want to look around without a model key?

```bash
npm run demo:seed -- your@email.com
```

Sign up first, then run that. It seeds a complete tailored workspace — job
description, gap analysis, tailored resume, change log — so you can exercise
tab 3 and both exporters without spending a single model call.

---

## How it works

```
Tab 1  Job description   ->  JDProfile     must-haves, hard filters, weighted ATS keywords
Tab 2  Your resume       ->  ResumeDoc     parsed as-is, never rewritten at this stage
                         ->  MatchAnalysis matched / partial / missing, honest ATS score
       Generate          ->  TailoredResume v1
Tab 3  Refine & export   ->  version N+1 on every accepted change
```

Everything downstream of Tab 1 renders from one object, `ResumeDoc`. The live
preview, the DOCX writer and the PDF writer all walk the same block model in
`lib/export/layout.ts`, which is what stops the two exported formats from
drifting apart.

### What is actually checked

| Guard | Where | What it catches |
|---|---|---|
| Zod validation + one retry | `lib/llm/client.ts` | Malformed or off-schema model output |
| Evidence check (≥70% token overlap) | `lib/validate/evidence.ts` | Invented bullets **and invented skills** with no basis in your resume |
| Forbidden-keyword scan | `lib/validate/keywords.ts` | Gap keywords smuggled into the rewrite |
| Field-by-field drift diff | `lib/validate/drift.ts` | A refinement quietly changing things you did not ask about |
| ASCII sanitisation | `lib/validate/sanitize.ts` | Non-breaking hyphens and curly quotes silently costing you keyword matches |
| Poor-extraction detection | `lib/extract/text.ts` | Two-column PDFs extracting as interleaved fragments |
| Ownership filter on every query | `lib/ownership.ts` | One account reading another's employment history |

### A note on metered tiers

Metered providers charge the per-minute budget for the tokens a request
*reserves*, not the ones it uses — which is why an optimistic
`max_completion_tokens` fails outright before generating anything. The adapter
sizes every request to fit the remaining budget, and grows the reservation once
if a reply is genuinely cut short.

On Groq's 8k/min tier a full run exceeds the budget, so the app pauses mid-flow
and continues by itself; waits up to 45 seconds are ridden out automatically and
anything longer is reported with how long to wait. Nothing is lost either way.
On Cerebras (~60k/min) or Ollama (unlimited) it does not pause at all.

### Exports

Single column. No tables, text boxes, sidebars or graphics. Standard headings
(`PROFESSIONAL SUMMARY`, `CORE SKILLS`, `PROFESSIONAL EXPERIENCE`, `PROJECTS`,
`EDUCATION`, `CERTIFICATIONS`). Contact details in the body, never a header —
ATS parsers frequently skip headers. Dates right-aligned with a tab stop, not a
table. Standard bullet glyphs. Selectable PDF text, asserted by an automated
test that re-extracts the generated PDF and checks the name, every company and
every heading survived.

---

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm test             # unit suite (75 tests)
npm run test:e2e     # playwright happy path
npm run typecheck    # tsc --noEmit
npm run db:studio    # browse the database
npm run db:reset     # wipe and re-migrate
npm run llm:check    # smoke-test the configured provider on a tiny fixture
npm run demo:seed -- you@example.com   # seed a workspace with no model calls
```

The unit suite runs with no API key and no network. The E2E suite covers auth,
route protection and both exporters unconditionally; set `RUN_LLM_E2E=1` to
include the three generative steps.

---

## Privacy

Resume content is sensitive personal data, and this build treats it that way:

- It is never written to logs. The `LlmCall` table stores token counts and
  timings only.
- Uploaded files are never persisted. The binary is read into memory, converted
  to text, and dropped when the request ends.
- **Delete my data** in the dashboard header removes the account and cascades
  to every job description, resume, tailored version, analysis and log row.
- The one thing outside the app's control is your model provider. See the
  warning in Setup.

---

## Deploying

**GitHub Pages cannot run this app.** Pages serves static files; this is a
Next.js app with server routes, a database, and an API key that must stay
server-side. GitHub hosts the source — something else has to run it.

Everything below has a free tier that covers personal use.

**1. A Postgres database.** SQLite is a file on disk, and serverless hosts give
you an ephemeral filesystem, so the local database will not survive a deploy.
The schema is already Postgres-compatible — change one line in
`prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

Create a free database at [Neon](https://neon.tech) or
[Supabase](https://supabase.com) and copy its connection string.

**2. Deploy.** Import the repo at [vercel.com/new](https://vercel.com/new). Set
these environment variables in the project settings:

| Variable | Value |
|---|---|
| `DATABASE_URL` | your Neon/Supabase connection string |
| `AUTH_SECRET` | a fresh one — `npx auth secret` |
| `AUTH_URL` | `https://your-app.vercel.app` |
| `LLM_PROVIDER` | `groq` |
| `OPENAI_COMPATIBLE_API_KEY` | your provider key |
| `OPENAI_COMPATIBLE_BASE_URL` | your provider's endpoint |
| `OPENAI_COMPATIBLE_MODEL` | your model |
| `OPENAI_COMPATIBLE_TPM` | your tier's per-minute budget |

Then run the migrations against the new database once:

```bash
npx prisma migrate deploy
```

**Use a different `AUTH_SECRET` in production than locally.** It signs session
tokens; sharing it between environments means a session minted on your laptop
is valid against the deployed app.

**A caution before you make it public.** Anyone who signs up shares your API key
and its rate limit, and their resumes land in your database — which makes you
responsible for that data. For personal use, keep the deployment private
(Vercel password protection) or just run it locally with `npm run dev`.

Ollama cannot be used from a deployed app: it runs on your machine, not the
server. Local model, local app.

---

## Notes on the build

See `CLAUDE.md` for the deviations from the original spec and why they were
made. The full prompt specification lives in `docs/prompt-spec.md`.
