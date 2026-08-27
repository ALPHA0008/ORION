# DECISION MATRIX

Every major design choice, with the alternatives considered, the evidence from the audited systems
that informs it, the failure mode at stake, the decision, its cost, and how to migrate if it turns
out wrong.

Format per decision: **Decision · Alternatives · Evidence · Failure mode · Chosen · Why · Tradeoffs · Migration path**

---

## D-01 · Event log vs mutable database state

**Alternatives**
(a) Mutable rows updated in place · (b) Append-only event log with a derived projection ·
(c) Hybrid: log for history, rows for current state

**Evidence**
- QM approximates (c): a `runs` row with `status`/`lease_expires_at`, plus a *separate* audit log,
  *plus* a *separate* replay tape (`harness/replay.ts`, `tape-fold.ts`). Three mechanisms for what is
  arguably one concern.
- Hermes uses (a): SQLite `sessions`/`messages` mutated in place. Consequence — it can reload a
  transcript but has no run-level state machine to resume *into* (`notes/04-failure-recovery.md`).
- Ruflo uses (a) with JSON files written at command boundaries; in-flight work is lost entirely.

**Failure mode** "Resume at step 17" is undefined; audit, replay and fork each require separate
machinery; nobody can answer "why did the agent do that?" after the fact.

**Chosen: (b), with a cached projection row for query speed.**

**Why** Replay, audit and fork stop being features and become consequences (ARCHITECTURE §10). QM
built all three separately and still cannot fork mid-run cheaply.

**Tradeoffs** Log growth (mitigate: snapshot every N events, archive cold runs). Every read costs a
fold (mitigate: cache the projection). Developers must think in events — a real learning cost.

**Migration path** If the log proves too slow, the cached projection is already the fast path;
demote the log to audit-only. This is a one-way door in the other direction, which is why it must be
decided at v0.

---

## D-02 · Own the agent loop, or rent it

**Alternatives** (a) Own it · (b) Rent via adapters · (c) Both — own one, adapt others

**Evidence**
- **Two of three audited projects do not own a loop.** QM rents four (`harness.ts:173`); Ruflo
  shells out to Claude Code (`hive-mind spawn --claude`).
- QM's four adapters use genuinely different transports (in-process / SDK / JSON-RPC / HTTP) with
  honestly declared capability gaps — proof the seam is real, not cosmetic.
- Hermes owns its loop, and that loop is where its value lives: provider battle damage no design
  process would produce (`conversation_loop.py:489,519,548,8151,8511`).

**Failure mode** Own-only ⇒ you re-litigate every provider quirk yourself. Rent-only ⇒ you cannot
fix anything in the inner loop and inherit the vendor's roadmap.

**Chosen: (c). Ship a built-in loop as the default adapter; make external harnesses first-class.**

**Why** Loop ownership is commoditising while durable state is not (COMPARISON §3). Owning one loop
keeps the reference implementation honest; renting others keeps the seam real. A seam with only one
implementation always rots — QM avoided that by having four.

**Tradeoffs** The event vocabulary must be expressive enough for loops you did not write; external
adapters will always have capability gaps.

**Migration path** Capability sets (L-02) make gaps explicit and additive; new capabilities can be
introduced without breaking existing adapters.

---

## D-03 · Where the authorization seam goes

**Alternatives** (a) Checks scattered at call sites · (b) One `authorize()` seam · (c) External
policy service required

**Evidence**
- QM's tenancy is correct but touches **147 files** (QM-SCOPE-006). It works because every store
  author remembered the `WHERE scope_id = $1` predicate — a discipline guarantee.
- Hermes has approval gates but no tenancy; adding it would be a rewrite.
- Ruflo has neither.

**Failure mode** Retrofitting authorization is effectively impossible; one forgotten predicate is a
cross-tenant leak.

**Chosen: (b) — a single `authorize(action, context) → allow | deny | escalate`, called at exactly
three sites (model call, tool call, memory write), with an in-tree default implementation.**

