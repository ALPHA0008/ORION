# Concurrent Modifier Races (§10–§11)

Real process kills, not simulated failures. A child performs the mutation and then hangs; the
**parent** kills it with `SIGKILL` before any durable success event; a third actor modifies the
file; recovery then runs.

Killing from the parent is deliberate: an earlier phase of this project had crash tests whose
child killed itself on a timer that never fired, because its own event loop was blocked. Every
case below asserts the child was **alive** at the moment the parent killed it.

Suite: `v0/tests/worldstate/concurrent-race.test.mjs` — 13 assertions.

## The four modification types (§11)

| type | modification | `edit` | `write` |
|---|---|---|---|
| **1 — unrelated region** | third actor changes a different line | `applied` → SKIP ✅ | **`not-applied` → REISSUE ❌** |
| **2 — same region** | third actor rewrites the edited line | `unknown` → REISSUE, **self-rejects** ✅ | `not-applied` → REISSUE ❌ |
| **3 — exact inverse** | third actor restores the original bytes | `not-applied` → REISSUE (information limit) | `not-applied` → REISSUE |
| **4 — equivalent content** | third actor independently produces the same bytes | `applied` → SKIP ✅ | `applied` → SKIP ✅ |

## Type 1 — the decisive case

```
edit child was alive when the parent killed it      ok
  effect landed on disk                             ok
edit + unrelated concurrent change -> verify()='applied' decision='skip'
  concurrent change survives                        ok
```

vs

```
write child was alive when the parent killed it     ok
  effect landed on disk                             ok
write + concurrent change -> verify()='not-applied' decision='reissue'
  REISSUE silently destroys the concurrent change   ok   ← measured
```

**Same race, same crash, opposite outcomes.** The difference is entirely which witness the
tool carries.

## Type 2 — why `edit`'s REISSUE is safe

`edit` reports `unknown` (both witnesses gone) and `decideRecovery` still says REISSUE, because
`SELF_VERIFYING` is in `AUTO_REISSUE`. Rather than assume that is fine, the test **executes** it:

```
decision on unknown is 'reissue' — safe here only because edit self-rejects
  reissue of an already-applied edit self-rejects    ok
  world is untouched by the reissue                  ok
  the concurrent same-region change survives         ok
```

The replay throws `old_string not found` and changes nothing. Safety comes from the **primitive**,
not the decision — which is exactly why the same decision is unsafe for `write`.

## Type 3 — the information limit

An external revert makes the world byte-identical to never-having-run. Both tools report
`not-applied`. No probe can do better; see [`information-limit.md`](information-limit.md).

## Type 4 — content-addressing working

If another actor independently produces the intended bytes, the goal state is satisfied and both
tools correctly report `applied` → SKIP. Redoing the work would be pointless.

## What this establishes

1. The "applied then changed" state is **real and reachable** under a genuine crash-plus-race.
2. It is **correctly handled by `edit`** and **misclassified by `write`**.
3. The misclassification is **destructive**, not merely imprecise: a legitimate later change is
   silently lost.
4. The distinction tracks the **witness**, not the tool's name or its declared class.
