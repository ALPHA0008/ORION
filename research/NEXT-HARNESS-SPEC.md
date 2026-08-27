# NEXT-HARNESS-SPEC

A specification for a next-generation open-source agent harness, derived from the audit of QM,
Hermes and Ruflo (`FINDINGS.md`) and the primitives in `ARCHITECTURE.md`.

This is deliberately **not** "QM + Hermes + Ruflo". It takes one structural commitment and derives
the rest. Where a section rests on thin evidence, it says so.

---

## 28.1 Design goals

In priority order. Later goals yield to earlier ones when they conflict.

1. **A run is never lost and always explicable.** Any run can be resumed, replayed, forked and
   audited from its log. *Rationale:* only QM answers "the process died at step 17"
   (`notes/04-failure-recovery.md`), and it needed three separate mechanisms to do it.
2. **Nothing degrades silently.** Every fallback emits a `degraded` event; status derives from
   counted effects, never configuration. *Rationale:* Ruflo silently degrades in three paths while
   reporting "Active — Real" (HANDS-006, L-20).
3. **Authorization is a seam, present from commit one.** *Rationale:* QM's tenancy is correct and
   touches 147 files; retrofitting is not feasible (QM-SCOPE-006).
4. **Runs on a laptop with zero services; scales to a cluster without a rewrite.** *Rationale:* QM
   needs Postgres + Fly.io and cannot be evaluated casually; Hermes runs anywhere and has the users.
5. **Rent the loop, own the state.** *Rationale:* the empty quadrant (COMPARISON §3).
6. **Small core, honest edges.** Capability sets over pretended parity (L-02).

## 28.2 Non-goals

Stated so scope creep is a visible violation, not a drift.

- **Not** a distributed-systems platform. No consensus protocols. *(Ruflo has correct Raft/PBFT/
  Gossip that nothing instantiates — RUFLO-CONSENSUS-005.)*
