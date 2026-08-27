# V0 Hardening Summary

## Scope and starting point

This audit resumed from Claude Code's stopping point after the deterministic V0 hardening work and
before any real-model integration. The real-model phase was not started. The initial audit covered
the complete V0 execution path and the Claude conversation; the prior stopping point and project
motive are recorded in `fencing-audit.md`.

## Finding

The suspected gap was real. `Worker.#ensureLease()` existed but had no callers. Before the fix,
Worker A could return from a slow model call after Worker B reclaimed the run, execute a real
filesystem write, append post-reclaim events, and append a terminal event. The old `setStatus()`
could also accept an expired-but-not-yet-reaped token. Database row fencing alone was therefore
insufficient.

## Changes

- Added live token checks to token-bearing event appends, renewal, and status writes.
- Added atomic fenced terminal/pause event + status transition.
- Bound each Worker session's token to its event appends.
- Enforced lease checks before continuation, tool execution, recovery effects, and terminalization.
- Made stale workers return `lease_lost` and left lease-loss authority with the reaper.
- Changed `tests/run-all.mjs` to fail closed on crash, timeout, signal, abnormal exit, missing
  summary, or reported failures.
- Added `tests/fencing/fencing.test.mjs` and `tests/runner/runner.test.mjs`.

## Evidence

The fencing suite passes **29/29**. Its 100 randomized reclaim-before-resume iterations recorded
zero stale filesystem effects, zero post-reclaim events, zero stale terminals, and zero ownership
conflicts. Its 100 forced final-boundary iterations recorded 100 in-flight external effects, but
zero post-reclaim authoritative events or stale terminals. This establishes the exact recovery
boundary rather than claiming impossible revocation of arbitrary external work.

The runner regression suite passes **7/7**. The aggregate runner now correctly reports red when the
current Windows security suite crashes before its summary (`263 passed, 1 failed` after all
required suites are included), instead of the former false-green `227 passed, 0 failed`.

## Exact guarantee

Guaranteed: stale workers cannot make token-fenced database appends, renew an expired lease,
terminalize or pause through the Worker path, or append authoritative events after reclaim. A
model-call return after ownership loss is discarded at the fenced continuation point.

Not guaranteed: an arbitrary external effect already in flight—or beginning in the tiny interval
after the last lease check—cannot be revoked. The effect may need recovery/verification by the new
owner, and its success event may be absent.

Recovery boundary: orphaned tools are handled by the existing recovery class and `verify()` policy;
ambiguous outcomes escalate. No real-model integration was performed.

## Remaining work / untested

- The existing Windows security suite still needs its own shell portability repair; the hardened
  runner now correctly exposes that failure.
- Multi-process stale-worker execution against a real external tool was not tested beyond the
  in-process controlled race.
- Real LLM behavior, provider failures under a real model, prompt injection against a real model,
  and real-model crash/resume remain deliberately untested.
- No product or developer-validation conclusion is implied.
