# COMPARISON — QM vs Hermes vs Ruflo

Scores are 1–5, each with the evidence that produced it and a confidence level.
Nothing here is scored from intuition; where I could not test, the score is withheld (`—`)
rather than guessed.

Pinned state: qm `c7caba56` · hermes-agent `d62a05e9` · ruflo `e21aa352` · 2026-08-26.

**Scoring rubric**
`5` exemplary, would copy · `4` solid, works, minor gaps · `3` real but limited or partly unreached ·
`2` present in name, weak in substance · `1` absent, or actively misleading.

**A caution on the totals.** These three are not the same kind of thing (see §3). A low QM score on
"self-improvement" is not a defect — QM does not attempt it. Read the per-dimension rows, not the sum.

---

## 1. The matrix

| # | Dimension | QM | Hermes | Ruflo | Conf. |
|---|---|:--:|:--:|:--:|---|
| 1 | Control loop | 3 | **4** | 2 | high |
| 2 | Context management | 4 | **4** | 2 | med-high |
| 3 | Memory | 3 | **5** | **4** | high |
| 4 | Durability | **5** | 3 | 1 | high |
| 5 | Scheduling | **4** | 3 | 2 | high |
| 6 | Failure recovery | **5** | 4 | 1 | high |
| 7 | Tooling | 3 | **5** | 3 | high |
| 8 | Sandboxing | 3 | **5** | 2 | high |
| 9 | Security | **5** | 3 | 1 | high |
| 10 | Multi-agent | 3 | **4** | 3 | med-high |
| 11 | Multi-user / org | **5** | 2 | 1 | high |
| 12 | Extensibility | **4** | **4** | 3 | med-high |
| 13 | Model-agnosticism | 4 | **5** | 2 | high |
| 14 | Observability | **4** | 3 | 2 | med-high |
| 15 | Evaluation / replay | **4** | 2 | 1 | high |
| 16 | Self-improvement | 1 | **4** | 1 | high |
| 17 | Developer experience | 3 | **4** | 3 | med |
| 18 | Operational simplicity | 2 | 3 | **3** | med |
| 19 | Code quality | **4** | 3 | 2 | med-high |
| 20 | Claim accuracy | **5** | 4 | 1 | high |
| 21 | Project health | 3 | **5** | 2 | high |
| | **Mean** | **3.6** | **3.8** | **2.0** | |

---

## 2. Row-by-row evidence

### 1. Control loop — QM 3 · Hermes 4 · Ruflo 2
- **QM 3** — deliberately *does not own* a loop. `Harness.turns.runTurn(input) → result`
  (`harness.ts:140`); the loop lives in Pi/Claude SDK/Codex/OpenCode. Scored 3 not because it is
  poor but because the primitive is delegated — excellent as a *seam*, absent as a *loop*.
- **Hermes 4** — a real, locatable loop (`conversation_loop.py:2017-8573`) with retry, interrupt,
  budget, dropped-tool-call recovery and orphan repair. Loses a point for a **6,550-line body** with
  state on a mutated god-object (50+ private attrs).
- **Ruflo 2** — no own loop; shells out to Claude Code (`hive-mind spawn --claude`).

### 2. Context management — QM 4 · Hermes 4 · Ruflo 2
- **QM 4** — `contextTokenBudget(scopeLabel, model)` resolves budget **per scope and per model**
  (`harness.ts:148`); `systemCacheBoundary` (`:71`) marks the stable prefix for provider prompt
  caching; `context-compaction.ts` tested and passing.
- **Hermes 4** — compression + `compression_locks` table preventing concurrent compaction
  (verified live) + FTS5/trigram retrieval over history + a dedicated `evals/compaction` suite.
- **Ruflo 2** — no distinct context subsystem; context is whatever the wrapped CLI does.

### 3. Memory — QM 3 · Hermes 5 · Ruflo 4
- **QM 3** — append-only `memory_revisions` with per-scope advisory locks
  (`postgres-memory-service.ts:7-58`). Correct and durable, but a single mechanism; no semantic
  retrieval.
- **Hermes 5** — the most differentiated memory model found: episodic (`messages` + FTS5), semantic
  (8 pluggable providers behind `memory_provider.py` ABC), procedural (skills), and user modeling
  (Honcho, 8,494 LOC). Notably filters gateway-internal synthetic turns out of durable personal
  memory (`honcho/__init__.py:33-45`).
- **Ruflo 4** — **earned by execution.** Cross-process store/get works; a lexically-disjoint query
  ("cat sitting on a rug" vs "The feline rested upon the woven floor covering") scored **0.73** —
  genuine MiniLM embeddings, not a hash (HANDS-008). Held below 5 because the *ReasoningBank* path
  silently degrades to a string hash when the embedder fails.

