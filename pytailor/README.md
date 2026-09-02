# pytailor

Tailors a resume to a job description and writes a `.docx` and `.pdf` — from a
terminal, or from a GitHub Actions run. No server, no database, no login.

This exists because the web app in the parent repository cannot run on GitHub:
Pages serves static files, and a web app needs a process, a database and an API
key that must stay off the client. A command-line tool has none of those needs,
so GitHub Actions can run it on GitHub's own machines for nothing.

## What it will not do

It will not invent anything. Every generated bullet and every skill carries the
fragment of your resume it came from, and that link is verified after the model
returns. Anything that cannot be traced is dropped and reported, never shipped.

Verification is on two independent axes, and both matter:

- **Traceability** — at least 70% of the quoted evidence appears in your resume.
  Proves the quote is real.
- **Relatedness** — at least 30% overlap between the quote and the claim it
  supports, measured against the shorter side. Proves the quote is *about* that
  claim.

Traceability alone is not enough, and that is not theoretical. A weak model once
passed it on every bullet by citing `Arihant Securities - Senior Product
Manager` — a real line from the resume — as the evidence for every one of them,
then copied a bullet onto the wrong employer. Only the second axis caught it.

## Use

```bash
pip install -e .
export OPENAI_COMPATIBLE_API_KEY=gsk_...
pytailor --resume cv.pdf --jd posting.txt --out ./build
```

Writes `build/resume.docx`, `build/resume.pdf` and `build/report.json` — the
report says what was dropped and why.

## On GitHub Actions

`.github/workflows/tailor.yml` runs it from the Actions tab: paste the job
description, upload nothing, download the result as an artifact. Set
`OPENAI_COMPATIBLE_API_KEY` as a repository secret first.
