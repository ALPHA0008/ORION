# Crash Results — Q4

Probe: `eval/mutation-observability/crash.mjs` · data: `results/crash.json`

After a crash the runtime rebuilds recovery from `pend.args` — precisely what `tool.started`
recorded (ADR-011 §2). So what it can conclude is fully determined by the recovery descriptor for
those args, which is what the probe reconstructs at each crash point.

## Result — bash

| crash point | real world | can classify? | decision | safe |
|---|---|---|---|---|
| before effect | file unchanged | **no — UNKNOWN** | escalate | **yes** |
| after effect, before `tool.succeeded` | file CHANGED | **no — UNKNOWN** | escalate | **yes** |
| after `tool.succeeded` | file CHANGED | **no — UNKNOWN** | escalate | **yes** |
| after effect, log write lost | file CHANGED | **no — UNKNOWN** | escalate | **yes** |

```
reason: UNSAFE with no verify() — cannot determine whether the effect landed
```

## Contrast — witnessed `write`, same scenario

| situation | `verify()` | decision |
|---|---|---|
| effect never ran | `not-applied` | **reissue** (safe — world untouched) |
| crashed after the effect | `applied` | **skip** |
| applied, then third party changed it | `unknown` | **escalate** |

`write` distinguishes all three. `bash` distinguishes none.

## Verdict: `BASH_RECOVERY_UNCERTAIN_BUT_SAFE`

Both halves matter and neither should be dropped:

- **Uncertain** — the runtime genuinely cannot tell whether a bash effect landed. `BASH_RECOVERY_UNCERTAIN`
  is a true statement about its knowledge.
- **Safe** — at *every* crash point the decision is `escalate`. There is no crash point at which the
  runtime re-issues a bash command that may already have run, so there is no path by which recovery
  destroys work on a guess. That is the failure mode ADR-011 existed to eliminate, and it is already
  absent here.

The cost is availability, not correctness: a crashed run with a pending bash mutation always needs a
human, where a witnessed `write` would resolve itself. Given that bash commands are arbitrary and
frequently non-idempotent (`>>`, `mv`, `pip install`), escalation is the *correct* posture rather
than a limitation to engineer away.

## What would change this verdict

Only evidence that some `UNSAFE` bash command is auto-reissued after a crash. The probe shows the
opposite at all four crash points, and `decideRecovery`'s final branch is unconditional:

```js
return { decision: Decision.ESCALATE, class: cls, verified: null,
         reason: 'UNSAFE with no verify() — cannot determine whether the effect landed' };
```
