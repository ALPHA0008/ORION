# OPEN QUESTIONS

Unresolved questions, separated by kind. Each states why it matters, what evidence exists today, and
the specific experiment that would reduce uncertainty. Questions are ordered within each section by
how much they would change the architecture if answered differently.

Kinds: `ENGINEERING UNKNOWN` (we could find out by building/measuring) ·
`RESEARCH UNKNOWN` (nobody has solved it) · `PRODUCT UNKNOWN` (depends on users) ·
`ECONOMIC UNKNOWN` (depends on cost/market dynamics)

---

# RESEARCH UNKNOWNS

## R-01 · Does agent-authored skill accumulation actually improve outcomes?
**Why it matters.** This is the pivotal question for the whole "self-improving agent" category, and
it is the capability I identified as the clearest opportunity for differentiation (L-08). If the
answer is no, the background-review loop is an expensive way to accumulate unread text, and
ARCHITECTURE §2.11's `outcome_stats` becomes the feature rather than a supporting detail.

**Evidence today.** Genuinely thin, in a specific way: Hermes has built the most sophisticated loop
of the three (a forked reviewer with restricted authority, atomic writes, provenance —
HERMES-LEARN-002) and **still cannot answer this**. `skill_usage.py` tracks activity counts and
timestamps and prunes on *disuse*, not on *value*. `evals/` covers only browser_use, compaction and
readtool. Ruflo's "improvement" metric is `mean(quality) − 0.5` against a hardcoded constant. So:
two serious attempts, zero measurement. **No project in this audit has evidence either way.**

**Experiment.** Take a fixed task suite (50–100 tasks with mechanical pass/fail — SWE-bench-style or
internal). Run arm A with skill writing disabled, arm B with it enabled. After N sessions, re-run
the *original* suite with both skill libraries and compare pass rates. Then ablate: for each
frequently-injected skill, re-run with it removed. Cost: a few hundred dollars of inference.
**This is the single highest-value experiment in this document.**

## R-02 · Is compaction lossy in ways that change task outcomes?
**Why it matters.** Every project hand-rolls compaction and none can prove it preserves what
matters. If compaction reliably drops load-bearing detail, then retrieval-over-full-log (which the
event log makes possible — ARCHITECTURE §6) should be the default rather than the fallback.

**Evidence today.** Hermes has a dedicated `evals/compaction` suite — the only compaction evaluation
found anywhere in the audit — plus `compression_locks` to prevent concurrent compaction (verified
live). QM compacts per scope and model. Neither publishes a fidelity measure.

**Experiment.** Construct tasks whose success depends on a fact introduced early and needed late,
varying the distance. Measure success against context pressure with (a) truncation, (b)
summarisation, (c) retrieval from the full log. The crossover point tells you the default.

## R-03 · Can prompt-injection screening be made reliable enough to fail *closed*?
**Why it matters.** D-12 leaves fail-open/fail-closed configurable because the evidence does not
support a default. If classifiers were reliable, fail-closed becomes the obvious default and the
whole quarantine/release apparatus simplifies.

**Evidence today.** QM's screener is the most serious attempt seen: a dedicated prompt that
explicitly distinguishes business data from exfiltration, refuses to return `dangerous`, and feeds a
genuine quarantine with human release (QM-SEC-004). But QM chose to **fail open**, which is itself
evidence about the authors' confidence in classifier availability. No false-positive/false-negative
rates are published by anyone.

**Experiment.** Build a labelled corpus of benign tool outputs and injection attempts; measure FP/FN
for the QM prompt against a modern model. A false-positive rate under ~1% on benign business data
would make fail-closed viable.

---

# ENGINEERING UNKNOWNS

## E-01 · What is the real per-turn cost of event-log projection?
**Why it matters.** D-01 is a one-way door. If folding a log costs materially more per turn than
reading a row, long runs degrade and the design needs snapshotting from v0 rather than as an
optimisation.

**Evidence today.** None measured. QM's projection-equivalent (a `runs` row) is O(1), but it pays
for that with three separate mechanisms for audit/replay/state. Hermes' loop reloads and mutates a
god-object each turn and is visibly not fast, though for unrelated reasons.

**Experiment.** Synthesise runs of 10 / 100 / 1,000 / 10,000 events. Measure fold time against
SQLite and Postgres. Determine the snapshot interval where p99 turn overhead stays under ~50 ms.
Cheap; do it before writing the store.

## E-02 · Does a lease-per-turn model add unacceptable latency versus a long-lived process?
**Why it matters.** D-05 chose stateless workers over Hermes' in-process actor style. That buys
crash recovery and pays in per-turn overhead (lease renew + projection load).

