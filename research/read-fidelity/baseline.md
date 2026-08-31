# Phase 8 — Frozen Baseline

| item | value |
|---|---|
| git revision | `b2cb52198cde1ed8744d33cb403043d01b970f73` |
| working tree | clean |
| regression | **536 passed, 0 failed across 20 suites** |
| OS / Node | Windows 11 Pro 10.0.26100 / v24.18.0 |
| Model A | `gemma4-31b`, vLLM `<vllm-host>:8000/v1`, 31B dense, NVFP4, 32k ctx, shim required |
| Model B | `qwen3.6:35b`, Ollama `localhost:11434/v1`, MoE 35.5B, Q4_K_M, 262k ctx, no shim |
| `MSG_CLAMP` | **2,000** bytes (unchanged this phase) |
| `WINDOW` | **40** messages (unchanged this phase) |
| `MAX_OUTPUT_BYTES` | 64 KB, sandbox-level |

## Prior fixes verified present

- `write` pre-state witness (ADR-011): `writewitness` 26, `worldstate/concurrent-race` 18,
  `worldstate/real-repo-race` 14 — all green.
- Escalation control: `escalationgate` 28, `escalation-lifecycle` 20, `bypass` 12 — all green.

## Current `read` renderer

```js
const line = `${String(i).padStart(width)}\t${lines[i - 1]}`;
```

`READ_PAGE_BYTES = 1_500`, deliberately below `MSG_CLAMP`.

## The defect, reproduced at byte level

```
SOURCE bytes  : "function f() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n"
RENDERED      : "1\tfunction f() {\n2\t\tif (x) {\n3\t\t\treturn 1;\n4\t\t}\n5\t}"

source line 3 has 2 tabs
rendered line 3 shows 3 tabs   <-- separator MERGED with source indentation
```

A model counting tabs after the line number sees **N+1** on every tab-indented line. Phase 3
measured the consequence with a controlled A/B:

| separator | correct | `old_string not found` |
|---|---:|---:|
| TAB (current) | **2/10** | 48 |
| pipe | **10/10** | **0** |

## Model view == event truth (§22, §23)

Traced: `#invokeTool` appends `tool.succeeded { result: String(out) }`, and the projection pushes
that same `p.result` into the conversation. There is **one** representation, so the model view and
the event log cannot diverge — fixing the renderer fixes both. No second rendering path exists.

## Out of scope (§25)

`write` recovery, escalation control, the `edit` primitive, diagnosis→action, Qwen path behaviour,
Gemma looping, planning, context strategy.
