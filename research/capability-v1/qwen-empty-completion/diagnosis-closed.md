# Diagnosis Closed

**Classification:** `QWEN_INTERACTION_MECHANISM_CONFIRMED`
**State:** HARD STOP — no further Qwen diagnosis in Stage 1.

The other files in this directory are the historical diagnostic record and are **preserved as-is**.
This file records only that the investigation is closed and where the formal outcome lives.

## Formal record

`research/capability-v1/qwen-invalidation.md` is the single Stage-1 Qwen invalidation record.
This directory deliberately contains **no competing baseline document**.

## What was established

- 17 live runs, complete, against the frozen corpus (`0a9a279d…`, runtime `6e4d532`).
- The corrected replay protocol — replay starting immediately **before** the terminal empty
  response, the terminal failure never fed back, real durable tool-result history, projection clamp
  preserved — reproduced the phenomenon **deterministically** for `flask-4045`,
  `pytest-dev__pytest-9359` and `pylint-7993`.
- `pylint-7993` reproduced from **minimal state, with 0 bytes of tool feedback**.
- The 17-run aggregate found **no** common last tool, tool sequence, result-volume threshold or
  input-token threshold.

The minimal-state reproduction is what closes the investigation: a phenomenon that reproduces with
no tool feedback at all cannot be attributed to result volume or context pressure, which is exactly
why no common antecedent exists to find.

## Why it stops here

The remaining question — whether the fault lies in the model, the Ollama serving layer, or the
harness's interaction pattern — cannot be answered without changing the model, the endpoint or the
harness. All three are forbidden in a measurement phase, and each would invalidate the baseline it
is meant to explain.

## Explicitly not done

No retry logic. No sampling change. No endpoint change. No rerun. No claim that Qwen capability
is 0%.
