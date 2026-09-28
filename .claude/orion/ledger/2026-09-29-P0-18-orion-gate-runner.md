# P0 / post-commit ACCEPTANCE (fresh clone) — orion-gate-runner

VERDICT: PASS (Level A). Fresh clone of a2c9083: npm test 2379/0/52; typecheck clean; lint clean; contract 6/49;
no never-commit files tracked; npm pack 0.2.1 = 71 files, no tests/results/run.db/eval; installed to fresh prefix with temp ORION_HOME:
--help / doctor exit 0; `grants --json 2>&1` parses; package import 119 exports; warnings.mjs present.
Later commit b2c272a (drop two draft docs + .gitignore) touches no code/tests.
NOT EXERCISED: live model, SIGKILL/resume/reap live, replay/fork on a live run, failure injection.
