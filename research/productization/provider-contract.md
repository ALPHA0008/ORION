# Provider Contract Audit

Single module: `v0/src/agent/model/index.mjs` (142 ln). Deliberately **one** OpenAI-compatible
provider, not a multi-provider layer — the source says so explicitly ("ONE provider, per Phase H").

## Construction

```js
createOpenAICompatModel({
  baseUrl,                    // required — throws without it
  apiKey = null,              // Bearer, omitted when null
  model = 'gpt-4o-mini',
  name = null,                // defaults to `openai-compat:${model}`
  timeoutMs = 60_000,
  maxRetries = 3,
  pricing = null,             // { in_per_mtok, out_per_mtok }
  capabilities = ['tools'],
  shims = [],                 // applied to the NORMALISED result, in order
})
```

Returns `{ name, capabilities: Set, invoke }`.

## Request

```js
invoke({ messages, tools = [], temperature = 0, maxTokens = 2048, signal = null })
```

Body: `{ model, messages, temperature, max_tokens, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) }`.

Only sends `tools`/`tool_choice` when tools exist — correct, since some endpoints reject an empty
array.

## Normalised response — the important part

```js
{
  content,            // '' when absent, never undefined
  tool_calls,         // [{ id, name, args, argError }]
  finish,             // boolean: finish_reason !== 'tool_calls' AND no tool calls
  finish_reason,      // raw provider string, preserved
  input_tokens, output_tokens, cache_read_tokens,
  cost_usd,           // computed only when pricing supplied, else null
  duration_ms,
  ext,                // provider-specific escape hatch (model, system_fingerprint, attempts, shimmed)
}
```

Three properties worth calling out:

- **`argError` per tool call** — malformed JSON arguments are *carried*, not thrown. The runtime
  decides; the adapter does not editorialise.
- **`finish` is derived, `finish_reason` is preserved raw.** The runtime gets a normalised boolean
  and the provider's own string. Both survive into the log.
- **`ext.shimmed`** records *which* shims fired — the field that made B1/B2 parity classification
  possible in the Model-B protocol.

## Streaming

**NOT IMPLEMENTED.** Single non-streaming `fetch` per turn. Not a defect for this product — the
event log is turn-granular — but it must not be claimed.

## Errors

`ModelError` carries `{ retryable, status, kind }`. Retries on `429` and `5xx` with attempt
tracking. Timeout handled explicitly because aborting with a custom Error yields `name === 'Error'`,
not `'AbortError'` — a real footgun, correctly commented in source.

## Provider normalisation placement — the Qwen lesson

The Stage-1 investigations produced a hard-won rule, and the current design already follows it:

> **Provider/model quirks must be isolated at the adapter edge and must never contaminate the
> durable runtime.**

Evidence this is respected:

1. **Shims apply to the *normalised result***, not to raw wire data and not inside the worker. The
   Gemma shim reconstructs `tool_calls` from prose; the worker never learns that Gemma is special.
2. **Shims are conditional.** `applyGemmaToolCallShim` returns the result **unchanged** when the
   provider supplied native `tool_calls`. Verified during Model-B work: `ext.shimmed` absent for
   `mistral-small3.2`, `qwen3:8b`, `qwen3:14b`.
3. **Degradation is named, never silent.** Each shim application emits a `degraded` event naming
   the subsystem (`model_adapter`) and reason. Observed live: 36 `degraded` events in one Gemma run.
4. **Quarantine did not require a runtime change.** Qwen 3.6 35B's deterministic empty-completion
   failure was isolated to the model/serving layer; `v0/src` was never modified for it.

**Where provider-specific normalisation belongs:** in a shim, applied to the normalised result,
emitting a `degraded` event. That is the existing contract and it is correct.

## Gaps

| gap | severity | note |
|---|---|---|
| Shim registration is a **positional array** | medium | No name/negotiation. Two shims silently compose by order. Model-B parity had to be established by *reading* the shim source. |
| **No streaming** | low | Turn-granular log makes this a feature-add, not a fix. |
| **One provider family** | low | Honest scope. Anthropic/Bedrock would need adapters, not a rewrite. |
| **`capabilities` is decorative** | low | Defaults to `['tools']`; nothing enforces or negotiates it. |

## Recommendation for Wave 2 — minimal

Do **not** build a provider framework. Two small changes:

1. Give shims a **name** so `ext.shimmed` and any parity check read from a declared identity rather
   than source inspection.
2. Document the normalised response shape as a **public contract** — it is already stable and has a
   second consumer in `eval/`.
