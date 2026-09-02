# Repeatability — the 8 HIGH-confidence failure tasks

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Corpus `CAPABILITY_V1_STAGE1` · model `mistral-small3.2` · n=3 · nothing tuned between repeats.

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
| `pallets__flask-5063` | termination | termination | termination | STABLE_FAILURE | yes |
| `pylint-dev__pylint-6506` | termination | termination | termination | STABLE_FAILURE | yes |
| `pytest-dev__pytest-7432` | termination | termination | termination | STABLE_FAILURE | yes |
| `pytest-dev__pytest-8365` | termination | termination | termination | STABLE_FAILURE | yes |
| `pytest-dev__pytest-8906` | long-horizon execution | long-horizon execution | long-horizon execution | STABLE_FAILURE | yes |

## Outcome stability

| label | count |
|---|---|
| STABLE_FAILURE | 5 |

## Mechanism stability

Of 5 task(s) at n=3, **0** changed mechanism between repeats.
