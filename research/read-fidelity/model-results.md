# Model Results (§16–§17)

Controlled probe, 5 whitespace-sensitive tasks × 2 repeats, **identical tasks and tools**; the only
variable is the line-number separator.

## Gemma 4 31B — decisive

| metric | before (TAB) | after (pipe) | delta |
|---|---:|---:|---|
| tab-sensitive edit success | **2/10** | **10/10** | **+8** |
| `old_string not found` | **48** | **4** | **−44** |
| wrong edits | 0 | 0 | 0 |
| output tokens (mean) | 290 | **90** | **−69%** |
| tool calls (mean) | 5.0 | **1.4** | **−72%** |
| `write` fallbacks | 0 | 0 | 0 |

The 4 residual failures are `edit:ambiguous`, not `not_found` — three identical function bodies
genuinely needing more context. The tool behaving **correctly**, and the model recovering on the
next attempt.

## Qwen 3.6 35B — improves, but not on the headline metric

| metric | before (TAB) | after (pipe) | delta |
|---|---:|---:|---|
| tab-sensitive edit success | **10/10** | **10/10** | 0 |
| `old_string not found` | 4 | **6** | **+2** |
| `edit:ambiguous` | 0 | 2 | +2 |
| **`write` fallbacks** | **4/10** | **0/10** | **−4** |
| output tokens (mean) | 688 | **476** | **−31%** |

**Qwen was already 10/10 with the broken separator.** It does not blindly copy the visible
indentation; it reconstructs the intended text. So the defect never blocked it the way it blocked
Gemma.

What *did* change is how it gets there: it no longer escapes to whole-file `write` (4 → 0) and
costs 31% fewer tokens. Under the old format it worked around the ambiguity; under the new one it
edits directly.

Its `not_found` count rising 4 → 6 is reported rather than smoothed over. With n=10 and a model
whose runs vary, this is inside noise — and it is not the defect's signature, since success and
`write` fallbacks both moved the right way.

## Interpretation

This is a **fidelity fix, not a capability fix**, and the two models show why that distinction
matters:

- Gemma was **blocked** by the corruption → 2/10 becomes 10/10.
- Qwen was **taxed** by it → same success, but 4 write-escapes and 45% more tokens.

Neither model was ever "bad at editing". One was defeated by the representation and the other paid
to route around it. §20's durable note stands: **read representation failure ≠ edit primitive
failure.**

## No incorrect edits (§28.7)

Zero wrong edits in either model, before or after. The fix does not trade correctness for success.
