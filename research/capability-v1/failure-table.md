# Failure Table — Stage 1 (Gemma, the sole valid arm)

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

Corpus `0a9a279d48a491da…` · runtime `6e4d532` · **n=1 per task**

Qwen contributes **nothing** to this table — see `qwen-invalidation.md`.

Confidence is trajectory-evidence strength, not intuition:
**HIGH** = the divergence is visible in the trajectory together with the actor's action at
that moment · **MEDIUM** = inferred from surrounding trajectory evidence · **LOW** = inferred
without a direct trace.

| Task | Result | First causal divergence | Mechanism | Evidence | Confidence |
|---|---|---|---|---|---|
| `pallets__flask-4045` | FAIL | 36 tool calls, 18 read/grep, ZERO source edits; stopped with reason=no_progress | `long-horizon execution` | 36 calls, 1 failed, exit `no_progress` | HIGH |
| `pallets__flask-5063` | FAIL | edited src/flask/cli.py; FAIL_TO_PASS still fails | `editing` | 20 calls, 6 failed, exit `model_finished` | HIGH |
| `pylint-dev__pylint-6506` | FAIL | 31 tool calls, 11 read/grep, ZERO source edits; stopped with reason=model_finished | `termination` | 31 calls, 11 failed, exit `model_finished` | HIGH |
| `pylint-dev__pylint-7228` | FAIL | changed the tree only by creating scratch/reproduction files (reproduce_issue.py); source never edited; stopped with reason=model_… | `termination` | 5 calls, 2 failed, exit `model_finished` | MEDIUM |
| `pylint-dev__pylint-7993` | FAIL | changed the tree only by creating scratch/reproduction files (apply_fix.py, reproduce_issue.py, test_fix.py, test_formatter.py, te… | `termination` | 33 calls, 9 failed, exit `model_finished` | MEDIUM |
| `pytest-dev__pytest-11143` | FAIL | changed the tree only by creating scratch/reproduction files (reproduce_issue.py); source never edited; stopped with reason=no_pro… | `long-horizon execution` | 13 calls, 6 failed, exit `no_progress` | MEDIUM |
| `pytest-dev__pytest-11148` | FAIL | 24 tool calls, 9 read/grep, ZERO source edits; stopped with reason=model_finished | `termination` | 24 calls, 5 failed, exit `model_finished` | HIGH |
| `pytest-dev__pytest-6116` | FAIL | 5 tool calls, 5 read/grep, ZERO source edits; stopped with reason=no_progress | `long-horizon execution` | 5 calls, 0 failed, exit `no_progress` | HIGH |
| `pytest-dev__pytest-7220` | FAIL | changed the tree only by creating scratch/reproduction files (reproduce_issue.py); source never edited; stopped with reason=max_tu… | `long-horizon execution` | 40 calls, 7 failed, exit `max_turns` | MEDIUM |
| `pytest-dev__pytest-7432` | FAIL | edited src/_pytest/skipping.py; FAIL_TO_PASS still fails | `editing` | 28 calls, 1 failed, exit `model_finished` | HIGH |
| `pytest-dev__pytest-7490` | FAIL | changed the tree only by creating scratch/reproduction files (reproduce_issue.py); source never edited; stopped with reason=no_pro… | `long-horizon execution` | 31 calls, 7 failed, exit `no_progress` | MEDIUM |
| `pytest-dev__pytest-8365` | FAIL | edited src/_pytest/tmpdir.py; FAIL_TO_PASS still fails | `editing` | 15 calls, 2 failed, exit `model_finished` | HIGH |
| `pytest-dev__pytest-8906` | FAIL | edited src/_pytest/python.py; FAIL_TO_PASS still fails | `editing` | 30 calls, 2 failed, exit `model_finished` | HIGH |
| `pytest-dev__pytest-9359` | FAIL | changed the tree only by creating scratch/reproduction files (reproduction.py); source never edited; stopped with reason=max_turns | `long-horizon execution` | 40 calls, 16 failed, exit `max_turns` | MEDIUM |
| `psf__requests-3362` | **PASS** | — | — | 24 calls | — |
| `pylint-dev__pylint-5859` | **PASS** | — | — | 17 calls | — |
| `pytest-dev__pytest-7373` | **PASS** | — | — | 11 calls | — |

## Mechanisms are split by TERMINAL CONDITION, deliberately

An earlier cut of this table put 10 of 14 failures in one bucket called "premature
termination". That was a reporting artifact hiding two mechanisms that imply **opposite**
interventions:

- `termination` — the agent stopped because it **believed it was finished**
  (`model_finished`) while the world was unchanged.
- `long-horizon execution` — the **runtime** had to stop it (`no_progress`,
  `max_turns`), typically mid-loop.

Merging them would have pointed the first V1 intervention at whichever happened to be larger.
