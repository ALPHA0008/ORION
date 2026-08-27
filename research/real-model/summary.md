# Real-Model Validation — Summary

**Model:** `gemma4-31b` (RedHatAI/gemma-4-31B-it-NVFP4) on vLLM 0.20.1, 32K context, served on the
local network with an OpenAI-compatible `/v1` API.
**Date:** 2026-08-27 · **Regression suite:** 310 assertions, 310 passing, 9 suites.

---

## The question this phase existed to answer

> Can a real LLM operate coherently inside this durable runtime — including tool failures, context
> pressure, authorization, provider failures, process death, and resume?

**Yes.** With five real bugs found and fixed along the way, and five honest limitations recorded.

## The milestone, end to end

```
REAL MODEL           gemma4-31b on vLLM, native tool calling
    ↓
REAL TASK            fix a real bug in a real repo; verify with a real test script
    ↓
REAL TOOL EXECUTION  read → edit → (escalate) → bash
    ↓
REAL PROCESS DEATH   parent-issued SIGKILL at 25% / 50% / 75% of the run
    ↓
NEW PROCESS          reaper reclaims; a different OS process claims the lease
    ↓
CORRECT RECOVERY     zero duplicate writes across all three kill points
    ↓
COHERENT MODEL       resumed at exactly the right next step every time
    ↓
REPLAY / FORK        replay == original byte-for-byte, 0 model calls; fork diverges
```

## Evidence by step

| step | experiment | result |
|---|---|---|
| 2 | basic task | **18/18** — bug fixed, test PASSed, escalation + human + resume |
| 3 | invalid tool calls | explicit `tool.failed`, no corruption, no retry loop, achievable part still done |
| 4 | tool failure + adaptation | **the model changed strategy and recovered** |
| 4b | permanent failure | gave up gracefully at 6 calls, `model_finished` not `max_turns` |
| 5 | authorization + bypass | **4 denials, `bash` never started, secret intact** |
| 6 | no-progress | measured; model self-corrected at the same point the detector fires |
| 7 | provider failure | 6 fault types recovered; total outage → `model_unavailable` |
| 8 | context pressure | hot state bounded at 33 KB against a 96 KB ceiling; clamping works on real data |
| 9 | **crash + resume** | **21/21 — 3 kill points, 0 duplicate effects, coherent continuation** |
| 11 | orphan recovery | reissue / skip / escalate all verified with a real model in the loop |
| 12/15 | replay vs rerun vs fork | **33/33** — invariant demonstrated under real nondeterminism |
| 13 | security | **no probe succeeded**, including prompt injection from a file |

## The coherence result, concretely

Killed at 50%, with `step1` and `step2` already on disk:

```
  23  · write {"content":"beta","path":"notes/step2.txt"}
  24  ✓ write → wrote notes/step2.txt
  27  ⚠ lease lost (lease_expired)          <<< CRASH / RESUME SEAM
  31  🧠 wants 1 tool call: write   642 tok
  34  · write {"content":"gamma","path":"notes/step3.txt"}
```

**The resumed model wrote `step3`, not `step1` again.** Prompt tokens rise monotonically across the
seam (530 → 552 → 597 → 642 → 687), so the reconstructed context genuinely carried the prior
history rather than restarting from a bare prompt.

## Five real bugs found by the real model

None of these were visible to 310 passing tests.

| # | bug | why it mattered | found by |
|---|---|---|---|
| 1 | **`claim()` excluded `'paused'`** | every escalated run was permanently unresumable; `harness resume` would fail on all of them | the first real task — the model escalated naturally |
| 2 | **client retries were invisible** | a run that limped through 4 provider failures looked identical to a clean one | fault injection in front of the real endpoint |
| 3 | **provider shims were invisible** | a rewritten model response left no trace in the log | same |
| 4 | **`restore()` crashed on an empty checkpoint** and left post-checkpoint files behind | fork-with-rewind was broken and silently produced a superset of the intended tree | forking a real run to a point before any file existed |
| 5 | **mid-turn fork is semantically ambiguous** | the model read `[no result recorded]` as "already done" and skipped real work | forking a real run mid-turn |

Bug 1 is worth dwelling on: an earlier test helper contained `const target = claimed ?? runId`,
a fallback that used the run id even when the claim returned `null`. **The helper masked the bug and
the assertion passed for the wrong reason.**

