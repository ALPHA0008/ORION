# Byte Round-Trip (§8)

Suite: `v0/tests/readfidelity/readfidelity.test.mjs` — **30 assertions**.

Method: `read()` → strip everything up to and including the first `|` on each line → join → compare
to the source bytes.

## Results — exact for every case

| fixture | content | round-trip |
|---|---|---|
| `spaces.js` | 0/2/4-space indentation | **EXACT** |
| `tabs.js` | 1, 2 and 5 tabs | **EXACT** |
| `mixed.js` | tab-then-space, space-then-tab | **EXACT** |
| `trailing.js` | trailing spaces and a trailing tab | **EXACT** |
| `blank.js` | consecutive blank lines | **EXACT** |
| `single.js` | one line | **EXACT** |
| `unicode.js` | `π`, `変数`, `café`, `✓ ☃ 𝟘` | **EXACT** |
| `nonl.js` | no trailing newline | **EXACT** |

Zero unintended loss.

## §13 Unicode

No new encoding subsystem was introduced. The path is a single `buf.toString('utf8')` in
`sandbox.read`, and all subsequent work is on a JS string. Line splitting is on `\n`, and line
numbering counts **lines**, never bytes or UTF-16 units — so multi-byte characters cannot shift
line attribution.

Verified with Latin-1 accents (`café`), Greek (`π`), CJK (`日本語`), symbols (`✓ ☃`) and an
astral-plane character (`𝟘`, a surrogate pair).

## What is intentionally not round-trippable

| case | behaviour | why |
|---|---|---|
| a page smaller than the file | only the returned range reconstructs | the bound is intentional; paging retrieves the rest |
| a file over `MAX_OUTPUT_BYTES` (64 KB) | sandbox truncation marker spliced in | pre-existing bound, surfaced on every page |
| a single line over `READ_PAGE_BYTES` | returned **whole** (not elided), then clamped downstream by `MSG_CLAMP` with a `[+N chars]` notice | pre-existing; a long line is never silently dropped |

None of these were introduced by this change, and all are explicitly announced to the model.
