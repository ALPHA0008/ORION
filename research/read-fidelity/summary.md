# Phase 8 Summary — `read` Fidelity

## Defect

The `read` line-number separator was a **TAB**, so it merged with source indentation into a single
run:

```
file    : "\t\treturn 1;"        (2 tabs)
rendered: "3\t\t\treturn 1;"     (a run of 3 — separator + 2)
```

A model copying the visible indentation emitted **one tab too many**, so every exact-match `edit`
on a tab-indented file failed with `old_string not found`.

## Root cause

`v0/src/agent/tools/index.mjs`, one line:

```js
const line = `${String(i).padStart(width)}\t${lines[i - 1]}`;
```

The separator was inside the same alphabet as the content it was separating. Everything else in
the path was already faithful — a single UTF-8 decode, split on `\n`, no re-encode.

**The harness created the problem and then attributed it to the model.** It produced a false
diagnosis that the `edit` primitive was weak.

## Fix

```js
const LINE_NO_SEP = '|';
const line = `${String(i).padStart(width)}${LINE_NO_SEP}${lines[i - 1]}`;
```

One character. Chosen by measurement over four alternatives (ADR-012): escaping (`\t`) and markers
(`[TAB]`) are reconstructable but require the model to **decode a convention before it can act**,
and are themselves ambiguous for source that literally contains those characters; JSON records
cost **+214%** bytes. The chosen form costs **exactly the same as the broken one** and is the only
option whose rendered content copies verbatim into `edit(old_string, …)`.

## Fidelity — guaranteed invariants

Everything after the **first** delimiter on a rendered line is the source line **byte-for-byte**.
Verified by byte round-trip, not inspection:

| property | result |
|---|---|
| tabs (1, 2, 5) | **exact** |
| spaces, mixed tab/space, trailing whitespace | **exact** |
| blank lines (number + delimiter, nothing after) | **exact** |
| Unicode — Latin-1, Greek, CJK, symbols, astral pair | **exact** |
| file with no trailing newline | **exact** |
| CRLF | `\r` preserved; `read` never rewrites line endings |
| line identity | one source line ↔ one rendered line |

## Paging

**26 passed, 0 failed.** Only the tests' own regexes changed (`(\d+)\t` → `(\d+)\|`) — they were
coupled to the separator. No paging behaviour was modified. The full 400-line file still
reconstructs exactly by paging, with no gaps and no unintended overlap.

`MSG_CLAMP` (2,000), `WINDOW` (40) and `READ_PAGE_BYTES` (1,500) are **unchanged** (§11). The bound
was never the bug.

## Gemma 4 31B

| metric | before | after |
|---|---:|---:|
| tab-sensitive edit success | **2/10** | **10/10** |
| `old_string not found` | **48** | **4** (all `ambiguous`, none `not_found`) |
| output tokens | 290 | **90** (−69%) |
| tool calls | 5.0 | **1.4** (−72%) |
| wrong edits | 0 | **0** |

## Qwen 3.6 35B

| metric | before | after |
|---|---:|---:|
| tab-sensitive edit success | 10/10 | 10/10 |
| **`write` fallbacks** | **4/10** | **0/10** |
| output tokens | 688 | **476** (−31%) |
| `old_string not found` | 4 | 6 |

**Qwen was already 10/10 with the broken separator** — it reconstructs intended text rather than
blindly copying indentation, so the defect never blocked it. What changed is *how* it succeeds: it
no longer escapes to whole-file `write`, at 31% lower cost.

Its `not_found` rising 4 → 6 is reported rather than smoothed: with n=10 it is inside noise, and it
is not the defect's signature, since success and `write` fallbacks both moved the right way.

**The two models show why this is a fidelity fix, not a capability fix.** Gemma was *blocked* by
the corruption; Qwen was *taxed* by it. Neither was ever bad at editing.

## Real-repository benchmark

16 of 22 tasks completed in the available windows:

| | baseline | after |
|---|---:|---:|
| passing | 11/16 | **14/16** |
| improved | — | **3** |
| **regressed** | — | **0** |

`camelcase` 4/7 → **6/7**, `p-limit` 3/4 → **4/4**, `slugify` 2/5 → **4/5** — all tab-indented.

Newly passing: `camel-preserve-consecutive` (**STABLE_FAILURE 0/3 in every prior phase**),
`camel-leading-capital`, `slug-decamelize-acronym`. All three previously failed with
`old_string not found` on tab-indented files — the defect's exact signature. Attribution is by
mechanism, not by score (§19).

## Regression

**566 passed, 0 failed across 21 suites** (was 536/20). Unchanged: `fencing` 29, `replay` 44,
`crash/matrix` 6, `recovery` 53, `concurrency/lease` 51, `writewitness` 26, and all three
escalation-gate suites.

## Performance

447 µs per rendered page. **Byte cost identical** — one separator character either way. No token
overhead was traded for fidelity.

## Remaining limitations

- **CRLF is faithful but not visually obvious.** A lone `\r` is preserved byte-exactly; it is not
  rendered distinctly. Normalising it would silently break exact editing on CRLF files, which is
  the same class of harm this phase removes.
- **A single line longer than `READ_PAGE_BYTES` is returned whole**, then clamped downstream by
  `MSG_CLAMP` with an explicit `…[+N chars in the event log]` notice. Pre-existing; the line is
  never silently dropped and the bytes stay retrievable.
- **Files over `MAX_OUTPUT_BYTES` (64 KB)** carry the sandbox truncation marker, surfaced on every
  page. Pre-existing.
- `|` can appear inside source. Harmless: the contract is "after the **first** delimiter", and the
  number field before it contains only digits and spaces.

## Decision: **READ_FIDELITY_FIXED**

All ten §28 criteria met: the TAB defect is eliminated; byte-relevant whitespace is unambiguous;
paging works; `MSG_CLAMP`/`WINDOW` enforced unchanged; `read → edit` works on tab-indented files;
both models consume the representation correctly; **no incorrect edits introduced**; full
regression green; recovery/replay/fork/fencing green; real-repository capability improved with
**zero regressions**.

## The durable note (§20)

> **read representation failure ≠ edit primitive failure.**

The earlier hypothesis that `edit` was weak is refuted and stays refuted. This phase closes the
last known input-fidelity defect: the harness must never make the model solve a problem the
harness itself created.
