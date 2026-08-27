# ADR-003 — SELF_VERIFYING as a first-class recovery class

**Status:** Accepted (new; discovered by experiment)

## Context
Recovery mechanisms were assumed to be idempotency keys or external dedup.

## Evidence
Experiment 2 simulations #4 and #7, unplanned result:
```
patch/edit  second application -> "old_string not found"
git commit  second application -> "nothing to commit"
```
The effect **invalidates its own precondition**, so a replay cannot apply twice — it fails loudly
instead.

## Failure discovered
None. This is a capability the original taxonomy *lacked*. It is strictly stronger than an
idempotency key: no key, no runtime bookkeeping, no cooperation from a remote service.

## Decision
`SELF_VERIFYING` is a first-class class. A tool qualifies when its arguments carry a precondition
that the effect destroys.

**Consequence for the tool vocabulary, not just its metadata:**
> Prefer content-addressed tool arguments.
> `edit(path, old_string, new_string)` is safely resumable. `append(path, text)` is not.

This is why V0 ships `edit` (content-addressed) rather than `append`, and why `write` takes full
content rather than a delta.

## Tradeoffs
- Content-addressed arguments are more verbose for the model to produce.
- Ambiguity is possible (`old_string` a substring of `new_string`) — `verify()` returns `unknown`
  in that case and the run escalates rather than guessing.

## Tests
- `tests/recovery/recovery.test.mjs` — `edit` verified in BOTH directions: `reissue` before the
  edit, `skip` after; and a hand-replayed `edit` throws.
