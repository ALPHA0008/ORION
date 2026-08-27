# Crash / Resume with a REAL model (Step 9) — THE PRIMARY EXPERIMENT

**Model:** `gemma4-31b` on vLLM · **Result: 21 assertions, 21 pass.**

The question this answers is not *"did the process continue?"* but
**"did the MODEL resume coherently?"**

## Method

- A real model runs a 4-step ordered task (write step1, step2, step3, then read step1 back).
- The **parent** issues `SIGKILL` to a live child — never a self-kill, which cannot fire from a
  busy event loop.
- The kill point is chosen by **durable progress**, not wall clock: the parent polls the event
  count and kills once the run passes 25% / 50% / 75% of the ~46-event task. This makes the kill
  point comparable across runs despite variable model latency.
- The lease is then expired, the reaper reclaims, and a **different OS process** resumes.

## Results

| kill point | crash at | files on disk at crash | model calls after resume | tool calls after | **redone writes** | outcome |
|---|---|---|---|---|---|---|
| 25pct | event 12 | 0/3 | 5 | 4 | **0** | completed, 3/3 files |
| 50pct | event 26 | 2/3 | 3 | 2 | **0** | completed, 3/3 files |
| 75pct | event 33 | 3/3 | 2 | 1 | **0** | completed, 3/3 files |

Every scenario: child verified alive, then `SIGKILL` (`exit={"code":null,"sig":"SIGKILL"}`),
reaper requeued exactly 1 run, a different process completed the task, **zero duplicate writes**,
all three files correct at the end, event log gapless at 46 events.

## The coherence evidence

This is the part that a scripted model could never have demonstrated. The seam is marked:

### Killed at 25% — nothing written yet
```
   9  · bash  {"cmd":"mkdir -p notes"}
  10  ✓ bash
  13  ⚠ lease lost (lease_expired)          <<< CRASH / RESUME SEAM
  17  🧠 wants 1 tool call: write   552 tok
  20  · write {"content":"alpha","path":"notes/step1.txt"}
```
The resumed model correctly continued at **step 1** — the next undone step.

### Killed at 50% — step1 and step2 already on disk
```
  23  · write {"content":"beta","path":"notes/step2.txt"}
  24  ✓ write -> wrote notes/step2.txt
  27  ⚠ lease lost (lease_expired)          <<< CRASH / RESUME SEAM
  31  🧠 wants 1 tool call: write   642 tok
  34  · write {"content":"gamma","path":"notes/step3.txt"}
```
**The resumed model wrote `step3` — not `step1` again.** It understood what had already happened.

### Killed at 75% — all three written, read-back outstanding
```
  30  · write {"content":"gamma","path":"notes/step3.txt"}
  31  ✓ write -> wrote notes/step3.txt
  34  ⚠ lease lost (lease_expired)          <<< CRASH / RESUME SEAM
  38  🧠 wants 1 tool call: read    687 tok
  41  · read {"path":"notes/step1.txt"}
```
It skipped straight to the **read-back**, the only remaining step.

### Context really was reconstructed
Prompt token counts across the seam rise monotonically — 530 → 552 → 597 → 642 → 687 → 716 —
so the resuming process genuinely rebuilt the prior history from the event log rather than
starting from a bare prompt. The final summary in all three runs names all three files correctly.

## Answers to the required questions

| question | answer |
|---|---|
| Did the model understand what had already happened? | **Yes** — it continued at the correct next step in all 3 scenarios |
| Did it repeat completed work? | **No** — 0 redone writes in 3/3 |
| Did it contradict prior tool results? | **No** — final summary matches the actual filesystem |
| Did it receive enough context? | **Yes** — prompt tokens grow monotonically across the seam |
| Did it misinterpret repaired transcript state? | **No sign of it.** Note: no transcript repair was needed here — no crash landed between a `tool.started` and its terminal event |
| Unsafe duplicate external effects? | **None** |
| Did it complete? | **Yes** — `completed/model_finished` in 3/3 |
| Is the final world state correct? | **Yes** — 3/3 files with the right contents |

## Honest limits of this experiment

1. **No orphaned tool call was produced.** In all three runs the kill landed on
   `model.requested` — i.e. while waiting on the model, not mid-tool-effect. That is the *likely*
   place to be killed (the model call dominates wall time), but it means the `verify()` /
   reissue / skip / escalate path was **not** exercised by these runs. It is covered separately in
   `recovery-matrix.md` with a deliberately induced orphan.
2. **`write` is SAFE_RETRY.** Even a duplicate would have been harmless here. A genuinely
   dangerous duplicate (append, POST) was not exercised by the real model.
3. **One task shape, three kill points, one model.** Not a distribution.
4. The task is simple enough that the model may be re-deriving the plan from the task text rather
   than truly reading the history. The monotonic prompt growth argues against that, but
   a harder task with mid-task discoveries would be a stronger test.