# Wave 4 — Provider abstraction + streaming + provenance: implementation report

**Written retroactively on 2026-09-05**, from commits `1be187a` (4a) and `c8b106f` (4b), the
approved `wave4-plan.md`, and the verified state at the time of writing.

This report did not exist when Wave 4 was committed. That absence is itself a finding: the manual
testing section is exactly where F5 — Wave 4's capability being unreachable from the CLI — would
have been caught, because writing "step 3: swap the provider from the product surface" forces you
to discover there is no way to do it. The gap is recorded here rather than papered over, and the
manual section below distinguishes precisely what was exercised from what was not.

---

## Summary

| | before Wave 4 | after Wave 4 |
|---|---|---|
| Test suite | 797 / 28 suites | **904 passed, 0 failed / 30 suites** |
| Event contract | v3, 36 types | **v4, 39 types** (`stream.*`) |
| Providers | one hardcoded OpenAI-compatible client | **two behind a factory seam** |
| Request provenance | model name only | provider, host, digest, params, counts, context bytes |
| `ttft_ms` | declared since Phase H, **always null** | **populated** (measured 215 ms) |

---

## 4a — Provider abstraction + provenance (`1be187a`)

### The seam already existed

The worker called `model.invoke({messages, tools})` and read a `ModelResult`; it knew nothing
vendor-specific. Wave 4a therefore made the **existing** seam real rather than inventing an
abstraction: `createProvider({kind})` with `openai-compat` (behaviour unchanged) and `anthropic`.

### Anthropic was chosen to falsify, not to cover

A second OpenAI-compatible endpoint would have proved nothing. Anthropic differs precisely where a
leaky seam shows: the system prompt is a top-level field, tool results are content blocks on a user
message, tool calls return as `tool_use` blocks, the stop reason is `stop_reason`, and auth is
`x-api-key`. All of it is confined to `anthropic.mjs`. The plan's stop rule — halt if vendor
specifics leak into the core — **was not invoked**.

`ModelError` moved to `errors.mjs` so a provider can import it without a cycle through the factory
that imports the provider. Re-exported; public surface unchanged.

### Provenance

`model.requested` now carries `provider`, `endpoint_host`, `request_digest`, `params`, message/tool
counts and `context_bytes`. A **digest, never the request** — storing full context every turn is the
unbounded-blob problem Wave 3 removed. Keys are sorted at every level so structurally identical
requests digest identically.

Recorded **after** compaction, because the digest must describe what was actually sent. Request
preparation also moved out of the `try` that catches model failures: swallowing a preparation error
as `model.failed` would misattribute a harness bug to the provider, which is the confusion this
provenance exists to end.

### A credential leak, found by the leak scan — and not in the new code

Acceptance test V2 scans the whole log for secrets. It **failed**. `fetch` refuses a credentialed
URL with an error that echoes the whole URL back, and provider error text was recorded verbatim:

```
model.failed: "...includes credentials: http://someuser:SUPERSECRET@127.0.0.1:8000/v1/..."
```

A secret could reach the durable log through an *error string* even though every field the runtime
chose to record was clean. `redactSecrets()` scrubs URL userinfo and common token shapes, applied
where text is **written** rather than displayed — redacting only at render time leaves the secret
in the log.

**How it hid:** the first version of those regexes was written through a text-processing step that
turned `\b` into a literal `0x08` byte. Invisible in `toString()`, and they silently never matched.
The redactor looked correct and did nothing. Only testing each pattern individually exposed it.

### Acceptance — all passed

P1 same task through both providers driving real tools · P2 structurally identical `ModelResult` ·
P3 a tool call round-trips through Anthropic content blocks · P4 capability negotiation explicit ·
P5 the Gemma shim fires on an Anthropic-shaped result · P6 unknown kind throws at construction ·
V1 provenance fields present · V2 no credential or unredacted URL in the log · V3 digest
sensitivity · V4 digest reproducible under an independent reader and a fork.

---

## 4b — Streaming as durable partial execution (`c8b106f`)

### Framing

Streaming here is **not** rendering. Terminal output is a consumer of the stream, never its purpose.
The requirement is that a partially-completed model call leaves durable, attributable evidence, so
a crash mid-stream is recoverable, `ttft_ms` becomes observable, and replay reconstructs the turn at
zero model cost. A cosmetic stream would have been the first feature in this runtime producing no
trajectory.

Contract **v3 → v4, 36 → 39 types**: `stream.started` / `stream.delta` / `stream.finished`.
Additive only — a test asserts every earlier member survives.

### Cadence is the load-bearing decision

