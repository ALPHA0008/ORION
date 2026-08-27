# PROJECT JOURNEY — how this repository got here

**Read this first if you are picking up this project cold.**

This file exists because the work spanned several long sessions and the repository is the only
surviving record. It explains *what was done, in what order, and why* — so you can trust the
artifacts without re-deriving them, and so you know which conclusions are evidence-backed and which
are still open.

**Current state:** a working V0 agent harness (`v0/`), validated against a real LLM, classified
**READY_FOR_DEVELOPER_VALIDATION**. The next phase is about *people*, not architecture.

---

## 0. The one-paragraph version

We audited three real agent systems (QM, Hermes, Ruflo) at source level, extracted what actually
works from what is merely claimed, derived a first-principles architecture from the evidence,
proved the risky parts with throwaway experiments, hardened the result into a small V0, and then
drove that V0 with a real language model — killing the process mid-run to prove it recovers
coherently. Along the way we found and fixed real bugs at every stage, including five that a
310-assertion test suite could not see. The architecture is now technically validated. **Whether any
developer wants it remains completely unproven.**

---

## 1. The five phases

Each phase had its own brief and produced its own artifacts. They build on each other strictly.

| # | Phase | Question it answered | Primary output |
|---|---|---|---|
| 1 | **Audit** | What do QM, Hermes and Ruflo actually do, as opposed to claim? | `research/FINDINGS.md`, `COMPARISON.md`, `LESSONS.md` |
| 2 | **Design** | What architecture does that evidence imply? | `research/ARCHITECTURE.md`, `DECISION-MATRIX.md`, `NEXT-HARNESS-SPEC.md` |
| 3 | **Proof** | Which of those decisions survive contact with a benchmark? | `research/proof/`, `VALIDATION.md`, `ARCHITECTURE-REVISION.md`, `PRODUCT-DECISION.md` |
| 4 | **Harden** | Does the durable core survive concurrency, crashes and attack? | `v0/`, `research/v0-hardening/`, `ADRs/` |
| 5 | **Real model** | Can a real LLM operate coherently inside it? | `research/real-model/`, `V0-READINESS.md` |

---

## 2. Phase 1 — Source-level audit

Three repositories were cloned (still in `research/repos/`, treeless clones) and audited **by
reading source and running code**, never by summarising READMEs.

Pinned commits — every finding refers to these:

| repo | HEAD | what it turned out to be |
|---|---|---|
| QM | `c7caba56` | a **governance shell** — it does not own an agent loop; it rents four (Pi, Claude SDK, Codex, OpenCode) and owns tenancy, policy, audit and durable execution around them |
| Hermes Agent | `d62a05e9` | a real **harness** — 2.5M lines, its own loop, 86 tools, 37 providers, a genuine self-improvement loop |
| Ruflo | `e21aa352` | a **meta-harness** whose flagship feature is inert |

### The three findings that shaped everything after

1. **Ruflo's "SONA neural self-learning" is a mathematical no-op.** The LoRA `B` matrix is allocated
   as zeros and never written again, so the transform returns its input bit-for-bit. Proven by
   reproducing the function and executing it (`research/evidence/benchmarks/sona_identity_proof.mjs`
   → `max|out−in| = 0`). Its CLI reports this path as *"Neural Network Status (Real) — Active"*.
   → This is why **`degraded` events are mandatory** in our design: a path that does nothing must
   not be able to report itself healthy.

2. **QM's command policy is the best code in the audit** — a 911-line recursive shell parser
   defeating heredoc/ANSI-C/pipe-to-shell evasion. And its durability (lease → reaper → CAS →
   poison bound) is the only credible answer to "the process died at step 17".
   → This became our lease model.

3. **Hermes' loop is a 6,550-line `while` body** carrying state on a god-object across 50+ private
   attributes, with a 13,220-vs-3,307 `fix:`-to-`feat:` commit ratio.
   → This is why our core is ~2,300 lines and why `CONTRIBUTING.md` has a hard rule about it.