### 4. Durability — QM 5 · Hermes 3 · Ruflo 1
- **QM 5** — lease expiry + leader-elected reaper + `ifExpiredAt` CAS + `maxAgeMs` poison bound
  (`reaper.ts:40-53`, `postgres-run-store.ts:295-327`). **Executed: 25/25 durability tests pass
  against a live Postgres.**
- **Hermes 3** — `session_turn_leases`, `compression_locks`, and `async_delegations` with
  `delivery_attempts`/`owner_pid` all exist as **live tables** (verified). But there is no run-level
  state machine to resume *into*; recovery means reloading a transcript.
- **Ruflo 1** — no leases, no reaper, no idempotency. State written at command boundaries only
  (verified: `hive-mind init` writes one JSON file).

### 5. Scheduling — QM 4 · Hermes 3 · Ruflo 2
- **QM 4** — `pg-boss@12` durable queues + `croner`, with `FOR UPDATE SKIP LOCKED` claiming
  (`cron/job-queue.ts:33-52`, `postgres-run-store.ts:180`). Correctly outsourced.
- **Hermes 3** — real cron subsystem (`cron/`, `croniter`) and a `cron` CLI; in-process scheduling.
- **Ruflo 2** — `daemon` and `scheduled_tasks.lock` exist; no durable queue found.

### 6. Failure recovery — QM 5 · Hermes 4 · Ruflo 1
- **QM 5** — see §4, plus quarantine-with-human-release on hostile tool output
  (`orchestrator.ts:2392-2427`) and audited fail-open.
- **Hermes 4** — outstanding at the *provider* boundary: recovery for `finish_reason="tool_calls"`
  with empty array (`:8151-8168`), **orphan repair** synthesising `role:"tool"` stubs to keep the
  transcript API-valid (`:8511-8532`), tool-arg repair, process-group kill on timeout. Loses a point
  for no run-level resume.
- **Ruflo 1** — **silent degradation in three separate paths** (embeddings → hash, router →
  k-NN, SONA → counters) while status output still reports availability. Worse than a hard failure.

### 7. Tooling — QM 3 · Hermes 5 · Ruflo 3
- **Hermes 5** — 86 tools; **AST-based discovery** that parses modules rather than importing them
  (`registry.py:111`); a **plugin-override policy** stopping a pip package hijacking a first-party
  tool (`:236,645`); three execution strategies; an authorization gate that serialises approval
  prompts across parallel tools (`tool_executor.py:441`).
- **QM 3** — `tools/primitives.ts` (48 KB) plus per-adapter tool presentation; smaller surface,
  deliberately.
- **Ruflo 3** — 48 MCP tool modules; the advertised "423 tools" over-counts schema properties.

### 8. Sandboxing — QM 3 · Hermes 5 · Ruflo 2
- **Hermes 5** — 8–9 real execution backends (local, docker, ssh, modal, managed-modal,
  vercel-sandbox, daytona, singularity), 8,785 LOC, with process-group kill and bounded output
  (`environments/base.py:1311-1320`). Caveat: these are **sandboxes, not terminal multiplexers**.
- **QM 3** — real sandboxing but externalised to Fly.io `sprites` / AWS; 12 tests fail without the
  binary. Powerful in its target deployment, unavailable off it.
- **Ruflo 2** — relies on the wrapped CLI's sandboxing.

### 9. Security — QM 5 · Hermes 3 · Ruflo 1
- **QM 5** — a 911-line recursive shell parser defeating heredoc/ANSI-C/pipe-to-shell/SQL-client
  evasion to depth 8 (`command-policy.ts:66-115`), allowlist failing closed, three composable
  postures with an org floor (`security-posture.ts:36`), an injection-aware classifier, quarantine,
  audit log, secret masking. **63/63 security tests pass.**
- **Hermes 3** — real approval gates, dangerous-command auto-deny in the review fork
  (`background_review.py:1112`), skill provenance/trust, MCP stdio screening in `doctor`, egress
  proxy. No tenancy model, no policy engine.
- **Ruflo 1** — mTLS **refuted**; `rejectUnauthorized: false` in **10+ shipped locations**;
  zero-trust is a label. Ed25519 signing is real and tested — the one bright spot — but the signer
  key is self-asserted, which the code honestly states.

### 10. Multi-agent — QM 3 · Hermes 4 · Ruflo 3
- **Hermes 4** — subagents with **git-worktree isolation** (`subagent_worktree.py`) so parallel
  writers cannot collide, durable async delegation, per-turn delegate caps to prevent fork bombs.
