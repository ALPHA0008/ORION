# Recovery matrix — orphaned effects with a REAL model (Step 11)

An **orphan** is `tool.started` with no terminal event: the effect may or may not have landed, and
the durable log alone cannot say. Three cases were induced deliberately, each followed by a real
model continuing the run.

| case | decision | `verify()` said | outcome |
|---|---|---|---|
| not-applied → reissue | `reissue` | `not-applied` | `completed` / `model_finished` |
| applied → skip | `skip` | `applied` | `completed` / `model_finished` |
| unknown → escalate | `escalate` | — | `paused` / `ambiguous_tool_recovery` |

## Case A — effect did NOT happen → reissue

```json
{"tool_call_id":"orphan1","name":"write","class":"SAFE_RETRY",
 "decision":"reissue","verified":"not-applied","reason":"verify(): effect not applied"}
```

The file was absent, `verify()` reported `not-applied`, the runtime re-issued the write, and the
real model carried on to completion. Final content correct.

## Case B — effect DID happen → skip

```json
{"tool_call_id":"orphan1","name":"write","class":"SAFE_RETRY",
 "decision":"skip","verified":"applied","reason":"verify(): effect already applied"}
```

**Identical class, identical arguments, opposite decision** — because `verify()` probed the world
and found the effect already present. The write was not repeated.

This pair is the entire argument for `verify()`: the durable log is byte-identical in both cases,
so nothing but a probe of the real world can distinguish them.

## Case C — cannot be determined → escalate

An orphaned `bash` running `echo audit >> log.txt`. An append is not idempotent, and no `verify()`
exists for arbitrary shell.

- decision: **`escalate`**
- run: `paused` / `ambiguous_tool_recovery`
- **lease released** — no worker is pinned while a human is absent

The runtime did not guess. It stopped and asked.

## What the real model did afterwards

In cases A and B the model continued and completed normally. It was **not** confused by the
`[recovered] effect verified as already applied` tool message injected on the skip path — a small
but real result, since that message is synthetic text the model has never seen during training.

## Limitation, stated plainly

These orphans were **induced** by appending a `tool.started` event directly. In the natural crash
tests (`crash-resume.md`) every kill landed on `model.requested`, because the model call dominates
wall-clock time and that is where a randomly-timed kill falls.

Inducing the orphan is the only reliable way to exercise this branch. The branch itself is the same
code on the same resume path — but the *combination* "real crash → real orphan → real model
continues" has been demonstrated by construction, not by chance.
