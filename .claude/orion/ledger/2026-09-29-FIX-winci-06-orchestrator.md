# FIX-winci / S6 CI verify — orchestrator

Run 36491295405 (ce65a83): PASS ubuntu node22 + node24 (→ Linux fake-docker shim works), package validation, eval selfcheck.
STILL FAIL: windows node22 (job 109160251205), windows node24 (job 109160251331). Cause UNKNOWN — logs require auth.
The PidsLimit crash may be fixed and a different failure now visible, or the fix may not engage on the runner (NOT PROVEN either way).
Asked user for the "Failing assertions" excerpt of job 109160251205. No code changes until triaged.
