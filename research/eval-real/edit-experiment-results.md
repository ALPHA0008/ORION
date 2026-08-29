# Edit Diagnostic — Results

Same 22 tasks, same repositories and commits, same model, same verifiers, same environment.
**Only the `edit` failure message changed.**

- Baseline: [`eval/real/reports/edit-baseline.json`](../../eval/real/reports/edit-baseline.json)
- Candidate: [`eval/real/reports/edit-diagnostic.json`](../../eval/real/reports/edit-diagnostic.json)

## Aggregate

| metric | baseline | candidate |
|---|---:|---:|
| overall success | 63.6% (14/22) | **68.2% (15/22)** |
| tokens per success | 69,507 | **50,406** |
| improved / regressed | — | **3 / 2** |

Net **+1 task**. Before reading that as a win, note the primary metric below did not move at all.

## The primary metric did NOT move (brief §15)

```
edit_recovery_rate = tasks that recovered after old_string_not_found
                   / tasks containing old_string_not_found
```

| | baseline | candidate |
|---|---:|---:|
| **edit_recovery_rate** | **6/9 = 67%** | **6/9 = 67%** |
| total `old_string not found` errors | 28 | **19** |

**Identical recovery rate.** Fewer errors were *produced*, but the proportion of blocked tasks that
recovered did not change. The intervention was aimed squarely at recovery, and recovery is exactly
what stayed flat.

## Isolating the effect

Splitting tasks by whether they ever exercised the changed code path:

| group | baseline | candidate |
|---|---:|---:|
| tasks that hit an edit failure (n=12) | 7/12 | **8/12** |
| tasks that never hit it (n=8) | 6/8 | 6/8 |

The unaffected group is unchanged, as it must be — a useful sanity check that the harness was
otherwise held constant.

**Both regressions are in the unaffected group and had zero edit failures:**

| task | baseline | candidate | `old_string not found` | reason |
|---|---|---|---:|---|
| `camel-leading-capital` | PASS | FAIL | **0** | `no_progress` |
| `isnum-nan-guard` | PASS | FAIL | **0** | `no_progress` |

Neither run ever called the changed code. `isnum-nan-guard` previously consumed 40 model calls and
179k tokens to pass — a known-volatile task. These are **task variance, not regressions caused by
the change**. That is a factual attribution from the trajectories, not an excuse: the change cannot
affect a run that never triggers it.

Net on the affected group: **+1 of 12**, which is inside the run-to-run variance this project has
already measured (one task ranged 152k–261k tokens across identical repeats).

## Causal analysis — what actually happened (brief §21)

The aggregate says "+1". The trajectory says something more interesting and less flattering.

### The exemplar: `plimit-active-count` (FAIL → PASS)

```
edit  → old_string not found in index.js — it matches at line 27 except that the
        leading indentation differs (INDENTATION_MISMATCH). Lines 27-28 contain
        exactly (→=tab, ·=space): →const·next·=·()·=>·{ / →→activeCount--;
edit  → SAME string resent. Failed again.
bash  → cat -A index.js | head -n 35        ← model inspects whitespace ITSELF
edit  → SAME string again. Failed again.
write → rewrites the ENTIRE file (3,315 bytes) → PASS
```

The diagnostic named the cause, gave the line, and rendered the exact bytes. **The model resent
the identical string three times anyway**, then independently reached for `cat -A`, then abandoned
`edit` entirely and rewrote the whole file.

### The dominant recovery route is `write`, not a corrected `edit`

| recovery route | count |
|---|---:|
| full-file `write` | **5** |
| corrected `edit` | **1** |

This is the finding of the experiment. When `edit` fails, this model's preferred escape is not to
fix its `old_string` — it is to **stop using `edit`**.

The one genuine corrected-edit recovery is real, and the unit test proves the loop is mechanically
sound (`retrying with the diagnostic text SUCCEEDS`). But in live runs, the model overwhelmingly
routed around the tool rather than using the information.

## Falsification check (brief §17)

| case | verdict |
|---|---|
| **A — diagnostics don't meaningfully change recovery** | **CONFIRMED.** `edit_recovery_rate` 67% → 67%. |
| B — success improves only by exposing too much source | **No.** Diagnostic is 239–282 bytes, ~12–14% of `MSG_CLAMP`; whole-file dump was rejected at design time (3,363 bytes, would not fit). |
| C — incorrect edits increase | **No.** Zero. See safety below. |
| D — cost rises substantially | **No** — cost *fell*: 69,507 → 50,406 tokens per success. |
| E — benefit is model-specific | **Unresolved.** Still one model; Experiment B remains blocked. |

**Case A is confirmed.** The honest reading is that the hypothesis — *better diagnostics increase
recovery* — is **not supported** at this sample size.

## Safety — no incorrect edits (brief §10, §19)

| check | result |
|---|---|
| fuzzy/nearest-match applies | **0** — the tool remains exact by construction |
| edits applied to an unintended region | **0** |
| silent corruption (wrong world state passing the verifier) | **0** |
| test-file tampering caught by the anti-gaming guard | 0 tampering in scored runs |
| `SELF_VERIFYING` precondition weakened | **no** — `old_string` unchanged as the precondition |
| ambiguity (`n > 1`) handling weakened | **no** — 0 ambiguity errors in 62; path untouched |

31 new unit assertions cover every no-match case with an explicit *file is byte-identical* check.
Full suite: **385 passed, 0 failed** across 12 suites (was 354/11) — crash, fencing, recovery and
replay all unchanged.

## Cost

| metric | baseline | candidate |
|---|---:|---:|
| tokens per success | 69,507 | **50,406 (−27%)** |
| diagnostic bytes returned | ~36 | **239–282** |
| total `old_string not found` errors | 28 | **19 (−32%)** |

The diagnostic is ~7× larger per error but produces ~32% fewer errors, and cost per success fell
27%. The bounded-context architecture is not undermined: the largest diagnostic observed is 282
bytes against a 2,000-byte clamp.

## Is `old_string`/`new_string` the right primitive? (brief §18)

The strongest evidence in this experiment is not about diagnostics at all.

**5 of 6 recoveries abandoned `edit` for a full-file `write`.** The model, given precise
information about how to fix its `old_string`, mostly chose not to — and rewrote 3,315 bytes
instead. On `plimit-active-count` it even performed its own whitespace inspection (`cat -A`) rather
than use the rendered bytes it had been handed.

That is a signal about the **primitive**, not the message. Exact-substring matching requires the
model to reproduce bytes it can only see through a lossy rendering; a line-range or diff-based
primitive would not.

Per §18, no alternative is implemented here. Recorded as the highest-value follow-up:

- `edit(path, line_range, replacement)` — no byte reproduction required
- `patch(diff)` — standard, reviewable, but strict on context lines
- keep `edit` and measure whether `write` is simply the correct escape hatch

**Caveat that must not be dropped:** whole-file `write` discards the `SELF_VERIFYING`
content-addressed precondition that makes `edit` replay-safe (ADR-002/003). If `write` is becoming
the de-facto edit path, that is a **recoverability regression** the benchmark does not currently
measure — a real risk surfaced by this experiment.
