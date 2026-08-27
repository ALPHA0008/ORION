# Phase 2/3 — Hermes Agent: Claimed vs Observed Architecture

Repo `hermes-agent` @ `d62a05e94c7478cc8043465b4345ff69f8fcb97f` (main, 2026-08-26)
Recorded 2026-08-26T11:40–12:35Z.

**Note on repo content:** `AGENTS.md` (95 KB), `CONTRIBUTING.md` (48 KB), `skills/`,
`optional-skills/`, `plugins/*/SKILL.md` and `cli-config.yaml.example` (104 KB) contain
natural-language instructions addressed to an LLM. Read as audit artifacts only; none followed.

---

## 1. Composition

| Metric | Value |
|---|---|
| Total files | 10,323 |
| Code LOC | 2,517,451 |
| Python | 1,850,331 LOC / 4,615 files |
| TypeScript + TSX | 596,908 LOC / 2,574 files (desktop app, web, TUI) |
| Markdown | 472,065 LOC / 1,546 files |
| DOC:CODE ratio | 0.19 : 1 |
| Python test files | **3,311** (`tests/**/test_*.py`) |
| Python test functions | **~33,752** |
| Test framework | pytest 9.1.1 + pytest-asyncio 1.3.0 (`pyproject.toml:465-466`) |

This is by far the largest codebase of the three, and the only one where the *primary* language
is Python.

---

## 2. Entry points (`pyproject.toml:377-380`)

```
hermes       = "hermes_cli.main:main"
hermes-agent = "run_agent:main"
hermes-acp   = "acp_adapter.entry:main"
```

| Entry | Path | Notes |
|---|---|---|
| CLI dispatcher | `hermes_cli/main.py` | subcommands: gateway, cron, doctor, memory… |
| Interactive REPL/TUI | `cli.py:21045` (`main`) | **21,665 lines / 1.0 MB single file** |
| Headless runner | `run_agent.py:8999` | 9,215 lines; `class AIAgent` at `:421` |
| ACP server | `acp_adapter/entry.py` | Agent Client Protocol |
| MCP server | `mcp_serve.py`, `agent/transports/hermes_tools_mcp_server.py` | |
| Gateway daemon | `gateway/run.py` | 63 modules / **67,894 LOC** |

---

## FINDING HERMES-LOOP-001 — The agent loop is real, and it is a ~6,550-line `while` body
**Status: VERIFIED** · Confidence: high

**Location:** `agent/conversation_loop.py:1822` (`run_conversation`), loop at **`:2017` → `:8573`**.

```python
# agent/conversation_loop.py:2017-2029
while (api_call_count < agent.max_iterations and agent.iteration_budget.remaining > 0) or agent._budget_grace_call:
    _redirect_text = agent._drain_pending_redirect()
    if _redirect_text:
        _apply_active_turn_redirect(agent, messages, _redirect_text)
        agent._persist_session(messages, conversation_history)
    agent._checkpoint_mgr.new_turn()
    if agent._interrupt_requested:
        interrupted = True
        _turn_exit_reason = "interrupted_by_user"
        break
```

Loop phase map:

| Phase | Location |
|---|---|
| Turn prologue (system prompt, compression preflight, memory prefetch) | `build_turn_context()` @ `:1899` → `agent/turn_context.py` |
| Budget consume / grace call | `:2054-2067` |
| Context build, tool-call arg repair, canonicalization | `:2167-2504` |
| **Model call** | `_perform_api_call` @ **`:3174-3223`** |
| Inner retry loop | `:2888` (`while retry_count < max_retries`) |
| Parse + validate tool calls (invalid names, dedupe, delegate cap) | `:7031-7440` |
| **Tool execution** | **`:7448`** → `agent._execute_tool_calls(...)` |
| Guardrail halt check | `:7459-7470` |
| Dropped-tool-call recovery | `:8151-8168` |
| Orphan repair (synthesizes `role:"tool"` stubs for unanswered ids) | `:8511-8532` |
| Finalize | `finalize_turn()` @ `:8578` → `agent/turn_finalizer.py` |

