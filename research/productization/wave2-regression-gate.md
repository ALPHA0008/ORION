# Phase 4 — Mandatory V0 Regression Gate

## Result: **PASSED — no regressions**

## Baseline vs final

| | baseline (Phase 0) | final (Phase 4) | delta |
|---|---|---|---|
| tests passed | **608** | **608** | **0** |
| tests failed | **0** | **0** | **0** |
| suites | **23** | **23** | **0** |

Command: `node v0/tests/run-all.mjs`. The baseline was **observed and recorded** in
`wave2-start-state.md`, not hardcoded.

## Per-suite final results

```
unit/event-store           26   concurrency/lease          51
fencing/fencing            29   runner/runner               7
crash/matrix                6   recovery/recovery          53
replay/semantics           44   integration/provider       53
security/security          41   compaction/compaction      18
readpaging/readpaging      26   readfidelity/readfidelity  30
editdiag/editdiag          31   writerecovery/writerecovery 14
writewitness/writewitness  26   escalationgate/escalationgate 28
escalationgate/escalation-lifecycle 20   escalationgate/bypass 12
worldstate/worldstate      19   completiongate/completiongate 13
completioncontract/completioncontract 29
worldstate/concurrent-race 18   worldstate/real-repo-race  14
```

All 23 suites `OK`, 0 failures.

## Changes under `v0/src` covered by this gate

Two files were modified. Both are behavioural fixes, neither changes a runtime guarantee.

### 1. `sandbox/local/index.mjs` — grep defects A and B

- Extracted `scanFile(rel)` so file scanning is shared.
- **Defect A:** `statSync` decides whether `start` is a directory. A directory recurses through
  `walk()` exactly as before; a **file is now scanned directly** instead of being passed to
  `readdirSync` and reported as an unreadable *directory*.
- **Defect B:** `.harness` added to the existing name-based exclusion list alongside `.git` and
  `node_modules`, preserving the established semantic that the exclusion applies **at any depth**.
- Error handling unchanged: an unreadable/missing path is still recorded in `skipped.dirs` and
  surfaced via the `[INCOMPLETE RESULT]` notice.

Directly relevant suites, all green: `security/security` (41), `readfidelity` (30),
`readpaging` (26), `worldstate` (19).

### 2. `cli/index.mjs` — `--version`

- Added `-v` / `--version` / `version`, resolved by **reading `package.json`** rather than
  duplicating the version string in source, so it cannot drift from what npm publishes.
- Added `fileURLToPath` import for correct path resolution on Windows (a hand-rolled
  `URL.pathname` fix returned `unknown`).
- Dispatch order: version is checked **before** `--help`, so both remain exit 0.

## Correction to a Wave-1 finding

Wave 1 reported *"`run` exits 0 when unconfigured"* and listed it as a medium-severity defect.
**That was a measurement error on my part** — the exit code observed came from a shell pipeline
(`| head`), not from the process.

Measured directly, without a pipe:

| invocation | exit |
|---|---|
| `run` with no `HARNESS_BASE_URL` | **2** |
| `run` with no task argument | **2** |
| unknown command | **2** |
| `--help` | **0** |
| `doctor` (success) | **0** |

The CLI's exit semantics were **already correct**. No change was needed or made. Only `--version`
was genuinely missing.

## Verdict

Gate **PASSED**. Baseline preserved exactly; proceed to Phase 5.
