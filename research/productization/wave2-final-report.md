# Wave 2 — Final Report

**Nothing was committed. Nothing was pushed. Nothing was published.**

## 1. Files changed (3, all under `v0/`)

| file | change |
|---|---|
| `v0/src/sandbox/local/index.mjs` | grep defects A + B (see §8) |
| `v0/src/cli/index.mjs` | `--version` / `-v` / `version`; `fileURLToPath` import |
| `v0/README.md` | rewritten for package consumption; stale claims corrected |

## 2. Files added (4)

| file | purpose |
|---|---|
| `v0/package.json` | `@kernlbase/harness@0.1.0` manifest |
| `v0/src/index.mjs` | public API barrel — 40 exports |
| `v0/LICENSE` | Apache-2.0, canonical text, copyright filled |
| `v0/examples/quickstart/README.md` | end-to-end example with **real** transcripts |

Audit records under `research/productization/` (untracked, never part of a package commit):
`wave2-start-state.md`, `wave2-provenance.md`, `wave2-package-identity.md`,
`wave2-regression-gate.md`, `wave2-final-report.md`.

## 3. Test baseline → final

| | baseline | final |
|---|---|---|
| passed | **608** | **608** |
| failed | **0** | **0** |
| suites | **23** | **23** |

## 4. Regression result

**PASSED — zero regressions.** Baseline observed and recorded in `wave2-start-state.md`, not
hardcoded. Full detail in `wave2-regression-gate.md`.

## 5. Package name / version

`@kernlbase/harness` · `0.1.0` · binary `harness` · Apache-2.0 · `engines: node >=22`.

## 6. npm validation

```
npm pack  →  kernlbase-harness-0.1.0.tgz
             41 files · 79.8 kB packed · 230.9 kB unpacked
npm install ./kernlbase-harness-0.1.0.tgz
             added 1 package, 0 vulnerabilities
```

"1 package, 0 vulnerabilities" independently confirms the zero-dependency claim.

## 7. Fresh-install validation

From a clean directory, consumer-style, using the **installed binary**:

| check | result |
|---|---|
| `npm install <tarball>` | 1 package, 0 vulnerabilities |
| `harness --version` | `0.1.0`, exit 0 |
| `harness --help` | usage, exit 0 |
| `harness doctor` | endpoint + `db integrity ok`, exit 0 |
| **real run** | `grep` → `read` → `edit`, `✓ model_finished`; **`calc.py` actually fixed** (`a - b` → `a + b`) |
| `harness replay` | 28 events, *"no model calls, no cost"* |
| `harness explain` | full sequenced trajectory with token accounting |
| `harness fork --at 10` | new run, history inherited |
| public API import | 40 root exports; `/store`, `/events` subpaths resolve |

## 8. grep fixes

**Defect A — file paths.** `grep(pattern, 'calc.py')` reached `readdirSync`, threw `ENOTDIR`, and
reported `(no matches)` plus *"1 director(y/ies) unreadable"* for a file that contained the pattern.
Fix: `statSync` decides; a directory recurses through `walk()` unchanged, a file goes to a new
shared `scanFile()`.

**Defect B — `.harness` traversal.** Searching `.` descended into the runtime's own event-log
database and workspace shadow repos. Fix: `.harness` added to the existing **name-based** exclusion
beside `.git` and `node_modules`, preserving the any-depth semantic. Verified: a nested
`sub/.harness/state.db` containing the pattern is excluded.

**Defect C — UTF-8 / binary.** Not redesigned, per instruction. Behaviour **documented in source**:
files are read as UTF-8, so a binary file is scanned as lossy-decoded text — it will not crash, but
matches in it are not meaningful. No stronger claim is made anywhere.

Both fixes were observed working in live runs (`✓ grep calc.py:1: def add(a, b):`).

## 9. CLI fixes

**`--version` added** — `-v`, `--version`, `version`, all exit 0. Reads `package.json` rather than
duplicating the version in source, so it cannot drift from what npm publishes.

**No exit-code change was needed.** Wave 1 reported *"`run` exits 0 when unconfigured"*. **That was
my measurement error** — the `0` came from a shell pipeline, not the process. Measured directly:

| invocation | exit |
|---|---|
| unconfigured `run` | **2** |
| missing argument | **2** |
| unknown command | **2** |
| `--help`, `--version`, `doctor` | **0** |

Correct already; left alone.

## 10. Provenance

