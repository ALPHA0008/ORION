# Crash Around the Escalation Boundary (§14)

Suite: `v0/tests/escalationgate/escalation-lifecycle.test.mjs`. Crashes are injected with the
worker's existing `beforeAppend` hook at exact points, then durable state is inspected.

## Cases

| crash point | expected | measured |
|---|---|---|
| **before `human.requested`** | recoverable; nothing mutated | `tool.escalated=1, human=0, paused=0`; protected file unchanged; **`tool.started == 0`** ✅ |
| **after `human.requested`** | no duplicate request; run stays safe | request durable (`human.requested == 1`); **no duplicate** after a fresh worker resumes; file unchanged; run does **not** silently complete ✅ |
| after `run.paused` | lease reopens correctly | paused run is claimable by a second worker ✅ (covered in the gate suite) |

## The key property

In the first case the escalation was recorded but the pause was not — a torn boundary. Even so:

- **no mutation executed** (`tool.started == 0`)
- the protected file is byte-identical

The gate sits **before** the effect, so a crash anywhere around it cannot produce a partially
applied forbidden change. There is no window in which the file is modified but the escalation is
missing.

## Recovery does not re-attempt the bypass

After the second crash case, a fresh worker was started with the **same bypassing model**. It did
not mutate the protected file and the run did not silently complete — the gate re-applies to every
proposal, including post-recovery ones.

## No new durable machinery

All of this reuses the existing event model. No snapshot, journal, or side table was added, so the
crash matrix, fencing and lease suites are unaffected (verified: 501 passed, 0 failed).
