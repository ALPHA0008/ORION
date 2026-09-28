# P0 / S6 VERIFY Level A (dirty tree, pre-commit) — orion-gate-runner

VERDICT: PASS. npm test TOTAL 2379 passed / 0 failed / 52 suites (Node 22.17.0, Docker up, cgroup v1). typecheck clean; lint clean (115 files); contract 6/49.
Suites: p0/baseline 58/0; shipped/p0 18/0; shipped/w6 77/0; sandbox/limits 23/0; sandbox 78/0; network-live 26/0; crash/matrix-container 27/0; crash/matrix 6/0.
0/0 suite: worldstate/real-repo-race (reports OK) — by-design status UNPROVEN.
Tarball smoke (dirty-tree pack, fresh prefix): --help OK; doctor OK; `grants --json 2>&1` parses.
vs first run here 2139/1/50: +240 (container suites now run + w6 counted + 2 new P0 suites); vs old baseline 2305/0/50: +74 (INFERENCE: new suites 76).
NOT EXERCISED: live model; clean-checkout pack (post-commit acceptance).
Log: scratchpad\test.log
