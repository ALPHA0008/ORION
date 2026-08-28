# EVAL — Objective Capability Measurement

An evaluation harness for this agent runtime. Deterministic verifiers, no LLM judge, all
behavioural metrics derived from the durable event log.

## Quick start

```bash
export HARNESS_BASE_URL=http://<host>:8000/v1
export HARNESS_API_KEY=<key>
export HARNESS_MODEL=<model>

node eval/cli/index.mjs list                      # show the task set
node eval/cli/index.mjs run                       # run everything
node eval/cli/index.mjs run --difficulty hard     # filter by difficulty/category/ids
node eval/cli/index.mjs report  <results.json>
node eval/cli/index.mjs compare <base.json> <candidate.json>
```

`run` **exits 2** if no model is configured. The evaluation never silently falls back to a
scripted model.

Optional: `HARNESS_COMPACT=1` enables context compaction (see [iteration 01](research/eval/iteration-01.md)).

## Layout

```
eval/
├── tasks/         schema.mjs, index.mjs (core), hard.mjs (hard tier)
├── environments/  fixtures.mjs, hard-fixtures.mjs   — content-addressed
├── evaluators/    deterministic verification
├── metrics/       event-log-derived metrics + aggregation
├── runners/       harness-agnostic runner interface
├── cli/           list | run | report | compare
└── reports/       committed results
```

## Task set

17 tasks — 5 easy, 6 medium, 6 hard — over 13 content-addressed fixtures. Categories:
`bug_fix`, `exploration`, `refactor`, `feature`, `cli`, `deps`, `multi_file`, `edge_case`,
`context_pressure`, `recovery`, `multi_hop_reasoning`, `long_horizon`, `completeness`,
`instruction_hierarchy`, `safety`.

Several verifiers are explicitly anti-gaming — they reject plausible non-solutions such as
editing the test instead of the source, committing a fixture instead of fixing the library, or
migrating 9 of 10 files. See [benchmark methodology](research/eval/benchmark-methodology.md).

## Current results

| run | tasks | success | tokens/success |
|---|---|---|---|
| [`v0-baseline`](eval/reports/v0-baseline.md) | 12 | 100% | 4,802 |
| `v1-full-17` | 17 | 100% | 13,163 |
| `v1-compact` | 17 | 100% | 11,941 |

**Read the ceiling before reading the score.** A 100% pass rate means the dataset has no
discriminating power — it cannot rank harnesses, detect capability regressions, or locate gaps.
The most important open work is making the dataset hard enough to fail. See
[capability gap G-00](research/eval/capability-gap.md).

## What the event log bought

The project's thesis is that *the event log makes agent runs measurable and improvable, not just
recoverable.* Concretely, in this phase it:

- **located the bottleneck** — one task consumed 58.7% of all input tokens, 22.8× the mean,
  visible only from per-call token counts;
- **validated ADR-001 under real load** — `wide-units-mismatch` is the first task ever to force
  the bounded projection to drop live messages (4 dropped), and the agent still solved it;
- **falsified a hypothesis** — per-event attribution showed the compaction win came from a
  different mechanism than predicted, turning a misleading −9.3% aggregate into a defensible
  −3.3%. See [iteration 01](research/eval/iteration-01.md).

## Documents

- [`research/eval/baseline.md`](research/eval/baseline.md) — frozen pre-eval state
- [`eval/reports/v0-baseline.md`](eval/reports/v0-baseline.md) — golden baseline
- [`research/eval/failure-taxonomy.md`](research/eval/failure-taxonomy.md)
- [`research/eval/capability-gap.md`](research/eval/capability-gap.md)
- [`research/eval/iteration-01.md`](research/eval/iteration-01.md)
- [`research/eval/benchmark-methodology.md`](research/eval/benchmark-methodology.md)
- [`research/eval/summary.md`](research/eval/summary.md)

## Limitations

Synthetic fixtures (not real repo history), one model, one runner, no statistical power, and a
ceiling effect at 100%. No comparative claim against any other harness is made. Details in the
[methodology](research/eval/benchmark-methodology.md).
