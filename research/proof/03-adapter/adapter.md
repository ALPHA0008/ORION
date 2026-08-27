# Experiment 3 — The Adapter

**Built:** exactly one external adapter, per the brief (`adapter.mjs`, 190 lines).
**External loop:** Claude Agent SDK v0.3.211.
**Source of truth for the wire format:** the real type definitions in
`research/repos/qm/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

## Interface

```
makeAdapter({ onEvent, mode })  ->  { handle(sdkMessage), ledger }
```

`handle()` translates one external message into zero or more core events and records every field it
touches in a **fidelity ledger** with one of three dispositions:

```
mapped     -> lands in a core event field
extension  -> preserved in payload.ext (extension mode only)
lost       -> not representable at all
```

The ledger is the instrument. It is what makes "how much is lost?" a measurement rather than an
opinion.

## Two modes, so the closed-vocabulary question could be answered empirically

- `mode: 'closed'` — only the 31 core event types and their declared fields. Anything else is `lost`.
- `mode: 'extension'` — same event *types*, but unmapped provider fields are preserved under
  `payload.ext`.

Both modes were run over the identical message stream so the difference is attributable purely to
the vocabulary decision.

## Design notes

- **Statefulness is unavoidable.** The adapter keeps a `pendingToolUse` map because the SDK reports
  a tool's *name* in the `assistant` message and its *result* in a later `user` message, keyed only
  by `tool_use_id`. Reassembling `tool.succeeded{name, result}` requires holding that mapping.
  This is a real cost of adaptation: the adapter is not a pure function.
- **`can_use_tool` → `tool.requested`.** The SDK's permission hook is the closest thing to an
  authorization point, so it maps onto our seam. Note it fires *before* the decision, unlike our
  own `tool.authorized`.
- **Errors are classified, not just copied.** `SDKAssistantMessageError` is a closed enum
  (`sdk.d.ts:2846`); `rate_limit`, `overloaded`, `server_error` are marked retryable, the rest not.
  This is the one place the adapter adds information rather than losing it.
- **`stream_event` is dropped deliberately.** Token deltas do not belong in a durable log.

## What the adapter could not do

It cannot synthesise a `tool.started` event, because the SDK never emits one. That single absence
is what limits crash recovery on rented loops to turn granularity — see `event-fidelity.md` §3.
