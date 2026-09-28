# P0 / S6 → FIX triage — orion-failure-analyst

Classification: RIG (primary) + secondary PRODUCT defect.

PROVEN:
- w6-shipped: test merges stdout+stderr (w6-shipped.test.mjs:42) then JSON.parse (:239); Node 22.17 prints
  SQLite ExperimentalWarning on stderr → parse fails; grant-listing FAIL is downstream. Direct re-run (Docker up): 75 passed / 2 failed / 77.
- Gate run's status 2 / 0-0 = early abort (INFERENCE: makeSandbox → detectRuntime → process.exit(2) at src/cli/index.mjs:376-382 while Docker daemon was starting).
- Shortfall: container suites ran in SKIP mode (crash-container 1 vs 27, limits 1 vs 23, network-live 9 vs 26, sandbox 56 vs 78) + w6 77 uncounted = -164; +15 stale-HEAD gains; ~17 UNKNOWN.
- Skips report OK → run-all "OK" hides ~87 container assertions (gate honesty gap).
- PRODUCT: `orionctl <verb> --json 2>&1` corrupt on Node 22 (engines >=22); src has no warning handling. Repro deterministic.
- tests/crash/matrix.test.mjs:149 rewrites tracked tests/crash-matrix.json; events_at_end 54→55 for UNRESOLVED reason.

Proposed fixes: (1) re-run container suites + full suite with Docker up; (2) test reads stdout only for --json;
(3) product: narrow SQLite-ExperimentalWarning filter via bin shim + shipped assertion (TDD).
Ledger notes: library-level process.exit in makeSandbox can silently kill a harness; Node 24 behaviour NOT PROVEN.
Side effect: results-shipped-w6.json overwritten by analyst run.
NEXT: gate-runner re-run (Docker up); test-author; implementer; orchestrator decides crash-matrix.json tracking.
