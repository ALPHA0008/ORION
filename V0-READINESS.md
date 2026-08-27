# V0 READINESS

**Date:** 2026-08-27 · **Phase:** real-model validation
**Code:** `v0/` — ~2,000 lines of source, no dependencies, no build step
**Regression suite:** **310 assertions, 310 passing, 9 suites** (`node tests/run-all.mjs`, ~53s)
**Real-model experiments:** 5 suites, **126 assertions, 126 passing**, against `gemma4-31b` on vLLM

---

# Final classification

## **READY_FOR_DEVELOPER_VALIDATION**

The blocker that produced `NEEDS_ONE_MORE_TECHNICAL_ITERATION` last phase was precise:

> The harness has never been driven by a real language model.

It has now. A real 31B model drove real tasks through real tool execution, was killed with real
`SIGKILL` at three points, and resumed **coherently** in a different process with zero duplicate
effects — then the run replayed byte-for-byte and forked cleanly.

Five real bugs surfaced that 310 passing tests could not see. All five are fixed, each with a
failing test written first. That is the evidence the classification rests on: not that the tests
pass, but that **a real model found things the tests could not, and the runtime survived them.**

This says nothing about developer demand. See §Product.

---

# Technical

### Real model behaviour — **VALIDATED**
`gemma4-31b` on vLLM completed a genuine bug-fix task: read the file, applied a correct `edit`,
escalated `sh test.sh` for approval, resumed under a *different worker*, ran the test, got `PASS`.
Across 10 workloads: 66 model calls, 47 tool calls, 57K input tokens.

**Two provider quirks had to be shimmed**, both named, both outside the core. The first is
consequential: vLLM was started without `--enable-auto-tool-choice`, so tool calls arrived as raw
text with `tool_calls: []`. An unmodified OpenAI-compatible client **terminates on turn one**.

### Process death — **VALIDATED**
Parent-issued `SIGKILL` at 25% / 50% / 75%, chosen by durable progress rather than wall clock.
All three: child verified alive → killed → reaper requeued 1 → different process completed →
**0 duplicate writes** → all files correct → log gapless at 46 events.

### Recovery — **VALIDATED**
All three branches with a real model in the loop:
`verify()→not-applied ⇒ reissue` · `verify()→applied ⇒ skip` · `no verify + UNSAFE ⇒ escalate`
(paused, lease released, human asked). Identical durable log in the first two cases, opposite
decisions — which is the entire argument for `verify()`.

### Replay / rerun / fork — **VALIDATED under real nondeterminism**
`replay` = 0 model calls, byte-identical, reproduces the original exactly.
`rerun` = a *different* transcript for the same task. The invariant is demonstrated, not defined.
`fork` = provenance recorded, source untouched and still replays identically, new future diverges.

### Context — **PARTIALLY VALIDATED**
Hot state peaked at 33 KB against a 96 KB ceiling; per-message clamping held on real 3 KB tool
outputs. **But the window never overflowed** (34 messages, 0 dropped). Elision under a real model
is untested — the largest remaining context question.

### No-progress — **MEASURED, thresholds unchanged**
A capable model does not loop: given an impossible tool it refused on turn one. Given a *real* tool
that was always denied it repeated 3 times then stopped by itself — the same point the detector
fires. **Not retuned**, because retuning on one model's behaviour would be guessing.

### Concurrency, authorization, security, degradation — **VALIDATED**
51 lease assertions incl. a 6-process claim storm and a randomized soak. The seam held against a
model explicitly instructed to bypass it (4 denials, `bash` never started, secret intact). Five
model-driven security probes — including prompt injection from a file — **all failed to bypass**.
Every fallback now emits `degraded`, including client-internal retries (ADR-010).

---

# Architecture

### Held
Event log as source of truth · bounded projection · per-invocation recovery · `verify()` · closed
event types with extensible payloads · recovery granularity · leases/reaper · execution fencing ·
the authorization seam. **None were revised.**

### Changed — all evidence-forced
| change | ADR |
|---|---|
| `'paused'` is claimable — targeted always, queue scan only once a human answered | **ADR-009** |
| Client retries and shim usage emit `degraded` | **ADR-010** |
| `fork()` detects/reports mid-turn forks; `nearestTurnBoundary()` | `time-travel.md` |
| `restore()` handles empty trees and prunes post-checkpoint files | `time-travel.md` |

### Rejected
Nothing was added from the forbidden list. Core grew ~60 lines, all observability and guard-rails.

### Remaining unknowns
1. Window **overflow** with a real model (clamping proven, elision not).
2. Only one model, one provider.
3. No *naturally occurring* orphan — every kill landed on `model.requested`.
4. Long multi-hour tasks with mid-task discoveries.
5. Multi-host leases (wall-clock expiry assumes no clock skew).
6. Postgres — the primitives map, but that is an argument, not a measurement.

---

# Product

**Value proposition.** Durable agent runs you can replay and fork — kill the process, start it
again, and it continues; then inspect exactly what it did and branch from any point.

**Killer demo.** Real, reproducible today:
```
$ harness run "fix the bug in src/calc.js and verify"
  ✓ read src/calc.js
  ✓ edit edited src/calc.js
  ✕ Process terminated
$ harness resume #045abc
resuming from event 21…
  ♻ Recovered from event #21 — write: skip
  ✓ bash → PASS
✓ model_finished
```

**Problem it solves.** A run dies halfway and today you re-run from the top — paying again for
completed work and hoping half-finished side effects don't collide.

**Target user (hypothesised).** Engineers running agents unattended — cron, CI, queues, long
background jobs. Nobody is watching when those fail.

**Evidence that exists.** Technical only: 310 regression + 126 real-model assertions. The runtime
does what it claims, with a real model, under real process death.

**Evidence that is missing.** *That any developer wants it.* Zero interviews, zero installs, zero
usage. **No claim is made about PMF, demand, or adoption.** The instrument is written with
pre-registered thresholds (`research/proof/05-developer-validation/PROTOCOL.md`) and has never run.

The strongest counter-argument remains unchanged and unanswered by this phase: **Hermes has the
largest user base of the three audited systems and no run-level durability at all.** Its users
re-run and cope.

---

# What the next phase must do

Put V0 in front of 20–30 developers who already ship agents. Run the protocol as written, with the
thresholds pre-registered, and let the decision rule fire — BUILD, PIVOT, or STOP.

Two technical items worth doing in the same window, both small: force a real window overflow to
close unknown #1, and run one long unattended task to test resume coherence properly.

---

# Honest summary

The foundation has now been attacked rather than admired. Real processes killed mid-flight, six
processes racing for thirty runs, a fault-injecting proxy in front of a live model, and a real LLM
told to bypass its own guard rails.

The most valuable single hour was the first real task: the model escalated naturally, and the
resume **silently failed** because `claim()` excluded `'paused'`. Every escalated run would have
been unresumable in production. A test helper had been masking it with `claimed ?? runId`.

**No scripted model would ever have found that.** That is the case for this phase having been
necessary, and the case for the next one being about people rather than architecture.

**READY_FOR_DEVELOPER_VALIDATION.**
