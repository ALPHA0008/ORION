# Recovery

## The problem

A process dies between a tool's effect and the record of that effect. The log shows
`tool.started` with no `tool.succeeded`. Did the write land? Did the POST go through?

The log alone cannot say. **The two crash windows produce byte-identical logs.**

## The contract

Each tool computes its recovery contract **from its arguments** — not once, statically.

```js
recovery(args) -> {
  class: READ_ONLY | SAFE_RETRY | SELF_VERIFYING | EXTERNALLY_DEDUPED | TRANSACTIONAL | UNSAFE,
  precondition?,          // a token the effect invalidates
  dedup_key?,             // propagated to a remote that honours it
  verify?: () => 'applied' | 'not-applied' | 'unknown'
}
```

### Why per-invocation

```
bash("mkdir -p a/b")   ->  SAFE_RETRY
bash("echo x >> f")    ->  UNSAFE
```

Same tool. Opposite safety. A per-tool flag cannot express this, and `bash` is the most-used tool
there is.

## The classes

| class | meaning | on resume |
|---|---|---|
| `READ_ONLY` | no world effect | re-issue |
| `SAFE_RETRY` | `f(f(x)) == f(x)` for *these* args | re-issue |
| `SELF_VERIFYING` | carries a precondition the effect destroys | re-issue — it rejects itself |
| `EXTERNALLY_DEDUPED` | remote honours `dedup_key` | re-issue if a key is present |
| `TRANSACTIONAL` | effect + marker commit atomically | re-issue |
| `UNSAFE` | duplicates | `verify()` if possible, else **escalate** |

## SELF_VERIFYING is the strongest, and it is free

```
edit(path, old_string, new_string)   second application -> "old_string not found"
git commit                          second application -> "nothing to commit"
```

The effect destroys its own precondition, so a replay cannot apply twice. No key, no bookkeeping,
no cooperation from anyone.

**This is a rule for tool design, not just metadata:**
> Prefer content-addressed arguments. `edit(path, old, new)` is resumable. `append(path, text)` is not.

That is why V0 ships `edit` and `write` (full content), and no `append`.

## The decision

```
verify() available?
  'applied'      -> SKIP     (do not run it again)
  'not-applied'  -> REISSUE
  'unknown'      -> class-based
no verify():
  READ_ONLY | SAFE_RETRY | SELF_VERIFYING | TRANSACTIONAL -> REISSUE
  EXTERNALLY_DEDUPED with key                             -> REISSUE
  otherwise                                               -> ESCALATE
```

Every decision is recorded as a `tool.recovery_decided` event **and** a `degraded` event. Nothing
is decided silently.

## Proof

From the crash matrix — identical durable state, opposite outcomes:

```
crash after tool.started  ->  write SAFE_RETRY -> reissue  (verify: not-applied)
crash after tool.effect   ->  write SAFE_RETRY -> skip     (verify: applied)
```

Across 16 crash scenarios: **zero duplicated side effects**, every run resumed to the same world
state as an uncrashed run.

## The honest limit

`bash` with an arbitrary command is classified by a **short pattern list, not a shell parser**.
Anything not provably safe is `UNSAFE` and escalates. This produces false escalations. That is the
correct direction to be wrong in, but it is a real cost, and a proper shell parser (QM-style) is
the eventual answer.
