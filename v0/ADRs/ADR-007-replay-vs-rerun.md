# ADR-007 — replay, fork and rerun are three different operations

**Status:** Accepted

## Context
"Replay" is used loosely in agent tooling. With a nondeterministic model, the distinction between
*reconstructing* history and *re-executing* it is the difference between a fact and a fresh guess.

## Decision
```
replay(run, at?)  reconstruct historical state.       NO model calls. Deterministic.
fork(run, at)     new Run seeded with history[1..at]. Future is NEW.
rerun(task)       brand-new Run from the same task.   Shares nothing but intent.
```

`replay()` returns `{ model_calls_made: 0, deterministic: true }` **structurally** — it cannot call
a model, because it only folds stored events.

> Replay must never imply that re-executing the model would reproduce the output.

## Evidence
Verified against a provider that appends a random nonce to every response, so identical input
produces different output (`tests/replay/semantics.test.mjs`):

| operation | model calls | reproduces the original content? |
|---|---|---|
| replay | **0** | **yes — byte-identical** |
| fork | 3 new | no — diverges, and the divergence is in the log |
| rerun | 5 new | **no** — same task, same tools, different text, same final world state |

The rerun row is what makes the distinction empirical rather than definitional: a fresh execution
of the same task did **not** reproduce the original output.

## Failure discovered (this phase)
**Forking a run forks the log, not the world.** A fork inherits conversational history, but the
filesystem is whatever it currently is. Running a fork against the post-run workspace produced an
incoherent branch — it tried to "not apply" an edit that was still present on disk.

Fix: workspace checkpoints (`attachCheckpoints`, a bare git shadow repo, borrowed from Hermes) so a
fork can rewind the workspace to the fork point. Restore is byte-exact (`core.autocrlf=false`,
verified — the first implementation silently corrupted line endings on Windows).

The CLI states the limitation rather than hiding it:
```
note: the WORKSPACE is not rewound automatically.
      run the fork in a fresh workspace, or restore a checkpoint first.
```

## Tradeoffs
- Three verbs is more surface than one. But collapsing them is how "replay" comes to mean
  "re-run and hope", which is the failure this ADR exists to prevent.
- Fork copies events by INSERT — O(n). Measured: 1.9 ms @1.3k events, 12.4 ms @10k,
  **1,811 ms @1M**. Copy-on-write is needed before very long runs are routine. Documented, not
  fixed in V0.

## Tests
- `tests/replay/semantics.test.mjs` — 44 assertions: all three verbs, provenance, seam events,
  source immutability after fork, point-in-time replay repeatability, workspace rewind, guard rails.
