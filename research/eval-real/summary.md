# Real-Repository Evaluation — Phase Summary

## What was asked

Replace the synthetic benchmark with a credible real-repository evaluation, run the current agent
unchanged to get a baseline, then let the failures decide what to build.

## What was built

`eval/real/` — a real-repository evaluation layer:

- **5 pinned repositories** (`is-number`, `camelcase`, `slugify`, `p-limit`, `ansi-styles`),
  MIT-licensed, each validated end-to-end (clone → install → tests green) before admission.
- **22 bracketed tasks**, 4 easy / 10 medium / 8 hard, spanning single-file fixes, multi-file
  changes, regex, async concurrency, numeric conversion, option handling, and a hidden-contract task.
- **Mandatory bracketing** — preflight-negative + oracle-positive on the real environment.
- **Deterministic verification** by each repository's own suite, plus hidden tests injected only
  at verification time.
- **Anti-gaming guards** — test files are byte-compared; editing or deleting a test is a FAIL.
- **18 permanent evaluator invariants** and strict `INFRA_FAILURE` separation.

## Headline result

| | synthetic (17 tasks) | real (22 tasks) |
|---|---:|---:|
| V0 agent, unchanged | **17/17 (100%)** | **7/22 (31.8%)** |

The synthetic suite could not discriminate at all. The same agent on real code scores 31.8% and
fails **every hard task**. That gap is the justification for this entire phase.

## The bottleneck, found by the benchmark

**15 of 15 baseline failures re-read one identical file 2–4 times, then died on `no_progress`.**

Cause: the bounded projection clamps every tool result at `MSG_CLAMP` (2,000 bytes). On
`camelcase/index.js` (7,527 B) the agent saw 27% of the file, could not find what it needed, and
had **no way to request the rest** — so it re-issued the same read and got the same bytes.

Pass rate tracked file visibility almost perfectly:

| repo | main file | visible | baseline |
|---|---:|---:|---:|
| `is-number` | 411 B | 100% | **100%** |
| `p-limit` | 3,315 B | 60% | 25% |
| `slugify` | 4,137 B | 48% | 20% |
| `camelcase` | 7,527 B | 27% | **0%** |

This was a **Layer 2 (capability) gap exposed by a correct Layer 1 (runtime) bound**. `MSG_CLAMP`
does exactly what ADR-001 designed it to do; what was missing was a way to retrieve the clamped
remainder. **The runtime was not changed.**

The synthetic suite structurally could not find this: every fixture file was small enough to fit.

## Iteration 01 — paged `read`

One capability, one change: `read` gained optional `offset`/`limit`, returns numbered lines, and
every truncated page states the exact next call to make. Page size (1,500 B) sits deliberately
below `MSG_CLAMP` so a page plus footer survives the clamp intact.

| metric | baseline | iteration 01 |
|---|---:|---:|
| **success rate** | 31.8% (7/22) | **63.6% (14/22)** |
| easy | 3/4 (75%) | **4/4 (100%)** |
| medium | 4/10 (40%) | **8/10 (80%)** |
| hard | 0/8 (0%) | **2/8 (25%)** |
| `camelcase` | 0/7 | **4/7** |
| `p-limit` | 1/4 | **3/4** |
| `no_progress` failures | 14 | **6** |
| improved / regressed | — | **7 / 0** |

**Success rate doubled, with zero regressions on the real task set.** Full unit regression suite:
**350 passed, 0 failed** across 11 suites (was 328/10). One *synthetic* task became flaky — see
below; it is not counted as a clean sweep.

## The bug that nearly buried the result

The first iteration-01 run scored **0/7 on camelcase — no better than baseline.** The obvious
reading was "the hypothesis was wrong."

The event log said otherwise. The agent had adopted paging *immediately and correctly*, and every
single call was being rejected by our own validator:

```
read failed: invalid arguments: property offset must be integer, got number
```

JSON has no integer type — `2` arrives as a `number`, and the schema check compared it against
`typeof`, so `type: 'integer'` was **unsatisfiable by construction**. The capability worked; the
validator silently disabled it.

Had the trajectory not been read, this phase would have concluded "file paging does not help" and
discarded a change that doubles the success rate. This is the second time in two phases that
reading the event log overturned a conclusion the aggregate score supported.

