# Offline Interface Experiment

Controlled comparison (§4–§7). The editing task is **identical** across interfaces; only the tool
surface differs. Experimental interfaces exist **only** in
[`eval/real/setup/interface-probe.mjs`](../../eval/real/setup/interface-probe.mjs) — nothing is
wired into the production runtime.

Raw: [`interface-probe.json`](../../eval/real/reports/interface-probe.json),
[`interface-probe-pipe.json`](../../eval/real/reports/interface-probe-pipe.json).

## Cases

5 cases × 2 repeats, deliberately spanning easy → hard so "edit is inconvenient" can be separated
from "the model just prefers write":

| case | difficulty | what it probes |
|---|---|---|
| `easy-unique-spaces` | easy | unique exact substring, **space**-indented (§6 control) |
| `easy-unique-tabs` | easy | the identical task, **tab**-indented |
| `hard-tabs-multiline` | hard | multi-line change in tab-indented source |
| `hard-repeated-regions` | hard | three near-identical functions; only the middle must change |
| `hard-long-file` | hard | 40-line function, target at the end |

## Results

| configuration | correct | edit failures | writes | mean out-tokens | mean calls |
|---|---:|---:|---:|---:|---:|
| **A** `old_string/new_string`, **TAB** separator (production) | **2/10** | 48 | 0 | 295 | 5.0 |
| **A** `old_string/new_string`, **pipe** separator | **10/10** | 4 | 0 | **90** | **1.4** |
| **C** `edit_range(start,end,replacement)` | **10/10** | **0** | 0 | 169 | 1.5 |
| **B** `patch(diff)` | 3/10 | 43 | 1 | 391 | 4.6 |

## The finding: it was never the primitive

The §6 control split the population immediately — identical instruction, identical target line,
only the indentation character differing:

| | result |
|---|---|
| space-indented file | **2/2 correct, one tool call each** |
| tab-indented file | **0/2, six consecutive `old_string not found`** |

### Isolating the mechanism

A dedicated probe ([`tab-probe.mjs`](../../eval/real/setup/tab-probe.mjs)) asked the model to emit
literal tabs in a tool argument:

| prompt | result |
|---|---|
| "exactly one TAB then `const x = 1;`" | `"\tconst x = 1;"` — **correct**, 2/2 |
| "copy this line, → marks a real tab" | `"\tconst resumeNext = () => {"` — **correct**, 2/2 |
| "exactly two TABs then `activeCount--;`" | `"\t\tactiveCount--;"` — **correct**, 2/2 |

**The model emits tabs perfectly, 6/6** — including converting `→` back to a tab exactly as the
phase-2 diagnostic instructed.

Capturing the exact bytes in the failing case shows what it actually gets wrong:

```
model sent : "\t\t\tactiveCount--;"   (3 tabs)
file has   : "\t\tactiveCount--;"     (2 tabs)
```

**It miscounts the depth by exactly one — and the harness is why.** Paged `read` (phase 1) renders
each line as `N` + **TAB** + content. On tab-indented files the separator merges with the real
indentation into a single run. Verified against the production tool:

```
file    : "\t\treturn 1;"                (2 tabs)
read()  : "3\t\t\treturn 1;"             (separator + 2 = a run of 3)
```

The model reads the display faithfully. **The display is off by one tab.**

### The controlled proof

Changing only the separator — `N` + TAB → `N` + ` | ` — with the same tool, model, and tasks:

**2/10 → 10/10.** Edit failures 48 → 4. Output tokens 295 → 90. Tool calls 5.0 → 1.4.

The 4 residual failures are `ambiguous` (not `not_found`) on `hard-repeated-regions`, where three
identical function bodies genuinely need more context — the tool behaving **correctly**, and the
model recovering on the next attempt in both repeats.

## Reinterpreting the earlier results

- **`edit_range` scoring 10/10 is real but not the win it appears.** It succeeds because line
  numbers are immune to the rendering bug — it *dodges* the defect rather than being a better
  primitive. Corrected interface A matches it on correctness and beats it on tokens (90 vs 169).
- **`patch(diff)` scores 3/10 for the same reason A did**: unified diffs require reproducing
  context lines byte-exactly, so it inherits the identical corruption, and costs the most (391).
- **Phase 2's "the model prefers `write`" was wrong.** It escapes to `write` only after `edit`
  becomes unusable, paying 6–20× more output tokens to do so.
- **The phase-2 diagnostic could not have worked.** It correctly told the model to copy
  `→const·resumeNext…`, and the model did copy it correctly — but it had already anchored on the
  wrong tab count, and nothing in the diagnostic contradicted the corrupted view it was working from.

## Limits

One model, 5 cases, 2 repeats, synthetic sources shaped after the real repositories. Enough to
localise a mechanism to the byte and demonstrate a clean 2/10 → 10/10 switch under a single
controlled change; **not** enough to rank primitives in general. Whether other models share the
tab-run confusion is unknown — Experiment B is still blocked.
