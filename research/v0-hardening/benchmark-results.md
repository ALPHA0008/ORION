# Benchmark Results — Phase O

Source: `v0/benchmarks/runtime.bench.mjs`. Reproducible: `SIZES=… DURABILITY=… node benchmarks/runtime.bench.mjs`.
Machine: Windows 11 26100, Node v24.18.0, `node:sqlite`, local SSD. All times in ms.

## Runtime (durability = normal)

| events | append p50 | append p95 | append p99 | full replay p50 | snapshot load p50 | snapshot load p99 | fork p50 | db size | bytes/event | hot state |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,300 | 0.0177 | 0.0417 | 0.0749 | 1.8 | 0.285 | 0.459 | 2.1 | 0.8 MB | 595 B | 8,421 B |
| 10,300 | 0.0164 | 0.0346 | 0.066 | 12.3 | 0.236 | 0.334 | 12.1 | 6.1 MB | 594 B | 8,470 B |
| 100,300 | 0.0139 | 0.0263 | 0.0421 | 128.6 | 0.235 | 0.423 | 154.1 | 59.8 MB | 596 B | 8,519 B |
| 1,000,300 | 0.0136 | 0.0254 | 0.0363 | 1784.5 | 0.237 | 0.426 | 1860.3 | 598.6 MB | 598 B | 8,568 B |

## Durability cost: synchronous=FULL vs NORMAL

An open question carried from the previous phase. Now measured.

| events | append p50 NORMAL | append p50 FULL | cost |
|---:|---:|---:|---:|
| 1,300 | 0.0177 ms | 0.3131 ms | **18x** |
| 10,300 | 0.0164 ms | 0.2921 ms | **18x** |

`FULL` fsyncs on every commit, so a committed event survives power loss — the correct setting when
the log is the source of truth. It costs roughly **20x on append**, but the absolute number
(~0.3 ms) is still two to three orders of magnitude below a model call. **V0 defaults to `FULL`.**

## What the numbers say

**Append does not degrade with run length.** p50 is flat at ~0.014 ms from 1.3k to 1,000,000
events. The event log is not a bottleneck at any scale tested.

**Hot state is constant** — 8,421 B at 1.3k events, 8,568 B at 1M. That is ADR-001 holding: a 1.02x
increase across a 770x increase in events.

**Snapshot load is flat** — p99 stays under 0.7 ms at 1M events, versus a 1,909 ms full replay.
Snapshots convert an O(n) load into an O(1) one, which is exactly what they are for.

**Fork is the one thing that scales badly** — O(n), because it copies events by INSERT:

| events | fork |
|---:|---:|
| 1,300 | 2.1 ms |
| 10,300 | 12.1 ms |
| 100,300 | 154.1 ms |
| 1,000,300 | 1860.3 ms |

Acceptable for interactive runs; needs copy-on-write before million-event runs are routine.
Recorded as a known limitation rather than fixed in V0.

**Storage is ~595 bytes/event** with 400-byte tool payloads — dominated by payload, as expected.
A 10,000-event run costs ~6 MB. A 1M-event run costs ~600 MB, which is when archival matters.

## Agent-level metrics — NOT MEASURED

The brief also asks for successful tasks, latency, tool calls, retries, recovery rate, human
intervention, tokens, cost, and cost per successful task **with a real model**.

**These were not measured. No model credentials are available in this environment.** The runtime
records every one of these fields (`state.budget` carries tokens, cost, tool calls, model calls;
`degraded` events carry retries; `human.requested` carries interventions) — so the instrumentation
exists and is exercised against the fake provider. What is missing is real-model data, not the
ability to collect it.

No numbers are estimated in their place.