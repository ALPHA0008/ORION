# Prompt Experiment (§8–§9) — NOT SHIPPED

## Candidate

Appended to the current system prompt, identical for both models, opt-in behind
`ACTION_PROMPT=1` in the **eval runner only** (`v0/src` untouched):

> After identifying the required change, continue executing the task. Do not report completion
> until the requested world-state change has been made and verified.

Task subset: the 7 `camelcase` tasks — the repo where the diagnosis→action claim was strongest.

## Results

| | Gemma before | **Gemma after** | Qwen before | **Qwen after** |
|---|---:|---:|---:|---:|
| pass | 4/7 | **2/7** | 0/7 | **1/7** |
| runs with a mutation | 5 | 6 | 0 | **1** |
| mean model calls | 17.9 | **28.1** (+57%) | — | — |
| mean tokens | 92,740 | **190,082** (+105%) | — | — |
| empty completions | 0 | 0 | **5** | **6** |

## Reading

**Gemma REGRESSED, 4/7 → 2/7.** Mutations rose 5 → 6 while success fell — it acted *more* and
succeeded *less*. The trajectories show why: runs now reach 33–40 model calls and 217–388k tokens
and terminate on `budget_exhausted`, `no_progress` and `incorrect_solution`. Told not to report
completion until verified, it keeps grinding instead of stopping.

This is falsification criterion §22 exactly: **more action, not better outcomes.**

**Qwen improved marginally, 0/7 → 1/7**, and one run finally mutated. But its dominant failure did
not move: **empty completions went 5 → 6**, despite a prompt that explicitly forbids reporting
completion prematurely. The instruction does not reach the behaviour that is actually ending its
runs.

## Conclusion (§9, §15)

Outcome **A ("prompt change solves it") is refuted.** The behaviour is *marginally* responsive to
action framing for one model and actively harmed for the other. Nothing here is shippable.

Consistent with phase 5, where a prompt policy also failed to create an invariant in either model:
**prompt text is advisory; it does not reliably change what the loop accepts as done.**

The experimental prompt is left opt-in and **off by default** in the eval runner, as the honest
control arm for any follow-up. `DEFAULT_SYSTEM` is unchanged.
