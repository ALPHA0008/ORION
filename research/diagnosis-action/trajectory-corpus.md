# Trajectory Corpus (§5, §6)

Classified with `eval/real/setup/diagnosis-action.mjs` over the committed 22-task reports for both
models — no LLM judge, conservative detector (§2).

## Headline: the phase-B claim does not survive measurement

| metric | Gemma | Qwen |
|---|---:|---:|
| runs | 22 | 22 |
| `diagnosis_complete` | 13 | 4 |
| action attempted | **13** | 2 |
| **`diagnosis_to_action_rate`** | **1.00** | 0.50 |
| `correct_action_given_correct_diagnosis` | **1.00** | 0.50 |
| **premature completion** | **1** | **19** |
| task success | 15 | 3 |
| mean action latency (model calls) | 9.5 | 5.0 |

### Outcome distribution (§4)

| | Gemma | Qwen |
|---|---:|---:|
| **A** diagnosis → correct action | **13** | 2 |
| **B** diagnosis → wrong action | 0 | 0 |
| **C** diagnosis → **no action** | **0** | **2** |
| **D** diagnosis not established | 9 | 18 |

**Gemma has ZERO type-C runs.** Every run in which it demonstrably diagnosed the defect also
issued a mutation, and every one of those passed. Its `diagnosis_to_action_rate` is **1.00**.

Phase B inferred a shared stage-5 gap from Gemma failing 3 of the 6 tasks neither model solved.
Measured against the conservative detector, those runs are **type D** — Gemma never established
the diagnosis on them. It did not diagnose and then decline to act; it did not diagnose.

## What Qwen is actually doing

Qwen's 2 type-C runs are real but are **not** the dominant mechanism. The dominant fact is
different and was not in the phase-B hypothesis at all:

**12 of 22 Qwen runs terminate with a response containing no tool calls AND no text.**

| model | `model_finished` with prose | `model_finished` **empty** |
|---|---:|---:|
| Gemma (3 separate reports) | 16, 16, 14 | **0, 0, 0** |
| Qwen | 10 | **12** |

The clearest example, `camel-separator-strip` — the model is **mid-exploration**, paging through a
224-line file:

```
· read {"offset":110,"path":"index.js"}   ✓ lines 110-143 of 224
· read {"offset":144,"path":"index.js"}   ✓ lines 144-198 of 224
🧠 ""  4089→7tok
✓ completed — model_finished
```

A **7-token empty reply** at line 144 of 224, and the loop recorded `completed`. That is not a
diagnosis that failed to become an action. It is a run that **stopped mid-investigation** and was
scored as finished.

Another, `plimit-active-count`: Qwen's final message is a table of `/tmp/fx-*` fixture directories
— unrelated wandering, not analysis.

## Detector honesty

The detector under-counts by design (§2). Where it reports `false`, the trajectories were read: in
several cases the final message is **genuinely empty**, or is unrelated content. Those are
correctly not diagnoses, so the low Qwen `diagnosis_complete` count is a real property of the
corpus rather than a detector artifact.

Its known limitation — it reads the *final* message, so a correct mid-run diagnosis followed by an
empty reply scores `false` — is exactly the case that turned out to matter, and it is reported as
its own mechanism rather than folded into C.

## Revised reading

There is no single cross-model "diagnosis → action" gap in this corpus. There are **two different
things**:

1. **Gemma**: diagnosis→action is not broken (1.00). Its failures are diagnosis failures.
2. **Qwen**: 12/22 runs end on an empty response, most while still exploring. Two runs are
   genuine type C.

And underneath both sits one harness property: **the loop treats any response without tool calls
as `completed`**, regardless of whether the task's world-state change happened.
