# Repeatability — the 8 HIGH-confidence failure tasks

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Corpus `CAPABILITY_V1_STAGE1` · model `qwen3-14b-sweep` · n=3 · nothing tuned between repeats.

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
| `pallets__flask-5063` | termination | — | — | INCOMPLETE (n=1) | — |
| `pytest-dev__pytest-7432` | termination | — | — | INCOMPLETE (n=1) | — |
| `pytest-dev__pytest-8365` | termination | — | — | INCOMPLETE (n=1) | — |
| `pytest-dev__pytest-8906` | termination | — | — | INCOMPLETE (n=1) | — |

## Outcome stability

| label | count |
|---|---|

## Mechanism stability

_No task has reached n=3 yet._