- **Ruflo 3** — the *most elaborate* multi-agent surface (swarms, hive-mind, 108 agent definitions)
  and *correct* consensus code, but the CLI stores `--consensus byzantine` as a **string tag** and
  instantiates nothing (verified at runtime).
- **QM 3** — run-per-session with scope isolation; multi-agent is not its focus.

### 11. Multi-user / organisation — QM 5 · Hermes 2 · Ruflo 1
- **QM 5** — the only genuine multi-tenant design: 5 scope kinds, `WHERE scope_id = $1` on every
  query, ACL/grant stores, principals with internal/guest types, per-scope policy and budget,
  audit log. Held at 5 despite `ScopeId = string` because enforcement is real at the boundary that
  matters.
- **Hermes 2** — single-user by design; gateway supports multiple *platforms*, not multiple tenants.
- **Ruflo 1** — no tenancy model.

### 12. Extensibility — QM 4 · Hermes 4 · Ruflo 3
- **QM 4** — the `Harness` interface itself is the extension point; `plugins/`, MCP, connectors.
- **Hermes 4** — 44 optional dependency groups, plugin lifecycle hooks, 37 provider packages,
  8 memory backends, skills-as-plugins.
- **Ruflo 3** — 54 plugin directories, but the registry and filesystem disagree (`CLAUDE.md` says
  "20 Available"), and duplication inflates counts ~2.2×.

### 13. Model-agnosticism — QM 4 · Hermes 5 · Ruflo 2
- **Hermes 5** — three-tier abstraction (transports → adapters → provider profiles) with **37
  provider packages** and named quirk shims per provider.
- **QM 4** — model-agnostic *via* harness choice (4 vendors) rather than a provider layer of its own.
- **Ruflo 2** — inherits whatever the wrapped CLI supports; its own "router" does not execute.

### 14. Observability — QM 4 · Hermes 3 · Ruflo 2
- **QM 4** — structured audit log with named actions (including
  `security_posture.tool_result_failed_open`), error log with categories/codes, `recordLlmRequest`
  capturing TTFT, duration, gap phases and per-tool wall time (`harness.ts:27-40`), metrics sink.
- **Hermes 3** — excellent *diagnostics* (`hermes doctor` detects a specific SQLite WAL-reset bug by
  source id) and OTLP support, but no audit log.
- **Ruflo 2** — logs; status output that misreports capability state.

### 15. Evaluation / replay — QM 4 · Hermes 2 · Ruflo 1
- **QM 4** — `replay.ts` + `tape-fold.ts` + `tapeMode: "shadow" | "serve"`: record real turns, then
  serve them deterministically. This makes a nondeterministic subsystem regression-testable and is
  rare.
- **Hermes 2** — `evals/` covers only `browser_use`, `compaction`, `readtool`; no replay.
- **Ruflo 1** — benchmarks exist but run below meaningful thresholds (HNSW at N=1,000); the headline
  89% routing figure is **unreproducible**.

### 16. Self-improvement — QM 1 · Hermes 4 · Ruflo 1
- **Hermes 4** — the genuine article: a **forked agent** with a memory/skill-only tool whitelist,
  auto-spawned after every turn (`turn_finalizer.py:795-810`), writing atomically with rollback and
  provenance. Held at 4, not 5, purely because **effectiveness is never measured** —
  `skill_usage.py` counts activity, not outcome.
- **QM 1** — does not attempt it (not a defect; out of scope).
- **Ruflo 1** — claims it; the path is provably inert (SONA identity proof).

### 17. Developer experience — QM 3 · Hermes 4 · Ruflo 3
- **Hermes 4** — installs cleanly, ~80 subcommands, superb `doctor`, clear actionable errors
  ("Run `hermes model`… or set OPENROUTER_API_KEY"), correct exit codes. Cost: Python `<3.14` pin.
- **Ruflo 3** — published package installs and runs; good CLI ergonomics ("Did you mean…?"); but the
  **repo cannot be built with npm** (`EUNSUPPORTEDPROTOCOL "workspace:"`), and error text still says
  `claude-flow`.
- **QM 3** — no build step and 612 deps install fine, but you cannot *run* it without Postgres,
  Slack credentials and a model key.

### 18. Operational simplicity — QM 2 · Hermes 3 · Ruflo 3
- **QM 2** — mandatory Postgres, pg-boss, Fly.io/AWS sandboxes, Slack. Powerful, not simple.
- **Hermes 3** — SQLite only for core; heavy optional surface.
- **Ruflo 3** — SQLite + JSON files; simplest to start, but 7 native postinstall builds
  (better-sqlite3, argon2, onnxruntime, sharp…) is the largest supply-chain surface of the three.

