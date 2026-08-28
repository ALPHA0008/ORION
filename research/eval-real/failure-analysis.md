# Failure Analysis — First Real-Repository Baseline

Failure classes are the brief's starting taxonomy, applied unchanged. No new category was
invented: every observed failure fitted an existing label, and `unclassified` stayed at zero.

## Baseline distribution (15 failures / 22 tasks)

| class | count | share |
|---|---:|---:|
| `no_progress` | 14 | 93% |
| `budget_exhausted` | 1 | 7% |
| everything else | 0 | 0% |

A 93% concentration in one class is unusual and was treated as suspicious rather than conclusive.
Trajectories were read before drawing any conclusion.

## What the trajectories actually showed

The `no_progress` label was **accurate but shallow**. ADR-006 fired correctly — the agent really
had stopped making progress — but the label describes the symptom, not the cause.

Reading all 15 failures gave a single shared root cause:

> **15 of 15 failures re-read one identical file 2–4 times, then died.**

The mechanism, from `camel-unicode-uppercase`:

```
read index.js  ✓  ← 2,000 of 7,527 bytes (MSG_CLAMP)
read index.js  ✓  ← identical request, identical truncated bytes
read index.js  ✓  ← identical
read index.js  ✓  ← identical
failed — no_progress (identical tool request repeated 4 times)
```

The agent could see 27% of the file, could not find what it needed, and had **no way to ask for
the rest**. Re-issuing the read was the only move available to it. That is not a reasoning
failure; it is a missing capability.

## The correlation that made it undeniable

| repository | `index.js` | visible under clamp | baseline pass rate |
|---|---:|---:|---:|
| `is-number` | 411 B | 100% | **100%** |
| `p-limit` | 3,315 B | 60% | 25% |
| `slugify` | 4,137 B | 48% | 20% |
| `ansi-styles` | 6,962 B | 29% | 50% |
| `camelcase` | 7,527 B | 27% | **0%** |

Monotonic apart from `ansi-styles`, whose 2-task sample is too small to rank. The only repo whose
main file fits in the clamp is the only one at 100%.

## Trajectory signals: what predicts failure (measured)

Section 13 asked; these are the answers on this dataset, not assumptions.

| signal | predictive? | evidence |
|---|---|---|
| duplicate actions | **yes, strongly** | FAIL mean 0.486 vs PASS 0.253; present in 15/15 failures |
| repeated test failure | **no** | failing `npx ava` is how the agent learns; present in successes too |
| high tool count | **no** | `isnum-nan-guard` PASSED at 40 tool calls; `ansi-brightness-bit` FAILED at 40 |
| exploration depth | inconclusive | small sample once file size is controlled for |
| context compaction | not measurable | compaction was off in the baseline |
| human intervention | never occurred | `ask_user` was not called once in 22 tasks |

**Volume is not the signal — repetition is.** That distinction is what separated "the agent is
flailing" from "the agent is blocked", and it came directly from the event log.

## A notable non-finding

`ask_user` was never invoked, in 22 tasks, including 14 runs where the agent was stuck in a loop
it demonstrably could not escape. The escalation path exists and was always available. The agent
would rather repeat a doomed action than ask for help.

This is not yet ranked as a capability gap — one dataset, one model — but it is the clearest
candidate for a future iteration, and it is recorded here so the next phase can test it.

## After iteration 01

| class | before | after |
|---|---:|---:|
| `no_progress` | 14 | **6** |
| `budget_exhausted` | 1 | **2** |

`no_progress` fell by 57%. The residual 6 are qualitatively different: the agent now pages
through the file, forms a hypothesis, edits, tests, and *then* runs out of road on genuinely hard
problems (regex semantics in `camel-numbers-identifier`, the decamelize acronym rule in
`slug-decamelize-acronym`). Those are real capability limits, not blocked I/O.

`budget_exhausted` rising 1 → 2 is the expected cost of unblocking: runs that used to die at 6
model calls now survive long enough to exhaust a 40-turn budget instead.

## What did NOT change

No new failure class appeared. `unclassified` remained 0 both before and after — the brief's
taxonomy was sufficient, and expanding it speculatively would have added nothing.
