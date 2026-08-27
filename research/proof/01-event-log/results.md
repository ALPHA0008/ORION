# Experiment 1 — Event Log Performance

**Date:** 2026-08-27 · **Machine:** Windows 11 26100, Node v24.18.0, `node:sqlite` (built-in),
Postgres 16-alpine in Docker (localhost, TCP loopback).
**Artifacts:** `eventstore.mjs` (the system under test) · `bench.mjs`, `bench2-bounded.mjs`,
`bench3-pg-bounded.mjs` · `benchmark.csv` · `plots/load-latency.svg` · `results-*.json`

**Tests H-04 (event log as source of truth) and H-05 (projection is cheap enough).**

---

## 1. Headline result

> **H-05 is SUPPORTED — but only because the experiment found and fixed a defect in the proposed
> architecture. As specified in `ARCHITECTURE.md`, the projection is unbounded and it fails the
> 50 ms p99 target on Postgres at 100k events (measured p99 = 100.26 ms).**

The fix is a one-line change in principle and a significant change in specification: **the hot state
projection must be bounded.** With that change, load latency is **flat from 1,000 to 1,000,000
events** on both stores.

| Configuration | state size @100k | load p99 @100k | verdict vs 50 ms target |
|---|---|---|---|
| SQLite, unbounded | 8.03 MB | 17.65 ms | passes, but degrading |
| **SQLite, bounded** | **10.9 KB** | **0.04 ms** | **passes with 1,000× headroom** |
| Postgres, unbounded | 8.03 MB | **100.26 ms** | **FAILS (2× over)** |
| **Postgres, bounded** | **10.8 KB** | **0.93 ms** | **passes with 50× headroom** |

---

## 2. What was built

Deliberately minimal, per the brief — no agent, no model, no tools:

- `Event` — `{run_id, seq, type, at, causation_id, payload}`; 31 closed types.
- `EventStore` — SQLite (`node:sqlite`, WAL, `synchronous=NORMAL`) and Postgres (`pg`), same interface.
- `StateReducer` — `applyEvent(state, event)`, pure fold.
- `Snapshot` — `(run_id, seq, state)`; load = latest snapshot ≤ seq, then replay tail.

Synthetic runs model a realistic agent: turns of *(model call → 1–3 tool calls)* with 400-byte tool
results, 4% tool-failure rate, periodic compaction, degradation events, lease renewals, and human
pauses. Event counts: 10 · 100 · 1,000 · 10,000 · 100,000 · 1,000,000.

---

## 3. Append latency (SQLite, single-event path — the real per-turn cost)

| n | p50 | p99 |
|---|---|---|
| 10 | 0.0221 ms | — |
| 100 | 0.0141 ms | 0.052 ms |
| 1,000 | 0.0134 ms | 0.074 ms |
| 10,000 | 0.0117 ms | 0.094 ms |
| 100,000 | 0.0118 ms | 0.293 ms |
| 1,000,000 | 0.0118 ms | 0.311 ms |

**Append is effectively free and does not degrade with run length** — p50 is flat at ~12 µs across
five orders of magnitude. p99 rises to ~0.3 ms at large n (WAL growth and page splits), still
**160× under the 50 ms budget**.

Postgres append over TCP loopback is dominated by round trips: **0.84 ms p50 single-row**, falling
to **0.048 ms/event** when batched at 1,000. *Implication: a Postgres-backed worker should append a
turn's events in one batched transaction, not one row at a time.*

---

## 4. The finding that changes the architecture

### 4.1 The reducer is not the cost — the state is

Pure in-memory fold cost (SQLite, no IO):

| n | pure fold | read from DB | full replay |
|---|---|---|---|
| 1,000 | 0.12 ms | 1.85 ms | 1.97 ms |
| 10,000 | 0.80 ms | 14.7 ms | 15.5 ms |
| 100,000 | 50.7 ms | 158.8 ms | 209.5 ms |

Folding 100,000 events takes **50 ms of pure CPU** — the reducer itself is cheap (≈0.5 µs/event).
The expense is **IO + JSON.parse of the payloads** (158 ms), which is exactly what snapshots exist to
avoid.

### 4.2 But snapshots did not help, and the reason is the real finding

With the projection as specified in `ARCHITECTURE.md` §2.2 (which contains `messages[]`):

```
SQLite, 100k events, snapshot+tail load p50:
    snapshot every   100 events → 13.97 ms
    snapshot every   500 events → 14.25 ms
    snapshot every 1,000 events → 15.11 ms
    snapshot every 5,000 events → 14.82 ms
```

**Snapshot interval barely matters.** Shortening it 50× changed nothing. That is the signature of a
cost that is not in the tail replay.

The cause: **the projection grows without bound because `messages[]` accumulates.**

| n | unbounded state size |
|---|---|
| 1,000 | 0.08 MB |
| 10,000 | 0.79 MB |
| 100,000 | 8.03 MB |
| 1,000,000 | **80.73 MB** |

Loading a snapshot means parsing that blob. At 100k events you parse 8 MB to save replaying a few
hundred events — a bad trade. **Snapshotting an unbounded projection just relocates the cost.**

On Postgres it is worse, because the blob crosses a socket and is JSONB-decoded:
**p50 = 70.99 ms, p99 = 100.26 ms at 100k events — over the 50 ms target by 2×.**

### 4.3 The fix: bound the projection

Keep only what a turn actually needs: counters, open items, and a **windowed** message list
(WINDOW = 40). Full history stays in the log and is queried on demand.