**Anti-pattern that recurred and shaped our testing:** Ruflo has 571 test files, and its flagship
`learn()` test asserts only `.resolves.not.toThrow()`. A body of `return 0;` passes it unchanged.
→ **Assert effects, not the absence of exceptions.**

---

## 3. Phase 2 — Design from primitives

`research/ARCHITECTURE.md` derives everything from one commitment:

> **The Run is an append-only event log; state is a bounded projection of that log; nothing mutates
> a Run except by appending an Event.**

From that single idea, resume / replay / fork / explain stop being four subsystems and become four
readings of one mechanism. `DECISION-MATRIX.md` records 16 design decisions with alternatives and
migration paths; three were identified as one-way doors.

---

## 4. Phase 3 — Proof before building

Throwaway experiments (`research/proof/`) to attack the risky decisions **before** committing.
Two came back negative, and both changed the architecture:

- **Experiment 1 (event log performance).** The projection as specified contained `messages[]` and
  therefore grew without bound — 8 MB at 100k events, **p99 = 100 ms on Postgres against a 50 ms
  target**. Snapshot interval barely mattered, which is the signature of a cost that is not in the
  tail replay. → **ADR-001: bounded projection.** Result: 10.2 KB at 1,000,000 events, flat.

- **Experiment 2 (tool recovery).** The proposed per-tool `idempotency` flag was refuted in two
  lines: `bash("echo x >> f")` duplicates on re-issue, `bash("mkdir -p a/b")` does not. Same tool,
  opposite safety. → **ADR-002: recovery is per *invocation*.** An unplanned bonus: `patch` and
  `git commit` **reject their own replays**, which became **ADR-003: `SELF_VERIFYING`**.

- **Experiment 3 (external adapter).** Adapting the real Claude Agent SDK showed a closed event
  vocabulary loses 33 field kinds including cost and latency → **ADR-004: closed types, extensible
  payloads.** It also showed the SDK emits no "tool started" signal → **ADR-005: recovery
  granularity is a declared capability**, and rented loops only get turn-level recovery.

- **Experiment 4 (time-travel prototype).** 44/44 including a real `SIGKILL`. Also revealed a
  livelock that only `max_turns` stopped → **ADR-006: `no_progress` as a first-class reason.**

Phase 3 ended at **BUILD — MODIFIED**: build it, but as a validation release, because the product
question was untouched.

---

## 5. Phase 4 — Harden into V0

`v0/` was built as a clean repository: Node 24+, ESM, **zero dependencies, no build step**
(uses the built-in `node:sqlite`).

Hardening added, each with a failing test written first:
- token-fenced event appends and expiry-aware writes (**ADR-008: execution fencing**)
- a fail-closed test runner (a crashed suite must not read as green)
- 16-scenario crash matrix with real `SIGKILL` at 8 loop positions
- 6-process claim storm and a 400-step randomized lease soak
- a security suite that *attacks* rather than checklists

Bugs found by that work included a sandbox root that resolved to `C:` (voiding every containment
check) and a `maxBuffer` overflow that put 64 KB of output into an error message.

---

## 6. Phase 5 — Real-model validation

**This was the phase everything had been waiting for.** Four prior phases could not answer it
because no model credentials existed. The user supplied a self-hosted **vLLM endpoint running
`gemma4-31b`** on the local network, which unblocked it.

### The milestone, achieved

```
REAL MODEL → REAL TASK → REAL TOOL EXECUTION → REAL SIGKILL
   → NEW PROCESS → CORRECT RECOVERY → COHERENT CONTINUATION → REPLAY / FORK
```

Killed at 50%, with `step1` and `step2` already on disk:

```
  24  ✓ write → wrote notes/step2.txt
  27  ⚠ lease lost (lease_expired)        <<< CRASH / RESUME SEAM
  31  🧠 wants 1 tool call: write  642 tok
  34  · write {"content":"gamma","path":"notes/step3.txt"}
```

The resumed model wrote **step3, not step1 again** — at all three kill points, zero duplicate
writes. Prompt tokens rise monotonically across the seam (530→552→597→642→687), so the context was
genuinely reconstructed rather than restarted from a bare prompt.