**Answers to the Phase-3 control-loop questions:**
- *Where does the loop live?* `agent/conversation_loop.py`, one function.
- *Who owns state?* **The `agent` object, by mutation.** `run_conversation` reads/writes 50+
  private attributes (`agent._budget_grace_call`, `_interrupt_requested`,
  `_tool_guardrail_halt_decision`, `_incremental_persistence_failed`, `_checkpoint_mgr`…).
  This is a god-object, not a state machine.
- *Can it pause?* Yes — `_interrupt_requested` breaks the loop cleanly.
- *Termination?* Iteration cap + token budget + `finish_reason` + explicit break paths.
- *Second loop:* `agent/moa_loop.py` (2,453 L) — a Mixture-of-Agents variant gated by `moa_config`.

**Observation on quality:** the loop contains a remarkable amount of defensive code against
*provider misbehaviour*, with issue numbers inline — GitHub Copilot stale credentials (`:489`),
`finish_reason=="tool_calls"` with an empty array (`:8151-8168`), Ollama context limits (`:548`),
image max-dimension errors (`:519`). This is battle damage, and it is **the most valuable thing in
the repository** for anyone building a harness: a catalogue of real-world provider failures.

An extraction refactor is in progress — comments at `:1891-1898` and `:8575-8578` document the
prologue/epilogue moving to `turn_context.py`/`turn_finalizer.py` "mutating `agent` exactly as the
inline code did." The loop body itself has not been decomposed. This partly explains the 4:1
fix:feat ratio from GIT-008.

---

## FINDING HERMES-LEARN-002 — The learning loop is genuine, but improvement is never measured
**Status: PARTIAL** · Confidence: high — **this is the key Hermes finding**

The brief asks whether Hermes does:
```
experience → reflection → skill creation/update → future use → measurable improvement
```
or merely:
```
experience → write file → load file later
```

**Answer: it does the first four steps genuinely. It does not do the fifth.**

### (a) Reflection is a real forked agent, not a template
`agent/background_review.py` (82,557 bytes) — module docstring `:1-16`:
> "Background memory/skill review — fork the agent to evaluate the turn. After every turn,
> `AIAgent.run_conversation` may call `spawn_background_review` to fire off a daemon thread that
> replays the conversation snapshot in a forked `AIAgent` and asks itself *"should any skill/memory
> be saved or updated?"*. Writes go straight to the memory + skill stores. Main conversation and
> prompt cache are never touched. … It runs with a tool whitelist limited to memory and skill
> management tools; everything else is denied at runtime."

This is a **second LLM agent reviewing the transcript**, not string interpolation into a template.

