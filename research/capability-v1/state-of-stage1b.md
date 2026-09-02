# State of Stage 1B

Written to satisfy the project's own rule: **if the artifact does not exist, the result is not
complete.** An earlier draft in this stage violated that rule — `gemma-baseline.md` asserted that
the two-model comparison was "complete, not degraded" when no baseline had been run and
`comparison.md` did not exist. That sentence has been corrected, and this file exists so the
distinction between *tooling built* and *experiment run* cannot blur again.

**Corpus label (used consistently in every artifact): Stage-1 filtered SWE-bench-lite slice,
locally reproduced.** Not "SWE-bench Lite performance" — the official per-instance Docker images
were not used; environments were reconstructed locally on a Windows host.

## WHAT EXISTS

| artifact | status |
|---|---|
| `eval/capability-v1/fetch-corpus.mjs` | candidate discovery from HF datasets-server |
| `eval/capability-v1/bracket-corpus.mjs` | two-sided bracket, per-task venv, era-correct deps |
| `eval/capability-v1/build-corpus.mjs` | projects bracket verdicts into runnable tasks |
| `eval/capability-v1/report-corpus.mjs` | generates accepted/rejected docs from the data |
| `eval/capability-v1/run-baseline.mjs` | V0 runtime consumed **unchanged** (Rule 9) |
| `eval/capability-v1/classify.mjs` | failure classes + first-wrong-turn, from the event log |
| `eval/capability-v1/fixtures/bracket-results.json` | 32 candidates, **17 accepted / 15 rejected**, every rejection in the §6 category vocabulary |
| `eval/capability-v1/tasks/` | 17 accepted task files + `corpus.json` + **`frozen-corpus.json`** |
| `eval/capability-v1/verify.mjs` | ONE verifier, shared by the runner and the attack harness |
| `eval/capability-v1/repro-sweep.mjs` + `reports/repro-sweep.json` | **17/17** two-sided through the production verifier |
| `eval/capability-v1/anti-gaming.mjs` + `reports/anti-gaming.json` | **25/25 attacks defended** (5 attacks x 5 tasks) |
| `eval/capability-v1/freeze-corpus.mjs` | freeze gate; refuses unverified tasks |
| `corpus-diversity.md` · `frozen-corpus.md` | §10 concentration analysis; §11-12 frozen manifest |
| `corpus-research.md` · `corpus-selection.md` · `corpus-schema.md` · `corpus-methodology.md` | adoption rationale and method |
| `infrastructure-validation.md` | how the measuring instrument was checked |
| `accepted-tasks.md` · `rejected-tasks.md` | generated from `bracket-results.json` |

**Verified facts** (each backed by an artifact or a recorded command):

- Both endpoints reachable through the **unmodified** client: Gemma 4 31B at
  `172.20.7.22:8000` (56 ms warm, shim emits parsed tool calls), Qwen 3.6 35B at
  `localhost:11434` (2 560 ms warm).
- `git status --porcelain v0/src` is **empty** — the runtime is untouched.
- Bracketing moved from **1/32 to 16/32** purely by correcting provisioning defects; the tasks
  never changed.

## WHAT IS IN PROGRESS

Nothing. The corpus-admission half of Stage 1B is finished; the measurement half has not started.

## WHAT IS NOT YET DONE

Nothing below exists. No claim anywhere in this repository may assume any of it.

| missing artifact | consequence |
|---|---|
| `baseline-lock.md` | benchmark configuration is **not frozen** |
| `baseline.md` | no baseline record |
| `gemma-baseline.md` (as a *baseline*) | endpoint verified only; **zero tasks run** |
| `qwen-baseline.md` | **zero tasks run** |
| `comparison.md` | no comparison is possible yet |
| `failure-taxonomy.md` · `failure-table.md` · `trajectory-analysis.md` | no trajectories exist to analyse |
| `capability-profile.md` · `bottleneck-ranking.md` · `summary.md` | downstream of a baseline that has not run |
| `eval/capability-v1/runs/` · `reports/` | empty |
| smoke test (§14) | not run |

## The one-sentence status

**The instrument is built, calibrated and frozen; nothing has been measured with it yet.**

Corpus `CAPABILITY_V1_STAGE1` · sha256 `0a9a279d48a491da…` · **17 tasks** · runtime `6e4d5325d7`.


---

## Stage 1D / 1E milestone chain

| commit | milestone |
|---|---|
| `39c0f7b` | Part A — bash mutation semantics: `BASH_MUTATION_ALLOWED_BUT_NOT_WITNESSED` (no `v0/src` change) |
| `e4582f4` | Tranche-2 candidates from SWE-bench **Verified**; repeat runner with baseline guard |
| `e6d4a41` | Tranche-2 probe 0/3 — two of three rejections were *our* defects |
| `b55632f` | Part C — 8 tasks x n=3: only **2 of 8** mechanism-stable |
| `6644764` | Django defects 4 and 5 — parenthesised ids, verdict on stderr |
| **`ac61b69`** | **Stage-1E clean base** — post-repeat bottleneck analysis recorded |

`ac61b69` is the base for all remaining Stage-1E work. The n=1 bottleneck ordering is superseded by
the repeat study; see `bottleneck-ranking.md` and `repeatability.md`.
