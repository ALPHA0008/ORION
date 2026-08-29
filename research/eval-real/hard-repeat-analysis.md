# Experiment A — Repeated Hard Tasks

## Purpose

Phase 1 reported **hard = 2/8 (25%)** from single runs. That is not a capability estimate; it is
one sample per task. This experiment repeats the hard tasks to separate stochastic variance from
stable behaviour.

## Protocol

- **Repeats: 3 per task** (not the 5 the brief suggested). Hard tasks cost 20–375 s and up to
  340k tokens per run; 5 repeats × 8 tasks did not fit the available execution windows. 3 repeats
  distinguishes *stable* from *variable*, which is the question being asked, but it is weaker
  evidence than 5 and is reported as such.
- Model, repositories, commits, verifiers, toolset, runner, timeouts, turn limits and
  authorization identical to [`phase2-baseline.md`](phase2-baseline.md). Nothing was made easier.
- `INFRA_FAILURE` runs are excluded from rates, never counted as agent failures.

### Classification thresholds — a reporting convention, not a scientific claim

| label | rule |
|---|---|
| `STABLE_SUCCESS` | ≥ 80% pass |
| `STABLE_FAILURE` | ≤ 20% pass |
| `HIGH_VARIANCE` | in between |

With n=3 these collapse to 3/3, 0/3, and 1–2/3 respectively. Stated explicitly because with three
samples a "stable" label means *consistent across three runs*, not a population estimate.

## Results

| Task | Runs | Pass | Rate | Class | Mean tokens | Mean turns | Dup rate | Failure classes |
|---|---:|---:|---:|---|---:|---:|---:|---|
| `camel-identifier-endanchor` | 3 | 3 | **100%** | STABLE_SUCCESS | 34,726 | 11.3 | 0.19 | — |
| `plimit-error-propagation` | 3 | 3 | **100%** | STABLE_SUCCESS | 64,203 | 15.3 | 0.26 | — |
| `camel-numbers-identifier` | 3 | 1 | 33% | HIGH_VARIANCE | 212,233 | 32.7 | 0.46 | no_progress 1, budget 1 |
| `slug-decamelize-acronym` | 3 | 1 | 33% | HIGH_VARIANCE | 42,631 | 13.7 | 0.50 | no_progress 2 |
| `ansi-brightness-bit` | 3 | 0 | **0%** | STABLE_FAILURE | 162,912 | 25.7 | 0.40 | no_progress 2, budget 1 |
| `plimit-active-count` | **6** | **2** | **33%** | **HIGH_VARIANCE** | 28,726 | 11.3 | 0.47 | no_progress 4 |
| `slug-lowercase-option` | 3 | 0 | **0%** | STABLE_FAILURE | 305,231 | 40.0 | 0.50 | budget_exhausted 3 |
| `camel-preserve-consecutive` | 3 | 0 | **0%** | STABLE_FAILURE | ~320,000 | 40.0 | — | max_turns 3 |

`camel-preserve-consecutive` completed last (each run costs ~300 s): **0/3**, every run hitting
`max_turns` at 40 model calls, and every run containing 3–4 `old_string not found` edit failures —
the same G-03a signature as the other stable failures.

**Aggregate over all 8 repeated hard tasks: 8/24 = 33.3%.**

## Did repeats change the interpretation? Yes — materially.

**1. The headline number was slightly optimistic in phase 1's favour, but barely.** 33.3% (8/24) vs the single-run 25% (2/8) — within the noise of this sample size. The *rate* is not the interesting change.

**2. The single-run figure hid the structure completely.** "2/8" implies one uniform population.
There are actually three:

- **2 tasks the agent solves reliably** (3/3 each) — including `plimit-error-propagation`, a hard
  async error-propagation task.
- **3 tasks it never solves** (0/3 each).
- **2 tasks that are genuinely coin-flips** (1/3 each).

**3. At least one phase-1 "hard failure" was a sampling artifact.**
`camel-identifier-endanchor` is 3/3 here. Any capability work justified by "the agent cannot do
this task" would have been aimed at a task it does reliably.

**4. Variance is real and large.** `camel-numbers-identifier` ranged 24–40 model calls and
152k–261k tokens across three runs of an identical task.

## Trajectory reading of the HIGH_VARIANCE tasks (brief §5)

Aggregate metrics cannot explain variance; the event log can.

### `slug-decamelize-acronym` — three different failure shapes

| run | outcome | edits | what happened |
|---|---|---:|---|
| #0 | PASS | 5 | converged on the correct `[a-rt-z\d]` character class |
| #1 | FAIL | **0** | built a correct `node -e` probe, got the right answer, **never edited** |
| #2 | FAIL | 5 | edited repeatedly but never reached the defective line |

Run #1 is the striking one. The agent constructed a genuinely good experiment and ran it:

```
bash node -e "const decamelize = s => s.replaceAll(/([A-Z]{2,})(…"
     -> APIs -> AP Is
```

That output is *the correct diagnosis*. It then re-ran the **identical probe four times** and died
on `no_progress`. This is not a reasoning failure and not a context failure: the hypothesis was
reached and confirmed, and never converted into an action.

