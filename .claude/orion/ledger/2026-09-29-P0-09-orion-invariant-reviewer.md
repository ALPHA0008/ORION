# P0 / S5 REVIEW — orion-invariant-reviewer

VERDICT: APPROVE (0 CRITICAL, 0 HIGH, 2 MEDIUM, 3 LOW). Ran: p0/baseline 40/40, shipped/p0 7/7, typecheck clean.
- tx() retry cannot re-run fn or double-append; fencing unaffected. Lazy sqlite: no API change. Warning filter cannot hide degraded (events, not warnings). Env coercion affects only requestTimeoutMs.
- MEDIUM M1 (inv 8): pre-upgrade runs' checkpoint SHAs live in legacy shadow → restore after upgrade fails LOUDLY. Suggest legacy fallback or release note.
- MEDIUM M2 (silent degradation): legacy shadow exists but ignored with no record → emit degraded/CLI notice if no fallback.
- LOW: busy retries unobserved; warning filter text-match fails safe; /qwen/i broad (test author already proved no-op on content).
NOT PROVEN: made-to-fail proofs not re-run; full npm test not re-run.
Orchestrator note: a legacy fallback would re-open the security HIGH (shared cross-project shadow) → prefer M2 notice + release note over M1 fallback.
