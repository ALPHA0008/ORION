# Deterministic Results (§9, §12, §27)

Suite: `v0/tests/writewitness/writewitness.test.mjs` — **26 assertions**.

## The four cases

| case | world | verify | decision | correct? |
|---|---|---|---|---|
| 1 never applied | `current == pre` | `not-applied` | REISSUE | ✅ |
| 2 applied | `current == target` | `applied` | SKIP | ✅ |
| **3 applied then changed** | neither | **`unknown`** | **ESCALATE** | ✅ **was the defect** |
| 4 pre-state changed before write | — | write **REFUSED** | — | ✅ other change survives |

Plus: absent-file witness (`ABSENT`) through its whole lifecycle, and a third party independently
producing the target bytes (→ `applied`, correctly).

## Truth matrix, before vs after (§12)

| metric | before | after |
|---|---:|---:|
| `verification_misclassification_rate` | **1/6** | **0/6** ✅ |
| `false_not_applied` | **1** | **0** ✅ |
| `false_applied` | 0 | 0 |
| `unknown_rate` | 1/6 | **2/6** |
| `silent_overwrite` | **1** | **0** ✅ |
| `lost_updates` | **1** | **0** ✅ |
| `duplicate_side_effects` | 1 | 0 ✅ |
| pre-effect conflict detection | none | **present** ✅ |
| `recovery_correctness` | 5/6 | **6/6** ✅ |

**`unknown` rose from 1 to 2 — and that is the improvement, not a cost** (§13). The case that
moved is precisely the one that used to be a confident, destructive wrong answer.

## The safety invariant (§28), tested directly

> An uncertain write must never be automatically reissued when the pre-state has changed.

```
INVARIANT: uncertain write is never auto-reissued   ok
  world untouched by recovery                       ok
  concurrent change survives                        ok
```

Asserted by executing whatever `decideRecovery` returns and then measuring the world — not by
inferring it from a score.

## The model is not burdened (§15)

```
model sees                : ["path","content"]
validation accepts witness: []
captureWitness injects the PRE-state, not the target
```
