# Replay

```
replay(run, at?)   reconstruct historical state.   NO model calls. Deterministic.
```

`replay` folds the event log. It cannot call a model, so it cannot invent anything. It returns
`{ model_calls_made: 0, deterministic: true }` structurally.

```bash
harness replay #a81f2c            # final state
harness replay #a81f2c --at 23    # state as of event 23
```

## Replay is not rerun

With a nondeterministic model this distinction is the whole point. Verified against a provider that
appends a random nonce to every response:

| | model calls | reproduces the original? |
|---|---|---|
| `replay` | **0** | **yes — byte-identical** |
| `rerun` | 5 | **no** — same task, same tools, different transcript |

If replay called a model, it would produce a *different* run and call it history. It does not.

## What replay guarantees

- Byte-identical across repeats.
- Snapshot-assisted projection equals full replay from event 1, at every snapshot point.
- Point-in-time replay is exact and repeatable.
- Replaying a run that has since been forked still reproduces the original.

## What replay does NOT guarantee

- That re-running the model would produce the same output. It would not.
- That the *world* matches. Replay reconstructs the run's state, not your filesystem.
  For that, see `FORKING.md` and workspace checkpoints.
- Integrity of the log itself. A tampered log replays faithfully as tampered.
