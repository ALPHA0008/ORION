# Phase 10 — Frozen Baseline

| item | value |
|---|---|
| git revision | `c5ad46b2b647edc6586a6834824b4f83f7080833` |
| working tree | clean |
| regression | **579 passed, 0 failed across 22 suites** |
| OS / Node | Windows 11 Pro 10.0.26100 / v24.18.0 |
| Model A | `gemma4-31b`, vLLM, 31B dense, NVFP4, 32k ctx |
| Model B | `qwen3.6:35b`, Ollama, MoE 35.5B, Q4_K_M, 262k ctx |
| runner | `harness-v0` |
| task set | 22 bracketed tasks, 5 pinned repos (`is-number@98e8ff1d`, `slugify@7c318bd1`, `p-limit@df476048`, `ansi-styles@c1c3dd4e`, `camelcase@3146708d`) |

## Current completion logic

```js
if (resp.finish || !resp.tool_calls?.length) {
  return this.#stop(runId, leaseToken, 'completed', ExitReason.MODEL_FINISHED,
                    { result: resp.content ?? '' });
}
```

Three distinct states collapse into `completed`: genuinely done · prose diagnosis with unchanged
world · empty reply mid-exploration.

## Measured failure pattern carried in

| | Gemma | Qwen |
|---|---:|---:|
| `model_finished` with prose | 16 | 10 |
| `model_finished` **empty** | **0** | **12** |
| premature completion (zero mutations) | 1 | **19** |
| task success | 15/22 | 3/22 |

## §4 confirmed empirically before designing anything

Across Qwen's 19 `model_finished` runs with zero mutations, tool-call counts ranged **2 to 20**,
including 13 reads on one task.

> **"Any tool call means done" would be wrong.** Investigation and completion are not the same
> signal.

## §5 — deterministic verification exists

Real tasks verify via `test_command` — a shell command with an exit code. No LLM judge is involved
in establishing whether the objective world state holds, so a runtime contract can reuse that class
of evidence without coupling the loop to a model.

## Preserved artifacts

`gemma-model-b.json`, `qwen-model-b.json`, `diagnosis-action-*` — none overwritten.
