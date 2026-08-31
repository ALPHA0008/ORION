# Deterministic Tests (§9, §22, §23)

Suite: `v0/tests/completioncontract/completioncontract.test.mjs` — **29 assertions**.

## The five §9 cases

| case | setup | expected | result |
|---|---|---|---|
| **A** genuinely complete | contract true, objective satisfied, no tool calls | `completed` | ✅ `completed / model_finished` |
| **B** unfinished prose | contract true, objective false, prose | **not** completed | ✅ `failed / finished_without_change` |
| **C** empty response | contract true, objective false, empty | **not** completed | ✅ `failed / finished_without_change` |
| **D** analysis task | no contract / `requires_world_change: false` | `completed` | ✅ both variants |
| **E** ordinary mutating run | contract true, world changed | `completed` | ✅ |

## §19 — the world was already correct

```
§19: already-correct world completes with ZERO mutations   ok
  the contract did NOT degenerate into "must mutate"       ok
```

This is the guard against the contract becoming "every run must edit".

## §14 — the continuation recovers work (deterministically)

```
E: continuation converts a premature stop into real work   ok
  the world WAS changed                                    ok
  exactly ONE continuation was granted                     ok
  the continuation is auditable in the event log           ok
```

## §7 / §25-B — hard bounded

```
bounded: a never-acting model terminates                   ok
  at most one continuation                                 ok
  and the loop did not spin                                ok  (≤4 model calls)
```

## A broken predicate must not invent an unfinished run

```
a throwing predicate falls back to legacy completion       ok
```

## §22 — crash and resume

```
crash after the continuation was granted                   ok
  the continuation is durable                              ok  (count == 1)
  resume completes the run                                 ok
  the world was changed                                    ok
  NO duplicate continuation was granted                    ok  (still 1)
```

The count comes from the event log, so a crash cannot buy a second continuation.

## §23 — replay and fork

```
replay reproduces the terminal state                       ok
  and the same exit reason                                 ok
  and the same continuation count                          ok
  replay made zero model calls                             ok
  fork before the continuation has no continuation credit  ok
```

Completion interpretation is reconstructed from the log, never from transient memory.

## Legacy semantics preserved

With no contract, the loop is byte-identical: full regression **608 passed, 0 failed across 23
suites** (was 579/22), with `fencing`, `replay`, `recovery`, `crash/matrix`, `lease`,
`writewitness` and all escalation-gate suites unchanged.
