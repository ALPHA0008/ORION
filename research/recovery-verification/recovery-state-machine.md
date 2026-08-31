# Recovery State Machine — Does It Need a Fourth State?

§14 says: do **not** add `APPLIED_THEN_CHANGED` because it sounds useful. First prove it occurs in
realistic races **and** that the current system misclassifies it.

## Both conditions are met — but only for one tool

| | occurs in a realistic race? | currently misclassified? |
|---|---|---|
| `edit` | **yes** | **no** — reports `applied`, decision SKIP |
| `write` | **yes** | **yes** — reports `not-applied`, decision REISSUE, later change destroyed |

That asymmetry is the whole finding. A new *state* would be the wrong abstraction, because `edit`
already resolves the case correctly with the states that exist. What `write` lacks is not a
verdict — it is **evidence**.

## The minimum additional evidence (§13)

| candidate | correctness | cost | complexity | portability | crash safety | verdict |
|---|---|---|---|---|---|---|
| **pre-state hash on `write`** | resolves the knowable case; honest `unknown` otherwise | one hash of content already in memory | **very low** — one optional arg, one branch | pure, no FS features | no new failure mode | **smallest sufficient** |
| post-state hash | already effectively present | — | — | — | — | insufficient — this is the current design |
| mutation ID / operation receipt | strong | a sidecar write per mutation | medium | needs atomic sidecar+effect | receipt itself can be torn | over-engineered |
| sidecar journal | strong | write amplification | medium-high | portable | ordering problems | over-engineered |
| filesystem metadata (mtime/inode) | weak | free | low | **not portable**, coarse timestamps | unreliable | rejected |
| workspace checkpoint / snapshot | very strong | full workspace copy per mutation | high | needs git or FS support | good | disproportionate |
| content-addressed snapshot store | very strong | storage growth | high | portable | good | disproportionate |

**Smallest useful mechanism: give `write` an optional pre-state witness.** It is the same
information `edit` already carries, expressed for whole-file replacement.

With it, `write` gains exactly the discrimination it lacks:

| world | pre-state matches? | post-state matches? | verdict |
|---|---|---|---|
| never applied | yes | no | `not-applied` → safe REISSUE |
| applied | no | yes | `applied` → SKIP |
| **applied then changed** | no | no | **`unknown`** → ESCALATE |
| genuinely ambiguous | — | — | `unknown` → ESCALATE |

Note that the fixed outcome is `unknown`, **not** a new `APPLIED_THEN_CHANGED` state. Per §20, an
honest `unknown` is the goal; a confident wrong answer is the failure.

## Recovery decisions (§15)

| classification | correct action | current behaviour |
|---|---|---|
| NOT_APPLIED | REISSUE | ✅ |
| APPLIED | SKIP | ✅ |
| APPLIED_THEN_CHANGED | **ESCALATE** — never auto-retry | ❌ `write` REISSUEs and destroys the change |
| UNKNOWN | ESCALATE unless the operation self-rejects | ⚠️ see below |

Not RECOMPUTE and not FAIL: the world is in a state neither the agent nor the runtime intended, so
a human (or a policy) has to choose between the effect and the concurrent change. Recomputing
would silently pick one.

### The `unknown` → REISSUE path needs qualifying, not removing

`AUTO_REISSUE` contains `READ_ONLY, SAFE_RETRY, SELF_VERIFYING, TRANSACTIONAL`, so `unknown`
reissues for all four. Measured:

- **`edit` (SELF_VERIFYING)** — the reissue **self-rejects**; the world is untouched. Safe.
- **`write` (SAFE_RETRY)** — the reissue **applies**; the concurrent change is lost. Unsafe.

The class is doing the work of a safety proof it does not actually establish. `SAFE_RETRY` asserts
`f(f(x)) == f(x)` *for these args* — true in isolation, false in the presence of a third party,
because the second application no longer operates on the state the first one left.

**This is the sharper conclusion of the phase:** the bug is not a missing state, and not really
`write`'s `verify()` either. It is that `SAFE_RETRY` encodes an idempotence claim that silently
assumes no concurrent writer.

## Escalation path is intact (§16)

Traced in `worker.mjs`: ESCALATE → `tool.escalated` → `human.requested` → `run.paused` with
`releaseLease: true`. A paused run is claimable (ADR-009), so a human decision can resume it.

The machinery an `APPLIED_THEN_CHANGED` escalation would need **already exists**; nothing new is
required to route the case once it can be detected.

## Replay and fork (§17)

Full suite after adding both experiment suites: **431 passed, 0 failed across 15 suites**,
including `replay/semantics` (44) and `fencing/fencing` (29). The experiments are observational —
they add no events and no projection fields — so replay and fork semantics are unaffected.

If a pre-state witness is added later, it belongs in the **tool's recovery descriptor** (computed
from args, like every other precondition under ADR-002), **not** in the event payload or the
projection. That keeps the closed event taxonomy (ADR-004) and the bounded projection (ADR-001)
untouched.
