# P0 / S3 RED — orion-test-author

STATUS: DONE (T5 intentionally RED).
Files: NEW v0/tests/p0/baseline.test.mjs (T1–T4, 40 assertions, worker_threads lock holder);
NEW v0/tests/shipped/p0-shipped.test.mjs (T4 shipped + T5); MOD v0/tests/shipped/w6-shipped.test.mjs (orionctl() returns stdout; grants --json parses stdout only; other assertions unchanged);
MOD v0/tests/run-all.mjs (registers p0/baseline, shipped/p0-shipped).
Backups: %TEMP%\p0-src-backup\ (src + sha sums + revert scripts). v0/src verified byte-identical (sha1sum -c OK) after every revert.

Made-to-fail evidence: T1 retry RED "database is locked" (36/40); T1 PRAGMA order RED; T2 config RED "expected 1234, got undefined";
T2 timeout wiring RED "still waiting after 10s"; T2 guard proven vs naive unguarded fix ("expected 1, got 3");
T3 RED "0 shim(s)" / content "" ; shim leaves content-bearing replies identical (no src bug); T4 module+shipped RED "expected 2, got 1".
T5 RED on Node 22.17: merged output starts with ExperimentalWarning → shipped/p0: 4 passed, 3 failed.
Status: p0/baseline 40/40 (stable ×4); shipped/w6 77/77 (Docker up); lint clean. Full npm test not run.

NOT PROVEN: 8-process simultaneous open (only single-contender); T5 on Node 24; T4 shipped run ends finished_without_change (not asserted).
Implementer notes: narrow filter for SQLite ExperimentalWarning only; no test changes; keep CRLF.
NEXT: orion-implementer.