**Why** Cheap on day one, near-impossible later. Three return values, not two: `escalate` is what
makes human-in-the-loop a policy outcome rather than a special case wired into the tool layer.

**Tradeoffs** A single seam can become a bottleneck (mitigate: it must be synchronous and cheap;
expensive policy runs asynchronously and returns `escalate`). Risk of the interface becoming a
god-function — constrain it to a closed `Action` union.

**Migration path** External engines (OPA, a commercial governance product) implement the same
interface. **The harness must remain fully useful with the built-in implementation and no external
service.**

---

## D-04 · Postgres-first, SQLite-first, or both

**Alternatives** (a) Postgres required · (b) SQLite only · (c) One interface, both

**Evidence**
- QM requires Postgres and uses it *correctly* — `pg_try_advisory_lock`, `FOR UPDATE SKIP LOCKED`,
  `pg_advisory_xact_lock`, pg-boss (verified: 79/79 tests pass against a live instance). But you
  cannot run QM on a laptop without it.
- Hermes uses SQLite only and reaches further: it runs anywhere, including Termux. Its `doctor`
  detects a specific SQLite WAL-reset bug by source id — evidence of real production exposure.
- Ruflo uses SQLite + JSON and has the lowest barrier to first run.

**Failure mode** Postgres-only kills local/solo adoption. SQLite-only kills multi-worker deployment
(no real leader election, weaker concurrent writes).

**Chosen: (c). SQLite is the default and must be fully functional single-node; Postgres unlocks
multi-worker.**

**Why** The audit shows both markets are real and the *primitives are the same shape* — lease with
expiry, atomic claim, advisory lock. SQLite gives `BEGIN IMMEDIATE`; Postgres gives
`SKIP LOCKED` + advisory locks.

**Tradeoffs** Two implementations of the store interface, tested twice. Feature skew risk (mitigate:
one conformance suite run against both).

**Migration path** Export/import over the event log — Hermes already proves this pattern with
`hermes_state_portability.py`.

---

## D-05 · Queue vs actor model vs central scheduler

**Alternatives** (a) Central scheduler · (b) Work queue with stateless workers · (c) Actor model
with per-agent mailboxes

**Evidence**
- QM: (b) — `pg-boss` + `FOR UPDATE SKIP LOCKED` + leader-elected reaper. Verified working.
- Hermes: closest to (c) — long-lived in-process sessions, ThreadPool for tools. Works well
  single-user; no multi-worker story.
- Ruflo: none. Consensus code that *would* support (c) is never instantiated.

