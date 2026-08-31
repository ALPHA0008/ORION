# Why the Model Chooses `write` — Trajectory Analysis

Every run in `edit-diagnostic.json` where `edit` failed and `write` followed, read from the event
log rather than inferred from aggregates (§2).

## The cases

| task | outcome | edit failures | write bytes | sequence after first edit failure |
|---|---|---:|---:|---|
| `plimit-concurrency-guard` | PASS | 2 | 3,315 | `edit → write → bash` |
| `plimit-error-propagation` | PASS | 2 | 3,294 | `read → edit → write → bash` |
| `plimit-active-count` | PASS | 3 | 3,315 | `edit → bash(cat -A) → edit → write → bash` |
| `slug-overridable-replacements` | PASS | 1 | 134 | `read → write → bash` |
| `slug-lowercase-option` | PASS | 4 | — | `edit ×4 → read → write → bash` |
| `slug-decamelize-acronym` | FAIL | 2 | — | `read → edit → write → bash` |

## What the trajectories show

**The retried `old_string` is byte-identical every time.** After a diagnostic naming
`INDENTATION_MISMATCH`, giving the line number, and rendering the exact bytes with `→`/`·`, the
model resent the same string: `plimit-concurrency-guard` 2/2 identical, `plimit-error-propagation`
2/2, `plimit-active-count` 3/3.

The diagnostic it received was not vague:

```
old_string not found in index.js — it matches at line 19 except that the leading indentation
differs (INDENTATION_MISMATCH).
Lines 19-19 contain exactly (→=tab, ·=space):
→const·resumeNext·=·()·=>·{
Copy that text verbatim as old_string, converting → back to tab and · back to space.
```

## Classification against §2's cases

**Case C ("full-file rewrite is conceptually easier") is refuted by cost.** Output tokens for the
deciding call:

| task | edit attempt | write |
|---|---:|---:|
| `plimit-active-count` | 76 | **946** |
| `plimit-concurrency-guard` | 153 | **946** |
| `plimit-error-propagation` | 309 | **939** |
| `slug-lowercase-option` | 63 | **1,269** |

`write` costs **6–20× more output tokens**. The model is choosing the *far more expensive* route.
That is not convenience — it is escape.

**Case E ("tool description made write look more reliable") is not supported.** `write` is
described in one line with no reliability claim, and `edit` is chosen first in every case.

**Case A ("could have corrected but chose not to") is not supported either** — it did try,
repeatedly, and produced the identical bytes each time. That is inability, not preference.

**Case B is the supported classification: the model could not reliably construct the exact
substring.** The offline probe pins the mechanism precisely, and it is *not* what it appears:

- The model emits tabs **perfectly** — 6/6 in isolation, including converting `→` back to a real
  tab exactly as the diagnostic instructs.
- What it gets wrong is the **tab count**. In the failing case it sent `"\t\t\tactiveCount--;"`
  (3 tabs) where the file has 2.

### The harness caused this

Paged `read` (added in phase 1) renders each line as `N` + **TAB** + content. On a tab-indented
file the separator tab merges with the real indentation into one run:

```
file line   :  \t\tactiveCount--;          (2 tabs)
read renders:  15\t\t\tactiveCount--;      (separator + 2 tabs = a run of 3)
model sends :  \t\t\tactiveCount--;        (3 tabs) → old_string not found
```

The model is reading the display faithfully. The display is lying by one tab.

**The controlled evidence is unambiguous** — identical task, identical instruction, only the
indentation character differs:

| case | result |
|---|---|
| space-indented file | **2/2 correct, 1 tool call each** |
| tab-indented file | **0/2, six consecutive `old_string not found`** |

## Consequences

1. **`write` is a symptom, not a preference.** The model reaches for it only after exhausting
   `edit`, and pays 6–20× more to do so.
2. **This is a harness defect, not a model limitation.** Phase 2 attributed these failures to the
   model reproducing bytes badly. It reproduces bytes fine; our numbered-read format corrupts the
   indentation it is copying from.
3. **The phase-2 conclusion needs qualifying.** "The model prefers `write`" was the wrong reading.
   It falls back to `write` because a harness-induced off-by-one tab makes `edit` unusable on
   tab-indented files — and 3 of our 5 pinned repositories are tab-indented.
4. **The diagnostic could never have worked.** It told the model to copy `→const·resumeNext…`,
   which the model did *correctly* — but it had already anchored on the wrong tab count from the
   numbered read, and the diagnostic's own rendering did not contradict what it believed it saw.

## Integrity check on the writes

Full-file writes did not truncate: `p-limit/index.js` was rewritten at **3,315 bytes — exactly the
original size** — while making a correct semantic fix, and `slugify/overridable-replacements.js`
at 134 vs 139 bytes with tests passing. The model *can* reproduce a whole file faithfully; it
cannot reproduce a short substring's indentation when the display misleads it. That asymmetry is
itself evidence for Case B.
