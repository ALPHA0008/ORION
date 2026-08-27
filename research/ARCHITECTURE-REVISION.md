# ARCHITECTURE REVISION

> Original architecture → experimental evidence → revised architecture.
> Architectural failures are stated, not hidden. Five decisions changed; two were breaking.

Baseline: `ARCHITECTURE.md`, `DECISION-MATRIX.md`, `NEXT-HARNESS-SPEC.md` (written from the audit,
before any code existed). Evidence: `proof/01-event-log` … `proof/06-framework-comparison`.

---

## Summary of changes

| # | Original | Evidence | Revised | Severity |
|---|---|---|---|---|
| R-1 | `State` contains `messages[]` | Exp 1: PG p99 **100.26 ms**, fails the target | **Bounded projection** (window + counters) | **BREAKING** |
| R-2 | `idempotency: None \| Key(args)` per tool | Exp 2: same tool, opposite safety | **`recovery(args)` per invocation** + `verify()` | **BREAKING** |
| R-3 | 6 recovery classes | Exp 2: `patch`/`git` reject their own replay | **+ `SELF_VERIFYING`** (strongest, no key needed) | additive |
| R-4 | Closed event vocabulary | Exp 3: **33 field kinds lost** vs 2 | **Closed types, extensible payloads**; promote cost+latency to core | **BREAKING** |
| R-5 | terminate on `max_turns` | Exp 4: fork livelocked to **305 events** | **No-progress detection** as a first-class terminal reason | additive |
| R-6 | own-loop ≈ rented-loop | Exp 3: `tool.started=0` on adapted runs | **Recovery granularity is a declared capability** (`tool` vs `turn`) | clarifying |
| R-7 | p99 target 50 ms | Exp 1: bounded design lands 1,000× under | **Target p99 < 5 ms** | tightening |
| R-8 | V0 ≈ 5,000–7,000 LOC | Exp 4: durable core is **529 LOC** | Revise estimate; re-scope V0 around the small core | scoping |

---

## R-1 — The projection must be bounded  **(BREAKING)**

**Original** (`ARCHITECTURE.md` §2.2):
```
State = fold(Event[]) -> { status, messages[], pending_tool_calls[], budget_consumed, ... }
```

**What the experiment found.** Snapshot interval barely affected load latency — 13.97 ms at
interval 100 vs 14.82 ms at 5,000. That is the signature of a cost that is not in the tail replay.
The cause was `messages[]` growing without bound:

| n | unbounded state |
|---|---|
| 10,000 | 0.79 MB |
| 100,000 | 8.03 MB |
| 1,000,000 | **80.73 MB** |

Loading a snapshot meant parsing that blob. On Postgres it crossed a socket and was JSONB-decoded:
**p99 = 100.26 ms at 100k events — twice the stated 50 ms target.**

> **Snapshotting an unbounded projection does not reduce cost; it relocates it.**

**Revised.** The hot projection keeps counters, open items, and a fixed window:
```
{ status, seq, recent_messages[≤WINDOW], message_count,
  pending_tool_calls{open only}, open_human_requests{open only},
  budget{tokens,tool_calls,model_calls},
  degradation_count, last_degradations[≤10], lease..., attempts }
```
Full history stays in the log, queried on demand.

**Measured after the change:**

| n | bounded state | SQLite p99 | Postgres p99 |
|---|---|---|---|
| 1,000 | 10.8 KB | 0.06 ms | 1.16 ms |
| 100,000 | 10.9 KB | 0.04 ms | 0.93 ms |
| 1,000,000 | **10.2 KB** | **0.07 ms** | — |

Constant state, flat latency, ~100× improvement on Postgres.

**Bonus simplification:** the bounded projection *is* the context window. `ARCHITECTURE.md` §6
treated context assembly and state projection as two subsystems; they collapse into one.

**Honest note:** this was a real design error, and it was in the load-bearing primitive. It would
have shipped, because it passes every functional test — it only fails under scale, on the store we
planned to use for multi-worker deployments.

---

## R-2 — Tool recovery is per-invocation, not per-tool  **(BREAKING)**

**Original** (`ARCHITECTURE.md` §2.6): `idempotency: None | Key(args)`, declared per tool.

