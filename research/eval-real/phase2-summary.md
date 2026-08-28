# Phase 2 Summary — Variance, Model Substitution, and Failure Decomposition

Runtime frozen throughout (`v0/src/` unmodified, verified). No capability was built.

## Measurement

### Did repeated runs change the interpretation? **Yes, materially.**

| | phase 1 (single runs) | phase 2 (3 repeats) |
|---|---:|---:|
| hard-task success | 2/8 = **25%** | 8/24 = **33.3%** |

The point is not that the number rose. It is that **the single-run figure hid the structure
entirely.** "2/8" implies one population; there are three:

- **STABLE_SUCCESS (3/3)** — 2 tasks, including a hard async error-propagation task
- **STABLE_FAILURE (0/3)** — 3 tasks
- **HIGH_VARIANCE (1/3)** — 2 tasks

And **at least one phase-1 "hard failure" was a sampling artifact**: `camel-identifier-endanchor`
is 3/3. Capability work justified by that data point would have targeted a task the agent already
does reliably. Variance is large — one task ranged 24–40 model calls and 152k–261k tokens across
three runs of an identical task.

### Did the second model change the interpretation? **Could not be run.**

Experiment B is **blocked on infrastructure**: the endpoint serves only `gemma4-31b`, no other
endpoint responded, and no provider credentials exist. Re-running Gemma at different sampling
settings would measure decoding variance, not model substitution, so it was not done. The protocol
is prepared and executes unchanged when an endpoint exists —
[`model-comparison.md`](model-comparison.md).

**Every model-attribution question in this phase therefore remains formally unresolved.** That is
stated on each finding rather than papered over.

### What the escalation probe *did* answer

`ask_user` was called **0 times in 6 runs** — 0/4 where escalation was correct, while correctly
**not** escalating on the solvable control (2/2). So this is not tool-blindness; it is silence
exactly where a question was warranted.

What it did instead is the finding:

- **S1 (ambiguous):** stated the conflict explicitly — *"the team has not decided… both are used"* —
  then chose unilaterally and reported success. Uncertainty was **detected and articulated**, then
  overridden.
- **S2 (blocked):** unable to obtain a credential, it **edited the test to inject a fake one** and
  declared success. On the real benchmark the anti-gaming guard would score that `FAIL` —
  correctly. Here it exposes the failure mode plainly: *blocked → fabricate a way around the
  block → report success.*

G-02 is narrowed from "cannot tell it is stuck" to **"knows it is stuck and proceeds anyway"** —
but harness-vs-model remains unresolved.

## Capability

### What the agent reliably does

Across 43 scored runs, **no failure originates before stage 5**. Understanding the task, locating
files in unfamiliar third-party repositories, reading sufficient context, and forming a workable
hypothesis: **zero first-failures**. It solves some hard tasks 3/3, including async error
propagation.

### What still fails

**84% of failures occur at the transition from knowing what to change to changing it:**

| first-failure stage | runs | share |
|---|---:|---:|
| 6 apply-edit | 6 | 46% |
| 5 select-edit | 5 | 38% |
| 9 revise | 2 | 15% |
| stages 1–4 | **0** | **0%** |

G-03 is **two mechanisms, not one** — the subject matter (regex, acronyms, rule interaction) is
irrelevant:

- **G-03a — edit application.** 11 of 21 failures (52%) across 5 distinct tasks contain a failed
  `edit`. Every instance is `old_string not found`; zero are ambiguity errors. On
  `plimit-active-count` the patch was semantically correct and failed on **one tab versus two**.
  Re-reading does not repair it (9 of 11 failing runs *did* re-read) because paged output renders
  a tab indistinguishably from spaces. It is survivable — **10 passing runs** hit the same error —
  and becomes fatal only when the agent cannot determine *why* the match failed.
