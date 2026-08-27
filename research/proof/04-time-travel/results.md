# Experiment 4 — Time-Travel Prototype

**Tests H-01 (durable runs), H-02 (replay), H-03 (fork), H-04 (event log), H-08 (authz seam),
H-10 (time travel as a product) — the *technical* half of each. The product half needs
Experiment 5, which could not be run (see `../05-developer-validation/`).**

**Artifacts:** `harness.mjs` (292 L) · `worker.mjs` (237 L) · `scenario.mjs` · `runner.mjs` ·
`acceptance.mjs` (44 assertions) · `acceptance-results.json`

---

## 1. Result

```
RESULT: 44 passed, 0 failed  (44 assertions)
```

**All five V0 acceptance gates from `NEXT-HARNESS-SPEC.md` §28.21 are met**, including a real
`SIGKILL` of a live process — not a simulated control-flow gap.

| Gate (spec §28.21) | Test | Result |
|---|---|---|
| 1. Kill the process mid-run; restart; the run resumes and completes | B1–B9 | **PASS** |
| 2. Replay a recorded run; the event stream matches | C1–C4 | **PASS** |
| 3. Fork a run at event N; both branches complete independently | D1–D8 | **PASS** |
| 4. A tool escalates; the process exits; the human answers later; the run resumes | E1–E8 | **PASS** |
| 5. Every fallback emits `degraded`, verified by test | F1–F5, G1–G5 | **PASS** |

---

## 2. What was built

Exactly the V0 scope, nothing more: SQLite event log, Run/Task, **bounded** state projection
(per Experiment 1), lease + reaper, single worker, one model, six tools, local sandbox,
git shadow-repo checkpoints, `HumanRequest`, replay, fork, authorization seam, `degraded` events.

**Deliberately excluded:** semantic memory, skills, subagents, MCP, Postgres, multi-worker,
multiple providers, screening.

### Size — materially smaller than the spec estimated

| File | Lines | Contents |
|---|---|---|
| `harness.mjs` | 292 | store, projection, sandbox, 6 tools, authz seam |
| `worker.mjs` | 237 | loop, recovery reconciliation, reaper, fork, explain |
| **durable core total** | **529** | |

`NEXT-HARNESS-SPEC.md` §28.21 estimated **5,000–7,000 LOC** for V0. The *durability machinery* —
the part that is supposed to be hard — is **529 lines**. This is a significant finding for the
build decision: the differentiating core is small, and the remaining 4,500 LOC of a real V0 is CLI,
doctor, error handling, and tool breadth, i.e. ordinary work.

---

## 3. The kill test in detail (the load-bearing evidence)

```
B1 child was alive and then SIGKILLed   — alive=true exit={"code":null,"sig":"SIGKILL"}
B2 partial work survived the kill       — 23 events persisted
B3 run left un-terminal                 — running
B4 reaper ignores a live lease          — {"requeued":0,"parked":0}
B5 reaper requeues an expired lease     — {"requeued":1,"parked":0}
B6 second process resumed and completed — completed (0)
B7 final state correct after resume     — b.txt contains VALUE=20
B8 all files present after resume
B9 more events than at crash            — 23 -> 51

crash@23 events -> resumed -> 51 events; 1 recovery decision logged
recovery: orphaned write (SAFE_RETRY) -> reissue
```

Three things this proves that a simulated crash would not:

1. **The parent killed a genuinely live child** (`exitCode === null` before the kill, `SIGKILL`
   after). Process state, in-memory projection, and open file handles were all destroyed.
2. **The reaper discriminates.** It correctly left a live lease alone and requeued only after
   expiry — the compare-and-set path actually fires.
3. **The Experiment 2 recovery contract engaged for real.** The kill landed between a tool's effect
   and its terminal event; on resume the orphan was detected, classified `SAFE_RETRY`, and
   re-issued. The two experiments compose.

### A methodological note worth recording
My first two attempts at this test **failed to kill anything**: the child's own `setTimeout(kill)`
never fired because the slow-tool busy-wait blocked its event loop, so the run completed before the
timer ran (49 events = a complete run). The test only became real when the **parent** issued the
kill. Recorded because a self-killing child is an easy way to write a crash test that silently
tests nothing.

---

## 4. Findings beyond pass/fail

### 4.1 `verify()` earns its place — measured, not argued

Experiment 2 proposed a `verify()` probe as a new primitive. Test G shows it working in situ:

```
G1/G2  orphaned write (SAFE_RETRY) -> skip     <- verify() found the effect already applied
G4     orphaned bash "echo x >> log.txt" -> paused/ambiguous_tool_recovery
```

The same orphan class resolves **two different ways** depending on `verify()`'s answer: skip when
the effect is confirmed applied, re-issue when confirmed not-applied (test B), escalate when
unknown (test G4). Without `verify()`, case G1 would have re-executed a write unnecessarily and
case B could not have been auto-resolved at all.

### 4.2 A real gap the tests exposed: no no-progress detection

Test D forks a run and denies the `edit` tool. The fork ran **305 events** before terminating on
`max_turns`, versus 49 for the original — the model kept re-requesting the denied tool.

