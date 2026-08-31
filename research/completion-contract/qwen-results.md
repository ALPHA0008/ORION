# Qwen 3.6 35B — Contract Results

Repository `is-number`, 4 tasks. Prompt, model config, tools and verifier unchanged.

| metric | before | after |
|---|---:|---:|
| task pass | 2/4 | 2/4 |
| runtime `completed` | 4 | **2** |
| `finished_without_change` | 0 | **2** |
| **false completions** | **2** | **0** ✅ |

## The primary target is met

The two runs that previously recorded `completed` with an unchanged world now record
`failed / finished_without_change`. The runtime stopped lying about its own terminal state.

## The continuation fired, and Qwen declined it

| task | continuations | turns | action after the continuation |
|---|---:|---:|---|
| `isnum-nan-guard` | 1 | 2 | **(none)** |
| `isnum-hidden-contract` | 1 | 2 | **(none)** |

Exactly one continuation each, recorded in the event log, and the model stopped again without
acting. `recovery_after_premature_stop` = **0/2** on live runs.

Reported plainly. The deterministic suite proves the mechanism *can* convert a premature stop into
a completed task; Qwen simply declined the second opportunity too. That is consistent with phase
9's attribution — its termination behaviour is a **model** property, and the contract was never
intended to fix it. What the contract fixes is the runtime's record.

## Not measured

The `camelcase` subset — where all 7 runs were previously false-completed — did not finish. One
task hung inside an Ollama model call (6 model calls, **0 continuations**, verified from the live
run's projection). That would have been the strongest demonstration and is **not claimed**.
