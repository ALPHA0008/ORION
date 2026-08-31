# Qwen Integration (§3)

## No adapter required

The smoke test (§2) confirmed Qwen works through the **existing** `createOpenAICompatModel`
interface with no modification:

```
1. plain response      : content="OK"                            tokens in=15 out=122
2. tool call           : name=read args={"path":"src/index.js"}  shimmed=false
3. continue after tool : used_result=true
VERDICT: usable through the existing model interface
```

Qwen emits **native structured `tool_calls`** on the first attempt, with correctly-typed
arguments, and consumes tool results.

## The Gemma shim is provably inert for Qwen

The runner passes `shims: [applyGemmaToolCallShim]` unconditionally. Rather than branch the
runner (which would have broken the "change only the model" rule), the shim was verified to be a
no-op for Qwen — it fires only on the literal `<|tool_call>` marker.

Run twice against Qwen:

| configuration | result |
|---|---|
| `USE_SHIM=0` | tool call parsed, `shimmed=false`, result consumed |
| `USE_SHIM=1` | **identical output**, `shimmed=false` |

**Consequence: zero code changes were needed.** Both models execute the same runner on the same
code path; only `HARNESS_BASE_URL` and `HARNESS_MODEL` differ. The architecture already had the
right seam:

```
Gemma → (Gemma shim fires)  ┐
                            ├→ COMMON MODEL INTERFACE → SAME HARNESS
Qwen  → (shim inert)        ┘
```

## Adapter attribution (§15)

| | Gemma | Qwen |
|---|---:|---:|
| `degraded` events over 22 tasks | **343** | **0** |
| shim activation rate | ~100% of responses | 0% |

Every Gemma response required parsing; no Qwen response did.

**This is a serving-configuration difference, not a model-quality verdict.** Gemma's vLLM instance
was started without `--enable-auto-tool-choice --tool-call-parser`, so it returns tool calls as
raw text. A differently-configured vLLM would very likely emit native calls too.

The fair statement, per §15:

> Under their respective provider interfaces, Qwen required no adapter intervention while Gemma
> required parsing on essentially every response.

Any Gemma failure traceable to shim parsing is **ADAPTER-SPECIFIC**. Notably, none of the failures
analysed in this experiment were: the shim parsed successfully in all 343 cases, and Gemma's
edit failures were traced in phase 3 to our own `read` rendering, not to the shim.

## Observation worth recording: `thinking` output

Qwen declares a `thinking` capability. Its reply to "Reply with exactly: OK" consumed **122 output
tokens** for a 2-character answer. This inflates output-token counts independently of task
difficulty, so per-token comparisons between the models are not like-for-like.
