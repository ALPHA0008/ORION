# Phase 3 — Frozen Baseline

Everything in this phase is measured against the state recorded here. Per §1, no production
behaviour was modified during this step.

## Revision

| item | value |
|---|---|
| git revision | `1914bdb5aff1737ca2f8f4cf2b47acb8eba4da99` |
| working tree | clean |
| prior commits | `2644056` (phase 2), `10e62a0` (real eval), `77dab8c`, `73b0bc3` |

## Environment

| item | value |
|---|---|
| OS | Windows 11 Pro 10.0.26100 |
| Node | v24.18.0 |
| git | 2.54.0.windows.1 |
| model | `gemma4-31b` (`RedHatAI/gemma-4-31B-it-NVFP4`) |
| endpoint | vLLM, OpenAI-compatible `/v1`, single model |
| max context | 32,768 tokens |
| tool calling | native `tool_calls`; requires `gemma-native-tool-calls` + `gemma-channel-markers` shims (~100% of responses) |
| runner | `harness-v0` |
| compaction | off |
| credentials | environment variables only; never written to any artifact |

## Verification of the frozen state

| check | result |
|---|---|
| synthetic + unit regression | **385 passed, 0 failed** across 12 suites |
| edit diagnostics present | yes — `diagnoseEditMiss`, `INDENTATION_MISMATCH` in `v0/src/agent/tools/index.mjs` |
| real-eval artifacts | 8 report files present (see below) |

Artifacts: `bracket-phase2.json`, `edit-baseline.json`, `edit-diagnostic.json`,
`edit-failure-corpus.json`, `escalation-gemma.json`, `hard-repeat-gemma.json`,
`v0-real-baseline.json`, `v0-real-iteration01.json`.

## `v0/src` changes since the `v0-baseline` tag — all documented capability-layer work

| file | phase | change |
|---|---|---|
| `agent/tools/index.mjs` | 1, 2 | paged `read` (offset/limit); `edit` failure diagnostics; `integer` schema fix |
| `core/projection/compact.mjs` | eval phase | context compaction by supersession (opt-in, default off) |
| `core/projection/index.mjs` | eval phase | `elided_message_count` separate from `dropped_message_count` |
| `agent/loop/worker.mjs` | eval phase | opt-in `compactContext` wiring |
| `core/run/explain.mjs` | eval phase | render compaction events |

**No change to** the event model, Run model, leases, fencing, recovery contract, replay, fork, or
the authorization interface.

## Task set

22 bracketed real-repository tasks (4 easy / 10 medium / 8 hard) over 5 pinned repositories:

| repository | pinned commit |
|---|---|
| `is-number` | `98e8ff1da1a89f93d1397a24d7413ed15421c139` |
| `slugify` | `7c318bd1aa4b4affab29761f15a9604323fe2a3b` |
| `p-limit` | `df476048d023ff868cd45b35ee47f5fb0ca2b25a` |
| `ansi-styles` | `c1c3dd4e017a2938807aaff0d361f46d086aeab7` |
| `camelcase` | `3146708d5ffcd91a8cbc483e4a2585a39545da48` |

## Reference results carried in

| run | success | note |
|---|---:|---|
| `v0-real-baseline` | 31.8% (7/22) | before paged `read` |
| `v0-real-iteration01` | 63.6% (14/22) | after paged `read` |
| `edit-diagnostic` | 68.2% (15/22) | after diagnostics — **`edit_recovery_rate` 67% → 67%, hypothesis falsified** |

## Experiment B still blocked

`GET /v1/models` returns exactly one model: `gemma4-31b`. Re-probed at the start of this phase.
Per §13, work proceeds without it; every model-attribution claim stays provisional.
