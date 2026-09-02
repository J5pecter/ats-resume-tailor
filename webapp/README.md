# Resume Tailor — web app (Python)

FastAPI, Jinja templates, a little HTMX. No bundler, no `node_modules`, no
build step: the whole thing is `uvicorn app.main:app`, which is what makes it
deployable anywhere that runs Python.

The tailoring itself lives in [`pytailor`](../pytailor) — the same package the
CLI uses. Guards implemented twice drift apart, and the drift is invisible
until it reaches somebody's resume.

## Run it

```bash
pip install -e ../pytailor -e ".[dev]"
cp .env.example .env          # optional; it runs without one
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>. With no configuration at all it uses SQLite in
the working directory and prints sign-in codes to the terminal instead of
emailing them.

```bash
pytest        # 20 tests, no API key needed — all offline
```

## Free hosting, honestly compared

| | Free? | Sleeps? | Notes |
|---|---|---|---|
| **Render** | yes, no card | after ~15 min idle | Already configured in [`render.yaml`](../render.yaml). Closest to click-and-forget. |
| **Hugging Face Spaces** | yes, no card | rarely | **Deploys by `git push`**, which is the nearest thing to "GitHub hosts it". Public by default — check that before uploading a resume. |
| **Fly.io / Railway** | card required | — | Not free in the sense meant here. |
| GitHub Pages | — | — | Cannot run this. Serves static files only; see the note below. |

### Why GitHub itself cannot host this

Pages serves static files. This app has server routes, a database, sessions and
an API key that must never reach the browser. Rewriting it in Python did not
change that, because the language was never the blocker — a FastAPI app needs a
process exactly as much as a Next.js one does.

What GitHub *can* run is a command, which is what [`pytailor`](../pytailor) is
for: `.github/workflows/tailor.yml` tailors a resume inside an Actions job and
hands back the `.docx` and `.pdf` as an artifact.

### Hugging Face Spaces

The one option that deploys by pushing to a git remote:

1. Create a Space, SDK **Docker**.
2. Add `SECRET_KEY`, `OPENAI_COMPATIBLE_API_KEY` and your `DATABASE_URL` as
   **Repository secrets** (not variables — variables are visible to anyone).
3. Push this repository to the Space remote. The Dockerfile at
   `webapp/Dockerfile` builds from the repository root, because the image needs
   `pytailor/` too.

A Space with no `DATABASE_URL` falls back to SQLite inside the container, which
is wiped on every restart. Fine for a demo, wrong for anything you care about.

## Free database

**Neon** (Postgres). No card, and — unlike some free tiers — it does not expire
on a timer, which is why the blueprint points at it rather than Render's own
free Postgres. Create a database, copy the connection string, set it as
`DATABASE_URL`. `postgres://` is rewritten to the driver SQLAlchemy expects
automatically, since managed hosts hand out the old prefix.

Leave `DATABASE_URL` unset and it uses a local SQLite file. That is a real
option for one person on one machine, not a lesser one.

## Configuration

| Variable | Needed | What happens without it |
|---|---|---|
| `SECRET_KEY` | on a host | Refuses to start. Locally, a dev key with sessions ending at restart. |
| `OPENAI_COMPATIBLE_API_KEY` | to tailor | Everything else works; tailoring reports it is not configured. |
| `DATABASE_URL` | no | SQLite in the working directory. |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | to email codes | Codes print to the server log, loudly. |
| `LLM_FALLBACKS` | no | No spare endpoint; a rate-limited primary fails the run. |
| `SHEETS_WEBHOOK_URL` | no | Sign-ins recorded locally only. |

`/health` reports which of these are actually in effect, which is faster than
guessing from behaviour.

## What it will not do

It will not invent anything. Every bullet and skill carries the fragment of
your resume it came from, verified on two axes after the model answers —
traceability (the quote is real) and relatedness (the quote is about *that*
claim). Anything failing either is dropped, and the report says what went and
why.

Passwords are bcrypt hashes and codes are SHA-256 hashes, so a copy of the
database yields no working credential. The audit trail records who signed in
and how, never what with.
