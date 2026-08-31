# Phase 9 — Frozen Baseline

| item | value |
|---|---|
| git revision | `6b48778973f7660072d03fe882deade90b433bc9` |
| working tree | clean |
| regression | **566 passed, 0 failed across 21 suites** |
| OS / Node | Windows 11 Pro 10.0.26100 / v24.18.0 |
| Model A | `gemma4-31b`, vLLM, 31B dense, NVFP4, 32k ctx |
| Model B | `qwen3.6:35b`, Ollama, MoE 35.5B, Q4_K_M, 262k ctx |

## Carried-in results

| run | success |
|---|---:|
| `gemma-model-b` (= `edit-diagnostic`) | 15/22 (68.2%) |
| `qwen-model-b` | 3/22 (13.6%) |
| read-fidelity benchmark (16 tasks measured) | 14/16, 3 improved, 0 regressed |

## The claim under investigation

Phase B concluded: *"both models can correctly diagnose and sometimes fail to convert that
diagnosis into a mutation"*, citing Qwen's 19/19 `no_edits_made` and Gemma failing at stage 5 on
3 of the 6 tasks neither solved.

**This phase tests that claim rather than assuming it.**

## Structural fact found immediately (§12)

`worker.mjs`:

```js
if (resp.finish || !resp.tool_calls?.length) {
  return this.#stop(runId, leaseToken, 'completed', ExitReason.MODEL_FINISHED,
                    { result: resp.content ?? '' });
}
```

**Any response without tool calls terminates the run as `completed`.** The loop carries no notion
of a task contract, so a prose explanation and a finished job are indistinguishable to it — and so
is an entirely empty response. This is a control-loop property, established from code before any
measurement.

## Out of scope

Runtime correctness fixes (all closed), the benchmark, the task set, model configuration.
