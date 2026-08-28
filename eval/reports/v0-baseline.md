# V0 Golden Baseline

- **Run label:** `v0-baseline`
- **Commit:** `73b0bc3` (tag `v0-baseline`)
- **Model:** `gemma4-31b` via vLLM, OpenAI-compatible endpoint
- **Runner:** `harness-v0` (capabilities: `event_log` trajectory, `tool`-granular recovery, replay/fork/resume)
- **Dataset:** 12 tasks (5 easy, 5 medium, 2 hard), 8 content-addressed fixtures
- **Raw results:** [`v0-baseline.json`](v0-baseline.json)

## Headline

```
12/12 passed  (100%)
by difficulty: easy 5/5  medium 5/5  hard 2/2
wall p50 8.4s  p95 15.2s
per success: 5.75 model calls, 5 tool calls, 4802 tokens
totals: 53734in/3894out tokens, 69 degraded, 0 escalations
```

**This is a bad result.** A benchmark that everything passes has zero discriminating power. It
cannot rank two harnesses, cannot detect a regression, and cannot locate a capability gap. The
score measures the dataset, not the agent.

The purpose of this baseline was to answer "where are we today?" The honest answer is:
**we do not yet know, because the instrument is not sensitive enough to tell us.**

## Per-task detail

| task | diff | outcome | mc | tc | turns | dup rate | files | wall |
|---|---|---|---:|---:|---:|---:|---:|---:|
| calc-add-bug | easy | PASS | 7 | 5 | 1 | 0.20 | 1 | 7.4s |
| calc-add-bug-noshell | easy | PASS | 3 | 2 | 1 | 0.00 | 1 | 2.1s |
| explore-find-tax-rate | easy | PASS | 6 | 5 | 1 | 0.00 | 0 | 3.0s |
| broken-import-path | easy | PASS | 6 | 5 | 1 | 0.20 | 1 | 7.1s |
| cli-help-flag | easy | PASS | 5 | 4 | 1 | 0.00 | 1 | 9.5s |
| config-precedence | medium | PASS | 8 | 7 | 1 | 0.14 | 3 | 8.4s |
| implement-truncate | medium | PASS | 6 | 5 | 1 | 0.00 | 3 | 8.7s |
| deep-tree-tax-fix | medium | PASS | 6 | 5 | 1 | 0.20 | 1 | 7.5s |
| cli-max-command | medium | PASS | 5 | 4 | 1 | 0.00 | 2 | 15.2s |
| multi-file-refactor | medium | PASS | 5 | 8 | 1 | 0.00 | 4 | 10.0s |
| wrong-test-discrimination | hard | PASS | 6 | 5 | 1 | 0.20 | 2 | 8.6s |
| multi-bug-calc | hard | PASS | 6 | 5 | 1 | 0.20 | 1 | 7.7s |

## The passes are genuine, not verifier weakness

Before concluding the dataset is too easy, each non-trivial pass was audited against its
trajectory and its verifier's evidence string:

- **`wrong-test-discrimination`** — the designed trap. A faulty test contradicts `SPEC.md`. An
  agent that "fixes" correct source to satisfy the faulty test turns the visible suite green and
  still fails, because a *hidden* verifier checks spec conformance rather than suite exit code.
  Result: `spec_conformant=true suite_passes=true (SPEC_OK)`. The trajectory shows the agent read
  the failing output, read the test, then read `SPEC.md`, and edited the **test** — not the
  source. It genuinely resolved the authority conflict.
- **`multi-file-refactor`** — verifier: `shared=src/total.js still_duplicated=[]`. The agent read
  all three duplicated files, wrote a shared `calculateTotal`, and rewired the call sites. The
  behaviour-preservation suite still passes.
- **`multi-bug-calc`** — verifier ran the real suite to exit 0 after multiple distinct defects.

These are real solves. The instrument is not lying about *these* twelve tasks; it is silent about
everything harder.

## What the trajectory metrics reveal (the actual finding)

The event log makes the headroom visible in a way a pass/fail score cannot:

| signal | observed | budget / capacity | utilisation |
|---|---:|---:|---|
| model round-trips | max **8** | 30 `max_turns` | ~27% peak |
| tool calls | max **8** | 400 | 2% |
| messages in context | max **16** | 40-message window | 40% |
| messages dropped by projection | **0** | — | **0%** |
| context compactions | **0** | — | **never fired** |
| recovery decisions | **0** | — | **never fired** |
| escalations / human requests | **0** | — | never fired |
| tokens per success | 4,802 | — | tiny |

Seven of twelve runs contained at least one `tool.failed` event, but **zero** produced a
`tool.recovery_decided` event — those failures were plain first-attempt errors (e.g. `bash` exiting
non-zero on a failing test suite, which is *information*, not a fault) that the model handled
conversationally. The recovery classifier, `verify()`, the fencing path, the reaper, and the
bounded-projection drop path — the subsystems this harness was actually built around — were
**never exercised by a single task in the dataset.**

That is the gap between what was validated and what is measured:

> The runtime has been validated far more deeply than the agent has, and the *evaluation dataset*
> exercises the agent far more shallowly than either.

## Degradation signal

69 `degraded` events across 12 runs — every one from `model_adapter`, subsystems
`gemma-native-tool-calls` and `gemma-channel-markers`. This is ADR-010 working exactly as intended:
the Gemma endpoint does not emit standard OpenAI `tool_calls`, so a shim parses them out, and every
shimmed response is recorded as a degradation rather than being silently normalised. A run that
depended on shimming is visibly distinguishable from a clean one.

This is the one place the baseline delivers real information: **100% of model responses in this
configuration required a compatibility shim.** Any claim about this model's tool-calling behaviour
must carry that caveat.

## Conclusion

The baseline's finding is about the instrument, not the agent. Before any capability work is
justified, the dataset must be made hard enough to fail. Ranking capability gaps from a 100%-pass
dataset would be ranking noise.

Next: extend the dataset until the pass rate drops into a discriminating band, then re-baseline and
rank gaps from *observed* failures. See [`../../research/eval/failure-taxonomy.md`](../../research/eval/failure-taxonomy.md).