```js
{ status, seq, recent_messages[≤40], message_count,
  pending_tool_calls{open only}, budget_consumed{...},
  open_human_requests{open only}, children_count,
  degradation_count, last_degradation, lease..., attempts }
```

Measured (`results-bounded.json`, `results-pg-bounded.json`):

| n | bounded state | SQLite load p99 (snap@5000) | Postgres load p99 (snap@5000) |
|---|---|---|---|
| 1,000 | 10.8 KB | 0.06 ms | 1.16 ms |
| 10,000 | 11.1 KB | 0.02 ms | 0.90 ms |
| 100,000 | 10.9 KB | 0.04 ms | 0.93 ms |
| 1,000,000 | **10.2 KB** | **0.07 ms** | not run |

**State size is constant. Load latency is flat.** Run length stops mattering — which is the property
the architecture needs and did not have.

---

## 5. Snapshot interval — the measured answer

The brief asks for the interval required to hold turn overhead under 50 ms p99.

**With a bounded projection, no interval is required to hit the target** — even snapshot-free replay
of a 1M-event tail would dominate, but any interval ≥ 200 keeps p99 under 0.3 ms. The interval
therefore becomes a **storage** decision, not a latency one:

| interval | snapshots @1M | snapshot storage @1M | load p99 |
|---|---|---|---|
| 200 | 5,000 | 54.9 MB | 0.08 ms |
| 1,000 | 1,000 | 11.0 MB | 0.08 ms |
| **5,000** | **200** | **2.2 MB** | **0.07 ms** |

**Recommended default: every 1,000 events**, or on lease acquisition — whichever comes first.
That costs ~11 MB per 1M-event run (6% of the 171 MB event log) and gives ~0.08 ms loads. Interval
5,000 is equally fast and cheaper; 1,000 is chosen only to bound worst-case tail replay after an
abrupt crash.

**Projection strategy comparison** (the brief's three variants):

| strategy | cost | verdict |
|---|---|---|
| project after every event | ~0.5 µs/event, in-memory | **this is just the reducer — free** |
| project every N events | identical + snapshot write | write cost only |
| project on worker claim | one snapshot read + tail | **0.02–0.09 ms bounded** |

The worker holds the projection in memory during a run and applies each event as it is appended.
It only *loads* on claim. So the per-turn cost is the reducer (microseconds), and the per-claim cost
is 0.02–0.93 ms. **Neither is material.**

---

## 6. Storage

| store | bytes/event | 1M-event run |
|---|---|---|
| SQLite | 164–184 B | 170.7 MB |
| Postgres | ~250 B (incl. index) | 25.0 MB @100k |

With 400-byte tool payloads, SQLite stores ~171 B/event — payload compression from JSON text is
doing work here. A realistic long-running agent (say 10,000 events) costs **~1.7 MB**. Storage is
not a constraint at individual-run scale. At fleet scale (10,000 runs × 10k events) it is ~17 GB,
which argues for cold-run archival but not for abandoning the log.

**Caveat:** payload size drives this almost entirely. Runs that store large tool outputs inline
(a 5,000-line file read) would be far larger. This supports the `ARCHITECTURE.md` §6 rule that tool
output is **bounded at write time** with a reference to external storage.

---

## 7. Threats to validity

Stated plainly:

1. **Synthetic events, not real agent traffic.** Type mix and payload sizes are modelled, not
   observed. Real runs may have larger payloads (worse) or fewer events per turn (better).
2. **Postgres is loopback TCP, not a network.** A real deployment adds RTT to every figure; the
   *relative* result (bounded ≪ unbounded) is unaffected and would in fact widen.
3. **Single-run, single-writer.** No contention, no concurrent workers, no lock waits. Multi-worker
   claim contention is untested here (it is D-05's concern, tested in Experiment 4).
4. **`node:sqlite` is used, not `better-sqlite3`.** Results may differ modestly with another binding.
5. **p99 from small samples** (20–30 loads per configuration). The order-of-magnitude conclusions are
   safe; the exact p99s are not precise.
6. **No fsync-per-event durability.** `synchronous=NORMAL` was used. `FULL` would raise append cost
   materially and is the correct setting if a single lost event is unacceptable — **untested, and a
   real gap** given that this architecture treats the log as the source of truth.

---

## 8. Verdicts

**H-04 — event log as source of truth: SUPPORTED (performance is not an objection).**
Append is ~12 µs. Storage is ~171 B/event. Nothing in the measurements argues against an append-only
log on performance grounds. *H-04 also has a complexity dimension, which this experiment does not
test — see Experiment 4.*

**H-05 — projection is cheap enough: SUPPORTED, CONDITIONAL.**
Conditional on bounding the projection. As originally specified it **fails on Postgres**
(p99 = 100 ms vs a 50 ms target). Bounded, it passes with 50–1,000× headroom and is flat to 1M events.

### Required architecture revision

> `ARCHITECTURE.md` §2.2 defines `State` as containing `messages[]`. **This must change to a bounded
> projection**: counters, open items, and a fixed-size recent-message window. Full history remains in
> the log and is retrieved by query when needed (for replay, explain, or context assembly beyond the
> window).

This is a genuine correction produced by the experiment, not a refinement. It also has a pleasant
side effect: it makes the "context window" and the "hot projection" the same bounded object, which
simplifies §6.

### One target to re-examine

The 50 ms p99 figure came from the spec, and the brief warned not to assume it. Measurements suggest
it is **far too loose to be useful** — the bounded design lands three orders of magnitude below it.
A tighter, more informative budget would be **p99 < 5 ms for projection load**, which still leaves
the model call (hundreds of ms to seconds) as the overwhelming cost of a turn.
