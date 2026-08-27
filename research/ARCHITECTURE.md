# ARCHITECTURE — A Next-Generation Agent Harness, Derived From Primitives

This document does not start from a feature list. It starts by asking what the irreducible nouns
are, defines each one, then derives the relationships. Every definition is justified by evidence
from the audit (`FINDINGS.md`), usually by a failure that occurred when a project defined it
differently — or failed to define it at all.

**Working name:** the design is referred to as *the harness*. Naming is out of scope.

---

## 0. The one-paragraph thesis

Two of the three audited projects do not own their agent loop, and the one that does (Hermes) has
the weakest durable-state story. Loop ownership is commoditising; **durable, inspectable run state
is not.** The empty quadrant in the taxonomy (COMPARISON §3) — *own the state, rent the loop, expose
the boundary as a contract* — is where the value is. So the core primitive is not the agent, and not
the loop. **It is the Run: an append-only event log with a derived state projection.** Everything
else — context, memory, tools, subagents, approvals — is defined in terms of events on a Run.

---

## 1. What is the core primitive?

**The Run.** A Run is a durable, resumable, replayable unit of agent work, defined as:

```
Run = (identity, authorization context, an append-only Event log,
       a derived State projection, a lease)
```

**Why the Run and not the Agent.** In all three audited systems the "agent" is a bag of
configuration; what actually needs identity, ownership, recovery and audit is the *execution*.
QM already models this (`runs` table, lease, reaper, status) and is the only project that can answer
"the process died at step 17" (`notes/04-failure-recovery.md`). Hermes models the *session* instead,
and consequently can reload a transcript but cannot resume a state machine. Ruflo models neither and
loses in-flight work entirely.

**Why event-log-first.** Three capabilities that all three projects want, and only QM partially
achieves, fall out of an append-only log for free:
- **Replay** — QM built a separate tape mechanism (`harness/replay.ts`) to get this. With an event
  log it is inherent.
- **Audit** — QM built a separate audit log. Same.
- **Fork** — branching a run becomes "copy the log up to event N".

If state is the log's projection, then crash recovery is *rebuild the projection*, not *hope the
last write landed*.

---

## 2. The primitives, defined

### 2.1 Event
The atom. An immutable, ordered, typed record appended to exactly one Run.

```
Event = {
  run_id, seq,            // total order within a run
  type,                   // see the closed set below
  at,                     // wall clock
  causation_id,           // the event that caused this one
  payload                 // type-specific, JSON
}
```

The event types are a **closed set** — this is the whole vocabulary of the system:

| Category | Types |
|---|---|
| Lifecycle | `run.created` `run.leased` `run.lease_renewed` `run.paused` `run.resumed` `run.parked` `run.completed` `run.failed` |
| Turn | `turn.started` `turn.finished` |
| Model | `model.requested` `model.responded` `model.failed` |
| Tool | `tool.requested` `tool.authorized` `tool.denied` `tool.escalated` `tool.started` `tool.succeeded` `tool.failed` `tool.timed_out` |
| Context | `context.compacted` `context.retrieved` |
| Memory | `memory.written` `memory.retrieved` |
| Human | `human.requested` `human.responded` `human.timed_out` |
| Subagent | `child.spawned` `child.finished` |
| Degradation | `degraded` ← **mandatory for every fallback** |

The `degraded` event exists because of RUFLO-SEC-008 and RUFLO-RB-007: Ruflo silently falls back in
three separate paths while status reports the capability as available (L-06, L-20). Making
degradation a first-class event means an inert path **cannot** report itself healthy — status is
derived from counted effects, not configuration.

### 2.2 State
Not stored. **Derived** by folding the event log:

```
State = fold(Event[]) -> {
  status, messages[], pending_tool_calls[], budget_consumed,
  open_human_requests[], children[], degradations[]
}
```

**Rule: State is never the source of truth.** A cached projection may exist for speed (a `runs` row
with `status` and `lease_expires_at`, exactly as QM has), but it must be reconstructible by replaying
the log. This is the discipline that makes "resume at step 17" mean something precise.

### 2.3 Run
Identity + authorization context + log + lease.
```
Run = { id, parent_run_id?, scope: ScopeId, principal: PrincipalId,
        status, lease_expires_at?, worker_id?, attempts, error_attempts,
        budget: {tokens, wall_ms, tool_calls}, created_at }
```
`parent_run_id` makes subagents Runs rather than a separate concept (§2.9).

