# Model B Environment — Qwen 3.6 35B

## Endpoint discovery

Probed ports 8000/8001/8002/8080/11434/1234/5000 across `<vllm-host>`, `localhost`, `127.0.0.1`:

| endpoint | finding |
|---|---|
| `<vllm-host>:8000/v1` | `gemma4-31b` (Model A, vLLM) |
| **`localhost:11434/v1`** | **`qwen3.6:35b` (Model B, Ollama)** |
| `localhost:8000` | OpenHands UI (not a model endpoint) |
| others | no response / 404 |

## Model B configuration

| item | value |
|---|---|
| model id | `qwen3.6:35b` |
| server | Ollama, OpenAI-compatible `/v1` |
| base URL | `http://localhost:11434/v1` |
| family | `qwen35moe` (Mixture-of-Experts) |
| parameters | 35.5B |
| quantization | **Q4_K_M** (GGUF) |
| context length | **262,144** |
| declared capabilities | `completion`, `vision`, `tools`, `thinking` |
| API key | not required |

## Model A configuration (unchanged)

| item | value |
|---|---|
| model id | `gemma4-31b` (`RedHatAI/gemma-4-31B-it-NVFP4`) |
| server | vLLM, OpenAI-compatible `/v1` |
| base URL | `http://<vllm-host>:8000/v1` |
| parameters | 31B (dense) |
| quantization | NVFP4 |
| context length | **32,768** |
| tool-call shim | `gemma-native-tool-calls` + `gemma-channel-markers`, ~100% of responses |

## Known non-equivalences — recorded, not corrected

These are properties of the available serving stacks, not choices made for this experiment. They
are stated here so no conclusion silently rests on them:

| variable | Gemma | Qwen | equivalent? |
|---|---|---|---|
| architecture | dense | **MoE** | **no** |
| parameters | 31B | 35.5B | close, not equal |
| quantization | NVFP4 | **Q4_K_M** | **no** |
| serving stack | vLLM | **Ollama** | **no** |
| context window | 32,768 | **262,144** (8×) | **no** |
| host | remote (LAN) | **local** | **no** — affects latency only |
| sampling | server defaults | server defaults | not explicitly pinned on either |

**Consequence:** latency and token-throughput comparisons between these two are not meaningful,
and any context-pressure finding is confounded by the 8× window difference. Capability and
behavioural comparisons (tool choice, escalation, edit/write behaviour) remain valid because the
harness, tasks, prompts, tools and verifiers are held identical.

## Smoke test (§2) — passed, no adapter needed

```
1. plain response      : content="OK"                       tokens in=15 out=122
2. tool call           : name=read args={"path":"src/index.js"}  shimmed=false
3. continue after tool : used_result=true
VERDICT: usable through the existing model interface
```

Qwen produced a **native structured tool call on the first attempt with no shim**, and correctly
consumed the tool result. The existing `createOpenAICompatModel` interface was sufficient
unmodified.

Note on output tokens: the plain "OK" reply consumed 122 output tokens, consistent with the
declared `thinking` capability emitting internal reasoning before the answer. Recorded because it
inflates output-token counts relative to Gemma independently of task difficulty.
