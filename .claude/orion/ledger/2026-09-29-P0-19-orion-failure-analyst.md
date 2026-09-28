# P0 post-push CI triage — orion-failure-analyst

Run 36488558856 (b26fc1f): PASS ubuntu node22/24, static checks, eval selfcheck. FAIL windows node22 (job 109151329494) and node24 (job 109151329529), both at step "Test" (npm test).
Classification: UNRESOLVED (leaning RIG). PRE-EXISTING: run 35094446191 (c75ba6b) also failed both Windows jobs (+ ubuntu node22); last all-green test jobs at 551885e (run 34207573382).
Regression window 551885e..c75ba6b = Waves 6–10 (15 commits, 91 files).
Raw logs 403 without auth; annotations only "exit code 1" (node22 early, node24 later → possibly timing/env dependent — INFERENCE).
§11.4: "suite green" proven locally (Windows 2379/0/52) + ubuntu CI; NOT proven on GitHub windows-latest.
BLOCKED: need "Failing assertions" + Test log excerpt from the user, or gh CLI auth. Asked user 2026-09-29.
