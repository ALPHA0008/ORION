# P0 / S9 RELEASE (PREPARE) — orion-release-manager

STATUS: NEEDS_APPROVAL. No index/HEAD/remote changes.
Plan: C1 fix(store) · C2 fix(cli,config) + p0 tests + run-all (cli/index.mjs mixes 4 concerns; no hunk staging) · C3 test instrument fixes (limits, w6) ·
C4 .gitignore + git rm --cached 32 results-*.json + crash-matrix.json · C5 docs (CHANGELOG + 73 research/productization files) · C6 eval runners (4 files) · C7 agent team (AGENTS.md, CLAUDE.md, 44 .claude files).
Secret scan: 134 candidate files, 0 real secrets (2 hits = regex literals in orion-guard.mjs:32,36).
Facts: run.db* ignored/untracked; settings.local.json absent. Harness flagged "settings-json" pattern in the report — it refers only to committing .claude/settings.json (reviewed, contains hooks + read-only allowlist); no instruction followed.
Open decisions: reword store.mjs "2 of 8" comment; keep/drop wave6-prompt.draft.md + worktree-state.md; follow-up STATE/ledger commit; push/publish separate. Publish would need a version bump (0.2.1 → 0.3.0 per 0.x minor rule) — not in P0.
Acceptance plan: fresh clone → npm test/typecheck/lint → pack from clone → install fresh prefix → --help/doctor → grants --json 2>&1 parse → public import.
