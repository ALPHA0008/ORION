# Defining DIAGNOSIS_COMPLETE (§2)

## Constraint

No LLM judge (§2, §19). Detection must come from trajectory evidence plus task-specific signals,
and must be **conservative** — if it cannot be reliably established, report UNDETECTED rather than
guess.

## The detector

A run is `DIAGNOSIS_COMPLETE` only when **both** hold:

1. **It looked** — the trajectory contains at least one `read` of the source.
2. **It named the concrete defect** — the final message matches a task-specific signal: the actual
   symbol or construct the task turns on, not merely the filename.

Signals are per-task and specific, e.g.:

| task | signal |
|---|---|
| `camel-unicode-uppercase` | `\p{Lu}` or `UPPERCASE` |
| `plimit-active-count` | `activeCount` |
| `isnum-finite-inversion` | `isFinite` |
| `slug-decamelize-acronym` | `decamelize` or `[A-Z]` |

Mentioning the file is not enough; the run must name the thing that is wrong.

## Why this is deliberately strict

It **under-counts** diagnoses. A run that reasoned correctly but phrased its conclusion without the
signal token is scored `false`. That direction of error is the safe one: it cannot manufacture
evidence for the hypothesis under test.

Where the detector says `false`, the trajectories were read to confirm the verdict — and in
several cases the "final message" is genuinely **empty**, or is unrelated content (Qwen listing
`/tmp` directories on `plimit-active-count`). Those are correctly not diagnoses.

## The four outcomes (§4)

| label | meaning |
|---|---|
| **A** | correct diagnosis → mutation → PASS |
| **B** | correct diagnosis → mutation → FAIL |
| **C** | **correct diagnosis → no mutation** ← the hypothesis |
| **D** | diagnosis not established |
| UNDETECTED | no signal defined for the task |

## Metrics (§21)

```
diagnosis_to_action_rate = diagnosed runs issuing a mutation / diagnosed runs
correct_action_given_correct_diagnosis = A / diagnosed runs
premature_completion = model_finished with zero mutations
action_latency = model calls before the first mutation
```

## Honest limitation

The detector reads the **final message**. A model that diagnosed correctly mid-run and then
emitted an empty final response scores `false`, even though the earlier reasoning may have been
sound. That case turned out to matter — see [`completion-analysis.md`](completion-analysis.md) —
and it is reported as its own mechanism rather than folded into C.
