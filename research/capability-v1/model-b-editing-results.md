# Model-B Editing Experiment — Results (PROVISIONAL)

> **Every number here is provisional.** Nothing in this file is a conclusion, and no capability
> implementation follows from it. The protocol in `model-b-editing-protocol.md` was predeclared
> before any Model-B run; only its stated bar and decision rules are applied.

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Corpus `CAPABILITY_V1_STAGE1` · sha256 `0a9a279d…` · unmodified.
Stage-1 baseline artifact `runs/gemma4-31b.json` verified byte-identical (sha `a068127d…`) **after
every one of the 15 runs** by the runner's own guard.

## Parity — CASE B1 confirmed

| field | Model A | Model B |
|---|---|---|
| model | `gemma4-31b` (vLLM, `172.20.7.22:8000`) | `mistral-small3.2` (Ollama, `localhost:11434`, 15.2 GB, 128K) |
| adapter | `createOpenAICompatModel` | **same** |
| shim | `applyGemmaToolCallShim` | **same object, INERT** — `ext.shimmed` absent |
| tool calls | reconstructed by the shim | **native, parseable** |
| prompt / tools / budget / verifier / corpus | — | **identical** |

Mistral emits native `tool_calls`, so both shim guards fail and it returns the result unchanged.
This is **case B1** from the protocol: *"only the model changed" holds literally.* No adapter
confound applies to the comparison below.

## Results — 5 tasks x 3 repeats = 15 runs

| task | r1 | r2 | r3 | label | mechanism stable? |
|---|---|---|---|---|---|
| `pallets__flask-5063` | termination | termination | termination | STABLE_FAILURE | yes |
| `pylint-dev__pylint-6506` | termination | termination | termination | STABLE_FAILURE | yes |
| `pytest-dev__pytest-7432` | termination | termination | termination | STABLE_FAILURE | yes |
| `pytest-dev__pytest-8365` | termination | termination | termination | STABLE_FAILURE | yes |
| `pytest-dev__pytest-8906` | long-horizon | long-horizon | long-horizon | STABLE_FAILURE | yes |

Mechanisms are assigned by the **existing Stage-1 classifier** (`report-repeats.mjs`, label-scoped
to the Mistral artifacts). None was hand-assigned.

**Mistral: 0 of 5 tasks passed. 0 of 15 runs passed.**

## The decisive observation — Mistral never attempted an edit

| task | tool calls per run | files edited |
|---|---|---|
| `pallets__flask-5063` | 4, 2, 2 | **none** |
| `pylint-dev__pylint-6506` | 3, 3, 3 | **none** |
| `pytest-dev__pytest-7432` | 2, 2, 2 | **none** |
| `pytest-dev__pytest-8365` | 1, 2, 2 | **none** |
| `pytest-dev__pytest-8906` | **0, 0, 0** | **none** |

`diff_stat` is empty in **all 15 runs**. Mistral did not fail *at editing*; it never reached the
point of editing.

`pytest-8906` is the sharpest case. On all three repeats Mistral made **zero tool calls** and
immediately invoked `ask_user`, pausing the run (`status: paused`, `reason: awaiting_human`,
1 escalation):

> *"How should I improve the handling of skip for module level in the pytest-dev/pytest repository?
> Please provide the necessary code changes or instructions."*

It asked the human to supply the fix. That is legitimate agent behaviour under ADR-009 — a durable
pause, not a crash and not an infrastructure fault — and it is scored as a failure because the
objective was not met.

## Comparison with the Gemma reference

Gemma on the identical five tasks, n=3 (from `repeatability.md`):

| task | Gemma r1/r2/r3 (result, tool calls, edited source?) |
|---|---|
| `pallets__flask-5063` | F/19/Y · F/1/N · F/40/Y |
| `pylint-dev__pylint-6506` | F/17/Y · F/17/Y · F/25/Y |
| `pytest-dev__pytest-7432` | F/5/N · **P**/11/Y · **P**/11/Y |
| `pytest-dev__pytest-8365` | F/35/Y · F/13/Y · F/11/Y |
| `pytest-dev__pytest-8906` | F/15/Y · F/16/Y · F/11/Y |

