# Phase 3 Summary — Is `edit` the Wrong Primitive?

**Answer: no. The primitive is fine. Our `read` rendering was corrupting the bytes the model was
asked to reproduce.**

Runtime frozen throughout; no production tool contract changed (§ critical rule). All work was
offline probes plus a measurement-only audit.

## What was asked

Separate **model behaviour** from **tool interface** from **edit primitive**, given phase 2's
finding that the model abandons `edit` for whole-file `write` (5 write recoveries vs 1 corrected
edit).

## The finding

A controlled experiment — identical task, identical model, one variable — split cleanly:

| interface A (`old_string`/`new_string`) | correct | `not_found` | mean out-tokens | mean calls |
|---|---:|---:|---:|---:|
| **TAB** line-number separator (production today) | **2/10** | 48 | 295 | 5.0 |
| **pipe** line-number separator | **10/10** | **0** | **90** | **1.4** |

### The mechanism, to the byte

The §6 control was decisive on its own: same instruction, same target line, **space**-indented file
**2/2 correct in one call**; **tab**-indented file **0/2 with six consecutive `not_found`**.

A dedicated probe then ruled out the obvious explanation. The model emits tabs **perfectly, 6/6**,
including converting `→` back to a real tab exactly as the phase-2 diagnostic instructed. What it
gets wrong is the **count**:

```
model sent : "\t\t\tactiveCount--;"   (3 tabs)
file has   : "\t\tactiveCount--;"     (2 tabs)
```

Because paged `read` — added by us in phase 1 — renders every line as `N` + **TAB** + content. On
tab-indented files the separator merges with the real indentation into one run. Verified against
the production tool:

```
file    : "\t\treturn 1;"      (2 tabs)
read()  : "3\t\t\treturn 1;"   (separator + 2 = a run of 3)
```

**The model reads the display faithfully. The display is off by one tab.** Three of the five
pinned repositories are tab-indented, which is why this dominated the failure data.

## This overturns two earlier conclusions

1. **"The model prefers `write`" (phase 2) was wrong.** It escapes to `write` only after `edit`
   becomes unusable, and pays **6–20× more output tokens** to do so (946 vs 76 on
   `plimit-active-count`). That is not preference; it is escape. With a correct rendering it used
   `edit` in 10/10 cases and never reached for `write`.

2. **The phase-2 edit diagnostic could never have worked.** It correctly said
   `INDENTATION_MISMATCH`, gave the line, and rendered `→const·resumeNext…` — and the model copied
   that correctly. But it had already anchored on the wrong tab count from the numbered read, and
   nothing in the diagnostic contradicted the corrupted view it was working from. That explains
   why `edit_recovery_rate` stayed at 67%: the diagnostic was answering a question the model
   wasn't confused about.

## Primitive comparison (§10, §19)

| primitive | correct | out-tokens | `SELF_VERIFYING`? |
|---|---:|---:|---|
| **`old_string`/`new_string`** (corrected rendering) | **10/10** | **90** | **yes, by construction** |
| `edit_range(start,end,replacement)` | 10/10 | 169 | only with an added hash the model cannot easily compute |
| `patch(diff)` | 3/10 | 391 | yes in principle; inherits the same byte-reproduction demand |

`edit_range` scored 10/10 by being **immune to the rendering bug**, not by being a better
abstraction — it dodges the defect. Once the rendering is fixed, substring editing matches it on
correctness and beats it on cost. And line numbers are not content-addressed: a stale range
silently mutates the wrong lines, which a stale `old_string` cannot do.

## `write` recovery audit (§11–§12)

14 assertions, all passing. `write`'s crash semantics are **sound** — torn writes converge on
retry. Its weakness is concurrency: `verify()` cannot distinguish "my write never landed" from
"my write landed and someone else changed the file", so a retry **silently discards the concurrent
change**. `edit` has no such gap; its precondition is the pre-state, so an applied edit
**self-rejects its own replay** (verified).

Every observed `edit → write` fallback was therefore a **silent downgrade in recoverability**,
invisible to the success-rate metric.

## Decision (§20): **KEEP_EXISTING_EDIT**

Not `ADD_LINE_RANGE_EDIT_EXPERIMENT`: its 10/10 is explained by dodging our bug, it costs ~2× the
tokens, and it trades away content-addressing.

Not `ADOPT_PATCH_PRIMITIVE_EXPERIMENT`: worst correctness, highest cost, same byte-reproduction
demand.

Not `MULTIPLE_EDIT_PRIMITIVES`: the observed tool diversity was a **symptom** of the defect.
Encoding it into the architecture would make a workaround permanent. §22's "family of mutation
strategies" is not supported by this evidence.

Not `MODEL_SPECIFIC_PROBLEM`: the model behaved correctly given what it was shown. The harness was
wrong.

Not `UNRESOLVED`: the mechanism is identified to the byte and demonstrated with a clean
2/10 → 10/10 switch under a single controlled change.

## The recommended next change — and why it is NOT this phase's job

**Change `read`'s line-number separator so it cannot merge with leading indentation.**

That is a one-character change to a capability-layer tool, in the same file phase 1 touched, with a
measured 2/10 → 10/10 effect offline. But per this phase's critical rule and the project's own
history, it must be validated on the real 22-task benchmark with falsification criteria fixed in
advance — not shipped on the strength of an offline probe.

Pre-registered expectations:

| metric | current | expected if the fix works | falsifies if |
|---|---:|---|---|
| overall success | 68.2% (15/22) | increase | unchanged within variance |
| `old_string not found` errors | 19 | **fall sharply** | stays ≥ ~15 |
| `edit → write` fallbacks | 5 | fall | unchanged |
| tokens per success | 50,406 | fall | rises |
| any STABLE_SUCCESS task regresses | — | none | revert |

If the benchmark does **not** move, the offline probe over-generalised from 5 synthetic cases and
the honest report is "no measurable effect on real tasks".

## The architectural lesson

The phase-2 conclusion — "the model prefers whole-file rewrites, so maybe the primitive is wrong" —
was a plausible story built on aggregate behaviour. The actual cause was a one-character formatting
decision we made ourselves, one phase earlier, while fixing a different problem.

**Two capability changes in a row have now been misdiagnosed by reasoning from behaviour rather
than from bytes**, and both were caught only by reading trajectories and reproducing them offline.
That is the strongest recurring argument for the durable event log in this project so far.

## Limits

One model, 5 synthetic cases, 2 repeats. Enough to localise a mechanism and demonstrate a clean
switch; **not** enough to rank primitives generally. Whether other models share the tab-run
confusion is unknown — Experiment B remains blocked, and every model-attribution claim here stays
provisional. G-02 (escalation) is untouched and still open.
