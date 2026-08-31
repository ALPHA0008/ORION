# Results — Recovery Verification Experiment

## Suites

| suite | assertions | what it establishes |
|---|---:|---|
| `worldstate/worldstate` | 19 | what `verify()` reports for S0/S1/S2 and the ambiguous cases |
| `worldstate/concurrent-race` | 13 | the same races with **real `SIGKILL` process kills** + a third actor |
| `worldstate/real-repo-race` | 10 | the defect reproduced on **real pinned repository bytes** |
| `writerecovery/writerecovery` | 14 | the four crash cases for `write` (phase 3) |

Full regression: **441 passed, 0 failed across 16 suites** (was 399/13 at freeze).

## Required metrics (§20)

Measured over the deterministic race matrix — 12 classification events (6 world states × 2 tools):

| metric | `edit` | `write` |
|---|---:|---:|
| **verification_misclassification_rate** | **0/6** | **1/6 (17%)** |
| false `not-applied` (claims never-applied when it applied) | 0 | **1** |
| false `applied` | 0 | 0 |
| `unknown` rate | 1/6 | 1/6 |
| recovery correctness | 6/6 | 5/6 |
| duplicate side effects | 0 (replay self-rejects) | **1** |
| lost effects | 0 | 0 |
| **silent overwrite** | **0** | **1** |
| human escalations triggered | 0 | 0 |

The single `write` misclassification is the entire finding. It is a **false `not-applied`** — the
destructive direction — and it produces a silent overwrite with no error and no escalation.

`edit`'s one `unknown` is the honest answer for a genuinely ambiguous world, and per §20 that is a
success, not a cost to be optimised away.

## Task success vs recovery safety (§22) — reported separately

The real-repository race makes the separation concrete, on `p-limit@df476048/index.js`:

| dimension | result |
|---|---|
| `task_success` | **PASS** — the file holds the correct semantic fix; the repo's suite is green |
| `recovery_correctness` | **FAIL** — an applied effect was reclassified `not-applied` and reissued |
| `world_state_correctness` | **FAIL** — a legitimate concurrent change was destroyed |

**A green benchmark hides this entirely.** That is why §22 requires the three to be reported
separately, and why this phase was test-driven rather than benchmark-driven.

## Required invariants (§21)

| invariant | result |
|---|---|
| a stale worker cannot create authoritative writes | ✅ holds (fencing, 29 assertions, unchanged) |
| **an uncertain mutation is never silently retried when its effect cannot be safely classified** | ❌ **VIOLATED by `write`** — `not-applied` is asserted with false confidence and auto-reissued |
| a successful task must not hide a recovery-safety regression | ❌ **violated in principle** — demonstrated above; only visible because it was measured directly |

For `edit` the first two invariants hold: its `unknown` reissue is a no-op that fails loudly.

## Reachability

Across **91 real-repository runs**: **20 `write` calls**, **0 recovery decisions**. The vulnerable
path is heavily used; the race is simply never triggered by a single-worker benchmark without
crash injection or a concurrent modifier.

So the defect is **latent, not theoretical** — reachable whenever a crash coincides with any other
writer (a developer, a formatter, a watch process, a second agent).

## The two collapsed pairs

| pair | nature | fixable? |
|---|---|---|
| `write`: never-applied vs applied-then-changed | **implementation gap** — only the post-state is observed | **yes** — a pre-state witness |
| `edit`: never-applied vs applied-then-reverted | **information limit** — worlds are byte-identical | **no** — and `unknown` is the honest answer |

## The sharper root cause

The bug is not a missing state, and not really `write.verify()` either.

`SAFE_RETRY` asserts `f(f(x)) == f(x)` **for these args**. True for `write` in isolation; false in
the presence of a third party, because the second application no longer operates on the state the
first one left. The class encodes an idempotence claim that **silently assumes no concurrent
writer** — and `decideRecovery` trusts that claim on the `unknown` path.

`edit` survives the same decision only because its precondition is consumed, so a replay
self-rejects. **Safety comes from the primitive, not the decision.**
