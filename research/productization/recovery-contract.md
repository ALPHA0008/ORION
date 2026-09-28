# Recovery Contract

Describes the **real** lifecycle. No new guarantees are introduced.

## Lifecycle

```
run.created → run.leased → turn.started → model.requested → model.responded
   → tool.requested → tool.authorized → tool.started → tool.succeeded
   → … → run.completed
                    │
                    ├─ CRASH  (no further events — a dead process cannot log its death)
                    │     ↓
                    │  durable state = the event log, unchanged
                    │     ↓
                    │  resume: repairOrphans() finds tool.started with no terminal partner
                    │     ↓
                    │  decideRecovery(recovery)  →  SKIP | REISSUE | ESCALATE
                    │     ↓
                    │  tool.recovery_decided (class + decision + reason)
                    │     ↓
                    │  continue
                    │
                    └─ PAUSE (human.requested) → run.paused → claimable (ADR-009)
                          ↓  harness answer <run> <reply>
                       human.responded → run.resumed → continue
```

## Recovery classes

| class | meaning | auto re-issue? |
|---|---|---|
| `READ_ONLY` | no world effect | yes |
| `SAFE_RETRY` | `f(f(x)) == f(x)` for these args | yes |
| `SELF_VERIFYING` | carries a precondition the effect invalidates | yes, unless `escalateOnUnknown` |
| `EXTERNALLY_DEDUPED` | remote honours a dedup key | only with a key |
| `TRANSACTIONAL` | effect + marker commit atomically | yes |
| `UNSAFE` | duplicates on re-issue | **no — escalate** |

`decideRecovery` prefers a `verify()` probe over the class. On `unknown`, `escalateOnUnknown`
(ADR-011) blocks auto re-issue.

## What IS guaranteed

1. **The log survives the crash.** Append-only SQLite; `tool.started` carries the args *including*
   the runtime-injected witness, so evidence lives where the crash cannot destroy it (ADR-011 §2).
2. **Single-writer execution.** Leases + `LeaseLostError` (ADR-008); `reap` reclaims dead workers.
3. **No silent lost update for `write`.** Witnessed `write` distinguishes `not-applied → REISSUE`,
   `applied → SKIP`, `applied-then-changed → ESCALATE`. Verified: misclassification 1/6 → 0/6,
   silent overwrite 1 → 0.
4. **`edit` is safe to re-issue.** Its precondition is consumed, so a replay self-rejects.
5. **`bash` never auto-re-issues.** Every mutating shell form → `UNSAFE` → escalate, at **all four**
   crash points. Uncertain, but safe.
6. **Paused runs are durably claimable** (ADR-009) — a pause is not a lost run.
7. **Nothing degrades silently.** Every fallback emits `degraded` with subsystem + reason.

## What is NOT guaranteed

1. **`bash` effects cannot be classified after a crash.** Always `UNKNOWN` → escalate. Availability
   cost, not a correctness hole. (`BASH_RECOVERY_UNCERTAIN_BUT_SAFE`.)
2. **No pre-effect conflict protection for `bash`.** Measured: `bash` overwrote a concurrent
   third-party change that witnessed `write` refused.
3. **No per-`bash`-call mutation attribution.** `PER_CALL_MUTATION_ATTRIBUTION = ABSENT` — payloads
   carry `tool_call_id, name, args/result` and no file list.
4. **The workspace is not rewound on fork.** History branches; the filesystem does not.
5. **A direct programmatic `write()` bypassing the worker gets no witness.** Stated in ADR-011 as an
   explicit compatibility boundary. The worker always injects one, so all *agent* writes are covered.
6. **Replay reconstructs the recorded decision, not a re-evaluation.** `objectiveSatisfied` and
   `verify()` are live predicates; replay is faithful to what was decided, not to today's world.

## What is verified

| property | evidence |
|---|---|
| crash at each boundary | `tests/crash/matrix.test.mjs` + `crash-matrix.json` |
| lost update eliminated | `writewitness` (26 tests), real `SIGKILL`, real repository bytes |
| fencing / lease loss | `concurrency/lease` (51 tests) |
| replay equivalence | `replay/semantics` (44 tests), `verifyProjectionEquivalence` |
| escalation lifecycle | `escalationgate` suites (60 tests) |
| bash crash safety | `eval/mutation-observability/crash.mjs` — escalate at 4/4 crash points |
| **whole suite** | **608 passed, 0 failed, 23 suites** — executed in this audit |

## What remains unknown

- Behaviour under **concurrent workers on one workspace** — the runtime fences *runs*, but the bash
  conflict gap would become reachable. No current use case exercises it.
- Recovery under **partial disk failure / SQLite corruption** — `doctor` reports integrity, but
  there is no repair path.
- Long-horizon runs beyond the tested window (max observed: 40 turns).
