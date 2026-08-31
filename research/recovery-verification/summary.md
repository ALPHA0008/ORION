# Phase 4 Summary — Can the Runtime Tell "Not Applied" From "Applied Then Changed"?

**Answer: `edit` can. `write` cannot, and silently destroys the later change.**

Forensic phase. **No production behaviour was changed** — `git diff v0/src/` is empty. Everything
added is tests and research.

## The concern was real, and narrower than expected

| tool | applied-then-changed | decision | consequence |
|---|---|---|---|
| `edit` | reports **`applied`** | SKIP | ✅ concurrent change survives |
| `write` | reports **`not-applied`** | **REISSUE** | ❌ **concurrent change destroyed** |

Proven three ways: a deterministic world-state matrix, a **real `SIGKILL` crash** with a third
actor, and the same race on **real pinned repository bytes** (`p-limit@df476048/index.js`).

```
write + concurrent change -> verify()='not-applied' decision='reissue'
  REISSUE silently destroys the concurrent change   ok   ← measured
```

## Why the two differ

`edit`'s precondition is the **pre-state** (`old_string`). Its continued absence is evidence the
effect ran, and that evidence survives later modification.

`write`'s precondition is `sha(content)` — the **post-state**. It can confirm the goal was reached;
it can never test whether the world was what the caller assumed. Two very different worlds collapse
onto one answer:

| real world | `write` reports |
|---|---|
| never applied | `not-applied` |
| **applied, then changed** | **`not-applied`** |

## Where the real boundary falls (§12)

Two histories were constructed with **byte-identical world state and byte-identical durable
history**:

```
A: mutation never ran; external actor wrote S2
B: mutation ran; external actor then wrote S2
write.verify  A: not-applied   B: not-applied   indistinguishable
edit.verify   A: unknown       B: unknown       indistinguishable
```

Some cases are **genuinely unknowable** — no mechanism recovers information the world destroyed.
But note the contrast: in the ambiguous case `edit` says **`unknown`** (honest) while `write` says
**`not-applied`** (a confident wrong answer). **The failure is not missing information — it is a
claim made without evidence.**

## The sharper root cause

Not a missing state, and not really `write.verify()`.

`SAFE_RETRY` asserts `f(f(x)) == f(x)` *for these args* — true in isolation, false with a
concurrent writer, because the second application no longer operates on the state the first left.
The class encodes an idempotence claim that **silently assumes no other writer**, and
`decideRecovery` trusts it on the `unknown` path.

`edit` (also in `AUTO_REISSUE`) survives the identical decision only because its precondition is
consumed — a replay throws and changes nothing. That was **executed, not assumed**:

```
reissue of an already-applied edit self-rejects   ok
world is untouched by the reissue                 ok
```

**Safety comes from the primitive, not the decision.**

## Invariants (§21)

| invariant | result |
|---|---|
| a stale worker cannot create authoritative writes | ✅ holds |
| an uncertain mutation is never silently retried when it cannot be safely classified | ❌ **violated by `write`** |
| a successful task must not hide a recovery-safety regression | ❌ **violated** — demonstrated |

## Task success ≠ recovery safety (§22)

On the real-repository race, reported separately as required:

| dimension | result |
|---|---|
| `task_success` | **PASS** — correct semantic fix; the repo suite is green |
| `recovery_correctness` | **FAIL** |
| `world_state_correctness` | **FAIL** — legitimate concurrent change destroyed |

A green benchmark hides this completely. Across 91 real runs: **20 `write` calls, 0 recovery
decisions** — the vulnerable path is heavily used, the race simply never fires in a single-worker
benchmark. The defect is **latent, not theoretical**: reachable whenever a crash coincides with any
other writer (a developer, a formatter, a watch process, a second agent).

This also compounds a phase-3 finding: the model escapes to `write` when `edit` fails. Every such
fallback moves a run from a primitive with a pre-state witness to one without.

## Decision (§25): **VERIFY_NEEDS_RICHER_EVIDENCE**

Not `CURRENT_VERIFY_SUFFICIENT`: a false `not-applied` causes a destructive reissue, demonstrated
on real bytes.

Not `ADD_CONFLICT_STATE`: `edit` already resolves the case with the states that exist. A fourth
state would be the wrong abstraction — `write` lacks **evidence**, not a verdict, and the correct
outcome for it is an honest `unknown` → ESCALATE.

Not `ADD_OPERATION_RECEIPTS` / `ADD_WORKSPACE_SNAPSHOTS`: both work, both are far larger than
needed. §13's evaluation puts a pre-state hash at very low cost with no new failure mode.

Not `FUNDAMENTAL_OBSERVABILITY_LIMIT`: that applies to the revert case only. The
applied-then-changed case is **knowable** — `edit` proves it on the same world.

Not `UNRESOLVED`: the mechanism is identified, reproduced under real crashes, and localised to one
tool's evidence.

## Per §26 — the mechanism is NOT implemented

**Problem.** `write.verify()` observes only the post-state, so "never applied" and "applied then
changed" collapse onto `not-applied`, and `decideRecovery` reissues destructively.

**Evidence.** 42 assertions across three suites; a real `SIGKILL` race; the same defect on real
pinned repository bytes; misclassification rate `write` 1/6 vs `edit` 0/6.

**Minimum additional information.** A **pre-state witness** for `write` — the same class of
evidence `edit` already carries.

**Candidate mechanisms.** Pre-state hash (very low cost, portable, no new failure mode) ·
operation receipts (medium, needs atomic sidecar+effect) · workspace snapshots (high) ·
filesystem metadata (rejected: unportable, coarse). Evaluated in
[`recovery-state-machine.md`](recovery-state-machine.md).

**Tradeoffs.** An optional pre-state hash would move `write` from `SAFE_RETRY` toward
`SELF_VERIFYING`, converting a silent overwrite into an honest `unknown` → ESCALATE. The cost is
one hash of content already in memory and one extra branch. The risk is a higher `unknown` rate —
which §20 explicitly prefers to a wrong classification. It must be **optional**, since callers do
not always know the pre-state, and a required argument would break existing behaviour.

**Next experiment.** Add the optional pre-state witness to `write` behind a flag; re-run the three
race suites; require misclassification 1/6 → 0/6 and silent overwrites 1 → 0, with `replay`,
`fork`, `fencing` and the 22-task benchmark unchanged. Falsify if the `unknown` rate rises enough
to escalate on ordinary single-worker runs, or if any existing suite regresses.

**Then stop.** Implementation belongs to a later prompt.

## Limits

Single-file, single-mutation, single-recovery races on one platform (Windows/NTFS). Torn writes
were simulated by truncation rather than produced by a real power failure. Multi-file transactions
were not tested. `bash` mutations were not covered — its conservative classifier escalates
anything not provably safe, but that was not exercised here. Model B remains **UNRESOLVED**; no
cross-model claim is made, and none is needed — this phase's findings are about the runtime, not
the model.
