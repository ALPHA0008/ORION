# Phase 5/6 — Execution Model & Failure Recovery Audit

Recorded 2026-08-26T13:00–13:50Z.

**Method note.** The brief asks me to deliberately *inject* 13 failure classes. Without model
credentials I cannot drive a live agent into most of them. So this phase is **code-derived, with
empirical verification wherever the mechanism could be exercised without a model** — chiefly QM's
durability layer against a live Postgres (25/25 + 54/54 pass) and Hermes' schema against a live
SQLite. Each row states which it is. Nothing here is inferred from a README.

---

## 1. The central question

> *What exactly happens if an agent is executing step 17 and the process dies?*

| | QM | Hermes | Ruflo |
|---|---|---|---|
| **Answer** | The run's **lease expires**; a leader-elected **reaper** requeues or parks it. | The turn lease expires; the session transcript is on disk up to the last persisted step; async delegations survive in SQLite. | Nothing systematic. In-process state is lost. |
| Mechanism | `runs.lease_expires_at` + `reaper.ts` + `pg_try_advisory_lock` | `session_turn_leases` + incremental `_persist_session` + `async_delegations` | `.claude-flow/*/state.json` written at command boundaries |
| Verified how | **Executed** — 25/25 durability tests vs live Postgres | **Inspected live DB** — tables exist, schema_version 26 | **Executed** — inspected written state.json |
| Work resumes automatically? | **Yes** (requeue) | Partially — session resumable via `--resume`; delegations reconciled | **No** |
| Poison-message protection? | **Yes** — `maxAgeMs` → park | Yes — `delivery_attempts` counter | No |
| Double-execution guarded? | **Yes** — `ifExpiredAt` CAS + `FOR UPDATE SKIP LOCKED` | Yes — lease holder + `owner_pid` | No |

**QM is the only one of the three that treats process death as a first-class, recoverable event.**

---

## 2. QM — execution model

| Dimension | Implementation | Evidence |
|---|---|---|
| Process model | HTTP server (`src/index.ts`) + separate worker (`src/runs/worker-main.ts`) | `package.json` scripts `start`, `worker` |
| Worker model | Multi-worker, DB-coordinated | `runs/instance-registry.ts` |
| Concurrency | Postgres `FOR UPDATE SKIP LOCKED` claim | `postgres-run-store.ts:180,201` |
| Scheduling | `pg-boss@12` queues + `croner` | `cron/job-queue.ts:33-52` |
| Cancellation | `AbortSignal` threaded into the harness | `harness.ts:52` (`cancel?: AbortSignal`) |
| Retry | attempt + errorAttempts counters; requeue on lease expiry | `postgres-run-store.ts:295-327` |
| Idempotency | dedicated store; replay dedupe | `idempotency/idempotency-store.ts`; `test/postgres-replay-dedupe.test.ts` **passes** |
| Persistence | Postgres everywhere (sessions, runs, memory, audit, files, grants) | `src/persistence/`, 26 pg test files |
| Crash recovery | lease expiry → reaper → requeue \| park | `runs/reaper.ts:40-53` |
| Leader election | `pg_try_advisory_lock(hashtextextended(key))` | `persistence/leader-lease.ts:69,86` — **test passes** |
| Human waiting | approvals as durable records, not in-memory promises | `slack/approvals.ts` (32 KB); `pausedOnApproval` in `HarnessTurnResult` |
| Long-running tasks | `maxAgeMs` bound, then park | `reaper.ts:44-46` |
| Multi-agent | run-per-session, scope-isolated | `runs/`, `scope_id` predicates |
| Resource isolation | external sandboxes (Fly `sprites`, AWS) | `src/sandbox/` (18 files) |
| State transitions | explicit `status` column + retire() | `postgres-run-store.ts` |
| Graceful shutdown | drain + task protection | `runs/drain.ts`, `runs/task-protection.ts` |

### Failure-class table — QM

