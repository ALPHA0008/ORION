# VALIDATION — Hypothesis Register and Results

**Phase:** proof-before-build · **Date:** 2026-08-27
**Environment:** Windows 11 26100 · Node v24.18.0 · `node:sqlite` · Postgres 16 (Docker) · Python 3.13.15
**Rule applied throughout:** evidence before architecture. Every verdict below names the experiment
that produced it, or says plainly that no experiment was possible.

**Labels:** `SUPPORTED` · `PARTIALLY SUPPORTED` · `REFUTED` · `UNRESOLVED`

---

## Summary table

| ID | Hypothesis | Verdict | Confidence | Basis |
|---|---|---|---|---|
| H-01 | Durable runs are valuable | **UNRESOLVED** (technically SUPPORTED) | tech: high · product: **none** | Exp 4 B1–B9 · Exp 5 not run |
| H-02 | Replay is valuable | **UNRESOLVED** (technically SUPPORTED) | tech: high · product: **none** | Exp 4 C1–C4 · Exp 5 not run |
| H-03 | Fork is valuable | **UNRESOLVED** (technically SUPPORTED) | tech: high · product: **none** | Exp 4 D1–D8 · Exp 5 not run |
| H-04 | Event log is the right source of truth | **SUPPORTED** | high | Exp 1 + Exp 4 (529 LOC yields 4 capabilities) |
| H-05 | Event projection is cheap enough | **SUPPORTED — conditional** | high | Exp 1: **only if bounded** |
| H-06 | Renting the loop is viable | **PARTIALLY SUPPORTED** | medium-high | Exp 3: control flow yes; **tool-level recovery no** |
| H-07 | Tool recovery semantics are practical | **PARTIALLY SUPPORTED** | high | Exp 2: contract **refuted and replaced**; replacement verified in Exp 4 |
| H-08 | Authorization belongs at the runtime seam | **SUPPORTED (technical)** | medium-high | Exp 4: 18-line local impl drove all three outcomes |
| H-09 | Developers value a small durable core | **PARTIALLY SUPPORTED** | tech: high · product: none | Exp 4/6: 529 LOC measured; preference unmeasured |
| H-10 | "Time travel" is a compelling product | **UNRESOLVED** | **none** | Exp 5 not run — **this is the gating unknown** |

**Four of ten hypotheses turn on evidence I could not gather.** All four are product hypotheses and
all four route through Experiment 5.

---

## H-01 — Durable runs are valuable

**Experiment:** Exp 4, tests B1–B9 (real `SIGKILL` of a live child process).

**Result — technical half: SUPPORTED.**
```
B1 child was alive and then SIGKILLed   — alive=true exit={"code":null,"sig":"SIGKILL"}
B2 partial work survived the kill       — 23 events persisted
B3 run left un-terminal                 — running
B5 reaper requeues an expired lease     — {"requeued":1,"parked":0}
B6 second process resumed and completed — completed
B7 final state correct after resume     — b.txt contains VALUE=20
B9 more events than at crash            — 23 -> 51
recovery: orphaned write (SAFE_RETRY) -> reissue
```
A genuinely killed process left a run recoverable; a different process finished it correctly.

**Result — product half: UNRESOLVED.** No developer was asked whether they want this.

**Evidence pointing the other way, recorded rather than buried:** `FINDINGS.md` establishes that
**Hermes has the largest user base of the three audited projects and has no run-level durability.**
Its users re-run failed tasks and evidently tolerate it. That is a real market signal against H-01
which no amount of passing tests answers.

**Decision:** the mechanism is proven. The demand is not. **Gate on Exp 5.**

---

## H-02 — Replay is valuable

**Experiment:** Exp 4, C1–C4; Exp 3, 5.1–5.2.

**Technical: SUPPORTED.** Snapshot-load ≡ full replay; byte-identical across repeats; point-in-time
replay correct; event sequence matches an independently-produced baseline. Replay also works on runs
executed by an **external** loop (Exp 3).

**Caveat that matters:** the model in Exp 4 is a deterministic script. This proves the *replay
machinery* is exact; it does not prove a real LLM run reproduces. In practice replay would serve
*recorded* responses (which the log already stores), so this is a smaller gap than it sounds — but
it is untested.

**Product: UNRESOLVED.**

---

## H-03 — Fork is valuable

**Experiment:** Exp 4, D1–D8.

**Technical: SUPPORTED.** Fork copies history to event N, records provenance
(`parent_run_id` + `forked_from_seq`), leaves the source unmutated, and diverges under a different
policy — verified on the filesystem (`fork b.txt = "beta\nVALUE=2"` vs original `VALUE=20`).
Forking an **adapted** (externally-executed) run also works (Exp 3, 5.3).