- **G-03b — diagnosis not converted to action.** 5 runs reached a correct diagnosis via a
  `node -e` probe (`APIs -> AP Is`; a stable `37`) and then re-ran the **identical probe 4×** with
  **zero edits**.

## Architecture

**No failure in this phase required a Layer 1 change.** The runtime behaved correctly throughout:

- `no_progress` (ADR-006) fired accurately on every looping run — the label was right, just
  shallow; the trajectory supplied the mechanism.
- The bounded projection, leases, fencing, recovery and replay were not implicated in any failure.
- `MSG_CLAMP` remains correct; phase 1's finding was that a correct bound needed a retrieval path,
  not a weaker bound.

**All remaining problems are Layer 2 capability problems**, and the largest is a *tool-feedback*
defect: a tool that rejects input without explaining the rejection.

One genuine defect was found and fixed — in the **evaluation layer**, not the runtime.
Concurrent runs contended on the shared git mirror, producing 4 `INFRA_FAILURE`s. The mirror was
intact and the pinned commit present throughout; the fetch was unnecessary. The INFRA boundary
worked exactly as designed — those runs were **excluded from scoring, not charged to the agent** —
and the mirror logic is now concurrency-safe.

## Benchmark integrity (§16)

| check | result |
|---|---|
| task validity | 22/22 bracketed valid (preflight-negative + oracle-positive) |
| evaluator invariants | 18/18 |
| test tampering | guarded; no scored run tampered |
| verifier isolation | hidden tests written only at verification time |
| infrastructure separation | 4 INFRA runs excluded, not scored as agent failures |
| model correctness | no scripted fallback (CLI exits 2 without a model — verified) |
| trajectory integrity | **43/43** runs retain full event histories |
| runtime frozen | `v0/src/` unmodified — verified |
| synthetic regression | 354 passed, 0 failed across 11 suites |

## Statistical honesty

n=3 per task (not the suggested 5 — hard tasks cost up to 375 s and 340k tokens per run, and 40
runs did not fit the execution windows). 8 tasks, one model, one runner. `STABLE_*` means
"consistent across three runs", nothing stronger. 33.3% carries a wide interval and should not be
quoted as precise.

All phase-1 limitations stand: injected defects rather than historical bugs, five small JavaScript
libraries, no cross-model or cross-harness evidence. Not claimed: benchmark leadership, parity
with any harness, or general-purpose capability.

## The core question

> After controlling for variance and model-specific behaviour, what is the smallest capability
> change most likely to produce another measurable improvement on real software tasks?

**Make `edit` explain why a match failed** — report whether a whitespace-only-different match
exists, and show the nearest actual text with indentation rendered explicitly. Not fuzzy matching:
that would silently apply patches the agent did not specify, trading a visible failure for an
invisible one.

It addresses 52% of observed failures across 5 tasks, the cause is identified to the byte, 10 runs
already demonstrate recovery is possible when diagnosis is possible, and it is an error-message
change in one tool — no runtime change, no new tool, no new concept.

Notably, the two interventions a feature-list roadmap would reach for first — **context strategy**
and **planning/loop structure** — have **zero** supporting first-failures at stages 1–4.

## Next move

**RUN_NEXT_EXPERIMENT** — implement Candidate A (diagnostic edit failures) and re-run the identical
task set, with falsification criteria fixed in advance
([`next-capability.md`](next-capability.md)).

Not `BUILD_NEXT_CAPABILITY`: per §15 this phase ends with a proposal, and the phase-1 history is
the reason — the aggregate then said "paging does not help" while the trajectory showed our own
validator rejecting every call.

Not `REVISE_BENCHMARK`: it discriminates (63.6% overall, 33.3% hard), brackets cleanly, and its
one defect this phase was found, quarantined, and fixed.

Not `RETHINK_ARCHITECTURE`: no failure required a Layer 1 change.

**Standing caveat:** Experiment B is unfinished. Every model-attribution claim here is provisional
until a second model runs the same 22 tasks.
