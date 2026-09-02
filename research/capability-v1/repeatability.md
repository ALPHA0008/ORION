# Repeatability — the 8 HIGH-confidence failure tasks

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Corpus `CAPABILITY_V1_STAGE1` · Gemma 4 31B · n=3 · nothing tuned between repeats.

## Scope — what this does and does not measure

These 8 are the **HIGH-confidence failures only**: 2 long-horizon + 4 editing + 2 termination,
against a full Stage-1 distribution of **6 + 4 + 4**. The **6 MEDIUM-confidence failures remain
at n=1** and are not touched here.

> This tests repeatability **for these eight cases**. It does **not** replicate the Stage-1
> failure distribution, and no claim in this file should be read as if it did.

The Stage-1 baseline artifact was hashed before the study and re-checked after every run; it is
byte-identical. Repeats live in `runs/repeats/`, each independently inspectable.

## Per-task results

| task | r1 | r2 | r3 | label | mechanism stable? |
|---|---|---|---|---|---|
| `pallets__flask-4045` | **PASS** | termination | long-horizon execution | HIGH_VARIANCE | **NO** |
| `pallets__flask-5063` | long-horizon execution | termination | editing | STABLE_FAILURE | **NO** |
| `pylint-dev__pylint-6506` | editing | editing | editing | STABLE_FAILURE | yes |
| `pytest-dev__pytest-11148` | editing | termination | termination | STABLE_FAILURE | **NO** |
| `pytest-dev__pytest-6116` | long-horizon execution | long-horizon execution | editing | STABLE_FAILURE | **NO** |
| `pytest-dev__pytest-7432` | termination | **PASS** | **PASS** | HIGH_VARIANCE | yes |
| `pytest-dev__pytest-8365` | editing | editing | long-horizon execution | STABLE_FAILURE | **NO** |
| `pytest-dev__pytest-8906` | editing | editing | editing | STABLE_FAILURE | yes |

## Outcome stability

| label | count |
|---|---|
| STABLE_FAILURE | 6 |
| HIGH_VARIANCE | 2 |

## The decisive number

**Only 2 of 8 tasks are both stably-failing AND mechanism-stable.**

| property | count |
|---|---|
| outcome flips between PASS and FAIL (`HIGH_VARIANCE`) | **2 / 8** |
| fails all 3 runs (`STABLE_FAILURE`) | **6 / 8** |
| ...of which the **mechanism** is also stable | **2 / 6** |
| changes mechanism between identical repeats | **5 / 8** |

Mechanism-stable tasks:

| task | label | mechanism |
|---|---|---|
| `pylint-dev__pylint-6506` | STABLE_FAILURE | `editing` ×3 |
| `pytest-dev__pytest-8906` | STABLE_FAILURE | `editing` ×3 |
| `pytest-dev__pytest-7432` | HIGH_VARIANCE | `termination` (its single failure) |

Mechanism-**unstable** tasks — same task, same corpus hash, same configuration, different mechanism:

| task | mechanisms observed across 3 runs |
|---|---|
| `pallets__flask-4045` | PASS · `termination` · `long-horizon execution` |
| `pallets__flask-5063` | `long-horizon execution` · `termination` · `editing` |
| `pytest-dev__pytest-11148` | `editing` · `termination` · `termination` |
| `pytest-dev__pytest-6116` | `long-horizon execution` · `long-horizon execution` · `editing` |
| `pytest-dev__pytest-8365` | `editing` · `editing` · `long-horizon execution` |

`pallets__flask-5063` is the extreme case: **three runs, three different mechanisms**, all failing.

## What this does to the Stage-1 mechanism counts

Across all 24 runs the mechanism frequencies are `editing` 11 · `termination` 5 ·
`long-horizon execution` 5 · PASS 3. Compare the Stage-1 n=1 reading of the same 8 tasks
(4 editing, 2 termination, 2 long-horizon):

> The n=1 mechanism label for a task is **not a property of the task**. It is one sample from a
> distribution over mechanisms.

`pytest-6116` illustrates it concretely. Stage 1 recorded `long-horizon execution` with **HIGH**
confidence, on a trajectory that genuinely showed five near-identical `grep` calls and ADR-006
firing. That diagnosis was accurate *about the run it observed*. Run 3 of the same task produced an
`editing` failure instead. Both readings are correct; neither is the task's mechanism.

## Consequence for the first V1 intervention

§30's standard is: same mechanism + multiple tasks + multiple repositories + repeat support +
trajectory evidence.

Repeat support now exists as a **measurement**, and it mostly does not hold:

- `editing` is the only mechanism with any repeat support — stable across 3 runs on 2 tasks
  (`pylint-6506`, `pytest-8906`), in 2 repositories, and the most frequent mechanism overall (11/24).
- `termination` is mechanism-stable on exactly 1 task, which also flips outcome.
- `long-horizon execution` is mechanism-stable on **none**.

An intervention targeting `termination` or `long-horizon execution` would be aimed at labels that do
not survive re-running the identical task. That is the specific error the repeat study was
commissioned to prevent, and it fired.

## Mechanism stability

Of 8 task(s) at n=3, **5** changed mechanism between repeats.

| task | mechanisms observed |
|---|---|
| `pallets__flask-4045` | termination, long-horizon execution |
| `pallets__flask-5063` | long-horizon execution, termination, editing |
| `pytest-dev__pytest-11148` | editing, termination |
| `pytest-dev__pytest-6116` | long-horizon execution, editing |
| `pytest-dev__pytest-8365` | editing, long-horizon execution |

A mechanism that changes between repeats of the *same task* is **not stable**, even when
the pass/fail outcome is. This is the distinction that decides whether a mechanism can
support an intervention, and it is why outcome stability alone is not enough (§26).