**Known limit:** fork copies events by INSERT. For a 1M-event run that is a 170 MB copy.
Copy-on-write would be needed at scale — untested.

**Product: UNRESOLVED.** Fork is the capability most likely to be *demoed well and used rarely*.
Exp 5 §7 pre-registers "uses fork unprompted" precisely to catch that.

---

## H-04 — Event log is the correct source of truth

**Verdict: SUPPORTED.** Confidence: high.

Two independent lines of evidence:

1. **Performance is not an objection** (Exp 1): append p50 = **12 µs**, flat from 10 to 1,000,000
   events; storage ≈ **171 B/event**; the reducer itself costs ≈0.5 µs/event.
2. **The capability argument holds** (Exp 4): resume, replay, fork and explain all fall out of the
   *same* mechanism in **529 lines**. QM needed three separate mechanisms (run status + audit log +
   replay tape) to get a subset of this.

**The complexity objection is answered by measurement, not assertion:** 529 lines for four
capabilities is not "dramatically harder to use" — which was the pre-registered kill criterion.

---

## H-05 — Event projection is cheap enough

**Verdict: SUPPORTED — CONDITIONAL.** Confidence: high.
**The condition is a correction to the architecture, produced by the experiment.**

As originally specified (`ARCHITECTURE.md` §2.2, state contains `messages[]`), the projection is
**unbounded** and it **fails the target**:

| config | state @100k | load p99 @100k | vs 50 ms target |
|---|---|---|---|
| SQLite unbounded | 8.03 MB | 17.65 ms | passes, degrading |
| **Postgres unbounded** | 8.03 MB | **100.26 ms** | **FAILS — 2× over** |
| SQLite bounded | **10.9 KB** | **0.04 ms** | passes ×1,000 |
| Postgres bounded | **10.8 KB** | **0.93 ms** | passes ×50 |

The diagnostic detail: snapshot interval barely mattered (13.97 ms @100 vs 14.82 ms @5000) — the
cost was parsing an ever-growing state blob, not replaying the tail. **Snapshotting an unbounded
projection just relocates the cost.**

Bounded, state is **10.2 KB at 1,000,000 events** and load latency is flat.

**Also revised:** the 50 ms p99 target is far too loose to be informative. Recommend **p99 < 5 ms**.

---

## H-06 — Renting the loop is viable

**Verdict: PARTIALLY SUPPORTED.** Confidence: medium-high (n=1 adapter).

**Works:** a run executed entirely by the Claude Agent SDK normalizes into a valid event log, and
**replay, fork and explain all work on it** (Exp 3, tests 5.1–5.4). That is the thesis demonstrated.

**Two findings that change the design:**

1. **The closed 31-type vocabulary is not viable.** It loses **33 field kinds** including
   `total_cost_usd`, `ttft_ms`, `usage`, cache accounting and thinking blocks. Extension mode
   preserves 54/56 with **identical core event types**. → adopt *closed types, extensible payload*.
2. **Crash recovery on a rented loop is turn-level, not tool-level.**
   ```
   tool.requested=1  tool.started=0  terminal=3
   pending_tool_calls at crash point = []
   ```
   The SDK emits no "tool started" message, so an in-flight tool is invisible and the
   orphan-recovery machinery has nothing to act on. **This is a property of the external protocol,
   not a fixable adapter defect.** It retro-explains why QM — which rents four loops — has
   run-level rather than step-level durability.

---

## H-07 — Tool recovery semantics are practical

**Verdict: PARTIALLY SUPPORTED.** The proposed contract was **REFUTED and replaced**; the
replacement was then verified end-to-end.

