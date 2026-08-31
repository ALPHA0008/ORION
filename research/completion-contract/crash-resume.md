# Crash and Resume (§22)

Suite: `v0/tests/completioncontract/completioncontract.test.mjs`.

## Scenario

Model stops prematurely → contract grants a continuation → **process crashes** → a fresh worker
claims the run and resumes.

```
crash after the continuation was granted     ok
  the continuation is durable                ok   continuation_count == 1
  resume completes the run                   ok
  the world was changed                      ok
  NO duplicate continuation was granted      ok   still 1
```

## Why no duplicate is possible

The continuation count is derived from the durable event log — `turn.started` carrying
`continuation: true` — and folded by the projection. It is never held in worker memory.

A crash therefore cannot buy a second continuation: the resuming worker folds the same events and
sees the credit already spent. This is the same discipline as ADR-011's pre-state witness, which
had to live in `tool.started.args` for exactly this reason.

## No lost task state, no accidental completion

The resumed run completed **because the world was actually changed**, not because the contract
forgot its state. Had the second worker also failed to act, the run would have terminated
`finished_without_change` — the credit was already used.

## No new durable machinery

No new event type, no snapshot, no side table (§21). `turn.started` already existed; it carries
one additional boolean. Crash matrix, fencing and lease suites are unchanged.
