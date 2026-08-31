# Gemma 4 31B — Contract Results

Repository `p-limit`, 4 tasks. Prompt, model config, tools and verifier unchanged.

| metric | before | after |
|---|---:|---:|
| task pass | 4/4 | **4/4** |
| runtime `completed` | 4 | 4 |
| `finished_without_change` | 0 | **0** |
| false completions | 0 | **0** |
| mean model calls | — | 10.25 |
| p50 wall | 40 s | 34 s |

## Reading

**The contract correctly does nothing for Gemma.**

Phase 9 measured 0 empty completions across 66 Gemma runs and a `diagnosis_to_action_rate` of
1.00 — it does not stop before finishing. So the expected result of applying a completion contract
is *no change*, and that is what happened.

This is the control arm. §25-D would have rejected the intervention if Gemma's success regressed;
it did not. Had the contract altered Gemma's behaviour at all, that would have indicated the
predicate was firing when it should not.

## No spurious continuations

Zero continuations were granted across all four runs — every completion had its objective already
satisfied, so the contract never intervened. That is the correct behaviour for a model that
finishes what it starts.