| Failure | Behaviour | Status |
|---|---|---|
| Process killed mid-step | lease expires → reaper requeues (or parks if > `maxAgeMs`); stranded session leases force-released | **VERIFIED (code + 25/25 tests)** |
| Two reapers race | `retire(..., { ifExpiredAt: now })` compare-and-set; only one applies | **VERIFIED** `postgres-run-store.ts:311` |
| Two workers claim one run | `FOR UPDATE SKIP LOCKED LIMIT 1` | **VERIFIED** `:180,:201` |
| Duplicate delivery/replay | replay-dedupe store | **VERIFIED** — test passes vs live PG |
| DB outage | `persistence-init-retry` path; pool errors surface | **PARTIAL** — test exists (`test/persistence-init-retry.test.ts`), not fault-injected here |
| Model malformed response | screener returns `unscreened`; turn continues with warning label | **VERIFIED** `security-posture.ts:86-91` |
| Tool result hostile | classifier `strict` → **quarantine** + human release approval | **VERIFIED** `orchestrator.ts:2392-2427` |
| Screener down/timeout | **fails open**, audited as `security_posture.tool_result_failed_open` | **VERIFIED** `orchestrator.ts:~2429` |
| Context overflow | per-scope/per-model budget + `compactHistory` | **VERIFIED** (test passes), behaviour under real pressure UNVERIFIABLE |
| Human approval never arrives | run holds `pausedOnApproval`; lease still ages out → reaper | **PARTIAL** — inferred from code paths, not exercised |
| Concurrent modification | `pg_advisory_xact_lock` per session/scope | **VERIFIED** `postgres-session-store.ts:294`, `postgres-memory-service.ts:45` |

**Can execution be replayed?** Yes — `harness/replay.ts` + `tape-fold.ts` + `tapeMode:
"shadow"|"serve"`. This is rare and valuable: it makes a nondeterministic subsystem regression-testable.

**Can it be forked?** Session forking exists (`test/postgres-store.test.ts` covers
"fork provenance survives a store restart" — **passes**).

---

## 3. Hermes — execution model

| Dimension | Implementation | Evidence |
|---|---|---|
| Process model | single long-lived process per session; gateway daemon for multi-platform | `gateway/run.py` (67,894 LOC subsystem) |
| Concurrency | ThreadPool for parallel tool calls | `tool_executor.py:1092` |
| Approval under concurrency | `_ConcurrentToolAuthorizationGate` serialises prompts | `tool_executor.py:441` |
| Cancellation | `agent._interrupt_requested` checked each iteration; `_ToolCancelledResult` | `conversation_loop.py:2029-2037`; `tool_executor.py:431` |
| Timeouts | per-tool, concurrent vs sequential resolvers | `tool_executor.py:189,790,427` |
| Retry | inner retry loop around the API call | `conversation_loop.py:2888` |
| Persistence | SQLite (`state.db`), incremental per-iteration | **VERIFIED live**: 22 tables, `schema_version=26` |
| Leases | `session_turn_leases`, `compression_locks` (holder + expires_at) | `hermes_state_common.py:497-509` |
| Durable async work | `async_delegations` with `state`, `delivery_state`, `delivery_attempts`, `owner_pid` | `:511-525` — **table exists live** |
| File-state recovery | **shadow git repo** per project, snapshot before every write | `checkpoint_manager.py:755`; **CLI verified** |
| Crash recovery | session resumable (`--resume`); delegations reconciled; `gateway/session_db_recovery.py` | code-derived |
| Isolation | 9 execution environments; git worktrees per subagent | `tools/environments/`, `subagent_worktree.py` |

### Failure-class table — Hermes

| Failure | Behaviour | Status |
|---|---|---|
| Process killed mid-step | transcript persisted incrementally (`_persist_session` inside the loop); turn lease ages out; async delegations survive in SQLite with `owner_pid` | **PARTIAL** (schema verified live; not crash-injected) |
| Bad file edit | shadow-git checkpoint taken **before** every `write_file`/`patch`/`terminal` → `/rollback` | **VERIFIED** (CLI + code) |
| Model returns `tool_calls` with empty array | explicit recovery path | **VERIFIED** `conversation_loop.py:8151-8168` |
| Unanswered `tool_call_id` | **orphan repair** synthesises `role:"tool"` stubs so the transcript stays API-valid | **VERIFIED** `:8511-8532` — genuinely good |
| Malformed tool arguments | `_parse_tool_arguments` + `_canonicalize_api_tool_calls` repair | **VERIFIED** `:170`, `:1360` |
| Provider quirks (Copilot creds, Ollama ctx, image dims) | named workarounds with issue numbers inline | **VERIFIED** `:489,:548,:519` |
| Tool timeout / crash | typed results, process-group kill | **VERIFIED** `environments/base.py:1311-1320` |
| Context overflow | compression + `compression_locks` to prevent concurrent compaction | **VERIFIED** (schema live) |
| Duplicate delegation delivery | `delivery_state` + `delivery_attempts` counters | **VERIFIED** (schema live) |
| Background review fails | swallowed — `except Exception: pass  # best-effort` | **VERIFIED** `turn_finalizer.py:~809` |
| No credentials | clean message + exit 1 | **VERIFIED (executed)** |

