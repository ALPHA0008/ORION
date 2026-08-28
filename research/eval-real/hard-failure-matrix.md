# Hard-Failure Matrix

Every remaining hard failure decomposed to the **first stage at which the run became
unrecoverable**, per brief §11–12. Categories were assigned from trajectories, not from aggregate
metrics, and no category was invented without evidence.

## Stage model

```
1 understand task   2 locate files      3 read context     4 form hypothesis   5 select edit
6 apply edit        7 run verification  8 interpret failure 9 revise           10 complete
```

## The matrix

| Task | Repeat pattern | First failure stage | Root cause | Model-specific? | Harness-related? | Candidate intervention |
|---|---|---|---|---|---|---|
| `plimit-active-count` | 0/3 STABLE_FAILURE | **6 apply-edit** | correct patch rejected: file has 1 tab, agent sent 2; `old_string not found` gives no diagnostic | unknown | **yes** — tool feedback | edit failure should report *why* (whitespace/indent mismatch) and show the nearest actual text |
| `slug-lowercase-option` | 0/3 STABLE_FAILURE | **6 apply-edit** ×1, **9 revise** ×2 | same indent mismatch; then burns 40 turns at 305k tokens revising | unknown | **yes** — tool feedback | same as above |
| `ansi-brightness-bit` | 0/3 STABLE_FAILURE | **5 select-edit** | ran a correct `node -e` simulation, got a stable answer (`37`), re-ran the **identical probe 4×**, never edited | unknown | partly — no_progress is correct but late | make repeated-identical-observation visible to the agent before it is fatal |
| `camel-numbers-identifier` | 1/3 HIGH_VARIANCE | **5** ×1, **6** ×1 | run#0: 17 consecutive reads, 0 edits; run#2: 15 edits, 8 × `old_string not found`, out of turns | unknown | **yes** — tool feedback | same as above |
| `slug-decamelize-acronym` | 1/3 HIGH_VARIANCE | **5** ×1, **6** ×1 | run#1: correct `node -e` probe returned `APIs -> AP Is` (the right diagnosis), re-ran identically 4× | unknown | partly | same as above |
| `camel-preserve-consecutive` | provisional STABLE_FAILURE | 9 revise | consistently exhausts 40 turns at ~320k tokens | unknown | no | out of scope this phase |
| `camel-identifier-endanchor` | **3/3 STABLE_SUCCESS** | — | — | — | — | none — phase-1 recorded this as a failure; it was a sampling artifact |
| `plimit-error-propagation` | **3/3 STABLE_SUCCESS** | — | — | — | — | none |

## First-failure stage distribution (13 failing runs)

| stage | count | share |
|---|---:|---:|
| **6 apply-edit** | 6 | 46% |
| **5 select-edit** | 5 | 38% |
| 9 revise | 2 | 15% |
| 1 understand / 2 locate / 3 read-context / 4 hypothesis | **0** | **0%** |

**No failure originates before stage 5.** The agent reliably understands the task, finds the right
files, reads sufficient context, and forms a workable hypothesis. **84% of failures occur at the
transition from knowing what to change to actually changing it.**

That is a much narrower target than "hard tasks are hard", and it is exactly what §11 asked for.

## Is G-03 one problem? — No, it is two

Phase 1 loosely grouped the hard-task gap as "regex semantics / acronym splitting / rule
interaction". The trajectories say the *subject matter* is irrelevant; the **mechanism** splits
cleanly in two.

### G-03a — Edit application failure (stage 6, 6 runs, 46%)

The agent has the correct patch and cannot land it. Every instance is `old_string not found`;
**zero** are ambiguity errors. The measured cause on `plimit-active-count` is exact:

```
file:  \tconst next = () => {\n\t\tactiveCount--;
agent: \t\tconst next = () => {\n\t\t\tactiveCount--;
```

One tab versus two. The patch was semantically perfect.

**Critically, re-reading does not fix this.** Of 11 failing runs that hit an edit failure,
**9 did re-read the file first** — re-reading is not the differentiator. Paged `read` output
renders a leading tab indistinguishably from spaces, so the agent re-reads, perceives no
discrepancy, and re-sends a byte-inequivalent string.

Failed edits are not fatal in themselves: **6 runs in the 22-task set hit `old_string not found`
and still passed.** They become fatal only when the agent cannot determine *why* the match failed.

This is **harness-attributable**: a tool that rejects input without explaining the rejection.

### G-03b — Diagnosis not converted into action (stage 5, 5 runs, 38%)

The agent reaches a correct diagnosis and never acts on it. Two independent instances:

- `slug-decamelize-acronym#1` — ran `node -e` on the regex, got `APIs -> AP Is` (the correct
  finding), then re-ran the identical probe 4× and died with **zero edits**.
- `ansi-brightness-bit` — all 3 runs ran a correct `ansi256ToAnsi` simulation returning a stable
  `37`, then re-ran the identical probe 4× with **zero edits**.

This is not a context problem (they had the file), not a locating problem (they found it), and not
a reasoning problem (the diagnosis was right). It is a failure to move from observation to action.

Whether this is model-specific is **unresolved** without Model B, and it is closely related to the
escalation finding: on both the escalation probe and here, the agent *verbalises* the right
conclusion and then fails to take the corresponding step.

## What the two share — and why that matters

Both sub-problems terminate the same way: **the agent repeats an identical action that already
returned an identical result.** `no_progress` catches this correctly (ADR-006 working as designed)
but only after the budget is spent, and the agent receives no signal beforehand that it is
repeating itself.

That is the common thread. It does **not** license a single vague abstraction called
"better reasoning" — §13 explicitly forbids that. G-03a is a tool-feedback defect with a concrete
fix; G-03b is a policy/loop-visibility question that still needs a distinguishing experiment.

## Root causes NOT observed

Listed to keep the taxonomy evidence-bound: insufficient context, wrong search, wrong file,
misread specification, long-horizon drift, verifier artifact, runtime limitation. **None** of these
appear as a first-failure cause in any hard failure after paging was added.
