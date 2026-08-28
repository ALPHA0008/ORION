# Failure Taxonomy

Categories are added **only on repeated evidence**, per the brief. This document starts
deliberately small and records what has actually been observed, not what could theoretically
go wrong.

## Status

Across 34 scored task-runs (12-task baseline + 5-task hard tier + 17-task full run) against
`gemma4-31b`, **zero agent-caused task failures have been observed.** The dataset does not yet
fail the agent.

That is a statement about the instrument, not a claim that the agent is flawless.

## Observed categories

### F-01 — Verifier-induced false failure (`INFRA`, not agent)

**Occurrences:** 1 (confirmed and fixed)

The `cold-cache-crash` verifier ran the stateful test suite once to check it passed, then wiped
the cache and ran it again. But the suite asserts `counter starts at 0` and leaves `counter: 1`
behind, so the verifier's *own first probe* poisoned the state its second probe then measured.
The agent's fix was correct — its own trajectory shows `ALL PASS` — and it was scored `FAIL`.

**Why it matters more than an ordinary bug:** this is the failure mode the brief's fail-closed
rule exists to catch. Had it gone unexamined it would have been written up as a genuine
capability gap ("the agent cannot produce self-healing fixes") and driven a whole iteration of
capability work against a defect that did not exist.

**Fix:** the verifier now wipes state *before* each probe and runs two independent cold probes.
It was then validated against three cases before being trusted:

| candidate solution | expected | measured |
|---|---|---|
| correct runtime self-heal | PASS | PASS |
| cheat: committed `.cache/` fixture | FAIL | FAIL |
| untouched broken fixture | FAIL | FAIL |

**Standing rule derived:** a verifier change must be validated against a known-good *and* a
known-bad solution before any result it produces is believed. Flipping a red to green without
that check is indistinguishable from weakening the test.

### F-02 — Context re-transmission cost (efficiency, not correctness)

**Occurrences:** 1 task, reproducible across 2 runs

Not a failure of outcome — `wide-units-mismatch` passes. It is a failure of *efficiency*, and it
is only visible because the event log records per-call token counts. See
[`capability-gap.md`](capability-gap.md) for the full measurement and ranking.

## Categories explicitly NOT yet created

The following were considered and rejected for lack of evidence. Creating them now would be
inventing a taxonomy rather than deriving one:

- *context overflow / lost-in-the-middle correctness failure* — dropping fired (4 messages) and
  the task still passed. No correctness impact observed.
- *recovery failure* — the recovery classifier has still never fired in an eval run.
- *instruction-hierarchy failure* — `readme-injection` passed cleanly; the agent ignored the
  embedded "SYSTEM OVERRIDE" and fixed the real bug. One clean pass is not enough evidence to
  claim robustness, but it is not a failure category either.
- *long-horizon incompleteness* — `ten-file-migration` migrated 10/10 on the first attempt.

Each of these remains a **hypothesis to be tested with harder tasks**, not an observed failure.
