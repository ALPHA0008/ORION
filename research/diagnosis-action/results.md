# Results

## §21 metrics, both models, 22 tasks each

| metric | Gemma | Qwen |
|---|---:|---:|
| `diagnosis_complete` | 13 | 4 |
| `action_attempted` | 13 | 2 |
| **`diagnosis_to_action_rate`** | **1.00** | 0.50 |
| **`correct_action_given_correct_diagnosis`** | **1.00** | 0.50 |
| `premature_completion` | 1 | **19** |
| — empty (no prose, no tool call) | **0** | **12** |
| `action_latency` (mean model calls) | 9.5 | 5.0 |
| `task_success` | 15 | 3 |

## Outcome classes (§4)

| | Gemma | Qwen |
|---|---:|---:|
| A diagnosis → correct action | 13 | 2 |
| B diagnosis → wrong action | 0 | 0 |
| **C diagnosis → no action** | **0** | **2** |
| D diagnosis not established | 9 | 18 |

## Prompt experiment (§8–§9)

| | Gemma | Qwen |
|---|---|---|
| pass | **4/7 → 2/7** (regressed) | 0/7 → 1/7 |
| runs with a mutation | 5 → 6 | 0 → 1 |
| mean model calls | 17.9 → **28.1** | — |
| mean tokens | 92,740 → **190,082** | — |
| empty completions | 0 → 0 | **5 → 6** |

Gemma acted *more* and succeeded *less*. Qwen's dominant failure was unmoved by a prompt that
explicitly forbids it.

## Control-loop finding (§12)

`v0/tests/completiongate/completiongate.test.mjs` — 13 assertions, investigative:

| situation | loop verdict | world |
|---|---|---|
| genuinely done | `completed` | changed ✅ |
| prose diagnosis | `completed` | **unchanged** ❌ |
| **empty response** | `completed` | **unchanged** ❌ |
| empty response **mid-exploration** | `completed` | **unchanged** ❌ |

A zero-mutation run is already observable from projection state (`budget.tool_calls === 0`).

## Falsification applied to the prompt candidate (§22)

| criterion | triggered? |
|---|---|
| increases action but not correctness | **YES** — Gemma 5→6 mutations, 4/7→2/7 pass |
| works for only one model | **YES** — helped Qwen slightly, harmed Gemma |
| increases false completion | Qwen empty completions 5→6 |

Rejected.

## Regression

**579 passed, 0 failed across 22 suites** (was 566/21). `v0/src` unchanged — the only production
file touched is the eval runner, and only behind an opt-in flag that is off by default.
