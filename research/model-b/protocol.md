# Experiment B — Protocol

## The rule

**Change the model. Change nothing else.**

## What was verified to be identical (§4)

| Variable | Gemma | Qwen | Same? |
|---|---|---|---|
| task set | 22 real-repository tasks | 22 real-repository tasks | ✅ |
| repository commits | 5 pinned SHAs | same 5 pinned SHAs | ✅ |
| tools | read/grep/write/edit/bash/ask_user | identical | ✅ |
| tool descriptions | from `makeTools()` | identical | ✅ |
| system prompt | `DEFAULT_SYSTEM` | identical | ✅ |
| user prompt | `task.description` | identical | ✅ |
| max turns | per-task (30–60) | identical | ✅ |
| timeout | per-task (300–600 s) | identical | ✅ |
| authorization | `permissive`, `escalateUnsafeRecovery: false` | identical | ✅ |
| sandbox | `LocalSandbox` on a fresh checkout | identical | ✅ |
| verifier | `verifyReal` + anti-gaming guards | identical | ✅ |
| runner | `harness-v0` | identical | ✅ |
| context budget | `MSG_CLAMP` 2000 / `WINDOW` 40 | identical | ✅ |
| compaction | off | off | ✅ |
| **model adapter** | Gemma shim **active** | Gemma shim **inert** | ⚠️ see below |
| **tool-call representation** | text, needs parsing | **native `tool_calls`** | ❌ **provider difference** |
| architecture / quantization / server / context window | see [`model-b-environment.md`](model-b-environment.md) | | ❌ **not equivalent** |

## No code change was required

The runner passes `shims: [applyGemmaToolCallShim]` unconditionally. That shim fires **only** on
the literal `<|tool_call>` marker, so it is a no-op for a provider that returns structured
`tool_calls`.

Verified empirically rather than assumed — the smoke test was run twice against Qwen:

| run | result |
|---|---|
| `USE_SHIM=0` | tool call parsed, `shimmed=false`, tool result consumed |
| `USE_SHIM=1` | **identical**, `shimmed=false` |

So both models execute the **same runner code on the same code path**, and only
`HARNESS_BASE_URL` / `HARNESS_MODEL` differ. Nothing was branched, tuned, or special-cased for
Qwen (§3, §23).

## Adapter attribution (§15)

Gemma requires a shim because its vLLM instance was started without
`--enable-auto-tool-choice --tool-call-parser`; it emits tool calls as raw text. Qwen's Ollama
endpoint returns structured tool calls natively.

**This is a serving-configuration difference, not evidence about model quality.** The fair
statement is:

> Under their respective provider interfaces, Qwen required no adapter intervention while Gemma
> required parsing on essentially every response.

Any Gemma failure traceable to shim parsing must be labelled **ADAPTER-SPECIFIC**, not
MODEL-SPECIFIC.

## Execution order (§24 — cost control)

1. endpoint smoke test ✅
2. 22-task Qwen baseline
3. hard-task repeats (`--repeat 3`) only if warranted
4. targeted trajectory comparison
5. escalation probe
6. edit/write and tool-choice comparison

Repeats are added only where a result is ambiguous — not five repeats of everything by default.

## Artifacts

Historical Gemma results are **not overwritten**. Model B results are written to new files:
`qwen-model-b.json`, `qwen-hard-repeat.json`, `escalation-qwen.json`.
