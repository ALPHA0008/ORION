# `edit` Verification (§7)

**Verdict: `edit` is sound in every race tested. No change required.**

## What it observes

```js
const hasOld = c.includes(old_string), hasNew = c.includes(new_string);
if (hasOld && !hasNew) return 'not-applied';
if (!hasOld && hasNew) return 'applied';
return 'unknown';
```

Two witnesses — the **pre-state** and the **post-state**. The pre-state is the important one: the
continued *absence* of `old_string` is evidence the effect ran, and that evidence survives later
unrelated modification.

## Measured results

| §7 case | world | `verify()` | decision | correct? |
|---|---|---|---|---|
| A — old string still present | S0 | `not-applied` | REISSUE | ✅ |
| B — old gone, new present | S1 | `applied` | SKIP | ✅ |
| C — old gone, expected state modified after | S2 | **`applied`** | SKIP | ✅ |
| D — old gone, new also absent | same-region overwrite | `unknown` | REISSUE | ✅ harmless |

## Case C is the one that mattered

This is the "applied then changed" scenario the phase exists to test. `edit` gets it **right**:
`old_string` is still absent, so the effect demonstrably ran, and it reports `applied` → SKIP.
Verified end-to-end with a real process kill plus a concurrent modifier: the later change survives
untouched.

## Case D: `unknown` → REISSUE looked wrong, and isn't

`SELF_VERIFYING` is in `AUTO_REISSUE`, so an `unknown` verdict still reissues. That looked
dangerous, so it was **executed rather than reasoned about**:

```
world before reissue: "...let t = 99;..."
REISSUE REJECTED -> old_string not found in f.js
world after  reissue: "...let t = 99;..."     (unchanged)
```

The replay **self-rejects**, because the precondition it needs is gone. The concurrent change
survives. This is the ADR-002/003 property working exactly as designed: for a content-addressed
edit, re-issuing an already-applied operation is a no-op that fails loudly rather than a
destructive retry.

**The safety comes from the primitive, not from the decision.** That distinction matters for
`write`, which is in the same `AUTO_REISSUE` set but has no such self-rejection.

## The one case `edit` cannot see

An external actor restoring the exact original text makes `old_string` present again, so
`verify()` reports `not-applied` — indistinguishable from never-having-run. This is an
information limit, not a defect: the world is byte-identical in both histories.
See [`information-limit.md`](information-limit.md).

## Conclusion

`edit`'s recovery contract needs no change. Its `SELF_VERIFYING` class is accurate, its
precondition is the right one (pre-state, not post-state), and its `unknown` path is safe by
construction. Phase 3's `KEEP_EXISTING_EDIT` decision is further supported.