One event per token would multiply the log by the token count and reintroduce unbounded inline
content from the other direction. Deltas emit on a **byte (1 kB) or time (400 ms)** threshold, and
an accumulation crossing the Wave 3 artifact threshold is promoted to an artifact — the
`stream.delta` then carries only `artifact_id`. Measured: 400 pushes → 4 delta events.

SSE parsing buffers across chunk boundaries; a boundary can fall mid-line and mid-UTF-8 character,
so a naive per-chunk split silently corrupts multi-byte text.

A stream that dies part-way still produced evidence: the accumulator's partial is attached to the
error and recorded as `stream.finished { aborted: true, bytes, chunks }` before re-throwing.

### Acceptance — S5, S6, S8 were blocking gates; all passed

S1 events appended · S2 `ttft_ms` populated and > 0 · S3 bounded cadence · S4 large accumulation
becomes an artifact · **S5** replay makes zero model calls · **S6** a killed stream leaves a durable
partial with no half-applied effect · S7 the lease survives a stream that outlasts it (781 ms vs a
400 ms lease) · **S8** a streamed and a non-streamed run reach the **same final projection**.

S8 decided whether the feature could ship. Had it failed, streaming would have been a second
execution model — what Wave 2 refused for the REPL.

---

## Manual testing — what was and was not exercised

The standing gate (`MASTER-HARNESS-DEVELOPMENT-PLAN.md` §8) requires a real installed-build terminal
test with a real model. Stating plainly what that covered:

### Exercised with real models

| step | evidence |
|---|---|
| Install | tarball into a clean dir; `--version` `0.1.2`; contract v4, 39 types, 66 exports |
| Provider A — gemma4-31b / vLLM (openai-compat) | real fix-the-bug task; **file on disk** `return a + b`, `1 passed` |
| Provider B — qwen3:14b / Ollama (openai-compat) | same task, swapped by configuration; file fixed |
| Streaming | real endpoint: `ttft_ms: 215`, 6 bounded deltas / 571 bytes, `replay → 0 model calls` |
| Mid-stream severance | proxy severed the connection: `aborted: true`, bytes received recorded, failure attributed, workspace untouched |
| Provenance leak scan | whole log scanned on a real run: **clean** — no key, no full URL |

### NOT exercised — stated, not glossed

- **No live Anthropic API call was made.** The Anthropic provider was exercised against a **stub
  server** speaking the `/v1/messages` shape, plus unit-level translation tests. The wire
  translation, the normalisation, and the round-trip of a tool call through content blocks are
  verified; a real `api.anthropic.com` request with a real key is **not**.
- **"Provider B" in the manual run was a second OpenAI-compatible endpoint**, not the second
  *provider implementation*. It proved configuration-level swappability of endpoints and models. It
  did **not** prove the Anthropic path end-to-end against the live service.
- **Streaming was exercised only on the openai-compat path**, which is the only implementation that
  has `invokeStream`.

### What that omission cost — F5

Because the manual protocol was never written up, nobody walked the step "select the provider from
the product surface". Had they, they would have found that `cli/index.mjs` hardcoded
`createOpenAICompatModel`: **the entire Wave 4 provider seam and streaming were unreachable from
`orionctl`.** Both were fully tested as modules and shipped as dead code from the product's point of
view.

A second consequence surfaced at the same time: the capability sets were **inverted** —
`openai-compat` implemented `invokeStream` without advertising `streaming`, and `anthropic`
advertised `streaming` with no `invokeStream`. Capability negotiation was therefore meaningless in
both directions.

Both are fixed in Wave 4.5; see `wave4_5-ship-safety-report.md`. The structural response is
`tests/shipped/`, which asserts the wiring a developer actually runs rather than the modules it
composes.

---

## Files changed (Wave 4)

| File | Wave | Change |
|---|---|---|
| `src/agent/model/anthropic.mjs` | 4a | **new** — Messages API provider |
| `src/agent/model/errors.mjs` | 4a | **new** — `ModelError`, extracted to break a cycle |
| `src/agent/model/index.mjs` | 4a/4b | `createProvider`; provider identity; `invokeStream` |
| `src/agent/model/stream.mjs` | 4b | **new** — SSE parsing, bounded accumulator |
| `src/core/projection/artifacts.mjs` | 4a | `requestDigest`, `endpointHost`, `stableStringify`, `redactSecrets` |
| `src/core/event/index.mjs` | 4b | contract v4, `stream.*` |
| `src/agent/loop/worker.mjs` | 4a/4b | provenance; stream events; redaction at `model.failed` |
| `src/index.mjs` | 4a/4b | provider + stream + provenance exports |
| `tests/providers/`, `tests/streaming/` | | **new** — 63 + 44 assertions |

---

## STOP — Wave 4 reported. Superseded in part by Wave 4.5 (F5, capability inversion).