### (b) It fires automatically at end of turn
`agent/turn_finalizer.py:795-810`:
```python
# Background memory/skill review — runs AFTER the response is delivered
# so it never competes with the user's task for model attention.
if (
    final_response
    and not interrupted
    and not getattr(agent, "skip_background_review", False)
    and (_should_review_memory or _should_review_skills)
):
    try:
        agent._spawn_background_review(
            messages_snapshot=list(messages),
            review_memory=_should_review_memory,
            review_skills=_should_review_skills,
        )
    except Exception:
        pass  # Background review is best-effort
```
No user command required. Three good engineering decisions visible here: it runs *after* delivery,
it is *best-effort* (a failure cannot break the user's turn), and it is *suppressed for cron*
(`:797-799`) where there is no human to benefit.

### (c) Cost is honestly disclosed in-code
`agent/agent_init.py:697` and `turn_finalizer.py:798-799` both state the fork costs
**~30K tokens per event**. A project willing to write its own overhead into a comment is being
straight with its maintainers.

### (d) Writes are real, atomic, and guarded
`tools/skill_manager_tool.py` genuinely creates and edits `SKILL.md` files:
- create `:972-977` — `atomic_write_text(skill_md, content, preserve_mode=True, create_mode=0o644)`
- edit `:1061-1076` — provenance check `:1063`, write `:1070`, **rollback to `original_content` `:1076`**
- patch (search/replace) `:1143-1209` — write `:1199`, rollback `:1204`
- add support file `:1375-1384`
Guarded by `tools/skill_provenance.py`, `tools/skills_guard.py`, `tools/skill_linter.py`,
`tools/skills_ast_audit.py`. Skills land at `<HERMES_HOME>/skills/<name>/SKILL.md`.
The review prompt (`background_review.py:454+`) explicitly steers toward *class-level* skills with
rich content rather than "a long flat list of narrow one-session-one-skill entries" — i.e. someone
thought about skill-library degeneration.

### (e) Where it stops: no effectiveness measurement
`tools/skill_usage.py` tracks **activity counts and timestamps only** —
`latest_activity_at` (`:146`), `activity_count` (`:166`), used to *prune unused* skills
(`_prune_builtins_enabled` `:250`, `list_archived_skill_names` `:393`).
There is **no success-rate, no task-outcome delta, no A/B of with-skill vs without-skill.**
`evals/` contains only `browser_use`, `compaction`, `readtool` — none measures skill effectiveness.

**Interpretation.** Hermes implements the strongest self-improvement loop of the three by a wide
margin: a genuine reflection agent with restricted authority, automatic invocation, atomic guarded
writes, and provenance. What it cannot tell you is whether any of it *works* — the system has no
way to know if a written skill made subsequent tasks better, and prunes on *use* rather than
*value*. That is the honest boundary of the claim: **closed loop, unmeasured outcome.**

---

## FINDING HERMES-TERM-003 — "Terminal backends" are execution environments; 9 real, no multiplexers
**Status: PARTIAL / claim mis-scoped** · Confidence: high

`tools/environments/` — 8,785 LOC. Factory `_create_environment` at
**`tools/terminal_tool.py:1944`**, selected by the `TERMINAL_ENV` env var (`:842`, `:1388`, `:1761`;
valid-options error listing at `:4029`).

| File | Lines | Verdict |
|---|---|---|
| `base.py` | 1,533 | **Real** — substrate. Bounded output collector `:82`, `ProcessHandle` `:470`, process-group kill on timeout `:1311-1320` |
| `local.py` | 2,060 | **Real** — subprocess, Windows path translation, signal handling |
| `docker.py` | 2,084 | **Real** — container lifecycle, orphan reaper, session-scoped isolation |
| `vercel_sandbox.py` | 662 | **Real** — SDK, cached config, TTLs |
| `modal.py` | 478 | **Real** — Modal SDK, tar file transfer, async bridge |
| `ssh.py` | 435 | **Real** — subprocess-over-ssh + file_sync |
| `managed_modal.py` | 282 | Thin — subclass routing via Nous' managed gateway |
| `singularity.py` | 273 | **Thinnest genuine** — ~110 lines of actual backend |
| `daytona.py` | 270 | Thin — SDK wrapper, `ImportError` at `:60` if SDK absent |
| `file_sync.py` / `modal_utils.py` | 484 / 210 | Shared helpers |

**Claim correction:** these are **sandbox/execution backends, not terminal multiplexers**.
A repo-wide search found **no tmux, no screen, no pty backend**. If marketing says "terminal
backends" meaning tmux-style multiplexing, that is REFUTED; if it means "places a shell command can
execute", it is VERIFIED at 8–9 backends. None is a bare stub, but `daytona` and `managed_modal`
are thin wrappers.

---

## FINDING HERMES-MODEL-004 — Genuine three-tier model abstraction, 37 providers
**Status: VERIFIED** · Confidence: high

Not hardcoded to one SDK. Three layers:

1. **Transports** (`agent/transports/`, 5,009 L) — base protocol `base.py:1-89`;
   `chat_completions.py` (1,042, the default OpenAI-compatible path), `anthropic.py` (251),
   `bedrock.py` (154), `codex.py` (918) + `codex_app_server*.py` (1,710).
2. **Adapters** (message/schema translation, 8,642 L) — `anthropic_adapter.py` (3,284),
   `bedrock_adapter.py` (1,780), `codex_responses_adapter.py` (1,755),
   `gemini_native_adapter.py` (1,252), `azure_identity_adapter.py` (571), plus quirk shims
   (`moonshot_schema.py`, `lmstudio_reasoning.py`).
3. **Provider profiles** (`providers/`) — `ProviderProfile` ABC at `providers/base.py:39` with
   hooks `resolve_aux_model` `:104`, `prepare_messages` `:133`, `build_extra_body` `:141`,
   `get_max_tokens` `:183`, `fetch_models` `:197`. Registered via `register_provider()`
   (`providers/__init__.py:56`).

**37 provider plugin packages** under `plugins/model-providers/` (anthropic, bedrock, gemini,
openai-codex, openrouter, ollama-cloud, vertex, xai, nous, deepseek, qwen-oauth, …).

Runtime switch is `api_mode` (`conversation_loop.py:3175`, `:3195`). Honest characterisation: the
OpenAI-compatible chat-completions path is clearly primary, with other shapes translated into and
out of it — but the abstraction is real and the adapter bulk (3,284 lines for Anthropic alone)
proves these are not stubs.

---

## FINDING HERMES-TOOLS-005 — 86 tools, AST-based discovery, override protection
**Status: VERIFIED** · Confidence: high

`tools/registry.py` (1,335 L). `ToolRegistry` `:452`; `register()` `:763`; **`dispatch()` `:1128`**;
`get_definitions()` `:1044` (builds the schema list sent to the model).

**96 `registry.register(...)` call sites → 86 distinct tool names.**

Two design details worth stealing:
- **AST-based auto-discovery** (`:111` `discover_builtin_tools`, `:74`, `:87`) — parses each
  module's AST looking for `registry.register(...)` rather than importing it. Avoids import side
  effects and startup cost; disk-cached (`:165-190`).
- **Plugin override policy** (`_PluginOverridePolicy` `:236`, `_plugin_override_allowed` `:645`,
  `_plugin_owner_of` `:655`) — prevents a pip-installed package from hijacking a first-party tool.
  A real supply-chain consideration most projects miss.

**Execution** — `agent/tool_executor.py` (2,922 L), three strategies: concurrent (`:1092`,
ThreadPool), sequential (`:813`), segmented. Notable: `_ConcurrentToolAuthorizationGate` (`:441`)
serialises human approval prompts across parallel tools — an easy thing to get wrong.
Timeout/cancellation via `_ToolTimeoutResult` `:427`, `_ToolCancelledResult` `:431`.

---

## FINDING HERMES-STATE-006 — SQLite session store + separate git-based checkpoints
**Status: VERIFIED** · Confidence: high

**Session state:** `hermes_state.py` (667 KB / 14,677 L) + `hermes_state_schema.py` (74 KB) +
`hermes_state_common.py` (36 KB, `SCHEMA_VERSION = 26` at `:329`, `SCHEMA_SQL` at `:359`) +
`hermes_state_search.py` (115 KB, FTS5) + `hermes_state_portability.py` (37 KB, export/import).

Tables (`hermes_state_common.py:359-511`): `schema_version`, `system_prompts`, `sessions`,
`messages`, `session_model_usage`, `state_meta`, `gateway_routing`, `gateway_hygiene_state`,
`compression_locks`, `session_turn_leases`, `async_delegations`.

Migration engine uses the Beets/sqlite-utils pattern: `SCHEMA_SQL` is the sole source of truth,
live tables are diffed (`_parse_schema_columns` `:589`, `_reconcile_columns` `:679`) and
`ALTER TABLE ADD COLUMN`-ed. Sound and well-understood.

**Checkpoints are separate and git-based** — `tools/checkpoint_manager.py` (2,236 L),
`class CheckpointManager` `:755`. Not SQLite: a **bare shadow git repo per project**, keyed by a
hash of the working dir (`_project_hash` `:205`, `_shadow_repo_path` `:216`, `_init_shadow_repo`
`:728`), with a JSON ledger alongside. Per-turn dedup via `new_turn()` `:795` (called once per
loop iteration at `conversation_loop.py:2029`); writes recorded via `record_agent_write()` `:803`
from `tool_executor.py:82`.

**This is a genuinely good idea worth stealing:** using git as the file-state checkpoint store
gives you diffing, history, and rollback for free, without inventing a snapshot format, and
keeps file history out of the session DB.

---

## FINDING HERMES-SUB-007 — Subagents with git-worktree isolation and durable async queue
**Status: VERIFIED** · Confidence: high

7,621 LOC: `tools/delegate_tool.py` (4,963), `tools/async_delegation.py` (1,603),
`agent/subagent_lifecycle.py` (542), `tools/subagent_worktree.py` (352),
`agent/delegation_context.py` (161).

- **Isolation is real:** `subagent_worktree.py` gives each subagent a **git worktree**, so parallel
  subagents editing files do not collide.
- **Durability is real:** async delegations persist to the `async_delegations` SQLite table
  (`hermes_state_common.py:511`) — they survive process restart, unlike in-memory task handles.
- Subagent identity flows into the model call: `getattr(agent, "is_subagent", False)` →
  `call_role: "delegated"` (`conversation_loop.py:3199`).
- Per-turn cap on delegate calls (`conversation_loop.py:7245`) — prevents fork bombs.

---

## FINDING HERMES-HONCHO-008 — Honcho is a real, first-class user-modeling integration
**Status: VERIFIED** · Confidence: high

`plugins/memory/honcho/` — **8,494 LOC across 7 modules**, the largest single plugin:
`__init__.py` (1,712, the `MemoryProvider` impl), `cli.py` (1,976), `session.py` (1,819),
`client.py` (1,367), `oauth_flow.py` (656), `oauth.py` (640), `config_schema.py` (324).

Exposes five tools (profile, search, reasoning, context, conclude). Config resolution:
`$HERMES_HOME/honcho.json` → `~/.honcho/config.json` → env.

**One detail worth highlighting as good design:** `__init__.py:33-45` defines
`_INTERNAL_GATEWAY_TURN_RE` to filter *gateway-internal synthetic turns*
(`[ASYNC DELEGATION COMPLETE]`, `[CONTEXT COMPACTION]`) so machine-generated text never
contaminates durable *personal* memory. Most systems would let that pollute the user model.

**Without the integration:** Honcho is one of 8 memory backends (`honcho/`, `hindsight/`,
`holographic/`, `mem0/`, `byterover/`, `openviking/`, `retaindb/`, `supermemory/`) behind the
`agent/memory_provider.py` ABC (416 L). The system degrades to the builtin provider; it is not
load-bearing. `agent/memory_provider.py:76` notes the classifier is deliberately shared with the
honcho plugin "so the two can never drift apart" — good instinct.

---

## 3. OBSERVED vs CLAIMED

**Claimed:** an agent with a closed learning loop, many terminal backends, cross-session memory,
subagent isolation, and Honcho user modeling.

**Observed:** all five exist as real code. Two need re-scoping (terminal backends = sandboxes not
multiplexers; learning loop = closed but unmeasured). Nothing in the Hermes claim set was found to
be fabricated — a materially different outcome from Ruflo.

### The dominant engineering risk is file size, not honesty
`cli.py` 21,665 L · `hermes_state.py` 14,677 L · `run_agent.py` 9,215 L ·
`conversation_loop.py` 8,598 L with a **~6,550-line `while` body**.
State passed by mutating a god-object across 50+ private attributes. This is the plausible
mechanism behind the 13,220 `fix:` commits (GIT-008): change velocity is high and the blast radius
of any change inside that loop is enormous. **Resolution of GIT-008: leaning (b) — fast iteration
in the open — but the file sizes make (a) partly self-inflicted.**

---

## 4. What was NOT inspected
- The 3,311 Python test files were **not executed** (no model credentials; deferred to hands-on).
- `cli.py` (1.0 MB) read only in targeted sections.
- `gateway/` (67,894 LOC) mapped structurally, not read in depth.
- The desktop Electron app (`apps/desktop/`) and web UI — out of scope for harness architecture.
- `moa_loop.py` (Mixture-of-Agents) — identified, not analysed.
