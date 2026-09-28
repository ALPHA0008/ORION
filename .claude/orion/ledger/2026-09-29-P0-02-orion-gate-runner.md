# P0 / S6 VERIFY (Level A, pre-commit baseline) — orion-gate-runner

STATUS: FAIL — suite 2139 passed / 1 failed / 50 suites (recorded baseline 2305/0/50, old machine, Node 24).
PASS: typecheck, lint (112 files), contract v6/49, dirty-tree npm pack (70 files), install to temp prefix, installed `--help`, installed `doctor` (offline: endpoint not set, expected).
Preflight: node v22.17.0; bash = Git Bash 5.2.26 first on PATH; git mingw64.

Failure: shipped/w6-shipped — runner "exited with status 2", 0/0 counts. Direct run: 2 failed assertions
(`--json emits parseable output alone`; grant listing expected 1 got undefined).
Tentative cause: test line ~42 builds out = stdout + stderr; line ~239 JSON.parse(out). Node 22.17 prints
`ExperimentalWarning: SQLite is an experimental feature` to stderr → JSON corrupt. Manual check: `grants --json` stdout alone is valid JSON.
Tentative classification: RIG / Node-version. Unconfirmed on Node 24.

Unexplained: ~166 assertion shortfall vs 2305 — may be w6-shipped aborting early; not investigated.

Side effects: installed `doctor` touched real ~/.orion/orion.db (0 runs); 29 results-*.json modified (expected);
v0/tests/crash-matrix.json modified (not in initial status). Nothing reverted.
Docker Desktop was started by the user mid-run — container suite coverage in this run unverified.

NOT PROVEN: live gate; clean-checkout pack; Node 24 behaviour; cause of count gap.
NEXT: orion-failure-analyst.