**Refutation (Exp 2, sims #5/#6):** `ARCHITECTURE.md` §2.6 proposed per-**tool**
`idempotency: None | Key(args)`. Same tool, opposite safety:
```
bash("echo x >> f")   -> re-issue DUPLICATED
bash("mkdir -p a/b")  -> re-issue identical
```
Six high-traffic Hermes tools are argument-dependent. A per-tool declaration cannot express this.

**Pre-registered threshold crossed:** `OPEN-QUESTIONS.md` E-04 said *"if more than roughly a third
land in unkeyed-mutating, the crash-resume story needs rethinking."* Measured across 34 classified
tools: **32% UNSAFE + 12% argument-dependent = 44%.**

**Unexpected positive:** `patch` and `git commit` **reject their own replays** — the effect
invalidates the precondition. `SELF_VERIFYING` is stronger than an idempotency key (no key, no
runtime bookkeeping, no remote cooperation) and was **not in the original taxonomy**.

**Replacement, verified in situ (Exp 4, G1–G5 and B):**
```
recovery(args) -> { class, precondition?, dedup_key?, verify? }
```
```
G1/G2  orphaned write (SAFE_RETRY) -> skip       (verify() said "applied")
B      orphaned write (SAFE_RETRY) -> reissue    (verify() said "not-applied")
G4     orphaned bash ">>"          -> escalate   (no verify, UNSAFE)
```
The same orphan class resolves three different ways on evidence rather than guesswork.

**Unresolved:** general `bash` recovery. Documented as a limit, defaults to escalate.

---

## H-08 — Authorization belongs at the runtime seam

**Verdict: SUPPORTED (technical).** Confidence: medium-high.

An **18-line** local `authorize(action) → allow | deny | escalate` drove all three branches in
Exp 4: `allow` throughout the baseline, `deny` producing the fork divergence (D8), `escalate`
releasing the lease and pausing the run (E1–E8). No external service was involved, which is the
neutrality property `NEXT-HARNESS-SPEC.md` §28.20 requires.

**Not tested:** whether developers *use* it, whether three outcomes suffice for real policy, and
whether it stays cheap when policy is non-trivial.

---

## H-09 — Developers value a small durable core

**Verdict: PARTIALLY SUPPORTED.** The "small" half is measured; the "value" half is not.

Measured (Exp 4/6): the durable core is **529 LOC** delivering resume + replay + fork + explain +
human-pause + degradation visibility. `NEXT-HARNESS-SPEC.md` §28.21 estimated 5,000–7,000 LOC for
V0 — **the differentiating part is an order of magnitude smaller than planned.** The remaining V0
bulk is CLI, doctor, error handling and tool breadth: ordinary work.

Comparison: QM's equivalent subsystem is ≈2,900 LOC and provides a *subset* (no fork, weaker replay)
— though it is multi-worker, Postgres-backed and production-hardened, which the prototype is not.

**Whether developers prefer this to a large framework is UNRESOLVED.**

---

## H-10 — "Time travel for agents" is compelling

**Verdict: UNRESOLVED. Confidence: none. This is the gating hypothesis.**

The capability works — 44/44 assertions, including on externally-executed runs. Nobody has been
shown it.

**The failure mode this must rule out is documented in the audit itself:** Ruflo contains correct
Raft, correct PBFT, correct Double-DQN and a real HNSW index — all of them unreachable or uncalled.
*Technically real and never used* is a demonstrated outcome in this space, not a hypothetical one.
A durable runtime nobody invokes would be the same failure with better engineering.

---

## Experiments that could not be run

| Experiment | Status | Why | Consequence |
|---|---|---|---|
| **5 — Developer validation** | **NOT RUN** | no access to human participants | H-01/02/03/09/10 product halves unresolved; **blocks the decision** |
| §9 — Demand measurement | **NOT RUN** | requires users | no activation, retention or feature-usage data |
| §11 — Positioning test | **NOT RUN** | requires users | 5 copy variants specified, untested |
| **6 — Framework comparison** | **LARGELY BLOCKED** | no model credentials | no latency/token/cost comparison; structural comparison only |
| Multi-worker contention | **NOT RUN** | out of scope for the time available | D-05 unverified under concurrency — largest remaining *technical* gap |
| `synchronous=FULL` cost | **NOT MEASURED** | — | Exp 1 used `NORMAL`; Exp 4 used `FULL`; the durability/throughput tradeoff is unquantified |

**No participant was simulated and no number was estimated.** Instruments for Exp 5, §9 and §11 are
written and ready in `proof/05-developer-validation/PROTOCOL.md`, with thresholds pre-registered.

---

## What changed in the architecture because of this phase

Five corrections, all experiment-driven:

| # | Change | Source | Severity |
|---|---|---|---|
| 1 | Projection **must be bounded** | Exp 1 (Postgres p99 100 ms → 0.93 ms) | **breaking** |
| 2 | Per-tool idempotency **replaced** by per-invocation `recovery()` + `verify()` | Exp 2 (sims #5/#6) | **breaking** |
| 3 | `SELF_VERIFYING` added as a first-class recovery class | Exp 2 (sims #4/#7) | additive |
| 4 | Event **types** closed, **payloads** extensible; promote cost + latency to core | Exp 3 (33 vs 2 lost) | **breaking** |
| 5 | **No-progress detection** required | Exp 4 §4.2 (fork livelocked to 305 events) | additive |

Plus two revisions of expectation: the 50 ms p99 target is too loose (→ 5 ms), and the V0 core is
much smaller than estimated (529 LOC vs 5–7k).

Full detail: `ARCHITECTURE-REVISION.md`.
