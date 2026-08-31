# ADR-011 — `write` carries a runtime-captured pre-state witness

**Status:** accepted
**Supersedes:** nothing. Refines ADR-002 (per-invocation recovery) and ADR-003 (`verify()`).

## Context

Phase 4 measured that `write.verify()` observes only the **post-state**:

```js
precondition: sha(content)
verify: () => sandbox.read(path) === content ? 'applied' : 'not-applied'
```

Two different worlds therefore collapse onto one answer:

| real world | reported |
|---|---|
| never applied | `not-applied` |
| **applied, then a third party changed the file** | **`not-applied`** |

Both map to `REISSUE`, so recovery re-applied a write that had already happened and **silently
destroyed the concurrent change** — a lost update. Reproduced in a deterministic matrix, with a
real `SIGKILL`, and on real pinned repository bytes (`p-limit@df476048/index.js`).

`edit` never had this defect: its precondition is the **pre-state** (`old_string`), whose
continued absence is evidence the effect ran and survives later modification.

## Decision

`write` carries a **pre-state witness** — `expected_pre_sha`, the hash of the file's bytes
immediately before the effect, or the `ABSENT` sentinel when the file did not exist.

1. **The runtime computes it, never the model.** `write.captureWitness(args)` runs in
   `Worker.#invokeTool` between authorization and `tool.started`. The model-facing schema stays
   `write(path, content)`; `expected_pre_sha` is stripped from `toolDefinitions()`.

2. **It must enter `args` before `tool.started`.** After a crash, `#reconcile` rebuilds recovery
   from `pend.args`, which is exactly what `tool.started` recorded. Evidence held anywhere else is
   destroyed by the crash it exists to survive. This also means **no new event type and no second
   state store** — the existing payload already survives crash, resume, replay and fork.

3. **Semantics.** With `pre`, `target` and `current`:

   | condition | verify | decision |
   |---|---|---|
   | `current == target` | `applied` | SKIP |
   | `current == pre` | `not-applied` | REISSUE (safe — world untouched) |
   | neither | **`unknown`** | **ESCALATE** |

4. **Pre-effect conflict detection.** If the file changed between witness capture and the effect,
   `run()` refuses with an actionable error. This is a *different* protection from post-crash
   verification and is tested separately.

5. **`escalateOnUnknown`.** A recovery descriptor may declare that an unknown outcome must not be
   auto-reissued. `AUTO_REISSUE` membership was standing in for a safety proof it does not
   establish: re-issuing `edit` is harmless (its precondition is consumed, so the replay
   self-rejects), while re-issuing `write` overwrites whatever moved the file.

6. **Class follows evidence.** A witnessed `write` is `SELF_VERIFYING`; an unwitnessed one stays
   `SAFE_RETRY` with its original behaviour.

## Consequences

- The phase-4 lost update no longer occurs: misclassification **1/6 → 0/6**, silent overwrite
  **1 → 0**.
- `unknown` increases by design. An honest `unknown` that escalates is strictly preferable to a
  confident wrong answer that destroys data.
- **No new recovery state.** `APPLIED_THEN_CHANGED` was explicitly rejected: the fix is better
  evidence, not more labels.
- **Compatibility boundary, stated explicitly:** a direct programmatic `write(path, content)` that
  bypasses the worker does **not** gain the stronger guarantee. The worker always injects a
  witness, so all agent writes are covered.
- `edit` is unchanged.

## Alternatives rejected

Model-supplied hash (an LLM would own a correctness-critical value); a prior `read()` as witness
(may be absent, stale, or a *paged* excerpt); operation receipts, sidecar journals and workspace
snapshots (all far larger than the defect requires).