**CLEAR.** No third-party license headers, no vendored directories, zero dependencies. Two
`borrowed from` comments attribute **ideas** (a policy-lattice principle; a shadow-repo approach),
not code. Verified by searching the audited repos for nine distinctive identifiers
(`createAuthorizer`, `attachCheckpoints`, `decideRecovery`, `classifyShell`,
`verifyProjectionEquivalence`, `nearestTurnBoundary`, `captureWitness`, `repairOrphans`,
`expected_pre_sha`) — **zero matches**. Language mismatch (their TS/Rust vs plain `.mjs`) confirms.

## 11. License

Apache-2.0 at `v0/LICENSE`, canonical text, `Copyright 2026 Abhijith P`. **No NOTICE file required**
— no dependencies, no derived source.

## 12. Public API

`v0/src/index.mjs` — **40 exports**, built on the API `eval/` already consumes across 9 modules, so
the boundaries were exercised before being published. Eleven subpath exports. Deliberately excluded:
`core/projection` (tuning), `core/lease` (operational), `compact` (off by default), model shims
(implementations), `cli` (composition root).

## 13. Tarball contents

41 files: `src/**` (16 `.mjs`), `docs/` (7), `ADRs/` (13), `examples/quickstart/`, `README.md`,
`LICENSE`, `CONTRIBUTING.md`, `package.json`.

**Excluded and verified absent:** `research/`, `eval/`, productization notes, `tests/`, `*.db`,
`.harness/`, `node_modules/`, benchmarks. Leakage grep: **0 matches**.

## 14. Known limitations (documented, not hidden)

- `fork` rewinds **history, not the workspace** — stated by the CLI, README and example.
- `bash` is observable and conservatively authorized but **not pre-state witnessed**; documented in
  README and `docs/TOOLS.md`.
- grep reads UTF-8; binary files are scanned as lossy text.
- Sandbox is **path containment, not OS isolation**; `bash` runs with the invoking user's privileges.
- One OpenAI-compatible provider family; no streaming.
- `explain` renders **what** happened, not **why** the model chose it.

## 15. Deferred

- **`--json` output (Phase 7)** — **deferred deliberately.** Every command writes human-formatted
  text directly to stdout via `console.log`; adding `--json` would mean interleaving two output
  modes in the same paths. Per the instruction not to retrofit JSON onto unstructured output, this
  is left for a wave that can restructure the CLI's output layer properly.
- **CI (Phase 12)** — not added. No CI configuration exists in the repository today and adding one
  would be the first; it is a repository-owner decision (provider, secrets, triggers) rather than a
  packaging necessity. The commands a CI job needs are already single-line: `node tests/run-all.mjs`
  and `npm pack`.
- Workspace-rewinding fork; streaming; additional provider families.

## 16. Corrections made to the Wave-1 audit

Three Wave-1 findings were wrong and are corrected in the record:

1. **CLI shebang** — Wave 1 said it needed adding; it was already present.
2. **CLI exit codes** — Wave 1 said `run` exits 0 unconfigured; it exits 2. Measurement error.
3. **Event type count** — Wave 1 said 30; it is **31**. Corrected in all eight documents that cited
   it, including the shipped README.

Had I trusted my own audit instead of re-measuring, I would have "fixed" correct code twice and
shipped a wrong number.

## Environment qualification (post-hoc, before commit)

The authoritative Wave-2 baseline (608/608) was measured in an environment where the
security suite's bash-dependent checks executed successfully. A subsequent Windows environment
without a usable Git Bash / WSL bash reproduced **567 passed** with the `security/security` suite
**aborting during a `LocalSandbox.exec` bash invocation** (0 tests run, reported as the single
"failed" suite line).

- The `security.test.mjs` was **unchanged** during Wave 2 (same six test definitions in HEAD and on
  disk), so this is classified as a **pre-existing environment compatibility limitation**, not a
  Wave-2 regression.
- The `LocalSandbox.exec` path spawning `/bin/bash` is pre-existing runtime code; Wave 2 did not
  touch it.
- **Cross-environment status:** not fully verified. Windows bash compatibility remains an existing,
  deferred limitation (resolve in a future wave that changes execution semantics, with its own
  regression gate).

Wording to use going forward: *"Wave-2 regression gate passed against the recorded baseline; an
existing Windows bash-environment incompatibility prevents the full security suite from
reproducing in that environment."* Not "608 tests universally pass."

Additionally, running the suite rewrites three time/nonce-variant result snapshots
(`results-concurrency.json`, `results-provider.json`, `results-replay.json` — lease tokens, run ids,
nonces, and timing values). These are incidental test-output churn, not product changes, and were
excluded from the product commit (`git restore`).
