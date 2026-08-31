# ADR-012 — the `read` line-number delimiter must not be whitespace

**Status:** accepted
**Relates to:** ADR-001 (bounded projection). Does **not** change any bound.

## Context

Paged `read` rendered each line as `<number><TAB><content>`. On tab-indented files the separator
merged with the source indentation into a single run:

```
file    : "\t\treturn 1;"        (2 tabs)
rendered: "3\t\t\treturn 1;"     (a run of 3 — separator + 2)
```

A model copying the visible indentation emitted **one tab too many**, so every exact-match `edit`
on a tab-indented file failed with `old_string not found`.

Measured A/B, identical task and model, only the separator changed:

| separator | correct | `old_string not found` | mean out-tokens |
|---|---:|---:|---:|
| TAB | **2/10** | 48 | 290 |
| pipe | **10/10** | 4 (all `ambiguous`, none `not_found`) | 90 |

This produced a **false diagnosis** that the `edit` primitive was weak. It was not. Three of the
five pinned benchmark repositories are tab-indented, which is why it dominated the failure data.

## Decision

The line-number delimiter is a single character that **cannot occur as leading whitespace**:

```js
const LINE_NO_SEP = '|';
const line = `${String(i).padStart(width)}${LINE_NO_SEP}${lines[i - 1]}`;
```

Contract: **everything after the first delimiter on a rendered line is the source line
byte-for-byte.** No escaping, no substitution, no normalisation.

## Alternatives rejected

| candidate | bytes | why not |
|---|---:|---|
| escaped whitespace (`\t`) | +8% | reconstructable but not **usable** — the model must decode before it can act; also ambiguous for source that literally contains `\t` |
| `[TAB]` markers | +31% | same decoding burden, same self-ambiguity |
| JSON line records | **+214%** | unambiguous but triples the cost, shrinking how much source fits inside the unchanged `MSG_CLAMP` |

The chosen form costs **exactly the same bytes as the broken one** and is the only option whose
rendered content can be copied verbatim into `edit(old_string, …)`.

## Consequences

- Byte round-trip is exact for tabs, spaces, mixed indentation, trailing whitespace, blank lines,
  Unicode, and files without a trailing newline.
- `MSG_CLAMP` (2,000) and `WINDOW` (40) are **unchanged**. The bound was never the bug.
- `edit`, `write`, recovery, escalation, replay, fork and fencing are untouched.
- Model view and event truth remain a single representation: `tool.succeeded.result` is both what
  is logged and what the projection shows, so the two cannot diverge.
- CRLF is preserved rather than normalised — normalising would silently break exact editing on
  CRLF files.

## Durable note

**read representation failure ≠ edit primitive failure.** The harness must not make the model
solve a problem the harness created.
