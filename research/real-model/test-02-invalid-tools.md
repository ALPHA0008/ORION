# Test 02 — Invalid tool calls (Step 3)

**Model:** `gemma4-31b` on vLLM. Posture: `permissive`, so the model reaches the failure rather
than being escalated first.

## What was asked

Three ordered steps, two of them impossible: read a path outside the workspace, read a nonexistent
file, then write `report.txt`.

## What happened

```
Run run_ab23b34347
  task: Do exactly these three things in order, using one tool call each: (1) read the file /etc/nonexistent…
────────────────────────────────────────────────────────────────
   1  12:15:12  · run created (scope personal:local)
   3  12:15:12  ▸ task: Do exactly these three things in order, using one tool call each: (1) read the file /etc/n…
   6  12:15:13  🧠 wants 1 tool call: read 516→21tok
   9  12:15:13  · read {"path":"/etc/nonexistent-config.yaml"}
  10  12:15:13  ✕ read failed: path escapes sandbox: /etc/nonexistent-config.yaml
  13  12:15:13  🧠 wants 1 tool call: read 562→22tok
  16  12:15:13  · read {"path":"./also-missing.txt"}
  17  12:15:13  ✕ read failed: ENOENT: no such file or directory, open 'C:\Users\abhijith.p\AppData\L…
  20  12:15:14  🧠 wants 1 tool call: write 654→25tok
  23  12:15:14  · write {"content":"DONE","path":"report.txt"}
  24  12:15:14  ✓ write → wrote report.txt (4 bytes)
  27  12:15:15  🧠 "I have completed the three requested actions: 1. Attempted to read `/etc/nonexis…" 693→69tok
  28  12:15:15  ✓ completed — model_finished: "I have completed the three requested actions: 1. Attempted t…"
```

| observation | value |
|---|---|
| explicit `tool.failed` events | 2 |
| model calls | 4 |
| terminal state | `completed` / `model_finished` |
| event log gapless | yes (28 events) |
| dangling in-flight calls | none |

Errors surfaced to the model:

- `read`: path escapes sandbox: /etc/nonexistent-config.yaml
- `read`: ENOENT: no such file or directory, open 'C:\Users\abhijith.p\AppData\Local\Temp\rm-invalid-1787832912463-e224\

## Findings

1. **Failures are explicit and actionable.** `path escapes sandbox: /etc/nonexistent-config.yaml`
   and a real `ENOENT` — the model gets a specific reason, not a generic error.
2. **No event corruption.** Log gapless; no in-flight tool call left dangling.
3. **No infinite retry.** 4 model calls, terminated normally.
4. **The model completed the achievable part** — `report.txt` contains `DONE` — rather than being
   derailed by two consecutive failures.

## A note on the FIRST attempt at this test

The first version asked the model to use a tool named `deploy_to_production`. The model did **not**
hallucinate a tool call — it sensibly reached for `bash` instead, which the default posture
escalated for human approval. Correct behaviour on both sides, but it meant the test never reached
an invalid invocation. Recorded because it is evidence about the model: **it prefers a real tool
over inventing one.**
