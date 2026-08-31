# Truth Table — What `verify()` Actually Reports

Produced by running the code (§6), not by reasoning about it.
Suites: `v0/tests/worldstate/worldstate.test.mjs` (19 assertions),
`v0/tests/worldstate/concurrent-race.test.mjs` (13 assertions, real process kills).

World states, content-addressed:

```
S0 = original                       H0=63bb8b6a
S1 = after the agent's mutation     H1=ecd5a2f8
S2 = S1 + a later, unrelated change H2=f2c9e21b
```

## `edit(old_string, new_string)`

| actual world | expected truth | `verify()` | decision | correct? |
|---|---|---|---|---|
| S0 — never applied | NOT_APPLIED | `not-applied` | REISSUE | ✅ |
| S1 — applied | APPLIED | `applied` | SKIP | ✅ |
| **S2 — applied then changed** | APPLIED_THEN_CHANGED | **`applied`** | **SKIP** | ✅ **safe** |
| same-region overwrite | ambiguous | `unknown` | REISSUE | ✅ **harmless** (see below) |
| external revert to S0 | APPLIED_THEN_CHANGED | `not-applied` | REISSUE | ❌ **information limit** |
| equivalent content by another actor | APPLIED | `applied` | SKIP | ✅ |

`edit` never produces a *harmful* misclassification in these races. Its pre-state witness
(`old_string` still absent) survives later modification, so S2 is correctly read as `applied`.

**On `unknown` → REISSUE:** this looked alarming, so it was executed rather than assumed. For
`edit` the reissue is **harmless** — the precondition is gone, so the replay throws
`old_string not found` and the world is untouched. Verified: the concurrent same-region change
survives intact. The safety comes from the *primitive*, not from the decision.

## `write(path, content)`

| actual world | expected truth | `verify()` | decision | correct? |
|---|---|---|---|---|
| S0 — never applied | NOT_APPLIED | `not-applied` | REISSUE | ✅ |
| S1 — applied | APPLIED | `applied` | SKIP | ✅ |
| **S2 — applied then changed** | APPLIED_THEN_CHANGED | **`not-applied`** | **REISSUE** | ❌ **LOST UPDATE** |
| unreadable target (EISDIR) | UNKNOWN | `unknown` | REISSUE (SAFE_RETRY) | ⚠️ |
| partial / torn write | NOT_APPLIED | `not-applied` | REISSUE | ✅ (converges) |

## The defect, proven end to end

`concurrent-race.test.mjs` runs a **real child process** that performs the write, is killed by the
**parent** with `SIGKILL` before any durable success event, after which a third actor appends a
legitimate change. Then recovery runs for real:

```
write child was alive when the parent killed it     ok
  effect landed on disk                             ok
write + concurrent change -> verify()='not-applied' decision='reissue'
  REISSUE silently destroys the concurrent change   ok   ← measured
```

The later change (`export const VERSION = 2;`) is gone. A real effect was redone over a legitimate
subsequent modification, with no error, no escalation, and no trace in the world.

## The two states that are genuinely collapsed

1. **`write`: "never applied" vs "applied then changed"** — both report `not-applied`. This is an
   *implementation* gap: `write` observes only the post-state. Richer evidence could fix it.

2. **`edit`: "never applied" vs "applied then reverted"** — both report `not-applied`. This is an
   *information-theoretic* limit, not a gap: the world and the durable history are byte-identical
   in both histories. See [`information-limit.md`](information-limit.md).

## Answering the phase question

> Is there a fourth state, APPLIED_THEN_CHANGED?

**It occurs, and it is currently misclassified — but only for `write`.**

- `edit` already handles it correctly, without any new state, because its precondition is the
  pre-state.
- `write` misclassifies it as `not-applied` and issues a destructive REISSUE.

So the evidence does **not** support adding a new recovery state across the board. It supports
fixing the *evidence available to one tool*. See
[`recovery-state-machine.md`](recovery-state-machine.md).