**What the experiment found** (Exp 2, sims #5/#6):
```
bash("echo x >> f")   -> re-issue DUPLICATED (2 lines, expected 1)
bash("mkdir -p a/b")  -> re-issue identical  (safe)
```
Six of the highest-traffic tools in the Hermes corpus are argument-dependent: `bash`,
`execute_code`, `terminal`, `process`, `ha_call_service`, `cronjob`. Declaring `bash` as `UNKNOWN`
would force escalation on nearly every crash-interrupted shell call — the most common interruption
there is.

**Pre-registered threshold crossed.** `OPEN-QUESTIONS.md` E-04 set one third as the rethink
trigger. Measured: **44%** (32% UNSAFE + 12% argument-dependent) across 34 classified tools.

**Revised:**
```
recovery(args) -> {
  class: READ_ONLY | SAFE_RETRY | SELF_VERIFYING | EXTERNALLY_DEDUPED | TRANSACTIONAL | UNSAFE,
  precondition?, dedup_key?,
  verify?: () => 'applied' | 'not-applied' | 'unknown'
}
```
Resume rule:
```
READ_ONLY | SAFE_RETRY | SELF_VERIFYING | TRANSACTIONAL   -> re-issue
EXTERNALLY_DEDUPED with key                              -> re-issue
UNSAFE with verify()                                      -> probe -> re-issue | skip
UNSAFE without verify()                                   -> escalate
```

**`verify()` is a new primitive** and it earned its place under test (Exp 4, G1–G5 and B): the same
orphan class resolved **three different ways** on evidence — skip, re-issue, escalate.

**Still unresolved:** general `bash` recovery. The prototype ships a heuristic classifier
(`mkdir -p`/`ls`/`cat` → SAFE_RETRY; `>>`/`git push`/`curl -X POST` → UNSAFE) that **defaults to
UNSAFE**. Documented as a limit rather than papered over.

---

## R-3 — `SELF_VERIFYING` added to the taxonomy

The best result in Exp 2 was unplanned. `patch` and `git commit` **reject their own replays**:
```
patch      second application -> "old_string not found"
git commit second application -> "nothing to commit"
```
The effect invalidates the precondition, so a duplicate cannot apply. This needs **no idempotency
key, no runtime bookkeeping, and no remote cooperation** — strictly stronger than the mechanism
originally proposed.

**Design consequence beyond recovery:** *prefer content-addressed tool arguments.*
`edit(path, old_string, new_string)` is safely resumable; `append(path, text)` is not. This is a
rule for the tool **vocabulary**, not just its metadata — a conclusion only an experiment produces.

---

## R-4 — Closed types, extensible payloads  **(BREAKING)**

**Original:** a closed set of 31 event types with fixed fields; `DECISION-MATRIX.md` D-14 treated
the event log as the trace.

**What the experiment found** (Exp 3): the real Claude Agent SDK exposes **100 `type:`
discriminators**. Normalizing into the closed vocabulary lost **33 field kinds**:
`total_cost_usd`, `ttft_ms`, `duration_api_ms`, `usage`, `modelUsage`, `num_turns`, `stop_reason`,
`cache_read_input_tokens`, `cache_creation_input_tokens`, `thinking_blocks`, `structured_output`,
`session_id`, `uuid`, `parent_tool_use_id`, …

Concretely, a closed-vocabulary log **cannot answer "what did this run cost?"** — which is a
first-order operational question and one of the reasons to adopt a durable runtime at all.

**Revised:**
- Event **types** stay closed (31). Verified valuable: test 1.2 confirms every adapter emission
  stayed in-vocabulary, which is what keeps the reducer total and replay deterministic.
- Event **payloads** are extensible via `payload.ext`. Preserves **54/56** fields with
  **identical core event types** (test 3.2).
- **Promote to core**, because every provider has them: `cost`/`usage` and `latency`
  (`ttft_ms`, `duration_ms`) on `model.responded` and `run.completed`.
- Reject fully-open event *types*: the reducer is a `switch`, unknown types would silently no-op,
  and replay fidelity would become provider-dependent.

---

## R-5 — No-progress detection  **(new requirement)**

**What the experiment found** (Exp 4, test D): forking a run and denying `edit` produced **305
events** versus 49 for the original. The model re-requested the denied tool until `max_turns`.

The scripted model is partly responsible — a real LLM would likely adapt after seeing `DENIED` —
but **the harness had no defence**. Only a blunt turn cap stopped it. A runtime intended to run
unattended for hours needs better.

**Revised.** Add to core:
- detect repeated identical `tool.requested` payloads → terminate with a distinct reason;
- treat *N consecutive turns with no new `tool.succeeded`* as no-progress;
- surface `run.failed{reason:'no_progress'}`, not `max_turns`.

~20 lines. Exactly the class of failure that only appears when nobody is watching — i.e. the
scenario this whole product is aimed at.

---

## R-6 — Own-loop and rented-loop are not equivalent

**Original** (`DECISION-MATRIX.md` D-02): own *and* rent, framed as symmetric options.

**What the experiment found** (Exp 3 §3.2):
```
tool.requested=1  tool.started=0  terminal=3
pending_tool_calls at crash point = []
```
The SDK never announces that a tool has begun executing. For adapted runs the projection can never
hold a `pending_tool_call`, so the R-2 recovery machinery has nothing to act on.

**Revised.**

| | own loop | rented loop |
|---|---|---|
| replay / fork / explain | yes | yes |
| **resume after crash** | **tool-level** | **turn-level only** |
| cost/latency data | what we record | richer (provider-native) |

- The **built-in loop is the default and the reference**, not a peer — it is the only configuration
  where the full recovery story holds.
- **Declare it**, as QM declares capability gaps (`LESSONS.md` L-02):
  `capabilities: { recovery_granularity: 'tool' | 'turn' }`.
- External adapters remain a real feature ("bring your agent, get history and forking") with an
  honestly weaker guarantee.

**This retro-explains an audit finding.** QM's durability is run-level (lease → reaper → requeue the
whole run) rather than step-level. That read as a design choice; it is better understood as a
**consequence of renting four loops**. QM could not have built tool-level recovery on borrowed loops
even if it wanted to.

