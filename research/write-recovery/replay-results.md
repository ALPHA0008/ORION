# Replay (§17)

## Result: unchanged

`replay/semantics` — **44 passed, 0 failed**, identical to the frozen baseline.

## Why nothing changed

The witness travels inside `tool.started.args`, which is already part of the durable event
history and already folded by the projection:

```js
case 'tool.started':
  s.pending_tool_calls[p.tool_call_id] = { name: p.name, args: p.args };
```

No new event type, no new projection field, no parallel state store. Replay folds the same events
it always did; the args simply carry one more property.

## The three §17 hazards

| hazard | outcome |
|---|---|
| replay duplicates the write | **no** — replay is structurally model-call-free and does not execute effects |
| replay overwrites a legitimate change | **no** — a replayed recovery decision for a changed world is now ESCALATE, not REISSUE |
| replay loses the original effect | **no** — `applied` is still detected by content match, which is checked first |

Determinism is unaffected: `expected_pre_sha` is a fixed value recorded in the log, not something
recomputed at replay time. Replaying the same log yields the same classification.
