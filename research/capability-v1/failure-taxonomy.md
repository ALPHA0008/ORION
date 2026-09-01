# Failure Taxonomy — Stage 1

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

**14 agent failures** out of 17 tasks. Single arm (Gemma), **n=1**.

| mechanism | freq | repos | tasks | confidence | severity |
|---|---|---|---|---|---|
| `long-horizon execution` | **6** | 2/4 — flask 1, pytest 5 | 6 | HIGH×2, MEDIUM×4 | task not solved |
| `editing` | **4** | 2/4 — flask 1, pytest 3 | 4 | HIGH×4 | task not solved |
| `termination` | **4** | 2/4 — pylint 3, pytest 1 | 4 | HIGH×2, MEDIUM×2 | task not solved |

## No mechanism dominates

The largest bucket holds **6 of 14** failures and spans only
**2 of 4** repositories.

This matters more than any individual count. There is no mechanism here with the frequency
*and* the repository spread *and* the trajectory confidence to carry a confident
single-intervention decision on its own — and saying so is the honest reading of the
evidence, not a failure of the analysis.

## Severity is uniform, so it cannot break the tie

Every failure here has the same consequence: the task is not solved. None is catastrophic
(no data loss, no corruption, no unsafe action), and none is cosmetic. Severity therefore
does not discriminate between mechanisms, and frequency alone must not be allowed to decide
(§19, §22).
