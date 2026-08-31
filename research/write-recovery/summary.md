# Phase 7 Summary — `write` Pre-State Witness

## Problem

`write.verify()` observed only the **post-state**, so two different worlds collapsed onto one
answer: "never applied" and "applied, then a third party changed the file" both reported
`not-applied`. `SAFE_RETRY` then reissued and **silently destroyed the concurrent change**.

## Evidence

Phase 4 reproduced it four ways: a deterministic world-state matrix, a real `SIGKILL` with a
concurrent third actor, and on real pinned repository bytes (`p-limit@df476048/index.js`).
Measured: `write` misclassification **1/6**, silent overwrite **1**; `edit` **0/6** and **0**.

## Root cause

The precondition was `sha(content)` — the **goal**, not the **assumption**. It can confirm the
target was reached but can never test what the world looked like when the caller decided to write.
`edit` never had the defect because its precondition is the pre-state.

## Mechanism

`write` now carries `expected_pre_sha`, captured **by the runtime** immediately before the effect
and folded into `args` **before `tool.started`** — because `#reconcile` rebuilds recovery from
`pend.args` after a crash, so evidence held anywhere else is destroyed by the very crash it must
survive. That also means no new event type and no second state store.

The model never sees it: `toolDefinitions()` strips it, so the contract stays `write(path, content)`.

Plus `escalateOnUnknown`, because `SELF_VERIFYING` is in `AUTO_REISSUE` and reclassifying alone
would have left `unknown → REISSUE` — reintroducing the bug through a different door. The tests
caught exactly that.

## Truth table

| metric | before | after |
|---|---:|---:|
| `verification_misclassification_rate` | **1/6** | **0/6** ✅ |
| `false_not_applied` | **1** | **0** ✅ |
| `false_applied` | 0 | 0 |
| `unknown_rate` | 1/6 | **2/6** (by design) |
| `silent_overwrite` | **1** | **0** ✅ |
| `lost_updates` | **1** | **0** ✅ |
| `recovery_correctness` | 5/6 | **6/6** ✅ |
| pre-effect conflict detection | none | **present** ✅ |

## Concurrency

The lost update is gone. Real `SIGKILL` race:
`verify()='unknown' decision='escalate'` → **the concurrent change survives**. Same on real
repository bytes: `recovery_correctness = PASS`, `world_state_correctness = PASS`.

## Recovery

NOT_APPLIED / APPLIED / UNKNOWN are now all correctly reached, and `unknown` escalates instead of
retrying. The `unknown` rate **rose 1 → 2, and that is the improvement** (§13): the case that
moved is precisely the one that used to be a confident, destructive wrong answer.

## Safety

Destructive retries eliminated. The invariant of §28 is asserted directly by executing whatever
`decideRecovery` returns and then measuring the world:

```
INVARIANT: uncertain write is never auto-reissued   ok
  world untouched by recovery                       ok
  concurrent change survives                        ok
```

## Compatibility

| caller | class | case C |
|---|---|---|
| via the worker (all agent writes) | `SELF_VERIFYING` | `unknown` → ESCALATE ✅ |
| direct `write(path, content)` bypassing the worker | `SAFE_RETRY` | `not-applied` → REISSUE — **unchanged, still unsafe** |

Stated explicitly rather than implied (§14). Both paths are asserted in the same suites, so the
boundary is measured, not assumed. **`edit` is unchanged.**

## Performance

2–8% of a single write, falling as files grow (1 KB 8%, 64 KB 4%, 512 KB 2%). Sub-millisecond
against multi-second model calls; regression wall time unchanged within noise.

## Regression

**536 passed, 0 failed across 20 suites** (was 501/19). Unchanged: `fencing` 29, `replay` 44,
`crash/matrix` 6, `recovery` 53, `concurrency/lease` 51, and all three escalation-gate suites.

Real-agent smoke test (§24), both models, no regression:

| model | repo | result |
|---|---|---|
| Gemma | slugify | **4/5** (baseline 2/5), 2 write calls, **0 spurious conflicts** |
| Qwen | is-number | 2/4 — identical to its baseline; failures are the pre-existing `no_edits_made` (§26, unrelated) |

## Remaining limits

- **Genuinely unknowable histories remain unknowable.** If a third party restores the exact
  pre-state bytes, the world is byte-identical to never-having-run. No witness recovers
  information the world destroyed — but the answer is now an honest `not-applied` on evidence,
  not a guess.
- Direct programmatic callers that bypass the worker get no witness.
- `bash` can still write anywhere without any witness (a separate, already-documented limit).
- The §25 full 22-task benchmark was **not** run: it contains no crash injection and no concurrent
  modifier (91 real runs produced 20 write calls and **zero** recovery decisions), so it cannot
  exercise this path. The smoke test confirmed no regression, which is what it can actually show.

## Decision: **WRITE_PRESTATE_FIXED**

All ten §29 criteria met: the real race no longer loses the change; zero false `not-applied`; a
changed pre-state prevents unsafe writes before mutation; ambiguity produces honest `unknown`;
`edit` unchanged; escalation/recovery/resume, replay/fork/fencing all correct; full regression
passes; normal agent writes unaffected; overhead 2–8%.

## The principle, now executable

> Recovery safety comes from evidence carried by the mutation, not from naming an operation
> `SAFE_RETRY`.

`edit` had that evidence built in. `write` now has the equivalent. And `escalateOnUnknown` makes
the deeper point concrete: **a recovery class is a claim, and a claim without evidence is not a
guarantee.**
