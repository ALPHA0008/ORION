# Real-Agent Results (§11–§15)

Contract wired into the eval runner **opt-in** (`COMPLETION_CONTRACT=1`), using each task's own
deterministic `test_command` as `objectiveSatisfied`. Prompts, models, tools, verifier, sandbox
and task set unchanged (§16).

## Gemma 4 31B — `p-limit`, 4 tasks

| | before | after |
|---|---:|---:|
| task pass | 4/4 | **4/4** |
| runtime `completed` | 4 | 4 |
| `finished_without_change` | 0 | 0 |
| **false completions** | 0 | **0** |

**No regression** (§25-D clear). Gemma never had the defect — 0 empty completions across 66 runs
— so the contract correctly does nothing for it. A change here would have been the warning sign.

## Qwen 3.6 35B — `is-number`, 4 tasks

| | before | after |
|---|---:|---:|
| task pass | 2/4 | 2/4 |
| runtime `completed` | 4 | **2** |
| `finished_without_change` | 0 | **2** |
| **false completions** | **2** | **0** ✅ |

The two runs that previously reported `completed` with an unchanged world now report
`failed / finished_without_change`.

## §14 — did the continuation recover work? On live models, no.

| task | reason | continuations | turns | action after continuation |
|---|---|---:|---:|---|
| `isnum-nan-guard` | `finished_without_change` | 1 | 2 | **(none)** |
| `isnum-hidden-contract` | `finished_without_change` | 1 | 2 | **(none)** |

The mechanism fired exactly as designed — one continuation, one extra turn, recorded in the event
log — and **Qwen did not act on it**. It stopped again.

This is reported plainly rather than framed as a win. In the deterministic suite a continuation
*does* convert a premature stop into a completed task, so the mechanism works; on these live runs
the model simply declined the second opportunity too, which is consistent with phase 9's finding
that its termination behaviour is a model property.

**So the value delivered here is runtime truth, not recovered capability.** §17 anticipated
exactly this and says it still counts:

> before: task FAIL, runtime COMPLETED → after: task FAIL, runtime FINISHED_WITHOUT_CHANGE

## Cost

Each would-be completion under contract runs the task's test command once. On `is-number` that is
~1–2 s against runs of 60 s, and on `p-limit` it did not change the profile (Gemma 4/4 at 34 s p50
vs 40 s baseline). Reported because it is a real, if small, cost of asking the world instead of
trusting the model.

## Incomplete measurement, stated honestly

The Qwen `camelcase` run — the repository with all 7 false completions — **did not finish**. One
task (`camel-identifier-endanchor`) hung on the Ollama endpoint at 6 model calls with **0
continuations granted**, i.e. stalled inside the model call, not inside the contract. Verified by
inspecting the live run's projection rather than assuming.

That subset would have been the strongest demonstration (7 false completions → 0). It is not
claimed. The `is-number` result (2 → 0) is what was actually measured on Qwen.