### 2.4 Task vs Run — a distinction all three projects blur
- **Task** — *what* should happen. Declarative, reusable, schedulable, idempotency-keyed.
- **Run** — *one attempt* at a Task. Has a lease, consumes budget, produces events.

One Task → many Runs (retry, fork, replay). Keeping these separate is what makes retry semantics
expressible: retrying re-runs the Task under a new Run with the same idempotency key. QM comes
closest (runs vs crons vs triggers); Hermes and Ruflo conflate them.

### 2.5 Agent
Deliberately demoted. An Agent is **configuration**, not a runtime object:
```
Agent = { id, system_prompt_ref, toolset[], model_policy,
          memory_policy, context_policy, authorization_profile }
```
Hermes' central design problem is a god-object `AIAgent` carrying 50+ mutable private attributes
through a 6,550-line loop (HERMES-LOOP-001). Making the Agent an immutable value and the Run the
mutable thing removes that failure mode by construction.

### 2.6 Tool
```
Tool = { name, schema, effects: ReadOnly | Mutating | External,
         authorize(ctx) -> Decision, execute(args, ctx) -> Result,
         idempotency: None | Key(args) }
```
`effects` is declared, not inferred — it drives approval policy without a hardcoded tool list.
`idempotency` is declared per tool so the runtime can safely re-issue after a crash (Ruflo has no
idempotency anywhere; QM has a store but not per-tool declarations).

### 2.7 Model
```
Model = { invoke(request) -> Response | Error, capabilities: Set<Capability>,
          context_window, cost_per_token, cache_boundary_support }
```
`capabilities` is lifted directly from QM's `HarnessAdapterProfile` (L-02) — the single most
transferable idea in the audit. Never pretend parity; declare the gaps.

### 2.8 Harness adapter (the rented loop)
```
HarnessAdapter = { profile: {id, transports, capabilities},
                   runTurn(TurnInput) -> TurnResult }
```
Directly QM's interface (`harness.ts:173-178`), which is validated by four real, structurally
different implementations. The harness *core* does not force you to use its own loop: a built-in
loop is the default adapter; Claude Agent SDK / Codex / OpenCode are others.

### 2.9 Subagent = a child Run
Not a separate abstraction. `parent_run_id` + its own scope-narrowed authorization context + its own
lease + optional filesystem isolation (git worktree, L-15). This means subagents inherit crash
recovery, audit, replay and budget accounting for free — where Hermes needed a bespoke durable
`async_delegations` table to approximate it.

### 2.10 Memory — four kinds, never one
The brief is right to insist these not be collapsed. Evidence: Hermes is the only project that keeps
them distinct, and it is the only one whose memory story is coherent.

| Kind | Content | Store | Lifetime |
|---|---|---|---|
| **Episodic** | what happened | the event log itself | run-scoped, archived |
| **Semantic** | facts about the world/user | vector + kv, scope-keyed | long-lived, mutable |
| **Procedural** | how to do things (skills) | versioned files, provenance-tracked | long-lived, agent-authored |
| **Working** | the current message window | derived projection | turn-scoped, disposable |

Working memory is a *view*, not a store. That single decision resolves most context-management
confusion: compaction becomes a re-projection with a `context.compacted` event, and the original is
never lost because the log is append-only.

### 2.11 Skill
```
Skill = { name, version, content, provenance: {author: human|agent, run_id?, at},
          trust: builtin|user|agent|hub, usage_stats, outcome_stats }
```
`outcome_stats` is the field **no audited project has** (L-08). Hermes tracks activity and prunes on
disuse; Ruflo tracks an EMA of caller-supplied flags. Neither can say whether a skill helped.

### 2.12 Human interaction — a first-class durable object
```
HumanRequest = { id, run_id, kind: approval|choice|input,
                 prompt, options?, created_at, expires_at,
                 status: pending|answered|expired, response? }
```
Not a blocked promise. A Run with an open `HumanRequest` is `paused`, its lease released, and it
consumes no worker. QM approximates this (durable approvals in Slack); a naive implementation holds
a process open for hours and loses everything on restart.

### 2.13 Sandbox
```
Sandbox = { exec(cmd, opts) -> Result, read(path), write(path, bytes),
            snapshot() -> Ref, restore(Ref), dispose() }
```
One interface, several backends (Hermes proves 8–9 is achievable; two is enough to prove the seam).
Note `snapshot`/`restore` in the interface — Hermes' git-shadow-repo (L-03) is one implementation.

