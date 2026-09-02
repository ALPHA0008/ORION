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
| `pallets__flask-5063` | long-horizon execution | termination | — | INCOMPLETE (n=2) | — |
| `pylint-dev__pylint-6506` | editing | — | — | INCOMPLETE (n=1) | — |
| `pytest-dev__pytest-11148` | editing | — | — | INCOMPLETE (n=1) | — |
| `pytest-dev__pytest-6116` | long-horizon execution | — | — | INCOMPLETE (n=1) | — |
| `pytest-dev__pytest-7432` | termination | — | — | INCOMPLETE (n=1) | — |
| `pytest-dev__pytest-8365` | editing | — | — | INCOMPLETE (n=1) | — |
| `pytest-dev__pytest-8906` | editing | — | — | INCOMPLETE (n=1) | — |

## Outcome stability

| label | count |
|---|---|
| HIGH_VARIANCE | 1 |

## Mechanism stability

Of 1 task(s) at n=3, **1** changed mechanism between repeats.

| task | mechanisms observed |
|---|---|
| `pallets__flask-4045` | termination, long-horizon execution |

A mechanism that changes between repeats of the *same task* is **not stable**, even when
the pass/fail outcome is. This is the distinction that decides whether a mechanism can
support an intervention, and it is why outcome stability alone is not enough (§26).
