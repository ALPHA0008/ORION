# Qwen 3.6 35B — Stage-1 Invalidation Record

**Status:** `INVALID_FOR_CAPABILITY_ATTRIBUTION`
**Classification:** `QWEN_INTERACTION_MECHANISM_CONFIRMED`

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

Artifacts quarantined at `eval/capability-v1/runs/invalidated/`:

- `qwen3.6_35b-interaction-failure.json` (17 results, corpus `0a9a279d…`, runtime `6e4d532`)
- `qwen3.6_35b-interaction-failure.log`
- `qwen3.6_35b-interaction-failure.log.err`

The run databases remain at `Temp/capability-v1/_runs/` with their absolute paths intact. Moving
the JSON did not touch them: the trajectories stay inspectable, and that is the point of keeping
this evidence rather than deleting it.

## Ground-truth evidence

| item | finding |
|---|---|
| live runs | **17**, complete, against the frozen corpus |
| task success | **0/17** |
| phenomenon | empty / truncated terminal assistant response |
| replay method | corrected protocol — replay begins **immediately before** the terminal empty response; the terminal failure response is **not** fed back; real durable tool-result history; existing projection clamp preserved |
| deterministic reproduction | `flask-4045`, `pytest-dev__pytest-9359`, `pylint-7993` |
| minimal-state case | `pylint-7993` reproduced with **0 bytes** of tool feedback |
| common antecedent search (17-run aggregate) | **none found** — no common last tool, tool sequence, result-volume threshold, or input-token threshold |
| investigation state | **HARD STOP** |

The minimal-state reproduction is the load-bearing detail. A failure that reproduces with zero bytes
of tool feedback cannot be explained by result volume, context pressure, or a specific tool's
output — which is precisely why the aggregate search for a common threshold came back empty.

## What is claimed

A **deterministic model/serving/harness interaction failure** exists for Qwen 3.6 35B under the
current Ollama OpenAI-compatible endpoint and the current harness interaction pattern.

## What is NOT claimed

Stated explicitly, because a `0/17` invites all four of these errors:

- **Qwen capability is not measured by the 0/17 result.** The run measures an interaction failure,
  not the model's ability to do software engineering.
- **Qwen is not declared intrinsically "bad."** No capability ranking of Qwen against Gemma or
  anything else follows from this.
- **Ollama alone is not declared the sole root cause.** The evidence supports an *interaction*
  between model, serving stack and harness pattern. Which component is at fault is unresolved.
- **No runner retry has been validated.** No retry logic was added, and none is recommended on this
  evidence.

## Stage-1 consequence

- Qwen is **excluded from capability scoring**. It contributes nothing to `failure-table.md`,
  `failure-taxonomy.md`, `capability-profile.md` or `bottleneck-ranking.md`.
- Qwen is **retained as model/serving-interaction evidence**, which is a real and useful finding
  about the substrate.
- **Gemma 4 31B remains the sole valid Stage-1 capability arm.**

## Cost to the analysis — stated plainly

This is the most serious limitation of Stage 1, and it is larger than the corpus-size limitation.

Across this project, the sharpest instrument for separating a **MODEL** failure from a **HARNESS**
failure has been *divergence between two models on the same task*. Phase 9 and phase 10 both turned
on exactly that. With one valid arm, every mechanism in the failure distribution is
**single-model** and cannot be cleanly attributed:

> A mechanism observed only in Gemma may be a property of Gemma, of the shim, or of the harness.
> This baseline cannot tell those apart.

Every downstream artifact carries this caveat, and the first V1 intervention must be chosen in a way
that survives it — or must be deferred until a second arm exists.

## Hard stop

No further Qwen diagnosis in this phase. No retry logic. No sampling changes. No endpoint changes.
No rerun of the Qwen 17-task baseline.