---

## R-7 / R-8 — Two expectations revised

**R-7 — the latency target was too loose.** 50 ms p99 came from the spec. The bounded design lands
at 0.04–0.93 ms — three orders of magnitude under. A 50 ms budget would have permitted the
*unbounded* design on SQLite (17.65 ms) and hidden the defect. **New target: p99 < 5 ms**, which
still leaves the model call as the dominant cost of a turn.

**R-8 — V0 is much smaller than estimated.** `NEXT-HARNESS-SPEC.md` §28.21 estimated 5,000–7,000
LOC. Measured: the durable core — event log, projection, lease, reaper, worker loop, recovery
reconciliation, fork, replay, explain, authz seam, 6 tools, sandbox — is **529 LOC**
(`harness.mjs` 292 + `worker.mjs` 237).

This matters for the build decision: the *differentiating* part is small and already exists. The
remaining V0 work is CLI, doctor, error handling, real provider integration and tool breadth —
ordinary engineering, not research.

---

## What did NOT change

Stated so the revision is not mistaken for a rewrite. These survived contact with evidence:

| Decision | Status | Why it held |
|---|---|---|
| **D-01** event log as source of truth | **KEEP** | 12 µs appends, 171 B/event, and four capabilities from one mechanism in 529 LOC |
| **D-03** single `authorize()` seam | **KEEP** | 18-line local impl drove allow/deny/escalate (Exp 4 D8, E1–E8) |
| **D-04** SQLite default, Postgres optional | **KEEP** | both verified; SQLite is 20–1,000× faster on projection load, so the default is also the fast path |
| **D-05** stateless workers + leases | **KEEP** | proven by real SIGKILL → reaper → different process completes. **Caveat: multi-worker contention untested.** |
| **D-06** plain loop, not a graph | **KEEP** | resume is "fold the log"; no evidence a graph would have helped |
| Pause releases the lease | **KEEP** | E2/E4/E6: process exited, human answered later, another process resumed |
| Mandatory `degraded` events | **KEEP** | F1–F5: status derived from counted effects, so an inert path cannot self-report healthy |

---

## Revised one-way doors

`DECISION-MATRIX.md` listed three. After this phase:

| # | Decision | Still one-way? | Confidence now |
|---|---|---|---|
| D-01 | event log as truth | **yes** | **high** — measured, not argued |
| D-03 | single authz seam | **yes** | **high** — exercised on all branches |
| D-05 | stateless workers + queue | **yes** | **medium-high** — single-worker proven; concurrency unproven |
| **R-1** | **bounded projection** | **yes — new** | **high** — changes the state contract |
| **R-4** | **closed types / open payloads** | **yes — new** | **medium-high** — n=1 adapter |

**Two new one-way doors were discovered by experiment.** Both would have been expensive to
retrofit: R-1 changes the shape of every stored snapshot; R-4 changes the shape of every stored
payload.

---

## Residual technical risk

Ranked, honestly:

1. **Multi-worker contention is untested.** D-05 rests on `BEGIN IMMEDIATE` / `SKIP LOCKED`
   serialising claims. Argued, not demonstrated. **Largest remaining technical gap.**
2. **Replay under a real (nondeterministic) model** — mitigated in principle by serving recorded
   responses, untested in practice.
3. **Fork copies events by INSERT** — 170 MB for a 1M-event run. Needs copy-on-write at scale.
4. **`synchronous=FULL` cost unmeasured.** Exp 1 used `NORMAL`, Exp 4 used `FULL`. If the log is
   the source of truth, `FULL` is correct — and its throughput cost is unquantified.
5. **n = 1 adapter.** R-4 and R-6 generalise from one vendor.
6. **General `bash` recovery unsolved** — defaults to escalate.
