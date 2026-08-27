# Real-Model Results — Phases H, I, and §11

# ⚠️ NOT RUN AGAINST A REAL MODEL — NO CREDENTIALS

**Status: the model-behaviour half of Phase H, all of Phase I, and Phase P are BLOCKED.**

Checked at the start of this phase:
```
ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY GOOGLE_API_KEY GEMINI_API_KEY
MISTRAL_API_KEY GROQ_API_KEY TOGETHER_API_KEY DEEPSEEK_API_KEY XAI_API_KEY
AWS_ACCESS_KEY_ID AZURE_OPENAI_API_KEY                              -> none set
localhost:11434 (ollama)  localhost:1234 (LM Studio)  localhost:8080 -> no server
```

No real-model numbers are estimated, simulated, or inferred anywhere in this phase.

---

## What WAS done instead, and exactly what it is worth

A **real HTTP server speaking the OpenAI chat-completions wire format** was built
(`v0/tests/_helpers/fake-provider.mjs`) and can be told to misbehave on demand. Every test below
runs over real sockets, with real JSON parsing, real timeouts and real retries.

**This tests our CLIENT and our RUNTIME. It does not test a language model.**

| what it genuinely exercises | what it cannot tell us |
|---|---|
| HTTP transport, retries, backoff, abort/timeout | whether a real model recovers from a repaired transcript |
| wire-format decode: tool calls, usage, cache tokens, cost | whether real tool-call arguments are well-formed in practice |
| malformed / truncated / empty responses | real context growth and compaction behaviour |
| 429 / 5xx / 4xx classification | real token counts, latency, or cost |
| the runtime's reaction to provider failure | whether a real model loops, and how often |

---

## §11 test suite — results against the fake provider

`v0/tests/integration/provider.test.mjs` — **53 assertions, 53 pass.**

| test | result |
|---|---|
| **1. Simple tool task** | completed; 4+ model calls, 3+ tool calls, tokens/cost/cache all recorded; correct world state |
| **2. Invalid tool arguments** | unparseable `arguments` → explicit `tool.failed`; run stays valid; no dangling in-flight calls |
| **2b. Schema validation** | wrong type + missing required both reported; nothing written to disk |
| **3. Tool failure** | failure surfaced to the model; agent adapted and recovered; transcript stayed consistent |
| **4. Authorization denial** | `tool.denied` emitted; no `tool.started`; model could not bypass the seam |
| **4b. Denial at permissive posture** | hard denies still blocked |
| **5. No-progress** | terminated `no_progress` after 4 model calls (ceiling was 30) |
| **6. Rate limit (429)** | retried; run completed; provider saw 7 HTTP calls |
| **6b. 5xx exhaustion** | `model.failed` (kind `server_error`, retryable); `degraded` emitted |
| **6c. Malformed JSON** | retried; recovered |
| **6d. Timeout** | aborted at 409 ms and retried; recovered |
| **6e. 4xx** | **not** retried; failed fast; exactly 1 HTTP call; kind `client_error` |
| **6f. Empty choices** | treated as malformed; recovered |
| **7. Context pressure** | 122 messages, hot window ≤ 40, 82 dropped and **counted**; projection plateaued at 0.954× |

### Two real client bugs found by these tests

1. **Timeouts were not classified as retryable.** `ac.abort(new Error(...))` makes `fetch` reject
   with *that* error, whose `.name` is `'Error'` — not `'AbortError'`. The transient check missed
   it, so every timeout became a hard failure. Fixed with an explicit `timedOut` flag.
2. **A permanently-unreachable model produced 40 turns of retries** and died as `max_turns`.
   The no-progress detector counted `model.responded`, which never fires when the model always
   fails. Fixed by tracking consecutive `model.failed` → new terminal reason `model_unavailable`
   (ADR-006). **This was found by driving the CLI by hand, not by a test** — worth noting, because
   no unit test would have produced it.

---

## Phase I — real crash testing with a real model: **NOT RUN**

What *was* done: the equivalent crash matrix against the scripted provider —
15 real `SIGKILL`s at 8 loop positions, zero duplicated side effects
(`crash-matrix.md`). That establishes the runtime's behaviour. It does not establish how a real
model reacts to being resumed mid-task.

**Specifically unknown:**
- whether a real model, resumed after a crash, coherently continues or restarts the task
- whether the `[N earlier messages are not shown]` notice is enough for it to stay on task
- whether repaired transcripts (synthesised `[no result recorded]` tool stubs) confuse it
- real cost of a crash: wasted tokens on the abandoned turn

## Phase P — framework comparison: **NOT RUN**

Requires the same model driving our harness, QM, Hermes, LangGraph and OpenHands. Structural
comparison only, already recorded in `research/proof/06-framework-comparison/results.md`, with
LangGraph and OpenHands explicitly marked NOT ASSESSED rather than guessed.

---

## What it would take

The `Model` interface is provider-agnostic and the client is an ordinary OpenAI-compatible
implementation. To unblock everything above:

```bash
export HARNESS_BASE_URL=https://api.openai.com/v1     # or any compatible endpoint
export HARNESS_API_KEY=sk-...
export HARNESS_MODEL=gpt-4o-mini
node src/cli/index.mjs run "…"
```

No code changes are required — the CLI already refuses cleanly when unconfigured:
```
No model configured.
  Set HARNESS_BASE_URL (an OpenAI-compatible endpoint) and HARNESS_API_KEY.
```

Estimated cost to complete Phases H (behaviour), I and P: a few hundred dollars of inference.
This is now the **single largest gap** between the current state and
`READY_FOR_DEVELOPER_VALIDATION`.
