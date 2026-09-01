# Model Comparison — NOT PERFORMED

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

**No Gemma-vs-Qwen capability comparison exists, and none may be computed from Stage 1.**

Both arms ran the identical frozen corpus (`CAPABILITY_V1_STAGE1`, sha256 `0a9a279d…`) at runtime
`6e4d532`, with the model endpoint as the only intentional variable. But only one arm produced a
valid capability measurement.

| | Gemma 4 31B | Qwen 3.6 35B |
|---|---|---|
| status | **VALID CAPABILITY BASELINE** | **INVALID FOR CAPABILITY ATTRIBUTION** |
| classification | — | `QWEN_INTERACTION_MECHANISM_CONFIRMED` |
| tasks attempted | 17 | 17 |
| tasks passed | 3 | 0 |
| what the number means | 3 of 17 Stage-1 instances under this configuration, n=1 | **nothing about capability** |
| use in this stage | the sole capability arm | model/serving-interaction evidence only |

## Why no ratio is computed

Qwen's 0/17 records a **deterministic model/serving/harness interaction failure** — an empty or
truncated terminal completion, reproduced deterministically under the corrected replay protocol,
including from minimal state with 0 bytes of tool feedback. It does not record what Qwen can do.

Dividing 3/17 by 0/17 — or presenting them side by side as capability — would convert an
infrastructure finding into a false capability ranking. That is the specific error §17 forbids.

## Deployment asymmetry (descriptive only)

Recorded because it is real, **not** used to explain any result:

| | Gemma | Qwen |
|---|---|---|
| serving | vLLM · `172.20.7.22:8000` | Ollama · `localhost:11434` |
| context window | 32 768 | 262 144 |
| tool-call representation | none native — reconstructed by `applyGemmaToolCallShim` | native `tool_calls` |
| warm latency (trivial call) | ~56 ms | ~2 560 ms |
| adapter | shim required on **every** response (degraded event per call) | shim inert |

These stacks are not equivalent and this document does not pretend otherwise. Note that Gemma —
the arm with **8× less context** and a shim on every single response — is the one that produced
valid measurements.

## What Stage 1 therefore cannot do

The sharpest instrument this project has for separating a **MODEL** failure from a **HARNESS**
failure is divergence between two models on the same task; phases 9 and 10 both turned on it.

With one valid arm, every mechanism in `failure-taxonomy.md` is single-model:

> A mechanism observed only in Gemma may be a property of Gemma, of the shim, or of the harness.
> **This baseline cannot tell those apart.**

One partial substitute is available and was used: Qwen's confirmed empty-completion phenomenon does
**not** appear in Gemma. Checked directly — Gemma has **0 true empty completions** across all 17
runs (empty *content* accompanying a tool call is the normal shape of a tool-calling turn and was
initially miscounted as 6 before being corrected). That asymmetry is evidence the Qwen phenomenon is
model/serving-specific rather than a harness defect, which is a genuine finding — but it constrains
only that one mechanism, not the rest of the distribution.
