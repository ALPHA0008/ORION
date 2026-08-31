# Escalation Integration (§20, §21)

## The existing path is reused

`unknown` → `decideRecovery` → `ESCALATE` → the path already in `Worker.#reconcile`:

```js
const rid = S.createHumanRequest(runId, `After a crash, '${name}' may or may not have run. ...`,
                                 { options: ['approve', 'skip'] });
append('human.requested', { request_id: rid, tool_call_id: tcid });
return this.#pause(runId, leaseToken, ExitReason.AMBIGUOUS_RECOVERY, { request_id: rid });
```

`#pause` releases the lease. **No second pause mechanism was created** (§20).

## Crash around the escalation boundary (§21)

Covered by the existing `escalationgate/escalation-lifecycle` suite (**20 passed**), which crashes
at `before:human.requested` and `after:human.requested` and asserts:

| crash point | result |
|---|---|
| before `human.requested` | nothing mutated; protected artifact unchanged |
| after `human.requested` | request durable, **no duplicate** on recovery; run does not silently complete |
| after `run.paused` | paused run is claimable by a second worker (lease released) |
| resume | human answers → second worker claims → run continues to completion |

Those tests were written for the phase-6 gate, but the machinery is identical — `AMBIGUOUS_RECOVERY`
and `AWAITING_HUMAN` both flow through `#pause`. That is precisely the benefit of reusing the
existing path rather than adding one.

## Fencing (§19)

`fencing/fencing` — **29 passed, 0 failed**, unchanged.

The invariant *"a stale worker cannot create an authoritative write"* is unaffected: the witness
is checked inside `run()` and `verify()`, both of which sit **after** the lease check in
`#invokeTool` and neither of which touches lease logic. A stale worker is stopped by fencing
before the witness is ever consulted.

Note the two mechanisms are complementary, not redundant: fencing stops a **stale worker of the
same run**; the witness stops a **retry over a change made by anyone at all**, including a
developer or a formatter that the lease system knows nothing about.
