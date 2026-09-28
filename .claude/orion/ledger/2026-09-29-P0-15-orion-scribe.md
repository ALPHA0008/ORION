# P0 / S8 RECORD — orion-scribe

STATUS: DONE. Files: research/productization/p0-baseline-integrity-report.md (new); v0/CHANGELOG.md (new, Unreleased + security release note);
MASTER plan append-only (A.1 P0 row "pending"; B.1 refresh row). Part C untouched.
Notes: store.mjs comment + plan B.1.1 "2 of 8 openers died" figure is inherited from old machine, not reproduced here (T1 single contender) → RECOMMEND rewording (needs user approval);
T6(1) non-discriminating; limits/w6 edits are instrument fixes without code-flip proof; +74 vs old baseline INFERENCE (~2 unexplained).
Deviation found: approved .gitignore entries missing → orchestrator appended them (conversations/, archify-out/, wg-fixtures/, wg-homes/, results-*.json, crash-matrix.json, .claude/settings.local.json); verified with git check-ignore.
NEXT: orion-release-manager PREPARE.
