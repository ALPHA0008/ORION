# Implementation Plan

## The smallest API change (§3)

Internal, not model-facing:

```
write(path, content, expected_pre_sha?)
```

`expected_pre_sha` means: *"this write was intended for the exact file state observed
immediately before the mutation."* It is `sha(current bytes)`, or the sentinel `ABSENT` when the
file does not exist.

The model-facing schema is **unchanged** — `write(path, content)`. The model never supplies the
hash (§15).

## Where the witness comes from (§4) — Option B

The runtime reads the file immediately before the effect and injects the hash into `args`.

**It must be injected before `tool.started` is appended**, because `#reconcile` rebuilds recovery
from `pend.args` after a crash. Anything not in `args` is destroyed by the crash it exists to
survive.

Concretely, in `Worker.#invokeTool`, between authorization and `tool.started`:

```js
const augmented = tool.captureWitness ? tool.captureWitness(tc.args) : tc.args;
append('tool.started', { tool_call_id, name, args: augmented });
...
out = await tool.run(augmented);
```

`captureWitness` is an optional per-tool hook. Only `write` defines one. Every other tool is
untouched, and a tool without the hook behaves exactly as today.

## Two distinct protections (§5)

These must not be conflated:

| | when | mechanism |
|---|---|---|
| **pre-effect conflict detection** | at write time | if the file changed between witness capture and the effect, refuse |
| **post-crash recovery verification** | during `#reconcile` | classify NOT_APPLIED / APPLIED / UNKNOWN from the witness |

Both are tested separately (§9 case 4 vs cases 1–3).

## Semantics (§6)

With `pre` = expected pre-state hash, `target` = sha(content), `current` = sha(current bytes):

| case | condition | verify | decision |
|---|---|---|---|
| **A never applied** | `current == pre`, `current != target` | `not-applied` | REISSUE (safe — the world is exactly what the caller expected) |
| **B applied** | `current == target` | `applied` | SKIP |
| **C applied then changed** | `current != pre` **and** `current != target` | **`unknown`** | **ESCALATE** |
| **D unknowable** | witness absent, or read fails | `unknown` | ESCALATE (for `write`) |

Note case B is checked first: if the content already matches the target, the effect is applied
regardless of what the pre-state was. That also correctly handles a third party independently
producing the intended bytes.

## Recovery class (§8) — proving, not renaming

`SAFE_RETRY` asserts `f(f(x)) == f(x)` *for these args*. Phase 4 showed that claim silently
assumes no concurrent writer: a second application no longer operates on the state the first
left.

With a witness, the guarantee is genuinely different — a retry is only ever issued when the
pre-state is **verified intact**, which is exactly `SELF_VERIFYING`'s meaning: the operation
carries a precondition the effect invalidates.

So a witnessed `write` is reclassified `SELF_VERIFYING`; an unwitnessed one stays `SAFE_RETRY`.
The class follows the evidence actually carried, which is the phase-4 conclusion made executable.

Critically, `SELF_VERIFYING` is in `AUTO_REISSUE`, so `unknown` would still REISSUE — which is
exactly the destructive path. **The recovery decision therefore must not rely on the class for
this case**: the witnessed `verify()` returns `unknown`, and `decideRecovery` must escalate. This
is checked explicitly in the tests, because getting it wrong reintroduces the original bug.

## No new recovery state (§7)

`APPLIED_THEN_CHANGED` is **not** added. Case C resolves to `unknown` → ESCALATE. Better
evidence, not more labels.

## Compatibility boundary (§14)

| call | class | case C behaviour |
|---|---|---|
| `write(path, content, expected_pre_sha)` | `SELF_VERIFYING` | `unknown` → ESCALATE ✅ |
| `write(path, content)` (no witness) | `SAFE_RETRY` | `not-applied` → REISSUE — **unchanged, still unsafe** |

Documented explicitly rather than implied: a witnessless write does **not** gain the stronger
guarantee. In practice the worker always injects one, so agent writes are covered; direct
programmatic callers that bypass the worker are not.

## Escalation (§20)

`unknown` → `decideRecovery` → ESCALATE → the **existing** path
(`human.requested → run.paused → lease released`). No second pause mechanism.

## Falsification (§30)

Reject if: the real lost update persists · a new silent overwrite appears · pre-state checks are
not trusted · replay becomes unsafe · fencing regresses · normal writes break · a model-generated
hash is required · `unknown` causes a destructive retry · a new storage architecture is needed.
