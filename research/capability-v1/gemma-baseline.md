# Gemma Baseline — Stage 1 Real-Code Baseline

> **NUMBERS WITHDRAWN — REGENERATION PENDING.** Every figure in this file was computed from the
> Gemma run that has since been INVALIDATED (no Python interpreter on PATH; see
> `invalidated-baseline.md`). Do not cite anything here. This file is regenerated from the
> corrected baseline as soon as it completes.


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
| repeats | **1 per task** (§17) |
| completed | 2026-09-01T09:30:46.608Z |

## Result

| metric | value |
|---|---|
| tasks attempted | **17** |
| tasks passed | **2** |
| task success | **11.8%** (2/17) |
| infrastructure failures | **0** |
| verifier failures | **0** |
| wall-clock timeouts | **0** |
| budget exhaustion | **0** |
| model failures | 0 |
| model calls | 437 |
| tool calls | 428 |
| tool success rate | 64.5% |
| input tokens | 18,28,138 |
| output tokens | 25,828 |
| total wall time | 1198 s |
| escalations | 0 |
| context compactions | 0 |
| messages dropped by projection | 276 |

## The dominant observation

**9 of 17 runs made ZERO file mutations of any kind.** Counting runs whose only write was a
new scratch reproduction script, the agent **never attempted the fix** on the large majority of
failures.

This comes from the durable event log, not from the score. It survived two instrumentation
corrections that had previously hidden it — see `infrastructure-validation.md`.

## Termination reasons

| reason | count |
|---|---|
| `model_finished` | 7 |
| `no_progress` | 5 |
| `max_turns` | 5 |

7 run(s) **declared completion** with an unchanged world — exactly the condition ADR-013's
declared completion contract detects, and it is **switched off** in this baseline by design
(shipped defaults only, Rule 9).

## Per task

| task | outcome | reason | tools | source edited | wall |
|---|---|---|---|---|---|
| `pallets__flask-4045` | FAIL | `no_progress` | 19 | — | 23s |
| `pallets__flask-5063` | FAIL | `max_turns` | 40 | reproduce_issue.py | 136s |
| `psf__requests-3362` | FAIL | `model_finished` | 26 | — | 101s |
| `pylint-dev__pylint-5859` | FAIL | `max_turns` | 40 | — | 145s |
| `pylint-dev__pylint-6506` | FAIL | `model_finished` | 21 | — | 56s |
| `pylint-dev__pylint-7228` | FAIL | `max_turns` | 40 | — | 135s |
| `pylint-dev__pylint-7993` | FAIL | `model_finished` | 28 | reproduce_issue.py, pylint/reporters/text.py | 132s |
| `pytest-dev__pytest-11143` | FAIL | `model_finished` | 16 | — | 38s |
| `pytest-dev__pytest-11148` | FAIL | `max_turns` | 40 | — | 53s |
| `pytest-dev__pytest-6116` | FAIL | `no_progress` | 13 | — | 19s |
| `pytest-dev__pytest-7220` | FAIL | `no_progress` | 11 | repro/test_path_error.py | 61s |
| `pytest-dev__pytest-7373` | **PASS** | `model_finished` | 10 | src/_pytest/mark/evaluate.py | 23s |
| `pytest-dev__pytest-7432` | **PASS** | `model_finished` | 19 | repro.py, src/_pytest/skipping.py | 77s |
| `pytest-dev__pytest-7490` | FAIL | `no_progress` | 11 | reproduce_issue.py | 18s |
| `pytest-dev__pytest-8365` | FAIL | `no_progress` | 28 | src/_pytest/tmpdir.py | 64s |
| `pytest-dev__pytest-8906` | FAIL | `max_turns` | 40 | src/_pytest/python.py | 73s |
| `pytest-dev__pytest-9359` | FAIL | `model_finished` | 26 | — | 48s |

## Variance — read before quoting any number

**No stable/high-variance label is assigned to any task**, because this is n=1 (§4). The V0
`STABLE_SUCCESS` / `HIGH_VARIANCE` labels were defined at n=3 and do not transfer to a single run.

Where a repeat does exist, variance is real and *behavioural*, not just scalar:
`pallets__flask-4045` PASSED in the §14 smoke run (editing `src/flask/blueprints.py`) and FAILED in
this baseline having never touched source — same corpus hash, same configuration, same model.
See `variance-note.md`.

**"11.8%" means: this model passed 2 of 17 Stage-1 task instances under this
configuration, on one run each.** It is not a measurement of capability (§18).
