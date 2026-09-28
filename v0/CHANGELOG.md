# Changelog

No prior changelog existed in git history; this file starts at the P0 baseline-integrity phase.
Format: Keep a Changelog style, newest first. Event contract stays v6 / 49 types (additive only).

## Unreleased

### RELEASE NOTE — security fix for shared checkpoint stores

Prior versions stored shadow-git checkpoints under `~/.orion/workspaces/` in a repository named
from the first 8 characters of the workspace path. Workspaces sharing an 8-character path prefix
(for example, all projects under `C:\Users`) therefore shared one checkpoint repository, so one
project's file content could appear in another project's checkpoint history and restores.

After upgrading:

- Checkpoints use a repository named from a SHA-1 of the full workspace path. Distinct workspaces
  no longer share a store.
- Old shadow repositories under `~/.orion/workspaces` are **ignored** and never opened. They may
  contain mixed history from several projects; they can be deleted.
- ORION prints a one-line notice naming the legacy directory and records a `degraded` event
  (`subsystem: checkpoints`, `what: legacy_shadow_ignored`) when it finds one. The notice repeats
  on each run or resume while the directory exists.
- Restoring a checkpoint created before the upgrade will fail with an error, because its commit
  lives only in the legacy store.

### Fixed

- `orionctl <verb> --json 2>&1` now emits clean JSON on Node 22. The Node 22 "SQLite is an
  experimental feature" warning is filtered at the CLI entry point (only that warning; others still
  print). `node:sqlite` is now loaded on first `Store` construction rather than at import.
- Store: `busy_timeout` is armed before `journal_mode=WAL`, and `BEGIN IMMEDIATE` retries up to
  5 x 250 ms on `SQLITE_BUSY`, so concurrent processes no longer crash with "database is locked"
  on open or commit. The transaction body is never re-executed.
- `requestTimeoutMs` / `ORION_REQUEST_TIMEOUT_MS` is bounded to 1000..2147483647 ms. Config-file
  values outside the range raise a config error; out-of-range environment values fall back to the
  60 s default. (Below 1 s aborted every request; above 2^31-1 overflowed to about 1 ms.)

### Added

- `requestTimeoutMs` configuration key and `ORION_REQUEST_TIMEOUT_MS` environment variable for
  per-request model timeout (default 60000).
- Reasoning-as-content shim for `qwen*` models on OpenAI-compatible endpoints that return the
  whole answer as reasoning deltas with empty content.

### Tests

- New suites `p0/baseline` and `shipped/p0-shipped`; `sandbox/limits` now detects cgroup v1 and v2.
  Suite: 2379 passed / 0 failed / 52 suites on Node 22.17.0 (pre-commit tree).
