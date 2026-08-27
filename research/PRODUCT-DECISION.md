# PRODUCT DECISION

**Date:** 2026-08-27 · **Phase:** proof-before-build
**Inputs:** `VALIDATION.md`, `ARCHITECTURE-REVISION.md`, `proof/01`–`proof/06`, and the prior audit
(`FINDINGS.md`, `COMPARISON.md`, `LESSONS.md`).

---

# Decision

## **BUILD — MODIFIED**

…with one condition that is not negotiable and one scope change that is significant.

**The condition:** the build proceeds to a **validation release**, not a product launch. Experiment 5
(developer validation) was **not run** — I have no access to human participants — and it gates four
of the ten hypotheses, including the one the whole product rests on. **Building past V0 without
running it would be building on an untested premise.**

**The scope change:** V0 ships as a **library plus CLI around a 529-line durable core**, not the
5,000–7,000-LOC harness the spec described. The experiments showed the differentiating machinery is
an order of magnitude smaller than planned, and that everything else in the original V0 list is
ordinary engineering that can wait for evidence of demand.

---

## Why not the other three answers

**Why not BUILD (unmodified).** Five architecture decisions changed under experiment, two of them
breaking (`ARCHITECTURE-REVISION.md` R-1, R-2, R-4). The original spec would have shipped a state
projection that **fails its own latency target on Postgres at 100k events** (p99 = 100.26 ms vs a
50 ms target) and a tool-recovery contract that **cannot express the safety of the most-used tool**.
Both passed every functional test. Shipping the original design as written was never the right call.

**Why not STOP.** The pre-registered kill criteria for the architecture were:
*projection overhead material* · *storage excessive* · *event normalization destroys external
fidelity* · *event sourcing dramatically harder to use without benefit*. **None fired.**
Append is 12 µs and flat to 1M events; storage is 171 B/event; extension mode preserves 54/56
external fields; and 529 lines buys resume + replay + fork + explain. The technical thesis held.

**Why not PIVOT (to a debugger/replay tool).** This is a live possibility and I want to be
explicit that the evidence does not yet exclude it. Two facts point at it: replay and explain work
on **externally-executed** runs (Exp 3), which is exactly a debugger's value proposition and needs
no durable runtime; and Hermes — the largest user base in the audit — has **no run-level
durability** and its users tolerate re-running. **The pivot trigger is pre-registered** in
`proof/05-developer-validation/PROTOCOL.md` §7: *developers use replay/explain but ignore resume.*
Until Experiment 5 runs, PIVOT cannot be chosen or excluded on evidence — so the decision is to
build the thing that can test both.

---

# What the evidence actually established

| | Verdict | Key measurement |
|---|---|---|
| Event log is the right primitive | **SUPPORTED** | 12 µs append, flat to 1M events; 171 B/event |
| Projection is cheap enough | **SUPPORTED — after correction** | 10.2 KB state at 1M events; p99 0.07 ms (was 100 ms unbounded) |
| Kill → resume works | **SUPPORTED** | real SIGKILL at 23 events → reaper requeue → different process completes correctly |
| Replay works | **SUPPORTED** | exact, repeatable, point-in-time, and on externally-executed runs |
| Fork works | **SUPPORTED** | provenance recorded, source unmutated, filesystem divergence verified |
| Renting the loop works | **PARTIAL** | control flow yes; **tool-level recovery impossible** (`tool.started=0`) |
| Tool recovery is practical | **PARTIAL** | original contract refuted; replacement verified 3 ways in situ |
| Small durable core | **SUPPORTED** | **529 LOC** vs a 5,000–7,000 estimate |
| **Anyone wants it** | **UNRESOLVED** | **no developer has been shown it** |

44/44 acceptance assertions pass, including all five V0 gates from the spec.

---

# V0 scope (revised)

**Ship this, and nothing else.**

| In | Why |
|---|---|
| Event log on SQLite + **bounded** projection | R-1; the core primitive |
| Run / Task, lease, reaper, single worker | proven by real SIGKILL test |
| Built-in tool loop, **one** real model provider | must replace the scripted model before any demo |
| 6 tools with per-invocation `recovery()` + `verify()` | R-2/R-3, verified in situ |
| `authorize() → allow \| deny \| escalate`, local default | 18 lines, all branches exercised |
| Local sandbox + git shadow-repo checkpoints | stolen from Hermes (L-03) |
| `HumanRequest` that survives process death | E1–E8 |
| **resume · replay · fork · explain** | the product |
| Mandatory `degraded` events + derived status | F1–F5; the anti-Ruflo property |
| **No-progress detection** | R-5; ~20 lines |
| CLI + `doctor` | the evaluation surface |