## Honest costs

| metric | before | after |
|---|---:|---:|
| total tokens (22 tasks) | 888,834 | 2,202,914 (2.5×) |
| tokens per success | 46,997 | 69,507 |
| p50 / p95 wall | 10s / 57s | 27s / 221s |
| `budget_exhausted` | 1 | 2 |

Partly arithmetic — runs that used to die at 6 model calls now run to completion, so their cost is
counted for the first time — but not entirely. Cost is now the thing to watch.

## One synthetic task became flaky — recorded, not hidden

The synthetic suite was re-run after the change as a regression guard: **16/17**, down from 17/17.
The single regression is `wide-units-mismatch`, the context-pressure task.

Investigated rather than dismissed. It is **flaky, not broken**: three runs gave FAIL, FAIL, PASS
(~50%). The failing trajectories show `dup=0.000, edits=0` and a clean `model_finished` — the
agent read 10 files thoroughly and then declared its *analysis* complete without making the fix.

That task's prompt explicitly instructs "read the index.js of EVERY stage directory before
changing anything". Paging made that survey genuinely satisfiable, and the agent now sometimes
mistakes completing the survey for completing the task.

This is a real behavioural change with a real cost, and it is the honest counterweight to the
headline number:

- it is **1 synthetic task at ~50%**, versus **7 real tasks moved FAIL → PASS with 0 regressions**;
- it is a *prompt-following* failure mode (`gave_up_early` in kind), not blocked I/O;
- it argues for `--repeat` as standard practice, since a single run would have reported either
  "clean regression" or "no regression at all" depending on luck.

Kept, with the flakiness recorded. Reverting a change that doubles real-repository success to
protect one synthetic task at 50% would be optimising the instrument instead of the agent.

## Trajectory signals: measured, not assumed

- **Duplicate actions predict failure strongly** (FAIL 0.486 vs PASS 0.253; present in 15/15).
- **Repeated test failure does not** — failing tests are how the agent learns.
- **High tool count does not** — one task PASSED at 40 tool calls, another FAILED at 40.
  Volume is not the signal; **repetition** is.
- **`ask_user` was never called** in 22 tasks, including 14 runs stuck in inescapable loops.

## What this says about the strategic question

> *What is the minimum capability set required for this harness to be genuinely useful?*

The single highest-impact change in this phase was **two optional parameters on one tool.** Not
memory, not planning, not subagents, not MCP, not a larger tool surface. A feature-list-driven
roadmap would not have predicted it; the benchmark did.

The evidence so far says the minimum viable capability set is smaller than expected, and that
**I/O adequacy gates everything else** — an agent that cannot see the code cannot reason about it,
and no amount of planning or memory compensates.

## Limitations — what must not be claimed

- **Injected defects, not historical bugs.** Real bugs are subtler and more distributed.
  Historical tasks remain the next credibility step.
- **Five small JavaScript libraries.** No compiled languages, services, frameworks, or monorepos.
  **Results do not generalise to large or polyglot codebases.**
- **One model** (`gemma4-31b`), which required a compatibility shim on essentially every response.
  Harness behaviour and model behaviour are not separated.
- **One runner.** No comparative claim against QM, Hermes, LangGraph, OpenHands, or Claude Code is
  made or implied.
- **22 tasks, single-repeat.** Enough to locate a dominant bottleneck and measure a large effect;
  not enough for confident per-category rates or small effects.

**Not claimed:** benchmark leadership, parity with any other harness, general-purpose agent
capability, or product-market fit.

## What comes next

1. **`--repeat` on the harder tasks** — variance is currently unmeasured, and single runs are weak
   evidence for the 2/8 hard-task rate.
2. **A second model** — to separate harness behaviour from `gemma4-31b` behaviour, and to test
   whether the never-escalate finding (G-02) is a harness property or a model property.
3. **Decompose the hard-task gap (G-03)** into observable sub-failures before building anything.
4. **Historical tasks** — the honest next step for benchmark credibility.
5. Only then: a second runner, and cross-harness comparison.

The loop held: **real tasks → baseline → failure analysis → one hypothesis → one change → same
tasks → measure → keep.** It produced a doubling of capability from a change no roadmap would
have prioritised.
