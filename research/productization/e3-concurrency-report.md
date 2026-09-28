# E3 — Store Concurrency Ceiling (measured after shadow-dir fix)

**Store:** one SQLite file per ORION_HOME (WAL, `busy_timeout=5000`), shared across N concurrent CLI processes
**Workload:** "read lib/index-records.mjs and explain edgeKey in ≤3 lines" on a 10-file subtree of ruflo
**Model:** qwen3.6:35b-a3b-q4_K_M @ localhost:11434/v1 (one Ollama process serializes token generation — see §4)
**Runs:** levels 2,4,8,16 × 2 reps = 8 cells, `run-e3.mjs --levels 2,4,8,16 --reps 2 --label e3-scale2`
**Results file:** `v0/eval/results/e3-scale2.json` (gitignored)
**Date:** 2026-09-16

## Verdict

| level | rep | completed | store | verdict |
|---|---|---|---|---|
| 2 | 1 | 2/2 | clean | PASS (mean 10.0s/run, total 10.6s) |
| 2 | 2 | 2/2 | clean | PASS (mean 9.8s/run, total 10.4s) |
| 4 | 1 | 4/4 | clean | PASS (mean 14.1s/run, total 15.8s) |
| 4 | 2 | 4/4 | clean | PASS (mean 14.0s/run, total 15.7s) |
| 8 | 1 | 7/8 | clean | **FAIL** — `cli exit 1: database is locked` (one run) |
| 8 | 2 | 8/8 | clean | PASS (mean 22.5s/run, total 26.4s) |
| 16 | 1 | 16/16 | clean | PASS (mean 40.2s/run, total 48.5s) |
| 16 | 2 | 16/16 | clean | PASS (mean 40.0s/run, total 48.3s) |

**Reported ceiling per the strict rule: 4 concurrent runs against one store.** The single failure above that was a `database is locked` at L8 rep1 — SQLite's 5s `busy_timeout` expiring under contention, **not** corruption: verification (`verifyProjectionEquivalence`, seq 1..N with no gaps/dups, lease integrity, non-terminal sweeps) is **clean in every one of the 8 cells including the failed one**. L16 passed twice with a fully clean store.

## 1. What the ceiling actually is

The store's integrity held at **16 concurrent writers** — the maximum the rig can reasonably stress on this machine. The failure mode above the *reliable* ceiling is:

```
no_run: cli exit 1: database is locked
```

i.e. one process lost the write-lock wait race and the CLI exited 1 instead of retrying. (Verified: the store opens with `PRAGMA journal_mode=WAL` + `busy_timeout=5000` at `src/core/run/store.mjs:97-101`.) So the honest statement is:

- **Reliable ceiling:** 4 (a level is only PASS when every run completes).
- **Integrity ceiling:** ≥16 (nothing corrupts at any tested level).
- **Transient failure PR:** under contention, a writer can die with `SQLITE_BUSY` rather than wait.

An earlier attempt produced garbage for a completely different reason — see §3.

## 2. Determinism / shape of the passes

Runs become slower as N grows (mean 10.0s → 40.1s at L16) because a single Ollama model serialises token generation across the processes. This is the known, reported confound: **wall time at high levels measures Ollama more than the store**. It does not affect the store verdict — completion and integrity are what the level is judged on.

## 3. First run invalidated: shadow-dir name collision (root-caused, fixed, verified)

The first e3-scale run failed *everywhere* with a degenerate signature — exactly 1/N survivors, deaths at the `run.leased` step, wall time *shrinking* as N grew — and the store showed only the crash leftovers. Root cause was in the **CLI, not the store** (`src/cli/index.mjs`):

```js
const shadow = path.join(HOME, 'workspaces',
    Buffer.from(workspace).toString('hex').slice(0, 16) + '.git');
```

`Buffer.from(workspace).toString('hex')` of a Windows path like `C:\Users\abhijith.p\...` → `433a5c5573657273`, and `.slice(0,16)` keeps the first **8 bytes** — identical for every `C:\Users\...` workspace (verified collide:true byte-for-byte). Concurrent starts saw two processes race `git init --bare` on the same shadow `.git`: `fatal: cannot copy ... File exists` → `Command failed: git init --bare ...` → N−1 of N processes crash. Even sequential runs conflated shadow git history.

**Fix (approved, applied):** hash the full workspace path with sha1 instead of slicing:

```js
import { createHash } from 'node:crypto';
const shadow = path.join(HOME, 'workspaces',
    createHash('sha1').update(workspace).digest('hex').slice(0, 16) + '.git');
```

**Verified** with an independent 4-way simultaneous-spawn repro against a fresh shared ORION_HOME *after* the fix: all 4 finish with `model_finished`, all 4 terminal `run.completed`, store carries all four run histories cleanly. (Before the fix, the same simultaneous spawn killed exactly one process with the `git init` race.) This defect also meant two *sequential* runs with the same workspace conflated their shadow checkpoints — it is a harness bug the E3 measurement caught, not a store limitation.

