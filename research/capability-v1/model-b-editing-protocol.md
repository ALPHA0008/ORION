# Model-B Editing Experiment — Protocol (PREDECLARED)

**Status: `MODEL_B_PENDING`.** No Model-B run has occurred. This protocol is written **before** any
such run so its thresholds cannot be chosen after seeing results.

## The question

Stage 1D's repeat study found that `editing` is the **only** mechanism with repeat support:
mechanism-stable across 3 runs on 2 tasks in 2 repositories, and the most frequent mechanism overall
(11 of 24 runs). It is also the mechanism Stage 1 set aside as *"real, but not a harness problem."*

That tension is exactly what a second model resolves:

> Are the observed editing failures **model-limited** or **harness/capability-limited**?

With one valid arm this is unanswerable. No amount of additional Gemma data settles it.

## Predeclared configuration

| field | Model A | Model B |
|---|---|---|
| model | `gemma4-31b` (RedHatAI/gemma-4-31B-it-NVFP4) | **TBD** — see selection criteria |
| serving stack | vLLM · `172.20.7.22:8000/v1` | TBD |
| adapter | `createOpenAICompatModel` | **same** (required) |
| tool-call shim | `applyGemmaToolCallShim` | **same shim object** — see parity note |
| system prompt | `DEFAULT_SYSTEM`, sha256 `eeab8d89…` | identical |
| temperature | 0 (runtime default) | identical |
| max tokens | 2048 (runtime default) | identical |
| context config | ADR-001 bounded projection, `WINDOW=40`, `MSG_CLAMP=2000`, no compaction | identical |
| resource budget | `maxTurns` 40 · 15 min timeout · 4M tokens · 600 tool calls | identical |
| verifier | `eval/capability-v1/verify.mjs` — pytest/runtests exit status, oracle restored from git | identical |
| repeats | **n=3** | identical |
| runner | `run-repeats.mjs` | identical |

## Adapter parity — stated explicitly, not assumed

`run-repeats.mjs` hard-imports `applyGemmaToolCallShim`, so the claim *"only the model changes"* is
**not automatically true**. Having read the shim, the situation is more favourable than a blanket
confound, and the distinction matters:

```js
let tool_calls = result.tool_calls ?? [];
if (!tool_calls.length && looksLikeGemmaToolCall(content)) { … }
```

The shim is **conditional**. It engages only when the provider supplied **no** native `tool_calls`
*and* the content matches Gemma's textual tool-call form. For a model that emits native
`tool_calls`, both guards fail and the shim returns the result **unchanged** — it is inert, not
merely harmless.

This gives two admissible cases, and one inadmissible one:

| case | Model B behaviour | status |
|---|---|---|
| **B1** | emits native `tool_calls` | shim inert → **true parity**; "only the model changes" holds |
| **B2** | needs its own shim | **explicit confound** — record it, and treat any difference as `ADAPTER_SPECIFIC` until disentangled |
| **B3** | silently gets a *different* shim without it being recorded | **not permitted** |

The channel-marker strip (step 1) does run for any model whose content happens to contain those
markers. That is recorded as a residual difference, not waved away.

**Verification step, before the experiment counts:** invoke Model B once through
`createOpenAICompatModel` with a trivial tool and inspect `ext.shimmed`. Absent ⇒ case B1. Present
⇒ case B2, and the protocol records which shims fired.

## Tasks

The five `editing`-family tasks from the Stage-1 corpus:

| task | repository | Stage-1D repeat evidence |
|---|---|---|
| `pylint-dev__pylint-6506` | pylint | STABLE_FAILURE, `editing` ×3 — **mechanism-stable** |
| `pytest-dev__pytest-8906` | pytest | STABLE_FAILURE, `editing` ×3 — **mechanism-stable** |
| `pytest-dev__pytest-8365` | pytest | STABLE_FAILURE, mechanism *unstable* (editing, editing, long-horizon) |
| `pytest-dev__pytest-7432` | pytest | HIGH_VARIANCE (termination, PASS, PASS) |
| `pallets__flask-5063` | flask | STABLE_FAILURE, mechanism *unstable* (three different mechanisms) |

Only the first two carry stable-mechanism evidence. The other three are included because the
Stage-1 analysis grouped them as `editing`, and excluding them after seeing Gemma's results would be
selection on the outcome. Their instability is recorded here **in advance** so it cannot later be
presented as a surprise.

Corpus: `CAPABILITY_V1_STAGE1`, sha256 `0a9a279d…`, unchanged and unmodified.

## Success bar — fixed BEFORE the run

**Model B is considered to succeed on the editing family only if BOTH hold:**

1. **≥ 3 of the 5 tasks pass**, and
2. for each counted task, **≥ 2 of its 3 repeats pass**.

Condition 2 exists because of a measured fact, not caution in the abstract: `pytest-7432` already
flipped PASS/FAIL across identical Gemma repeats. A single passing run is within observed noise, so
one lucky run must not count as a task success.

Gemma's baseline on these five, for comparison: **0 of 5** passed at n=1, and across the n=3 repeat
study none reached 2-of-3 passes.

## Decision rules — also predeclared

| outcome | condition | reading |
|---|---|---|
| **A — model-limited** | Model B meets the bar, Gemma does not | editing weakness is likely **model-limited**. **Do not build edit scaffolding.** |
| **B — cross-model** | both models fail, **same first-causal-divergence mechanism** | editing becomes a much stronger **harness/capability** candidate |
| **C — mixed** | neither condition met | editing remains **UNRESOLVED**; do not force a conclusion |

Outcome B requires the **mechanism** to match, not merely the outcome. Two models failing the same
task for different reasons is not cross-model evidence — the same rule already applied within the
Gemma repeat study.

## Model-B selection criteria

Not open-ended model shopping. A candidate qualifies when it has:

- a reliably served OpenAI-compatible endpoint (no known interaction failure)
- capability broadly comparable to a 30B-class instruct model
- documented tool-call behaviour (native preferred → case B1)
- a context window sufficient for `WINDOW=40` projections on real repositories

**Qwen 3.6 35B is excluded**: `QWEN_INTERACTION_MECHANISM_CONFIRMED`, a deterministic
model/serving/harness interaction failure. Not reopened, not rerun, and its 0/17 is not a capability
score.

To record on selection: model name · parameter scale · serving stack · endpoint · context window ·
tool-call behaviour · adapter · known constraints.

## What this experiment does NOT do

It does not select a V1 intervention. Even Outcome B would establish editing as a *stronger
candidate*, not a justified intervention — that still requires the §T gate: same mechanism, multiple
tasks, multiple repositories, repeat support, first-causal-divergence evidence, and model
attribution.