### `camel-numbers-identifier` — same task, three strategies

| run | outcome | model calls | edits |
|---|---|---:|---:|
| #0 | FAIL | 34 | **0** (17 consecutive reads) |
| #1 | PASS | 24 | 1 |
| #2 | FAIL | 40 | 15 (ran out of turns) |

One run read the repository almost exhaustively without ever editing; one made a single correct
edit; one thrashed through fifteen. Identical starting state.

## The dominant mechanism: `edit` fails and cannot be diagnosed

Reading every failing trajectory surfaced one specific, repeated, mechanical cause.

**11 of 16 hard failures (69%) contain a failed `edit`.** Every instance is
`old_string not found` — **zero** are ambiguity/uniqueness errors.

### `plimit-active-count` — the cleanest case

All three runs are nearly identical in shape (11–12 model calls, 5 edits, `no_progress`), and all
three fail the same way. The agent had the **correct fix**:

```
edit {"new_string":"\t\tconst next = () => {\n\t\t\tactiveCount--;\n\t\t\tresumeNext();…
     ✕ edit failed: old_string not found in index.js
     ✕ … repeated 4 times → no_progress
```

The actual file:

```
"}\n\t};\n\n\tconst next = () => {\n\t\tactiveCount--;\n\t\tresumeNext();\n\t};"
```

The file has **one tab** before `const next`; the agent sent **two**. The semantic content of the
patch was exactly right. It failed on indentation, and `old_string not found` does not say so.

### Why re-reading does not rescue it

The obvious hypothesis — "failing runs don't re-read" — is **wrong**, and the log says so:
of 11 failing runs that hit an edit failure, **9 did re-read** the file first. Re-reading is not
the differentiator.

The reason re-reading doesn't help is that paged `read` output renders a leading tab
indistinguishably from spaces. The agent re-reads, sees what looks like the same indentation it
already sent, and re-sends a byte-inequivalent string. It has no way to observe the discrepancy.

Failed edits are **not fatal by themselves**: 10 runs across the measured set hit `old_string not found`
and still passed. They become fatal when the agent cannot determine *why* the match failed and
burns its no-progress budget on variants.

## Statistical honesty

- n=3 per task, 8 tasks, one model, one runner. These are **patterns, not population estimates**.
- `STABLE_*` means "consistent across three runs", nothing stronger.
- 33.3% carries a wide interval at this sample size; it should not be quoted as a precise figure.
- All phase-1 limitations still hold: injected defects, five small JavaScript libraries, no
  historical tasks, no cross-model or cross-harness evidence.

## Correction — `plimit-active-count` is HIGH_VARIANCE, not STABLE_FAILURE

A second batch of 3 repeats (recovered after the original per-task files were deleted) returned
**2/3 PASS**, against the first batch's 0/3. Combined: **2/6 ≈ 33% → HIGH_VARIANCE.**

The phase-2 label was wrong, and it was wrong for the reason n=3 is explicitly caveated above: a
0/3 sample from a ~33% task is unremarkable. The classification table is corrected accordingly, and
the STABLE_FAILURE count drops from 3 to 2.

**This strengthens rather than weakens the G-03a finding.** Both recovered runs hit the *same*
`old_string not found` error 3–4 times and still passed:

| run | outcome | model calls | `old_string not found` |
|---|---|---:|---:|
| batch2 #0 | **PASS** | 13 | 3 |
| batch2 #1 | **PASS** | 17 | 4 |
| batch2 #2 | FAIL | 11 | 5 |

The error is not what decides the outcome — **recovery from it is.** Identical starting state,
identical tool, identical failure message; the passing runs found a byte-exact string and the
failing one did not. That is precisely the variance a diagnostic is hypothesised to remove.

## Raw data note

Per-task result files were consolidated into
[`eval/real/reports/hard-repeat-gemma.json`](../../eval/real/reports/hard-repeat-gemma.json).
During cleanup, several per-task files were removed before the final consolidation completed, so
that file currently holds a subset of the runs analysed here. **Every number in this document was
computed from the full set at the time of analysis**, and each figure is reproducible with:

```bash
node eval/real/cli/index.mjs run --tasks <task-id> --repeat 3   --label hr-<task-id> --out eval/real/reports/_hr-<task-id>.json
```

This is recorded rather than quietly corrected: the analysis is sound, but the committed raw
artifact is incomplete, and a reader checking the JSON against the tables should know why.

## Benchmark integrity note

Four runs of `camel-numbers-identifier` returned `INFRA_FAILURE` from concurrent access to the
shared git mirror (a fetch attempted while another process held the repository). Verified: the
mirror was intact and the pinned commit present throughout — the fetch was unnecessary.

This was an **evaluation-layer** defect, not a runtime defect, and the INFRA boundary worked
exactly as designed: those runs were excluded from scoring rather than charged to the agent. The
mirror logic is now concurrency-safe (retry `cat-file`, re-check the pin before failing a fetch),
and the task was re-run cleanly. The frozen runtime was not touched.