**Notable strength:** the *orphan repair* and *dropped-tool-call* paths. Most harnesses crash or
send an invalid message array back to the provider. Hermes repairs the transcript so the
conversation stays valid. That is hard-won and worth copying.

**Notable weakness:** state lives on a mutated god-object across a 6,550-line loop body. Recovery is
"reload the transcript", not "resume the state machine at step 17". There is no run-level
state machine to resume *into*.

---

## 4. Ruflo — execution model

| Dimension | Implementation | Evidence |
|---|---|---|
| Process model | CLI invocations; optional background daemon | `ruflo daemon` subcommand |
| Persistence | JSON files (`.claude-flow/**/state.json`) + SQLite (`.claude/memory.db`) | **VERIFIED live** |
| Memory durability | SQLite + 384-dim MiniLM vectors — **works across processes** | **VERIFIED (executed)** — HANDS-008 |
| Consensus | real Raft/PBFT/Gossip **exists**; CLI does not instantiate it | `swarm/src/consensus/*`; `hive-mind.ts:1031` |
| Crash recovery | none found | — |
| Leases / leader election | none in the shipped path (Raft has one, unused) | — |
| Idempotency | none found | — |
| Retry semantics | per-command ad hoc | — |
| Checkpoint commits | agent auto-commits to git (4,833 checkpoint commits in its own history) | GIT-005 |

### Failure-class table — Ruflo

| Failure | Behaviour | Status |
|---|---|---|
| Process killed mid-step | in-flight work lost; only command-boundary JSON survives | **VERIFIED** (state.json is written at init, not continuously) |
| Byzantine node / faulty peer | **not handled** — no consensus instance exists to handle it | **VERIFIED** — HANDS-007 |
| Embedding service unavailable | **silently** degrades to a string hash; retrieval quality collapses without signal | **VERIFIED (code)** `reasoningbank/index.ts:969-996` |
| Router dependency missing | falls back through 4 tiers to k-NN; reports `@metaharness/router not installed` | **VERIFIED** `neural-router.ts:330` |
| TLS peer untrusted | `rejectUnauthorized: false` in 10+ locations — **accepts any certificate** | **VERIFIED** |
| SONA "learning" ineffective | no signal; status UI reports "Active / Real" | **VERIFIED** — HANDS-006 |
| Bad input / unknown command | clean message, exit 1, "Did you mean…?" | **VERIFIED (executed)** |
| Memory DB uninitialised | clear error, exit 1 | **VERIFIED (executed)** |

**The dominant Ruflo failure mode is silence.** Three separate paths (embeddings, router, SONA)
degrade to a weaker implementation *without telling the operator*, while status output continues to
report the capability as available. That is worse than a hard failure, because it is undetectable
in production.

---

## 5. Cross-cutting answers to the brief's 9 recovery questions

| Question | QM | Hermes | Ruflo |
|---|---|---|---|
| 1. What state was persisted? | run row, session entries, audit, tape | transcript, session meta, delegations, file checkpoints | memory rows; command-boundary JSON |
| 2. What gets retried? | the whole run (requeue) | the API call (inner retry); delegation delivery | nothing systematic |
| 3. What gets duplicated? | guarded (CAS + SKIP LOCKED + dedupe) | guarded (lease + attempts) | unguarded |
| 4. What is idempotent? | run claim, replay handling | delegation delivery | — |
| 5. What is lost? | in-flight step output since last emit | in-flight step since last persist | all in-process state |
| 6. Can execution resume? | **Yes, automatically** | Session resumes; turn restarts | No |
| 7. Can the system prove what happened? | **Yes** — audit log + tape + error log | Partly — transcript + logs, no audit log | Weakly — logs |
| 8. Can exact state be recreated? | **Closest** — tape replay (`shadow`/`serve`) | Transcript replay, no tape | No |
| 9. Explicit or silent failure? | **Explicit + audited** (even fail-open is an audit event) | Explicit (best-effort paths are commented) | **Often silent** |

---

## 6. The transferable lesson from this phase

Durability in an agent harness is not "save the conversation." It is four separate things, and only
QM has all four:

1. **Ownership with expiry** — a lease, so a dead process releases its claim without cooperation.
2. **A sweeper with authority** — leader-elected, so exactly one actor reclaims work.
3. **Compare-and-set on reclaim** — so the sweep itself cannot double-execute.
4. **A poison bound** — park after N attempts / T age, so a bad task cannot loop forever.

Hermes has (1) and a partial (4). Ruflo has none. Each is ~50–100 lines against Postgres or SQLite.
The cost of adding them is low; the cost of retrofitting the *state model* they require is high —
which is the real argument for putting them in a harness core from day one.
