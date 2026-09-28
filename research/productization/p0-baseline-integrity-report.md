# P0 — BASELINE INTEGRITY

**Contract:** v6 / 49 event types — **unchanged** (FACT, gate run P0-14). The new `degraded` payload
(`what: 'legacy_shadow_ignored'`) uses the existing `degraded` type; no type added.
**Suite:** 2305 / 0 / 50 (recorded on the previous machine, Node 24) → **first run on this machine
2139 / 1 / 50** (P0-02) → **2379 passed / 0 failed / 52 suites** (Node 22.17.0, Docker up, cgroup v1;
P0-14). All numbers are from a dirty pre-commit tree; commit column in the plan is "pending".
**Dependencies:** unchanged — 0 required, 1 optional (W9 MCP SDK). None added.
**Live gate:** not run in P0 (see §11.4).

---

## THE PROBLEM

The plan's baseline was not the tree. Three shipped-source fixes sat uncommitted with no regression
test, the suite had never been run on this machine, and the first run failed. Nothing measured on
top of that (E5, E6, concurrency) could be trusted to attribute a failure to the agent instead of
the rig (Doctrine lesson 1).

User-visible failures found while establishing the baseline:

1. **`orionctl <verb> --json 2>&1` produced corrupt JSON on Node 22** — Node 22.17 prints
   `ExperimentalWarning: SQLite is an experimental feature` to stderr when `node:sqlite` links.
   `engines` allows >=22. (MEASURED, P0-03; deterministic repro.)
2. **Cross-project checkpoint exposure (HIGH).** Shadow-git repos were named from the first 8 bytes
   of the workspace path (hex, 16 chars). Every workspace sharing an 8-character path prefix — e.g.
   everything under `C:\Users` — shared **one** checkpoint repo: one project's file content in
   another's history, and restore contamination. Same-user, local. (FACT, P0-01, P0-08.)
3. **Store open/commit contention:** `busy_timeout` was armed after `journal_mode=WAL`, and
   `BEGIN IMMEDIATE` could still surface `SQLITE_BUSY` and kill a run.
4. **Unbounded `requestTimeoutMs`:** a value below 1s aborts every request; above 2^31-1 overflows
   `setTimeout` to ~1 ms — an abort storm either way. (FACT, P0-08.)
5. **qwen3.x under OpenAI-compat** returns its whole answer as reasoning deltas with empty content.

---

## CHANGES BY FILE

| File | Change | Why (design reasoning) |
|---|---|---|
| `v0/src/core/run/store.mjs` | `PRAGMA busy_timeout=5000` moved **before** `journal_mode=WAL`; `tx()` retries `BEGIN IMMEDIATE` up to 5 x 250 ms on SQLITE_BUSY | WAL takes a brief exclusive lock, so it ran at timeout 0. Retry wraps BEGIN only, so `fn` never re-executes and cannot double-append; fencing unaffected (P0-09). Fails closed after 5 retries. |
| `v0/src/core/run/store.mjs` | `node:sqlite` loaded lazily via cached `createRequire` on first `new Store()` | Node 22 warns at link time; a static import fires before any entry point can install a filter. Library users now see the warning at first Store construction instead of import (RISK, P0-06). Design note: a bin shim was tried and rejected because the warning fires before a static-import filter runs. |
| `v0/src/cli/warnings.mjs` (NEW) | `isSqliteExperimentalWarning` + `filterSqliteExperimentalWarning`: wraps `process.emitWarning`, drops only `ExperimentalWarning` matching `/\bSQLite\b/`; idempotent | Narrow by design, not `NODE_NO_WARNINGS`. No `degraded` event: it is a cosmetic Node notice, not a capability loss (ADR-010). Text-match failure mode is safe (warning stays visible). |
| `v0/src/cli/index.mjs` | Installs the filter only inside the is-main-module guard before `await cli()` | Importers of the CLI module keep Node's default warnings. `package.json` bin unchanged. |
| `v0/src/cli/index.mjs` | `selectShims`: `/qwen/i` model name selects `applyReasoningAsContent` | Recovers answers stranded in `ext.reasoning`. Match is broad; proven a no-op when content is present (T3). Never touches `tool_calls`. |
| `v0/src/cli/index.mjs` | Shadow-repo name `sha1(workspace).slice(0,16)` instead of `hex(workspace).slice(0,16)` | **HIGH fix.** Hash of the whole path removes the shared-prefix collision. Consequence: old shadows are orphaned, so pre-upgrade checkpoints are unreachable (see below). |
| `v0/src/cli/index.mjs` | `noticeLegacyShadow()` in `prepareRun`: one `existsSync` on the legacy path; if present, appends `degraded {subsystem:'checkpoints', what:'legacy_shadow_ignored', path, reason}` under the run's lease and prints one stderr line | Silent orphaning would be a silent behaviour change (invariant-reviewer M2). A legacy **fallback** was rejected: it would re-open the shared cross-project store (P0-09 orchestrator note). The legacy dir is never opened. |
| `v0/src/config/index.mjs` | `requestTimeoutMs` (env `ORION_REQUEST_TIMEOUT_MS`) bounded to [1000, 2147483647] via exported `isValidRequestTimeoutMs`; number env coercion (`Number(raw)`) for `type:'number'` keys | Bounds prevent both abort storms. Env bypasses the schema `validate` hook, so `cli/index.mjs` re-applies the same guard: out-of-range env falls back to the provider default (60 s). Error text keeps "positive number". |
| `.gitignore` | Adds `v0/eval/results/` | Measurement output is never committed (Doctrine §7). Diff shows this one addition; other hygiene entries proposed in P0-01 are not in this diff (see Deviations). |
| `v0/tests/run-all.mjs` | Registers `p0/baseline` and `shipped/p0-shipped` | New suites must be in the fail-closed runner. |