**Evidence today.** QM does exactly this and its test suite is not slow, but tests are not turns.
Hermes' in-process model is certainly lower-latency per turn and certainly loses in-flight state on
death (`notes/04-failure-recovery.md`).

**Experiment.** Measure end-to-end turn latency for both shapes against a mock model. If the delta
exceeds ~100 ms, add worker affinity as an optimisation — but keep correctness independent of it.

## E-03 · Can `snapshot`/`restore` be implemented uniformly across sandbox backends?
**Why it matters.** ARCHITECTURE §2.13 puts snapshot/restore in the Sandbox interface. If remote
backends cannot support it cheaply, the interface fragments into capability flags and file recovery
stops being uniform.

**Evidence today.** Hermes proves the *execution* interface generalises across 8–9 backends, but its
checkpointing is **git-based on the host**, not a sandbox primitive (L-03) — i.e. it deliberately
avoided this problem. QM's Fly `sprites` backend is opaque here.

**Experiment.** Implement `snapshot`/`restore` for local (git shadow repo) and Docker (commit or
volume snapshot) and compare cost and semantics. If they diverge badly, demote snapshot to a
capability flag.

## E-04 · Do tool-level idempotency declarations survive contact with real tools?
**Why it matters.** ARCHITECTURE §2.6 relies on per-tool `idempotency` to decide, after a crash,
whether a `tool.started` with no terminal event can be safely re-issued. If most real tools are
honestly "unknown", the runtime escalates constantly and the mechanism adds ceremony without safety.

**Evidence today.** No audited project declares tool effects or idempotency at all. QM has an
idempotency *store* but not per-tool declarations; Hermes and Ruflo have neither. So this is
untested design, not a validated pattern — **flagging it as the least-evidenced decision in
ARCHITECTURE.**

