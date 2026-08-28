# Capability Gap — Ranked From Real Failures

Ranking formula (from the brief):

```
priority = failure_frequency × impact × confidence / implementation_complexity
```

Unlike the synthetic phase — where a 100% pass rate made ranking impossible — this ranking is
derived from **15 observed failures on real repositories**.

## G-01 — File reading is capped below real file sizes  ✅ ADDRESSED

| factor | value | evidence |
|---|---|---|
| failure_frequency | **15/15 failures (100%)** | every failure re-read one identical file 2–4× |
| impact | **very high** | gates every task in any repo with files > 2 KB |
| confidence | **very high** | pass rate tracks file visibility monotonically; 411 B → 100%, 7,527 B → 0% |
| implementation_complexity | **low** | one tool signature, no runtime change |

**Priority: highest by a wide margin.** Implemented as iteration 01 — see
[../eval/iteration-01.md](iteration-01.md) is the synthetic one; the real one is
[summary.md](summary.md) and the numbers below.

**Result: 31.8% → 63.6%, 7 improved, 0 regressed.**

This was a *capability* gap (Layer 2) exposed by a correct *runtime* bound (Layer 1). `MSG_CLAMP`
was doing exactly what ADR-001 designed it to do; what was missing was a way to retrieve the
clamped remainder. The clamp was not changed.

## G-02 — The agent never escalates when blocked

| factor | value | evidence |
|---|---|---|
| failure_frequency | 14 baseline runs were stuck in inescapable loops | `ask_user` invoked **0 times in 22 tasks** |
| impact | medium–high | converts a silent failure into an answerable question |
| confidence | medium | one model, one dataset; may be model-specific behaviour |
| implementation_complexity | low–medium | tool exists; the gap is in prompting//policy, not plumbing |

**Priority: highest of the remaining gaps.** The escalation path exists and was always available.
The agent preferred repeating a doomed action to asking for help. Worth an iteration, but it must
be tested against a second model first — this may be a property of `gemma4-31b` rather than of the
harness.

## G-03 — Hard tasks remain largely unsolved

After iteration 01: easy 4/4, medium 8/10, **hard 2/8**.

The residual hard failures are qualitatively different from the baseline's. The agent now pages
the file, forms a hypothesis, edits, and tests — then runs out of road on genuinely difficult
semantics (regex quantifier behaviour, an acronym-splitting rule, a double-discount-style
interaction). These are **real reasoning limits**, not blocked I/O.

**Priority: not actionable yet.** "Get better at hard problems" is not a capability specification.
It needs decomposition into observable sub-failures before anything can be built. That requires
more tasks and more repeats, not a feature.

## G-04 — Cost and latency after unblocking

Iteration 01 doubled the success rate but:

| metric | before | after |
|---|---:|---:|
| total tokens (22 tasks) | 888,834 | **2,202,914** (2.5×) |
| tokens per success | 46,997 | 69,507 |
| p50 wall | 10s | 27s |
| p95 wall | 57s | **221s** |

Some of this is arithmetic rather than regression: runs that used to die at 6 model calls now run
to completion, so their cost is counted for the first time. But `budget_exhausted` rose 1 → 2 and
p95 nearly quadrupled.

**Priority: monitor, do not optimise yet.** Optimising cost before capability is settled would be
premature — and the synthetic phase already showed that context-cost interventions
(elision-based compaction) produce only 3–4% on this workload. Worth revisiting once the hard-task
gap is understood.

## Deliberately NOT proposed

Nothing measured justifies: semantic memory, skills, vector databases, swarms, consensus, RL,
learned routing, marketplaces, multi-provider infrastructure, additional sandbox backends,
enterprise governance, or visual workflow builders.

The single highest-impact change in this phase was **adding two optional parameters to one tool**.
That is worth stating plainly, because it is the opposite of what a feature-list-driven roadmap
would have predicted.
