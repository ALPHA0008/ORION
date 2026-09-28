# P0 / S4 GREEN round 2 — orion-implementer

STATUS: BLOCKED on a test contradiction. shipped/p0 18/18; p0/baseline 54/57.
Blocker (FACT): T2 (~line 176) uses env ORION_REQUEST_TIMEOUT_MS='150' and expects it honoured; approved bound [1000, 2^31-1] makes 150 invalid → 3 T2 assertions fail. Fix belongs in the test fixture (use in-bounds value, adjust wait budget).
Changes: config/index.mjs — REQUEST_TIMEOUT_MIN_MS/MAX_MS + isValidRequestTimeoutMs; validator message keeps "positive number". cli/index.mjs — env guard uses it; noticeLegacyShadow() in prepareRun: one existsSync, never opens legacy dir, appends `degraded` {subsystem:'checkpoints', reason, what:'legacy_shadow_ignored', path} under lease + one stderr line.
Evidence: T6 all green; T2b all green; typecheck clean; lint clean; contract 6/49. Full npm test NOT RUN (held).
Risks: notice/degraded repeats on every prepareRun incl. resume (dedupe = follow-up); payload carries absolute host path under HOME.
NEXT: test-author fixes T2 fixture → implementer runs full suite.
Orchestrator decision: T2 fixture change is not weakening — it adapts to the user-approved bound; it must still prove the configured timeout (not the 60s default) is honoured.