- **Not** an ML training system. No RL, no gradients, no learned routing in core. *(Ruflo's DQN is
  correct and has zero callers; its KRR router's inference engine is uninstalled.)*
- **Not** a planner. No GOAP/A*/HTN. *(Ruflo's planner searches 8 booleans to drive UI cards.)*
- **Not** a chat product. No Slack/Discord in core. *(QM's 34-file Slack coupling is its clearest
  over-reach.)*
- **Not** a model provider aggregator competing with Hermes' 37 packages. Providers are plugins.
- **Not** a multi-tenant SaaS. The *seam* supports tenancy; the product is a library and a CLI.

## 28.3 Core primitives

Full definitions in `ARCHITECTURE.md` §2. In brief:

`Event` (immutable, ordered, closed type set) · `State` (a fold of events, never stored as truth) ·
`Run` (identity + authz context + log + lease) · `Task` (declarative; 1 Task → N Runs) ·
`Agent` (immutable config, not a runtime object) · `Tool` (declares `effects` + `idempotency`) ·
`Model` / `HarnessAdapter` (both carry `capabilities: Set`) · `Sandbox` (exec + snapshot/restore) ·
`Memory` (episodic / semantic / procedural / working — four kinds, never one) ·
`Skill` (versioned file + provenance + **outcome_stats**) · `HumanRequest` (durable, not a promise) ·
`Worker` (stateless) · `Decision` (`allow | deny | escalate`).

**The invariant everything rests on:** *nothing mutates a Run except by appending an Event.*

## 28.4 Control loop

```
lease(run) ──► loop:
  1. project State from events since last snapshot
  2. assemble context        → context.compacted / context.retrieved
  3. authorize(model call)   → allow | deny | escalate
  4. invoke model            → model.requested / model.responded | model.failed
  5. parse tool calls        → repair transcript if malformed        (L-04)
  6. per tool: authorize()   → allow | deny | escalate
       escalate → human.requested, RELEASE LEASE, exit loop
       allow    → tool.started → sandbox exec → tool.succeeded|failed|timed_out
  7. renew lease
  8. terminate? → run.completed, release lease
```

Two details that differ from all three audited systems: **step 6's escalate releases the lease** (a
run awaiting a human consumes no worker), and **steps 4–6 are exactly what a `HarnessAdapter`
replaces** when renting an external loop, reporting back through the same event vocabulary.

## 28.5 State model

| Class | Contents | Recovery |
|---|---|---|
| **Durable** | event log · Task definitions · semantic + procedural memory · skills + provenance · HumanRequests · sandbox snapshot refs | source of truth |
| **Derived** | Run State · working-memory window · vector indexes · `runs` cache row · all status counters | rebuild by fold / reindex |
| **Ephemeral** | model connections · sandbox processes · in-flight HTTP · worker identity | discarded on crash |

**Acceptance test:** delete everything derived; the system recovers fully by replaying durable
state. Neither Hermes nor Ruflo passes this today; QM nearly does.

## 28.6 Context model

Working memory is a **projection**, so context handling is a rendering decision applied per turn:
pin the stable prefix and declare its boundary (prompt caching actually hits) → budget by
`(scope, model)` → bound tool output *at write time*, storing a retrievable reference → compact the
middle, emitting `context.compacted` with the range it replaced → retrieve, emitting
`context.retrieved` with the ids used.

Because each step is an event, *"why did the agent forget X?"* is answerable. In none of the three
audited systems is it.

## 28.7 Memory model

| Kind | Content | Store | Written by |
|---|---|---|---|
| Episodic | what happened | the event log | the runtime |
| Semantic | facts about world/user | KV + vectors, scope-keyed | agent + user |
| Procedural | skills | versioned files + DB index | restricted reviewer (D-11) |
| Working | current window | derived projection | nobody — it is a view |

Two rules from evidence: **skills stay files** (human-reviewable, diffable — Hermes' Trust/Source
columns only make sense over reviewable artifacts, D-07), and **origin-tag every message at
creation** (`user`/`agent`/`system`/`synthetic`) so harness bookkeeping never pollutes durable
personal memory (L-17, generalising Hermes' `_INTERNAL_GATEWAY_TURN_RE`).

## 28.8 Tool model

```
Tool = { name, schema,
         effects: ReadOnly | Mutating | External,
         idempotency: None | Key(args),
         authorize(ctx) -> Decision,
         execute(args, ctx) -> Result }
```
- **Registration:** native in-process for first-party; MCP as a first-class adapter, defaulting to
  `effects: External` (D-08). Namespace collisions with built-ins are refused outright (L-10).
- **Authorization:** `effects` drives policy — no hardcoded dangerous-command lists.
- **Execution:** in a Sandbox, with timeout and process-group kill.
- **Observation:** every call produces `tool.requested → authorized|denied|escalated → started →
  succeeded|failed|timed_out`.
- **Recovery:** a `tool.started` with no terminal event is resolved by `idempotency` — keyed ⇒ safe
  re-issue; unkeyed ⇒ **escalate to a human**. Ambiguity is surfaced, never guessed.

*Evidence caveat:* no audited project declares effects or idempotency per tool, so this is the
least-validated part of the design (OPEN-QUESTIONS E-04).

## 28.9 Scheduling

Stateless workers lease Runs from a durable queue (D-05). Claim via `FOR UPDATE SKIP LOCKED`
(Postgres) or `BEGIN IMMEDIATE` (SQLite) — both idioms verified working in QM (79/79 tests against
live Postgres).

| Operation | Mechanism |
|---|---|
| Schedule | insert Task; cron via a durable queue |
| Queue | `runs` table, status + priority |
| Pause | `escalate` or explicit — **lease released** |
| Resume | any worker leases and rebuilds State from the log |
| Cancel | `run.failed(cancelled)`; the worker observes on next lease renewal |
| Retry | new Run for the same Task, same idempotency key |
| Reclaim | leader-elected reaper: lease expired → requeue, or **park** past `maxAgeMs` (L-01) |

## 28.10 Event system

Events are the source of truth (D-01), the audit log, the trace, and the replay tape — one
mechanism where QM needed three. Persisted append-only, `(run_id, seq)` unique, with periodic
snapshots for fold cost (OPEN-QUESTIONS E-01).

Subscribers: the projection folder; observability exporters (OTLP over the log, D-14); the skill
outcome recorder; surfaces streaming to a UI. Sampling is permitted for high-frequency types but
**never** for `degraded`, `tool.*`, or authorization decisions.

## 28.11 Failure semantics

| Class | Behaviour |
|---|---|
| Worker death | lease expiry → reaper → requeue \| park; fresh worker folds the log and continues |
| Double claim | `SKIP LOCKED` on claim; compare-and-set (`ifExpiredAt`) on reclaim |
| Tool crashed post-side-effect | `idempotency` decides: keyed ⇒ re-issue; unkeyed ⇒ escalate |
| Malformed model response | `model.failed` + bounded retry; transcript repaired (orphan `tool_call_id` stubs) before the next call |
| Context overflow | compact; if still over, escalate — never silently truncate |
| Human never responds | `HumanRequest` expiry → `human.timed_out` → park. No worker was held. |
| Screener unavailable | configurable open/closed per posture; **`degraded` emitted either way** (D-12) |
| Any fallback | `degraded` is **mandatory**; status counters derive from it (L-20) |
| Store outage | workers stop leasing; leases lapse; automatic recovery when the store returns |

## 28.12 Sandbox

One interface — `exec`, `read`, `write`, `snapshot`, `restore`, `dispose` — with backends behind
capability flags. v0 ships **local** (with a git shadow repo for snapshot/restore, L-03) and
**docker**. Hermes proves 8–9 backends is achievable; two proves the seam.

## 28.13 Model abstraction

Thin core interface + explicit, named, individually-testable **quirk shims** (D-10) — the pattern
Hermes arrived at after 13,220 fix commits. Each shim names the provider and the bug, links the
upstream issue, and is revisited on version bumps. `capabilities: Set` on every model and adapter;
never pretend parity (L-02).

## 28.14 Plugin architecture

| Layer | Contents |
|---|---|
| **Core** | event log + projection · Run/Task · lease/reaper/worker · authorization seam · tool registry · Model + HarnessAdapter interfaces · Sandbox interface · context projection · HumanRequest · replay |
| **Plugin** | model providers · sandbox backends · semantic-memory backends · content screeners · policy engines · skill stores · surfaces · observability exporters |
| **External** | Postgres/SQLite · vector DBs · secret managers · container providers · governance products |

Trust boundary (D-13): first-party in-process; third-party out-of-process by default.

## 28.15 Multi-agent coordination

**The runtime allocates; users do not declare swarms.** A subagent is a Run with a `parent_run_id`,
its own narrowed authorization context, its own lease, and optional git-worktree isolation (L-15).

*Why:* Ruflo has the most elaborate topology surface in the audit (swarms, hive-mind, `--consensus
byzantine`) and it is **decorative** — verified at runtime, it persists a string and instantiates
nothing (HANDS-007). Hermes' simpler delegate-tool model demonstrably works. Making subagents Runs
means they inherit recovery, audit, replay and budget for free, where Hermes needed a bespoke
durable table.

## 28.16 Human-in-the-loop

`HumanRequest` is a durable object, not a blocked promise (ARCHITECTURE §2.12). A paused Run
releases its lease and occupies no worker. `escalate` is one of three `Decision` outcomes, so
human review is a *policy result* rather than a special case bolted onto the tool layer. Requests
expire; expiry parks the Run rather than losing it.

## 28.17 Evaluation

Replay is intrinsic (the log *is* the tape), so:
- **Regression tests** replay recorded runs against changed code and diff the event streams.
- **Benchmarks** are Task suites with mechanical pass/fail; report **cost per successful task**,
  never per token (cross-system token counts are meaningless — Phase 10 note).
- **Skill effectiveness** is a query, not a subsystem: join `context.retrieved` (which skills were
  injected) to `run.completed` (outcome). **This is the capability no audited project has** (L-08).
- **Assert effects, not absence of exceptions** (L-18) — enforced as a review rule, since
  `.resolves.not.toThrow()` is precisely what let a flagship no-op ship in Ruflo.

## 28.18 Observability

Automatic for every run, with no instrumentation effort: full event log; per-turn token, latency and
cost; TTFT and per-tool wall time (QM already captures these — `harness.ts:27-40`); every
authorization decision; every `degraded` event; and a **status surface derived from counters of work
actually done**, so an inert path cannot report itself healthy.

Plus a `doctor` command seeded at v0 and extended by **one check per incident, forever** (L-16) —
the single best DX artifact in the audit.

## 28.19 Security

| Concern | Design |
|---|---|
| Identity | `Principal` (human or service), carried in every `AuthzContext` |
| Scope | **branded type**, not `string` — `ScopeId<K extends ScopeKind>` (fixes QM's one structural flaw, L-12) |
| Capabilities | tools declare `effects`; policy binds effects to postures |
| Postures | composed as a **floor** — a narrower scope may only raise, never lower (L-13) |
| Secrets | referenced, never inlined into events; masked in logs |
| Sandbox | the execution boundary; distinct from authorization, never conflated |
| Shell | if offered at all, parse rather than regex, with recursive extraction (L-05) — and default to **allowlist**, not QM's permissive one-rule denylist |
| Authorization seam | `authorize(action, context) -> allow \| deny \| escalate` at exactly three call sites |

## 28.20 Governance-provider compatibility (technically neutral)

The seam is a single function:

```
authorize(action: Action, context: AuthzContext) -> Decision
Action       = { kind: "model" | "tool" | "memory", name, args_digest, effects }
AuthzContext = { principal, scope, run_id, posture, budget_remaining, environment }
Decision     = allow | deny(reason) | escalate(HumanRequest)
```

Properties that keep it neutral:
- **The default implementation ships in-tree** and depends on no external service. The harness must
  be fully useful with it — a harness that is a disguised client for one policy vendor is a
  liability, not a product.
- The interface names no vendor and carries no vendor-specific fields.
- It is synchronous and cheap; expensive evaluation runs asynchronously and returns `escalate`.
- Any provider — a local rules file, an OPA sidecar, or a commercial governance product such as
  KernlBase — implements the same three-valued function.
- The event log already records every decision, so an external provider gains audit for free.

*Note on the brief's framing:* I have kept this section vendor-neutral by construction rather than
by assertion. The strongest guarantee of neutrality is that the in-tree default is good enough for
production single-tenant use, which is the design above.

## 28.21 Minimal implementation (V0)

The smallest thing that is genuinely a harness *and* genuinely differentiated. Target: ~5–7k LOC.

**In:** event log on SQLite + projection · Run/Task + lease + single-process reaper · a built-in
tool loop for one provider · 6 tools (`read`, `write`, `edit`, `grep`, `bash`, `ask_user`) with
declared effects · `authorize()` seam with a default rules implementation · local sandbox + git
shadow-repo checkpoints · context pinning/budget/bounded tool output · `HumanRequest` with pause and
resume · replay from log · `degraded` events + derived status · CLI · `doctor`.

**Out of V0:** semantic memory, skills, subagents, Postgres, external harness adapters, MCP,
multi-worker, screening.

**V0 acceptance tests** — the whole point of the release:
1. Kill the process mid-run; restart; the run resumes and completes.
2. Replay a recorded run; the event stream matches.
3. Fork a run at event N; both branches complete independently.
4. A tool escalates; the process exits; the human answers a day later; the run resumes.
5. Every fallback path emits `degraded`, verified by a test that greps for un-evented fallbacks.

## 28.22 V1 and the 12-month architecture

**V1 (+3–6 months):** Postgres store + multi-worker + leader-elected reaper · subagents as child
Runs with worktree isolation · semantic memory behind one provider interface (start brute-force; add
an index only past the measured crossover, E-05) · skills as files with provenance **and
outcome_stats from day one** · MCP adapter · 2–3 model providers with named quirk shims · one
external harness adapter (proving D-02/E-06) · HTTP surface.

**12 months:** the core should be *smaller* than at V1, not larger — capabilities pushed out to
plugins as their interfaces stabilise. Expected shape: a stable event vocabulary (v1 frozen);
2–3 store backends behind a conformance suite; a plugin ecosystem for providers/sandboxes/memory;
a policy-provider ecosystem over the authz seam; and a **public benchmark harness reporting
cost-per-successful-task** — which, if the ecosystem adopts it, is the most likely thing here to
become a standard.

The honest risk: cores grow. The countermeasure is the acceptance test in §28.5 plus a rule that
nothing enters core without a named failure mode it fixes — the Vercel course's principle
("each step exists because the previous one broke something"), applied as a merge gate.

## 28.23 Killer feature

**Time-travel for agent runs.**

Because the Run *is* an append-only log, four things come as one capability:
- **Resume** — process dies, work continues.
- **Replay** — re-run any historical run deterministically against changed code.
- **Fork** — branch a run at event N and try a different path.
- **Explain** — answer "why did it do that?" from the log, including every authorization decision
  and every degradation.

No audited project has all four. QM has the strongest partial set and needed three separate
mechanisms (audit log + replay tape + run status) to get there. For Hermes and Ruflo, "resume" means
reloading a transcript.

**The demo that sells it:** kill the process mid-task, restart, watch it continue; then `fork` the
run at the tool call that went wrong and take a different branch — without re-paying for the first
seventeen steps.

## 28.24 Why an experienced engineer would choose this

Not "more features". A specific answer per alternative:

- **vs QM** — you get the durability and the authorization seam without mandatory Postgres, Fly.io
  and Slack. QM is excellent and effectively unevaluable on a laptop; 12 of its sandbox tests cannot
  run without a Fly binary.
- **vs Hermes** — you get resumability and replay, which Hermes does not have, and a core you can
  actually fork. Hermes' loop body is 6,550 lines with state on a god-object; its 13,220-vs-3,307
  fix:feat ratio is the visible cost. *(Hermes remains the better choice today for a single-user
  agent with maximum provider coverage — that should be said plainly.)*
- **vs Ruflo** — everything advertised executes, and anything that degrades says so.
- **vs LangGraph** — you do not write the loop, and durability is not something you assemble from
  checkpointers; resume/replay/fork/explain are one mechanism, not four integrations.
- **vs OpenHands** — a library-first core with an authorization seam, rather than a product with an
  agent inside it.
- **vs building on a model SDK** — the SDK gives you a loop. It gives you nothing for process death,
  approval that outlives a process, audit, replay, or multi-tenancy. Those are the parts that take a
  year to get right, and the audit shows exactly how each project got them wrong.

## 28.25 What NOT to build — even if competitors ship it

1. **Consensus protocols.** (Ruflo: correct, untested, never instantiated.)
2. **Custom RL / gradient training.** (Ruflo: correct DQN, zero callers.)
3. **Learned model routing before you have traffic.** (Ruflo: 40 training rows; inference engine not
   installed; "89%" unreproducible.) Log first, decide later.
4. **Symbolic planners.** (Ruflo: A* over 8 booleans driving UI cards.)
5. **Deep chat-platform integration in core.** (QM's clearest over-reach.)
6. **Eight backends for one abstraction.** Two proves the seam; the rest are plugins.
7. **A visual workflow builder.** Nothing in the audit suggests it solves a real failure.
8. **Your own vector database.** External service.
9. **A "neural" anything you cannot prove changes weights.** The SONA lesson, generalised.
10. **Self-reported benchmark numbers.** Publish the harness and the methodology, or publish nothing.

---

# 29. Final decision

Direct answers, no hedging.

1. **Core primitive?** The **Run** — an append-only event log with a derived state projection.
2. **Execution model?** Stateless workers leasing Runs from a durable queue; leader-elected reaper.
3. **Durable state?** Event log, Tasks, semantic + procedural memory, skills + provenance,
   HumanRequests, sandbox refs. Everything else is derived or ephemeral.
4. **Delegated externally?** Storage (SQLite/Postgres), vectors, secrets, containers, policy
   providers, model providers.
5. **In core?** Event log + projection, Run/Task, lease/reaper/worker, authorization seam, tool
   registry with declared effects, Model/HarnessAdapter/Sandbox interfaces, context projection,
   HumanRequest, replay.
6. **In plugins?** Providers, sandbox backends, memory backends, screeners, policy engines, skill
   stores, surfaces, exporters.
7. **Explicitly not built?** Consensus, RL, learned routing, planners, chat platforms, vector DBs,
   visual builders.
8. **10 ideas to borrow?** LESSONS "10 worth stealing" — lease/reaper quartet; capability-declaring
   adapters; git shadow-repo checkpoints; transcript repair; record/replay; named-degradation
   events; restricted-authority reflection fork; policy-as-floor; incident-seeded `doctor`; shell
   parsing over regex.
9. **10 not to borrow?** LESSONS "10 worth avoiding" — in-harness consensus; custom RL; premature
   learned routing; symbolic planners; silent fallbacks; `ScopeId = string`; multi-thousand-line loop
   bodies; eight backends per abstraction; `not.toThrow()` as a mutation test; permissive-by-default
   policy.
10. **Smallest architecture that can beat existing projects?** §28.21 — roughly 5–7k LOC, whose
    single differentiator is that resume/replay/fork/explain fall out of one mechanism.
11. **Killer feature?** Time-travel for agent runs (§28.23).
12. **What makes engineers switch?** Killing the process mid-task and watching it resume — then
    forking the run at the step that went wrong.
13. **V0?** §28.21, gated on five acceptance tests.
14. **V1?** §28.22 — Postgres/multi-worker, subagents as child Runs, semantic memory, skills with
    outcome_stats, MCP, an external harness adapter.
15. **12-month architecture?** A *smaller* core, a stable frozen event vocabulary, plugin ecosystems
    for providers/sandboxes/memory/policy, and a public cost-per-successful-task benchmark.
16. **Highest-risk assumptions?**
    (a) that event-log projection is fast enough per turn (E-01);
    (b) that developers actually want durability — **the market signal currently argues against it**,
    since Hermes has the most users and no run-level durability (P-01);
    (c) that the event vocabulary can express other people's loops (E-06);
    (d) that per-tool idempotency declarations are tractable (E-04) — the least-evidenced decision
    in the whole design.
17. **Test before committing?** In order: E-01 (fold cost — cheap, do it first), E-04 (classify
    Hermes' 86 tools by hand), E-06 (write one external adapter and attempt full replay), P-01
    (instrument how often runs actually die).
18. **Genuine differentiation vs repackaging?** *Differentiation:* the event log as the single
    mechanism behind resume/replay/fork/explain; mandatory degradation events; skill-effectiveness
    as a query. *Repackaging (and honestly so):* leases and reapers (QM), capability sets (QM), git
    checkpoints (Hermes), transcript repair (Hermes), quirk shims (Hermes).
19. **Could become ecosystem standards?** The event vocabulary for agent runs; the three-valued
    `authorize()` seam; cost-per-successful-task as the benchmark unit. The first two are the ones
    worth proposing publicly.
20. **Strongest argument against building this?**

    **That durability is a solution looking for a problem, and the market has already voted.**
    Hermes has the largest user base and community of the three, sustained 3,000–6,000 commits a
    month, and **no run-level durability** — its users evidently tolerate re-running failed tasks.
    QM built durability properly and is, on public evidence, a two-author project 28 days old with
    mandatory Postgres. If interactive use dominates, a human simply notices the failure and retries,
    and the entire event-log commitment (which is a one-way door, D-01) buys complexity for a
    problem users absorb for free.

    The counter-argument is that this is a bet on where the category goes rather than where it is:
    unattended agents — cron, CI, long background tasks, multi-hour work — are exactly the cases
    where nobody is watching, and there durability is not a nicety. But that is a **bet**, not a
    finding, and P-01 is the experiment that should settle it before the one-way door is walked
    through.
