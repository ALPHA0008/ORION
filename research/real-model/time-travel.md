# Time travel with a REAL model (Steps 12 + 15)

## The invariant, demonstrated rather than asserted

The model is genuinely nondeterministic. The required invariant is:

```
replay(original) == the original execution     NOT     rerun(task) == the original execution
```

| operation | model calls | reproduces the original transcript? |
|---|---|---|
| **replay** | **0** | **yes — byte-identical, repeatedly** |
| **rerun** | 16 events of new work | **no** — a different transcript for the same task |
| **fork** | new | no — diverges after the fork point |

`rerun` producing a *different* transcript for an identical task is what makes this an empirical
result rather than a definition. With a deterministic model the two would have agreed by accident
and proved nothing.

## replay

- **0 model calls**, measured before/after rather than merely asserted
- byte-identical across repeats
- reproduces the original model output exactly
- snapshot-assisted projection == cold full replay
- point-in-time replay stops where asked and is repeatable

## fork

- provenance recorded (`parent_run_id`, `forked_from_seq`)
- inherited history matches `replay(original, at=forkPoint)` exactly
- the source run is untouched and **still replays identically after being forked**
- the fork made new model calls and diverged

## TWO findings about fork

### 1. Forking the log does not fork the world (re-confirmed)

A fresh workspace starts empty. The caller must rewind the filesystem from a checkpoint. The CLI
states this rather than silently doing the wrong thing.

Related fix made during this phase: `sandbox.restore()` was wrong in two ways —
it crashed on an **empty** checkpoint (`pathspec '.' did not match any file(s)`) and it left files
created *after* the checkpoint in place, so the restored tree was a superset of the checkpoint.
Now uses `read-tree` + `checkout-index` and prunes untracked leftovers, verified byte-exact.

### 2. NEW — forking MID-TURN is semantically ambiguous

The fork point chosen here landed just after `model.responded` but before the tool ran. Transcript
repair filled the unanswered tool call with `[no result recorded]`, and **the real model read that
as "already done" and replied `DONE` without redoing the work.**

That is a genuine coherence hazard, and it was only visible with a real model — a scripted model
would have followed its script regardless.

**Change made.** `fork()` now inspects the inherited prefix for tool calls that were requested but
never resolved. It returns `at_turn_boundary: false` with the open calls listed, emits a
`degraded{subsystem:'fork'}` event into the new run's log, and the CLI prints:

```
warning: event 9 is MID-TURN — 1 tool call(s) were requested but never resolved: write#gemma_0_…
         the resumed model sees "[no result recorded]" for these and may
         treat them as already done. For a clean split try --at 6.
```

`nearestTurnBoundary()` computes the suggested clean point. Forking mid-turn remains **allowed** —
it is sometimes exactly what you want — but it is no longer silent.
