# Edit Diagnostic — Design

Strategies compared **before** implementing, per brief §6, measured against the one exactly-captured
real failure (`plimit-active-count` vs `p-limit@df476048:index.js`).

## The safety rule that constrains everything

The tool stays **exact**:

```
exact match      → apply
no exact match   → modify NOTHING, return a diagnostic
```

Never nearest-match-and-apply. `old_string` is the `SELF_VERIFYING` precondition (ADR-002/003):
a fuzzy apply would patch text the model never specified *and* break replay's content-addressed
precondition, turning a visible failure into an invisible corruption. The diagnostic changes what
the model is **told**, never what the tool **does**.

## Strategies measured

| strategy | bytes | fits `MSG_CLAMP` (2000) | identifies cause | gives exact bytes |
|---|---:|---|---|---|
| A basic structural (line range + text) | 105 | yes | no | no |
| B whitespace-aware | 172 | yes | **yes** | **yes** |
| C similarity only (line range) | 62 | yes | no | no |
| D content hash (requested vs actual) | 100 | yes | no | no |
| **E combined minimal** | **239** | **yes** | **yes** | **yes** |
| X whole file | **3,363** | **NO** | no | no |

### Why E

It is the only option that answers both questions the model actually has — *why did it fail* and
*what exactly should I send instead* — while costing **12% of the message clamp**:

```
old_string not found in index.js — matches at line 27 except for whitespace.
The file has exactly (→=tab, ·=space):
→const·next·=·()·=>·{
→→activeCount--;
Copy that text verbatim (converting → back to tabs) as old_string.
```

The `→`/`·` rendering is the crux. Phase 2 established that **9 of 11 failing runs did re-read the
file** and still resent a byte-inequivalent string, because ordinary output renders a leading tab
indistinguishably from spaces. Making whitespace *visible* is the one thing re-reading could not
provide.

### Why the others were rejected

- **A / C** — locate the region but never say the mismatch is whitespace, leaving the model to
  guess exactly what it already guessed wrong.
- **D** — hashes prove *that* the text differs, never *how*. Unactionable for a model that cannot
  invert a hash.
- **X (whole file)** — 3,363 bytes exceeds `MSG_CLAMP`, so it would be **clamped to 2,000 and
  truncated**, reintroducing the invisibility this exists to remove. It is also the exact shape of
  brief §17 Case B: succeeding by dumping so much source that the diagnostic does the model's job.

## Bounded by construction

| bound | value | rationale |
|---|---:|---|
| max candidate lines shown | 8 | a patch region, never a file |
| max diagnostic bytes | 1,200 | hard cap, well under `MSG_CLAMP` |
| whole-file dump | **never** | §7, and it would be clamped anyway |

If no whitespace-insensitive candidate exists, the diagnostic must say *that* plainly rather than
invent a nearest match — `WRONG_REGION` is a real and useful answer.

## Classification reported to the model

Only classes the corpus can distinguish from actual bytes:

| class | meaning |
|---|---|
| `INDENTATION_MISMATCH` | identical once leading indentation is stripped |
| `WHITESPACE_MISMATCH` | identical once whitespace runs are collapsed |
| `EOL_MISMATCH` | differs only in line endings |
| `WRONG_REGION` | no line of `old_string` appears in the file at all |
| `NEARBY_CONTEXT_MISMATCH` | some lines present, surrounding context differs |
| `UNKNOWN` | none of the above — say so rather than guess |

`TAB_SPACE_MISMATCH` is deliberately **not** a separate reported class: leading-indent
normalisation subsumes it, and both point the model at the same fix. One fewer label the model can
misread.

## Designed side-benefit — a real corpus next time

The diagnostic classifies at failure time, so the class lands in the `tool.failed` event. The
current corpus has exact bytes for **1 of 62** errors because per-run stores are temporaries; after
this change every future edit failure is classified in the durable log. The next run of this
experiment gets a byte-level census instead of one case.

## What is explicitly not changed

`old_string`/`new_string` signature · exact-match semantics · ambiguity (`n > 1`) handling —
**0 ambiguity errors in 62 failures**, so that path is not the problem · `SELF_VERIFYING` recovery
class and precondition · the event model, projection, leases, fencing, replay, or worker.
