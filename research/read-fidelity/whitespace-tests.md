# Adversarial Whitespace (§12) and Long Lines (§14)

## Whitespace matrix — all byte-exact

| case | source | rendered body | exact? |
|---|---|---|---|
| no indent | `zero` | `zero` | ✅ |
| one tab | `\tone` | `\tone` | ✅ |
| two tabs | `\t\ttwo` | `\t\ttwo` | ✅ |
| **five tabs** | `\t\t\t\t\tfive` | 5 tabs | ✅ |
| tab then spaces | `\t  tabThenSpaces` | identical | ✅ |
| spaces then tab | `  \tspacesThenTab` | identical | ✅ |
| trailing spaces | `trailing   ` | identical | ✅ |
| blank line | `` | number + `\|` + nothing | ✅ |
| empty file | `` | `1\|` | ✅ (no throw) |

A blank line still carries its number, so line identity is never lost.

## The historical defect, directly asserted

The suite reproduces the **old** rendering and shows the copy is byte-inequivalent:

```
old copy = "\t\t\treturn 1;"  (3 tabs)
source   = "\t\treturn 1;"    (2 tabs)
new copy = "\t\treturn 1;"    (2 tabs)  ← matches
```

## CRLF (§4)

`\r` is preserved on the line, because splitting is on `\n` only. `read` **never rewrites line
endings** — normalising them would silently break exact editing on CRLF files, which is the same
class of harm this phase exists to remove.

Faithful, but noted as a limitation: a lone `\r` is byte-correct yet not *visually* obvious.

## Long lines (§14)

A 5,000-character line is **returned whole**, attributed to its line number, and never silently
altered:

```
over-long line is returned, not dropped        ok
it is still attributed to its line number      ok
page is 5,091 bytes
```

That page exceeds `MSG_CLAMP` and is clamped downstream by the projection, which appends an
explicit `…[+N chars in the event log]` notice. **This is pre-existing behaviour** (the renderer
always emits at least one line, however long, rather than dropping it) and was not introduced or
changed here. The full bytes remain in the event log and are retrievable.
