# Architecture

One idea: **a run is an append-only log of events; state is a bounded projection of that log.**
Everything else follows.

```
Model / agent loop
      ↓ emits
    Events            append-only, closed type set, (run_id, seq) unique
      ↓ folded into
Bounded projection    counters + open items + a windowed message view
      ↓ enables
resume · replay · fork · explain
```

## Why the log is the source of truth

Four capabilities that are normally four subsystems fall out of one mechanism:

| capability | how |
|---|---|
| **resume** | fold the log, continue |
| **replay** | fold the log, stop early |
| **fork** | copy the log to event N, continue |
| **explain** | render the log |

Nothing mutates a run except by appending an event.

## Core pieces

| module | responsibility |
|---|---|
| `core/event` | the closed type set; payload helpers |
| `core/run/store` | events, snapshots, runs, human requests, **leases** |
| `core/projection` | the fold; the bounded hot state |
| `core/recovery` | per-invocation recovery contract, orphan decisions |
| `core/replay` | replay / fork / rerun |
| `core/lease/reaper` | reclaim runs whose worker died |
| `agent/loop/worker` | the loop; stateless — all state comes from the log |
| `agent/model` | one thin OpenAI-compatible client |
| `agent/tools` | 6 tools, each declaring `recovery(args)` |
| `sandbox/local` | workspace containment + git-shadow checkpoints |
| `auth/default` | `authorize(action, ctx) -> allow \| deny \| escalate` |

## The loop

```
claim(run) ──►
  1. reconcile orphans        (tool.started with no terminal event)
  2. consume human answers
  3. loop:
       renew lease            (lost lease ⇒ stop, never clobber the new owner)
       check budget
       check no-progress      before spending another model call
       authorize(model) → call model → model.responded
       for each tool call:
         recovery(args) → authorize → allow | deny | escalate
         escalate ⇒ persist HumanRequest, RELEASE LEASE, exit
         allow    ⇒ tool.started → run → tool.succeeded | tool.failed
       snapshot every N events
```

Two details that matter:
- **Escalation releases the lease.** A run waiting on a human occupies no worker.
- **No-progress is checked *before* the model call**, so a stuck run stops costing money immediately.

## Durability

| mechanism | purpose |
|---|---|
| lease with expiry | a dead worker releases its claim without cooperating |
| **lease token (fencing)** | a worker that lost its lease cannot write |
| reaper | reclaims expired leases; parks after N attempts |
| compare-and-set reclaim | two reapers cannot both act |
| `synchronous=FULL` | a committed event survives power loss (~20× append cost, measured) |

## What is NOT here, deliberately

No semantic memory, skills, subagents, MCP, multiple providers, multiple sandboxes, Postgres,
consensus, RL, learned routing, planners, or plugin system. Each was considered and deferred: none
solves a failure mode this V0 has actually encountered.