### Five bugs 310 passing tests could not see

| # | bug | consequence | ADR |
|---|---|---|---|
| 1 | `claim()` excluded `'paused'` | **every escalated run was permanently unresumable** | ADR-009 |
| 2 | client-internal retries were invisible | a run limping through 4 failures looked clean | ADR-010 |
| 3 | provider shims were invisible | a rewritten response left no trace | ADR-010 |
| 4 | `restore()` crashed on an empty checkpoint, and left post-checkpoint files behind | fork-with-rewind silently produced a superset | `time-travel.md` |
| 5 | mid-turn fork is semantically ambiguous | model read `[no result recorded]` as "already done" | `time-travel.md` |

**Bug 1 deserves attention.** An older test helper contained `const target = claimed ?? runId` — a
fallback that used the run id even when the claim returned `null`. **The helper masked the bug and
the assertion passed for the wrong reason.** A real model found it on the very first task, because
it escalated naturally.

### A live infrastructure note

The vLLM endpoint runs **without `--enable-auto-tool-choice --tool-call-parser`**, so tool calls
arrive as raw text with `tool_calls: []`. An unmodified OpenAI-compatible client **terminates on
turn one.** Handled in a named shim (`v0/src/agent/model/shims/gemma-tool-calls.mjs`), never in the
core. Restarting vLLM with those flags would remove the need.

---

## 7. Repository map

```
harness/
├── PROJECT-JOURNEY.md      ← you are here
├── V0-READINESS.md         ← current status + final classification
│
├── v0/                     ← THE PRODUCT (~2,300 LOC src, ~3,100 LOC tests, 0 deps)
│   ├── src/core/           event, run/store, projection, recovery, replay, lease/reaper
│   ├── src/agent/          loop/worker, model (+shims), tools
│   ├── src/sandbox/local/  containment + git shadow-repo checkpoints
│   ├── src/auth/default/   the authorize(action, ctx) seam
│   ├── src/cli/            run · list · status · resume · answer · explain · replay · fork · rerun · reap · doctor
│   ├── tests/              9 regression suites + tests/real-model/ (needs a live endpoint)
│   ├── ADRs/               10 ADRs — every architectural change, with the evidence that forced it
│   └── docs/               ARCHITECTURE · RECOVERY · REPLAY · FORKING · TOOLS · MODEL-ADAPTERS · SECURITY
│
└── research/
    ├── FINDINGS.md · COMPARISON.md · LESSONS.md          ← phase 1 (audit)
    ├── ARCHITECTURE.md · DECISION-MATRIX.md · NEXT-HARNESS-SPEC.md · OPEN-QUESTIONS.md   ← phase 2
    ├── VALIDATION.md · ARCHITECTURE-REVISION.md · PRODUCT-DECISION.md · proof/           ← phase 3
    ├── v0-hardening/                                      ← phase 4
    ├── real-model/                                        ← phase 5
    ├── notes/     timestamped log incl. dead ends and self-corrections
    ├── evidence/  command outputs, the SONA identity proof
    └── repos/     the three audited repos (treeless clones, ~pinned commits)
```

### Reading order for a newcomer

1. `V0-READINESS.md` — where things stand
2. `research/real-model/summary.md` — the most recent evidence
3. `v0/README.md` then `v0/docs/ARCHITECTURE.md` — what the thing is
4. `v0/ADRs/` in order — every decision and the evidence that forced it
5. `research/FINDINGS.md` — only if you want to know *why* the design looks like this

---

## 8. How to run it

```bash
cd v0
node --version                       # needs Node 24+ (built-in node:sqlite)
node tests/run-all.mjs               # 310 assertions, ~53s, no credentials needed
```

Real-model suites need a live OpenAI-compatible endpoint:

