# Model B Baseline — Qwen 3.6 35B

Same 22 tasks, same harness, same commit (`9c1d0db`). Raw:
[`qwen-model-b.json`](../../eval/real/reports/qwen-model-b.json).

## Headline

```
3/22 passed (13.6%)
easy 2/4   medium 1/10   hard 0/8
failure classes: no_edits_made = 19  (100% of failures)
```

## What Qwen does reliably

- **Native tool calling with no adapter.** 0 `degraded` events vs Gemma's 343.
- **Efficient when it acts.** Duplicate action rate **0.002** vs Gemma's 0.268 — it essentially
  never loops or repeats a failed action.
- **Accurate diagnosis.** Multiple `no_edits_made` runs contain a fully correct root-cause
  analysis naming the exact line and fix.
- **Correct restraint on the escalation control** — 2/2, no false escalations.
- **Clean edits when it makes them.** 3 `edit` calls, **0** `old_string not found`. It never hit
  the tab-separator defect that dominated Gemma's failures.

## What Qwen fails at, in this harness

### 1. It diagnoses and then stops (19/19 failures)

`camel-unicode-uppercase` — 0 edits, terminated with:

> The problem is clear. On line 1: `const UPPERCASE = /[A-Z]/u;` … The fix is to use the Unicode
> property escape `\p{Lu}`, consistent with how `LOWERCASE` already uses `[\p{Ll}]` on line 2.

Correct in every particular. Never called `edit`. `camelcase` was **0/7 with zero edit attempts**.

### 2. It assumes an absolute-path workspace

28 `path escapes sandbox` denials across **14 of 22 runs** (Gemma: 0). It searched `/home/user`,
`/`, `/tmp`, and addressed files as `/testbed/index.js`.

**All were correctly blocked** — verified by executing the exact paths; no containment violation
occurred. The cost is capability, not safety: turns spent on paths that could never resolve.

## Comparison anchor

| | Gemma | Qwen |
|---|---:|---:|
| overall | 68.2% | **13.6%** |
| `edit` / `write` calls | 46 / 8 | **3 / 0** |
| `old_string not found` | 19 | **0** |
| `no_edits_made` | 1 | **19** |
| duplicate action rate | 0.268 | **0.002** |
| `degraded` | 343 | **0** |
| `ask_user` | 0 | **0** |

## Reading this honestly

A 13.6% score does **not** mean Qwen is a weaker coding model. Its failures are almost entirely a
refusal to convert analysis into a tool call, plus a workspace-convention mismatch — not incorrect
reasoning. Under a harness that used absolute paths and pushed harder toward action, the same
model could plausibly score very differently.

That is precisely why §7 says not to call a higher score "better", and why the attribution
labels — not the scoreboard — are the output of this phase.
