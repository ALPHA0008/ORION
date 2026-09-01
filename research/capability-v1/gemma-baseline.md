# Gemma Baseline — Stage 1 Real-Code Baseline

> **NUMBERS REFRESHED — CORRECTED BASELINE.** The first Gemma run was INVALIDATED (no Python
> interpreter on PATH, see `invalidated-baseline.md`). This file now records the CORRECTED run,
> which executes Python in every task. It supersedes both the original `46e5dbc` (2/17) and any
> figure in the pre-invalidation draft.

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Not "SWE-bench Lite performance", not industry-level, not a competitive benchmark.

## Provenance

| field | value |
|---|---|
| corpus version | `CAPABILITY_V1_STAGE1` |
| corpus sha256 | `0a9a279d48a491dacdadfd714c2c588bfb8a79adb4d536680241f1ebcf8300bb` |
| runtime commit | `6e4d5325d7` |
| corpus committed at | `7d5e5b6` — **before** this run consumed it (§DM) |
| model | `gemma4-31b` (RedHatAI/gemma-4-31B-it-NVFP4) |
| server | vLLM · `172.20.7.22:8000` · context **32 768** |
| tool calls | via `applyGemmaToolCallShim` — the model emits no native `tool_calls` |
| configuration | `baseline-lock.md` — shipped defaults, maxTurns 40, 15 min timeout |
| environment | each task venv on PATH, `python3.exe` present (the §?? fix) |
| repeats | **1 per task** (§4) |
| completed | 2026-09-01T10:06:14.474Z |

## Result

| metric | value |
|---|---|
| tasks attempted | **17** |
| tasks passed | **3** |
| task success | **17.6%** (3/17) |
| infrastructure failures | **0** |
| verifier failures | **0** |
| wall-clock timeouts | **0** |
| budget exhaustion | **0** |
| model failures | 0 |
| tool calls | 404 |
| tool success rate | **79.7%** |
| input tokens | 2 139 030 |
| output tokens | 35 492 |
| total wall time | ~1104 s |
| escalations | 0 |
| context compactions | 0 |
| messages dropped by projection | 254 |

## Correction effect — this is the honest baseline

The invalidated run reported 2/17 with `tool success 64.5%` and a "9 of 17 made zero
mutations / premature termination" story. That story was the agent's **python hunt** (it had no
interpreter, so every `python`/`python3` call failed and it eventually stopped). The corrected run:

- **tool success 79.7%** — the hunt is gone; only genuine failures remain.
- **3/17 passed** (was 2, and both of the new passes — `psf__requests-3362`,
  `pylint-dev__pylint-5859` — now actually verify their fix by running code).
- Zero-mutation runs fell to **8/17**, and several of the remainder now show real edits/tests.

The corrected numbers are the evidence-bearing ones. The invalidated story is retained in
`invalidated-baseline.md` and `runs/invalidated/` as a record of the misattribution, not as a result.

## Termination reasons

| reason | count |
|---|---|
| `model_finished` | 11 |
| `no_progress` | 4 |
| `max_turns` | 2 |

## Per task

| task | outcome | reason | bash-fail | source edited | wall |
|---|---|---|---|---|---|
| `pallets__flask-4045` | FAIL | `no_progress` | 1 | — | 43s |
| `pallets__flask-5063` | FAIL | `model_finished` | 6 | cli.py, helpers.py, scaffold.py | ~ |
| `psf__requests-3362` | **PASS** | `model_finished` | 0 | models.py | ~ |
| `pylint-dev__pylint-5859` | **PASS** | `model_finished` | 5 | misc.py | ~ |
| `pylint-dev__pylint-6506` | FAIL | `model_finished` | 11 | — | ~ |
| `pylint-dev__pylint-7228` | FAIL | `model_finished` | 2 | name_checker/checker.py | ~ |
| `pylint-dev__pylint-7993` | FAIL | `model_finished` | 9 | reporters/text.py (24-line diff) | ~ |
| `pytest-dev__pytest-11143` | FAIL | `no_progress` | 6 | — (diff from repro) | ~ |
| `pytest-dev__pytest-11148` | FAIL | `model_finished` | 4 | — | ~ |
| `pytest-dev__pytest-6116` | FAIL | `no_progress` | 0 | — | ~ |
| `pytest-dev__pytest-7220` | FAIL | `max_turns` | 6 | 4 edits, 2 writes | ~ |
| `pytest-dev__pytest-7373` | **PASS** | `model_finished` | 0 | mark/evaluate.py (3+17-) | 23s |
| `pytest-dev__pytest-7432` | FAIL | `model_finished` | 0 | 6 edits, 1 write in skipping.py | ~ |
| `pytest-dev__pytest-7490` | FAIL | `no_progress` | 7 | 1 write, 1 test run | ~ |
| `pytest-dev__pytest-8365` | FAIL | `model_finished` | 2 | tmpdir.py (12+1-) | ~ |
| `pytest-dev__pytest-8906` | FAIL | `model_finished` | 2 | python.py (4+2-) | ~ |
| `pytest-dev__pytest-9359` | FAIL | `max_turns` | 16 | — | ~ |

## Variance — read before quoting any number

**No stable/high-variance label is assigned to any task**, because this is n=1 (§4). The V0
`STABLE_SUCCESS` / `HIGH_VARIANCE` labels were defined at n=3 and do not transfer to a single run.

Where a repeat does exist, variance is real and *behavioural*, not just scalar:
`pallets__flask-4045` PASSED in an earlier smoke run (editing `src/flask/blueprints.py`) and has
FAILED in both baselines. See `variance-note.md`.

**"17.6%" means: this model passed 3 of 17 Stage-1 task instances under this
configuration, on one run each.** It is not a measurement of capability (§18).
