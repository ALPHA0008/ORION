# ADR-008: Execution-level fencing for leased workers

## Status

Accepted for V0 hardening.

## Context

The original worker contained `#ensureLease()`, but no execution path called it. Worker event
appends were ordinary, unscoped appends; a model call could outlive its lease; tool execution had
no assertion immediately before the effect; and `setStatus()` checked token identity without
checking expiry. A reaper could therefore protect the `runs` row while a stale worker still wrote
events or performed a filesystem effect.

## Decision

Keep stateless workers, leases, the reaper, and fencing tokens. Enforce the token at the narrowest
existing seams:

1. `Store.append(..., { leaseToken })` checks token identity and live expiry transactionally and
   rejects stale writes with `LeaseLostError`.
2. `Store.renew()` rejects late renewal after expiry.
3. `Store.setStatus()` rejects an expired token, and `appendStatus()` atomically appends the
   terminal/pause event with the fenced status update.
4. `Worker.run()` binds the claimed token to the session. `#ensureLease()` is enforced before
   continuing after model/recovery work, immediately before `tool.run()`, and before terminal or
   pause transitions.
5. A stale worker returns `lease_lost`; the reaper, not the stale worker, records authoritative
   lease loss.

## Guarantee boundary

This provides database fencing and execution fencing for authoritative harness state. It does not
make SQLite and an arbitrary external tool one distributed transaction. After the final lease
assertion, an external effect may begin before expiry/reclaim is observed. If that happens, the
effect is in-flight and the following event append is fenced; the next owner must apply the
tool's recovery policy and `verify()` result.

## Evidence

`tests/fencing/fencing.test.mjs` passes 29 assertions, including 100 randomized
reclaim-before-resume races with zero stale effects/events/terminals and 100 forced final-boundary
races that observe the documented in-flight-effect limitation while recording zero post-reclaim
authoritative events or terminals.

## Consequences

The event log can contain an orphaned `tool.started` when the external effect crosses the boundary
and the worker then loses ownership. This is intentional and recoverable: orphan reconciliation
uses the existing recovery class and `verify()` seam. Stronger guarantees would require a tool
protocol with its own fencing/idempotency token, which is outside V0.