### 19. Code quality — QM 4 · Hermes 3 · Ruflo 2
- **QM 4** — single language, no build step, strict typing, ~4,257 test cases, 1:2.7 test:source
  ratio, tests isolated enough that security suites pass **before `npm install`**. Deduction:
  `orchestrator.ts` at 150 KB.
- **Hermes 3** — enormous real-world robustness, undermined by `cli.py` at 21,665 lines,
  `hermes_state.py` at 14,677, and god-object state. The **13,220 `fix:` vs 3,307 `feat:`** ratio is
  the visible cost.
- **Ruflo 2** — pockets of genuinely good code (consensus, HNSW, DQN) stranded amid inert
  headline features, ~2.2× duplication, and stale claims in source comments.

### 20. Claim accuracy — QM 5 · Hermes 4 · Ruflo 1
- **QM 5** — every substantive claim tested held; it **under-claims** relative to what it ships.
- **Hermes 4** — all five major claims real; two need re-scoping (terminal backends = sandboxes;
  learning loop = closed but unmeasured). Nothing fabricated.
- **Ruflo 1** — flagship feature provably inert while the CLI prints "(Real) … Active";
  mTLS refuted; consensus decorative; counts inflated. Partially offset by a genuine honesty pass in
  `CLAUDE.md`.

### 21. Project health — QM 3 · Hermes 5 · Ruflo 2
- **Hermes 5** — 3,048 author emails, sustained 3,000–6,000 commits/month for 7 months, 35 releases,
  bus factor comfortably >1 (four contributors >400 commits besides the lead).
- **QM 3** — active and accelerating (40 → 136 commits/month), strong PR discipline (90.9%
  GitHub-committed), but bus factor 2 and only 28 days of public history.
- **Ruflo 2** — alive but **~96% down from peak** (2,326 → 95 commits/month); 93.7% single-author;
  31% of commits are automated release bumps.

---

## 3. Taxonomy — the hypothesis, tested

The brief's four-tier hypothesis mostly holds, but the code says the discriminator is not layering.
It is **two independent questions**:

```
                 Owns the durable run state?
                        no            yes
                   ┌──────────────┬──────────────┐
     Owns    yes   │   Hermes     │   (empty)    │
     the           │  (harness)   │              │
     loop?    no   │   Ruflo      │     QM       │
                   │(meta-harness)│ (gov. shell) │
                   └──────────────┴──────────────┘
```

**Correction to the hypothesis.** "Meta-harness" and "org platform" are not successive layers above
"harness" — they are different answers to *loop ownership* and *state ownership*. Ruflo and QM both
rent a loop; they differ entirely in whether they own durable state. That is what makes QM
substantial and Ruflo thin, far more than any layering.

**The empty quadrant is the opportunity:** own durable run state, rent the loop behind a stable
contract. QM is closest but binds it to Slack and Postgres.

---

## 4. What each does better than the others

**QM — durable, auditable, multi-tenant execution.**
The only project that answers "the process died at step 17" (lease → reaper → requeue/park,
verified 25/25 against live Postgres) and "prove what happened" (audit log + replay tape). Its
command policy is the only one that would survive a determined adversary. **Copy:** the harness
adapter with declared capability sets; the lease/reaper quartet; naming your fail-open path in the
audit log. **Do not copy:** `ScopeId = string`; a permissive default policy.

**Hermes — surviving contact with reality, and learning from it.**
Best failure handling at the provider boundary; the only genuine self-improvement loop; the best
diagnostics; git-as-checkpoint-store. **Copy:** the shadow-git checkpoint; orphan repair for
unanswered tool-call IDs; AST tool discovery; plugin-override protection; disclosing your own token
overhead in a comment. **Do not copy:** a 6,550-line loop body and god-object state.

**Ruflo — memory ergonomics, and a cautionary tale.**
The memory CLI is the nicest to use of the three and genuinely works (0.73 on a lexically-disjoint
semantic query). **Copy:** the memory UX; publishing an honesty pass that retracts your own prior
numbers. **Do not copy:** building consensus/RL/planners nothing calls; reporting inert paths as
"Active"; silent degradation.

---

## 5. Which would I actually depend on

- **Multi-user org agent, needs audit and durability:** **QM.** Nothing else is close. Accept
  Postgres + Fly.io and a bus factor of 2.
- **Single developer or small team, long-lived personal agent:** **Hermes.** Most mileage, best
  provider resilience, real cross-session memory. Avoid deep forks.
- **Production orchestration platform:** **none of the three** as-is. Ruflo's memory layer is worth
  extracting as a component; its orchestration claims are not dependable.
- **A reference to read before building your own:** **Hermes' `conversation_loop.py`** for provider
  battle damage, and **QM's `command-policy.ts` + `runs/`** for policy and durability.
