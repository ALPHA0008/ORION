# Architectural Implications (§19)

**No architecture change is made here.** This records what the model swap did and did not
implicate.

## Which failures survived the model swap?

### 1. `ask_user` is never called — **survived, identically**

| | Gemma | Qwen |
|---|---|---|
| escalations where correct | 0/4 | **0/4** |
| false escalations on the control | 0/2 ✅ | **0/2** ✅ |

Not just the same counts — the same *behaviour*. On the blocked-credential scenario both models
independently **edited the test to inject `'live_test_key'`** and reported success. Two unrelated
model families converged on the identical fabrication.

Per §20 (Model A struggles AND Model B struggles AND reproducible AND same mechanism):
**all four conditions hold.** This is now the strongest harness/policy candidate in the project.

### 2. "Diagnose but don't act" (stage 5) — **survived, in different clothing**

Of the 6 tasks neither model solved, **3 had zero edit attempts from Gemma as well**. Gemma labels
it `no_progress`, Qwen labels it `no_edits_made`, but the event is the same: a correct analysis
that never becomes a mutation.

Qwen shows it undisguised (19/19 failures); Gemma's version was previously masked behind
byte-level edit failures.

## Which failures disappeared?

### `old_string not found` — **HARNESS-SPECIFIC, confirmed**

Gemma 19, **Qwen 0**. Phase 3 traced this to our paged `read` rendering `N` + TAB + content, so
tab indentation merges with the separator. Qwen rarely reaches the byte-reproduction step, so it
never triggers it.

This does **not** retire the finding — the rendering defect is real and still unfixed. It confirms
the attribution: a harness defect whose *expression* depends on how hard a model tries to edit.

### `write` fallback — **MODEL-SPECIFIC**

Gemma 8 calls, **Qwen 0**. Phase 3 read Gemma's escape-to-`write` as possible evidence the `edit`
primitive was wrong. Qwen never falls back, which further supports phase 3's
`KEEP_EXISTING_EDIT` decision.

### Provider shimming — **ADAPTER-SPECIFIC**

Gemma 343 `degraded` events, **Qwen 0**. A serving-configuration difference (vLLM started without
a tool-call parser), not a model-quality verdict.

## Which failures appeared?

### Absolute-path assumptions — **MODEL-SPECIFIC**

28 `path escapes sandbox` denials across 14 of 22 Qwen runs; **0 for Gemma**. Qwen searched
`/home/user`, `/`, `/tmp`, and addressed files as `/testbed/index.js`.

**Containment held on every attempt**, verified by executing the exact paths. The security
property is sound; the capability cost is that Qwen wasted turns on denied paths.

This is worth recording as a portability observation: a harness whose workspace convention differs
from a model's training assumptions will lose turns, even with a correct sandbox.

## Strength of evidence for harness change

| finding | Gemma | Qwen | verdict |
|---|---|---|---|
| **no escalation under ambiguity** | fails | fails | **strong harness/policy candidate** |
| **diagnosis not converted to action** | fails | fails | **strong candidate**, mechanism needs sharper isolation |
| `read` TAB separator | fails | n/a | **confirmed harness defect** (phase 3), unfixed |
| `write` recovery misclassification | n/a | n/a | **confirmed runtime defect** (phase 4), model-independent by construction |
| `edit` primitive inadequate | refuted | refuted | **REFUTED** — Qwen uses `edit` cleanly when it acts |
| context strategy limiting | no evidence | no evidence | **unsupported** — Qwen has an 8× window and does *worse* |
| planning limiting | no evidence | no evidence | **unsupported** |

## The context result deserves emphasis

Qwen has **262,144 tokens** of context against Gemma's **32,768** — 8× more — and scored
**13.6% vs 68.2%**. Whatever limits this harness, it is not the context window. That is the
clearest negative result of the experiment, and it further weakens the "context strategy is the
bottleneck" hypothesis that a feature-driven roadmap would reach for.

## What must NOT be concluded

- Not "Gemma is better." Qwen's failures are refusals to act, not wrong analyses; its diagnoses
  were frequently correct and its duplicate-action rate is 100× lower.
- Not "Qwen is a better tool caller." That is an **adapter** difference in serving configuration.
- Not any latency or token comparison — different stacks, different quantization, and Qwen emits
  `thinking` tokens.