```bash
export HARNESS_BASE_URL=http://<host>:8000/v1
export HARNESS_API_KEY=<key>
export HARNESS_MODEL=gemma4-31b
node tests/real-model/01-basic.mjs           # 18 assertions
node tests/real-model/03-behaviour.mjs       # 23
node tests/real-model/09-crash-resume.mjs    # 21 — the primary experiment
node tests/real-model/12-timetravel-security.mjs   # 33
```

The CLI:

```bash
node src/cli/index.mjs doctor
node src/cli/index.mjs run "fix the bug in src/calc.js and verify"
node src/cli/index.mjs explain <run>
node src/cli/index.mjs fork <run> --at <seq>
```

**Credentials are passed by environment variable only and are never written to disk.**

---

## 9. Standing rules (please keep these)

These are not style preferences; each was learned by being burned.

1. **Nothing enters `src/core/` without a concrete failure mode it solves.** `CONTRIBUTING.md` has
   the PR template. This is the only reason the core is 2,300 lines and not 267,000.
2. **Assert effects, not the absence of exceptions.** `not.toThrow()` is how a flagship no-op
   shipped in one of the audited projects.
3. **A crash test must actually crash.** Two early tests killed nothing — a child's own
   `setTimeout(kill)` never fired because a busy-wait blocked its event loop. Kill from the
   **parent**, and assert the child was alive first.
4. **Never let a test helper fall back on failure.** `claimed ?? runId` hid a bug that would have
   broken every escalated run in production.
5. **Every fallback emits `degraded`.** Including retries inside a client library and shims that
   rewrite a response (ADR-010).
6. **Do not weaken the test runner to make the suite green.** It fails closed deliberately.
7. **Provider quirks live in named shims, never in the core.**
8. **Do not claim PMF, demand, or adoption.** No developer has used this.

### Explicitly NOT to be built (each was considered and deferred)

semantic memory · skills · subagents/swarms · MCP · multiple model providers · multiple sandbox
backends · Postgres · consensus · RL · learned routing · planners · visual builders · marketplace ·
chat integrations

Several of these exist in the audited projects and are **unreachable or uncalled there**. That is
the outcome rule #1 exists to prevent.

---

## 10. What is proven, and what is not

**Proven (technical):**
event log as source of truth · bounded projection (10 KB at 1M events) · per-invocation recovery
with `verify()` · replay ≠ rerun under real nondeterminism · fork with provenance · crash → reaper →
resume with a real model and zero duplicate effects · lease fencing under 6-process contention ·
the authorization seam holding against a model told to bypass it · no silent degradation.

**NOT proven:**
1. **That any developer wants this.** Zero interviews, zero installs. The instrument is written with
   pre-registered thresholds at `research/proof/05-developer-validation/PROTOCOL.md` and has **never
   been run**.
2. Context-window **overflow** with a real model — clamping is proven, *elision* is not (34
   messages, 0 dropped).
3. Only one model, one provider.
4. No *naturally occurring* orphan — every random kill landed on `model.requested`, so the
   reissue/skip/escalate branches were verified with induced orphans.
5. Multi-host leases (wall-clock expiry assumes no clock skew); Postgres at scale.
6. Long multi-hour tasks with mid-task discoveries.

**The strongest argument against the whole project, unchanged since phase 1 and unanswered:**
Hermes has the largest user base of the three audited systems and **no run-level durability at
all.** Its users re-run failed tasks and cope. That is a real market signal against the central
premise, and no amount of passing tests addresses it.

---

## 11. What the next phase should do

**Put V0 in front of 20–30 developers who already ship agents.** Run
`research/proof/05-developer-validation/PROTOCOL.md` as written — the demo script, the non-leading
interview guide, and the pre-registered decision rule (BUILD / PIVOT / STOP). Do not re-open the
architecture first.

Two small technical items worth doing in the same window:
- force a real context-window overflow to close unknown #2;
- run one long unattended task to test resume coherence harder than a 6-step task does.

A plausible **PIVOT** is already visible in the evidence and should not be resisted if it appears:
replay and explain work on runs the harness did not execute, which is a *debugger* value
proposition needing no durable runtime at all. The protocol's pivot trigger is "developers use
replay/explain but ignore resume."
