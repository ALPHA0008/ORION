# Model A vs Model B — Primary Comparison (§7)

Same 22 real-repository tasks, same commits, same tools, same prompts, same verifiers, same
runner. **Only the model changed.** No code was modified.

Raw: [`gemma-model-b.json`](../../eval/real/reports/gemma-model-b.json),
[`qwen-model-b.json`](../../eval/real/reports/qwen-model-b.json).

## Headline

| Metric | Gemma 4 31B | Qwen 3.6 35B | Delta | Interpretation |
|---|---:|---:|---|---|
| **Overall success** | **15/22 (68.2%)** | **3/22 (13.6%)** | −54.6 pts | dominated by one failure mode, not by wrong reasoning |
| Easy | 3/4 | 2/4 | −1 | |
| Medium | 8/10 | 1/10 | −7 | |
| Hard | 4/8 | 0/8 | −4 | |
| `edit` calls | 46 | **3** | −43 | Qwen barely attempts edits |
| `write` calls | 8 | **0** | −8 | Qwen never falls back to `write` |
| `old_string not found` | 19 | **0** | −19 | Qwen never reaches the byte-reproduction step |
| **`no_edits_made` failures** | **1** | **19** | +18 | **the entire Qwen gap** |
| model calls | 343 | 170 | −173 | Qwen stops early |
| tool calls | 323 | 202 | −121 | |
| duplicate action rate | 0.268 | **0.002** | −0.266 | Qwen essentially never loops |
| `degraded` events | **343** | **0** | −343 | **adapter effect**, not model quality |
| `ask_user` calls | **0** | **0** | 0 | **identical** |
| p50 / p95 wall | 35 s / 130 s | 54 s / 181 s | — | not comparable (different stacks) |

**A higher score is not automatically "better."** Qwen's failures are overwhelmingly refusals to
act, not incorrect analyses — several of its `no_edits_made` runs contain a fully correct
diagnosis.

## Failure classes

| class | Gemma | Qwen |
|---|---:|---:|
| `no_edits_made` | 1 | **19** |
| `no_progress` | 5 | 0 |
| `budget_exhausted` | 1 | 0 |

Gemma's failures are **varied**; Qwen's are **one thing, 19 times**.

## Task-level differential (§16)

| group | n | tasks |
|---|---:|---|
| **both PASS** | 2 | `isnum-string-trim`, `slug-preserve-conflict` |
| **Gemma only** | 13 | most of the medium/hard set |
| **Qwen only** | 1 | `isnum-nan-guard` |
| **neither** | 6 | `ansi-brightness-bit`, `camel-leading-capital`, `camel-numbers-identifier`, `camel-preserve-consecutive`, `slug-decamelize-acronym`, `slug-trailing-separator` |

### The 6 shared failures are the important row

| task | Gemma | Qwen |
|---|---|---|
| `ansi-brightness-bit` | `no_progress`, **0 edits** | `no_edits_made`, 0 edits |
| `camel-leading-capital` | `no_progress`, **0 edits** | `no_edits_made`, 0 edits |
| `camel-numbers-identifier` | `no_edits_made`, **0 edits** | `no_edits_made`, 0 edits |
| `camel-preserve-consecutive` | `no_progress`, 9 edits | `no_edits_made`, 0 edits |
| `slug-decamelize-acronym` | `no_progress`, 2 edits | `no_edits_made`, 0 edits |
| `slug-trailing-separator` | `budget_exhausted`, 10 edits | `no_edits_made`, 0 edits |

**On 3 of 6, Gemma also made zero edits.** Different labels (`no_progress` vs `no_edits_made`),
same underlying event: the agent analysed the problem and never issued a mutation.

## Cost

Not compared. Both models are self-hosted with no configured pricing; §6 says do not compare cost
unless pricing is actually known.

## Confounds that must travel with these numbers

| variable | Gemma | Qwen |
|---|---|---|
| architecture | dense 31B | **MoE 35.5B** |
| quantization | NVFP4 | **Q4_K_M** |
| serving stack | vLLM (remote) | **Ollama (local)** |
| context window | 32,768 | **262,144** |
| `thinking` output | no | **yes** — inflates output tokens |

Latency and token comparisons are **not meaningful** across these stacks. Behavioural comparisons
(tool choice, escalation, edit/write) remain valid because the harness, tasks, prompts, tools and
verifiers were held identical.
