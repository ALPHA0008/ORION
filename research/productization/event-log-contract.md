# Event Log Contract — the Core OSS Differentiator

`v0/src/core/event/index.mjs`. **A frozen, closed set of 31 event types**
(`Object.freeze`), with `isKnownType()` rejecting anything outside it (`UnknownEventType`).

That closure is the differentiator. Most agent frameworks log opportunistically; here the log is a
**contract** — you cannot append a type nobody agreed to.

## The 31 types

| group | types |
|---|---|
| **lifecycle** | `run.created`, `run.leased`, `run.lease_renewed`, `run.lease_lost`, `run.paused`, `run.resumed`, `run.parked`, `run.completed`, `run.failed` |
| **turn** | `turn.started`, `turn.finished` |
| **model** | `model.requested`, `model.responded`, `model.failed` |
| **tool** | `tool.requested`, `tool.authorized`, `tool.denied`, `tool.escalated`, `tool.started`, `tool.succeeded`, `tool.failed`, `tool.timed_out` |
| **recovery** | `tool.recovery_decided` |
| **context** | `context.compacted`, `context.retrieved` |
| **human** | `human.requested`, `human.responded`, `human.timed_out` |
| **children** | `child.spawned`, `child.finished` |
| **degradation** | `degraded` |

`TERMINAL = { completed, failed, parked }`.

## Semantics of the load-bearing types

| event | meaning | producer | consumer | durability | replay implication | status |
|---|---|---|---|---|---|---|
| `run.created` | run exists; carries task + `scope` | CLI / API | projection, explain | durable | origin of state | **PUBLIC** |
| `run.leased` / `_renewed` / `_lost` | execution fencing (ADR-008) | worker | reaper, projection | durable | proves single-writer | **PUBLIC** |
| `run.paused` | awaiting human; claimable (ADR-009) | worker | CLI `answer`, reaper | durable | resumable point | **PUBLIC** |
| `turn.started` | new turn; `continuation` flag (ADR-013) | worker | projection | durable | turn boundary for **fork** | **PUBLIC** |
| `model.requested` | about to call provider | worker | metrics | durable | marks in-flight on crash | **PUBLIC** |
| `model.responded` | normalised result: content, tool_calls, tokens, cost, duration, `ext` | adapter→worker | projection, metrics, explain | durable | **replayed, never re-called** | **PUBLIC** |
| `model.failed` | provider error | adapter | recovery | durable | retry/degrade evidence | **PUBLIC** |
| `tool.requested` → `authorized`/`denied`/`escalated` | authorization decision trail | worker + authorizer | audit, explain | durable | policy replay | **PUBLIC** |
| `tool.started` | **carries `args` incl. runtime-injected witness** | worker | recovery | durable | **the crash-survival record (ADR-011)** | **PUBLIC** |
| `tool.succeeded` / `failed` / `timed_out` | outcome + result | worker | projection | durable | tool result replayed | **PUBLIC** |
| `tool.recovery_decided` | class + decision + reason (ADR-002/003) | recovery | operator | durable | explains post-crash choice | **PUBLIC** |
| `human.requested` / `responded` / `timed_out` | escalation lifecycle | worker, CLI | approvals | durable | resume point | **PUBLIC** |
| `context.compacted` | supersession record | compactor | projection | durable | reconstructs elision | **EXPERIMENTAL** (off by default) |
| `context.retrieved` | retrieval record | — | — | durable | **reserved — no producer today** | **RESERVED** |
| `child.spawned` / `finished` | sub-run linkage | — | — | durable | **reserved — no producer today** | **RESERVED** |
| `degraded` | named fallback: subsystem + reason | any | operator | durable | **nothing degrades silently** | **PUBLIC** |

## Notable design properties

**1. There is no `model.finished` event.** Completion is derived from `model.responded` (`finish`
flag) plus a terminal `run.*`. The Wave-1 brief listed one; the implementation does not have it, and
inventing one would be wrong — §7 says do not invent types the architecture does not require.

**2. There is no `crash` event.** A crash is, by definition, the *absence* of a subsequent event.
Recovery infers it from a `tool.started` with no terminal partner (`repairOrphans`). This is
correct: a process that dies cannot log its own death.

**3. `fork` is not an event.** Forking creates a **new run** whose history is seeded from another's
prefix. The parent log is never mutated — append-only holds.

**4. `degraded` is the anti-silent-failure primitive.** Verified live: a Gemma run emitted 36
`degraded` events, one per shim application, each naming `model_adapter` and the shim.

**5. ADR-004 promoted `cost_usd` and `duration_ms` to first-class fields** rather than burying them
in `ext`, because every provider has them and they answer first-order operational questions.

## Durability

SQLite via `node:sqlite`, append-only. `.gitignore` correctly excludes `*.db`, `*.db-wal`,
`*.db-shm` — runtime state is never source. `doctor` reports `db integrity`.

## Replay implication — the central claim

`replay()` reconstructs run state **with zero model calls**, verified live in this audit:

```
Replay of #95044d62bb
reconstructed from the event log — no model calls, no cost
events 17 · turns 1 · model calls 2 · tool calls 1 · tokens 1987 (in 1188 / out 799)
```

`verifyProjectionEquivalence` asserts the reconstruction matches the original projection.

## Public / private split

- **PUBLIC:** the 31-type list, `TERMINAL`, `isKnownType`, and the payload shape of
  `model.responded` (documented via `modelRespondedPayload`).
- **INTERNAL:** SQLite schema, table layout, indices. Consumers should read through `Store`.
- **RESERVED:** `context.retrieved`, `child.spawned`, `child.finished` — declared, no producer. Ship
  them as reserved rather than removing; removal would break the frozen-set guarantee later.
