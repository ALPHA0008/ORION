# Architecture Refactor Assessment

Judged **only** on the eight criteria in the brief. Aesthetic organisation is explicitly not a
reason to recommend a rewrite.

## Criterion-by-criterion

### 1. Public API clarity — **MINOR CLEANUP**

The module graph is a shallow tree: **9 of 14 modules have zero internal imports**; coupling is
concentrated in the CLI (10) and worker (7), exactly where composition belongs. `eval/` already
consumes the runtime as a library across 9 modules — a working second consumer that proves the
boundaries hold.

Missing: an `exports` map and a root barrel. That is a manifest, not an architecture.

### 2. Installability — **MINOR CLEANUP** (but currently blocking)

No `package.json`. Everything else is favourable: zero dependencies, no build, plain ESM,
location-independent CLI. Adding a manifest is hours of work.

### 3. Provider isolation — **NO CHANGE NEEDED**

Quirks are confined to shims applied to the **normalised result**; shims are conditional and inert
for well-behaved providers; every application emits a `degraded` event. The Qwen quarantine required
**zero** `v0/src` changes — the strongest possible evidence the isolation works.

Only nit: shims are registered positionally, not by name.

### 4. Tool isolation — **MINOR CLEANUP**

`makeTools(sandbox)` is a clean factory; `toolDefinitions()` strips internal fields; each tool
declares `effects` and a recovery class. Two **behavioural** defects in `grep` — not structural.

### 5. Runtime stability — **NO CHANGE NEEDED**

**608 tests passing, 0 failing, 23 suites** — executed in this audit. 13 ADRs, each forced by
measured evidence. Crash matrix, lease/fencing, replay equivalence, escalation lifecycle all covered.

### 6. Event-log integrity — **NO CHANGE NEEDED**

A frozen, closed 31-type set with `isKnownType` rejection. Append-only SQLite. Replay verified live
to reconstruct with zero model calls. Three types are declared-but-unproduced
(`context.retrieved`, `child.*`) — ship as **reserved**, do not remove, since removal would break
the frozen-set guarantee later.

### 7. CLI usability — **MINOR CLEANUP**

Twelve implemented commands, verified live. Better than expected: `fork` detects mid-turn splits and
proposes a clean boundary; `run` prints next actions on pause. Gaps: not installed as a binary, no
`--json`, no `--version`, and `run` **exits 0 on a config failure**.

### 8. Testability — **NO CHANGE NEEDED**

51 test files, self-contained runner (`node v0/tests/run-all.mjs`), no framework dependency, helpers
for fake/script/real providers and crash injection.

## Verdict: **MINOR CLEANUP**

| criterion | assessment |
|---|---|
| public API clarity | minor cleanup (exports map) |
| installability | minor cleanup (manifest) — currently blocking |
| provider isolation | none needed |
| tool isolation | minor cleanup (`grep` defects) |
| runtime stability | none needed |
| event-log integrity | none needed |
| CLI usability | minor cleanup (bin, `--json`, exit codes) |
| testability | none needed |

**Nothing on the list requires a significant refactor, and nothing requires a rewrite.**

## Why not "significant refactor"

The tempting arguments, and why each fails:

- *"`v0/` is a phase name, not a product name."* True, but cosmetic — and renaming would break every
  `eval/` import path, i.e. the evidence base. A stable `exports` map solves the naming problem
  without touching a single evidence path.
- *"`worker.mjs` is 527 lines."* Large, but it is the orchestrator, it is heavily tested, and
  splitting it would churn the most safety-critical module for no measured benefit.
- *"There is no plugin system."* There is one provider family and one sandbox. Abstraction is
  unearned; building it now would be speculative generality.
- *"Product, evaluation and research share a repo."* A real concern — addressed in
  `repository-boundary.md` — but a packaging/publishing decision, not an architecture one.

## The honest risk

The runtime is **coherent**; the *product* is **unpackaged**. That is a favourable failure mode: the
hard part (execution semantics, durability, recovery, replay) is done and tested, and the remaining
work is conventional. The main risk to watch in Wave 2 is scope creep — the temptation to "fix" the
directory layout while adding the manifest, which would put evidence paths at risk for aesthetic
gain.
