# Replay and Fork (§23)

## Results

```
replay reproduces the terminal state                       ok
  and the same exit reason                                 ok   finished_without_change
  and the same continuation count                          ok
  replay made zero model calls                             ok
fork before the continuation has no continuation credit    ok
```

Full `replay/semantics` suite: **44 passed, 0 failed** — unchanged.

## Why replay is unaffected

Completion interpretation is reconstructed entirely from the event log:

- the terminal decision is recorded as `run.failed { reason: 'finished_without_change' }`
- the continuation is recorded as `turn.started { continuation: true }`
- the projection folds both

Nothing depends on transient in-memory state, so replaying the same log yields the same
interpretation. Determinism is preserved.

## Fork semantics

A fork taken **before** the continuation event produces a child with `continuation_count === 0` —
it inherits no credit and may earn its own. That is correct: the child is a different future, and
it should not be penalised or advantaged by a decision its parent made after the fork point.

The parent keeps its own count, unchanged.

## One caveat worth stating

`objectiveSatisfied` is a **live predicate**, not a recorded value. Replay reconstructs the
*recorded decision* faithfully, but if the world has since changed, re-running the contract
against the current world could reach a different answer than the original run did.

This is the same property `edit` and `write` verification already have (phases 4 and 7), and it is
correct: the contract asks about the world **now**, and replay does not re-execute effects. It is
recorded here so the distinction between *reconstructing a decision* and *re-deciding* stays
explicit.
