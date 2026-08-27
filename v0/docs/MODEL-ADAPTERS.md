# Model adapters

```js
interface Model {
  name: string
  capabilities: Set<string>
  invoke(ctx): Promise<ModelResult>
}
```

The core knows nothing vendor-specific. V0 ships **one** adapter — an OpenAI-compatible
chat-completions client — deliberately: the provider exists to test the runtime, not to expand a
feature list.

```js
createOpenAICompatModel({
  baseUrl, apiKey, model,
  timeoutMs = 60_000, maxRetries = 3,
  pricing: { in_per_mtok, out_per_mtok },   // enables cost accounting
})
```

Works against anything speaking that wire format: OpenAI, OpenRouter, Together, vLLM,
LM Studio, Ollama's `/v1`.

## ModelResult

```js
{ content, tool_calls: [{ id, name, args, argError }],
  finish, finish_reason,
  input_tokens, output_tokens, cache_read_tokens,
  cost_usd, ttft_ms, duration_ms,
  ext: { provider-specific } }
```

`cost`, tokens and latency are **core fields**, not `ext` — every provider has them and they answer
first-order questions (ADR-004). Anything else provider-shaped goes in `ext` and is never read by
the reducer.

## Failure classification

The adapter's real job. The runtime reacts differently to each:

| condition | kind | retryable |
|---|---|---|
| 429 | `rate_limit` | yes (honours `retry-after`) |
| 5xx | `server_error` | yes |
| timeout / abort | `timeout` | yes |
| network error | `network` | yes |
| malformed / truncated JSON | `malformed` | yes |
| empty `choices` | `malformed` | yes |
| 4xx | `client_error` | **no** — fail fast, no retry storm |
| unparseable tool arguments | surfaced as `argError` | becomes `tool.failed` |

Retryable failures back off exponentially inside the client and emit a `degraded` event.
**Three consecutive failures terminate the run as `model_unavailable`** rather than burning the
turn budget (ADR-006).

### A bug worth knowing about

`ac.abort(new Error('timeout'))` makes `fetch` reject with **that** error, whose `.name` is
`'Error'` — not `'AbortError'`. Classifying timeouts by error name silently turns every timeout
into a hard failure. Track it with an explicit flag.

## Adding an adapter

Implement `invoke`. Put provider quirks in a **named shim** next to it — never in the core loop.
Hermes' evidence is decisive here: provider misbehaviour is not uniform and cannot be abstracted
away, only isolated.

If your adapter wraps an external *agent loop* rather than a model, you must also declare:

```js
capabilities: { recovery_granularity: 'turn' }   // see ADR-005
```

Never claim `'tool'` unless the protocol genuinely exposes a tool-started signal. Most do not — the
Claude Agent SDK, for one, emits a permission hook before the decision and a result after
completion, with nothing in between.
