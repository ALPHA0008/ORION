# Bottleneck Ranking — Stage 1

> **SUPERSEDED IN PART BY THE STAGE-1D REPEAT STUDY.** The ranking below was computed at **n=1**.
> The 8 HIGH-confidence failures have since been re-run at n=3, and repeat support — which §30
> requires — mostly does **not** hold. Read `repeatability.md` first; the section at the end of this
> file records what changed and why the ordering below can no longer be used as written.

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Evidence base: **14 agent failures**, one valid model arm (Gemma), **n=1 per task**, 4 repositories.

The question §19 asks: *if we could improve exactly ONE capability next, which has the strongest
evidence-backed case?* Ranked on frequency, severity, task diversity, repository diversity,
trajectory evidence, repeatability and expected leverage — **not** on raw count.

## Severity does not discriminate

Every failure has the identical consequence: the task is not solved. None is catastrophic, none
cosmetic. So severity cannot break ties here, and frequency must not be allowed to decide alone.

## Candidates

### 1. `termination` — the agent stops believing it is done, with the world unchanged

| criterion | assessment |
|---|---|
| frequency | **4 / 14** |
| repository diversity | 2/4 (pylint 3, pytest 1) |
| trajectory evidence | **HIGH ×2, MEDIUM ×2** |
| mechanism clarity | **highest of any candidate** |
| repeatability | untested (n=1) |
| expected leverage | **high, and cheap** |

The clearest single trajectory in the corpus. `pylint-6506`: 31 tool calls of competent
investigation — located `config_initialization.py` and `run.py`, read the right regions, reasoned
correctly about `Run.__init__` — then emitted **1 731 characters of accurate analysis and edited
nothing**. The diagnosis was right. The action never came.

This is not a knowledge failure or a navigation failure. It is a failure to convert a correct
diagnosis into an edit.

**Decisive consideration: the mechanism this project has already built the detector for.** ADR-013's
declared completion contract exists precisely to catch "stopped ≠ completed", and it is **switched
off** in this baseline by design (shipped defaults, Rule 9). Phase 10 proved the mechanism converts
false completions into honest failures but did **not** recover capability on live runs — Qwen
declined its continuation both times. So the honest expectation is *modest*.

### 2. `long-horizon execution` — the runtime has to stop the agent

| criterion | assessment |
|---|---|
| frequency | **6 / 14** (largest bucket) |
| repository diversity | 2/4 (pytest 5, flask 1) — **83% pytest** |
| trajectory evidence | HIGH ×2, MEDIUM ×4 |
| mechanism clarity | mixed — at least two sub-patterns |
| repeatability | untested |
| expected leverage | uncertain |

Largest by count, and **ranked below #1 anyway**. Three reasons:

- **Repository-concentrated.** Five of six are pytest, which is already 59% of the corpus. §25's
  generalisation filter exists for exactly this: it risks optimising for a corpus artifact.
- **Not one mechanism.** `pytest-6116` fires ADR-006 after five near-identical `grep` calls with no
  `path` and zero files read — a degenerate loop. `pytest-7220`/`9359` exhaust 40 turns after
  substantial real work. A loop-breaker and a turn-budget change are different interventions.
- **Duplication is the visible symptom** (31% mean duplicate actions vs 15% in passes), but whether
  loops *cause* the failure or merely accompany it is unresolved at n=1.

### 3. `editing` — source is modified and the target test still fails

| criterion | assessment |
|---|---|
| frequency | **4 / 14** |
| repository diversity | 2/4 (pytest 3, flask 1) |
| trajectory evidence | HIGH ×4 |
| mechanism clarity | high outcome-clarity, **low cause-clarity** |
| expected leverage | low for a *harness* change |

The agent reached the right file and made a wrong change. This is the most "genuine SWE capability"
failure of the three — and the least amenable to a harness intervention. Improving it likely means a
better model, not better scaffolding. Recorded, not selected.

### REJECTED — `context management`

Dropped messages correlate strongly with failure (17.4 mean in failures vs 3.3 in passes) and would
have made a superficially compelling case. **Rejected on direct test:**

```
dropped == max(0, messages_total - 40)   in 17 of 17 runs
```

Dropping is a mechanical consequence of conversation length, not an independent cause; 0 compactions
occurred and the 32K window was never the binding constraint. This is a rejected candidate rather
than a finding, and it is recorded because the number looked like a bottleneck and was not.

### UNRESOLVED — `tool selection`

**10 of 17 runs wrote files through `bash` heredocs / redirection rather than the `write`/`edit`
tools**; 4 used bash exclusively. This bypasses ADR-011's write pre-state witness entirely — the
lost-update protection built in phase 7 simply does not apply to those writes.

No failure is *attributed* to it on current evidence, so it is not ranked. But it is a live safety
gap in a way none of the ranked candidates are, and it deserves its own investigation.

## Ranking

| # | bottleneck | freq | repos | confidence | verdict |
|---|---|---|---|---|---|
| **1** | `termination` | 4/14 | 2/4 | HIGH | **strongest case** — clearest mechanism, detector already exists |
| 2 | `long-horizon execution` | 6/14 | 2/4 | MEDIUM | largest but pytest-concentrated and not one mechanism |
| 3 | `editing` | 4/14 | 2/4 | HIGH | real, but not a harness problem |
| — | `context management` | — | — | — | **rejected on direct test** |
| — | `tool selection` | — | — | — | **unresolved; safety-relevant** |

## The honest caveat on all of it

No mechanism here reaches 50% of failures, and none spans more than **2 of 4** repositories. Under
n=1, one valid arm, and a corpus where every gold patch touches exactly one file, **no candidate has
the evidence to justify a confident single intervention.**

That conclusion feeds directly into the interpretability gate, and it is the reason this stage does
not end by picking a winner and building it.


---

# Post-repeat revision (Stage 1D)

The repeat study measured what the n=1 ranking could only assume. Applying §30's standard — same
mechanism + multiple tasks + multiple repositories + **repeat support** + trajectory evidence:

| mechanism | n=1 rank | mechanism-stable across 3 runs | revised standing |
|---|---|---|---|
| `editing` | 3rd (4/14) | **2 tasks, 2 repos** (`pylint-6506`, `pytest-8906`), 11/24 runs overall | **strongest** |
| `termination` | **1st** | 1 task, which also flips outcome | weakened |
| `long-horizon execution` | 2nd (6/14, largest) | **none** | weakest |

**The n=1 ranking inverted.** `termination` was ranked first on the clarity of `pylint-6506`'s
trajectory; that trajectory is still real, but the mechanism is stable on exactly one task, and that
task (`pytest-7432`) flips between PASS and FAIL across repeats. `long-horizon execution` was the
largest bucket and is mechanism-stable on **no** task at all.

`editing` is now the only mechanism with genuine repeat support — and it is the one the Stage-1
ranking explicitly set aside as *"real, but not a harness problem"*, on the grounds that a wrong
edit to the right file is more likely to need a better model than better scaffolding.

That judgement has not been overturned by the repeat data; it has been **sharpened into the
phase's uncomfortable conclusion**: the mechanism with the best evidence is the one least amenable
to a harness intervention, and the mechanisms most amenable to one do not survive re-running the
identical task.

This is why Stage 1D does not end by selecting an intervention.
