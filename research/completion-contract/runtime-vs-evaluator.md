# Runtime vs Evaluator Agreement (§20)

## The mismatch being fixed

Before: the **evaluator** verified world state and scored a run `FAIL`, while the **runtime**
recorded `completed`. Both were looking at the same run and disagreeing, and only one of them was
being watched.

`false_completed` = runtime `completed` **and** `task_success != PASS`.

## Measured

| | runs | runtime `completed` | `finished_without_change` | **FALSE-COMPLETED** | task pass |
|---|---:|---:|---:|---:|---:|
| **Qwen `is-number` BEFORE** | 4 | 4 | 0 | **2** | 2 |
| **Qwen `is-number` AFTER** | 4 | 2 | **2** | **0** ✅ | 2 |
| Gemma `p-limit` BEFORE | 4 | 4 | 0 | **0** | 4 |
| Gemma `p-limit` AFTER | 4 | 4 | 0 | **0** ✅ | 4 |

**Qwen's false completions: 2 → 0.** Each became an honest
`failed / finished_without_change`.

**Gemma is unchanged, which is the correct control result** — it never had this defect (0 empty
completions across 66 runs), so a contract that altered its behaviour would have been a red flag.

## What did NOT change

`task_success` is identical in both arms for both models. That is expected and is the point of
§17: the evaluator was already right. The fix is to the runtime's own record.

For Qwen `is-number`, one task (`isnum-finite-inversion`) passed in the contract arm that failed in
the baseline arm. With n=1 per cell that is run-to-run variance, not attributable to the contract,
and it is **not** claimed as an effect.

## The hierarchy, now consistent

```
Layer 1 execution truth   — event log            (already correct)
Layer 2 task contract     — requires_world_change (ADDED HERE)
Layer 3 model behaviour   — proposes "finished"
Layer 4 evaluator result  — verifies world state  (already correct)
```

Layer 2 was missing, so Layer 3's proposal was accepted unconditionally and Layer 1 recorded
something Layer 4 contradicted.