**Failure mode** Central scheduler = single point of failure. Actors = state lives in memory, so
process death loses it (exactly Hermes' limitation).

**Chosen: (b) — stateless workers leasing Runs from a durable queue.**

**Why** It is the only one of the three shapes that survives worker death without special handling,
because workers hold no state. It also makes horizontal scaling a non-event.

**Tradeoffs** Higher per-turn latency than an in-memory actor (a lease + projection load per turn).
Mitigate with a snapshot cache and worker affinity as an *optimisation*, never a correctness
requirement.

**Migration path** Worker affinity can be layered on later without changing the model.

---

## D-06 · Graph/DAG vs state machine vs plain loop

**Alternatives** (a) User-authored graph (LangGraph-style) · (b) Explicit state machine ·
(c) Plain loop with events

**Evidence**
- None of the three audited projects uses a graph. Hermes is a plain loop; QM delegates the loop;
  Ruflo orchestrates CLIs.
- Ruflo's GOAP A* planner — the closest thing to graph planning — operates over **8 booleans**
  (256 states) and drives demo UI cards (RUFLO-GOAP-009).

**Failure mode** Graphs make control flow explicit but push authors into modelling work the LLM is
already good at; they also make resume harder (which node? which edge? what partial state?).

**Chosen: (c) — plain loop, with the event log providing the structure a graph would otherwise
supply.**

**Why** Resume becomes "fold the log", not "reconstruct graph position". The audit gives zero
evidence that graph orchestration solved a failure any of these systems actually hit.

**Tradeoffs** No visual authoring; complex multi-step workflows are expressed as Tasks and subagent
Runs rather than nodes.

**Migration path** A graph engine can be built *on top* — nodes emit events into the same log.

---

## D-07 · File-based vs database memory

**Alternatives** (a) Files · (b) Database · (c) Split by memory kind

**Evidence**
- Hermes uses (c) and is the only project with a coherent memory story: episodic in SQLite,
  semantic behind a provider ABC, procedural (skills) as **files with provenance**, working memory
  derived.
- Ruflo uses SQLite + vectors for semantic memory and it **genuinely works** (verified: 0.73 on a
  lexically-disjoint query, HANDS-008).
- QM uses append-only Postgres revisions — durable and correct, but a single mechanism with no
  semantic retrieval.

**Failure mode** Everything-in-files ⇒ no transactional integrity, no query. Everything-in-DB ⇒
skills stop being human-editable and diffable, which kills the review workflow.

**Chosen: (c). Episodic → event log. Semantic → DB + vectors. Procedural (skills) → files with a DB
index. Working → derived.**

**Why** Skills specifically must stay files: they are prompt content that humans review, diff and
version. Hermes' `Trust`/`Source` columns (verified live) only make sense over reviewable artifacts.

**Tradeoffs** Two stores to keep consistent (mitigate: the DB holds an index, files hold truth;
reindex is always safe).

**Migration path** Reindex from files at any time.

---

## D-08 · MCP-first vs native tools

**Alternatives** (a) MCP only · (b) Native only · (c) Native core + MCP bridge

**Evidence**
- Hermes: 86 native tools with AST discovery, *plus* MCP server/client. Native tools get typed
  results, timeouts, per-tool approval gates and idempotency.
- QM: native primitives, with MCP as one of several tool transports (`in-process-mcp`, `mcp`).
- Ruflo: MCP-heavy; the advertised "423 tools" over-counts schema properties (RUFLO-COUNT-010).

**Failure mode** MCP-only means every tool crosses a process boundary — you lose typed errors,
in-process cancellation and cheap approval gating. Native-only forfeits a real ecosystem.

**Chosen: (c). Core tools native with declared `effects` and `idempotency`; MCP as a first-class
adapter.**

**Why** The audit shows both projects that took tools seriously (QM, Hermes) kept a native core.
Effects and idempotency declarations cannot survive an untyped bridge.

**Tradeoffs** Two registration paths; MCP tools have weaker guarantees. Make that visible — MCP
tools default to `effects: External`, requiring approval unless explicitly downgraded.

---

## D-09 · Container-per-run vs persistent sandbox

**Alternatives** (a) Fresh container per run · (b) Persistent per-project sandbox · (c) Pluggable

**Evidence**
- Hermes: (c) with 8–9 real backends (local, docker, ssh, modal, vercel, daytona, singularity),
  plus **git-shadow-repo checkpoints** for file state (L-03) — decoupling *file* recovery from
  *sandbox* lifecycle.
- QM: external sandboxes (Fly `sprites`, AWS). Powerful in its deployment; 12 tests fail without the
  binary — i.e. the dependency is load-bearing.
- Ruflo: relies on the wrapped CLI.

**Failure mode** Container-per-run is slow to start and loses warm state. Persistent sandboxes drift
and leak between runs.

**Chosen: (c) pluggable, with local as default and `snapshot`/`restore` in the interface.**

**Why** Hermes proves the abstraction holds across radically different backends. Putting
snapshot/restore *in the interface* is what lets file-state recovery work identically whether the
backend is a local directory or a remote VM.

**Tradeoffs** The lowest-common-denominator interface is small. Accept it — backends may expose
extras behind capability flags (same pattern as D-02).

---

## D-10 · Model abstraction: thin or thick

**Alternatives** (a) Thin (pass through to one SDK) · (b) Thick (normalise everything) ·
(c) Thin core + per-provider quirk shims

**Evidence**
- Hermes: (c), and it is the strongest model layer of the three — transports → adapters → provider
  profiles, 37 provider packages, with **named quirk shims** (`moonshot_schema.py`,
  `lmstudio_reasoning.py`) and inline workarounds carrying issue numbers.
- QM: model-agnostic *via harness choice* rather than its own provider layer.
- Ruflo: inherits whatever the wrapped CLI supports.

**Failure mode** Thin ⇒ provider quirks leak into agent logic. Thick ⇒ a normalisation layer that
lags every provider release and hides capabilities.

**Chosen: (c). A narrow core interface plus explicit, named, individually-testable quirk shims.**

**Why** Hermes' evidence is decisive: provider misbehaviour is *not* uniform and cannot be
abstracted away — only isolated. Naming each shim after the provider and the bug keeps them
reviewable and deletable when upstream fixes land.

**Tradeoffs** Shims accumulate. Mitigate: each shim carries the upstream issue link and is revisited
on provider version bumps.

---

## D-11 · Where skills live and who may write them

**Alternatives** (a) Human-authored only · (b) Agent-authored inline during a turn ·
(c) Agent-authored by a restricted reviewer, out-of-band

**Evidence**
- Hermes: (c). A forked agent, memory/skill-only tool whitelist, dangerous commands auto-denied,
  spawned **after** the response, best-effort, atomic writes with rollback and provenance
  (HERMES-LEARN-002). Trust/Source are user-visible (verified live).
- Vercel course: (a) — skills as human-written progressive disclosure.
- Ruflo: patterns written by counters; not reviewable prose.

**Failure mode** (b) lets the agent rewrite its own instructions mid-task — an obvious prompt-
injection amplifier. (a) means nothing is ever learned.

**Chosen: (c), plus the outcome measurement Hermes lacks (L-08).**

**Why** Hermes' four decisions are each correct: after-response (no attention competition),
restricted authority (cannot exceed its remit), best-effort (cannot break the turn), cache-inheriting
(cheap). What is missing is any signal about whether writes help.

**Tradeoffs** ~30K tokens per review turn (Hermes discloses this in a comment). Make it configurable
and default it **off** until outcome measurement exists — otherwise you are paying to accumulate
unvalidated text.

---

## D-12 · Fail-open or fail-closed on the security screener

**Alternatives** (a) Fail-open · (b) Fail-closed · (c) Configurable, always audited

**Evidence**
- QM: (a) with excellent hygiene — the audit action is literally
  `security_posture.tool_result_failed_open`, and content is prefixed *"[NOT security-screened…]"*
  (QM-SEC-004).
- Ruflo: fails open **silently** in three separate paths while status reports availability
  (RUFLO-SEC-008, L-20).

**Failure mode** Fail-closed makes a screener outage an availability outage. Fail-open makes a
screener outage a security outage. Silent either way is the worst case.

**Chosen: (c) — configurable per posture, with a **mandatory** `degraded` event regardless.**

**Why** QM demonstrates the tradeoff is legitimately deployment-dependent; what is *not* optional is
visibility. Making `degraded` a core event type means the choice is always observable.

**Tradeoffs** One more configuration knob. Justified: it is the difference between an availability
incident and a security incident, and operators must own that call.

---

## D-13 · Plugin architecture: in-process or out-of-process

**Alternatives** (a) In-process (import) · (b) Out-of-process (MCP/RPC) · (c) Both, by trust level

**Evidence**
- Hermes: in-process with a **plugin-override policy** preventing a pip package from hijacking a
  first-party tool (L-10) — a supply-chain consideration almost nobody makes.
- Hermes also runs **7 native postinstall builds** in Ruflo's case (largest supply-chain surface
  measured, HANDS-003) — the risk is real.

