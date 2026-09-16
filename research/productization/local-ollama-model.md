# Local Ollama model — qwen3.6:35b-a3b as a real local worker

*Wave: E0-E1 infrastructure · status: VERIFIED on hardware*

Established, with evidence, that a mid-tier open model on this workstation is a usable
harness worker — the first model tier that is NOT rate-limited out of real delegating tasks.

## Decision

Primary local worker: **`qwen3.6:35b-a3b-q4_K_M`** (MoE: 35B total / ~3B active per token,
Apache 2.0, native tools + thinking). Chosen over denser options (`qwen3.8:27b-*`) because
this machine is CPU/RAM-bandwidth-bound and the harness loop is serial tool round-trips:
3B active parameters per token outruns 27B all-active on this hardware by ~2x, and the
MoE carries the strongest agentic-repo number of the pair (SWE-bench Verified ~73.4-75.0
per NVIDIA NGC).

Still to test as challenger: `qwen3.8:27b-q4_K_M` (18 GB, ~Q4) — same-disk A/B through the
E4 rig, one at a time (never both resident).

## Hardware context

- HP Z2 Tower G11, Intel Core Ultra 9 285K (24 cores), 64 GB RAM (realistic available ~35-46 GB)
- **NVIDIA RTX A1000 8 GB** (verified live; earlier "no discrete GPU" note was WRONG)
- No model of this class fits 8 GB VRAM (both candidates are ~⅓ offload) ⇒ inference is
  CPU/RAM-bound; the GPU argument does not decide this choice.
- Ollama v0.34.0 runs `qwen35moe` arch natively (no version problem).
- Models live at `D:\OllamaModels` (`OLLAMA_MODELS`); C: has ~18 GB free, D: ~258 GB.

## Install

```
ollama rm qwen3:14b qwen3:8b        # removed old models first (user request)
ollama pull qwen3.6:35b-a3b-q4_K_M  # 23 GB, ~3 min on fast link
```

## Measured performance (this hardware, Q4_K_M)

| Metric | Value |
|---|---|
| Generation | **39 tok/s** (66 eval tokens, 1.69s; prompt eval 59.7 tok/s) |
| Tool call over OpenAI-compat `/v1` | `finish_reason: tool_calls`, correct `name`+`arguments` |
| Full tool round-trip | `finish: stop`, clean text `content` |
| Cold load + first answer | 47.7 s (23 GB into RAM, one-time) |
| Warm per-turn latency in harness | ~3-4 s/turn |

## Wire-shape findings (harness-relevant)

- Even with `think=false`, the model returns a **`reasoning` field** alongside `content`.
- On tool-call turns: `content` is **empty**, `reasoning` populated, `tool_calls` populated.
- On final turns: real `content`, plus shorter `reasoning`.
- The provider (`src/agent/model/index.mjs`) already preserves `reasoning` → `ext.reasoning`;
  no shim auto-fires for this model name. **No change needed.** The empty-content tool-turn
  pattern is the known `degraded`/reasoning-shim shape — watch for it in E4 attribution, it is
  NOT a failure on this endpoint.

## Endpoint config

Ollama exposes OpenAI-compatible `http://localhost:11434/v1` — no API key required.

```
ORION_BASE_URL=http://localhost:11434/v1
ORION_MODEL=qwen3.6:35b-a3b-q4_K_M
ORION_API_KEY=ollama        # ignored by Ollama; provider wants a value
```

**Environment gotcha (this machine):** the harness sandbox shells to `bash` + `node`. Without
`C:\Program Files\nodejs` (and the Git `bin`/`usr\bin`) on PATH, `verify` fails **exit 127**
(`node` not found) — an environment problem, NOT a model/problem problem. Fix PATH in the
run wrapper.

## Shipped-path evidence

`run_ef0d26938a` — real run of the installed CLI against the local model:

```
read → edit → read → verify PASS (exit 0) → completed — model_finished
```

Clean trajectory: no `degraded`, no reasoning-only turns swallowed as failures, tool calls
streamed correctly over the `/v1` seam. First attempt (`run_e9a3bc8642`) failed only on the
PATH issue above. This is the wiring-verification the shipped suite (scripted model) cannot
provide — the reason `tests/shipped/` exists.

## What this unblocks

1. **E4 — real-project trial** on the 6 repos in `research/repos/` (qm, hermes-agent,
   ruflo, open-harness, trueforge, deepagents). No rate ceiling: real delegating tasks
   (~11k tokens) now fit trivially — the exact thing the Groq free tier (8k/min) measured-out.
2. **E3 — concurrency measurement** (2/4/8/16 parallel runs against one SQLite store).
3. Spot frontier checks remain on Groq `openai/gpt-oss-120b` keys 1-4 (+ gemini reserve) —
   the local model is for volume/measurement, not leaderboard chasing.

## Honest limits

- Mid-tier model: expected pass-rates BELOW what a frontier model would score. That is the
  trade — the number E4 produces is "harness + mid-tier local on real code", and it is better
  than "harness + nothing on real code" (the prior state: zero real-project runs, ever).
- CPU-bound: ~39 tok/s ceiling means long agentic traces are minutes, not seconds.
  Fine for E4 batch; not for interactive.