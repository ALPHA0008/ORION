# Experiment 6 — Framework Comparison

# ⚠️ LARGELY BLOCKED — NO MODEL CREDENTIALS

**What the brief asked:** run the same workload against the prototype, QM, Hermes, LangGraph and
OpenHands; measure completion, latency, LLM calls, tool calls, retries, recovery, context growth,
operator intervention and cost.

**What is possible here:** almost none of it. Every metric in that list requires driving each system
through real LLM turns. No credentials are available. Per the brief's instruction not to claim
apples-to-apples comparisons across differing environments, and not to invent numbers, **no
performance table is reported.**

What *can* be compared without a model is **structural capability**, verified by reading and
running code. That is below, clearly labelled as such.

---

## 1. What was actually verified (no model required)

| Capability | Prototype | QM | Hermes | Ruflo | LangGraph | OpenHands |
|---|---|---|---|---|---|---|
| Survives process death, resumes automatically | **VERIFIED** (real SIGKILL → requeue → complete) | **VERIFIED** (lease+reaper; 25/25 tests vs live Postgres) | run-level only, no resume-into-state | none found | checkpointer-dependent | **NOT ASSESSED** |
| Replay a past run | **VERIFIED** (exact, repeatable) | **PARTIAL** (`replay.ts` + tape, shadow/serve) | no | no | partial (state history) | **NOT ASSESSED** |
| Fork from an earlier point | **VERIFIED** (provenance + divergence) | session fork exists (test passes) | no | no | partial (time-travel in some backends) | **NOT ASSESSED** |
| Explain: full decision history | **VERIFIED** | **VERIFIED** (audit log, named actions) | partial (transcript, no audit log) | logs only | partial | **NOT ASSESSED** |
| Human pause survives process death | **VERIFIED** (E1–E8, two processes) | **VERIFIED** (durable approvals) | no | no | interrupt exists; durability backend-dependent | **NOT ASSESSED** |
| Degradation is observable | **VERIFIED** (mandatory `degraded` events) | **VERIFIED** (`…tool_result_failed_open` audit action) | partial | **REFUTED** (silent in 3 paths) | no | **NOT ASSESSED** |
| Tool-level crash recovery | **VERIFIED** (Exp 2 contract in situ) | run-level | no | no | no | **NOT ASSESSED** |

**LangGraph and OpenHands rows are from documentation and general knowledge, not from source
inspection in this study.** They were not cloned, read, or run. Marked as such rather than dressed
up — treating them as verified would repeat exactly the error this whole research programme was
designed to avoid.

**QM, Hermes and Ruflo rows are evidence-backed** from the prior audit (`FINDINGS.md`) and, for QM,
from tests executed against a live Postgres.

---

## 2. Size comparison (measured, no model needed)

| System | Durable-execution core | Total source |
|---|---|---|
| **Prototype** | **529 LOC** (`harness.mjs` + `worker.mjs`) | 593 LOC incl. test scenario |
| QM | `src/runs/` + `src/persistence/` ≈ 2,900 LOC | 267,444 LOC |
| Hermes | no equivalent subsystem | 2,517,451 LOC |
| Ruflo | none | 914,885 LOC |

The prototype delivers resume + replay + fork + explain + human-pause + degradation visibility in
**529 lines**. QM's (more production-hardened, multi-worker, Postgres-backed) equivalent is roughly
5× that and does not include replay or fork of the same kind.

This supports **H-09** — a small durable core is achievable — but note it is a *floor*: the
prototype has one store, one worker, no auth backend, no ops tooling.

---

## 3. What a real comparison would need

For whoever runs it later, the design is:

- **Same model** across all systems (e.g. one mid-tier model via a single provider), or the token
  and latency numbers are meaningless.
- **Same task suite**: the Experiment 4 scenario (create 3 files → grep → edit → verify) plus one
  long task (≥50 tool calls) and one deliberately-failing task.
- **Same fault injection**: SIGKILL at 25%, 50%, 75% of expected duration.
- **Report cost per *successful* task**, not per token.
- **Label incomparable fields explicitly** — e.g. Hermes makes background-review calls (~30K
  tokens/turn, disclosed in its own source) that others do not; counting those as "overhead" without
  saying so would be dishonest.

Estimated cost: a few hundred dollars of inference. This is the cheapest remaining experiment and it
is gated purely on credentials.

---

## 4. Honest summary

The only defensible claim from this experiment is the structural one: **the prototype does four
things (resume, replay, fork, explain) that no audited system does all four of, and it does them in
529 lines.** Whether it does them *faster*, *cheaper*, or *more reliably under real model load* than
the alternatives is **UNVERIFIABLE here** and is not claimed.
