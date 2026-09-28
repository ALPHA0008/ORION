# Current Product Surface — Evidence-Based Audit

**Rebaselined 2026-09-08 (Wave 5, defect D3).** The previous edition of this file was written
during the Wave-1 audit and was never updated. By the time W5 read it, every headline number was
wrong — 608 tests (actually 1,001), a 31-type event contract (actually 39, at v4), 6 tools
(actually 9), and "**No `package.json` anywhere in the repository**" for a package that has been
publishable since Wave 4. Two `grep` defects it reported as open had been fixed two waves earlier.

That is the defect W5 D3 records: a document asserting measured facts, with no mechanism to notice
when it stopped being true. Where a claim here can be checked mechanically it now is —
`tests/shipped` asserts the tool count and names against the shipped toolset (W5 D1/D2), so those
two lines cannot rot silently again. The rest of this file is dated evidence, not a live view.

Read from source, not from README claims. Every status below is backed by a file, a test suite, or
an executed command.

**Scale (at the time of this audit):** `v0/src` was **5,308 lines across 22 `.mjs` files**, with
**31 test files / 1,001 passing tests across 31 suites** (executed during this audit:
`1001 passed, 0 failed`).

**Scale as of Wave 10:** **11,289 lines across 44 `.mjs` files**, **49 suites / 2,253 passing**
(`2253 passed, 0 failed`). Rows below are updated per wave; the prose framing is the original audit.

**Dependencies: zero REQUIRED, one optional (since W9).** Every import in the runtime path is a
`node:` builtin or a relative path, and `package.json` still declares no `dependencies`. W9 added
`@modelcontextprotocol/sdk` to **`optionalDependencies`** at an exact pin — the plan's "first
justified dependency" — imported lazily at connect time. A tree without it is a working tree
without MCP, not a broken one.

**Package:** `@kernlbase/orion` **0.2.0**, `bin: { orionctl }`. Publishing is a separate decision
and is NOT part of Wave 5.

## Capability map

