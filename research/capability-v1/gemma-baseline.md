# Gemma Baseline — Stage 1 Real-Code Baseline

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
| model calls | 415 |
| tool calls | 403 |
| tool success rate | 79.9% |
| input tokens | 21,39,030 |
| output tokens | 35,492 |
| total wall time | 1104 s |
| escalations | 0 |
| context compactions | 0 |
| messages dropped by projection | 254 |

## The dominant observation

**4 of 17 runs made ZERO file mutations of any kind.** Counting runs whose only write was a
new scratch reproduction script, the agent **never attempted the fix** on the large majority of
failures.

This comes from the durable event log, not from the score. It survived two instrumentation
corrections that had previously hidden it — see `infrastructure-validation.md`.

## Termination reasons

| reason | count |
|---|---|
| `model_finished` | 11 |
| `no_progress` | 4 |
| `max_turns` | 2 |

11 run(s) **declared completion** with an unchanged world — exactly the condition ADR-013's
declared completion contract detects, and it is **switched off** in this baseline by design
(shipped defaults only, Rule 9).

## Per task

| task | outcome | reason | tools | source edited | wall |
|---|---|---|---|---|---|
| `pallets__flask-4045` | FAIL | `no_progress` | 36 | — | 43s |
| `pallets__flask-5063` | FAIL | `model_finished` | 20 | src/flask/cli.py, reproduce_issue.py, test_routes_cli.py | 139s |
| `psf__requests-3362` | **PASS** | `model_finished` | 24 | requests/utils.py, reproduce_issue.py | 75s |
| `pylint-dev__pylint-5859` | **PASS** | `model_finished` | 17 | pylint/checkers/misc.py, repro.py | 68s |
| `pylint-dev__pylint-6506` | FAIL | `model_finished` | 31 | — | 83s |
| `pylint-dev__pylint-7228` | FAIL | `model_finished` | 5 | reproduce_issue.py | 13s |
| `pylint-dev__pylint-7993` | FAIL | `model_finished` | 33 | apply_fix.py, reproduce_issue.py, test_fix.py, test_formatter.py, test_issue.py, test_template.py | 165s |
| `pytest-dev__pytest-11143` | FAIL | `no_progress` | 13 | reproduce_issue.py | 29s |
| `pytest-dev__pytest-11148` | FAIL | `model_finished` | 24 | — | 33s |
| `pytest-dev__pytest-6116` | FAIL | `no_progress` | 5 | — | 4s |
| `pytest-dev__pytest-7220` | FAIL | `max_turns` | 40 | reproduce_issue.py | 93s |
| `pytest-dev__pytest-7373` | **PASS** | `model_finished` | 11 | src/_pytest/mark/evaluate.py | 45s |
| `pytest-dev__pytest-7432` | FAIL | `model_finished` | 28 | src/_pytest/skipping.py, repro.py | 67s |
| `pytest-dev__pytest-7490` | FAIL | `no_progress` | 31 | reproduce_issue.py | 66s |
| `pytest-dev__pytest-8365` | FAIL | `model_finished` | 15 | src/_pytest/tmpdir.py, reproduce_issue.py | 48s |
| `pytest-dev__pytest-8906` | FAIL | `model_finished` | 30 | src/_pytest/python.py, reproduction.py | 62s |
| `pytest-dev__pytest-9359` | FAIL | `max_turns` | 40 | reproduction.py | 71s |

## Variance — read before quoting any number

**No stable/high-variance label is assigned to any task**, because this is n=1 (§4). The V0
`STABLE_SUCCESS` / `HIGH_VARIANCE` labels were defined at n=3 and do not transfer to a single run.

Variance was observed to be *behavioural*, not merely scalar — two runs of the same task under
an identical corpus hash and configuration differed in which files they touched, not just in
pass/fail. Those particular observations came from the pre-fix environment and are recorded in
`variance-note.md` and `invalidated-baseline.md`; they are cited as a reason for caution, NOT as
measurements of this baseline. No repeat has yet been run against the corrected environment.

**"17.6%" means: this model passed 3 of 17 Stage-1 task instances under this
configuration, on one run each.** It is not a measurement of capability (§18).
