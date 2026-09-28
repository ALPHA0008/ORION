# P0 / S1 GATE — orion-architect

Verdict: BUILD NOW (P0 only: commit fixes with regression tests + tree hygiene; no new functionality).

Key findings:
- FACT: 3 src fixes correct & minimal by inspection. store.mjs retry wraps BEGIN IMMEDIATE only (no double-apply).
- FACT: shadow-repo naming bug is real — old scheme = first 8 bytes of path hex; workspaces sharing an 8-char prefix shared one shadow repo. sha1 fix orphans old shadows (release note needed).
- FACT: no regression test exists for any of the fixes (grep of v0/tests).
- INFERENCE: /qwen/i shim match is broad — must be tested harmless when content present.
- FACT: .gitignore misses wg-fixtures, wg-homes, archify-out, conversations; results-*.json are tracked churn.

Proposed tests: T1 store contention (+ deterministic tx retry unit), T2 config requestTimeoutMs/env coercion, T3 qwen shim selection + no-op on content, T4 shadow naming distinct paths + shipped reachability.

Proposed commits: C1 store fix+T1 · C2 shadow naming+T4 · C3 config/timeout+qwen shim+T2/T3 · C4 .gitignore (+untrack results json) · C5 plan + research/productization (after secret scan) · C6 v0/eval runners (no results) · C7 .claude/ + AGENTS.md + CLAUDE.md.
OUT: conversations, archify-out, wg-*, results; research/claude-audit|opencode|corpus deferred.

Acceptance: clean tree at SHA; fresh clone npm test 0 failures on Node 22.17 + typecheck + lint; pack from clean clone installs, doctor/--help exit 0; T1–T4 made-to-fail.
STOP: baseline SHA recorded in STATE.md, reported to user.

NOT PROVEN: suite green on this machine; fresh-clone pass; pack install; qwen shim harmless.
APPROVAL NEEDED: 7 decisions (tests, results json, docs, eval runners, team setup, research dirs, commit/push).
NEXT: orion-test-author → orion-gate-runner → orion-release-manager.