| Capability | Status | Evidence |
|---|---|---|
| **CLI** | **IMPLEMENTED** | `src/cli/index.mjs` (607 ln), 12 commands; `--help` and `doctor` executed in this audit |
| **Provider layer / model adapter** | **IMPLEMENTED** | `src/agent/model/index.mjs` — `createProvider({kind})`; `openai-compat` and `anthropic` (Wave 4a) |
| **Provider shim isolation** | **IMPLEMENTED** | `src/agent/model/shims/gemma-tool-calls.mjs`; applied AFTER normalisation; conditional and inert for native-tool-call models |
| **Streaming** | **IMPLEMENTED** | `stream.started` / `stream.delta` / `stream.finished` (contract v4, Wave 4b); bounded cadence, opt-in |
| **Tool registry** | **IMPLEMENTED** | `src/agent/tools/index.mjs` (549 ln) — `makeTools`, `toolDefinitions`, `validateArgs`, `mutatingTools`, `pathAddressedTools`; **9 tools** (asserted by `tests/shipped`) |
| **Worker / run loop** | **IMPLEMENTED** | `src/agent/loop/worker.mjs` (864 ln) — `Worker`, `ExitReason`; lease heartbeat on both the model and tool paths (W5 X2) |
| **Event store** | **IMPLEMENTED** | `src/core/run/store.mjs` (480 ln) — `Store`, `LeaseLostError`, `uid`; `node:sqlite`; `SCHEMA_VERSION` + forward-only migration (W5 P1) |
| **Event contract** | **IMPLEMENTED** | `src/core/event/index.mjs` — **frozen 39-type closed set at v4**, `isKnownType`, `TERMINAL`; additive-only |
| **Store boundary** | **IMPLEMENTED** | `Store.append` is the only mutation path; zero raw SQL or direct event inserts outside `store.mjs` (W5 S1/S2, grep-asserted) |
| **Sandbox** | **IMPLEMENTED** | `src/sandbox/local/index.mjs` (289 ln) — `LocalSandbox`, output caps, `scrubEnv`; `exec` is async (W5 X1) |
| **Authorization / policy** | **IMPLEMENTED** | `src/auth/default/index.mjs` (132 ln) — `createAuthorizer`, `Decision`, postures `permissive` / `auto` / `strict`; `denyCommandPatterns` reach every command-bearing tool (Wave 4.5 F1) |
| **Recovery** | **IMPLEMENTED** | `src/core/recovery/index.mjs` — 6 `RecoveryClass` values, `decideRecovery`, `classifyShell`, `isKnownDangerous` (public since W5 T3) |
| **Cancellation** | **IMPLEMENTED** | `AbortSignal` on `Worker.run`; parks as `run.parked` / `cancelled` at effect-free checkpoints, no orphan effect (W5 X5) |
| **Resume** | **IMPLEMENTED** | CLI `resume`; `#reconcile`; crash-matrix suite |
| **Replay** | **IMPLEMENTED** | `src/core/replay/index.mjs` — `replay`, `verifyProjectionEquivalence`; reconstructs a run at zero model cost |
| **Fork** | **IMPLEMENTED** | `fork`, `nearestTurnBoundary`, `rerun`; `v0/docs/FORKING.md` |
| **Explain** | **IMPLEMENTED** | `src/core/run/explain.mjs` — `explain`, `summarise`, `redact` |
| **Context projection** | **IMPLEMENTED** | `src/core/projection/index.mjs` — ADR-001 bounded window; `runSummary` is the public read-only view (W5 E2) |
| **Context compaction** | **IMPLEMENTED** | `src/core/projection/compact.mjs` — **ON by default and budget-aware since Wave 3** (was opt-in when this file was first written) |
| **Plans** | **IMPLEMENTED** | `plan.*` events (contract v2, Wave 2); a plan is a fold over the log, never stored state |
| **Artifacts** | **IMPLEMENTED** | `artifact.created` (contract v3, Wave 3) — content-addressed reference, no byte copy |
| **Lease / fencing** | **IMPLEMENTED** | `src/core/lease/reaper.mjs`, `LeaseLostError`; ADR-008; `concurrency/lease` suite; reaper goes through `Store` only (W5 S1) |
| **Escalation / human-in-loop** | **IMPLEMENTED** | `ask_user`, `human.requested`, CLI `answer`; atomic expiry (W5 R1); the resume path awaits async tools (W5 X3) |
| **Completion contract** | **IMPLEMENTED** | ADR-013; **wired into `orionctl run` by default** since Wave 4.5 (was opt-in when this file was first written); `MUTATING_TOOLS` derived from tool `effects` (W5 T1) |
| **Evaluation harness** | **IMPLEMENTED** | `eval/` — 17 tasks, deterministic verifiers, no LLM judge; `eval/selfcheck.mjs` gates it in CI (W5 E1) |
| **Logging** | **PARTIAL** | The event log *is* the log; no separate structured logger or levels |
| **Configuration** | **IMPLEMENTED** | W8: `.orion.json` (project) + `~/.orion/config.json` (user), layered **under** env (env wins); `src/config/index.mjs`; `orionctl config` prints effective values with provenance; inline `apiKey` refused — `apiKeyEnv` names the variable; unknown key = error naming the field, exit 2. Config `search` overrides resolve but are **not yet consumed** by the search layer |
| **Permission rules (no code)** | **IMPLEMENTED** | W8: `.orion-rules.json` / `~/.orion/rules.json` — `denyTools`, `escalateTools`, `denyCommandPatterns`, `protectedPaths`; `src/config/rules.mjs`. Rules may only **RAISE** strictness (no `allowTools`); scopes union; concatenated with `DEFAULT_DANGEROUS`, never replacing it; invalid file refuses the run |
| **Search (glob / regex grep)** | **IMPLEMENTED** | W8: `glob` tool + `grep` regex opt-in, both containment-respecting and ReadOnly; layered budgets (5 s walk / 750 ms dir / 20 000 files / 100 000 entries / depth 24 / 1 000 glob results) with `[INCOMPLETE RESULT]` whenever a bound bites; literal `grep` call shape preserved |
| **Git navigation** | **PARTIAL** | W8: read-only `git` tool (`status`/`diff`/`branch`/`log`/`blame`), `src/sandbox/git.mjs`; clears `GIT_DIR`/`GIT_WORK_TREE` so it never reports on the W6 shadow repo; handles "not a repo" and "git not on PATH" as answers. **No write operations** — deferred until the shadow-repo interaction is designed |
| **First-run flow** | **IMPLEMENTED** | W8: bounded, non-interactive message, **exit 2** (was exit 0 — `fresh-run-audit.md:92`); names the env vars and the config-file alternative; prints no secrets |
| **Packaging / install** | **IMPLEMENTED** | `v0/package.json` — `@kernlbase/orion` 0.2.0, zero deps, explicit `files` allowlist, tarball leak check in CI |
| **Tests** | **IMPLEMENTED** | `v0/tests/run-all.mjs` — **2,253 passing, 0 failing, across 49 suites** as of W10 (was 1,001 / 31 when this audit was written) |
| **MCP / external resources** | **IMPLEMENTED** | W9: servers declared in `.orion.json` (`mcpServers`); sessions are **W6 resources** (`kind: 'mcp'`, derived id, `resource.acquired`/`reattached`/`released`/`lost`); tools namespaced `mcp__server__tool` and merged into the model's schema; single-flight connection per server per run; on a container backend the server runs **inside** the container (`docker exec -i`) and inherits `--network none` + cgroup limits — measured live. Every MCP tool is `Mutating` + `UNSAFE`, so the permission lattice is not bypassable. `mcp__` results are always compaction-eligible. First justified dependency: `@modelcontextprotocol/sdk`, **optional + exact-pinned + lazily imported**; absent, MCP degrades and the run continues |
| **Subagents / delegation** | **IMPLEMENTED** | W10: `subagent` tool; a child is a REAL run (own id, lease, plan, budget, log) with `parent_run_id` set; emits the two members reserved since Wave 1 — `child.spawned` / `child.finished` — so the contract needed no change. Lineage is a FOLD (`core/projection/lineage.mjs`), never a table. Child is read-only by default; cannot be granted a tool the parent lacks or denies; posture is the stricter of parent and request; inherits no grants. Quotas: 2 live / 8 per run / depth 2, per-child budget < parent, delegated tokens charged to the parent |
| **Parallel execution** | **PARTIAL** | W10: bounded concurrency by design (quotas + per-run leases + WAL store). Children are in-process and share the parent's container, so store contention is one connection's own lock rather than cross-process. **Two children have not been run genuinely concurrently** — `spawnChild` is awaited per call, so today's parallelism is the *capacity* (quota, leases, isolation) rather than exercised simultaneity |
| **Container / non-local sandbox** | **NOT IMPLEMENTED** | Deferred to W6 (the audit's Q4 gate) |
| **Resource identity / grants** | **NOT IMPLEMENTED** | Deferred to W6 |

## Tool inventory

**Eleven tools** as of W8 (nine when this audit was written; `glob` and `git` added). `effects` and
`pathAddressed` are declared on the tool and derived everywhere else (W5 T1/T2) — no module restates
them. Both W8 additions are ReadOnly, so `mutatingTools()` still derives exactly `bash,edit,write`.

A twelfth, `skill`, exists **only when a project has skills to activate** (W7), so a project with
none sees the identical toolset it saw before that wave.

| Tool | Effects | Path-addressed | Recovery class | Notes |
|---|---|---|---|---|
| `read` | ReadOnly | yes | `READ_ONLY` | ADR-012 line-number delimiter; paged |
| `grep` | ReadOnly | no | `READ_ONLY` | both Wave-1 defects fixed (verified in this audit); W8 added opt-in `regex`, `ignore_case`, `glob` — literal remains the default, so the pre-W8 call shape is unchanged |
| `glob` | ReadOnly | no | `READ_ONLY` | **W8.** `**`, `*`, `?`, `[abc]`, `{a,b}`; containment-respecting; shares the X6 budgets and the `[INCOMPLETE RESULT]` contract |
| `git` | ReadOnly | no | `READ_ONLY` | **W8.** One tool with a `what` selector (`status`/`diff`/`branch`/`log`/`blame`) rather than five siblings, to save schema bytes on every model call. **Read-only** — no write verbs reach the dispatcher |
| `mcp__<server>__<tool>` | Mutating | no | `UNSAFE` | **W9.** Zero or more, from servers declared in `.orion.json`. Conservative by construction: the harness cannot know what third-party code does, so it is never auto-allowed at a strict posture and never silently re-issued after a crash. A server cannot lower either declaration |
| `subagent` | Mutating | no | `UNSAFE` | **W10.** Delegates a bounded sub-task to a child run. Mutating because the child can do whatever its granted toolset allows; UNSAFE because a spawn interrupted mid-flight has an unknowable outcome. Declares `delegates: true` so consumers identify delegation without string-matching the name |
| `write` | Mutating | yes | `SELF_VERIFYING` when witnessed | ADR-011 `expected_pre_sha` |
| `edit` | Mutating | yes | `SELF_VERIFYING` | pre-state *is* the precondition |
| `bash` | Mutating | no | `classifyShell()` → default-deny `UNSAFE` | async since W5 X1; `tool.timed_out` on timeout (W5 X4) |
| `verify` | ReadOnly | no | `READ_ONLY` | Wave 2; subject to `denyCommandPatterns` since Wave 4.5 F1 |
| `plan` | ReadOnly | no | `READ_ONLY` | emits `plan.created` / `plan.revised` |
| `plan_step` | ReadOnly | no | `READ_ONLY` | emits `plan.step_started` / `plan.step_finished` |
| `ask_user` | ReadOnly | no | `READ_ONLY` | `alwaysEscalate`; runtime-handled |

## Defects reported in the previous edition — status

Both were in `grep`, both **now fixed**. Re-verified directly against `LocalSandbox` during this
rebaseline:

1. **`grep` with a file path always failed** (`ENOTDIR`). Now returns `calc.py:1: def add(a,b):`
   for a file path.
2. **`grep` without a path searched `.harness/`**, leaking the event-log database into results.
   Now scoped to the workspace.

The previous edition said "Neither is a Wave-1 fix … Both belong in Wave 2." They were fixed. The
document was not updated, which is the D3 defect this rebaseline closes.

## What genuinely stands out

- **Zero dependencies**, runtime and dev — rare, and a major packaging advantage.
- **31 test files for 22 source modules**, 1,001 tests green, plus an eval harness with its own
  CI gate.
- **Replay reconstructs a run with no model calls** — a property, not a claim.
- **`Store.append` is the only mutation path**, and a `grep` proves no code outside `store.mjs`
  bypasses it.
- **`explain` includes `redact`** — secret hygiene is designed in, not bolted on.
- **Documented claims are increasingly test-asserted** rather than prose: the tool count, the
  provider/streaming wiring, the completion verdict table, and the no-duplicated-metadata rule
  all fail the build when they drift.
