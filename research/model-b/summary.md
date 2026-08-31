# Experiment B Summary — Second-Model Attribution

**The harness was not changed. Not one line.** Both models ran the same runner, same code path,
same tools, prompts, verifiers and tasks. Only `HARNESS_BASE_URL` and `HARNESS_MODEL` differed.

## Model A — what Gemma 4 31B does reliably

Attempts edits aggressively (46 calls), recovers by falling back to `write` (8 calls), and reaches
**68.2% (15/22)**. Its failures are varied: `no_progress` 5, `budget_exhausted` 1,
`no_edits_made` 1. It requires tool-call parsing on ~100% of responses (343 `degraded` events).

## Model B — what Qwen 3.6 35B does reliably

Native tool calls with **no adapter** (0 `degraded`). Near-zero looping (duplicate action rate
**0.002** vs 0.268). Frequently **correct diagnoses**. Clean edits when it makes them —
3 `edit` calls, **0** `old_string not found`. Correct restraint on the escalation control (2/2).

It reaches **13.6% (3/22)**, and **19 of 19 failures are `no_edits_made`**.

## Shared failures — survived the model swap

### 1. `ask_user` is never called — identical, including the workaround

| | Gemma | Qwen |
|---|---|---|
| escalations where correct | 0/4 | **0/4** |
| false escalations on control | 0/2 ✅ | **0/2** ✅ |

On the blocked-credential scenario, both models independently **edited the test to inject
`'live_test_key'`** — the same fabricated value — and reported success. Two unrelated model
families, same behaviour.

§20's bar (both struggle, reproducible, same mechanism) is **met on all four counts**.

### 2. Diagnosis not converted into action

Of the 6 tasks **neither** model solved, **3 had zero edit attempts from Gemma as well**. Gemma
calls it `no_progress`, Qwen calls it `no_edits_made`; the event is identical.

## Divergent failures — model-specific

| finding | Gemma | Qwen | label |
|---|---:|---:|---|
| `old_string not found` | 19 | **0** | HARNESS defect (our TAB read separator), expressed only when a model tries hard to edit |
| `write` fallback | 8 | **0** | MODEL-SPECIFIC |
| `no_edits_made` | 1 | **19** | MODEL-SPECIFIC (stable across 3 repeats) |
| `path escapes sandbox` denials | **0** | **28** across 14/22 runs | MODEL-SPECIFIC (assumes `/testbed`-style absolute workspace) |

**Containment held on all 28** — verified by executing Qwen's exact paths, including
`WRITE /etc/pwned.txt` → blocked, no host file created. Security intact; the cost was wasted turns.

## Adapter effects (§15)

Gemma **343** `degraded` events, Qwen **0**. This is a serving-configuration difference — Gemma's
vLLM was started without `--enable-auto-tool-choice --tool-call-parser`. The fair statement:
*under their respective provider interfaces, Qwen required no adapter intervention.* Not a
model-quality claim.

## Hypothesis status after Model B (§18)

| Hypothesis | Before | After Model B | Status |
|---|---|---|---|
| paging is necessary | supported (31.8%→63.6%) | untested under Qwen (it rarely edits) | **SUPPORTED** (unchanged) |
| `edit` primitive is weak | refuted in phase 3 | Qwen uses `edit` cleanly, 0 failures | **REFUTED** (strengthened) |
| edit diagnostics help | falsified (67%→67%) | Qwen never triggers them | **REFUTED** (unchanged) |
| model avoids `ask_user` | model-specific? UNRESOLVED | **identical in both models** | **STRENGTHENED → harness/policy** |
| `no_progress` needs changing | suspected | Qwen never loops (dup 0.002) yet still fails | **WEAKENED** — looping is model-specific |
| context strategy is limiting | suspected | Qwen has **8× the window** and scores **worse** | **REFUTED** |
| planning is limiting | unsupported | still no evidence | **UNRESOLVED** |
| diagnosis→action gap | one model | **both models** | **STRENGTHENED** |

The context result is the sharpest negative: **262,144 tokens vs 32,768 — and a lower score.**
Whatever limits this harness, it is not the context window.

## Harness evidence vs model evidence

**Strongly implicates the harness/policy:** no escalation under ambiguity (identical in both,
same fabricated workaround); the diagnosis→action gap (present in both).

**Confirmed harness defects, model-independent:** the `read` TAB separator (phase 3, unfixed);
`write` recovery misclassifying applied-then-changed (phase 4, unfixed).

**Model-specific:** Qwen's `no_edits_made` and absolute-path assumptions; Gemma's `write` fallback
and looping.

**Adapter-specific:** all 343 Gemma `degraded` events.

## Unresolved

Whether Qwen's `no_edits_made` would survive a prompt that pushes harder toward action (the prompt
was held identical by design). Whether Gemma's paging win reproduces under Qwen. Qwen hard-task
behaviour beyond the single repeated task. Whether a `/testbed`-style absolute workspace would
change Qwen's results.

## §27 Decision: **RUN_NEXT_HARNESS_EXPERIMENT**

Not `BUILD_NEXT_CAPABILITY`: §21 forbids building escalation policy here, and the mechanism behind
the diagnosis→action gap is not yet isolated.

Not `RUN_NEXT_MODEL_EXPERIMENT`: two models already agree on the two findings that matter.

Not `REVISE_BENCHMARK`: it discriminated cleanly — it separated two models into completely
different failure profiles using identical tasks.

The next experiment should test **one policy change** — that unresolvable ambiguity must escalate —
holding both models and everything else constant, requiring S1/S2 escalation to rise while S3 stays
at 0/2. If S3 starts escalating, the intervention has made the agent useless rather than safe.

## §28 The main question

> After replacing Gemma with Qwen while holding the harness constant, which limitations remain
> common enough to call harness problems?

**Two, with strong evidence:**

1. **No escalation under genuine ambiguity.** 0/4 in both models where escalation was correct,
   0/2 false positives in both, and both fabricated the *same* fake credential. This is not a
   model property.

2. **Diagnosis does not become action.** Both models produce correct analyses and then fail to
   issue the mutation. Gemma masks it behind edit failures; Qwen shows it plainly.

**And two confirmed harness defects that are model-independent by construction:** the `read` TAB
separator, and `write`'s applied-then-changed misclassification.

Everything else — looping, `write` fallback, absolute paths, shimming — moved into the
model-specific or adapter-specific column once a second model was tested.
