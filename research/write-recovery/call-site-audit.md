# `write` Call-Site Audit (§2)

## Every call site

```
v0/src/agent/tools/index.mjs:196   write.run  -> sandbox.write(path, content)
v0/src/agent/tools/index.mjs:224   edit.run   -> sandbox.write(path, cur.replace(old, new))
```

**Two, both inside the tool layer.** Nothing else in `v0/src` mutates a file. `edit` is out of
scope (§ CRITICAL RULES) and already carries its pre-state witness in `old_string`.

## Who calls the write tool, and what is known beforehand

The only caller is `Worker.#invokeTool`. The ordering matters:

```
208  const recovery = tool.recovery?.(tc.args)     ← BEFORE the effect
240  append('tool.started', { name, args })        ← args become DURABLE here
249  out = await tool.run(tc.args)                 ← the effect
250  hook('after:tool.effect')                     ← the crash window
251  append('tool.succeeded' | 'tool.failed')
```

So at the moment `recovery()` is built, the runtime is about to perform the write and **the file's
current bytes are on disk and readable**. The runtime does not need the model to tell it the
pre-state — it can read it.

## Why the witness must live in `args`

After a crash, recovery does **not** reuse the object from line 208. `#reconcile` rebuilds it:

```
267  const recovery = tool?.recovery?.(pend.args)
```

`pend.args` comes from the projection, which stores exactly what `tool.started` recorded:

```js
case 'tool.started':
  s.pending_tool_calls[p.tool_call_id] = { name: p.name, args: p.args };
```

**Therefore any evidence needed for post-crash verification must be inside `args` before
`tool.started` is appended.** Anything computed later, or held only in memory, is lost by the very
crash it is meant to survive.

This is the whole design constraint, and it also answers §16: the evidence belongs in the
**existing event payload** (`tool.started.args`), which already survives crash, worker
replacement, resume, replay and fork. No new event type, no recovery metadata channel, no second
state store.

## Can any caller naturally supply the pre-state hash?

| source | verdict |
|---|---|
| **the model** (Option A) | **rejected** — it would make an LLM responsible for a correctness-critical hash, and a wrong or omitted hash would silently weaken the guarantee (§15) |
| **the runtime, immediately before the effect** (Option B) | **chosen** — the bytes are on disk, one read, fully trusted |
| a prior `read()` result (Option C) | rejected — the agent may not have read the file, may have read a *paged* excerpt (phase 1), or may have read it many turns earlier; the witness would be stale or absent |
| a new mechanism (Option D) | not needed |

## Consequence for the model-facing API

The tool schema stays `write(path, content)` (§15). The model is not asked for a hash and does not
need to know the mechanism exists. The runtime injects the witness into `args` before
`tool.started`, so it is durable and trusted.
