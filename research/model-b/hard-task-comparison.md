# Hard-Task Comparison (§8–§9)

## Sample sizes — stated honestly

§8 warns against comparing repeated runs to single runs. What is available:

| model | hard-task coverage |
|---|---|
| Gemma | **3 repeats × 8 tasks** (`hard-repeat-gemma.json`) |
| Qwen | **1 run × 8 tasks** (the 22-task baseline) + **3 repeats on 1 task** |

Qwen's per-run cost (~105 s, and up to 181 s p95) made 3 repeats × 8 tasks impractical within the
available execution windows. §24 explicitly prefers targeted repeats over blanket ones, so repeats
were spent where they could change an interpretation.

**The headline hard comparison is therefore Gemma-repeated vs Qwen-single, and is labelled as
such rather than presented as equivalent.**

## Single-run hard results

| | Gemma (1 run each) | Qwen (1 run each) |
|---|---:|---:|
| hard tasks passed | 4/8 | **0/8** |
| Gemma 3-repeat figure | 8/24 = 33.3% | — |

## Where repeats exist for both

`camel-numbers-identifier` — the one hard task repeated 3× under **both** models:

| model | result | classification | edits |
|---|---|---|---|
| Gemma | 1/3 | **HIGH_VARIANCE** | varied (0, 1, 15 across runs) |
| Qwen | **0/3** | **STABLE_FAILURE** | **0, 0, 0** |

Same thresholds applied to both (≥80% stable success, ≤20% stable failure).

This is the informative case §9 anticipated — but **inverted from the expected direction**. The
hope was that a second model might turn a "capability failure" into a "variance problem". Instead:

- Gemma's failure is **variable** — it sometimes solves it (1/3), and its edit count swings wildly.
- Qwen's failure is **perfectly stable** — 0/3 with zero edit attempts, every time.

Qwen does not fail this task *harder*; it fails it **more consistently, and earlier in the
pipeline**. It never reaches the point where the task is difficult.

## What the repeats add to the attribution

Qwen's `no_edits_made` is not a sampling artifact. Across 3 identical repeats of the same task it
produced zero edits every time, with model-call counts of 14, 13 and 10 — it consistently spends
its turns on analysis and then terminates.

That consistency **strengthens** the classification of `no_edits_made` as MODEL-SPECIFIC rather
than variance, and correspondingly strengthens the shared "diagnose but don't act" signal, since
Gemma exhibits the same behaviour on 3 of the 6 tasks neither model solved.

## Not claimed

- No aggregate Qwen hard-task rate across repeats — the data does not exist for 7 of 8 tasks.
- No latency comparison — different serving stacks (see [protocol.md](protocol.md)).
- No claim that additional repeats would leave Qwen at 0/8; only `camel-numbers-identifier` was
  repeated, and the other seven remain single-run evidence.
