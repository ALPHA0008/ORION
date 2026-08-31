# Model Comparison at the Transition (§17–§18)

| Metric | Gemma 4 31B | Qwen 3.6 35B |
|---|---:|---:|
| diagnosis-complete runs | **13** | 4 |
| diagnosis → action | **13** | 2 |
| diagnosis → **no action** (type C) | **0** | **2** |
| incorrect action (type B) | 0 | 0 |
| **premature final response** | **1** | **19** |
| — of which **empty** (no prose, no tool call) | **0** | **12** |
| mean action latency (model calls) | 9.5 | 5.0 |
| **`action_success_given_correct_diagnosis`** | **1.00** | 0.50 |
| task success | 15/22 | 3/22 |

## The two models fail differently

**Gemma: diagnosis→action is not broken.** 13 of 13 diagnosed runs issued a mutation, and all 13
passed. Rate **1.00**, zero type-C. Its failures are *diagnosis* failures (type D, 9 runs) — it
did not diagnose and then decline to act; it did not diagnose.

**Qwen: the dominant mechanism is not type C at all.** Only 2 runs match the hypothesis. **12 of
22 end on an empty response** — no tool call, no text — often mid-exploration. One was paging at
line 144 of a 224-line file and replied with 7 empty tokens; the loop recorded `completed`.

Gemma produced **zero** empty completions across three independent 22-task reports.

## What this does to the phase-B claim

Phase B concluded a shared cross-model diagnosis→action gap, citing Qwen's 19/19 `no_edits_made`
and Gemma failing 3 of the 6 tasks neither solved.

Measured with a conservative detector:

- Qwen's `no_edits_made` is **real** but is mostly **empty-response termination**, not
  "diagnosed then declined".
- Gemma's 3 shared failures are **type D** — no diagnosis was established on them.

The phase-B inference — that both models reach a correct diagnosis and stall — is **not supported
by the trajectories**. The two models share a *symptom* (`no_edits_made` / zero mutations) with
**different causes**.

## What they do share

One harness property, and it is not model-specific:

> **The loop accepts any response without tool calls as `completed`, regardless of the task
> contract or the world state.**

That is what converts Qwen's empty replies into "successful" runs, and what would convert a
prose-only diagnosis into one too. It affects both models identically; only Qwen currently
triggers it often.
