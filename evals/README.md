# Evaluation harness

Measures whether a change to the prompts or the guards made the output better.

```bash
npm run eval                              # every case, print a scorecard
npm run eval -- --cases sparse-junior     # one case, while iterating
npm run eval -- --save baseline           # record a run
npm run eval -- --baseline baseline       # print deltas against it
npm run eval -- --fresh                   # re-parse instead of using the cache
```

Exit code is non-zero when any case breaks a hard invariant, so this works in CI.

## Why it exists

Every quality problem this project has had was found by running one resume
through by hand and noticing something wrong — the employer header cited as
evidence for every bullet, `corrective actions` smuggled onto a real bullet,
skills quietly halved. Noticing finds bugs. It cannot tell you whether the fix
helped overall, or what it cost somewhere else.

Prompts are the main lever on output quality here, and until this existed they
were tuned blind.

## What is measured

The runner drives `runTailorPipeline`, the same function the `/api/tailor`
route calls. It is deliberately not a reimplementation: a harness that scored
its own copy of the pipeline would drift from the one that ships, and would
flatter whichever copy was edited more recently.

**Hard invariants** — pass/fail, and they must never regress:

| Invariant | Why |
|---|---|
| zero forbidden keyword hits | Rule 4 is absolute: a keyword the gap analysis marked MISSING is a gap the candidate cannot defend in an interview |
| zero unrelated citations | A real quote attached to the wrong claim. Traceability alone passes it; only relatedness catches it |
| per-case floors | `minAtsScore`, `maxDroppedBullets`, `maxUnrelatedEvidence` where a case declares them |

**Soft metrics** — trends, needing several runs to mean anything: projected
score, evidence rejection rate, bullet and skill retention, schema retries,
tokens, latency, and which endpoint in the chain served the call.

## Read the numbers with the right amount of trust

The model is stochastic, so one run is a sample rather than a measurement.
Two consecutive runs of *identical code* gave:

```
pm-strong-match     score 92  ->  84      unrelated 0 -> 0    bullets 7/7 -> 7/7
audit-gap-heavy     score  4  ->   9      unrelated 0 -> 0    bullets 6/6 -> 6/6
similar-employers   score 96  ->  97      unrelated 0 -> 0    bullets 6/6 -> 6/6
```

So `projectedAtsScore` moves by up to eight points on no change at all. It is
the model's own opinion of its work and should be treated as such — a chasing a
five-point "improvement" in it is chasing noise.

What did not move at all across runs: forbidden hits, unrelated citations,
bullet retention, schema retries. **Those are the signal.** If one of them
changes after an edit, the edit caused it.

## The parse cache

Each case needs four model calls: parse the JD, parse the resume, analyse the
gap, then tailor. Only the last is usually under test, so the first three are
cached in `evals/.cache/` keyed by a hash of the case text (gitignored).

This is not only about cost. Re-rolling the parses means a tailor-prompt
comparison runs against different inputs each time, which is an excellent way
to convince yourself of an improvement that is not there. Use `--fresh` when
you have changed a parser prompt.

## The corpus

Five synthetic cases in `cases.ts`. Synthetic on purpose: this repository is
public, and a resume is sensitive personal data.

Each is shaped after a failure this project actually had, which is why `why:`
is a required field — read it before deleting a case.

| Case | Guards against |
|---|---|
| `pm-strong-match` | over-trimming on the easy path |
| `audit-gap-heavy` | gap keywords smuggled onto real bullets |
| `similar-employers` | the employer-header citation bug, and bullets landing on the wrong employer |
| `long-senior` | trimming that is not reported |
| `sparse-junior` | fabrication where there is little real material to cite |

Adding a case is the right response to finding a new failure mode. Adding one
without a `why:` is how a corpus rots into noise.
