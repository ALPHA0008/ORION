# Phase 9 — The Vercel Minimal Harness as Baseline

Source: https://vercel.com/academy/build-ai-agent-harness — **reachable**, fetched 2026-08-26T12:55Z.
No substitution required.

The course builds **TeensyCode**: 38 lessons across 11 modules. Stack: AI SDK (`ToolLoopAgent`,
`pruneMessages`), AI Gateway (model routing), Vercel Sandbox / just-bash, Zod v3.

**Methodological note:** I did not build TeensyCode in this environment (no model credentials —
see `00-log.md`). I used the published curriculum as the *reference decomposition* of a minimal
harness. The comparisons below are structural (does the repo have this component, and what does it
add) rather than behavioural.

---

## 1. The baseline: what the course says a harness minimally is

| # | Module | Primitive established | Failure it answers |
|---|---|---|---|
| 1 | The Agent Loop | tool-calling loop; 7 tools (`read`,`grep`,`write`,`edit`,`bash`,`task`,`askUser`) | a chatbot cannot see or change the world |
| 2 | Tool Design | descriptions as contracts (WHEN TO USE / WHEN NOT / EXAMPLES); approval gates | the model calls the wrong tool, or a dangerous one |
| 3 | The System Prompt | structured prompt (Agency, Guardrails, Ambiguity) + `AGENTS.md` injection | the agent loses its instructions on long tasks |
| 4 | The Sandbox Abstraction | one interface (`readFile`, `exec`, `stop`), swappable backends | execution is unsafe and non-portable |
| 5 | Context Management | `pruneMessages`, bounded tool output, cache control | a 5,000-line file stays in context forever |
| 6 | Subagent Delegation | Explorer / Executor roles, isolated context | one context cannot hold everything |
| 7 | Sandbox Lifecycle | state machine, snapshot/restore, durable workflows | sandboxes die; work is lost |
| 8–11 | HITL, Planning/Verification, Surfaces, Extensibility | `askUser`, verification gates, events, skills, custom tools | wrong-but-confident output; single UI; closed system |

**The minimum, per the course:** a tool loop + a real toolset + safety gates + context management +
a swappable sandbox interface. Everything else is elaboration.

**The course's own stated design principle** is the most valuable thing in it:
> "Each step exists because the previous one broke something."

That is exactly the test the brief asks me to apply. Anything in the three repos that cannot be
traced to a broken previous step is a candidate for unnecessary complexity.

---

## 2. What each project adds on top of the minimum

### Legend
Justified = maps to a concrete failure mode I can name and that the code visibly responds to.

---

### QM — adds the **organisation** layer

| Addition | Failure mode solved | Complexity introduced | Justified? |
|---|---|---|---|
| **Harness adapter interface** (`harness.ts:173`, 4 transports) | Vendor lock-in; the course's loop *is* the AI SDK. If that SDK stalls or a better agent ships, you rewrite. | 5 adapters, ~360 KB, capability-parity matrix | **Yes** — and the `capabilities: Set` is how to do it honestly |
| **Scope/tenancy** (`scope_id` predicate on every query) | The course harness is single-user. An org agent leaking one team's memory into another's is fatal. | scope threading through 147 files | **Yes** |
| **Security postures + floor composition** (`security-posture.ts:36`) | One config for a whole org is either too tight or too loose; a sub-scope must not be able to weaken the org. | 3 postures × 2 levers | **Yes** |
| **Command policy shell parser** (911 L, depth-8 recursion) | Course teaches "safety gates" as a boolean/function. A determined model (or injected instruction) escapes a regex via heredoc/ANSI-C/pipe-to-shell. | 911 L, ~20 evasion defences | **Yes** — this is the gap between a demo gate and a real one |
| **Content screening classifier** | Course has no answer for prompt injection arriving *inside tool output*. | an LLM call per screened payload; latency; fail-open path | **Yes**, with a caveat (fail-open, QM-SEC-004) |
| **Durable runs: leases + reaper + advisory locks** | Course Module 7 *discusses* durable workflows; QM implements them. Process dies at step 17 → lease expires → reaper requeues or parks. | Postgres mandatory; pg-boss; leader election | **Yes** — the single biggest real gap in the baseline |
| **Record/replay tape** (`replay.ts`, `tape-fold.ts`) | Agent behaviour is nondeterministic; you cannot regression-test it without capture. | tape storage, shadow/serve modes | **Yes** |
| Slack as primary surface (34 files) | — | couples core to one vendor | **Partly** — Module 10 "Surfaces" anticipates this, but QM's is deep |

