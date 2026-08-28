# First Real-Repository Capability Baseline

The current V0 agent, **unchanged**, measured against 22 bracketed tasks over 5 pinned real
repositories.

- **Runner:** `harness-v0` (V0 runtime frozen for this phase)
- **Model:** `gemma4-31b` via vLLM, OpenAI-compatible
- **Compaction:** off
- **Raw results:** [`eval/real/reports/v0-real-baseline.json`](../../eval/real/reports/v0-real-baseline.json)

## Headline

```
7/22 passed  (31.8%)
by difficulty: easy 3/4   medium 4/10   hard 0/8
wall p50 10s  p95 57s
per success: 13.71 model calls, 13 tool calls, 46,997 tokens
failure classes: no_progress=14  budget_exhausted=1
```

**This benchmark discriminates.** The synthetic suite scored 17/17 and could not distinguish
anything. The same agent, unchanged, scores 31.8% here — and fails **every single hard task**.

## Success by difficulty — labels validated

| difficulty | pass/total | rate |
|---|---|---|
| easy | 3/4 | 75% |
| medium | 4/10 | 40% |
| hard | 0/8 | 0% |

Monotonic, as hypothesised. The difficulty labels are **supported by evidence** and kept.

## Success by repository — the finding

| repository | `index.js` size | visible under `MSG_CLAMP` (2,000 B) | pass/total | rate |
|---|---:|---:|---:|---:|
| `is-number` | 411 B | **100%** | 4/4 | **100%** |
| `p-limit` | 3,315 B | 60% | 1/4 | 25% |
| `slugify` | 4,137 B | 48% | 1/5 | 20% |
| `ansi-styles` | 6,962 B | 29% | 1/2 | 50% |
| `camelcase` | 7,527 B | **27%** | 0/7 | **0%** |

The only repository whose main source file fits inside the projection clamp is the only one where
the agent scores 100%. The repository whose file is least visible scores 0%.

## The mechanism, read from the event log

Trajectory of `camel-unicode-uppercase` (representative of 14 of 15 failures):

```
bash  ls -R                     ✓
read  package.json              ✓
bash  npx ava                   ✕ (failing assertions — this is information, not a fault)
read  index.js                  ✓   ← truncated at 2,000 of 7,527 bytes
read  index.js                  ✓   ← identical request
read  index.js                  ✓   ← identical request
read  index.js                  ✓   ← identical request
failed — no_progress (identical tool request repeated 4 times)
```

The agent reads the file, receives 27% of it, cannot find what it needs, and re-issues the
**identical** read hoping for more. It gets the same truncated 2,000 bytes every time. ADR-006's
no-progress detector then correctly terminates the run.

**15 of 15 failures re-read one identical file 2–4 times.** Not most — all.

The duplicate-action rate separates the two populations cleanly:

| outcome | n | mean duplicate_action_rate |
|---|---:|---:|
| PASS | 7 | **0.253** |
| FAIL | 15 | **0.486** |

## Trajectory signal correlations (measured, not assumed)

Section 13 asked whether trajectory signals predict success. On this dataset:

- **Duplicate actions → strongly predict failure.** 0.486 vs 0.253; every failure exhibits
  identical-request repetition.
- **Repeated test failure → does *not* predict failure.** A failing `npx ava` is how the agent
  learns what is broken; successful runs contain them too.
- **High tool count → does not predict either.** `isnum-nan-guard` PASSED with 40 tool calls;
  `ansi-brightness-bit` FAILED with 40. Volume is not the signal — *repetition* is.
- **Context compaction → could not be evaluated.** Compaction was off for the baseline.
- **Human intervention → never occurred.** `ask_user` was not called once in 22 tasks, even when
  the agent was stuck in a loop it could not escape.

## Where the agent is genuinely competent

The 7 passes are real work, not luck:

- `isnum-hidden-contract` — passed the repo suite **and** a hidden contract test it never saw,
  correctly rejecting `{}`, `true`, `Infinity`, `'   '`.
- `plimit-validate-concurrency` — restored option validation in async concurrency code.
- `slug-preserve-conflict` — restored an error guard in a multi-file string pipeline.
- `ansi-16m-escape` — fixed a truecolor escape sequence in dense numeric code.

When the agent can *see* the code, it fixes real defects in unfamiliar third-party source.

## Interpretation

The bottleneck is not reasoning, planning, tool selection, or memory. It is that **the agent
cannot read a file larger than 2,000 bytes.**

`MSG_CLAMP` is doing exactly what ADR-001 designed it to do — bound the projection so hot state
cannot grow with conversation length. That decision was validated and remains correct. The defect
is that **truncation was implemented without a way to retrieve the remainder.** The clamp message
even says the full text "remains in the event log", but the agent has no tool to fetch it.

This is a Layer 2 (capability) gap exposed by a Layer 1 (runtime) bound — precisely the kind of
finding this benchmark was built to produce, and one the synthetic suite structurally could not
find, because every fixture file was small enough to fit.

## Reproduction

```bash
export HARNESS_BASE_URL=... HARNESS_API_KEY=... HARNESS_MODEL=gemma4-31b
node eval/real/cli/index.mjs bracket          # 22/22 valid
node eval/real/cli/index.mjs run --label v0-real-baseline
```