## Two provider quirks, both handled in a named shim

Never in the core (`src/agent/model/shims/gemma-tool-calls.mjs`):

- **vLLM did not parse tool calls.** Started without `--enable-auto-tool-choice --tool-call-parser`,
  so the model's tool calls arrived as raw text with `tool_calls: []`. An unmodified
  OpenAI-compatible client sees "no tool calls, finish_reason=stop" and **terminates the run on
  turn one.** This is the single most consequential integration finding of the phase.
- **Reasoning-channel markers leaked** (`<|channel>thought<channel|>`) into stored results, into
  `explain`, and back into the next prompt as if the assistant had said them.

Both are now recorded as `degraded{subsystem:'model_adapter'}` whenever they fire.

## Metrics

| workload | events | model calls | tool calls | in tok | out tok | degraded | wall |
|---|---:|---:|---:|---:|---:|---:|---:|
| 01 basic bug-fix | 32 | 4 | 3 | 2,245 | 154 | 0 | 3.8s |
| 02 invalid tools | 28 | 4 | 3 | 2,425 | 137 | 0 | 3.0s |
| 03a tool failure + adapt | 28 | 4 | 3 | 2,114 | 105 | 0 | 2.7s |
| 03b permanent failure | 42 | 6 | 5 | 3,369 | 229 | 0 | 6.3s |
| 04 authorization | 36 | 6 | 2 | 3,403 | 185 | 0 | 3.9s |
| 05 no-progress | 22 | 4 | 0 | 2,248 | 137 | 0 | 2.9s |
| 07 context pressure | 136 | 17 | 16 | 30,252 | 344 | 17 | — |
| 09 crash 25% | 46 | 7 | 5 | 3,724 | 145 | 0 | — |
| 09 crash 50% | 46 | 7 | 5 | 3,724 | 145 | 0 | — |
| 09 crash 75% | 46 | 7 | 5 | 3,724 | 145 | 0 | — |
| **TOTAL** | **462** | **66** | **47** | **57,228** | **1,726** | **17** | |

**Cost per successful task is not reported.** This is a self-hosted endpoint with no per-token
price; any figure would be invented. The token and latency baselines above are the durable part of
that measurement, and the runtime records `cost_usd` per response whenever pricing is configured.

## Architecture: what held, what changed

**Held unchanged** — event log as source of truth; bounded projection; per-invocation recovery;
`verify()`; closed event types with extensible payloads; recovery granularity; leases/reaper;
execution fencing; the authorization seam.

**Changed, each forced by evidence:**

| change | recorded in |
|---|---|
| `'paused'` is claimable (targeted always; queue scan only once answered) | **ADR-009** |
| client retries and shim usage emit `degraded` | **ADR-010** |
| `fork()` detects and reports mid-turn forks; `nearestTurnBoundary()` added | `time-travel.md` |
| `restore()` handles empty trees and prunes post-checkpoint files | `time-travel.md` |

**Not changed, deliberately: the no-progress thresholds.** The measured evidence
(`test-05-no-progress.md`) shows the detector firing at the same point the model self-corrects.
Retuning on one model's behaviour would be guessing dressed up as tuning. Recorded as an open
question, not silently declared settled.

**Nothing was added** from the forbidden list: no semantic memory, skills, MCP, swarms, RL, learned
routing, consensus, or multi-provider infrastructure. The core grew by roughly 60 lines, all of it
observability and guard-rails.

## Honest limitations

1. **One model, one provider.** Its refusal behaviour on the security probes is partly its own
   alignment, not solely the runtime's doing — though even full compliance would have been blocked
   by the seam and the sandbox independently.
2. **The window never overflowed with a real model.** 34 messages, 0 dropped. Clamping was
   exercised; *elision* was not. How a real model behaves once earlier turns fall out of the hot
   window is the largest untested context question.
3. **No natural orphan occurred.** Every random kill landed on `model.requested`, because the model
   call dominates wall time. The reissue/skip/escalate branches were verified with **induced**
   orphans on the real resume path.
4. **`write` is `SAFE_RETRY`.** A duplicate would have been harmless. A genuinely dangerous
   duplicate (append, POST) was never produced by the real model.
5. **Simple tasks.** 3–6 tool calls each. A multi-hour task with mid-task discoveries would test
   resume coherence far harder than anything run here.
