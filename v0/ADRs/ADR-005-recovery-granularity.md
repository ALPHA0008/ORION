# ADR-005 — Adapters declare their real recovery granularity

**Status:** Accepted (new; discovered by experiment)

## Context
The architecture allows renting an external agent loop. The question is whether a rented loop gets
the same guarantees as the built-in one.

## Evidence
Experiment 3, adapting a real Claude Agent SDK message stream:
```
tool.requested = 1   tool.started = 0   terminal = 3
projection at crash point: pending_tool_calls = []
```
The SDK emits `can_use_tool` (a permission hook, *before* the decision) and later a `tool_result`
(*after* completion). **There is no message in between.**

## Failure discovered
For an adapted run, the projection can never hold a `pending_tool_call`. The ADR-002 orphan
machinery — which works on our own loop — **has nothing to act on**. This is a property of the
external protocol, not a fixable adapter defect.

## Decision
Recovery granularity is a **declared capability**, following QM's practice of publishing capability
gaps rather than pretending parity:

```
capabilities: { recovery_granularity: 'tool' | 'turn' }
```

- **Built-in loop → `tool`.** The only configuration where the full recovery story holds. It is the
  default and the reference implementation, not a peer.
- **Rented loop → `turn`.** Replay, fork and explain all work; crash recovery can only restart or
  escalate the whole turn.

## Tradeoffs
- Two tiers of guarantee is more to explain than one. The alternative — claiming tool-level
  recovery for loops that cannot support it — is dishonest and would fail in production.
- V0 ships **only** the built-in loop. The adapter is deferred precisely so users are not put on
  the degraded path first.

## Retro-explanation
QM's durability is run-level (lease → reaper → requeue the whole run) rather than step-level. That
read as a design choice; it is better understood as a **consequence of renting four loops**. QM
could not have built tool-level recovery on borrowed loops.

## Tests
- Experiment 3 §6 — `tool.started = 0` on an adapted run; orphan undetectable.
- `tests/crash/matrix.test.mjs` — tool-level recovery demonstrated on the built-in loop, so the
  contrast is measured rather than asserted.