## 4. Confounds, stated honestly

- One local Ollama serialises token generation, so high-N wall times measure the model more than the store (§2). Store verdict unaffected.
- `node:sqlite` is a synchronous driver; the whole store is one-writer-at-a-time by design. Concurrent *read* pressure was not separately measured.
- The window of the shared store is real: `ORION_HOME` was one directory with one `orion.db`; each run's *workspace* was its own copy (as specified by the E3 definition — shared store, separate workspace).

## 5. What this means for the wave gates

- **W13/W14 (multi-agent, then parliaments):** the store can carry at least 16 concurrent trajectories with zero corruption. It is *not* the bottleneck to be fixed before parallel work, provided the CLI stops dying on `SQLITE_BUSY`.
- **Actionable finding (product):** the CLI should retry `database is locked` (the store already set `busy_timeout=5000`; a retry-once around the write with a short jitter would eliminate the observed exit-1 flake). That is a small, safe, non-contract change to queue — same family as the busy-timeout pragma itself. → **DONE, and it was two defects, not one — see §6.**
- **Regression note:** the shadow-dir hash fix is in `v0/src/cli/index.mjs` and shipped-source-tested only through this E3 run; a `fresh-run-audit`-style check on shadow git paths is worth adding so a future workspace-layout change cannot reintroduce the collision silently.

## 6. Addendum (2026-09-17): the SQLITE_BUSY flake is closed — and it was two defects

§5 queued one change: retry `database is locked`. Implementing it surfaced a second, deeper defect
that the retry could not have caught. Both are now fixed in `src/core/run/store.mjs`.

### 6.1 The queued fix — bounded retry on `BEGIN IMMEDIATE`

`Store.tx()` now retries `BEGIN IMMEDIATE` up to 5 times at 250 ms when SQLite reports
`SQLITE_BUSY` (errcode 5, or a `database is locked` message).

The retry is scoped to `BEGIN IMMEDIATE` **only**. Once the transaction has begun, a failure inside
`fn()` still rolls back and throws without retrying — the body may carry side effects that must not
run twice. `BEGIN IMMEDIATE` is also precisely where contention surfaces, because it takes the
RESERVED lock up front rather than at first write, so the narrow scope covers the actual failure.

### 6.2 The defect that fix did NOT cover — `busy_timeout` was armed too late

Verifying 6.1 with a harsher blast than the original gate (8 processes opening the same store
simultaneously, 40 transactions each) still produced crashes — but **not inside `tx()`**. They were in
the `Store` **constructor**, at `PRAGMA journal_mode=WAL`.

`journal_mode=WAL` takes a brief exclusive lock. `busy_timeout=5000` was being set *four statements
after it* (`store.mjs:97-101`, the very lines §1 cites as evidence the timeout was in force). So that
PRAGMA ran at SQLite's default busy timeout of **0**: two processes opening the same store in the same
instant raced, and the loser died with `database is locked` before the run had begun. No
transaction-level retry can catch this, because no transaction has started yet.

**Root-caused in isolation** — the PRAGMA sequence alone, no Store, no harness:

| PRAGMA order | 8 simultaneous openers |
|---|---|
| `journal_mode` before `busy_timeout` (as shipped) | **2 of 8 crashed** |
| `busy_timeout` first (fixed) | **0 of 8 crashed** |

**Fix:** `PRAGMA busy_timeout=5000` is now the first statement executed on the connection, before
`journal_mode`, `synchronous`, `foreign_keys`, `SCHEMA` and the migrations — all of which can contend.

**Confirmed against the real `Store`:**

| load | result |
|---|---|
| 8 writers × 40 tx, three consecutive repeats | all completed, zero `database is locked` |
| 16 writers × 40 tx | all completed, zero `database is locked` |

Pre-fix, the same 8-writer blast lost 2 of 8 processes.

### 6.3 Consequence for the ceiling

The reliable ceiling of **4** reported in §1 was set by exactly one thing: a single `SQLITE_BUSY`
exit-1 at L8 rep1, with the store verifying clean in every cell including that one. The cause of that
failure class is now fixed on both surfaces. The integrity ceiling was never in question (≥16, zero
corruption at every tested level).

**This addendum does not re-declare the ceiling.** §1's number came from a measured 8-cell matrix and
stands as what that matrix produced; the blast above is a targeted contention test, not a re-run of
E3. Re-running `run-e3.mjs --levels 2,4,8,16 --reps 2` against the fixed build is the honest way to
publish a new reliable ceiling, and it is cheap. Expected — not claimed — to land at ≥16.

### 6.4 Verification

`2317 passed, 0 failed across 50 suites`; `tsc --noEmit` exit 0; lint clean (112 files, no problems).

One reproduction note: `shipped/w6-shipped` exits 2 when the Docker daemon is not running, dropping
the total to 2144/1. That is environmental, not a regression — confirmed by running that suite with
these changes stashed, which also exits 2. With Docker up, the full suite is green.
