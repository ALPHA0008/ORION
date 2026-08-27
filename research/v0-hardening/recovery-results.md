# Tool Recovery Results — Phases E and F

Source: `v0/tests/recovery/recovery.test.mjs` — **53 assertions, 53 pass.**
Contract: ADR-002 (per-invocation) + ADR-003 (`SELF_VERIFYING`).

## Phase E — classification of every V0 tool

| tool | class | verify() available | note |
|---|---|---|---|
| `read` | `READ_ONLY` | n/a | no world effect |
| `grep` | `READ_ONLY` | n/a | no world effect |
| `write` | `SAFE_RETRY` | **yes** — content hash | whole-content write is idempotent |
| `edit` | `SELF_VERIFYING` | **yes** — old/new presence | precondition destroyed by the effect |
| `ask_user` | `READ_ONLY` | n/a | `alwaysEscalate`; a durable HumanRequest |
| `bash` | **argument-dependent** | no | see below |

### bash is the whole reason ADR-002 exists

```
bash "mkdir -p a/b"          -> SAFE_RETRY
bash "echo hi"               -> SAFE_RETRY
bash "echo x >> f"           -> UNSAFE
bash "git push origin main"  -> UNSAFE
bash "curl -X POST http://x" -> UNSAFE
bash "frobnicate --wibble"   -> UNSAFE   (unknown: default deny)
```

Same tool, opposite class. A per-tool declaration cannot express this.

**Deliberate V0 limitation:** the classifier is a short pattern list, **not** a shell parser
(Phase E: "avoid building a giant shell static analyzer in V0"). Unknown commands default to
`UNSAFE`, which escalates. The system is wrong in the direction of asking a human too often.

## Phase F — the three outcomes, under real effects

| case | setup | expected | observed |
|---|---|---|---|
| 1 | effect has NOT happened | `reissue` | `reissue`, `verify: not-applied` |
| 2 | effect HAS happened, verifiable | `skip` | `skip`, `verify: applied` |
| 2b | `edit`, both directions | reissue then skip | both, plus a hand-replayed `edit` throws |
| 3 | cannot be verified | `escalate` | `escalate`, class `UNSAFE` |

Edge cases, all verified:

```
READ_ONLY                          -> reissue
TRANSACTIONAL                      -> reissue
EXTERNALLY_DEDUPED with key        -> reissue
EXTERNALLY_DEDUPED without key     -> escalate
verify() throws                    -> escalate
verify() 'unknown' + UNSAFE        -> escalate
verify() 'unknown' + SAFE_RETRY    -> reissue
recovery contract missing entirely -> escalate
```

The bias is consistent: **when in doubt, ask.**

## In situ — the contract inside a running worker

**UNSAFE orphan** (`tool.started` for `bash "echo x >> log.txt"`, no terminal event):
```
run paused                                    yes
reason                                        ambiguous_tool_recovery
lease released so no worker is pinned         yes
HumanRequest persisted                        1 pending
tool.recovery_decided recorded                decision: escalate
explicit state transition, not a silent guess  human.requested emitted
```

**SAFE_RETRY orphan** where the effect already landed:
```
tool.recovery_decided                         decision: skip, verified: applied
orphan received a terminal tool event         tool.succeeded
```

## The decisive pair (from the crash matrix)

Identical durable log state (`9 tool.started`), opposite decisions:

```
crash after:tool.started  ->  write SAFE_RETRY -> reissue  (verify: not-applied)
crash after:tool.effect   ->  write SAFE_RETRY -> skip     (verify: applied)
```

Both converge on the golden world state. **`verify()` is what distinguishes them** — the class
alone cannot, because the class is the same.

## Phase G — no-progress (ADR-006)

| scenario | terminal reason | turns used |
|---|---|---|
| repeated denied `edit` | `no_progress` — "identical tool request repeated 4 times" | 1 (ceiling was 40) |
| N round-trips, no successful tool | `no_progress` — "5 turns with no successful tool call" | 5 |
| healthy run | `model_finished` | — |
| busy but unfinished | `max_turns` | 6 |
| model always unreachable | `model_unavailable` | 3 failures |

`max_turns` and `no_progress` stay distinct: a run making real progress that simply runs long hits
the ceiling; a run that is stuck is diagnosed.

**Bug found by these tests:** the first implementation counted `turn.started`, which fires once per
run — so the detector could never fire. Progress is now counted per **model round-trip**.

## Limits

1. `verify()` for `write` compares full content; for a very large file that is a full read on resume.
2. `edit`'s `verify()` returns `unknown` when `old_string` is a substring of `new_string`; that path
   escalates (correct, but it will surprise users).
3. No `TRANSACTIONAL` or `EXTERNALLY_DEDUPED` tool ships in V0 — those classes are implemented and
   unit-tested in `decideRecovery`, but not exercised by a real tool.
4. Recovery during recovery (a crash while re-issuing an orphan) is untested.
