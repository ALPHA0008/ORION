# ORION — Program State

> Owned by the orchestrator. Updated at the end of every pipeline step. Keep it under ~80 lines;
> history belongs in `ledger/`, not here.

## Position

- **Program phase:** P0 — Baseline integrity (Plan §E, "P0"). IN PROGRESS.
- **Pipeline step:** S9 RELEASE — commits C1–C7 APPROVED by user 2026-09-29 (ledger P0-16); push approved ONLY after
  fresh-clone acceptance passes; npm publish NOT approved (needs version bump, later).
- **Working-tree Level A (ledger P0-14):** 2379 passed / 0 failed / 52 suites, typecheck + lint clean, contract 6/49.
- **Approved scope (user, 2026-09-29):** add regression tests T1–T4; commits C1–C7 per ledger P0-01
  (fixes, .gitignore + untrack results-*.json, plan + research/productization after secret scan,
  v0/eval runners without results, .claude/ + AGENTS.md + CLAUDE.md). Deferred: research/claude-audit,
  opencode, corpus. Commit and push still need separate approval at S9.
- **Key:** `OPENROUTER_API_KEY` env var present (user). Not used in P0.

## Baseline (verified 2026-09-29 on this machine)

| Item | Value | How verified |
|---|---|---|
| HEAD | `c75ba6b` (research: local Ollama model verified as harness worker) | `git log` |
| Remote | `https://github.com/ALPHA0008/ORION.git`, branch `main` | `git remote -v` |
| Package | `@kernlbase/orion` 0.2.1 (published) | `v0/package.json` |
| Event contract | v6 / 49 types | `EVENT_CONTRACT_VERSION`, `EVENT_TYPES.length` |
| Suite (last recorded) | 2305 passed / 0 failed / 50 suites | Plan §A.1 — NOT re-run on this machine yet |
| Node here | v22.17.0 (engines ≥22; dev history used 24) | `node --version` |

## Uncommitted work = P0 scope (FACT, `git diff --stat`)

- `v0/src/core/run/store.mjs` — `busy_timeout` armed before WAL pragma; bounded SQLITE_BUSY retry in `tx()`
- `v0/src/config/index.mjs` — `requestTimeoutMs` config field (+ numeric env coercion)
- `v0/src/cli/index.mjs` — qwen reasoning-as-content shim; sha1 shadow-repo name; request timeout wiring
- `.gitignore` — ignores `v0/eval/results/`
- `v0/tests/results-*.json` — churn by design, never commit
- Many untracked `research/**` docs — incl. the MASTER plan itself; committing them is a user decision

## Environment on this machine (differs from earlier sessions)

- Repo is `E:\harness` (old prompts say `D:\Abhijith P\Desktop\harness`).
- **No key vault** at `~/.orion-keys/` yet. **No Ollama** answering on :11434.
  → every live gate is BLOCKED until the user provisions an endpoint.

## Pending approvals

- none yet

## Open honest-gap ledger (carried from reports)

- W3b gate did not pass (see `context-and-key-usage-guidelines.md` §6.3).
- Frontier capability UNKNOWN — NOT YET MEASURED (E5, Plan §D.3).
- No automated test exercises a live model (Plan §0, gap 1 → P1).

## Security note

`conversations/` (untracked) contains plaintext provider keys pasted during earlier sessions.
Treat those keys as exposed; the user should rotate them. Never commit or copy from that folder.