Test-side changes are under TESTS.

**Consequence for users (FACT):** after upgrade, pre-existing checkpoint SHAs live only in the
legacy shadow. A restore of a pre-upgrade run's checkpoint will fail **loudly**, not silently
(P0-09 M1). Accepted trade-off against the HIGH exposure.

---

## TESTS

Made-to-fail = the test was run against the pre-fix source and failed; source then restored
(sha1 verified identical, P0-05).

| ID | File | Asserts | Made-to-fail evidence |
|---|---|---|---|
| T1 | `v0/tests/p0/baseline.test.mjs` | Store under lock contention (worker_threads lock holder): retry succeeds; PRAGMA order (`busy_timeout` precedes WAL); deterministic tx-retry unit | Retry RED "database is locked" (36/40); PRAGMA order RED (MEASURED, P0-05) |
| T2 | same | Config `requestTimeoutMs` file + env honoured; wiring reaches the provider (configured timeout, not 60 s default); guard proven against a naive unguarded fix | RED "expected 1234, got undefined"; wiring RED "still waiting after 10s"; naive fix "expected 1, got 3". Fixture later moved 150 → 1000 ms to match the approved bound, plus one assertion (each attempt waited ~1000 ms, total >= 4 s); wiring reverted → 55/3 (P0-12) |
| T2b | same | File values 1 / 999 / 1e10 / 2147483648 → `ConfigError`; 1000 and 2147483647 accepted; env 1 / 999 / 1e10 → no abort storm | RED 48/9 (P0-10) |
| T3 | same | qwen model selects 1 shim; shim is a no-op on content-bearing replies | RED "0 shim(s)" / content "". Content-bearing no-op held on unmodified code (no src bug found) |
| T4 | same + `shipped/p0-shipped.test.mjs` | Two workspaces sharing an 8-char prefix get distinct shadow paths; reachable via the shipped CLI | RED "expected 2, got 1" (module and shipped) |
| T5 | `shipped/p0-shipped` | `--json` output with stderr merged parses on Node 22 | RED: merged output starts with ExperimentalWarning, shipped/p0 4 passed / 3 failed (P0-05) |
| T6 | `shipped/p0-shipped` | Legacy shadow left byte-identical; stderr notice names the dir; `degraded` event carries subsystem + reason; control case (no legacy dir) emits nothing | RED shipped/p0 14/4 (P0-10). **T6 assertion (1) also passes on old code** (the legacy dir is untouched because the old code never looked at it), so it is not itself a discriminator. Assertions (2)-(4) are the ones that failed. |
| limits layout-aware | `v0/tests/sandbox/limits.test.mjs` | Instrument fix: cgroup v2 branch unchanged; v1 equivalents read; unknown layout = loud SKIP; read failure = FAIL assertion, not throw. Channels 2b/2c also layout-aware | Before: suite exited 1 with 0 assertions (`cat /sys/fs/cgroup/cpu.max` failed on cgroup v1). After on this rig: 23/0. v1 branch fails closed (quota -1, "max", missing file all FAIL; P0-13 review). No pre/post code-flip proof, because this is an instrument fix. |
| w6 stdout parse | `v0/tests/shipped/w6-shipped.test.mjs` | `orionctl()` returns stdout only; `grants --json` parsed from stdout | Before: 75/2 failure (P0-03). After: 77/0. Full sibling coverage of merged-stream case lives in T5. |

