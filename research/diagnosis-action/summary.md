# Phase 9 Summary — The Diagnosis → Action Gap

**`v0/src` was not modified.** Investigation only, as required.

## The phase-B claim does not survive measurement

Phase B concluded: *both models reach a correct diagnosis and sometimes fail to convert it into a
mutation.* Measured with a conservative, judge-free detector over the committed 22-task corpora:

| | Gemma | Qwen |
|---|---:|---:|
| `diagnosis_complete` | 13 | 4 |
| **`diagnosis_to_action_rate`** | **1.00** | 0.50 |
| **type C — diagnosed, no action** | **0** | **2** |
| type D — no diagnosis established | 9 | 18 |
| premature completion | 1 | **19** |

**Gemma has zero type-C runs.** Every run in which it demonstrably diagnosed the defect issued a
mutation, and all 13 passed. Its failures are *diagnosis* failures, not action failures — it did
not diagnose and then decline to act; it did not diagnose.

Phase B inferred a shared gap from Gemma failing 3 of the 6 tasks neither model solved. Those runs
are type D. **The shared cross-model diagnosis→action gap is not supported by the trajectories.**

## What is actually happening with Qwen

Only **2** of its runs match the hypothesis. The dominant mechanism was not in the hypothesis at
all:

> **12 of 22 Qwen runs terminate with a response containing no tool calls AND no text.**

`camel-separator-strip` — the model is **mid-exploration**, paging a 224-line file:

```
· read {"offset":144,"path":"index.js"}   ✓ lines 144-198 of 224
🧠 ""  4089→7tok
✓ completed — model_finished
```

A 7-token empty reply at line 144 of 224, recorded as `completed`. Gemma produced **zero** empty
completions across three independent 22-task reports.

The two models share a *symptom* (zero mutations) with **different causes**.

## The harness property underneath both

```js
if (resp.finish || !resp.tool_calls?.length) {
  return this.#stop(runId, leaseToken, 'completed', ExitReason.MODEL_FINISHED, …);
}
```

**Any response without tool calls ends the run as `completed`.** The loop consults no task
contract and never inspects the world, so three different states collapse into one verdict:

| situation | verdict | world |
|---|---|---|
| genuinely done | `completed` | changed ✅ |
| prose diagnosis | `completed` | **unchanged** ❌ |
| **empty reply mid-exploration** | `completed` | **unchanged** ❌ |

Pinned by 13 assertions in `completiongate.test.mjs`.

Note what this does and does not corrupt: the **evaluator** verifies world state and scores every
one of those runs `FAIL`, so `task_success` is honest. What is wrong is the **runtime's own
record** — it reports `completed` for a run that accomplished nothing and was still exploring.
Same shape as phase 4: two truths disagree, and only one was being watched.

## Prompt experiment — rejected

> "After identifying the required change, continue executing the task. Do not report completion
> until the requested world-state change has been made and verified."

| | Gemma | Qwen |
|---|---|---|
| pass | **4/7 → 2/7** | 0/7 → 1/7 |
| mutations | 5 → 6 | 0 → 1 |
| model calls | 17.9 → **28.1** | — |
| tokens | 92,740 → **190,082** | — |
| empty completions | 0 → 0 | **5 → 6** |

**Gemma regressed** — it acted more and succeeded less, grinding to `budget_exhausted` and
`no_progress` at up to 388k tokens. **Qwen's dominant failure did not move** despite the prompt
explicitly forbidding it.

Falsification §22 triggered on three counts. Left opt-in and off by default as the honest control
arm; `DEFAULT_SYSTEM` unchanged.

## §15 outcome mapping

| outcome | verdict |
|---|---|
| A — prompt solves it | **refuted** |
| B — completion gate | **supported** — the loop provably accepts unfinished work as done |
| C — tool interface | **not supported** — Gemma 1.00 action rate; Qwen edits cleanly when it edits |
| D — explicit execution state | **untested by design** — its premise (model stalls at the transition) is what the corpus refutes |
| E — model limitation | **partially** — Qwen's empty replies are model behaviour, but the loop's acceptance of them is not |

## Decision (§25): **MULTIPLE_FACTORS**

Not `PROMPT_INTERACTION` — refuted, and harmful to Gemma.
Not `TOOL_INTERFACE` — no evidence.
Not `CONTROL_LOOP` alone — that is the strongest single factor, but Qwen's empty replies are
genuinely model behaviour the loop then mishandles.
Not `MODEL_LIMITATION` alone — that would excuse a loop that records `completed` for a run which
changed nothing while still exploring.
Not `UNRESOLVED` — the mechanisms are isolated and measured.

**Two factors, clearly separated:**

1. **CONTROL LOOP (harness):** no task contract, so "stopped emitting tool calls" is treated as
   "task complete". Affects both models identically; only Qwen triggers it often.
2. **MODEL:** Qwen terminates mid-investigation with empty responses (12/22); Gemma never does
   (0/66 across three reports).

The phase-B framing — a shared diagnosis→action gap — is **superseded**.

## §26 — proposal only, NOT implemented

**Problem.** The loop records `completed` for runs that achieved no world-state change and, in 12
of 22 Qwen runs, were still exploring.

**Evidence.** Corpus classification (both models, 22 tasks each); 13 pinning assertions; a
refuted prompt experiment.

**Mechanism.** One branch in `#runLoop` serving three distinct states, with no task contract in
the run.

**Smallest intervention.** A **declared** completion contract, e.g. `requires_world_change` on the
run, consulted only where declared. On a response with no tool calls and zero mutations, the loop
does not record `completed` — it records a distinct terminal reason (e.g. `finished_without_change`)
or returns the turn to the model once. It must **not** force a mutation (§16): analysis-only tasks
legitimately end with prose.

**Falsification, fixed in advance.** Reject if: it forces mutations on analysis-only tasks · it
increases incorrect edits · Gemma's `diagnosis_to_action_rate` falls below 1.00 · overall success
regresses for either model · it requires benchmark-specific instructions · it weakens
authorization, recovery or escalation.

**Safety impact.** Expected to be neutral-to-positive: it makes the runtime's record *more*
truthful and cannot by itself cause a mutation.

## Regression

**579 passed, 0 failed across 22 suites** (was 566/21). `v0/src` unchanged; the only production
file touched is the eval runner, behind a default-off flag.

## Limitations

The detector reads the **final message**, so a correct mid-run diagnosis followed by an empty reply
scores type D. That case is reported as its own mechanism rather than folded into C. The prompt
experiment covered 7 tasks × 1 repeat per model — enough to show a regression and a non-response,
not to rank prompt variants.
