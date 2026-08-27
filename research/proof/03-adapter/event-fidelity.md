# Experiment 3 — Event Fidelity Ledger

**External loop under test:** Claude Agent SDK v0.3.211, using the **real type definitions** shipped
at `research/repos/qm/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — notably
`SDKResultSuccess` (`:4191-4211`), `SDKAssistantMessage` (`:2803`), `SDKAssistantMessageError`
(`:2846`), `SDKCompactBoundaryMessage` (`:2888`).

**Scale of the mismatch:** the SDK exposes **100 distinct `type:` discriminators**
(`grep -oP "type:\s*'[a-z_]+'" sdk.d.ts agentSdkTypes.d.ts | sort -u | wc -l` → 100).
Our proposed vocabulary has **31 closed types**.

---

## 1. Mapping table

| SDK message | → our event(s) | Fidelity |
|---|---|---|
| `system` / `init` | `run.created` | **partial** — session_id, cwd, tools, mcp_servers, permissionMode, slash_commands, apiKeySource, output_style, agents have no core field |
| `assistant` (text) | `model.responded.content` | full |
| `assistant` (tool_use) | `model.responded.tool_calls` | full |
| `assistant` (thinking) | — | **lost** in closed mode |
| `assistant.usage` | `model.responded` input/output tokens | **partial** — `cache_read_input_tokens`, `cache_creation_input_tokens` lost |
| `assistant.error` | `model.failed` | full (retryability inferred from the error enum) |
| `user` (text) | `turn.started` | full |
| `user` (tool_result) | `tool.succeeded` / `tool.failed` | full |
| `result` | `run.completed` / `run.failed` | **partial** — duration_ms, duration_api_ms, ttft_ms, num_turns, total_cost_usd, usage, modelUsage, stop_reason, api_error_status, structured_output all lost |
| `result.permission_denials[]` | `tool.denied` | full |
| `compact_boundary` | `context.compacted` | **partial** — `pre_tokens` lost |
| `rate_limit_event` | `degraded{subsystem:'model'}` | lossy but semantically right |
| `api_retry` | `degraded{subsystem:'model'}` | lossy but semantically right |
| `can_use_tool` | `tool.requested` | full |
| `stream_event` | — | **lost by design** (token deltas; high volume, no value in a durable log) |
| `tool_progress`, `tool_use_summary`, `task_*`, `thinking_tokens`, `status`, `session_state_changed`, `background_tasks_changed`, `files_persisted`, `commands_changed` | — | **lost** — no core equivalent |

---

## 2. Measured loss

### Closed vocabulary (core 31 types only)
```
14 SDK messages -> 13 core events
mapped:  16 field mappings
LOST:    33 distinct field kinds
```
Lost includes everything needed to answer basic operational questions:
`total_cost_usd`, `ttft_ms`, `duration_api_ms`, `usage`, `modelUsage`, `num_turns`,
`cache_read_input_tokens`, `cache_creation_input_tokens`, `thinking_blocks`, `stop_reason`,
`structured_output`, `session_id`, `parent_tool_use_id`, `uuid`, `api_error_status`.

### Extension mode (core types + `payload.ext`)
```
preserved as extension: 54 fields
still LOST:              2 kinds  ->  stream_event (token deltas), tool_progress
core event types:        UNCHANGED (test 3.2)
```

### The concrete difference
| Question | Closed | Extension |
|---|---|---|
| What did this run cost? | **no** — dropped | **yes** — `$0.0123` |
| What was TTFT? | **no** | **yes** — `410 ms` |
| Did prompt caching hit? | **no** | **yes** — `cache_read=900` |
| What did the model think? | **no** | **yes** — thinking blocks retained |
| Can I cross-reference the SDK's own session? | **no** | **yes** — uuids retained |

**Verdict: the closed vocabulary is not viable for external loops.** It preserves control flow but
destroys every economic and diagnostic signal — which are exactly the reasons an operator would
adopt a durable runtime in the first place.

---

## 3. The finding that constrains the whole "rent the loop" thesis

```
=== 6. Crash recovery on an adapted run ===
   tool.requested=1  tool.started=0  terminal=3
   projection at crash point (seq 4): pending_tool_calls = []
   FAIL  6.1 orphaned tool detectable in an adapted run
         — NO — the SDK emits no tool.started, so an in-flight tool is invisible
```

**The Claude Agent SDK never announces that a tool has begun executing.** It emits
`can_use_tool` (a permission hook, before the decision) and then, later, a `tool_result`. There is
no message between them.

Consequence: for an adapted run, the projection can never contain a `pending_tool_call`. The
Experiment 2/4 orphan-recovery machinery — which worked perfectly on our own loop
(`orphaned write (SAFE_RETRY) -> reissue`) — **has nothing to act on.**

> **Recovery granularity for a rented loop is TURN-level, not TOOL-level.**
> If an external loop dies mid-tool, we know the turn was in flight but not which tool was running,
> so we cannot decide between skip / re-issue / escalate. The only safe action is to escalate the
> whole turn or restart it.

This is not a defect in my adapter; it is a property of the external protocol. Any harness renting
this loop inherits it. QM inherits it too — which explains why QM's durability is at the *run* level
(lease + reaper + requeue the whole run) rather than the step level.

---

## 4. Closed vs extensible — the decision

The brief asks whether the vocabulary should stay `closed` or evolve to
`core events + extension events + opaque provider events`.

**Evidence says: core + extension. Not fully open.**

| Option | Verdict |
|---|---|
| **Closed (31 types)** | **Reject.** Loses cost, latency, cache, and diagnostics (33 field kinds). |
| **Core + `payload.ext`** | **Adopt.** Preserves 54/56 fields; core event *types* are unchanged, so every consumer (projection, replay, fork, explain) keeps working without knowing about extensions. |
| **Fully open (arbitrary provider event types)** | **Reject.** The projection is a `switch` over known types; unknown *types* would silently no-op, and replay fidelity would become provider-dependent. Test 1.2 confirms the value of the invariant that every emitted type is in the closed set. |

The distinction that matters: **the set of event TYPES stays closed; the payload is extensible.**
That keeps the reducer total and the projection deterministic, while preserving provider data for
observability and cost accounting.

Two things should be *promoted* from extension into core, because the experiment showed every
provider has them and they answer first-order questions:

1. `cost` and `usage` on `model.responded` / `run.completed` (tokens in/out, cache read/write, USD).
2. `latency` on `model.responded` (`ttft_ms`, `duration_ms`).

Everything else stays in `ext`.

---

## 5. Threats to validity

1. **The message stream is a faithful reconstruction from the SDK's `.d.ts`, not a live capture.**
   No model credentials were available. Field names, shapes and the type inventory are real; the
   particular sequence is authored. A live capture could surface message types I did not model.
2. **One adapter, one vendor.** The brief asked for exactly one, and I built one. Codex
   (`responses-api`) and OpenCode have different shapes; QM maintains a distinct
   `transcriptFormat` string per adapter, which suggests the divergence is real. Generalising from
   n=1 is not safe, and I have not.
3. **The 100-type count includes control-plane and UI messages** (`set_color`, `file_suggestions`,
   `reload_plugins`) that no durable log should carry. The *agent-loop-relevant* subset is perhaps
   20–25 types. The headline 100 vs 31 overstates the semantic gap; the field-level ledger in §2 is
   the honest measure.
4. **`stream_event` loss is deliberate and correct**, not a fidelity failure — durable logs should
   not carry token deltas.