**Verdict:** QM adds almost nothing I cannot map to a failure mode. Its additions are *governance
and durability*, which is precisely what the course explicitly leaves out. The one genuine
over-reach is depth of Slack coupling.

---

### Hermes — adds the **longitudinal** layer

| Addition | Failure mode solved | Complexity introduced | Justified? |
|---|---|---|---|
| **9 execution environments** (local, docker, ssh, modal, vercel, daytona, singularity, managed) | Course ships 2 backends and says "swappable". Real users need HPC (singularity), remote hosts (ssh), managed cloud. | 8,785 L; per-backend quirks | **Yes**, though `daytona`/`managed_modal` are thin |
| **37 provider packages, 3-tier model abstraction** | Course pins AI Gateway. Providers each misbehave differently. | transports + adapters + profiles = ~13.6 K L | **Yes** — and the quirk shims are battle damage, not bloat |
| **Background review fork** (`background_review.py`, 82 KB) | Course skills are *authored by humans*. Nothing captures what the agent learned this session. | ~30 K tokens/turn; a second agent; whitelist enforcement | **Yes** — but unmeasured (HERMES-LEARN-002) |
| **Git-based checkpoints** (`checkpoint_manager.py`, 2,236 L) | Course snapshot/restore is sandbox-level. File-level undo after a bad edit needs diffs. | a bare shadow git repo per project | **Yes** — elegant; reuses git instead of inventing a format |
| **Subagent git worktrees** (`subagent_worktree.py`) | Course subagents share a filesystem; parallel writers collide. | worktree lifecycle | **Yes** |
| **Durable async delegation** (`async_delegations` table) | Course `task` tool is in-memory; a restart loses spawned work. | SQLite table + reconciliation | **Yes** |
| **8 memory backends behind one ABC** | Cross-session recall; no single vendor wins. | 8 plugins; honcho alone 8,494 L | **Partly** — 8 is more than any user needs; 2–3 would prove the abstraction |
| **FTS5 search + portability export** | Recall across thousands of sessions; machine migration. | 115 KB + 37 KB | **Yes** |
| 21,665-line `cli.py`; 6,550-line loop body | — | enormous blast radius | **No** — this is accumulated debt, not a capability |

**Verdict:** Hermes' additions are overwhelmingly justified and grounded in real user contact. Its
problem is not *what* it added but *how it is organised*. The 4:1 fix:feat ratio (GIT-008) is the
price of a 6,550-line loop body.

---

### Ruflo — adds the **claimed** layer

| Addition | Failure mode it *claims* to solve | Actually solves it? |
|---|---|---|
| **SONA "neural self-learning"** | agent doesn't improve with experience | **No** — LoRA B matrix is permanently zero; transform is provably identity (RUFLO-SONA-001) |
| **Byzantine/Raft/Gossip consensus** | distributed agents disagree / nodes are faulty | **Real code, unreachable** — CLI stores the flag as a string tag; zero tests (RUFLO-CONSENSUS-005) |
| **RL suite (DQN/PPO/A2C)** | learn optimal action policies | **Real code, zero callers** (RUFLO-NEURAL-003) |
| **KRR model router** | pick the cheapest adequate model | **Real weights, absent inference engine** — `@metaharness/router` not installed; env flag off (RUFLO-ROUTER-004) |
| **HNSW vector memory** | fast semantic recall at scale | **Real index**, benchmarked at N=1,000 — below the ANN/brute-force crossover (RUFLO-HNSW-006) |
| **ReasoningBank** | reuse past reasoning | **Loop genuinely closes**, but embeddings silently degrade to a string hash (RUFLO-RB-007) |
| **Zero-trust mTLS federation** | untrusted peers | **mTLS refuted**; `rejectUnauthorized:false` in 10+ shipped locations (RUFLO-SEC-008) |
| **GOAP A\* planner** | multi-step task planning | **Real A\***, over 8 booleans, driving demo UI cards (RUFLO-GOAP-009) |

