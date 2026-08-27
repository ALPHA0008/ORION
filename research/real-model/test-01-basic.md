# Test 01 — Real model, real task (Step 2)

**Model:** `gemma4-31b` (RedHatAI/gemma-4-31B-it-NVFP4) on vLLM 0.20.1, 32K context
**Endpoint:** self-hosted vLLM on the local network, OpenAI-compatible `/v1`
**Result: 18 assertions, 18 pass.**

## Task

> The repository has a bug in src/calc.js: add() subtracts instead of adding. Fix it, then run "sh test.sh" to verify, then summarise what you changed.

A real 4-file repo was created in the sandbox with a genuine bug (`return a - b`) and a real
verification script (`test.sh`) that exits non-zero unless `add(2,3) === 5`.

## What the model actually did

```
Run run_49124e59fe
  task: The repository has a bug in src/calc.js: add() subtracts instead of adding. Fix it, then run "sh tes…
────────────────────────────────────────────────────────────────
   1  12:08:53  · run created (scope personal:local)
   3  12:08:53  ▸ task: The repository has a bug in src/calc.js: add() subtracts instead of adding. Fix it, then r…
   6  12:08:53  🧠 wants 1 tool call: read 481→17tok
   9  12:08:53  · read {"path":"src/calc.js"}
  10  12:08:53  ✓ read → export function add(a, b) { return a - b; // BUG: should be + }
  13  12:08:54  🧠 wants 1 tool call: edit 530→61tok
  16  12:08:54  · edit {"new_string":" return a + b; // BUG: should be +","old_string":" retu…
  17  12:08:54  ✓ edit → edited src/calc.js
  20  12:08:55  🧠 wants 1 tool call: bash 603→20tok
  22  12:08:55  🙋 bash needs approval
  23  12:08:55  🙋 asked: "bash cannot be safely retried after a crash. Run it? sh test.sh"
  24  12:08:55  ⏸ paused — awaiting_human
  26  12:08:55  💬 human said: approve
  27  12:08:55  · bash {"cmd":"sh test.sh"}
  28  12:08:55  ✓ bash → PASS
  31  12:08:56  🧠 "I fixed the bug in `src/calc.js` where the `add()` function was incorrectly usin…" 631→56tok
  32  12:08:56  ✓ completed — model_finished: "I fixed the bug in `src/calc.js` where the `add()` function …"
```

**The bug was genuinely fixed and genuinely verified** — `test.sh` returned `PASS`, and the
final file on disk contains `return a + b`.

## The interesting part: it paused for a human, and a DIFFERENT worker finished it

The model asked to run `sh test.sh`. The shell classifier (ADR-002) does not recognise
`sh test.sh` as provably safe, so it classified `UNSAFE` → the authorization seam escalated →
**the run paused and released its lease**. After the human approved, a *new worker session*
(`w1r1`) claimed the run and carried it to completion.

That is a durability path exercised end-to-end by a real model without anyone planning it.

## Metrics

| metric | value |
|---|---|
| wall clock | 3.8s |
| events | 32 |
| model calls | 4 |
| tool calls | 3 (ok 3, failed 0, denied 0) |
| input tokens | 2245 |
| output tokens | 154 |
| human requests | 1 |
| degraded events | 0 |
| responses needing a provider shim | **4 of 4** |

## Verified invariants

- event log gapless (32 events)
- every `tool.started` has a terminal event
- no dangling in-flight tool calls at the end
- snapshot-assisted projection == cold full replay
- every tool call passed the authorization seam (3 gate events for 3 tool calls)
- no `tool.started` without a preceding gate decision
- no raw provider markers leaked into the stored result or into `explain`

## Two REAL provider quirks found (see `summary.md` for the shim)

1. **vLLM did not parse tool calls.** The server was started without
   `--enable-auto-tool-choice --tool-call-parser`, so the model's tool calls arrived as raw text
   in `content` with `tool_calls: []`. An unmodified OpenAI-compatible client sees
   "no tool calls, finish_reason=stop" and **terminates the run on turn one**.
2. **Reasoning-channel markers leaked.** `<|channel>thought
<channel|>` appeared inside the
   final answer, and would have been stored, rendered by `explain`, and fed back to the model as
   if the assistant had said it.

Both are handled in a named shim (`src/agent/model/shims/gemma-tool-calls.mjs`), never in the
core, and every shimmed response is marked `ext.shimmed` in the event log.
