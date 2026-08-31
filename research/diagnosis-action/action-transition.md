# The Analysis → Action Transition (§10–§11)

## §10 — is `edit` low-salience?

**No evidence for it.**

- Gemma's `diagnosis_to_action_rate` is **1.00**. The tool is salient enough that it is used every
  time a diagnosis is reached.
- Qwen calls `edit` correctly when it calls it at all — phase 8 measured 10/10 on tab-sensitive
  controlled edits with **zero** wrong edits.
- Phase 6 additionally showed both models call `ask_user` correctly on a direct instruction, so
  tool presentation is not generally opaque to either.

The tools are reachable and usable. Nothing was modified (§10 says gather evidence first, and the
evidence does not point here).

## §11 — would an explicit execution state change behaviour?

Not tested, deliberately, because the prerequisite failed.

The §11 experiment presumes the model reaches a diagnosis and then stalls at the transition. That
is exactly what the corpus does **not** show:

- Gemma never stalls there (0 type-C in 22).
- Qwen mostly does not reach the transition — 12 of 22 runs end on an **empty** response, often
  mid-exploration, before any diagnosis exists.

Injecting "task remains incomplete; mutation required" metadata after diagnosis would therefore
address a transition that, for Gemma, already works, and that Qwen usually never arrives at.

Running it would have produced a number without testing the mechanism. That is recorded as a
deliberate omission rather than an oversight.

## Where the transition actually breaks

Not between *analysis* and *action*. Between **"the model stopped emitting tool calls"** and
**"the task is complete"**:

```
model returns no tool calls   ──►   loop: completed
        │
        ├── job genuinely done            ✅ correct
        ├── prose diagnosis, world unchanged   ❌ 2 Qwen runs
        └── EMPTY reply mid-exploration        ❌ 12 Qwen runs
```

The loop has one branch for three different states because it holds no task contract.

## What the loop already knows

From `completiongate.test.mjs`: a zero-mutation run is **observable from existing projection
state** (`budget.tool_calls === 0`). Any future gate has the evidence it needs without a new event
type, a new projection field, or a second state store.

## The distinction that must survive (§13, §16)

An analysis-only task legitimately ends with prose and no mutation. The invariant is **not**
"every run must mutate":

> If the task's objective world state has not been achieved, the run is not complete.

The evaluator already enforces exactly this and scores all 12 empty-completion runs `FAIL`. The
**loop** cannot, because the contract is not part of the run.
