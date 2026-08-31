# Completion Analysis (§7, §12, §14)

## The control-loop property, from code

`v0/src/agent/loop/worker.mjs`:

```js
if (resp.finish || !resp.tool_calls?.length) {
  return this.#stop(runId, leaseToken, 'completed', ExitReason.MODEL_FINISHED,
                    { result: resp.content ?? '' });
}
```

**Any response without tool calls ends the run as `completed`.** The loop consults no task
contract and does not inspect the world. Three very different situations are indistinguishable
to it:

| situation | loop verdict |
|---|---|
| the job is genuinely done | `completed` ✅ |
| a correct diagnosis stated as prose, world unchanged | `completed` ❌ |
| an **empty** response mid-exploration | `completed` ❌ |

## Pinned by test

`v0/tests/completiongate/completiongate.test.mjs` — **13 assertions**, investigative only, no
production behaviour changed:

```
empty response terminates the run              ok   reason=model_finished, world UNCHANGED
prose-only response terminates the run         ok   world UNCHANGED, prose stored as result
no task-contract check exists in the loop      ok
empty response after a read completes the run  ok   world UNCHANGED
a mutating run still completes normally        ok   world IS changed
a zero-mutation run is observable from state   ok   budget.tool_calls == 0
```

The last one matters for §26: a completion gate would already have the evidence it needs, from
existing projection state, with **no new events**.

## §7 — does the model treat explanation as completion?

For Gemma, **no**: 1 premature completion in 22, and `diagnosis_to_action_rate` 1.00. When it
diagnoses, it acts.

For Qwen, the shape is different from the hypothesis. Of its 22 runs:

- **12** end on an **empty** response — no prose, no tool call
- 10 end with prose
- only **2** are genuine "diagnosed correctly, then explained instead of acting"

So "explanation is mistaken for completion" is a **minor** mechanism (2/22), while "the model goes
quiet and the loop calls it done" is the **major** one (12/22).

## §14 — completion invariant, tested at the evaluator level first

The evaluator already refuses to be fooled: it verifies world state, never the agent's prose.
Every one of those 12 empty-completion runs is scored `FAIL` by the task verifier. So
`task_success` is not corrupted.

What *is* corrupted is the **run status**: the runtime records `completed` for a run that
accomplished nothing and was still mid-investigation. That is a control-loop truth problem, not an
evaluator problem — and it is invisible to any score, because the evaluator's FAIL and the
runtime's `completed` never meet.

This is the same shape as the phase-4 finding: `task_success` and runtime correctness can
disagree, and only one of them is being watched.

## §13 / §16 — the distinction that must be preserved

An analysis-only task legitimately ends with prose and no mutation. So the invariant is **not**
"every run must mutate". It is:

> If the task's objective world state has not been achieved, the run is not complete.

The runtime cannot currently express that, because the task contract is not part of the run. The
evaluator knows it; the loop does not.
