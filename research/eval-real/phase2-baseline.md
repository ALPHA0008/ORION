# Phase 2 — Frozen Baseline

Everything in this phase is measured against the state recorded here. No runtime or capability
code was modified during or after this freeze.

## Revision

| item | value |
|---|---|
| git revision | `10e62a0de4acf9e3cb179ff2ec4935511beb4d74` |
| working tree | clean (no modifications, no untracked source) |
| previous phase commit | `77dab8c` (synthetic eval), `73b0bc3` (V0 baseline) |

## Environment

| item | value |
|---|---|
| OS | Windows 11 Pro 10.0.26100 |
| Node | v24.18.0 |
| git | 2.54.0.windows.1 |
| package manager | npm 11.16.0 |
| model | `gemma4-31b` (`RedHatAI/gemma-4-31B-it-NVFP4`) |
| provider | vLLM, OpenAI-compatible `/v1` |
| max context | 32,768 tokens |
| tool calling | native tool_calls, requires `gemma-native-tool-calls` + `gemma-channel-markers` shims |
| runner | `harness-v0` |
| compaction | off (`HARNESS_COMPACT` unset) |
| credentials | supplied via environment variables only; never written to any artifact |

## Capability under test

`read(path, offset, limit)` — paged file reading, added in phase 1 iteration 01.

- `READ_PAGE_BYTES = 1_500`, deliberately below `MSG_CLAMP` (2,000) so a page plus its footer
  survives the projection clamp intact.
- Returns numbered lines; a truncated page states the exact next call to make.
- Sandbox-level hard truncation is surfaced on every page so it cannot be paged out of sight.

## Verification of the frozen state

| check | result |
|---|---|
| synthetic regression suite | **354 passed, 0 failed** across 11 suites |
| real-eval bracket suite | **22/22 valid** (preflight-negative + oracle-positive) |
| evaluator invariants | 18/18 (included in the suite total) |

Raw bracket output: [`eval/real/reports/bracket-phase2.json`](../../eval/real/reports/bracket-phase2.json)

## Reference results carried into this phase

| run | success | easy | medium | hard |
|---|---:|---:|---:|---:|
| `v0-real-baseline` | 31.8% (7/22) | 3/4 | 4/10 | 0/8 |
| `v0-real-iteration01` | 63.6% (14/22) | 4/4 | 8/10 | **2/8** |

The `2/8` hard-task figure is the specific number this phase exists to test: it rests on
**single runs** and is therefore not yet a stable capability estimate.

## Model availability — a hard constraint on Experiment B

The configured vLLM endpoint serves exactly one model:

```
GET /v1/models -> { "data": [ { "id": "gemma4-31b", ... } ] }
```

Probed and found unavailable: `<vllm-host>:8001`, `<vllm-host>:11434`, `localhost:11434`,
`localhost:8000`. No provider API keys are present in the environment
(`OPENAI_*`, `ANTHROPIC_*`, `GROQ_*`, `TOGETHER_*`, `DEEPSEEK_*`, `MISTRAL_*`, `GOOGLE_*`,
`GEMINI_*`, `OPENROUTER_*` — none set).

**Experiment B (second model) is therefore blocked on infrastructure that cannot be provisioned
from here.** It is not skipped: the runner is model-agnostic already, and
[`model-comparison.md`](model-comparison.md) records the prepared protocol so the comparison can
be executed unchanged as soon as a second endpoint or key exists.

Experiments A and C do not depend on a second model and were completed in full.
