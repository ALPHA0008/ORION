# Edit-Failure Corpus

Every `old_string not found` observed in the committed real-repository trajectories, plus what can
and cannot be recovered about each.

Built by [`eval/real/setup/edit-corpus.mjs`](../../eval/real/setup/edit-corpus.mjs); raw output in
[`eval/real/reports/edit-failure-corpus.json`](../../eval/real/reports/edit-failure-corpus.json).

## Corpus size

| | |
|---|---:|
| runs containing at least one `old_string not found` | **18** |
| — of which **recovered** (task PASSED) | **8** |
| — of which failed | 10 |
| total `old_string not found` errors | **62** |
| total **ambiguity** (`n > 1`) errors | **0** |

**Zero ambiguity errors in 62 edit failures.** The `n > 1` path is not the problem and will not be
touched.

## By task

| task | runs | recovered | not-found errors |
|---|---:|---:|---:|
| `camel-preserve-consecutive` | 7 | **0** | 25 |
| `plimit-active-count` | 4 | 2 | 17 |
| `slug-lowercase-option` | 1 | 0 | 5 |
| `plimit-validate-concurrency` | 1 | 1 | 4 |
| `slug-preserve-conflict` | 1 | 1 | 3 |
| `plimit-concurrency-guard` | 1 | 1 | 3 |
| `plimit-error-propagation` | 1 | 1 | 3 |
| `camel-leading-capital` | 1 | 1 | 1 |
| `slug-overridable-replacements` | 1 | 1 | 1 |

**9 distinct tasks** — broader than the 5 estimated in phase 2, because the corpus now includes
passing runs that hit the error and recovered.

## The discriminator: what happens on the *next* action

The three actions immediately following the first `old_string not found`:

| outcome | dominant pattern | n |
|---|---|---:|
| **PASS** | `read → edit → bash` | 7 of 8 |
| **FAIL** | `read → edit → edit` | 6 of 10 |

Both populations re-read. Both then re-edit. The difference is **whether that second edit lands**:
a passing run proceeds to `bash` (verify), a failing run issues yet another `edit`.

This kills the intuitive explanation ("failing runs don't re-read") and localises the problem
precisely: re-reading happens, and it *does not supply what is needed to fix the string*.

## Mismatch classification

### The one exactly-captured failure

`explain` truncates tool arguments, and per-run event stores are temporaries that no longer exist,
so the exact `old_string` bytes are recoverable for only one case — captured during phase 2 by
reading the trajectory before its store was destroyed.

`plimit-active-count`, verified against `p-limit@df476048:index.js`:

```
sent:  "\t\tconst next = () => {\n\t\t\tactiveCount--;"
file:  ";\n\n\tconst next = () => {\n\t\tactiveCount--;\n\t\t"
       → INDENTATION_MISMATCH: identical once leading indentation is stripped
```

**One tab in the file; two in the request.** The patch was semantically correct.

### Reachability of each class over the affected real files

Since per-request bytes are unavailable for the other 61 errors, the corpus instead measures which
mismatch classes are *reachable* over the real affected files, by perturbing genuine snippets the
way a model plausibly would:

| perturbation | classifier output | files tested |
|---|---|---|
| add one indent level | `INDENTATION_MISMATCH` | 3/3 correct |
| tabs → spaces | `INDENTATION_MISMATCH` | subsumed (see note) |
| LF → CRLF | `EOL_MISMATCH` | 3/3 correct |
| collapse ` = ` → `=` | `WHITESPACE_MISMATCH` / `UNKNOWN` | 1 correct, 2 UNKNOWN |
| non-existent function | `WRONG_REGION` | 3/3 correct |

Note: `TAB_SPACE_MISMATCH` reports as `INDENTATION_MISMATCH` because leading-indent normalisation
is tested first and subsumes it. Harmless for the purpose at hand — both point the model at
whitespace — but recorded so the label is not over-read.

`UNKNOWN` on two interior-whitespace cases is the classifier correctly declining to guess: those
snippets contain no ` = ` to collapse, so the perturbation was a no-op and the string genuinely is
present. **The classifier does not manufacture a category when the bytes do not support one.**

### Honest limits of this classification

- **1 of 62 errors is classified from actual sent bytes.** The rest are characterised by what is
  *reachable* over the same files, not by what the model actually sent.
- The corpus therefore supports "indentation/whitespace mismatch is the demonstrated cause in the
  one case where we have bytes, and is readily reachable in the others" — **not** "N% of failures
  were whitespace".
- To fix this permanently, the diagnostic itself should record the classification into the event
  log at failure time. That is a designed side-benefit of the intervention, and it means the next
  run of this experiment will have a full byte-level corpus rather than one case.

## Categories NOT observed

Recorded to keep the taxonomy evidence-bound: `STALE_SOURCE_ASSUMPTION` (no run edited a file
that had changed under it), `WRONG_FILE` (every failing edit targeted a file that exists at the
pin), and ambiguity (`n > 1`, zero occurrences).
