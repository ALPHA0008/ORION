# Phase 10 Summary — Declared Completion Contract

## Problem

```js
if (resp.finish || !resp.tool_calls?.length) {
  return this.#stop(runId, leaseToken, 'completed', ExitReason.MODEL_FINISHED, …);
}
```

Any response without tool calls ended the run as `completed`. Three states collapsed into one
verdict: genuinely done · prose diagnosis with an unchanged world · an **empty** reply
mid-exploration.

## Evidence

Phase 9: **12 of 22 Qwen runs** ended with a response carrying no tool calls **and** no text — one
while still paging a 224-line file at line 144. **Gemma: 0 of 66** across three reports.

The evaluator scored every one `FAIL`, so `task_success` was honest. **It was the runtime's own
record that was wrong.**

## Contract

```js
completionContract: { requires_world_change: true, objectiveSatisfied: () => boolean }
```

Absent or `false` → **byte-identical legacy semantics**. `objectiveSatisfied` is supplied by the
task and is deterministic — on the real benchmark, its own test command. No LLM judge; the runtime
never decides what correctness means.

Two simpler signals were **measured and rejected** before designing:

- *"any tool call = done"* — across Qwen's 19 zero-mutation `model_finished` runs, tool-call counts
  ranged **2 to 20** (13 reads on one task). Investigation is not completion.
- *"mutation count > 0"* — degenerates into "must mutate". Tested: an already-correct world
  completes with zero mutations (§19).

## Intervention

`ExitReason.FINISHED_WITHOUT_CHANGE`; one **hard-bounded** continuation per run, counted from
`turn.started.continuation` in the durable event log so a crash cannot buy a second; a throwing
predicate falls back to legacy completion. No new event type, no new run status, no new state
store.

## Gemma — before / after

| | before | after |
|---|---:|---:|
| task pass | 4/4 | **4/4** |
| false completions | 0 | **0** |
| continuations granted | — | **0** |

**The contract correctly does nothing.** Gemma never had the defect, so no change is the right
result — and a change would have signalled the predicate misfiring. §25-D clear.

## Qwen — before / after

| | before | after |
|---|---:|---:|
| task pass | 2/4 | 2/4 |
| runtime `completed` | 4 | **2** |
| `finished_without_change` | 0 | **2** |
| **false completions** | **2** | **0** ✅ |

## Runtime truth

**Yes — false completed states disappeared where the contract was declared.** Qwen 2 → 0, Gemma
unchanged at 0. Each false completion became an honest `failed / finished_without_change`.

## Task success

**Unchanged**, and that is expected (§17). The evaluator was already right; this fixes the
runtime's record, not the model's capability.

`recovery_after_premature_stop` = **0/2** on live runs: the continuation fired exactly once per
run, was recorded in the event log, and **Qwen declined it too**. Reported plainly rather than
framed as a win. The deterministic suite proves the mechanism *can* convert a premature stop into a
completed task; the live model simply stopped again — consistent with phase 9's attribution that
its termination behaviour is a **model** property.

## Safety

No incorrect edits introduced. No forced mutations — analysis-only tasks still complete on prose,
and an already-correct world completes with zero mutations. Continuation hard-bounded to one, so
no retry loops. Escalation untouched: `unfinished ≠ requires_human` (§24).

## Crash / resume

Crash mid-continuation → resume → run completes, **no duplicate continuation** (count stays 1).
The credit lives in the event log, never in worker memory.

## Replay / fork

Terminal state, exit reason and continuation count all reconstruct identically; replay makes zero
model calls; a fork before the continuation inherits no credit. `replay/semantics` 44/44 unchanged.

Recorded caveat: `objectiveSatisfied` is a live predicate, so replay reconstructs the *recorded
decision* faithfully but would re-decide against the world as it is now. Same property `edit` and
`write` verification already have.

## Regression

**608 passed, 0 failed across 23 suites** (was 579/22). `fencing` 29, `replay` 44, `crash/matrix`
6, `recovery` 53, `lease` 51, `writewitness` 26 and all escalation-gate suites unchanged.

## Falsification (§25)

| criterion | result |
|---|---|
| A forces mutations on analysis-only tasks | **no** — tested both variants |
| B infinite retries | **no** — hard bound of 1, verified |
| C increases incorrect edits | **no** — zero |
| D Gemma regresses | **no** — 4/4 both arms |
| E Qwen still falsely `completed` | **no** — 2 → 0 |
| F replay/resume break | **no** — 44/44, no duplicate continuation |
| G completion becomes model-specific | **no** — one contract, both models |
| H benchmark-specific hacks | **no** — predicate is task-supplied |

None triggered.

## Decision: **COMPLETION_CONTRACT_WORKS**

Scoped honestly: it fixes **runtime truth**, which was the stated primary target (§13, §17). It did
**not** recover capability on live runs, and no claim is made that it does.

## Incomplete measurement

The Qwen `camelcase` subset — all 7 runs previously false-completed, the strongest available
demonstration — **did not finish**. One task hung inside an Ollama model call (6 model calls,
**0 continuations**, verified from the live projection rather than assumed). Not claimed. The
`is-number` result (2 → 0) is what was actually measured.

## §28 — should the runtime know what "done" means?

Partially, and by **declaration** rather than inference. The evaluator keeps ownership of
correctness; the runtime receives the smallest predicate needed to avoid asserting a falsehood
about its own terminal state.

```
Layer 1 execution truth   — event log             (already correct)
Layer 2 task contract     — requires_world_change  (ADDED HERE)
Layer 3 model behaviour   — proposes "finished"
Layer 4 evaluator result  — verifies world state   (already correct)
```

Layer 2 was missing, so Layer 3's proposal was accepted unconditionally and Layer 1 recorded
something Layer 4 contradicted.

> **Stopping is not the same thing as completing.**