**Failure mode** In-process plugins can read secrets, patch the registry and crash the host.

**Chosen: (c). First-party and vetted plugins in-process; third-party out-of-process by default;
namespace collisions with built-ins refused outright.**

**Why** In-process is fast and simple; that is worth keeping for code you control. For code you do
not, process isolation is the only real boundary.

**Migration path** The registry records each tool's owner (Hermes' `_plugin_owner_of`), so moving a
plugin between trust levels is a config change.

---

## D-14 · Observability: bolt-on or intrinsic

**Alternatives** (a) Logging library · (b) OpenTelemetry · (c) Intrinsic — the event log *is* the
trace

**Evidence**
- QM: rich but assembled from three separate mechanisms (audit log, error log, tape) plus
  `recordLlmRequest` capturing TTFT, duration, gap phases and per-tool wall time.
- Hermes: excellent diagnostics (`doctor`), OTLP support, but **no audit log**.
- Ruflo: logs, plus status output that misreports state.

**Failure mode** Bolt-on observability is always incomplete, because someone must remember to
instrument each path — and the paths that matter most are the ones added under pressure.

**Chosen: (c). The event log is the primary trace; OTLP is an exporter over it.**

**Why** Every event is already recorded for correctness reasons (D-01), so tracing costs nothing
extra and cannot drift out of sync with behaviour. Status counters derive from `degraded` events, so
an inert path cannot report itself healthy (L-20).

