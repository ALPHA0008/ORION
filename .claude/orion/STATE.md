# ORION — Program State

> Owned by the orchestrator. Updated at the end of every pipeline step. Keep it under ~80 lines;
> history belongs in `ledger/`, not here.

## Position

- **Program phase:** P0 — Baseline integrity — **DONE 2026-09-29** (ledger P0-01 … P0-18).
- **Pipeline step:** S10 STOP. Follow-up FIX-winci DONE: GitHub CI fully green (7/7 jobs) at `de73774`
  — Windows CI had been red since the W6–W10 range (Docker in Windows-container mode); ledger FIX-winci-01…09.
- **Next phase:** P1 — Provider truth and resilience (Plan §E "P1"). NOT STARTED — waits for the user's go.
  Endpoint ready: `OPENROUTER_API_KEY` env var (user, $5 key cap, 90-day expiry); workhorse model
  `z-ai/glm-5.3-flash`, frontier model for E5 `z-ai/glm-5.3` (user-agreed plan). Every live call still
  needs approval per PIPELINE §5.

## Baseline (verified 2026-09-29, fresh clone, this machine)

| Item | Value |
|---|---|
| Code baseline SHA | `de73774` — local 2397/0/54; CI green on node 22+24 × ubuntu+windows |
| Suite | **2379 passed / 0 failed / 52 suites** (Node 22.17.0, Docker Desktop up, cgroup v1) |
| Typecheck / lint | clean / clean (115 files) |
| Event contract | v6 / 49 — unchanged |
| Package | `@kernlbase/orion` 0.2.1 (npm); tarball 71 files; NOT republished |
| Remote | `https://github.com/ALPHA0008/ORION.git` `main` |

## What P0 delivered

store busy/WAL order + BEGIN retry + lazy sqlite · clean `--json` on Node 22 (SQLite warning filter) ·
requestTimeoutMs bounded [1000, 2^31-1] · qwen reasoning shim · **security: sha1 shadow-repo naming**
(old 8-byte prefix shared checkpoints across projects) + legacy-store notice/`degraded` event ·
limits test cgroup v1/v2 aware · w6 stdout-only JSON · untracked test-output churn · plan, research,
CHANGELOG, eval runners, agent team committed. Report: `research/productization/p0-baseline-integrity-report.md`.

## Standing user rules

- **No AI attribution** in commits/PRs (no Claude co-author trailer). Commit and push normally.
- Laya parked until after E5 (candidate for Part I; not yet recorded in the plan).

## Pending decisions

- Publish? Behaviour changed (shadow rename) → next publish must be 0.3.0. Not approved.
- Local branch `backup/p0-before-trailer-strip` (pre-trailer-strip copy) — delete when satisfied.

## Backlog (not scheduled)

- LOW (FIX-winci): "non-Linux" wording · fake-docker cleanup in finally · ContainerSandbox ctor should name rejected
  runtimes · library-level process.exit in makeSandbox · keep ubuntu CI mandatory for container proofs.

- MEDIUM: unknown-cgroup-layout SKIP counts as PASS in run-all totals (gate honesty).
- MEDIUM (P2): local sandbox `bash -lc` sources host `~/.profile` → `--noprofile --norc` + scrubbed env.
- LOW: out-of-range env ORION_REQUEST_TIMEOUT_MS falls back silently · legacy notice repeats on resume ·
  drive-letter case gives two shadow repos · worldstate/real-repo-race reports 0/0 as OK.

## Open honest-gap ledger

- Live-model gate not run since this machine (P1 fixes that). Node 24 verified on CI.
- "2 of 8 openers" figure inherited from prior machine, not reproduced here.
- Frontier capability UNKNOWN — NOT YET MEASURED (E5).
- W3b gate did not pass (historical, `context-and-key-usage-guidelines.md` §6.3).

## Environment notes

- Repo `E:\harness`. Docker Desktop 29.8.1 / WSL2 / **cgroup v1**. `C:\Users\abhi\.profile` is a
  directory (causes a harmless stray bash error; user may rename it). No key vault dir; keys via env.
- `conversations/` holds exposed old keys — user should revoke them. Never commit (now gitignored).
