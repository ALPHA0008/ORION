# Real-Repository Benchmark (§18–§19)

Same 22 tasks, same pinned SHAs, same verifier, runner, tools, prompts, model settings,
authorization and sandbox. **Only the `read` line-number delimiter changed.**

## Result — no regression, and a real gain

16 of 22 tasks completed within the available execution windows (4 repositories; `is-number` and
`ansi-styles` did not finish and are excluded rather than estimated).

| | baseline (`edit-diagnostic`) | after fix |
|---|---:|---:|
| measured tasks | 16 | 16 |
| passing | **11/16** | **14/16** |
| **improved** | — | **3** |
| **regressed** | — | **0** |

## Per repository

| repository | baseline | after | note |
|---|---:|---:|---|
| `camelcase` | 4/7 | **6/7** | the most tab-indented repo — hit hardest by the defect |
| `p-limit` | 3/4 | **4/4** | tab-indented |
| `slugify` | 2/5 | **4/5** | tab-indented |

## Newly passing (§19 — first divergence)

| task | why it now passes |
|---|---|
| `camel-preserve-consecutive` | **STABLE_FAILURE (0/3) in every prior phase.** Phase 2 recorded it consistently exhausting `max_turns` at ~320k tokens with 3–4 `old_string not found` per run — the exact tab signature. |
| `camel-leading-capital` | phase 2: `no_progress` with an edit failure |
| `slug-decamelize-acronym` | phase 2: HIGH_VARIANCE (1/3), `no_progress` with 2 edit failures |

All three were previously failing **with `old_string not found` on tab-indented files** — the
defect's signature. The first divergence is at the same stage in each: the agent reads the file,
constructs an edit, and the edit now matches instead of failing.

This is attribution by mechanism, not by score (§19): each newly-passing task had the specific
failure the fix addresses, and the failure is gone.

## Honest scope

- 16 of 22 tasks, single run each. Enough to establish **no regression** and a directional gain;
  not a precise capability estimate.
- Two repositories are unmeasured. They are `is-number` (411-byte main file, was already 4/4 —
  little room to move) and `ansi-styles` (2 tasks).
- §18's stated purpose was **"primarily no regression, not a guaranteed score increase."** Zero
  regressions is the result that matters; the +3 is a bonus consistent with the mechanism.
