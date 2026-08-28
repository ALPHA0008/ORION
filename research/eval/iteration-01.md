# Iteration 01 — Context Compaction by Supersession

**Decision: KEEP (scoped).** Real, reproducible token savings with no correctness regression —
but the mechanism works for a *different reason* than the hypothesis predicted, and the headline
aggregate number is misleading. Both are recorded below.

---

## Problem

From [`capability-gap.md`](capability-gap.md) G-01, measured on `eval/reports/v1-full-17.json`:

| metric | value |
|---|---:|
| `wide-units-mismatch` input tokens | 127,712 |
| output tokens | 731 |
| share of all input tokens across the 17-task dataset | **58.7%** |
| ratio vs mean of other 16 tasks | **22.8×** |
| input:output ratio | 175:1 |

Before this iteration, `context.compacted` had **never fired in any evaluation run**. The runtime
could *forget* context (drop past `WINDOW`) but could not *compact* it.

## Hypothesis

> Input tokens grow ~quadratically because the bounded projection resends the whole 40-message
> window on every model call. Eliding superseded tool results will cut input tokens materially on
> read-heavy tasks, with `wide-units-mismatch` benefiting most.

## Implementation

[`v0/src/core/projection/compact.mjs`](../../v0/src/core/projection/compact.mjs) — elides tool
results that are *provably superseded*:

1. a `read` of path P superseded by a later `read`/`write`/`edit` of P;
2. an exactly-duplicated `(tool, args)` result superseded by its later twin.

The newest result for any target is **always kept in full**. Deliberate constraints:

- **No LLM summarisation.** A model-generated summary is lossy, nondeterministic and
  unverifiable — the opposite of what the event-log design exists to guarantee. Elision is
  deterministic and reversible; full text stays in the event log.
- **Outbound-only.** It rewrites the provider message array, never the event log or the
  projection. Replay, fork and resume are byte-identical with compaction on or off.
- **Opt-in** (`compactContext: false` by default), so the A/B changes exactly one variable.

A subtle correctness point, caught while wiring it: the projection's `context.compacted` handler
increments `dropped_message_count`, which feeds the model-visible notice *"N earlier messages are
not shown."* Elision does **not** drop messages. Reusing that field would have inflated the
counter and actively lied to the model. `elided` is now a separate counter from `dropped`.

## Verification before benchmarking

New suite `v0/tests/compaction/compaction.test.mjs` — **18 assertions**, including the safety
property that matters most: with 3 paths read 3 times each in interleaved order, exactly one
result survives per path and it is always the latest. Also covers: distinct paths never confused,
no message ever grows, `tool_call_id`s preserved, output survives `repairOrphans`, determinism
under key reordering, and malformed input not throwing.

Full regression: **328 passed, 0 failed across 10 suites** (was 310/9). No regressions.

## Before / after

Measured with `HARNESS_COMPACT` toggled, **two repeats per side**. Both sides proved reproducible
to the token on 2 of 3 tasks, so these deltas are signal, not noise:

| task | OFF | ON | delta | model calls OFF→ON |
|---|---:|---:|---:|---|
| `ten-file-migration` | 16,878 | 11,422 | **−32.3%** | 12 → **10** |
| `cold-cache-crash` | 9,153 | 8,496 | −7.2% | 8 → 8 |
| `wide-units-mismatch` | 127,712 | 127,498 | **−0.2%** | 22 → 22 |
| **total** | 153,743 | 147,416 | **−4.1%** | |

Full 17-task dataset: success rate **100% → 100%** (17/17), tokens/success 13,163 → 11,941.

## The hypothesis was wrong about the mechanism

**The task this was built for barely improved.** `wide-units-mismatch` saved 699 bytes — 0.16% of
its own input — and its 11.7% drop in the first uncontrolled comparison was model nondeterminism
(one fewer model call), not compaction.

The reason is structural: that task reads **14 distinct files exactly once each**. Almost nothing
is superseded, so there is almost nothing to elide. Its cost comes from **breadth**, not
repetition. Meanwhile `ten-file-migration` — which re-reads the same files as it edits them — saved
32.3%.

> Elision helps tasks that revisit the same targets. It does nothing for tasks that read widely
> once. G-01 conflated these two cost shapes; only the first is addressed here.

A second constraint caps the ceiling: `MSG_CLAMP` already truncates every tool result at 2,000
bytes, so the maximum possible saving is ~2 KB per elided message. Compaction is a *second-order*
optimisation stacked on a bound that was already doing most of the work.

## Honest reporting of the aggregate

The 17-task aggregate (13,163 → 11,941 tokens/success, −9.3%) **overstates the effect.** Model
call counts differed between the two runs on 5 tasks, and each extra call carries a full window.
Restricting to the 12 tasks where model calls were identical — the only fair comparison — the
saving is **3.3%**. The controlled 3-task repeat measured −4.1%.

**−3% to −4% is the defensible number.** −9.3% is not.

## Regressions

None. 17/17 tasks still pass; `compare` reports 0 improved / 0 regressed; 328/328 unit assertions
pass. Success rate was the guard, not the win condition — as
[`capability-gap.md`](capability-gap.md) required, since it was already at 100% and could not rise.

## Decision: KEEP (scoped)

Kept because the win is real, reproducible, costs nothing when it does not apply, carries no
correctness risk, and is fully auditable in the event log (`✂ compacted context (elided 1
superseded results, saved 1495b)`).

Kept **scoped**, with the claim stated precisely: *elides superseded tool results, saving ~3–4%
of input tokens overall and up to ~32% on tasks that revisit the same files.* It is not a general
solution to context cost.

It remains **opt-in**. Default-on is not justified by a 3–4% median saving until it has been
measured on a dataset that actually fails, and against a second model — a single provider that
required a compatibility shim on 100% of responses is not a basis for changing a default.

## What this says about the central thesis

The brief asks whether *"the event log makes agent runs measurable and improvable, not just
recoverable."*

This iteration is evidence for that, in a way a pass/fail score could not be:

- the bottleneck was **found** from per-call token counts in the log (58.7% of spend in one task);
- the fix was **verified** from the log (`elided`, `bytes_saved` per event);
- and the log is what **falsified the hypothesis** — it showed 699 bytes saved on the target task,
  proving the win came from elsewhere. Without per-event attribution the −9.3% aggregate would
  have been reported as a success and the real mechanism never understood.

The log did not just measure the improvement. It caught the wrong explanation for it.