### 2.14 Environment
The reconstructible part: `{ sandbox_ref, cwd, env_vars, mounted_secrets[], tool_availability }`.
Recorded in the log so a replay can reconstruct *why* a tool behaved as it did.

### 2.15 Worker
A process that leases Runs and executes turns. **Stateless and interchangeable** — all state is in
the log. This is what makes the reaper (L-01) safe: any worker can pick up any requeued Run.

### 2.16 Authorization decision
```
Decision = allow | deny(reason) | escalate(HumanRequest)
```
Three outcomes, not two. `escalate` is what makes human-in-the-loop a *policy result* rather than a
special case bolted onto the tool layer.

---

## 3. Relationships

```
Task ──1:N──> Run ──1:N──> Event ──fold──> State
                │
                ├── lease ──────> Worker (stateless, interchangeable)
                ├── scope ──────> Authorization context
                ├── parent ─────> Run            (subagents are Runs)
                ├── budget ─────> tokens / wall time / tool calls
                └── produces ───> HumanRequest, Memory writes, Skill writes

Agent (config) ──> supplies ──> system prompt, toolset, policies to a Run
HarnessAdapter ──> executes ──> one turn of a Run
Tool ──> declares ──> effects + idempotency ──> consulted by Authorization
Sandbox ──> hosts ──> tool execution ──> snapshot/restore into Environment
```

**The single invariant that everything else depends on:**
> Nothing mutates a Run except by appending an Event.

Every capability in the audit that any project struggled with — resume, replay, audit, fork,
double-execution, silent degradation — reduces to a violation of this invariant somewhere.

---

## 4. The control loop, concretely

```
lease(run) ──► loop:
  1. project State from Events since last snapshot
  2. assemble context      → emit context.compacted / context.retrieved if applicable
  3. authorize(model_call) → allow | deny | escalate
  4. invoke model          → emit model.requested / model.responded | model.failed
  5. parse tool calls
  6. for each: authorize(tool) → allow | deny | escalate(HumanRequest)
     ├─ escalate → emit human.requested, PAUSE (release lease), exit loop
     └─ allow    → emit tool.started → execute in Sandbox → tool.succeeded|failed|timed_out
  7. renew lease
  8. terminate? (no tool calls | budget exhausted | explicit finish | guardrail halt)
     ├─ no  → continue
     └─ yes → emit run.completed, release lease
```

Notes on specific decisions, each traceable to a finding:
- **Step 1 is a projection, not mutation** — removes Hermes' god-object problem (HERMES-LOOP-001).
- **Step 3 authorizes the model call too**, not just tools — budget and model-choice policy belong in
  the same seam.
- **Step 6's `escalate` releases the lease** — a run waiting on a human occupies no worker
  (contrast: a blocked promise, which loses everything on restart).
- **Step 7 renews the lease each iteration** — a dead worker's lease expires and the reaper reclaims
  the Run (L-01).
- **Steps 4–6 are what a `HarnessAdapter` may replace wholesale** when renting an external loop; the
  adapter then reports events back through the same log.

---

## 5. What is durable, what is derived, what is ephemeral

| | Contents | Store |
|---|---|---|
| **Durable (source of truth)** | Event log; Task definitions; Semantic + Procedural memory; Skills + provenance; HumanRequests; Sandbox snapshot refs | Postgres or SQLite |
| **Derived (rebuildable)** | Run State projection; working-memory window; vector indexes; the `runs` cache row; all status/telemetry counters | rebuild by fold/reindex |
| **Ephemeral** | Model connections; sandbox processes; in-flight HTTP; worker identity | lost freely on crash |

**Test for the design:** delete everything in the "derived" row and the system must fully recover by
replaying "durable". Neither Hermes nor Ruflo passes this test today; QM nearly does.

---

## 6. Context model — how context survives long tasks

Working memory is a **projection**, so context management is a *rendering* decision, applied in this
order each turn:

