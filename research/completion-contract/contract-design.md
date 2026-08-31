# Contract Design

## The contract (§3)

One optional Worker option, supplied by the caller that already knows the task:

```js
new Worker(store, {
  …,
  completionContract: {
    requires_world_change: true,
    objectiveSatisfied: () => boolean,   // deterministic, task-supplied
  },
})
```

Semantics:

| contract | behaviour |
|---|---|
| absent, or `requires_world_change: false` | **existing semantics, byte-identical** |
| `requires_world_change: true` + objective satisfied | `completed` |
| `requires_world_change: true` + objective **not** satisfied | **not `completed`** |

`objectiveSatisfied` is a predicate the **task** supplies. The runtime never decides what
correctness means — it asks a question it was handed. For the real benchmark this is the task's
own `test_command` exit code: deterministic, no LLM judge (§5).

## Why not "any tool call" (§4)

Measured, before designing: across Qwen's 19 zero-mutation `model_finished` runs, tool-call counts
ranged **2 to 20** — one made 13 reads. Treating tool activity as completion would mark all 19
`completed`, which is exactly today's bug wearing a different mask.

## Why not "mutation count > 0" (§19)

A task whose world state is *already* correct requires no mutation. Keying on mutations would
degenerate the contract into "must mutate", which §3 and §16 forbid. The objective predicate
handles this case correctly and for free.

## Variant choice (§6, §7, §10)

Two candidates:

| | Variant A — terminal reason | Variant B — one bounded continuation |
|---|---|---|
| behaviour | record `finished_without_change` instead of `completed` | give the model exactly one more turn, then stop |
| fixes runtime truth | **yes** | yes |
| can recover useful work | **no** | **yes** |
| new failure modes | none | must be bounded, or it is an infinite retry (§7, §25-B) |

**Both are implemented, and B is built on A.** That is not scope creep — B *needs* a terminal
state for the case where its single continuation also fails, so A is a prerequisite rather than an
alternative. The experiment then measures whether the continuation actually converts premature
stops into work (§14), which is the question §6 asks.

The continuation is **hard-bounded to one per run**, tracked in projection state derived from the
event log rather than in-memory, so it survives crash and replay identically (§22, §23).

## What "not completed" means (§10)

A new `ExitReason`, not a new run status:

```
status: 'failed', reason: 'finished_without_change'
```

The run did not crash and did not lose its lease — it stopped without satisfying its contract.
Reusing `failed` keeps the status vocabulary unchanged (§21: no new infrastructure unless proven
necessary), while the reason makes the distinction legible in `explain` and in metrics.

## Deliberate non-goals

- **Not** "no tool call = failure" (§8). With no contract, prose-only analysis still completes.
- **Not** escalation (§24). `unfinished ≠ requires_human`; the escalation control plane is untouched.
- **Not** a planner, evaluator, or semantic detector.
- **Not** a new event type (§21) unless the experiment proves durable semantics need one.

## Falsification, fixed in advance (§25)

Reject if: it forces mutations on analysis-only tasks (A) · infinite retries (B) · more incorrect
edits (C) · Gemma's success regresses materially (D) · Qwen still recorded `completed` despite the
contract (E) · replay/resume break (F) · completion becomes model-specific (G) · benchmark-specific
hacks needed (H).
