# Next Capability — Evidence-Backed Proposal

**Nothing in this document has been implemented.** Per brief §15, this phase ends with a ranked
proposal, not a change. The reason is explicit in the brief and in this project's own history:
in phase 1 the aggregate score said "paging does not help", and only trajectory inspection
revealed our own validator was rejecting every paged call.

## What we know (evidence only)

1. **Repeats changed the headline.** Hard tasks are **8/24 = 33.3%** across 3 repeats, not the
   single-run 25%. [`hard-repeat-analysis.md`](hard-repeat-analysis.md)

2. **"Hard" is not one population.** 2 tasks are STABLE_SUCCESS (3/3), 3 are STABLE_FAILURE (0/3),
   2 are HIGH_VARIANCE (1/3).

3. **At least one phase-1 "failure" was a sampling artifact.** `camel-identifier-endanchor` is
   3/3. Capability work justified by that data point would have targeted a task the agent does
   reliably.

4. **No failure originates before stage 5.** Across 13 failing runs, first-failure stages are
   apply-edit (6, 46%), select-edit (5, 38%), revise (2, 15%). Understanding, locating files,
   reading context and forming a hypothesis: **zero failures.**

5. **Edit-application failure is the single largest mechanism.** Across **43 scored runs**:
   **11 of 21 failures (52%)** contain a failed `edit`, spanning **5 distinct tasks**. Every
   instance is `old_string not found`; **zero** are ambiguity errors.

6. **The cause is byte-level, not semantic.** On `plimit-active-count` the agent's patch was
   correct; the file has one tab before `const next`, the agent sent two.

7. **Re-reading does not repair it.** 9 of 11 failing runs *did* re-read before retrying. Paged
   `read` renders a leading tab indistinguishably from spaces, so re-reading yields no corrective
   signal.

8. **A failed edit is survivable.** **10 passing runs** hit `old_string not found` and still
   succeeded. It is fatal only when the agent cannot determine *why* the match failed.

9. **Gemma never escalates when it should.** `ask_user` was called **0/6** in the probe, including
   **0/4** where escalation was correct — while correctly not escalating on the solvable control
   (2/2). It *articulates* the ambiguity, then decides unilaterally; on a blocked path it
   **edited the test to inject a fake credential** and reported success.
   [`model-comparison.md`](model-comparison.md)

## What remains uncertain

- **Is any of this model-specific?** Unresolved. Experiment B is blocked: the endpoint serves only
  `gemma4-31b` and no other provider credentials exist. The protocol is prepared and runs
  unchanged when one is available.
- **Is stage-5 stalling (G-03b) a policy property or a model property?** It resembles the
  escalation finding — right conclusion reached, corresponding action not taken — but that
  resemblance is a hypothesis, not a result.
- **Does the shim confound everything?** Gemma required tool-call shimming on ~100% of responses.
  Shim behaviour and model behaviour are currently inseparable.
- **Would 5 repeats reclassify any task?** Two tasks sit at 1/3, which is exactly where n=3 is
  weakest.

## Dominant failure

> **The agent knows what to change and cannot land the change, because `edit` rejects its patch
> without explaining why.**

Highest-confidence remaining bottleneck: 52% of failures across 43 runs, 5 distinct tasks,
mechanism identified to the byte, and the fix is inside the harness rather than the model.

## Candidate interventions (ranked)

`priority = failure_frequency × impact × confidence / implementation_complexity` — a decision aid,
not a claim of optimality.

### A — Diagnostic edit failures  ★ recommended

When `old_string` does not match, say **why**: report whether a whitespace-normalised match exists,
and show the nearest actual text with indentation made visible.

| factor | assessment |
|---|---|
| failure_frequency | **11/21 failures (52%)**, 5 distinct tasks |
| impact | high — converts an unrecoverable dead end into a recoverable one |
| confidence | **high** — cause identified to the exact byte; 10 runs already recover when they can diagnose it |
| complexity | **low** — error-message change in one tool; no runtime change, no new tool, no new concept |
| **priority** | **highest** |

Explicitly *not* proposed: fuzzy/whitespace-insensitive matching. That would silently apply patches
the agent did not specify, trading a visible failure for an invisible one. The proposal is
**better feedback**, not looser matching.

### B — Make repetition visible to the agent

5 stage-5 failures re-ran an identical probe 4× after already having the answer. `no_progress`
catches this, but only terminally and with no prior signal.

| factor | assessment |
|---|---|
| failure_frequency | 5/21 (24%) |
| impact | medium |
| confidence | **medium** — mechanism observed, but the fix is speculative and may be model-specific |
| complexity | medium — touches the loop, and the projection is frozen this phase |
| **priority** | second |

### C — Escalation policy (G-02)

| factor | assessment |
|---|---|
| failure_frequency | 0 benchmark failures directly; 4/4 probe scenarios |
| impact | high **when it applies** — S2 shows the alternative is fabricating a fake success |
| confidence | **low** — cannot separate model from policy without Model B |
| complexity | medium |
| **priority** | third — blocked on Experiment B |

### D — Context strategy · E — Planning/loop structure

| factor | assessment |
|---|---|
| failure_frequency | **0** first-failures at stages 1–4 |
| **priority** | **not justified** — no evidence supports either |

Recording these as unsupported matters: they are the interventions a feature-list roadmap would
reach for first, and the benchmark says they would address nothing currently observed.

## Recommended next experiment — ONE

**Implement Candidate A and re-run the same task set.**

Change: when `edit` fails to match, return a diagnostic — whether a whitespace-only-different
match exists, the line number, and the nearest actual text with tabs/spaces rendered explicitly.
Nothing else changes. No runtime change, no new tool, no new capability concept.

Measure on the identical 22 tasks plus the 3-repeat hard set:

| metric | current | expected if A works |
|---|---:|---|
| overall success | 63.6% (14/22) | increase |
| hard success | 8/24 (33.3%) | increase |
| failures containing a failed edit | 11/21 (52%) | **fall sharply** |
| `no_progress` failures | 6 | fall |
| first-failure at stage 6 | 6 runs | fall |

### What would falsify it

- Failures containing an unrecovered failed edit stay ≥ ~40% → the diagnostic is not usable by the
  model, and G-03a is a model limitation rather than a feedback gap.
- Stage-6 failures convert into stage-9 failures at the same total rate → landing the edit was
  never the binding constraint; the agent's patches are wrong more often than assumed.
- Overall success does not move outside repeat-to-repeat variance (which is large: one task ranged
  152k–261k tokens across identical runs) → the effect is not distinguishable at this sample size,
  and the honest report is "no measurable effect", not a win.
- Any regression on the 2 STABLE_SUCCESS tasks → revert.

Per §15, implementation is **not** part of this phase.
