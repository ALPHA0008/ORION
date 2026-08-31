# `write` Recovery Audit

Measured, not solved (§11–§12). Audit suite: `v0/tests/writerecovery/writerecovery.test.mjs`
— **14 assertions, all passing**.

## Why this matters

The models escape to `write` when `edit` fails. The runtime's strongest safety properties are
built around content-addressed `edit`, so if `write` is becoming the de-facto edit path, the
question is what durability is being traded away.

## Contract

```js
write: {
  effects: 'Mutating',
  recovery: { class: SAFE_RETRY, precondition: sha(content), verify: () => … },
}
```

## The four crash cases

| case | `verify()` | correct? | notes |
|---|---|---|---|
| **1 — write never happened** | `not-applied` | ✅ | retry is safe |
| **2 — write completed** | `applied` | ✅ | detected by content comparison |
| **3 — partial / torn write** | `not-applied` | ✅ | retry converges to `applied` (verified) |
| **4 — file changed underneath** | `not-applied` | ⚠️ **ambiguous** | see below |
| unreadable target (EISDIR) | `unknown` | ✅ | does not collapse into a false `not-applied` |

`write` handles crash-during-effect correctly. Whole-content writes are naturally idempotent, so a
replay after a torn write converges. There is no durability hole in the crash path.

## The real weakness: Case 4 is a lost update

`verify()` compares the file against the intended content. Two very different worlds produce the
same answer:

- my write never landed, **or**
- my write landed **and someone else then changed the file**

Both return `not-applied`, so a recovering worker retries — and the retry **silently discards the
concurrent change**. This is measured explicitly in the audit:

```
ok  Case 4 (changed underneath) -> not-applied
ok    retry silently discards the concurrent change (measured, not fixed)
```

`SAFE_RETRY` is the correct class for the *crash* semantics and the wrong one for the
*concurrency* semantics. Execution fencing (ADR-008) prevents two live workers on one Run, so this
is not currently reachable in normal operation — but it is a real property of the primitive.

## The asymmetry with `edit`

| property | `edit` | `write` |
|---|---|---|
| recovery class | `SELF_VERIFYING` | `SAFE_RETRY` |
| precondition | the **old bytes** | hash of the **new** content |
| replay of an already-applied op | **self-rejects** (precondition consumed) | re-applies |
| distinguishes "didn't land" from "landed then changed" | **yes** | **no** |
| blast radius on a wrong retry | one substring | **the whole file** |
| concurrent third-party change | preserved (edit fails loudly) | **overwritten** |

Verified in the audit: a second identical `edit` throws because its precondition is gone, whereas
a second identical `write` succeeds.

`edit`'s precondition is the *pre-state*, which is what makes it self-verifying. `write`'s
precondition is the *post-state*, which can only ever confirm the goal, never the assumption.

## What this means for the primitive question

The model's escape route is measurably weaker in exactly the dimension this runtime is built to
guarantee:

1. **Blast radius.** A wrong `edit` corrupts a substring; a wrong `write` replaces 3,315 bytes.
2. **Lost updates.** `write` cannot detect that the world moved under it.
3. **Replay safety.** `edit` rejects its own replay; `write` cannot.

So each `edit → write` fallback observed in the benchmark is a **silent downgrade in
recoverability**, invisible to a success-rate metric.

**This is not an argument to remove `write`.** Whole-file replacement is legitimately the right
operation sometimes, and the audit shows its crash semantics are sound. It is an argument that the
*fallback* is not free, and that a candidate primitive must be judged on whether it keeps the model
inside `SELF_VERIFYING` semantics rather than pushing it out of them.

## Not fixed in this phase

Per §11 this is measurement only. A future option — not implemented, not decided — would be an
optional `expected_sha` precondition on `write`, converting it from `SAFE_RETRY` to
`SELF_VERIFYING` when the caller knows the pre-state. That is recorded as an option, not a
recommendation; nothing here justifies changing `write` yet.
