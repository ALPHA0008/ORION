# P0 / S4 GREEN — orion-implementer

STATUS: DONE — T5 green; full suite 2327 passed / 1 failed / 52 suites (sandbox/limits).
Design: bin shim rejected (T5 spawns src/cli/index.mjs; SQLite ExperimentalWarning fires at node:sqlite link time, before any static-import filter runs — tested).
Changes:
- v0/src/core/run/store.mjs: static `import { DatabaseSync } from 'node:sqlite'` → lazy cached createRequire('node:sqlite') on first `new Store()` (JSDoc type kept; why-comment).
- v0/src/cli/warnings.mjs (NEW): isSqliteExperimentalWarning + filterSqliteExperimentalWarning — wraps process.emitWarning, drops only ExperimentalWarning matching /\bSQLite\b/; idempotent; header explains no `degraded` event (cosmetic Node notice, ADR-010) and why not NODE_NO_WARNINGS.
- v0/src/cli/index.mjs: filter installed only inside the is-main-module guard before `await cli()`. package.json bin unchanged. No tests/deps/contract touched; CRLF kept.
Evidence: shipped/p0 7/7; p0/baseline 40/40; shipped/w6 77/77; typecheck clean; lint clean; `grants --json 2>&1` parses; non-SQLite warnings still print; contract 6/49.
Failure: sandbox/limits exits 1 — `SandboxError: cat: can't open '/sys/fs/cgroup/cpu.max'` (limits.test.mjs:70). Likely RIG (Docker cgroup), NOT PROVEN (no no-change baseline run).
RISKS: library Store users see SQLite warning at first Store construction instead of import; CLI wraps process.emitWarning process-wide (CLI entry only).
NEXT: failure-analyst on sandbox/limits; invariant + security review.
