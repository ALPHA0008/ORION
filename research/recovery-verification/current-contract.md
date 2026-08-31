# The Current Recovery Contract — Traced From Code

Traced from `v0/src/core/recovery/index.mjs` and `v0/src/agent/tools/index.mjs`, not from
comments (§3).

## Classes and decisions

```js
RecoveryClass = { READ_ONLY, SAFE_RETRY, SELF_VERIFYING,
                  EXTERNALLY_DEDUPED, TRANSACTIONAL, UNSAFE }
Decision      = { REISSUE, SKIP, ESCALATE }

AUTO_REISSUE  = { READ_ONLY, SAFE_RETRY, SELF_VERIFYING, TRANSACTIONAL }
```

## `decideRecovery(recovery)` — the exact control flow

```
verify() present?
├── throws            -> ESCALATE
├── 'applied'         -> SKIP
├── 'not-applied'     -> REISSUE          ← the load-bearing line
└── 'unknown'         -> class in AUTO_REISSUE ? REISSUE : ESCALATE
no verify()
├── class in AUTO_REISSUE -> REISSUE
├── EXTERNALLY_DEDUPED    -> dedup_key ? REISSUE : ESCALATE
└── UNSAFE                -> ESCALATE
```

`verify()` outranks the class. Everything therefore depends on `verify()` being **truthful**, and
`'not-applied'` is trusted absolutely — it maps straight to REISSUE with no further checks.

## What each mutating tool's `verify()` actually observes

### `edit` — class `SELF_VERIFYING`, precondition = `old_string`

```js
const hasOld = c.includes(old_string), hasNew = c.includes(new_string);
if (hasOld && !hasNew) return 'not-applied';
if (!hasOld && hasNew) return 'applied';
return 'unknown';               // both present, or neither
```

Observes **two** witnesses: the **pre-state** (`old_string`) and the **post-state**
(`new_string`). The pre-state is what makes it self-verifying — its continued *absence* is
evidence the effect ran, independent of what happened afterwards.

Distinguishes: never-applied · applied · applied-then-changed (still `applied`, because
`old_string` remains absent) · genuinely ambiguous (`unknown`).

**Collapses:** an external revert to the original text → indistinguishable from never-applied.

### `write` — class `SAFE_RETRY`, precondition = `sha(content)`

```js
try { return sandbox.read(path) === content ? 'applied' : 'not-applied'; }
catch (e) { return isMissing(e) ? 'not-applied' : 'unknown'; }
```

Observes **one** witness: the **post-state** only. The declared precondition is a hash of the
*content it intends to write* — the goal, not the assumption. It can confirm the goal was reached;
it can never test whether the pre-state was what the caller believed.

Distinguishes: applied (exact content match) · everything else.

**Collapses — and this is the defect:**

| real world | reported |
|---|---|
| never applied | `not-applied` |
| **applied, then the world changed** | **`not-applied`** |

Both map to REISSUE. The second is a **lost update**.

### `bash` — class from `classifyShell()`

Conservative allow-list; anything not provably safe is `UNSAFE` → ESCALATE. Not implicated here.

### `read` / `grep` — `READ_ONLY`

No world effect.

## Summary of observability

| tool | witnesses | can see "applied then changed"? |
|---|---|---|
| `edit` | pre-state **and** post-state | **yes** — reports `applied`, decision SKIP |
| `write` | post-state only | **no** — reports `not-applied`, decision REISSUE |

The asymmetry is structural, not incidental: a precondition on the *pre*-state survives later
modification; a precondition on the *post*-state does not.