Results after: p0/baseline **58/0**, shipped/p0 **18/0**, shipped/w6 77/0, sandbox/limits 23/0 (MEASURED, P0-12/P0-14).

---

## GATES

### Level A (dirty tree, pre-commit; Node 22.17.0, Docker Desktop, cgroup v1)

| Check | Result | Tag |
|---|---|---|
| `npm test` | **2379 passed / 0 failed / 52 suites** | MEASURED (P0-14) |
| typecheck | clean | MEASURED |
| lint | clean, 115 files | MEASURED |
| Event contract | v6 / 49 | MEASURED |
| p0/baseline, shipped/p0 | 58/0, 18/0 | MEASURED |
| sandbox, network-live, crash/matrix-container, crash/matrix | 78/0, 26/0, 27/0, 6/0 | MEASURED |
| Tarball smoke (dirty-tree pack, fresh prefix) | `--help` OK, `doctor` OK, `grants --json 2>&1` parses | MEASURED |
| worldstate/real-repo-race | 0/0, reports OK, by-design UNPROVEN | FACT |
| Trajectory | first run here 2139/1/50 → 2379/0/52 = +240; vs old 2305/0/50 = +74 (INFERENCE: 76 new P0 assertions, 2 fewer elsewhere unexplained) | see §11.4 |

### Live gate (§11.2)

| Item | Run id | Result |
|---|---|---|
| Installed build + real model + SIGKILL/resume + replay 0 calls + fork | none | **NOT RUN in P0** |

---

## §11.4 WHAT IS NOT PROVEN

1. **Node 24 behaviour (UNKNOWN).** All results are Node 22.17.0. The old baseline was Node 24. T5's warning behaviour and the lazy-load path were not exercised there. Experiment: run `npm test` on Node 24.
2. **No live model gate in P0.** Nothing here proves a real-model run works end to end; the qwen shim was verified against fixtures only. Experiment: §11.2 gate on the committed SHA.
3. **Clean-checkout pack is pending commit.** Tarball smoke used a dirty-tree pack. Acceptance (fresh clone, `npm test`, pack, install) awaits the commit.
4. **8-process simultaneous open is not tested.** T1 uses a single lock-holder contender. The "2 of 8 → 0 of 8" figure in the source comment and plan B.1.1 is from the earlier machine and was **not reproduced here** (UNKNOWN on this rig; the plan figure is an inherited MEASURED claim from a different environment).
5. **Unknown-cgroup-layout skip counts as pass.** The runner treats the loud SKIP as OK (MEDIUM backlog). Only the v1 branch ran here.
6. **cgroup v2 branch of limits not run here** (rig is v1). The unchanged v2 code path was not re-proven on this machine. W6.1 "limits bind" is re-observed on v1 only (n=1).
7. **worldstate/real-repo-race is 0/0**; reports OK though UNPROVEN.
8. **~17 assertions of the first-run shortfall remain unexplained.** P0-03 accounted for -164 (container suites in SKIP mode, w6 uncounted) and +15 (stale HEAD), leaving ~17.
9. **Made-to-fail proofs were not re-run by reviewers** (P0-09); they rest on the test author's runs.
10. **T6(1) passes on old code** (see TESTS); only (2)-(4) discriminate.
11. **crash-matrix `events_at_end` is nondeterministic (54 or 55)** with n=2 matrix runs, n=8 isolated; trigger rate and load dependence not measured (P0-04).
12. **Legacy notice payload carries an absolute host path** under HOME (RISK, P0-11).
13. Library consumers of `Store` see the SQLite warning at first construction, not import (RISK).
14. Busy retries are unobserved (no event or metric), so a run that waited is indistinguishable from one that did not (LOW, P0-09).

---

## HOST FINDINGS (this machine, not product defects)