1. **Pin** the stable prefix (system prompt, agent config) and declare its boundary explicitly, so
   provider prompt caching actually hits (QM's `systemCacheBoundary`, L-14).
2. **Budget** by `(scope, model)` — never a global constant (QM's `contextTokenBudget`, L-14).
3. **Bound tool output at the source.** A 5,000-line file is truncated with a stored reference at
   write time, not at render time; the full result stays in the log and remains retrievable.
4. **Compact** the middle when over budget; emit `context.compacted` carrying the summary *and the
   range it replaced*, so the original can always be recovered from the log.
5. **Retrieve** relevant history/semantic memory (emit `context.retrieved` with the ids used) — this
   makes retrieval quality auditable after the fact.

Because every step emits an event, "why did the agent forget X?" is answerable from the log. In all
three audited projects, it is not.

---

## 7. Where the authorization seam sits

Exactly one function, consulted at exactly three places (model call, tool call, memory write):

```
authorize(action: Action, context: AuthzContext) -> allow | deny(reason) | escalate(HumanRequest)
```
```
Action      = { kind: "model"|"tool"|"memory", name, args_digest, effects }
AuthzContext= { principal, scope, run_id, posture, budget_remaining, environment }
```

**Why a single seam.** QM's tenancy is correct but threads through **147 files** (QM-SCOPE-006);
adding it later would be near-impossible. One narrow interface, called from three sites, is cheap on
day one and lets any policy engine — a local rules file, an OPA sidecar, or a commercial governance
product — implement it without touching the runtime. The default implementation ships in-tree and
depends on nothing external.

**Scope must be a branded type, not `string`** (L-12) — QM's one structural flaw, avoidable at zero
runtime cost:
```
type ScopeId<K extends ScopeKind = ScopeKind> = string & { readonly __scope: K }
```

---

## 8. Failure semantics, by class

| Failure | Behaviour |
|---|---|
| Worker dies mid-step | Lease expires → leader-elected reaper requeues (or parks past `maxAgeMs`) → a fresh worker rebuilds State from the log and continues. |
| Two workers claim one Run | Prevented by `FOR UPDATE SKIP LOCKED` on claim and compare-and-set on reclaim (`ifExpiredAt`). |
| Tool crashed after side effect | The log holds `tool.started` with no terminal event. On resume, `idempotency` decides: keyed → safe re-issue; unkeyed → escalate to a human. **Ambiguity is surfaced, never guessed.** |
| Model malformed / contract violation | `model.failed` + bounded retry; transcript repaired before the next call (orphan `tool_call_id` stubs, L-04). |
| Context overflow | Compaction; if still over, escalate rather than silently truncate. |
| Human never responds | `HumanRequest` expiry → `human.timed_out` → Run parks. No worker was held. |
| Screener/classifier unavailable | Configurable fail-open **or** fail-closed, and either way emit `degraded` (L-06). |
| Any fallback anywhere | `degraded` event is **mandatory**. Status counters derive from these, so an inert path cannot report itself healthy (L-20). |
| Store outage | Workers stop leasing; in-flight Runs' leases lapse; recovery is automatic when the store returns. |

---

## 9. What lives in core, what is a plugin, what is external

Decided by one test: *does the invariant in §3 depend on it?*

**Core** (small, boring, hard to change later): Event log + projection · Run/Task model · lease,
reaper, worker · the authorization seam · Tool registry with declared effects/idempotency · Model +
HarnessAdapter interfaces with capability sets · Sandbox interface · context projection ·
HumanRequest · replay.

**Plugins** (behind a core interface): concrete model providers · concrete sandbox backends ·
semantic-memory backends · content screeners · policy engines · skill stores · surfaces
(CLI/HTTP/Slack) · observability exporters.

**External services** (never vendored): Postgres/SQLite · vector databases · secret managers ·
container/VM providers · governance products.

**Explicitly not built** (all present in Ruflo, all unreachable there): consensus protocols ·
custom RL training · learned model routing · symbolic planners.

---

## 10. Why this is not "QM + Hermes + Ruflo"

The brief warns against a Frankenstein of feature lists. This design takes **one structural idea**
and derives the rest:

> *The Run is an event log; state is its projection; nothing mutates a Run except by appending.*

From that single commitment, capabilities the audited projects each built **separately** become
consequences rather than features:

| Capability | How QM/Hermes got it | Here |
|---|---|---|
| Crash recovery | QM: bespoke lease + reaper + status column | fold the log |
| Replay | QM: a separate tape subsystem | inherent |
| Audit | QM: a separate audit log | inherent |
| Fork | QM: bespoke fork provenance | copy log to seq N |
| Subagents | Hermes: a bespoke durable `async_delegations` table | a Run with a parent |
| Degradation visibility | nobody | a mandatory event type |
| Skill effectiveness | nobody | join `context.retrieved` to `run.completed` |

That last row is the point. Because skill injection and run outcome are both events in the same
ordered log, measuring whether a skill helped is a **query**, not a subsystem — and it is the one
capability none of the three audited projects has (L-08).
