# Edit vs Write — Model Attribution (§11)

## The profiles are almost disjoint

Across the same 22 tasks, same harness, same tools:

| | Gemma 4 31B | Qwen 3.6 35B |
|---|---:|---:|
| scored runs | 22 | 20 (+2 pending) |
| passes | 15 | 3 |
| **`edit` calls** | **46** | **3** |
| **`write` calls** | **8** | **0** |
| `old_string not found` | **19** | **0** |
| **`no_edits_made` failures** | **1** | **17** |
| mean model calls | 15.6 | 7.7 |

These are not two degrees of the same behaviour. They are **different failure modes entirely**.

## Gemma: tries to edit, fails on bytes

46 edit attempts, 19 `not_found` errors, 8 escapes to `write`. Phase 3 established the cause: our
paged `read` renders `N` + TAB + content, so on tab-indented files the separator merges with the
real indentation and the model emits one tab too many.

## Qwen: diagnoses correctly, then does not act

3 edit attempts across 20 runs. **Zero** `old_string not found` — it essentially never reaches the
byte-reproduction step where Gemma fails. Instead it stops after reading and reports the fix as
prose.

`camel-unicode-uppercase`, a representative case (0 edits, `model_finished`):

> The problem is clear. On line 1: `const UPPERCASE = /[A-Z]/u;`
> This regex only matches **ASCII** uppercase letters (A–Z)… The fix is to use the Unicode
> property escape `\p{Lu}`, consistent with how `LOWERCASE` already uses `[\p{Ll}]` on line 2.

That is a **completely correct diagnosis** — right line, right cause, right fix, and it even cites
the neighbouring line as corroboration. It then terminated without calling `edit`.

`camelcase` was **0/7 with zero edit attempts on every single task.**

## Attribution

| observation | label | reasoning |
|---|---|---|
| Gemma's `old_string not found` storm | **HARNESS-SPECIFIC** (read rendering) | Qwen never hits it; phase 3 fixed the mechanism to the byte |
| Gemma's `write` fallback | **MODEL-SPECIFIC** (given the harness defect) | Qwen never falls back to `write` — 0 calls |
| **Qwen's `no_edits_made`** | **MODEL-SPECIFIC** | Gemma shows it once in 22 runs; Qwen 17 times in 20 |
| the underlying stage-5 gap ("diagnose but don't act") | **shared, different expression** | see below |

## The one genuinely shared signal

Phase 2's stage decomposition found Gemma failing at **stage 5 (select-edit)** in 5 of 13 failures
— it reached a correct diagnosis via a `node -e` probe, then re-ran the identical probe four times
without editing.

Qwen exhibits the *same* stage-5 stall, far more often and more cleanly: it produces the diagnosis
in prose and terminates.

**Both models can locate and explain the defect. Both sometimes fail to convert that into a tool
call.** Gemma masks this behind byte-level edit failures; Qwen shows it undisguised.

That makes "diagnosis does not become action" the **strongest surviving cross-model signal** in
this experiment. It is not proof of a harness defect — neither model was prevented from calling
`edit` — but it is the one failure that survived the model swap, which per §20 is the bar for
becoming a serious harness candidate.

## What this does NOT show

- It does **not** show Gemma is a better coder. Gemma's 15/22 vs Qwen's 3/20 is dominated by
  Qwen's refusal to act, not by wrong diagnoses. Qwen's diagnoses were frequently correct.
- It does **not** vindicate the `edit` primitive by itself; Qwen barely exercised it.
- It does **not** settle whether prompt phrasing would move Qwen. The system prompt was held
  identical by design (§ critical rule); testing prompt sensitivity is a separate experiment.
