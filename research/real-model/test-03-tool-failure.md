# Test 03 — Tool failure and adaptation (Step 4)

**This is the test a scripted model could never have answered.**

## 4a — one failure, then adapt

Task: run `sh flaky.sh` (always exits 1); if it fails, read `hint.txt` and follow it. The hint
redirects to writing `recovered.txt`.

```
Run run_31e2aad887
  task: Run the command "sh flaky.sh". If it fails, read the file hint.txt and follow the instruction inside…
────────────────────────────────────────────────────────────────
   1  12:15:15  · run created (scope personal:local)
   3  12:15:15  ▸ task: Run the command "sh flaky.sh". If it fails, read the file hint.txt and follow the instruct…
   6  12:15:15  🧠 wants 1 tool call: bash 467→16tok
   9  12:15:15  · bash {"cmd":"sh flaky.sh"}
  10  12:15:16  ✕ bash failed: command failed (exit 1): boom: transient failure
  13  12:15:16  🧠 wants 1 tool call: read 506→19tok
  16  12:15:16  · read {"path":"hint.txt"}
  17  12:15:16  ✓ read → The flaky script is broken. Instead, write a file called recovered.txt…
  20  12:15:17  🧠 wants 1 tool call: write 551→25tok
  23  12:15:17  · write {"content":"OK","path":"recovered.txt"}
  24  12:15:17  ✓ write → wrote recovered.txt (2 bytes)
  27  12:15:18  🧠 "The command `sh flaky.sh` failed with a transient error. Following the instructi…" 590→45tok
  28  12:15:18  ✓ completed — model_finished: "The command `sh flaky.sh` failed with a transient error. Fol…"
```

| check | result |
|---|---|
| the tool genuinely failed | yes — `command failed (exit 1): boom: transient failure` |
| the failure reached the model | yes — an `ERROR (tool.failed)` message is in the projection |
| **the model changed strategy** | **yes** — next actions were `read`, then `write` |
| it recovered | yes — `recovered.txt` contains `OK` |
| terminal state | `completed` / `model_finished` |

**A real model can reason over event-driven tool feedback.** It saw a failure surfaced through
event log → projection → message window, understood it, consulted the hint, and changed approach.
That is the central behavioural question of this phase, and the answer is yes.

## 4b — a permanently failing tool

Task: run `sh always-fails.sh` "until it succeeds. It is important that it succeeds."

| observation | value |
|---|---|
| terminal state | `completed` / `model_finished` |
| model calls | 6 (ceiling was 20) |
| tool failures | 1 |

**The model gave up gracefully.** It did not loop, did not exhaust the ceiling, and terminated with
`model_finished` rather than `max_turns` — it *decided* to stop rather than being cut off.

Notably it invoked the failing script only **once** before concluding, despite being told to retry
until success. A weaker model would likely have looped — which is exactly why the no-progress
detector still needs to exist as a safety net (see `test-05-no-progress.md`).
