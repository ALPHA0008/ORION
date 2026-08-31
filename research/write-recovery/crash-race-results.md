# Crash Race Results (§10)

Suite: `v0/tests/worldstate/concurrent-race.test.mjs` — **18 assertions** (was 13).

A real child process performs the write and is killed by the **parent** with `SIGKILL` before any
durable success event; a third actor then changes the file; recovery runs.

## Before vs after, same race

```
UNWITNESSED (unchanged, still asserted):
  write + concurrent change -> verify()='not-applied' decision='reissue'
  REISSUE silently destroys the concurrent change      ok  ← the defect

WITNESSED (ADR-011):
  witnessed: child was alive when the parent killed it ok
    effect landed on disk                              ok
  witnessed write + concurrent change -> verify()='unknown' decision='escalate'
    verify() is UNKNOWN, not a false not-applied       ok
    decision is ESCALATE, not REISSUE                  ok
    THE CONCURRENT CHANGE SURVIVES                     ok
```

Both paths are asserted in the same suite, so the compatibility boundary is measured rather than
assumed: the unwitnessed path still behaves exactly as before, and the witnessed path is fixed.

## Why the parent does the killing

An earlier phase of this project had crash tests whose child killed itself on a timer that never
fired, because its own event loop was blocked — the run completed and the test passed for the
wrong reason. Every case here asserts the child was **alive** at the moment the parent killed it.

## `edit` is untouched

The same suite still shows `edit` reporting `applied` → SKIP on the unrelated-change race, and
`unknown` → a self-rejecting reissue on the same-region race. No behaviour changed.
