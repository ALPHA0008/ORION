# Corpus Distribution (§16-17)

> **NUMBERS WITHDRAWN — REGENERATION PENDING.** Every figure in this file was computed from the
> Gemma run that has since been INVALIDATED (no Python interpreter on PATH; see
> `invalidated-baseline.md`). Do not cite anything here. This file is regenerated from the
> corrected baseline as soon as it completes.


**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

Corpus `CAPABILITY_V1_STAGE1` · sha256 `0a9a279d48a491dacdadfd71…` · **17 tasks**

## What the corpus IS

| dimension | distribution |
|---|---|
| repositories | pytest-dev/pytest **10** · pylint-dev/pylint **4** · pallets/flask **2** · psf/requests **1** |
| languages | Python 17/17 (100%) |
| test frameworks | pytest 17/17 (100%) |
| interpreters | 3.9 × 16 · 3.8 × 1 |
| files touched by gold patch | **exactly 1 in every task** |
| declared PASS_TO_PASS | min 6 · median 54 · max 129 |

## Failure distribution by repository — Gemma (n=1)

| repository | tasks | failures | share of failures |
|---|---|---|---|
| pytest-dev/pytest | 10 | 8 | **53%** |
| pylint-dev/pylint | 4 | 4 | **27%** |
| pallets/flask | 2 | 2 | **13%** |
| psf/requests | 1 | 1 | **7%** |

Largest single-repository share of failures: **53%**.

### Mechanism generalisation — Gemma (§25 filter)

| mechanism | failures | repositories | spread |
|---|---|---|---|
| `premature termination` | 8 | **4/4** | flask 2, requests 1, pylint 3, pytest 2 |
| `context acquisition` | 4 | **1/4** | pytest 4 |
| `editing` | 2 | **1/4** | pytest 2 |
| `reasoning` | 1 | **1/4** | pylint 1 |

## Why dominance alone does not settle the question

Dominance in the failure **count** is not the same as dominance in the failure **mechanism**.
A repository can contribute most of the failures while contributing none of the *generalising*
ones. The generalisation table above is what decides whether a candidate bottleneck is a
property of the agent or an artifact of one over-represented repository — which is precisely
what the §25 filter exists to prevent optimising for.

## What the corpus does NOT represent

- **No multi-file change.** Every gold patch touches exactly one file. That is what SWE-bench
  *Lite* is, not a filter we applied. This corpus cannot measure multi-file refactoring,
  cross-module reasoning, or architectural change, and no result here may be read as if it could.
- **One language, one test framework.** Python and pytest throughout.
- **Not the hard end of the range.** django, sympy, matplotlib and the scientific stack were
  excluded for buildability (`corpus-selection.md`). The top of the difficulty range is truncated,
  so a *success* rate here does not transfer upward; a *failure* here probably does.
- **Four repositories, two of them developer tooling** (pytest, pylint) with unusual test idioms.
- **n=1 per task.** Nothing here supports a stability claim about any individual task (§4, §18).