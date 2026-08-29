# Edit Diagnostic Experiment — Summary

## Hypothesis

> Better `edit` failure diagnostics will increase recovery after `old_string_not_found` without
> increasing incorrect edits.

Grounded in phase 2: 11 of 21 failures contained `old_string not found`; the one case with exact
bytes was an indentation mismatch (file had one tab, model sent two); 9 of 11 failing runs re-read
the file and still resent a byte-inequivalent string.

## Baseline

| metric | value |
|---|---:|
| overall success | 63.6% (14/22) |
| **edit_recovery_rate** | **6/9 = 67%** |
| `old_string not found` errors | 28 |
| ambiguity (`n > 1`) errors | **0** in 62 corpus errors |
| diagnostic returned to the model | `old_string not found in <path>` — **~36 bytes**, no cause, no location |

## Intervention

Exactly one thing changed: the **error message** when `old_string` does not match. Six strategies
were measured before implementing; the whole-file dump was rejected at design time (3,363 bytes —
would be clamped by `MSG_CLAMP` and reintroduce the invisibility being fixed).

The chosen diagnostic classifies the mismatch, gives the line, and renders whitespace visibly:

```
old_string not found in index.js — it matches at line 27 except that the leading
indentation differs (INDENTATION_MISMATCH). Lines 27-28 contain exactly (→=tab, ·=space):
→const·next·=·()·=>·{
→→activeCount--;
Copy that text verbatim as old_string, converting → back to tab and · back to space.
```

**Matching semantics are untouched.** Exact match applies; no match modifies nothing. No fuzzy
matching, no nearest-match apply, no change to `SELF_VERIFYING`, ambiguity handling, tool schema,
prompts, model, context strategy, evaluator, or task set. No runtime change.

## Result

| metric | baseline | candidate | verdict |
|---|---:|---:|---|
| **edit_recovery_rate** | **67%** | **67%** | **no change — the target metric did not move** |
| overall success | 63.6% | 68.2% | +1 task, inside variance |
| improved / regressed | — | 3 / 2 | net +1 |
| `old_string not found` errors | 28 | 19 | −32% |
| tokens per success | 69,507 | 50,406 | −27% |
| incorrect edits | 0 | **0** | safe |

Both regressions (`camel-leading-capital`, `isnum-nan-guard`) had **zero edit failures** — neither
run executed the changed code. Tasks that never touched the path went 6/8 → 6/8; tasks that did
went 7/12 → 8/12.

## Causal evidence

The aggregate says "+1". The trajectory says the improvement did not come from the mechanism I
built.

`plimit-active-count` (FAIL → PASS), the exemplar the whole experiment was designed around:

```
edit  → diagnostic: INDENTATION_MISMATCH at line 27, exact bytes rendered
edit  → SAME string resent → failed
bash  → cat -A index.js        ← model inspects whitespace itself
edit  → SAME string again → failed
write → rewrites the entire file (3,315 bytes) → PASS
```

It was told the cause, the line, and the exact bytes — and resent the identical string three times,
then routed around the tool.

**Recovery route across all recoveries: full-file `write` 5, corrected `edit` 1.**

The unit tests prove the loop is mechanically sound (`retrying with the diagnostic text SUCCEEDS`),
so this is not a broken diagnostic. The model simply did not use it.

## Safety

No incorrect edits, no silent corruption, no weakened preconditions. 31 new assertions, each
no-match case asserting the file is byte-identical. Full suite **385 passed, 0 failed** across 12
suites (was 354/11); crash, fencing, recovery and replay unchanged.

## Cost

Diagnostics are ~7× larger per error (36 → 239–282 bytes) but produce 32% fewer errors, and cost
per success **fell 27%**. Largest diagnostic observed: 282 bytes against a 2,000-byte clamp — the
bounded-context architecture is intact.

## Decision: **REVISE**

Not `KEEP`: the primary metric — `edit_recovery_rate` — did not move. Claiming success from
63.6% → 68.2% would be exactly the mistake this project has already made twice, where an aggregate
supported a causal story the trajectory contradicted. Falsification **Case A is confirmed**.

Not `REVERT`: the change is strictly safe (0 incorrect edits), strictly cheaper (−27% tokens/success,
−32% errors), adds 31 regression assertions, and now classifies every edit failure **into the
durable event log** — so the next iteration gets a byte-level corpus instead of the 1-of-62 sample
this one had.

`REVISE`, because the experiment produced a **more valuable finding than the one it tested for**:

> 5 of 6 recoveries abandoned `edit` for a full-file `write`. Given precise instructions on how to
> fix its `old_string`, the model mostly chose not to.

That points at the **primitive**, not the message. Exact-substring matching demands the model
reproduce bytes it can only perceive through a lossy rendering. A line-range or diff primitive
removes that demand entirely.

**And it surfaces a risk the benchmark does not currently measure:** whole-file `write` discards
the content-addressed `SELF_VERIFYING` precondition that makes `edit` replay-safe (ADR-002/003).
If `write` is becoming the de-facto edit path, recoverability is silently degrading while the
success rate looks fine.

## Next — per §24, do not immediately build

The diagnostic did **not** materially improve recovery, so §24 directs investigating whether the
`edit` primitive itself is wrong. The proposed next experiment:

**Add `edit(path, line_range, replacement)` alongside the existing `edit`, change nothing else, and
measure which the model reaches for and which succeeds.**

Falsification fixed in advance:
- if the model still prefers `write` → the problem is neither the message nor the primitive, and
  attention should move to why it discards partial-edit strategies;
- if line-range edits succeed at the same rate as substring edits → the primitive was not the
  constraint, and Case A generalises;
- if `SELF_VERIFYING` cannot be preserved for a line-range edit → do not ship it; a wrong edit that
  passes one task is worse than an explicit failure.

**Standing caveat:** one model, 22 tasks, single repeats. Experiment B (second model) remains
blocked, so every model-attribution claim here — including "the model prefers `write`" — is
provisional.
