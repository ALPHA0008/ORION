# Candidate Renderings (§5–§6)

Compared by measurement before choosing (`eval/real/setup/render-candidates.mjs`).
Source line 3 is `"\t\treturn 1;"` — two tabs.

| candidate | bytes | ambiguous? | reconstructable | line-3 rendering |
|---|---:|---|---|---|
| **A0 current (TAB sep)** | 51 | **YES** | **lossy** | `"3\t\t\treturn 1;"` ← 3 tabs shown, 2 in source |
| **A pipe delimiter** | **51** | no | **EXACT** | `"3\|\t\treturn 1;"` |
| B escaped whitespace | 55 | no | EXACT | `"3\|\t\treturn 1;"` |
| C JSON records | 160 | no | EXACT | `"{\"line\":3,\"content\":\"\t\treturn 1;\"}"` |
| D `[TAB]` markers | 67 | no | EXACT | `"3\|[TAB][TAB]return 1;"` |

## Evaluation (§6)

| criterion | A | B | C | D |
|---|---|---|---|---|
| human readability | **high** | medium | low | medium |
| model readability | **high** | medium | medium | medium |
| byte fidelity | **exact** | exact | exact | exact |
| token overhead vs today | **0%** | +8% | **+214%** | +31% |
| line attribution | clear | clear | clear | clear |
| **edit compatibility** | **direct copy** | needs decode | needs parse | needs decode |
| paging compatibility | unchanged | unchanged | awkward | unchanged |

## Why A

It is the only candidate that is simultaneously **faithful, simple and compact** — the stated
target of §6 — and the only one whose rendered content can be copied **verbatim** into
`edit(old_string, …)`.

B and D are byte-faithful but shift work onto the model: it must decode `\t` or `[TAB]` back into
a real tab before constructing an edit. §7 is explicit that the representation must not depend on
the model remembering a convention. B and D also *reintroduce* an ambiguity of their own — a
source file that literally contains the two characters `\t`, or the literal text `[TAB]`, becomes
indistinguishable from an encoded tab.

C is unambiguous but triples the byte cost, which directly reduces how much source fits inside the
unchanged `MSG_CLAMP`. Fidelity paid for with less visible code is a bad trade here.

## The delimiter choice

A single `|` immediately after the right-aligned number. It cannot appear as leading whitespace,
so the split point is unambiguous by construction rather than by instruction.

`|` can of course appear *inside* source, but that is harmless: the contract is "everything after
the **first** delimiter", and the number field before it is digits and spaces only.
