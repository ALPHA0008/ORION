# Phase 4 — Frozen Baseline

Recorded before any change. Per §2, no production behaviour was modified in this step.

## Revision

| item | value |
|---|---|
| git revision | `5ac4d7a62d81d741b72b3764e689e5ceaf56b5f9` |
| working tree | clean |
| prior commits | `1914bdb` (edit diagnostics), `2644056` (phase 2), `10e62a0`, `77dab8c`, `73b0bc3` |

## Environment

| item | value |
|---|---|
| OS | Windows 11 Pro 10.0.26100 |
| Node | v24.18.0 |
| model | `gemma4-31b` via vLLM (single-model endpoint) |
| runner | `harness-v0` |

## Regression state at freeze

**399 passed, 0 failed across 13 suites** — including the suites this phase depends on:

| suite | result |
|---|---|
| `recovery/recovery` | 53 passed |
| `fencing/fencing` | 29 passed |
| `replay/semantics` | 44 passed |
| `crash/matrix` | 6 passed |
| `concurrency/lease` | 51 passed |
| `writerecovery/writerecovery` | 14 passed |

## `edit` confirmed unchanged

The phase-3 decision was `KEEP_EXISTING_EDIT`. Verified present and unmodified:
`SELF_VERIFYING` class, `old_string` precondition, `diagnoseEditMiss` diagnostics.
`git diff v0/src/` is empty against the frozen commit.

## Evaluation baseline carried in

| run | success |
|---|---:|
| `v0-real-baseline` | 31.8% (7/22) |
| `v0-real-iteration01` | 63.6% (14/22) |
| `edit-diagnostic` | 68.2% (15/22) |

## Scope note established at freeze

Across **91 real-repository runs** in the committed reports:

- recovery decisions observed: **0**
- `write` calls observed: **20**

The benchmark is single-worker with no crash injection and no concurrent modifier, so the
applied-then-changed race is **not reachable** by the current 22-task suite — while the path that
carries the defect (`write`) is actively used. This is why the experiment is deterministic and
test-driven rather than benchmark-driven (§19).
