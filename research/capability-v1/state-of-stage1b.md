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
| `eval/capability-v1/fixtures/bracket-results.json` | 32 candidates, 16 accepted / 16 rejected |
| `eval/capability-v1/tasks/` | 16 accepted task files + `corpus.json` |
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

- **Candidate sweep is not final.** 16 accepted, 16 rejected. Several rejections are still
  suspected to be *our* defects rather than task defects — notably three `pytest` tasks failing an
  `addini` assertion and one failing `_pytest._version`, which is the signature of a defect already
  found and fixed once. A bounded retry on an era-appropriate interpreter (3.8) was in flight when
  this stage was re-scoped.
- **Rejection reasons are not yet in the §6 category vocabulary.** They are currently raw stage
  names (`install`, `oracle-negative`, `preflight-positive`) plus evidence text.

## WHAT IS NOT YET DONE

Nothing below exists. No claim anywhere in this repository may assume any of it.

| missing artifact | consequence |
|---|---|
| `frozen-corpus.md` | corpus is **not frozen**; no run may treat it as fixed |
| `baseline-lock.md` | benchmark configuration is **not frozen** |
| `baseline.md` | no baseline record |
| `gemma-baseline.md` (as a *baseline*) | endpoint verified only; **zero tasks run** |
| `qwen-baseline.md` | **zero tasks run** |
| `comparison.md` | no comparison is possible yet |
| `failure-taxonomy.md` · `failure-table.md` · `trajectory-analysis.md` | no trajectories exist to analyse |
| `capability-profile.md` · `bottleneck-ranking.md` · `summary.md` | downstream of a baseline that has not run |
| `eval/capability-v1/runs/` · `reports/` | empty |
| anti-gaming bracket (§7) | delete-test / skip-test defences designed but **not executed** |
| reproducibility sweep (§13) | not run |
| smoke test (§14) | not run |

## The one-sentence status

**The instrument is built and partially calibrated; nothing has been measured with it yet.**