**Cut from the original V0 list:** Postgres, multi-worker, external harness adapters, MCP, semantic
memory, skills, subagents, screening, multiple providers. All were already out of the spec's V0 or
are now deferred pending demand evidence.

**Explicitly deferred despite working:** the Claude Agent SDK adapter. It proved the thesis
(Exp 3) but ships with a weaker guarantee (turn-level recovery), and shipping it in V0 would invite
users onto the degraded path first.

**Estimated remaining work:** the core exists (529 LOC, tested). Real provider integration,
CLI, doctor, error handling, packaging and docs ≈ **3–4 weeks**.

---

# Killer feature

**Time travel for agent runs** — and specifically the four-in-one framing, because that is what the
experiments actually demonstrated:

> Kill the process → it resumes. Replay any run exactly. Fork at the step that went wrong and try a
> different path without re-paying for the first seventeen steps. Explain every decision, including
> every denial and every degradation.

No audited system does all four. QM has the strongest partial set and needed **three separate
mechanisms** (run status + audit log + replay tape); it still cannot fork mid-run cheaply. Here they
are one mechanism in 529 lines.

**The demo that carries it** (Exp 4 tests B and D, both passing today):
`start → kill -9 → restart → it continues → fork at the bad step → different branch.`

---

# Target developer

Ranked by how likely the evidence says they are to care.

1. **Primary — engineers running agents unattended** (cron, CI, queues, background jobs, multi-hour
   tasks). Nobody is watching when these fail, so "just re-run it" costs real money and real time.
   This is the only segment where H-01's premise is plausibly strong.
2. **Secondary — engineers debugging non-deterministic agents.** Replay and explain serve them
   *even without durability*, and this is the segment that would justify the PIVOT.
3. **Explicit non-target — interactive coding-agent users.** A human is present, notices the
   failure, and retries. `FINDINGS.md` shows Hermes serves this segment at scale with no durability
   at all. **Do not build for them.**

---

# First distribution channel

**A single repository with a 90-second terminal recording at the top of the README** showing the
kill/resume/fork sequence — not an architecture diagram, not a feature list.

Then, in order: (1) direct outreach to the 20–30 developers in the Experiment 5 recruitment quota —
this is distribution and validation at once; (2) a written post about the *findings*, not the
product — "we measured what happens to agent state when the process dies" is more credible and more
interesting than a launch; (3) communities where unattended-agent operators already are.

**Not:** Product Hunt, HN launch, or anything optimising for stars. `LESSONS.md` is explicit that
stars are not a quality signal, and the same logic applies to our own metrics.

---

# Initial positioning

**Lead with:** *"Replay and fork any agent run"* (variant D) or *"Time travel for AI agents"*
(variant B).

