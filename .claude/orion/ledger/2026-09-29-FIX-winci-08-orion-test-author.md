# FIX-winci / S3 instrument fix round 2 — orion-test-author

STATUS: DONE. Reproduced both CI crashes locally under fake windows-mode docker, then fixed (tests only):
- tests/mcp/live.test.mjs: guard was `docker info` (a Windows-mode daemon answers it) → now detectRuntime()-based like siblings; sandbox built on the detected runtime; loud SKIPPED line naming what is unproven.
- tests/shipped/w6-shipped.test.mjs: ORION_IMAGE section now uses the sibling `if (!runtime) SKIPPED … else` guard; its 6 assertions unchanged.
Scan: no other unguarded container path.
Fake windows docker: mcp/live 58/0, w6 56/0, 0 `docker run` calls. Real Docker: mcp/live 66/0, w6 77/0. Full npm test 2397/0/54.
NOT PROVEN: CI windows-latest re-run; on Windows-mode hosts ORION_IMAGE wiring + MCP-in-container isolation are skipped (loudly); makeSandbox process.exit remains (backlog).
