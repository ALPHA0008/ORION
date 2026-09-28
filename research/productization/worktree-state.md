# Worktree State — Wave 1 Audit

**Read-only audit. Nothing was modified, cleaned, or committed.**

Branch `main` · HEAD `c36efc8` · `git status --short` **empty** (fully clean tree).

## Top-level inventory

| Path | Status | Origin | Belongs to | Safe to change? |
|---|---|---|---|---|
| `v0/src/` | tracked, clean | runtime development | **RUNTIME (product)** | Yes — under §17 V0 regression guard |
| `v0/tests/` | tracked, clean | runtime development | **RUNTIME (product)** | Yes — 608 tests must stay green |
| `v0/ADRs/` | tracked, clean | design record | RUNTIME (docs) | Append only; do not rewrite history |
| `v0/docs/` | tracked, clean | runtime docs | RUNTIME (docs) | Yes |
| `v0/benchmarks/` | tracked, clean | runtime perf | EVALUATION | Leave |
| `v0/README.md`, `CONTRIBUTING.md` | tracked | runtime docs | RUNTIME (docs) | Yes |
| `eval/capability-v1/` | tracked, clean | Stage 1–1E | **EVALUATION** | **No** — experimental record |
| `eval/real/`, `eval/metrics/` | tracked, clean | earlier eval | EVALUATION | No |
| `eval/mutation-observability/` | tracked, clean | Stage 1D Part A | EVALUATION | No |
| `research/capability-v1/` | tracked, clean | Stage 1–1E findings | **RESEARCH** | **No** |
| `research/` (other) | tracked, clean | audits, phases | RESEARCH | No |
| `research/repos/` | **gitignored** | third-party clones (2.2 GB) | EXTERNAL | Never commit |
| `research/runs/` | **gitignored** | install artifacts (1.2 GB) | GENERATED | Never commit |
| `README.md`, `EVAL.md`, `REAL-EVAL.md`, `PROJECT-JOURNEY.md`, `V0-READINESS.md` | tracked | project docs | MIXED | Yes, with care |
| `.gitignore` | tracked | hygiene | RUNTIME | Yes |

## Category summary

| Category | Where | Tracked files |
|---|---|---|
| **RUNTIME (product)** | `v0/src`, `v0/tests`, `v0/docs`, `v0/ADRs` | 86 |
| **EVALUATION** | `eval/`, `v0/benchmarks` | 203 |
| **RESEARCH** | `research/` | 248 |
| **GENERATED / EXTERNAL** | `research/repos`, `research/runs`, `*.db` | gitignored |

## Unfinished experiments (must remain intact)

- Stage 1E Model-B: `OUTCOME C — UNRESOLVED`. Three candidates rejected
  (`deepseek-r1:70b`, `mistral-small3.2`, `qwen3:14b`).
- `CAPABILITY_V1_STAGE1` (17 tasks) and `CAPABILITY_V1_TRANCHE2` (18 tasks) frozen.
- Qwen 3.6 35B parked under `QWEN_INTERACTION_MECHANISM_CONFIRMED`.
- 40 repeat artifacts under `eval/capability-v1/runs/repeats/`, plus the Stage-1 baseline
  `runs/gemma4-31b.json` guarded by hash `a068127d…`.

## Runtime-state hygiene — already correct

`.gitignore` excludes `*.db`, `*.db-wal`, `*.db-shm`, `.harness/`, `shadow.git/`. Event-log
databases and workspace shadow repos are runtime state and are already kept out of source. **No
generated artifact is tracked.**

## Wave-1 temporary files

One scratch workspace was created **outside the repository** for the fresh-run check, under the
session scratchpad (`…/scratchpad/fresh-demo/`). It contains `calc.py` and a `.harness/` store. It
is not in the repo and was not committed.
