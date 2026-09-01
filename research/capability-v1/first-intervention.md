# First V1 Intervention — DEFERRED

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

## Decision

**No V1 capability intervention is selected from Stage 1.**

§24 permits this document to name one intervention *only if the corpus passes the interpretability
gate*. It does not (`CORPUS_NEEDS_MORE_TASKS` — see `summary.md`), so naming one would be
proceeding on evidence the gate has just judged insufficient.

The strongest candidate is recorded below in full, so the next phase inherits the reasoning rather
than repeating the analysis.

## Strongest candidate, held in reserve

**Observed failure.** 4 of 14 agent failures ended with the agent declaring itself finished
(`model_finished`) while the repository was unchanged.

**First causal divergence.** `pylint-6506`, the clearest trajectory in the corpus: 31 tool calls of
competent investigation — located `pylint/config/config_initialization.py` and `pylint/lint/run.py`,
read the relevant regions, reasoned correctly about `Run.__init__` — then emitted **1 731 characters
of accurate analysis and edited nothing**. The divergence is the transition from a correct diagnosis
to a terminal response instead of an edit.

**Evidence.** 4 tasks across 2 repositories, HIGH ×2 / MEDIUM ×2 trajectory confidence. Corroborated
by a related pattern: 5 runs wrote a `reproduce_issue.py`, confirmed the bug, and stopped.

**Mechanism.** `termination` — diagnosis is not converted into action.

**Hypothesis.** An agent that cannot terminate while its declared objective is unmet would convert
some fraction of these into attempted edits.

**Candidate intervention (ONE).** Enable ADR-013's declared completion contract
(`requires_world_change` + deterministic `objectiveSatisfied`) in the capability runner. It is
already built, already tested, and **switched off in this baseline by design**.

**Why it is nonetheless NOT selected now.** Three reasons, any one sufficient:

1. **Phase 10 already measured its ceiling.** The contract reliably converts false completions into
   honest failures, but did **not** recover capability on live runs — the model declined its
   continuation both times it fired. Expected task-success effect: **near zero**. It fixes runtime
   truth, which is valuable and already known, not capability.
2. **It is not the largest bucket.** `long-horizon execution` is 6/14 — but it is 83% pytest and is
   at least two distinct sub-mechanisms, so it is not selectable either.
3. **Single arm.** With Qwen invalid, "the agent stops early" cannot be separated from "Gemma stops
   early" (`comparison.md`).

**Falsification criteria, for when it is run.** Same frozen corpus, same runtime, Gemma:
- *Confirms*: `finished_without_change` replaces `model_finished` on those 4 tasks **and** ≥1 task
  converts to PASS.
- *Refutes*: exit reasons change while task success does not move — the phase-10 outcome repeating,
  meaning the bottleneck is not the stopping rule.
- *Harmful*: incorrect edits increase, or a task that passed now fails.

**Safety constraints.** Continuation hard-bounded to 1 (already enforced); no forced mutation on
analysis-only tasks; escalation untouched (`unfinished ≠ requires_human`).

## What must happen first

Ranked by what most improves the evidence per unit of effort:

1. **A second valid model arm.** The single largest gap. Without it no mechanism can be attributed
   to the harness rather than to one model. Either resolve the Qwen interaction failure or add a
   third model — but *not* inside a measurement phase.
2. **Repeats (n≥3) on the 8 tasks in the two leading mechanisms.** Behavioural variance is already
   observed; at n=1 a 4-vs-6 split between mechanisms is not a reliable ordering.
3. **Corpus breadth beyond one-file fixes.** Every gold patch in this corpus touches exactly one
   file — SWE-bench *Lite* by construction. `termination` and `long-horizon execution` are precisely
   the mechanisms most likely to behave differently on multi-file work, so the current corpus is
   weakest exactly where the leading candidates live.

## Explicitly not built

No memory, planning, MCP, skills, subagents, new tools, new search, new context architecture. No
change to `v0/src`, prompts, tools, model configuration, completion contract, escalation, write
recovery or read rendering. The completion contract stays **off** until an experiment turns it on
deliberately.