The scripted model is partly to blame (a real LLM would likely adapt after seeing `DENIED`), so
this is not purely a harness defect. **But the harness had no defence.** Only a blunt turn cap
stopped it. A durable runtime that can run unattended for hours needs better:

- detect repeated identical `tool.requested` payloads and fail with a distinct reason;
- treat *N consecutive turns with no new `tool.succeeded`* as no-progress;
- surface it as a first-class terminal reason, not `max_turns`.

**This is a genuine addition to the architecture, discovered by experiment.** It costs ~20 lines
and is exactly the class of failure that only appears when something runs unattended.

### 4.3 The authorization seam did real work with three outcomes

`allow | deny | escalate` was exercised on all three branches: `allow` throughout the baseline,
`deny` in test D (which produced the divergence), `escalate` in test E (which released the lease).
The seam is 18 lines (`makeAuthorizer`). **H-08's technical half is supported**: the interface is
useful with a purely local implementation and no external service — which is the neutrality
property `NEXT-HARNESS-SPEC.md` §28.20 requires.

### 4.4 Pausing genuinely frees the worker

```
E2 lease released (no worker holds it)   — lease_expires_at NULL, worker_id NULL
E4 process 1 exited cleanly              — exit=0
E6 a different process resumed           — completed
```
Process 1 escalated and **exited normally**. The human answered while nothing was running. A
different process picked the run up and finished it. No worker was held for the duration of the
human's absence — the property that separates a durable pause from a blocked promise.

### 4.5 Replay is exact

`C1` (snapshot-load == full replay), `C3` (byte-identical across repeats), and `C4` (event sequence
matches the independent baseline run) all pass. **Caveat:** the model is deterministic, so this
proves the *replay machinery* is exact, not that a real LLM run would reproduce. That distinction
is preserved in §6.

---

## 5. Hypothesis verdicts (technical half only)

| ID | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H-01 | durable runs work | **SUPPORTED (technical)** | B1–B9: real SIGKILL, requeue, resume, correct final state |
| H-02 | replay works | **SUPPORTED (technical)** | C1–C4: exact, repeatable, point-in-time |
| H-03 | fork works | **SUPPORTED (technical)** | D1–D8: provenance, independence, divergence, source unmutated |
| H-04 | event log is the right source of truth | **SUPPORTED** | resume/replay/fork/explain all fall out of one mechanism in 529 lines |
| H-07 | tool recovery is practical | **SUPPORTED (revised contract)** | G1–G5, B recovery line — the Exp-2 contract works in situ |
| H-08 | authz seam is useful standalone | **SUPPORTED (technical)** | 18-line local implementation drove deny and escalate paths |
| H-10 | time travel is compelling | **UNRESOLVED** | it *works*; whether anyone *wants* it needs Experiment 5 |

**H-01, H-02, H-03 and H-10 each have a product half that this experiment cannot touch.** Working is
necessary, not sufficient.

---

## 6. Threats to validity

Stated plainly — several are significant.

1. **The model is a deterministic script, not an LLM.** No credentials were available. This makes
   replay assertions exact but means: (a) real replay would face model nondeterminism (mitigated in
   practice by recording responses, which the log already does); (b) the no-progress livelock in
   §4.2 is partly a scripted-model artifact; (c) nothing here tests context growth, token cost, or
   how a real model reacts to `DENIED`.
2. **Single worker, single machine, SQLite only.** Multi-worker claim contention (D-05) is
   **untested**. `BEGIN IMMEDIATE` should serialise claims, but I did not prove it under concurrency.
3. **Tools are reimplementations**, not Hermes' or QM's actual handlers.
4. **`synchronous=FULL`** was used here (unlike Experiment 1's `NORMAL`), which is the correct
   setting when the log is the source of truth — but its cost was not measured in this experiment.
5. **The fork copies events by INSERT.** For a 1M-event run that is a large copy. A
   copy-on-write/pointer scheme would be needed at scale; untested.
6. **No sandbox isolation testing.** `LocalSandbox` does a path-escape check and nothing else. It is
   not a security boundary.
7. **44 assertions is a thin suite** for claims this load-bearing. It covers the happy path of each
   gate plus a few failure paths, not a matrix.

---

## 7. Consequences for the architecture

| Item | Status |
|---|---|
| Event log → resume/replay/fork/explain from one mechanism | **CONFIRMED** — 529 lines, 44/44 |
| Bounded projection (Exp 1) | **CONFIRMED in use** — no degradation across tests |
| Per-invocation `recovery()` + `verify()` (Exp 2) | **CONFIRMED in situ** — G1–G5, B |
| Pause releases the lease | **CONFIRMED** — E2/E4/E6 |
| Three-valued authz seam | **CONFIRMED** — all branches exercised |
| **No-progress detection** | **NEW REQUIREMENT** — §4.2, not in the current spec |
| V0 size estimate of 5–7k LOC | **REVISE DOWN** for the core — durability is 529 lines |
| Multi-worker safety | **STILL UNTESTED** — the largest remaining technical gap |