**Experiment.** Classify Hermes' 86 tools by hand into `ReadOnly / Mutating+keyed / Mutating+unkeyed
/ External`. If more than roughly a third land in "unkeyed", the crash-resume story needs rethinking.

## E-05 · How large does a working set have to be before ANN beats brute force here?
**Why it matters.** Determines whether a vector index belongs in core at all, or whether brute-force
cosine over a bounded working set is sufficient for years.

**Evidence today.** Unusually good on this one. Ruflo has a genuinely correct HNSW implementation
(RUFLO-HNSW-006), benchmarks it at **N=1,000** — below the useful crossover — and its own docs
retract a prior "150x–12,500x" claim, stating ~1.9x at N=20k. That is a strong hint that for typical
per-scope memory sizes, brute force is fine.

**Experiment.** Measure recall@k and latency for brute force vs HNSW at N = 1k / 10k / 100k with
384-dim vectors on commodity hardware. Adopt an index only past the measured crossover.

## E-06 · Can the event vocabulary express loops written by other people?
**Why it matters.** D-02 rents external loops. If Claude Agent SDK / Codex / OpenCode cannot be
mapped onto the closed event set (ARCHITECTURE §2.1), adapters produce lossy logs and replay breaks
for exactly the loops users most want.

**Evidence today.** QM's four adapters normalise into a common `HarnessTurnResult`, which is
encouraging — but that type is much coarser than an event log, and QM keeps per-adapter
`transcriptFormat` strings precisely because the shapes differ.

**Experiment.** Write adapters for two external harnesses; attempt full replay from the log alone.
Whatever cannot be reconstructed defines the honest limit of `capabilities`.

---

# PRODUCT UNKNOWNS

## P-01 · Do developers actually want durable/resumable runs, or is it an enterprise-only need?
**Why it matters.** Durability is the central bet (D-01, D-05) and it costs real complexity. If solo
developers do not care, the harness optimises for a market it will not reach first.

**Evidence today.** Genuinely mixed, and worth stating honestly:
- *For*: QM invested heavily and is the only project that can answer "process died at step 17".
- *Against*: Hermes has the largest user base and community of the three (3,048 author emails,
  5,000+ commits/month) **without** run-level durability. Its users evidently tolerate re-running.
- Ruflo has none and still ships.

So the market signal currently favours "users tolerate no durability". The counter-argument is that
Hermes' users are mostly interactive, where a human notices and retries — and that agents running
unattended (cron, CI, background) are exactly where the category is heading.

**Experiment.** Instrument a prototype: how often do real runs die mid-execution, and how much work
is lost? If it is rare and cheap, durability is a v1 feature, not a v0 one.

## P-02 · Is renting the loop a feature or a smell to users?
**Why it matters.** D-02 makes external harnesses first-class. Users may read "we wrap Claude Code"
as "this is a thin wrapper" — the reputational problem Ruflo now has.

**Evidence today.** QM rents four loops and is the most substantial system in the audit; Ruflo rents
one and is the thinnest. So the *architecture* does not determine perception — what you own around
the loop does. But that nuance is hard to communicate on a README.

**Experiment.** Positioning test, not an engineering one. Ship with the built-in loop as the visible
default and external adapters as an advertised capability, then observe which users adopt which.

## P-03 · Will anyone accept a ~30K-token-per-turn background reviewer?
**Why it matters.** D-11 defaults skill writing to **off** partly for this reason.

**Evidence today.** Hermes ships it enabled and documents the cost in a source comment — which is
either confidence or an unexamined default; the audit cannot distinguish. No adoption data is
observable.

**Experiment.** Instrument opt-in rate and measure whether users who enable it keep it on after a
month of billing.

---

# ECONOMIC UNKNOWNS

## C-01 · Does provider prompt caching change the optimal context strategy?
**Why it matters.** If cached prefixes are ~10x cheaper, the economics favour long stable prefixes
and *less* aggressive compaction — inverting conventional context-management advice.

**Evidence today.** QM takes this seriously enough to thread `systemCacheBoundary` through its
harness interface (L-14), which implies measured benefit. No numbers are published.

**Experiment.** Measure cost per successful task at three compaction aggressiveness levels, with and
without an explicit cache boundary.

## C-02 · Is model routing worth building once you have real traffic?
**Why it matters.** I recommend **not** building learned routing (LESSONS, avoid #3). That
recommendation is based on Ruflo's execution, not on the idea being unsound.

**Evidence today.** Ruflo's router is a *real* trained KRR model with honest provenance — but
trained on **40 rows**, gated behind an env flag that is off, and its inference engine
(`@metaharness/router`) is not installed (RUFLO-ROUTER-004). The published "89% accuracy" is
**unreproducible** — no held-out set, split, or script found. So the evidence refutes *this
implementation*, not the concept.

**Experiment.** Log `(task_features, model_used, outcome, cost)` for real traffic. After ~10k rows,
test whether a simple classifier beats "always use the strong model" on cost-per-success. Note the
ordering: **collect data first, then decide** — the inverse of what Ruflo did.

## C-03 · What is the true cost-per-successful-task across these systems?
**Why it matters.** The brief's Phase 10 asks for exactly this, and it is the number that would most
change a build-vs-adopt decision.

**Evidence today.** **None.** This is the largest gap in the audit: no model credentials were
available, so no live runs, no token counts, no latency, no cost. I reported no numbers rather than
estimating them.

**Experiment.** Run the brief's Task A–E suite against all three with credentials, controlling for
model. Report cost per *successful* task, not per token — the token-count comparison is meaningless
across systems that use different models and different numbers of internal calls.

---

# Questions this audit closed

Recorded so they are not re-opened:

| Question | Answer | Evidence |
|---|---|---|
| Does Ruflo's SONA learn? | **No.** The LoRA `B` matrix is never written; the transform is provably the identity function. | Executable proof, `evidence/benchmarks/sona_identity_proof.mjs` |
| Is Ruflo's consensus real? | **The code is; the product is not.** Correct Raft/PBFT/Gossip, zero tests, never instantiated — `--consensus byzantine` persists as a bare string. | Source + runtime verification (HANDS-007) |
| Is Ruflo's memory real? | **Yes, genuinely good.** Cross-process persistence and true semantic search (0.73 on a lexically-disjoint pair). | Executed (HANDS-008) |
| Is QM's harness swapping real? | **Yes.** Four adapters, four distinct transports, honestly declared capability gaps. | `harness.ts` + 4 `defineHarness` sites |
| Is QM's command policy enforcement or convention? | **Enforcement**, with depth-8 recursive shell parsing against ~20 evasion techniques. | `command-policy.ts:66-115` |
| Does QM prevent cross-scope reads? | **At the query layer, yes; at the type layer, no** (`ScopeId = string`). | `postgres-memory-service.ts` vs `types.ts:15` |
| Does Hermes author skills from experience? | **Yes** — a forked reviewer with restricted authority, auto-run each turn. | `background_review.py`, `turn_finalizer.py:795-810` |
| Does Hermes measure whether that helps? | **No.** Activity counts only. | `skill_usage.py` |
| Are Hermes' seven terminal backends real? | **Mis-scoped claim.** 8–9 real *sandbox* backends; **no** tmux/screen/pty anywhere. | `tools/environments/` |
| Is Ruflo's mTLS real? | **No** — and `rejectUnauthorized: false` appears in 10+ shipped locations. | Repo-wide search |
