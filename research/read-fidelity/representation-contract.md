# The `read` Representation Contract (§4)

What `read()` promises the model.

## 1. Line identity

Every source line maps to **exactly one** rendered line. The rendered form is:

```
<right-aligned line number><DELIMITER><source line verbatim>
```

The delimiter is a **single character that cannot appear as leading whitespace**, so the boundary
between the number and the content is unambiguous by construction — not by convention.

## 2. Source content fidelity

Everything after the first delimiter on a rendered line is the source line **byte-for-byte**. No
escaping, no substitution, no normalisation. A model can copy it directly into `edit`'s
`old_string` and it will match.

This is the property that matters most: the representation must be *usable*, not merely
*decodable*. An escaped form (`\t`) or a marker form (`[TAB]`) is reconstructable but requires the
model to decode a convention before it can act — and §7 forbids depending on that goodwill.

## 3. Whitespace fidelity

| character | representation |
|---|---|
| space | itself |
| **tab** | **itself** — no longer merged with the separator |
| blank line | a rendered line with number, delimiter, and nothing after it |
| trailing space | preserved verbatim |

## 4. Newline fidelity

- Lines are split on `\n`.
- A `\r` from a CRLF file remains attached to the end of its line, so the bytes are preserved.
- **`read` never rewrites line endings.** Normalising them would silently break exact editing on
  CRLF files, which is precisely the class of harm this phase exists to remove.

Documented as an intentional property rather than a guarantee of visibility: a lone `\r` is
faithful but not *visually* obvious. See "remaining limitations" in the summary.

## 5. Boundary fidelity

When output is bounded, the model is told where the returned region begins and ends and how to
request the next one:

- header on continuation pages: `[path: lines A-B of N]`
- footer when content remains: `[K more lines. To continue, call read with path="…", offset=B+1]`
- footer at the end of a paged read: `[end of path]`
- sandbox-level truncation is surfaced on **every** page, so it can never be paged out of sight

## 6. What is deliberately NOT promised

- **Not** that the whole file fits in one call. The bound is intentional (§11); paging is the
  retrieval mechanism.
- **Not** that a lone `\r` is visually distinct.
- **Not** that a single line longer than the page budget is returned whole — but such a line is
  always returned rather than dropped, and the omission is explicit.

## Chosen rendering

Measured against the alternatives:

| candidate | bytes | ambiguous? | reconstructable | directly copyable into `edit`? |
|---|---:|---|---|---|
| A0 current (TAB separator) | 51 | **YES** | lossy | no |
| **A pipe delimiter** | **51** | **no** | **EXACT** | **yes** |
| B escaped whitespace (`\t`) | 55 | no | EXACT | no — needs decoding |
| C JSON records | 160 | no | EXACT | no — needs parsing |
| D `[TAB]` markers | 67 | no | EXACT | no — needs decoding |

**Candidate A is chosen**: exact reconstruction, zero ambiguity, **identical byte cost to the
broken format**, and the only option whose content is directly copyable into an exact-match edit.
