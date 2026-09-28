# P0 / S5 REVIEW round-2 delta (incl. security angle) — orion-invariant-reviewer

VERDICT: APPROVE (0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW — none block P0). Ran p0/baseline 58/0, shipped/p0 18/0.
- Legacy shadow never read/opened (existsSync only; T6 proves byte-identical legacy repo). Degraded append fenced under lease; replay-safe.
- limits v1 branch fails closed (quota -1, "max", missing file all FAIL).
- MEDIUM (backlog): unknown-cgroup-layout skip counted as PASS by runner → gate should treat UNPROVEN as not-pass.
- LOW (backlog): out-of-range env ORION_REQUEST_TIMEOUT_MS falls back silently (no stderr/degraded).
- LOW (backlog): legacy-shadow degraded event repeats on each resume (each true); dedupe on what:'legacy_shadow_ignored'.
NOT PROVEN: sandbox/limits not run by reviewer; full suite pending (gate runner).
