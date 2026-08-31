# Current Architecture (§2)

## How a task reaches a run

```
task { task_id, description, verification, … }      ← eval/real/tasks
   ↓ runner
store.createRun(runId, { task: task.description })  ← a STRING only
   ↓
worker.run(runId, leaseToken, { input: description })
```

`runs` table columns: `id, parent_run_id, forked_from_seq, scope, principal, status, attempts,
created_at, task`. The `task` column holds free text.

**There is no structured task contract anywhere in the run.** The runtime knows what the agent was
*asked*, in prose, and nothing about what "done" means.

## Where a contract could live, without touching the event model

| candidate | verdict |
|---|---|
| new event type | **rejected** (§21) — nothing yet shows durable semantics require it |
| new projection field | **rejected** — existing state suffices, see below |
| `runs.task` column | free text; parsing prose would be a semantic detector (§ forbidden) |
| **Worker constructor option** | **chosen** — the runner already constructs the Worker per run and already holds the task object |

The runner is the only place that knows both the task and the run, and it already passes
per-run options (`maxTurns`, `leaseMs`, `compactContext`). A contract is one more.

## What existing state already exposes

From `completiongate.test.mjs` (phase 9): a zero-mutation run is observable as
`budget.tool_calls === 0` in the projection.

But phase 10's own measurement shows that is **not sufficient**: 19 Qwen runs had `tool_calls`
between 2 and 20 with **zero mutations**. So the usable signals are:

| signal | source | sufficient alone? |
|---|---|---|
| `tool_calls > 0` | projection `budget` | **no** — investigation counts |
| mutation count | derivable from events (`edit`/`write` succeeded) | **no** — §19: the world may already be correct |
| **objective satisfied** | task-supplied deterministic check | **yes** — this is the contract |

## Consequence for the design

The contract cannot be inferred from tool activity. It must be **declared**, and its satisfaction
must be **checked**, using deterministic evidence the task already carries (`test_command`).

That keeps the runtime out of the evaluator's job: it does not decide *what* correctness means, it
only asks a predicate the task handed it.
