# Capability Gap Analysis

Ranking uses the brief's formula:

```
priority = failure_frequency × impact × confidence / implementation_complexity
```

A gap is only listed if it is **measured**. Nothing here is ranked on intuition.

## The honest headline

The dataset does not fail the agent (34/34 scored runs pass). Therefore **no capability gap can
be ranked from failure frequency yet.** Ranking gaps from a 100%-pass dataset would be ranking
noise, and the brief's loop explicitly forbids building before measuring.

What the event log *did* surface is a gap in a dimension that pass/fail cannot see: **cost**.

## G-01 — Context re-transmission dominates cost on exploration tasks

**Evidence** (`eval/reports/v1-full-17.json`, task `wide-units-mismatch`):

| metric | value |
|---|---:|
| input tokens | **127,712** |
| output tokens | 731 |
| model calls | 22 |
| mean input per call | 5,805 |
| share of *all* input tokens across the 17-task dataset | **58.7%** |
| ratio vs mean of the other 16 tasks | **22.8×** |
| wall time split | 20.3s model / 2.6s tool / 0.1s other |
| messages total / hot / dropped | 44 / 40 / 4 |

One task out of seventeen consumes more input tokens than the other sixteen combined. The cause
is structural, not model-specific: the agent read 15 files, and the bounded projection resends
the whole 40-message window on **every** subsequent model call. Input tokens grow roughly
quadratically in the number of reads, while output stays flat (731 tokens — the agent is barely
writing anything; it is re-reading).

The 175:1 input-to-output ratio is the signature. 88% of wall time is model time, and almost all
of that model time is spent re-processing context the agent has already seen.

**Why this is a real gap and not just "big files":** the projection is doing its job correctly
(it clamped 12 files over `MSG_CLAMP` and dropped 4 messages past `WINDOW`). The gap is that
dropping is the *only* tool available. The runtime can currently forget context but cannot
**compact** it — `context.compacted` events have never once fired in any eval run.

**Scoring:**

| factor | value | justification |
|---|---|---|
| failure_frequency | *low* as failure, **high** as cost | 0/34 correctness failures, but 1/17 tasks = 59% of spend |
| impact | **high** | determines whether long tasks are affordable at all; scales with task size |
| confidence | **high** | directly measured from the event log, reproducible across 2 runs |
| implementation_complexity | **medium** | the event type (`context.compacted`) and the seam already exist |

**Priority: highest of the measured gaps** — and the only one with evidence behind it.

**Important caveat:** this is a gap in *efficiency*, not capability. Fixing it should be expected
to reduce tokens, **not** to raise the success rate — the success rate is already 100% and cannot
go up. Any iteration targeting G-01 must therefore be judged on cost-per-success with success
rate as a **regression guard**, not as the win condition. Claiming a capability improvement from
a token reduction would be misreporting the result.

## G-00 — The dataset itself (blocking everything else)

The true top-priority gap is that the benchmark cannot yet discriminate. Hard-tier tasks were
added specifically to force failure and **still all passed**:

| task | targeted mechanism | did the mechanism fire? | outcome |
|---|---|---|---|
| `wide-units-mismatch` | projection dropping | **yes — 4 messages dropped** | PASS |
| `cold-cache-crash` | tool failure + recovery | no recovery decision | PASS |
| `double-discount` | multi-hop causal reasoning | n/a | PASS |
| `ten-file-migration` | long-horizon completeness | 10/10 migrated | PASS |
| `readme-injection` | instruction hierarchy | injection ignored | PASS |

The one genuine success of the hard tier is `wide-units-mismatch`: it is the first task in the
project's history to force the bounded projection to drop real messages under load — and the
agent solved it anyway. That is **empirical validation of ADR-001**, obtained from a task
designed to break it.

Until the dataset produces genuine agent failures, capability work is unfalsifiable: there is no
red to turn green. The next dataset iteration must escalate along the axes that showed the most
headroom — turn count (peak 22 of 60), tool-failure density, and cross-task ambiguity requiring
escalation (`ask_user` has never been called).

## What is deliberately NOT proposed

Per the brief's forbidden list, and because nothing measured justifies them: semantic memory,
skills, vector databases, swarms, consensus, RL, learned routing, marketplaces, multi-provider
infrastructure, additional sandbox backends, enterprise governance, visual workflow builders.

No evidence gathered so far points at any of them.
