# Evaluation Phase — Summary

Brief 8 asked for two things: an objective evaluation harness, and its use to systematically
close the capability gap. The first was delivered. The second produced a result that reframes
the question.

## What was built

An evaluation harness (`eval/`) with deterministic verification and no LLM judge: 17 tasks over
13 content-addressed fixtures, a harness-agnostic runner interface, event-log-derived metrics,
and a CLI (`list` / `run` / `report` / `compare`) that refuses to run without a real model.

## The central finding

**The capability gap could not be ranked, because the dataset never failed the agent.**

The golden baseline scored **12/12**. The natural reading — "the agent is strong" — is wrong. A
benchmark everything passes has no discriminating power: it cannot rank two harnesses, cannot
detect a regression, and cannot locate a bottleneck. The score measured the dataset, not the
agent.

Five hard-tier tasks were then built specifically to force failure, each targeting a mechanism
the baseline showed had never fired — context dropping, tool-failure recovery, long-horizon
completeness, multi-hop causal reasoning, and instruction-hierarchy robustness. **All five
passed.** Final dataset: 17/17.

This is reported as the headline result because it is the honest one. Ranking capability gaps
from a 100%-pass dataset would have been ranking noise, and the brief's loop forbids building
before measuring.

## What the event log surfaced that pass/fail could not

Trajectory metrics located a bottleneck invisible to the score: **one task consumed 58.7% of all
input tokens** in the dataset — 22.8× the mean of the other sixteen, at a 175:1 input-to-output
ratio — because the bounded projection resends the whole window on every model call.

That is the difference the thesis predicted. A pass/fail benchmark sees seventeen green ticks; the
event log sees that one of them costs more than the other sixteen combined.

## Iteration 01 — kept, scoped, and partly falsified

Context compaction by supersession was implemented, verified (18 new assertions; **328/328**
across 10 suites, up from 310/9), and benchmarked A/B with repeats.

**Result: −3.3% to −4.1% input tokens, 100% → 100% success, zero regressions. KEEP (scoped).**

The more valuable outcome was the falsification. The task the optimisation was *built for*
improved by **0.2%** — it reads 14 distinct files once each, so nothing is superseded and there is
nothing to elide. The real 32% win came from a different task that re-reads the same files while
editing them. The first, uncontrolled comparison suggested −9.3%; controlling for model-call count
showed −3.3%.

Without per-event attribution, −9.3% would have been reported as a success and the wrong causal
story believed. **The log did not just measure the improvement — it caught the wrong explanation
for it.**

## Evidence for the thesis

> *The event log makes agent runs measurable and improvable, not just recoverable.*

Supported, with three concrete instances:

1. **Measurable** — the bottleneck was found from per-call token counts, not instrumentation.
2. **Improvable** — the fix was verified from the log (`elided`, `bytes_saved` per event) and is
   auditable in `explain` output.
3. **Self-correcting** — the log falsified the hypothesis about its own fix.

A fourth result was unplanned: `wide-units-mismatch` is the first task in the project's history to
force the bounded projection to **drop live messages** (4 dropped, 42 messages, 40 hot) — and the
agent solved it anyway. That is empirical validation of ADR-001 under real load, obtained from a
task built to break it.

## What went wrong, and what it cost

A verifier bug scored a correct agent as `FAIL` (`cold-cache-crash`). The verifier ran a
*stateful* suite to check it passed, then re-ran it — its own first probe poisoned the state it
then measured. The agent's own trajectory showed `ALL PASS`.

Had this gone unexamined it would have been written up as a genuine capability gap — "the agent
cannot produce self-healing fixes" — and driven an entire iteration of capability work against a
defect that did not exist. It was caught by reading the trajectory rather than trusting the score.

Standing rule adopted: **a verifier change must be validated against a known-good and a known-bad
candidate before its results are believed.** The fix was validated against three candidates before
being trusted.

## Honest limitations

- Synthetic fixtures, not real repository history. **Results do not transfer to real repos without
  further validation.**
- One model (`gemma4-31b`), which required a compatibility shim on ~100% of responses.
- One runner. No comparative claim against any other harness is made.
- 17 tasks, 1–2 repeats: enough to detect a 30% token change, not a small effect or a
  success-rate difference.
- Ceiling effect at 100% — the dataset cannot currently measure capability at all, only cost.

## What comes next

1. **Make the dataset fail** (blocks everything else). Escalate along the axes with the most
   headroom: turn count (peak 22 of 60), tool-failure density, and genuine ambiguity requiring
   escalation — `ask_user` has never once been called.
2. **Re-baseline** and only then rank capability gaps from observed failures.
3. **A second model**, to separate harness behaviour from model behaviour.
4. **A second runner**, before any comparative claim is made.

Not proposed, because nothing measured justifies them: semantic memory, skills, vector databases,
swarms, consensus, RL, learned routing, marketplaces, multi-provider infrastructure, extra sandbox
backends, enterprise governance, visual workflow builders.

## Scope note

Nothing in this phase added KernlBase-specific logic. The authorization seam remains
provider-neutral with a local default, and the evaluation harness runs entirely offline against a
self-hosted endpoint.
