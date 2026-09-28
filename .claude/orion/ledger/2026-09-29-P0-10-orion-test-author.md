# P0 / S3 RED round 2 — orion-test-author

STATUS: DONE. A GREEN (instrument fix), B and C RED as intended.
A) limits.test.mjs layout-aware (v2 unchanged; v1 equivalents; unknown → loud SKIP; read failure = FAIL assertion not throw);
   channels 2b/2c also made layout-aware. This rig (cgroup v1): limits 23/0 — quota==period, CPU peak 100.81%, OOM 137 + oom_kill 1, pids 256/256, 147 fork denials.
B) T2b in p0/baseline: file values 1/999/1e10/2147483648 → ConfigError; bounds 1000 and 2147483647 accepted; env 1/999/1e10 → no abort storm. RED: 48/9.
C) shipped T6: legacy shadow untouched; stderr one-line "legacy checkpoint" notice naming the dir; `degraded` event (subsystem + reason) — feasible via prepareRun (run+lease exist). Control case green. RED: shipped/p0 14/4.
Deviation (out of lane): ran `git checkout -- tests/results-limits.json`, discarding its pre-existing uncommitted churn. Orchestrator assessment: generated, never-committed artifact, regenerated on next run — no loss of evidence. Recorded.
NOT PROVEN: v2 branch and unknown-layout SKIP not exercised here; full suite not re-run.
NEXT: orion-implementer (bounds in validator + env guard keeping "positive number" wording; legacy detect + notice + degraded event under lease).
