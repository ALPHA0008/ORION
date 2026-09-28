# OSS Product Thesis — Technical Identity

Not marketing copy. This establishes what the project **technically is**, using only what exists.

## Candidate positioning

> A trajectory-native agent harness where runs are durable, observable, recoverable, replayable,
> forkable and explainable.

## Property-by-property classification

### Durable — **PROVEN**

Every run is an append-only event log in SQLite (`node:sqlite`), with a **frozen closed set of 31
event types** (`EVENT_TYPES`, `Object.freeze`). `isKnownType` rejects unknown types rather than
silently accepting them. Crash-matrix tests cover death at each boundary.

*Evidence:* `core/event/index.mjs`, `core/run/store.mjs`, `tests/crash/matrix.test.mjs`,
`crash-matrix.json`.

### Observable — **PROVEN**

The event log is the observability surface — not a side-channel. `explain` renders a sequenced
human-readable trajectory including token accounting and tool arguments. Verified live in this
audit:

```
1  · run created (scope personal:local)
3  ▸ task: Fix the bug in calc.py…
6  🧠 wants 1 tool call: grep 562→267tok
9  · grep {"pattern":"add","path":"calc.py"}
10 ✓ grep → (no matches) [INCOMPLETE RESULT]…
16 🙋 asked: "The file 'calc.py' is not found…"
17 ⏸ paused — awaiting_human
```

Also proven at a deeper level: **this project's own capability analysis was rescued repeatedly by
reading trajectories** when reported metrics disagreed with the event log. That is the property
being sold, demonstrated under adversarial conditions on itself.

### Recoverable — **PROVEN**

Six recovery classes with an explicit decision function; ADR-011's pre-state witness eliminated a
reproduced lost update; ADR-008 fencing; `repairOrphans`; lease reaping. Anything not provably safe
defaults to `UNSAFE` → escalate.

*Evidence:* `core/recovery/index.mjs`, `writewitness` (26 tests), `concurrency/lease` (51),
`crash/matrix`.

### Replayable — **PROVEN**

`replay()` reconstructs run state from the log with **zero model calls** — executed live during
this audit (17 events, full state, token totals). `verifyProjectionEquivalence` asserts the
reconstruction matches.

*Evidence:* `core/replay/index.mjs`, `replay/semantics` (44 tests), ADR-007.

### Forkable — **PROVEN**

`fork()` branches from a point in history; `nearestTurnBoundary` snaps to a coherent point;
`rerun()` re-executes the same task fresh. CLI-exposed (`fork <run> --at <seq>`).

*Evidence:* `core/replay/index.mjs`, `v0/docs/FORKING.md`, fork tests.

### Explainable — **PARTIALLY PROVEN**

`explain` works and includes `redact`. But "explainable" currently means *"a faithful rendering of
what happened"*, not *"an account of why the agent chose it"*. That is the honest boundary: the
mechanism is proven, the causal narrative is the operator's inference.

*Evidence:* `core/run/explain.mjs` (121 ln), executed live.

## Summary

| property | status |
|---|---|
| durable | **PROVEN** |
| observable | **PROVEN** |
| recoverable | **PROVEN** |
| replayable | **PROVEN** |
| forkable | **PROVEN** |
| explainable | **PARTIALLY PROVEN** — faithful rendering, not causal reasoning |

## Why this identity is defensible

It is **not** "another coding agent." The agent loop is deliberately small (527 lines) and has no
memory, planning, MCP, skills, or subagents. What is unusually developed is the **execution
substrate**: 13 ADRs, each forced by measured evidence, and 608 tests.

The strongest proof point is unplanned: across Stage 1, roughly **twenty infrastructure defects
were caught because the durable trajectory contradicted a reported metric** — and only two turned
out to be real task defects. A benchmark harness built on this runtime repeatedly caught *itself*
being wrong. That is the thesis, demonstrated rather than asserted.

## What the thesis must NOT claim

- Not competitive agent *capability* — Stage 1 measured 2–3/17 and 2/18.
- Not enterprise governance — that is Kernlbase, deliberately outside.
- Not "explains why" — it renders what happened.
- Not multi-provider maturity — one OpenAI-compatible adapter plus one shim.
