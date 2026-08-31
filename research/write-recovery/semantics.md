# Semantics (§6, §8)

## Definitions

- `pre` — `expected_pre_sha`: hash of the file immediately before the effect, or `ABSENT`
- `target` — `sha(content)`
- `current` — hash of the file now

## Verification table

| case | condition | verify | decision | rationale |
|---|---|---|---|---|
| **B applied** | `current == target` | `applied` | SKIP | checked FIRST — the goal state is present regardless of the pre-state; also covers a third party producing the same bytes |
| **A never applied** | `current == pre` | `not-applied` | REISSUE | the world is exactly what the caller expected; a retry cannot destroy anything |
| **C applied then changed** | `current != pre` and `current != target` | **`unknown`** | **ESCALATE** | the world moved for a reason we cannot attribute — do not guess, and above all do not overwrite |
| **D unknowable** | witness absent, or read fails with a non-ENOENT error | `unknown` | ESCALATE | an I/O error proves nothing |

Absent-file handling: if the file is missing now and was `ABSENT` before, the effect cannot have
landed and the world is untouched → `not-applied`. If it existed before and is gone now, that is
`unknown`.

## Two distinct protections (§5)

| | when | what it prevents |
|---|---|---|
| **pre-effect conflict check** | inside `run()`, before writing | overwriting a file that changed after the caller observed it |
| **post-crash verification** | in `#reconcile`, after a crash | reissuing an effect that already landed |

They are separate mechanisms with separate tests. Conflating them was part of what made the
original defect hard to see.

## Recovery class — proved, not renamed (§8)

`SAFE_RETRY` asserts `f(f(x)) == f(x)` **for these args**. True for `write` in isolation; false
with a concurrent writer, because the second application no longer operates on the state the first
left. The class was encoding an idempotence claim that silently assumed no other writer.

With a witness, a retry is only ever issued when the pre-state is **verified intact** — which is
exactly `SELF_VERIFYING`: the operation carries a precondition the effect invalidates.

### The trap that had to be closed

`SELF_VERIFYING` is in `AUTO_REISSUE`, so simply reclassifying would have left
`unknown → REISSUE` — reintroducing the original bug through a different door. This was caught by
the tests failing exactly there:

```
case 3 applied-then-changed -> UNKNOWN        ok
  decision is NOT reissue                     FAIL  (reissue)
```

Fixed by letting the operation declare `escalateOnUnknown`. `AUTO_REISSUE` membership was standing
in for a safety proof it does not actually establish: re-issuing `edit` is harmless because its
precondition is consumed and the replay self-rejects; re-issuing `write` is destructive.

**No new recovery state, no new decision, no class renaming** — one flag that says whether an
unknown outcome may be retried.

## No fourth state (§7)

`APPLIED_THEN_CHANGED` was rejected. Case C resolves to `unknown` → ESCALATE. Better evidence, not
more labels.
