# OSS v0.1 Release Contract

The minimum credible first release. Each item marked **READY** / **PARTIAL** / **MISSING** on
implementation evidence. **Nothing missing is implemented in this wave.**

| # | item | status | evidence / gap |
|---|---|---|---|
| 1 | **install** | **MISSING** | no `package.json` anywhere; cannot `npm i` / `npx`; no `harness` binary |
| 2 | **configure provider** | **READY** | 5 env vars, documented in `--help`; unconfigured error names the exact variables |
| 3 | **run** | **READY** | `run "<task>"` verified end-to-end (~35 s, local model) |
| 4 | **tools** | **PARTIAL** | 6 tools implemented; **`grep` has 2 defects** (file paths fail; searches `.harness/`) |
| 5 | **durable event log** | **READY** | frozen 31-type closed set; append-only SQLite; `isKnownType` rejection |
| 6 | **recovery** | **READY** | 6 classes, `decideRecovery`, ADR-011 witness, fencing, `repairOrphans`; crash matrix green |
| 7 | **inspect** | **READY** | `status`, `list`, `explain` — all verified live |
| 8 | **replay** | **READY** | verified live: 17 events reconstructed, **no model calls** |
| 9 | **fork** | **PARTIAL** | works and warns on mid-turn splits; **workspace is not rewound** (stated by the tool) |
| 10 | **clear security semantics** | **PARTIAL** | real controls (path containment incl. symlinks, output bounds, `scrubEnv`, 3 postures); `SECURITY.md` needs the "not OS isolation" sentence and the `bash` asymmetry |
| 11 | **tests** | **READY** | **608 passed / 0 failed / 23 suites**, executed this audit; no framework dependency |
| 12 | **documentation** | **PARTIAL** | 7 topic docs + 13 ADRs exist; README shows a `harness` binary that does not exist; no install/Node-version docs |
| 13 | **example** | **MISSING** | no `examples/` directory |
| 14 | **license** | **MISSING** | no `LICENSE`; README says all-rights-reserved |

## Summary

| status | count | items |
|---|---|---|
| **READY** | 7 | configure, run, event log, recovery, inspect, replay, tests |
| **PARTIAL** | 4 | tools, fork, security docs, documentation |
| **MISSING** | 3 | install, example, license |

## Blocking vs non-blocking

**Blocking for any OSS release:**
1. `LICENSE` — without it the repository is not open source, whatever the README says.
2. `package.json` — without it nothing is installable and the README's own examples are unrunnable.

**Blocking for a *credible* release:**
3. `grep` file-path defect — it fires on a first realistic task in a clean directory and makes the
   agent report a present file as missing.
4. One runnable example — the thesis is trajectory manipulation; shipping it undemonstrated wastes
   the differentiator.

**Not blocking, document instead:**
- fork does not rewind the workspace (the CLI already says so)
- `bash` is observable and conservatively authorized but **not** pre-state witnessed
- `explain` renders *what*, not *why*
- no streaming; one provider family

## What v0.1 should NOT claim

- Not competitive agent capability (Stage 1 measured 2–3/17, 2/18).
- Not enterprise governance — that is Kernlbase and unbuilt.
- Not OS-level sandbox isolation.
- Not multi-provider maturity.

## The one-line pitch v0.1 can honestly make

> An agent runtime where the run is a durable object you can inspect, replay without cost, and fork
> from any point — with 13 ADRs and 608 tests behind the execution semantics.

Every clause is backed by an artifact verified in this audit.
