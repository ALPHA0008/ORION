# Variance Note — Read Before Any Single-Run Number

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

## The observation

`pallets__flask-4045`, Gemma 4 31B, identical frozen corpus (`CAPABILITY_V1_STAGE1`,
sha256 `0a9a279d…`), identical configuration (`baseline-lock.md`), run twice:

| run | outcome | source edited? | diff | tools | wall |
|---|---|---|---|---|---|
| smoke (§14) | **PASS** | yes — `src/flask/blueprints.py` +2 | src + 2 test files | 19 | 16 s |
| full baseline (§17) | **FAIL** | **no** | 2 test files only | 30 | 37 s |

Nothing was changed between them. No prompt, no tool, no task definition, no model setting. This is
sampling variance in the agent's own behaviour.

## Why it is recorded prominently

§17 specifies **1 repeat per task**, which is the right budget for a first baseline. But it means a
per-task result is **one sample from a distribution, not a measurement of that task**.

The two runs did not merely differ in score — they differed in *mechanism*. One attempted the actual
change; the other never touched source at all. A failure-table row that says
`test interpretation / HIGH confidence` for this task is faithfully describing **the run it
observed**, and is not entitled to say the agent *cannot* do the task.

## The rule this imposes on every downstream claim

1. **Aggregate mechanism counts are the unit of evidence, not individual task verdicts.** A
   mechanism appearing across many tasks and both models is robust; the same mechanism on one task
   is an anecdote.
2. **No task-level claim of the form "the agent cannot do X"** may rest on a single run. The
   honest form is "in the observed run, the agent did Y".
3. **A Gemma-PASS / Qwen-FAIL split on a single task is not `MODEL_SPECIFIC` evidence by itself.**
   With variance this large, one differing sample is consistent with pure noise. §23's
   `MODEL_SPECIFIC` label therefore needs mechanism agreement across several tasks before it
   supports a conclusion.
4. §26's *statistical usefulness* gate is directly engaged: one-off results must not be mistaken
   for stable behaviour, and this file is the concrete evidence that they would be.

## What would resolve it

Repeats — 3–5 per task — which is deliberately out of scope for this stage. If the failure
distribution ends up hinging on differences of one or two tasks, the correct decision is
**`CORPUS_NOT_DISCRIMINATING`** or **`CORPUS_NEEDS_MORE_TASKS`** rather than a confident bottleneck
ranking built on noise.

The zero-mutation behaviour seen in the failing run is the more interesting signal here, because it
matches a mechanism already documented in this project: phase 10 found Qwen ending runs with no tool
calls and an unchanged world, which is exactly what ADR-013's declared completion contract was built
to detect — and which is **switched off** in this baseline by design (shipped defaults only).