**Verdict:** Ruflo is the clearest illustration of the course's principle *violated*. Its additions
are not responses to a previous step breaking — most cannot be traced to any failure the system
actually encountered. The consensus code is the exception: genuinely good, and orphaned.

---

## 3. What the baseline itself gets wrong (or leaves out)

Testing the course against what the three repos learned the hard way:

1. **Durability is treated as a Module-7 discussion, not a primitive.** Every real deployment hits
   process death. QM's lease+reaper is ~200 lines of concept; it belongs near the core, not in the
   penultimate module.
2. **No authorization seam.** The course has approval gates (is this action allowed *now*, by a
   human) but no notion of *who* is asking and *what scope* they may touch. QM shows that
   retrofitting tenancy is invasive — 147 files.
3. **No observability primitive.** Neither trace, nor replay, nor cost accounting appears until
   "Extensibility". QM's tape and `recordLlmRequest` show these want to be built in from step 1.
4. **Context management is presented as pruning.** All three real systems found that pruning alone
   is insufficient: Hermes has compression + FTS5 retrieval + memory providers; QM has per-scope
   per-model budgets + cache boundaries. "Prune old results" is the beginning, not the answer.
5. **Skills are static.** The course treats skills as progressive disclosure of human-written text.
   Hermes' background review shows the interesting version is agent-authored — and also shows the
   hard part is *measuring whether it helped*, which nobody has solved.

---

## 4. The complexity ledger (Phase 11 input)

| Capability | Value | Complexity | New failure surface | Verdict |
|---|---|---|---|---|
| Tool loop + toolset | essential | low | — | **Core** |
| Sandbox interface | essential | low-med | backend drift | **Core** |
| Context pruning/compaction | essential | med | lossy summaries | **Core** |
| Approval gates | essential | low | — | **Core** |
| Command policy parser (QM) | high | med (911 L) | false denials | **Core** — for any shared deployment |
| Durable runs (QM) | high | med-high (Postgres) | ops burden | **Core** for servers, **plugin** for laptops |
| Scope/tenancy (QM) | high | high (cross-cutting) | leak = fatal | **Core if multi-user**, cannot be retrofitted cheaply |
| Model abstraction (Hermes) | high | med-high | quirk drift | **Core**, thin; providers as **plugins** |
| Record/replay (QM) | high | med | storage | **Core** — enables all testing |
| Git checkpoints (Hermes) | high | low | repo bloat | **Core** — cheap, reuses git |
| Subagent isolation (Hermes) | high | med | lifecycle bugs | **Core** |
| Content screening (QM) | med-high | med + latency | fail-open | **Plugin** with a core seam |
| Background review (Hermes) | med-high | med (30K tok/turn) | unmeasured drift | **Plugin** — until effectiveness is measurable |
| Memory providers (Hermes ×8) | med | high | 8 code paths | **Plugin** — core keeps one ABC |
| Consensus (Ruflo) | **low** for a harness | very high | untested distributed bugs | **Out of scope** |
| Neural routing/SONA (Ruflo) | **negative** as shipped | very high | silent no-op | **Do not build** |
| GOAP planner (Ruflo) | low | low | — | **Do not build** — LLM planning beats an 8-bool A\* |

---

## 5. Answering the brief's Phase-9 question directly

> *What does each real project add on top of this minimum, and what concrete failure mode does each
> addition solve?*

- **QM** adds what breaks when *many people share one agent*: tenancy, policy, audit, durability.
  Nearly every addition is traceable to a failure mode. Score: high signal, low waste.
- **Hermes** adds what breaks when *one person uses an agent for a year*: provider quirks,
  cross-session memory, self-authored skills, checkpointing, subagent isolation. Also high signal —
  its waste is structural (file sizes), not conceptual.
- **Ruflo** adds what sounds like it would break: distributed consensus, neural adaptation, learned
  routing. Most of it cannot be mapped to an encountered failure, and the flagship item is
  provably inert. Score: low signal, high waste — with a genuinely good consensus implementation
  stranded inside it.