**Tradeoffs** Event volume. Mitigate with sampling for high-frequency types — never for `degraded`,
`tool.*` or authorization decisions.

---

## D-15 · Multi-agent: explicit swarms or dynamic allocation

**Alternatives** (a) User declares a swarm/topology · (b) Runtime allocates workers dynamically ·
(c) Agent delegates, runtime schedules

**Evidence**
- Ruflo: (a), the most elaborate surface of the three (swarms, hive-mind, topologies, 108 agent
  definitions) — and `--consensus byzantine` persists as a **bare string** with no BFT state
  instantiated (verified at runtime, HANDS-007).
- Hermes: (c) — a `delegate` tool, git-worktree isolation, durable async delegation, per-turn caps.
  This one demonstrably works.
- QM: run-per-session; multi-agent is not its focus.

**Failure mode** Declared topologies force users to model coordination they cannot predict; the
elaborate version in this audit turned out to be decorative.

**Chosen: (c). The agent delegates via a tool; the runtime schedules child Runs. No user-visible
topology.**

**Why** Subagents are Runs with a `parent_run_id` (ARCHITECTURE §2.9), so they inherit leases,
recovery, audit, replay and budget for free — where Hermes needed a bespoke durable table. The
evidence for elaborate topologies solving a real problem is absent.

**Tradeoffs** No explicit swarm patterns. If a genuine need appears, express it as a Task template
that spawns child Runs — no new primitive required.

---

## D-16 · Surface: CLI-first, server-first, or chat-first

**Alternatives** (a) CLI · (b) HTTP server · (c) Chat platform · (d) CLI core + adapters

**Evidence**
- QM: chat-first (Slack, 34 files, 7,677 LOC). Deeply coupled — the single clearest over-reach in an
  otherwise disciplined codebase.
- Hermes: CLI-first with ~80 subcommands plus a gateway daemon for many platforms (67,894 LOC).
- Ruflo: CLI-first; good ergonomics ("Did you mean…?"), correct exit codes.

**Failure mode** Chat-first couples the core to one vendor's threading, identity and rate limits.

**Chosen: (d). A CLI over a library core; HTTP and chat as adapters.**

**Why** The CLI is the cheapest honest test of the core API, and it is what developers evaluate
first. Both CLI-first projects are pleasant to drive; the chat-first one cannot be run at all
without a Slack workspace.

---

## Summary — the load-bearing decisions

| # | Decision | One-way door? |
|---|---|---|
| D-01 | Event log as source of truth | **Yes** — decide at v0 |
| D-03 | Single authorization seam | **Yes** — 147 files to retrofit (QM's evidence) |
| D-05 | Stateless workers + durable queue | **Yes** — the state model depends on it |
| D-02 | Rent + own the loop | No — additive |
| D-04 | SQLite default, Postgres optional | No — one store interface |
| D-07 | Skills as files | No — reindexable |
| Others | | No |

Three one-way doors. Everything else can be deferred, and should be.
