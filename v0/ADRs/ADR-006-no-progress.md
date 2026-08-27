# ADR-006 — no_progress is a first-class termination reason

**Status:** Accepted (new; discovered by experiment, extended in this phase)

## Context
An agent can loop without advancing: repeating a denied tool, asking for a tool that does not
exist, or reasoning in circles. `max_turns` alone stops it but explains nothing.

## Evidence
Proof-phase Experiment 4 test D: forking a run and denying `edit` produced **305 events** versus 49
for the original. Only `max_turns` stopped it.

Extended in THIS phase, found by driving the CLI against an unreachable endpoint: a model that
**always fails** never emits `model.responded`, so a counter keyed on responses never advances.
The run produced 40 turns of `retrying after network` and died as `max_turns`.

## Failures discovered
1. `max_turns` is a safety ceiling, not a diagnosis. An operator reading `max_turns` learns nothing
   about *why* the run stalled.
2. **A counter keyed on the wrong event silently never fires.** My first implementation counted
   `turn.started`, which occurs *once per run* — so the detector could not fire at all. The test
   caught it; nothing else would have.
3. A permanently-unavailable model is invisible to a progress counter keyed on responses.

## Decision
Three independent signals, each producing a distinct terminal reason:

| signal | default threshold | reason |
|---|---|---|
| identical `tool.requested` payload repeated | 3 | `no_progress` |
| model round-trips with no `tool.succeeded` | 5 | `no_progress` |
| consecutive `model.failed` | 3 | `model_unavailable` |

`max_turns` is retained as a ceiling only. Progress is measured **per model round-trip**, not per
user turn. A successful tool call or a human answer resets the counter.

## Tradeoffs
- Thresholds are heuristics and will occasionally cut off a legitimately slow-but-progressing run.
  Mitigated by making them configurable and by resetting on any real progress.
- Argument digests are order-independent (`stableDigest`), so semantically identical calls with
  reordered keys still count as repeats.

## Tests
- `tests/recovery/recovery.test.mjs` — repeated denied tool terminates as `no_progress` after 1 turn
  (not 40); N round-trips without a successful call terminates as `no_progress`; a healthy run is
  NOT falsely flagged; a busy-but-unfinished run hits `max_turns`, proving the two stay distinct.
- `tests/integration/provider.test.mjs` Test 5 — over real HTTP: 4 model calls instead of 30.
