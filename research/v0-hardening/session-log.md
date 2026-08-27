# Hardening Session Log

Date: 2026-08-27 (Asia/Calcutta)  
Workspace: `D:\Abhijith P\Desktop\harness`

## Starting point

- Resumed after Claude Code's latest conversation stopped during the deterministic V0 hardening
  work, before real-model validation.
- Read the repository structure, V0 source/tests/docs, and the relevant Claude JSONL conversation.
- Confirmed the task boundary: no real-model integration in this session.
- Existing audit artifacts at start: `fencing-audit.md`, `fencing-race-results.md`, and
  `test-runner-audit.md`; the fencing test was still an unfixed probe.

## Investigation

1. Traced claim, renew, model await, authorization, tool execution, event append, terminalization,
   reaper, reclaim, and token handling.
2. Confirmed `Worker.#ensureLease()` existed but had no callers.
3. Ran the unfixed probe: stale A performed a real file write and appended post-reclaim events;
   an expired-but-not-reaped token could also terminalize. The old probe recorded 9/9 observed
   vulnerability assertions.
4. Reproduced the aggregate runner defect: the Windows security suite exited before its summary,
   while the old runner converted its missing `-1` failure count to zero.
5. The Windows sandbox temporarily rejected new process launches (`CreateProcessWithLogonW` 1385)
   because two abandoned Claude harness bash/provider trees were still running. Stopped only those
   identified old harness PIDs; no repository files or unrelated browser/MCP/IDE processes were
   removed.

## Changes made

- `v0/src/core/run/store.mjs`: added `LeaseLostError`, live token checks for append/renew/status,
  and atomic `appendStatus()`.
- `v0/src/agent/loop/worker.mjs`: bound lease tokens to sessions; enforced lease ownership around
  continuation, recovery, tool execution, and terminal/pause; stale sessions return `lease_lost`.
- `v0/tests/fencing/fencing.test.mjs`: replaced the unfixed probe with separate database/tool/
  terminal tests, 100 randomized reclaim-before-resume races, and 100 forced final-boundary races.
- `v0/tests/run-all.mjs`: made required-suite health fail closed and included fencing and runner
  suites.
- `v0/tests/runner/runner.test.mjs`: seven summary/crash/timeout/signal regression cases,
  including a real crashing child.
- `v0/ADRs/ADR-008-execution-fencing.md`: decision and guarantee boundary.
- Updated the three audit artifacts and created `summary.md`.

## Verification completed

- Fencing suite: **29 passed, 0 failed**.
- Runner trust suite: **7 passed, 0 failed** (including a real crashing child process).
- Final aggregate: **263 passed, 1 failed across 9 suites**. The one failure is the pre-existing
  Windows security-suite crash before summary; the new runner correctly fails the overall run.
- A first post-renewal aggregate exposed a test-timing flake; the randomized race was corrected
  to await actual model-call entry before expiring the lease. The final aggregate was rerun after
  that correction and remained **263 passed, 1 failed across 9 suites**.
- 100 reclaim-before-resume races: zero stale effects, events, terminals, or ownership conflicts.
- 100 final-boundary races: 100 in-flight external effects observed; zero post-reclaim authoritative
  events or stale terminals.

## Ending point / next Claude handoff

The fencing bug is fixed to the documented recovery boundary, and the runner is fail-closed. Do
not interpret the final aggregate red result as a fencing failure: it is the runner correctly
exposing `security/security`'s Windows shell crash. The next technical action, if desired, is a
separate Windows shell portability fix and full rerun. Real-model validation remains blocked by
the user's explicit instruction not to start it during this hardening task.
