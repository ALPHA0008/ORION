# ADR-009 — A paused run must be claimable

**Status:** Accepted (bug fix; found by the first real-model task)

## Context

When the authorization seam returns `escalate`, the worker persists a `HumanRequest`, appends
`run.paused`, and **releases the lease** — so no worker is pinned while a human is absent. That is
ADR-designed behaviour and it works.

Resuming is done by claiming the run:

```js
const c = store.claim('cli', { runId });
```

## Evidence

The very first real-model task (`test-01-basic.md`) escalated: the model asked to run
`sh test.sh`, which the shell classifier does not recognise as provably safe, so it was escalated
for approval. The human approved. The resume then **silently failed to claim**, and the run sat in
`paused` forever.

Root cause, in `Store.claim`:

```sql
SELECT id FROM runs WHERE id=? AND status IN ('pending','running') AND ...
```

**`'paused'` was not in the list.** A run paused for human approval — the *normal* outcome of an
escalation — could never be claimed, therefore never resumed. `harness resume` would have failed on
every escalated run.

### Why 310 tests did not catch it

The earlier human-pause test used a helper containing
`const target = claimed ?? runId;` — a fallback that used the run id even when the claim returned
`null`. The fallback masked the bug, and the assertion passed for the wrong reason.

A real model produced the escalation naturally, on the first task, with no helper in the path.

## Decision

`'paused'` is claimable, with different rules for the two claim modes:

```sql
-- targeted (runId given): the caller is explicitly resuming
status IN ('pending','running','paused')

-- untargeted (queue scan): only once a human has actually answered,
-- otherwise a generic worker would grab a run still waiting on a person
status IN ('pending','running')
  OR (status = 'paused'
      AND EXISTS (SELECT 1 FROM human_requests h
                  WHERE h.run_id = r.id AND h.status = 'answered'))
```

The asymmetry is the point. An explicit `harness resume <run>` is an instruction. A background
worker sweeping the queue must not pick up work that is still blocked on a person.

## Tradeoffs

- The untargeted scan now runs a correlated `EXISTS`. On the `hr_by_run(run_id, status)` index this
  is cheap, and the queue scan is already `LIMIT 1`.
- A caller can still resume a paused run that has *not* been answered. That is deliberate: the
  worker re-checks pending requests and pauses again immediately, which is the correct no-op.

## Tests

`tests/concurrency/lease.test.mjs`, written as failing tests before the fix:

- `a targeted claim CAN take a paused run (this is resume)`
- `the resuming worker holds a valid lease` / `status returns to running`
- `an unanswered paused run is not swept up by a generic worker`
- `once the human answers, the general scan CAN pick it up`

Suite went 47→51 assertions; full regression 310/310.

## Lesson recorded

**A test helper that falls back on failure can hide the very bug the test exists to catch.**
`claimed ?? runId` turned a hard failure into a silent pass. Helpers in crash- and
recovery-path tests must assert the precondition they depend on, not paper over it.
