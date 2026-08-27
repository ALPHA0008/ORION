# Execution-Fencing Audit

**Continuation point:** Claude Code completed the previous hardening phase and stopped during the
real-model phase after identifying and beginning to fix silent `grep` degradation. The real-model
phase was intentionally not continued. This audit starts from that point and is limited to lease
expiry, stale workers, execution-level fencing, and test-runner trust.

**Audit date:** 2026-08-27  
**Initial state:** before this audit's code changes  
**Repository identity:** `harness/` has no Git repository; the file tree is the version identity.

## Question

Can Worker A, after its lease expires and Worker B reclaims the Run, still cause a real tool side
effect, append an event, or terminalize the Run?

## Current code path before the fix

```text
Worker A
  Store.claim()                         -> runs.status=running, lease_token=A, expiry=T
  Worker.run()
    Store.renew(A)                      -> extends expiry before each loop iteration
    model.requested                     -> ordinary Store.append(), no lease token
    await model.invoke()                -> lease may expire while awaiting
    model.responded                     -> ordinary Store.append(), no lease token
    #runToolCall()
      tool.requested                    -> ordinary Store.append(), no lease token
      authorization
      tool.started                      -> ordinary Store.append(), no lease token
      await tool.run()                  -> real filesystem effect; no lease check
      tool.succeeded                    -> ordinary Store.append(), no lease token
    #stop()
      run.completed/run.failed event    -> ordinary Store.append(), no lease check
      Store.setStatus(..., token=A)     -> checks token identity, not expiry

Worker B
  reaper.reap()                         -> clears A's lease and requeues, CAS protected
  Store.claim(B)                        -> installs token=B
```

## Suspected dead code

`Worker.#ensureLease()` at `v0/src/agent/loop/worker.mjs:47-54` checks
`Store.holdsLease(runId, leaseToken)` and returns `false` when the lease is no longer valid. It
also attempted to append `run.lease_lost`. A repository-wide inspection found no call site. The
function was therefore dead: its result did not gate model continuation, tool authorization,
tool execution, event append, or terminalization.

## Fencing checks in the initial implementation

| Operation | Check before operation? | Initial result |
|---|---:|---|
| Claim | yes, status + expiry inside `BEGIN IMMEDIATE` | database claim fencing works |
| Renew | token identity only | late renewal could be accepted before reaper clears the token |
| Ordinary event append | no token parameter | any caller, including stale Worker A, could append |
| Model invocation | no check after the await | stale Worker A could continue |
| Tool execution | no check immediately before `tool.run()` | stale Worker A could perform the effect |
| `setStatus` | token identity, but no expiry check | expired-but-not-reaped owner could terminalize |
| Reaper reclaim | token + expiry CAS | concurrent reapers are fenced |
| Worker `#ensureLease` | function exists, no callers | no execution-level protection |

## Initial conclusion to prove with tests

The store-level tests prove that a stale token cannot call `setStatus()` after Worker B has
reclaimed the lease. They do **not** prove that Worker A cannot append events or execute tools.
The suspected gap is real in the code path: event appends are unfenced, and the filesystem call is
reachable after the model await without a lease assertion.

The race tests in `tests/fencing/fencing.test.mjs` establish the runtime behavior before and after
the minimal fix. The test uses a real file write, a controlled slow model promise, lease expiry,
reaper reclaim, and a second worker claim.

## Current behavior after the fix

The suspected dead function is no longer dead. `Worker.run()` binds the claimed token for the
session; every worker event append carries that token, and `#ensureLease()` is enforced before
continuation, before recovery effects, immediately before a tool effect, and before terminal or
pause transitions. A stale append is rejected with `LeaseLostError` and the worker returns
`lease_lost` without emitting a stale `run.lease_lost` event of its own. The reaper remains the
authority for recording lease loss.

### Exact sequence diagram

```text
Worker A                  Store / reaper              Worker B             External tool
   | claim(A,T1)                |                         |                     |
   |--------------------------->| running, token T1      |                     |
   | renew(T1) before turn      | expiry extended         |                     |
   |--------------------------->|                         |                     |
   | model.requested(T1)        | append checks live T1   |                     |
   |--------------------------->|                         |                     |
   | model.invoke() begins      |                         |                     |
   |                            | T1 expires               |                     |
   |                            | reap: CAS clears T1,     |                     |
   |                            | appends lease_lost       |                     |
   |                            |                         | claim(B,T2)         |
   |                            |                         |-------------------->|
   | model returns              |                         | owns T2             |
   |--------------------------->|                         |                     |
   | model.responded(T1)        | rejected: T1 not live   |                     |
   |--------------------------->|                         |                     |
   | #ensureLease(T1) / return  | no tool call            |                     |
   |                            |                         |                     |
   | stale append attempt       | rejected by token+expiry|                     |
   |--------------------------->|                         |                     |
   | stale terminal attempt     | appendStatus returns 0  |                     |
   |--------------------------->| no event, no status     |                     |
```

If the lease is lost after the final pre-effect assertion but before `tool.run()` starts, the
external call is already in the recovery boundary. The harness cannot revoke an arbitrary
filesystem, process, network, or vendor API operation after that point. The boundary test forces
exactly this interleaving and records the effect as in-flight, while still rejecting all later
authoritative events and terminal transitions.

## Guarantees

**Guaranteed:** database fencing rejects stale token-bearing event appends; expired tokens cannot
renew or change status; stale workers cannot append post-reclaim model/tool/terminal events through
the Worker path; terminal/pause event and status writes are atomic and token-fenced; a stale worker
returns `lease_lost` at the recovery boundary.

**Not guaranteed:** an external side effect already in flight, or one that begins in the tiny
interval after the final lease check and before the external system accepts it, cannot be undone by
the harness. Its event may be absent; the next owner must use the tool's recovery class and
`verify()` result rather than assume success or failure.

**Recovery behavior:** after a lost lease during a model call, the old worker stops and the next
owner reconstructs from the log. If a tool effect completed before its success event, the next
owner's orphan recovery applies `verify()`/recovery policy; ambiguous outcomes escalate. This is a
turn-level ownership guarantee with an explicitly documented external-effect boundary, not an
atomic distributed transaction across SQLite and arbitrary tools.