| | Gemma | Mistral |
|---|---|---|
| tasks passed (>=2-of-3) | **0 / 5** | **0 / 5** |
| runs passed | 2 / 15 | **0 / 15** |
| runs that edited source | **13 / 15** | **0 / 15** |
| median tool calls | ~13 | **2** |

## Applying the predeclared bar

> Success = **>=3 of 5 tasks**, each with **>=2-of-3 repeats passing**.

Mistral: **0 of 5**. The bar is **not met**. Gemma also does not meet it (0 of 5; `pytest-7432`
reached 2-of-3 but is the only one, and it flips).

## Decision — **OUTCOME C: UNRESOLVED**

Working through the predeclared rules in order:

- **Outcome A** (Model B meets the bar, Gemma does not) — **not met.** Mistral passed nothing.
- **Outcome B** (both fail, **same mechanism on the same tasks**) — **not met**, and this is the
  substantive finding rather than a technicality. The protocol requires the *mechanism* to match,
  not merely the outcome. It does not:

  | task | Gemma mechanism (n=3) | Mistral mechanism (n=3) |
  |---|---|---|
  | `pylint-6506` | `editing` x3 | `termination` x3 |
  | `pytest-8906` | `editing` x3 | `long-horizon execution` x3 |
  | `pytest-8365` | editing, editing, long-horizon | `termination` x3 |
  | `flask-5063` | long-horizon, termination, editing | `termination` x3 |
  | `pytest-7432` | termination, PASS, PASS | `termination` x3 |

  Gemma reaches the source and edits it wrongly. Mistral stops before touching source at all. Two
  models failing the same tasks for **different reasons** is explicitly *not* cross-model evidence.

- **Outcome C** — **selected.** The editing weakness remains **UNRESOLVED**, and is not forced.

## What this does and does not establish

**Does:**

- Adapter parity is real (B1), so the comparison is clean.
- Mistral Small 3.2 is **not** a stronger editor here — it is a *weaker actor*, terminating or
  escalating before it edits.
- Mechanism stability is high **within** each model (5/5 stable for Mistral) and low **across**
  them. Under a model swap the mechanism changes; that is a genuine model-attribution signal, and
  it points away from a harness-level editing bottleneck rather than toward one.

**Does not:**

- Establish that editing is model-limited. That needs a model which *reaches* the edit and succeeds
  more often — Mistral never reached it, so it cannot discriminate.
- Establish that editing is harness-limited. Outcome B's mechanism-match condition failed.
- Say anything about Mistral's capability generally. Five tasks, one corpus, n=3, one serving stack.
- License any capability implementation. This phase stops at the write-up.

## Honest reading

The experiment was designed to discriminate between "model-limited" and "harness-limited" editing.
It returned neither, for a reason worth stating plainly: **the second model was not comparable on
the axis being tested.** Mistral's dominant behaviour — 0–4 tool calls, no edits, an immediate
`ask_user` on one task — means it never generated the evidence the comparison needed.

A useful Model-B for the *editing* question must first clear a lower bar: it has to attempt edits at
a rate comparable to Gemma's 13/15. That is now a concrete selection criterion for the next
candidate, and it is more informative than the null result itself.

## Optional second pass — R1 slots (NOT RUN)

Recorded per instruction, **not executed**, and **excluded from the B1 analysis above**:

| slot | model | flag | reason |
|---|---|---|---|
| R1-32b | DeepSeek-R1 32B | **B2** | size/family confound vs. Gemma 31B and Mistral Small |
| R1-70b | DeepSeek-R1 70B | **B2** | size confound — more than 2x parameter scale |

Both are **B2 (explicit confound)** under the protocol: a difference in outcome could be attributed
to scale or family rather than to the harness. Their numbers must **never** be merged into the B1
comparison. Same 5 tasks, same `HARNESS_MODEL` swap, same predeclared bar, results in their own
section.

## Provenance

| item | value |
|---|---|
| artifacts | `eval/capability-v1/runs/repeats/mistral-small3.2-<task>-r{1,2,3}.json` (15) |
| classifier report | `eval/capability-v1/reports/repeatability-mistral.json` |
| per-model write-up | `research/capability-v1/repeatability-mistral.md` |
| Gemma artifacts | 24, untouched |
| baseline guard | `a068127d…` asserted after every run — never tripped |
| `v0/src` | unmodified |