- **`C:\Users\abhi\.profile` is a directory.** `bash -lc` (`v0/src/sandbox/local/index.mjs:441,:555`) sources it, emitting stderr that chunks into 1 or 2 deltas, hence crash-matrix 54 vs 55 events. Benign; invariants intact (MEASURED, P0-04). Evidence DBs in `%TEMP%` (`v0-crash-1790627075413-2dee`, `v0-crash-1790627683557-6f6a`).
- **Docker Desktop 29.8.1 on WSL2 runs cgroup v1** (`docker info`). Limits bind on v1 with product flags: quota == period, CPU peak 100.81%, OOM 137 + oom_kill 1, pids 256/256, 147 fork denials (MEASURED n=1, P0-10).
- **Host profile leak -> P2 (RECOMMENDATION).** `bash -lc` sources the host profile into the local sandbox; security-reviewer rates it MEDIUM (env/secret exposure, reproducibility). Route to P2: `bash --noprofile --norc` with a scrubbed env.
- Library-level `process.exit(2)` in `makeSandbox` (`cli/index.mjs:376-382`) can silently abort a harness mid-start (INFERENCE, P0-03).
- Container suites run in SKIP mode when the Docker daemon is not up, and report OK, hiding ~87 assertions (gate honesty gap).

## BACKLOG (none block P0)

| Sev | Item |
|---|---|
| MEDIUM | Unknown-cgroup-layout SKIP is counted as pass; the gate should treat UNPROVEN as not-pass |
| LOW | Out-of-range `ORION_REQUEST_TIMEOUT_MS` falls back to 60 s silently (no stderr / degraded) |
| LOW | Legacy-shadow `degraded` event and notice repeat on every `prepareRun`, including resume; dedupe on `what:'legacy_shadow_ignored'` |
| LOW | Drive-letter case differences yield two shadows (harmless duplication) |
| LOW | `/qwen/i` shim match is broad (proven no-op on content) |
| LOW | `tests/crash/matrix.test.mjs:149` rewrites tracked `crash-matrix.json`; make `events_at_end` informational |

---

## Deviations from the brief

1. **Test author reset `v0/tests/results-limits.json`** via `git checkout --` (out of lane, P0-10). It is generated, uncommitted-churn, regenerated each run; orchestrator assessed no evidence lost. Recorded.
2. **T2 fixture change** 150 → 1000 ms was required by the user-approved bound; the configured-timeout proof was kept and strengthened (orchestrator decision, P0-11).
3. **Limits test and w6 test edits** are instrument fixes beyond the original T1-T4 proposal, made after the rig classification (P0-03, P0-07).
4. **`.gitignore`:** P0-01 proposed also ignoring `wg-fixtures`, `wg-homes`, `archify-out`, `conversations`; the tree diff shows only `v0/eval/results/` added. Commit-time hygiene is the release manager's job (explicit-path staging).
5. **Product surface exposing the capability:** `orionctl <verb> --json` (T5), `orionctl run` shadow checkpoints and the stderr notice (T4/T6), `ORION_REQUEST_TIMEOUT_MS` / config `requestTimeoutMs` (T2), `qwen*` model names (T3). Shipped-path assertions live in `tests/shipped/p0-shipped.test.mjs`.

---

## Evidence index

All under `.claude/orion/ledger/2026-09-29-P0-NN-<agent>.md`:

| NN | Agent | Subject |
|---|---|---|
| 01 | architect | BUILD NOW verdict; collision confirmed |
| 02 | gate-runner | first run 2139/1/50 |
| 03 | failure-analyst | w6 RIG triage; shortfall accounting |
| 04 | failure-analyst | crash-matrix 54/55, `.profile` directory |
| 05 | test-author | T1-T5 RED |
| 06 | implementer | GREEN 1; shim design rejection |
| 07 | failure-analyst | cgroup v1 rig classification |
| 08 | security-reviewer | HIGH shadow exposure; requestTimeoutMs LOW |
| 09 | invariant-reviewer | APPROVE; M1/M2 |
| 10 | test-author | limits layout-aware, T2b, T6 RED |
| 11 | implementer | bounds, legacy notice; T2 contradiction |
| 12 | test-author | T2 fixture correction |
| 13 | invariant-reviewer | delta APPROVE |
| 14 | gate-runner | Level A PASS 2379/0/52 |

Gate log: scratchpad `test.log` (session-local, not committed).
