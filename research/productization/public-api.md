# Public API Audit

Judged on existing structure. **No abstractions are proposed for aesthetics.**

## Structural finding: the module graph is already a shallow tree

Internal-import counts per module:

| module | internal imports |
|---|---|
| `cli/index.mjs` | 10 (composition root) |
| `agent/loop/worker.mjs` | 7 (orchestrator) |
| `core/replay/index.mjs` | 2 |
| `core/run/store.mjs`, `agent/tools/index.mjs` | 1 |
| **the other 9 modules** | **0** |

**Nine of fourteen modules are leaves.** The coupling is concentrated exactly where it should be —
the CLI composes, the worker orchestrates, everything else is independent. This is the single
strongest argument that no architectural refactor is needed to publish an API.

## Empirical evidence of the real boundary

`eval/` is an **independent consumer** of the runtime and already imports it as a library. What it
reaches for reveals the API that matters in practice:

| module | import sites in `eval/` |
|---|---|
| `core/run/store.mjs` | 9 |
| `sandbox/local/index.mjs` | 7 |
| `agent/tools/index.mjs` | 7 |
| `agent/model/index.mjs` | 7 |
| `auth/default/index.mjs` | 5 |
| `agent/loop/worker.mjs` | 5 |
| `core/run/explain.mjs` | 2 |
| `core/recovery/index.mjs` | 2 |
| `core/projection/index.mjs` | 2 |

This is not a hypothetical API — it has a working second consumer, which is the best available
evidence that the boundaries hold.

## Proposed classification

### PUBLIC

| boundary | module | exports | stability | cleanup needed |
|---|---|---|---|---|
| **Run** | `core/run/store.mjs` | `Store`, `uid`, `LeaseLostError` | **stable** — 9 external uses, heavy test coverage | none |
| **Event** | `core/event/index.mjs` | `EVENT_TYPES`, `isKnownType`, `TERMINAL`, `modelRespondedPayload` | **stable** — frozen closed set, ADR-004 | none |
| **Provider** | `agent/model/index.mjs` | `createOpenAICompatModel`, `ModelError` | **stable** — 7 external uses | shim registration is positional (see `provider-contract.md`) |
| **Tool** | `agent/tools/index.mjs` | `makeTools`, `toolDefinitions`, `validateArgs`, `ABSENT` | **stable** — 7 external uses | `grep` defects (behavioural, not API) |
| **Workspace** | `sandbox/local/index.mjs` | `LocalSandbox`, `scrubEnv`, size caps | **mostly stable** | no `env` option — `eval/` had to mutate `process.env` to set `PATH` |
| **Policy** | `auth/default/index.mjs` | `createAuthorizer`, `Decision` | **stable** — the Kernlbase seam | none |
| **Worker** | `agent/loop/worker.mjs` | `Worker`, `ExitReason`, `DEFAULT_SYSTEM` | **stable** — 5 external uses | largest module (527 ln); fine to publish as-is |
| **Trajectory** | `core/replay/index.mjs`, `core/run/explain.mjs` | `replay`, `fork`, `rerun`, `explain`, `redact` | **stable** | none |

### INTERNAL

| module | why |
|---|---|
| `core/projection/index.mjs` | Bounded-window mechanics (ADR-001). `eval/` reads it for metrics, but the constants are tuning, not contract. |
| `core/lease/reaper.mjs` | Operational; reached via CLI `reap`. |
| `core/recovery/index.mjs` | `RecoveryClass` is arguably public (tools declare it); `classifyShell` is an internal heuristic that will change. **Split if published.** |
| `cli/index.mjs` | Composition root, not a library. |

### EXPERIMENTAL

| module | why |
|---|---|
| `core/projection/compact.mjs` | Implemented and tested, but **off by default**. |
| `agent/model/shims/gemma-tool-calls.mjs` | Model-specific; the shim *interface* should be public, this *instance* is an implementation. |
| Completion contract (in `worker.mjs`) | ADR-013, **opt-in, off by default**; phase 10 showed it fixes runtime truth without recovering capability. |

## Required cleanup — small and specific

1. **No `package.json` exports map** — nothing is formally public today (blocking; see
   `packageability.md`).
2. **`LocalSandbox` takes no `env` option.** `eval/` works around this by mutating `process.env`
   around each run. A real defect in the public surface, small to fix.
3. **`RecoveryClass` vs `classifyShell`** — publish the enum, keep the heuristic internal.
4. **Shim registration is an array position**, not a named/negotiated capability.

## What NOT to do

- Do not introduce a facade/`index.mjs` barrel purely to look tidy. The tree is already shallow.
- Do not add a plugin framework. There is one provider and one sandbox; abstraction is unearned.
- Do not rename modules for symmetry — `eval/` depends on these paths and it is real evidence.