**Reasoning, offered as a prediction to be falsified rather than a conclusion:** A ("durable agent
runtime") and E ("the runtime for long-running autonomous agents") name a *category* the listener
must already believe in. B and D name a *capability* they can picture. C ("agents that survive
crashes") is the risk case — it presumes crashes are a felt problem, which is precisely the
unvalidated H-01.

The 5-way test is specified in `proof/05-developer-validation/PROTOCOL.md` §6. **Positioning should
be chosen by that test, not by this paragraph.**

---

# First 90 days

**Days 1–20 — make the prototype real.**
Replace the scripted model with one real provider. Apply R-1 (bounded projection — already in the
prototype), R-2/R-3 (recovery contract — already in), R-5 (no-progress detection — new). Add CLI +
`doctor`. Harden errors. Write the README recording.
*Exit gate:* a stranger can `install → run → kill → resume → fork` in under 10 minutes.

**Days 21–35 — close the largest technical gap.**
Multi-worker contention (D-05 is argued, not demonstrated). Measure `synchronous=FULL` cost.
Copy-on-write fork. These are the top three items in `ARCHITECTURE-REVISION.md` §Residual risk.
*Exit gate:* two workers, one queue, no double-execution, under load.

**Days 36–65 — RUN EXPERIMENT 5. This is the decision point.**
20–30 developers, the protocol as written, thresholds pre-registered.
*Exit gate:* the pre-registered decision rule fires — BUILD, BUILD-MODIFIED, PIVOT or STOP.

**Days 66–90 — act on the result, not on the plan.**
- STRONG/MODERATE on installs + ≥3 unprompted time-travel uses + ≥2 unattended runs → continue:
  second provider, external adapter (with declared `recovery_granularity: 'turn'`), Postgres.
- Replay/explain used, resume ignored → **PIVOT** to an agent debugger/trajectory inspector. The
  Exp 3 result (replay and fork work on *externally-executed* runs) means this pivot is cheap: the
  adapter becomes the product and the runtime becomes optional.
- WEAK/NEGATIVE and "I just re-run it" is the modal answer → **STOP**, publish the research, and
  the 529-line core stands as a reference implementation.

---

# What would make me change this decision

Stated in advance, so it cannot be rationalised later:

| Finding | New decision |
|---|---|
| Instrumented crash rate in real runs is ≈0 | **STOP** — the problem does not occur |
| Developers use replay/explain, ignore resume | **PIVOT** — build the debugger |
| Multi-worker contention proves unsafe under load | halt; fix D-05 before anything else |
| A second adapter also lacks `tool.started` | own-loop becomes the *only* supported path; drop "rent the loop" from positioning |
| ≥8/25 install and ≥5 use time travel unprompted | **BUILD** in full; accelerate |

---

# The final question

> *If you had never seen QM, Hermes, or Ruflo — but had only observed the problems they encounter —
> would you independently arrive at this architecture?*

**Mostly yes, and the experiments sharpened which parts are genuinely derived versus inherited.**

**Independently derivable from the problems alone:**
- *An agent run is long, expensive, and can die mid-flight* → you need durable, resumable run state.
  Once you require "resume at step 17", you need an ordered record of what happened, and once you
  have that, replay/fork/explain are nearly free. **The event log is a derivation, not a borrowing.**
- *A dead process cannot release its own claim* → leases with expiry and a sweeper. All three
  audited projects converged on leases independently, which is itself evidence of necessity.
- *A crash between an effect and its record is ambiguous* → some per-invocation recovery contract is
  forced. Experiment 2 shows the *shape* is not obvious (I got it wrong first), but the *need* is.
- *A human in the loop must not pin a process for hours* → pause must release the lease.

**Inherited, and I checked rather than assumed:**
- **Capability sets on adapters** (QM's `capabilities: ReadonlySet`) — I would probably have
  pretended parity and discovered the problem the hard way. Kept because Exp 3 immediately needed
  it to express `recovery_granularity: 'turn'`.
- **Git-as-checkpoint-store** (Hermes L-03) — clean reuse, no reason to reinvent. **Genuinely
  inherited; still correct.**
- **`degraded` as a mandatory event type** — this is a *reaction* to Ruflo, not a derivation.
  Without having watched a project report "Neural Network Status (Real) — Active" for a provably
  inert code path, I would not have made degradation a first-class, non-optional event. It survives
  because Exp 4 F1–F5 shows it costs nothing and makes status honest by construction.

**Removed as unnecessary imitation, on evidence:**
- **The closed event vocabulary.** That was imitation of a clean abstraction rather than a response
  to a problem. Exp 3 refuted it: 33 field kinds lost, including cost. Payloads are now extensible.
- **The 50 ms p99 target.** Inherited from the spec with no basis. Measurement showed it too loose
  by three orders of magnitude — loose enough to have hidden the R-1 defect.
- **The 5–7k LOC V0.** An estimate anchored on how big QM and Hermes are, not on what the job
  requires. It is 529 lines.

**The one part I would not have arrived at independently, and which the audit earned:** the
insight that **loop ownership and state ownership are separable**, and that the interesting quadrant
is *own the state, rent the loop*. That came from noticing that two of three audited projects do not
own their loop. Experiment 3 then showed the trade-off is real and asymmetric — you keep replay and
fork, you lose tool-level recovery — which is a sharper claim than the audit could make.

---

# Honest statement of what this decision rests on

**Proven by experiment:** the architecture works, it is fast, it is small, and five specific things
about it were wrong and are now fixed.

**Not proven by anything:** that a single developer wants it.

That asymmetry is the entire reason the decision is *BUILD — MODIFIED* and the plan is
*build to validate*, rather than *build to launch*. The strongest argument against this project
remains the one recorded in `NEXT-HARNESS-SPEC.md` §29.20 and unchanged by this phase: **the largest
agent user base in the audit runs on a harness with no durability at all, and those users cope.**
Experiment 5 exists to find out whether that is a gap in the market or a verdict on it.
