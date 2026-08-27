# Replay Semantics — Phase J

Source: `v0/tests/replay/semantics.test.mjs` — **44 assertions, 44 pass.** Contract: ADR-007.

## The distinction, and why it needed a nondeterministic provider

```
replay(run, at?)  reconstruct historical state.       NO model calls. Deterministic.
fork(run, at)     new Run seeded with history[1..at]. Future is NEW.
rerun(task)       brand-new Run from the same task.   Shares nothing but intent.
```

Testing this against a deterministic model proves nothing: replay and rerun would agree by accident.
So the provider used here **appends a random nonce to every response** — identical input produces
different output, over real HTTP.

Confirmed before testing anything else:
```
provider output carries a nonce (is nondeterministic)   PASS
```

## Measured

| operation | model calls | reproduces original content? |
|---|---|---|
| **replay** | **0** | **yes — byte-identical, 3x in a row** |
| **fork** | 3 new | no — diverges; divergence visible in the fork's log |
| **rerun** | 5 new | **no** — same task, same tools, different text; same final world state |

The rerun row is the evidence. Same task, same tools, a *different* transcript — so
"replay ≠ rerun" is an observed fact, not a definition.

## Replay

```
kind is replay                                        PASS
replay made ZERO model calls                          0
replay reports model_calls_made = 0                   structural, not measured
byte-identical across 3 repeats                       PASS
reproduces the ORIGINAL nondeterministic content      PASS
snapshot-assisted projection == full replay           PASS
```

Point-in-time:
```
replay --at N stops at N                              PASS
mid-run state is not terminal                         status: running
mid-run has fewer messages                            5 < 10
point-in-time replay is repeatable                    PASS
```

## Fork

```
provenance: parent_run_id + forked_from_seq recorded  PASS
inherited history matches the source up to the point  PASS
fork has a visible seam event (run.resumed seam:true) PASS
source run unchanged                                  PASS
fork itself makes 0 model calls                       PASS
fork DID make new model calls when continued          3
fork diverged from the original                       PASS
divergence cause is in the fork log                   tool.denied
original replays identically AFTER being forked       PASS
fork out of range / at 0 rejected                     PASS
```

## The finding: forking a run forks the LOG, not the WORLD

The first fork test failed, and it was not a test bug. A fork inherits conversational history, but
the filesystem is whatever it currently is. Continuing a fork against the *post-run* workspace gave
an incoherent branch — the fork was reasoning about a file state that no longer existed.

**Fix:** workspace checkpoints — `attachCheckpoints(sandbox, shadowDir)`, a bare git shadow repo
(borrowed from Hermes). A checkpoint is taken before each authorized tool call; a fork restores the
newest checkpoint at or before the fork point.

```
a workspace checkpoint exists at/before the fork point   seq 22
original filesystem untouched by the fork                b.txt = VALUE=20
fork filesystem took the other path                      b.txt = VALUE=2
```

Two sub-findings worth recording:
- `git init --bare` fails if `GIT_WORK_TREE` is set in the environment — init must run with a clean env.
- **`core.autocrlf` silently corrupted restores on Windows** (`beta\nVALUE=2\n` came back as
  `beta\r\nVALUE=2\r\n`). A checkpoint that does not restore byte-exactly is worse than no
  checkpoint. Now disabled explicitly, with a byte-exactness assertion.

**V0 stance:** the CLI states the limitation rather than silently doing the wrong thing:
```
note: the WORKSPACE is not rewound automatically.
      run the fork in a fresh workspace, or restore a checkpoint first.
```

## Limits

1. **Fork is O(n) in events** — copies by INSERT. 1.9 ms @1.3k, 12.4 ms @10k, **1,811 ms @1M**.
   Copy-on-write is needed before very long runs are routine.
2. **Automatic workspace rewind is not wired into `fork()`.** The mechanism exists and is tested;
   the CLI warns instead of doing it, because choosing *which* workspace to rewind is a user
   decision in V0.
3. Replay reproduces *recorded* output. If the log were truncated or tampered with, replay would
   faithfully reproduce the tampered history — integrity of the log is assumed, not proven.
4. Fork provenance is one level deep; forks-of-forks work but are not tested.
