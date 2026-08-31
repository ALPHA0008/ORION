# `write` Verification (§8)

**Verdict: `write` misclassifies "applied then changed" as "not applied", and the runtime acts
on that by destroying the later change.**

## What it observes

```js
recovery: { class: SAFE_RETRY, precondition: sha(content),
            verify: () => sandbox.read(path) === content ? 'applied' : 'not-applied' }
```

One witness — the **post-state**. The declared precondition is a hash of the content it *intends
to write*: the goal, not the assumption. It can confirm the goal was reached; it can never test
whether the world was what the caller believed when the operation started.

## Measured results

| world | expected truth | `verify()` | decision | correct? |
|---|---|---|---|---|
| never applied | NOT_APPLIED | `not-applied` | REISSUE | ✅ |
| applied | APPLIED | `applied` | SKIP | ✅ |
| **applied then changed** | APPLIED_THEN_CHANGED | **`not-applied`** | **REISSUE** | ❌ |
| torn / partial write | NOT_APPLIED | `not-applied` | REISSUE | ✅ converges |
| unreadable target | UNKNOWN | `unknown` | REISSUE (SAFE_RETRY) | ⚠️ |

## The defect, demonstrated with a real crash

`concurrent-race.test.mjs`: a real child process writes the file and is killed by the **parent**
with `SIGKILL` before any durable success event; a third actor then appends a legitimate change;
recovery runs for real.

```
write child was alive when the parent killed it      ok
  effect landed on disk                              ok
write + concurrent change -> verify()='not-applied' decision='reissue'
  REISSUE silently destroys the concurrent change    ok   ← measured
```

`export const VERSION = 2;` is gone. No error, no escalation, no trace.

## Why `SAFE_RETRY` is the wrong class here

`SAFE_RETRY` means `f(f(x)) == f(x)` **for these args**. That is true of `write` in isolation —
writing the same bytes twice is idempotent. It is **not** true in the presence of a third party,
because the second application is no longer operating on the state the first one left.

The class is describing the operation's algebra while ignoring the concurrency assumption it
silently depends on.

## Would a pre-state hash fix it?

Yes, for the *knowable* case. If `write` carried an optional `expected_sha` of the pre-state, it
could distinguish:

| world | with a pre-state witness |
|---|---|
| pre-state still matches | effect did not run → `not-applied`, retry is safe |
| pre-state gone, post-state matches | `applied` → SKIP |
| pre-state gone, post-state differs | **`unknown`** → escalate, do not retry |

The third row is the one that currently loses data, and it becomes an honest `unknown` rather than
a confident wrong answer. That would move `write` from `SAFE_RETRY` toward `SELF_VERIFYING`, which
is exactly what `edit` already is.

**Not implemented.** §11 says measure, §26 says write up the options and stop.

## Why this matters beyond theory

Across **91 real-repository runs** the benchmark recorded **20 `write` calls** and **0 recovery
decisions**. The vulnerable path is heavily used; the race is simply never triggered by a
single-worker benchmark with no crash injection. Task success cannot detect this class of defect
(§22).

Phase 3 found the model escapes to `write` when `edit` fails. Each such fallback moves the run
from a primitive with a pre-state witness to one without — a **silent downgrade in
recoverability** invisible to the success rate.
