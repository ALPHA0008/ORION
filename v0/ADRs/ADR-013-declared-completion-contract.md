# ADR-013 — a declared completion contract; stopping is not completing

**Status:** accepted
**Relates to:** ADR-006 (no_progress). Does **not** change the event model, projection bounds,
recovery, fencing, replay, fork, authorization or escalation.

## Context

```js
if (resp.finish || !resp.tool_calls?.length) {
  return this.#stop(runId, leaseToken, 'completed', ExitReason.MODEL_FINISHED, …);
}
```

Any response without tool calls ended the run as `completed`. Three different states collapsed
into one verdict: genuinely done · prose diagnosis with an unchanged world · an **empty** reply
mid-exploration.

Measured (phase 9): **12 of 22 Qwen runs** ended with a response carrying no tool calls **and** no
text — one while still paging a 224-line file at line 144. Gemma: **0 of 66** across three
reports. The evaluator scored every one of those `FAIL`, so `task_success` was honest; it was the
**runtime's own record** that was wrong.

## Decision

An optional Worker option, supplied by the caller that already holds the task:

```js
completionContract: { requires_world_change: true, objectiveSatisfied: () => boolean }
```

| contract | behaviour |
|---|---|
| absent, or `requires_world_change: false` | **byte-identical legacy semantics** |
| `true` + objective satisfied | `completed` |
| `true` + objective **not** satisfied | one bounded continuation, then `failed / finished_without_change` |

`objectiveSatisfied` is supplied by the **task**, and is deterministic — for the real benchmark,
the task's own test command. The runtime never decides what correctness means; it asks a predicate
it was handed. No LLM judge.

### Why not simpler signals

- **"any tool call = done"** — measured wrong: across Qwen's 19 zero-mutation `model_finished`
  runs, tool-call counts ranged **2 to 20** (13 reads on one task). Investigation is not
  completion.
- **"mutation count > 0"** — would degenerate into "must mutate", breaking tasks whose world is
  already correct. Tested explicitly: an already-correct world completes with zero mutations.

### The continuation is hard-bounded

Exactly one per run, counted from `turn.started.continuation` in the **durable event log** — not
memory — so a crash cannot buy a second one, and replay and fork reconstruct the same decision.
Verified: after a crash mid-continuation, resume grants **no duplicate**.

### Failure of the predicate is not evidence

If `objectiveSatisfied` throws, the run falls back to legacy completion. A broken contract must
never fabricate an unfinished run.

## Consequences

- False completions eliminated where the contract is declared: Qwen 2 → **0** on the measured
  subset; Gemma unchanged (it never had the defect).
- `unfinished ≠ requires_human` — the escalation control plane (ADR-006/phase 6) is untouched.
- Status vocabulary unchanged: `failed` with a new **reason**, not a new run status, and not a new
  event type.
- Cost: one predicate evaluation per would-be completion. On the real benchmark that is one test
  run, which is measurable and is reported.

## The principle

> **Stopping is not the same thing as completing.**

The model may propose "finished"; the runtime decides whether that is compatible with the task's
declared contract.
