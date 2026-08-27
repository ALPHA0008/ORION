# Contributing

## The rule that governs this codebase

> **Nothing enters core without a concrete failure mode it solves.**

Every pull request that adds to `src/core/` must answer, in the description:

```
Feature:
Failure mode it solves:      (a specific thing that broke, or provably will)
Evidence:                    (a test, a benchmark, a real incident)
Why core, not a plugin:
Complexity introduced:       (files, abstractions, dependencies, config knobs, new failure modes)
Test that proves it works:
```

If nobody can fill in "failure mode", the answer is no. This is not bureaucracy — it is the only
thing keeping this core at ~2,000 lines while the systems it learned from are 267,000 and 2.5
million.

## Deliberately not built

Do not open PRs adding these without new evidence:

semantic memory · skills · subagents / swarms · MCP · multiple model providers · multiple sandbox
backends · Postgres · consensus · RL · learned routing · planners · visual builders · plugin
marketplace · chat integrations

Each was considered and deferred. Several exist in the audited projects and are **unreachable or
uncalled there** — that is the specific outcome this rule exists to avoid.

## Tests

```bash
node tests/run-all.mjs
```

New behaviour needs a test that would **fail without it**. Two rules learned the hard way in this
codebase:

1. **Assert effects, not the absence of exceptions.** `expect(fn()).not.toThrow()` proves nothing.
   A flagship "learning" function in one audited project passed exactly that assertion while being
   provably a no-op. If a function claims to change state, assert the state changed.

2. **A crash test must actually crash.** Two early crash tests here killed nothing: the child's own
   `setTimeout(kill)` never fired because a busy-wait blocked its event loop, so the run completed
   first and the test passed for the wrong reason. Kill from the **parent**, and assert the child
   was alive immediately beforehand.

Both rules exist because both mistakes were made here first.

## Style

Node 24+, ESM, no build step, no runtime dependencies. Keep it that way unless there is a reason
that survives the rule above.
