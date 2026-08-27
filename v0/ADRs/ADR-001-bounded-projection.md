# ADR-001 — Bounded state projection

**Status:** Accepted (revised in this phase) · **Supersedes:** the `messages[]` projection in ARCHITECTURE.md §2.2

## Context
State is derived by folding the event log. The projection is loaded on every worker claim and
held in memory for the duration of a run, and it is what gets snapshotted.

## Original decision
```
State = fold(Event[]) -> { status, messages[], pending_tool_calls[], budget_consumed, ... }
```
`messages[]` held the whole conversation.

## Evidence
Proof-phase Experiment 1 (`research/proof/01-event-log/results.md`):

| config | state @100k | snapshot-load p99 @100k |
|---|---|---|
| unbounded, SQLite | 8.03 MB | 17.65 ms |
| unbounded, Postgres | 8.03 MB | **100.26 ms** (target was 50 ms) |
| bounded, SQLite | 10.9 KB | 0.04 ms |
| bounded, Postgres | 10.8 KB | 0.93 ms |

Diagnostic: snapshot *interval* barely mattered (13.97 ms @100 vs 14.82 ms @5000). That is the
signature of a cost that is not in the tail replay — it was parsing an ever-growing blob.

## Failure discovered
**Snapshotting an unbounded projection does not reduce cost; it relocates it.** The original design
fails its own latency target on the store intended for multi-worker deployment — and it fails
*silently*, because every functional test passes.

**Second failure, found in THIS phase** (Phase H, Test 7): capping the message *count* is not enough.
A 40-message window of 4 KB tool results still grew the projection ~1.8x. Bounding requires a
per-message byte clamp as well.

## Revised decision
```
WINDOW    = 40      messages retained hot
MSG_CLAMP = 2000    bytes retained per hot message
```
Hot state = counters + open items + a windowed, byte-clamped message list. Full content stays in
the event log and is retrievable. Bound is `WINDOW × MSG_CLAMP` (~90 KB) regardless of run length.

## Tradeoffs
- The model sees a window, not the whole history. Mitigated by injecting an explicit
  `[N earlier messages are not shown…]` notice, and by `dropped_message_count` in state — elision
  is **counted, never silent**.
- Long-context tasks that genuinely need distant detail will need retrieval. Not in V0.
- `MSG_CLAMP` truncates large tool results in the prompt; the tool itself already clamps at source.

## Tests
- `tests/unit/event-store.test.mjs` §4.3 — 1k/10k/100k/**1M** events: 7,843B → 7,993B (**1.02× over
  1000× more events**); hot window ≤ 40; state < 32 KB at 1M.
- `tests/integration/provider.test.mjs` Test 7 — under real HTTP load with 4 KB payloads: peak
  89,417B ≤ ceiling 96,800B; **plateaus at 0.954×** over the last 40% of the run.
- `benchmarks/runtime.bench.mjs` — hot state 8,421B @1.3k → 8,568B @1M.
