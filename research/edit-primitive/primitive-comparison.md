# Primitive Comparison

Answers §19 from the controlled experiment, the recovery audit, and the real-repository
trajectories — not from aesthetics.

## The comparison table (§10)

| Primitive | Model usability | Exactness | Recovery | Ambiguity | Token cost | Safety |
|---|---|---|---|---|---|---|
| **`old_string`/`new_string`** | **10/10 with a correct read rendering**; 2/10 with the tab-merging one | exact substring | **`SELF_VERIFYING`** — precondition is the *old* bytes; replay self-rejects | explicit `n>1` error; 0 occurrences in 62 real failures, 4 in the probe (all recovered) | **lowest — 90 mean out-tokens, 1.4 calls** | wrong edit corrupts one substring |
| **`edit_range(start,end,replacement)`** | 10/10 (immune to the rendering bug) | positional — **not** content-addressed | `SAFE_RETRY` at best unless an `expected_sha` is added | none — ranges cannot be ambiguous | 169 mean out-tokens | line numbers **shift**; a stale range silently hits the wrong lines |
| **`patch(diff)`** | **3/10** — inherits the same byte-reproduction demand via context lines | exact context match | could be `SELF_VERIFYING` (context = precondition) | hunk context resolves it | **highest — 391 mean out-tokens** | wrong hunk corrupts a region |
| *(reference)* `write(path, content)` | high | whole-file | `SAFE_RETRY`; **cannot** distinguish "didn't land" from "landed then changed" | n/a | 6–20× an edit attempt | **whole file** — silently discards concurrent changes |

## Is `old_string`/`new_string` actually inadequate?

**No.** The evidence says the opposite once the confound is removed.

| interface A | correct | not_found | mean out-tokens |
|---|---:|---:|---:|
| production TAB separator | 2/10 | 48 | 295 |
| pipe separator | **10/10** | **0** | **90** |

Same tool, same model, same tasks. The only change was the line-number separator in the *read*
rendering. The primitive was never the constraint.

It is also the only candidate that is `SELF_VERIFYING` **by construction**: its precondition is
the pre-state, so an already-applied edit rejects its own replay (verified in
`writerecovery.test.mjs`).

## Is `line_range`/`replacement` better?

**No — it is differently exposed.** It scored 10/10, but for the wrong reason: line numbers are
immune to a rendering bug in the *content*. It dodges the defect instead of being a better
abstraction. With the read format corrected, substring editing matches it on correctness and
**beats it on cost** (90 vs 169 out-tokens).

Its structural problem is the one §9 anticipated. Line numbers are **not content-addressed**: if
the file changes between read and edit, a stale range silently mutates the wrong lines — a failure
mode `old_string` cannot have, because a stale `old_string` simply fails to match.

### Preserving `SELF_VERIFYING` (§9)

| option | can it be `SELF_VERIFYING`? | cost to the model |
|---|---|---|
| A `edit(path,start,end,replacement,expected_hash)` | yes — hash of the current region | must compute a hash it cannot see; high failure risk |
| B `edit(path,range,replacement,expected_old_bytes_hash)` | yes — same | same |
| C `patch(diff_with_context)` | **yes, naturally** — context lines *are* the precondition | requires byte-exact context — the thing this model gets wrong |
| D structured spec `{path, anchor, expected_hash, replacement}` | yes | most complex surface of the four |

**C is the only one where the precondition is something the model can already express**, since it
is just source text. A and B ask the model to supply a hash of bytes it is reading through a lossy
rendering, which is strictly harder than the substring it currently fails at.

**But `old_string` already is option C's precondition, minus the diff syntax and at a quarter of
the token cost.** Adding a line-range primitive with a hash argument would reinvent
`SELF_VERIFYING` in a form the model finds harder to use.

## Is `patch(diff)` better?

**No.** Worst correctness (3/10) and highest cost (391 out-tokens). It demands byte-exact context
lines, so it inherits the same corruption that broke substring editing, plus diff-format overhead.
Its one advantage — a naturally content-addressed precondition — is already provided by
`old_string`.

## Should multiple edit primitives coexist?

**Not on this evidence.** The observed diversity of tool use was a *symptom*: the model escaped to
`write` only after `edit` became unusable, at 6–20× the token cost. Remove the corruption and it
uses `edit` in 1.4 calls on average with no `write` at all.

Adding primitives now would encode a workaround for a bug into the architecture. §22's "family of
mutation strategies" is not supported: the single primitive works once the harness stops lying to
the model about indentation.

## What happens to crash recovery?

Measured in [`write-recovery.md`](write-recovery.md) — 14 assertions, all passing:

- `edit` is `SELF_VERIFYING`: distinguishes applied / not-applied / unknown, and **self-rejects a
  replay**.
- `write` is `SAFE_RETRY`: crash semantics are sound (torn writes converge), but it **cannot**
  distinguish "my write never landed" from "my write landed and someone else changed the file", so
  a retry silently discards the concurrent change.
- `edit_range` without a hash would be *weaker* than `write`: positional and non-idempotent.

Every observed `edit → write` fallback was therefore a **silent downgrade in recoverability**,
invisible to the success-rate metric.

## What happens to token cost?

| route | mean output tokens |
|---|---:|
| corrected `edit` | **90** |
| `edit_range` | 169 |
| broken `edit` (production today) | 295 |
| `patch(diff)` | 391 |
| `write` fallback (per call) | 939–1,269 |

## What happens to model tool selection?

With a correct rendering the model chose `edit` in **10/10** cases and never reached for `write`.
Tool selection was never a preference problem; it was a reachability problem.

## What happens to correctness?

Corrected interface A: 10/10, with the 4 residual failures being legitimate `ambiguous` errors on
three identical function bodies — the tool behaving **correctly**, and the model supplying more
context on the next call in both repeats.

## Conclusion

`edit(old_string, new_string)` is **not** the wrong primitive. It is the cheapest, the only one
that is `SELF_VERIFYING` by construction, and — once the read rendering is fixed — the most
reliable of the three tested.

The defect is one character in `read`'s line-number separator, introduced by our own phase-1
paging change. Three of the five pinned repositories are tab-indented, which is why it dominated
the failure data.
