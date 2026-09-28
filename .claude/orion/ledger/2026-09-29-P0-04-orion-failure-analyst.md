# P0 / FIX triage follow-up (crash-matrix 54→55) — orion-failure-analyst

Classification: RIG (benign). Uncommitted src diffs DISPROVEN as cause; stale HEAD snapshot DISPROVEN.

PROVEN (MEASURED): the extra event is a second `tool.output_delta` for tc5 (`bash -lc 'echo CHECK-OK'`).
`bash -lc` (v0/src/sandbox/local/index.mjs:441, :555) sources host ~/.profile; on this machine
C:\Users\abhi\.profile is a DIRECTORY → stderr "bash: /c/Users/abhi/.profile: is a directory".
Pipe chunking splits stderr/stdout into 1 or 2 deltas nondeterministically → 54 or 55 events.
Evidence DBs: %TEMP%\v0-crash-1790627075413-2dee (55), %TEMP%\v0-crash-1790627683557-6f6a (54). crash-matrix.json now matches HEAD again.
No invariant touched (world matches golden, no duplicate effects).

NOT PROVEN: trigger rate / load dependence (n=2 matrix, n=8 isolated).

§11.4 ledger: events_at_end is ±1 nondeterministic; local sandbox login shell reads host ~/.profile (host→sandbox leak, observed).
Proposals: (1) user removes/renames C:\Users\abhi\.profile dir (env); (2) optional: make events_at_end informational or exclude output_delta;
(3) RECOMMENDATION for P2 (architect/security): `bash --noprofile` or controlled HOME for the local sandbox.
