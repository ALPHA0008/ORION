# Quickstart — a run you can inspect, replay and fork

Five minutes, one buggy file, a local model. Every command below was executed while writing this
example; the outputs are real, not illustrative.

## 1. Install

```bash
npm install -g @kernlbase/harness
harness --version          # 0.1.0
```

Requires **Node ≥ 22** and `git` on `PATH`.

## 2. Configure

Any OpenAI-compatible endpoint. A local model is the cheapest way to try it:

```bash
export HARNESS_BASE_URL=http://localhost:11434/v1
export HARNESS_MODEL=qwen3:8b
export HARNESS_API_KEY=not-needed

harness doctor
```

`doctor` should report your endpoint and `db integrity ok`.

## 3. Make something to fix

```bash
mkdir /tmp/demo && cd /tmp/demo
printf 'def add(a, b):\n    return a - b\n' > calc.py
```

## 4. Run

```bash
harness run "Fix the bug in calc.py: add() should return a + b, not a - b"
```

```
Run #97efb25767  /tmp/demo
────────────────────────────────────────────────
  ✓ grep calc.py:1: def add(a, b):
  ✓ read 1|def add(a, b): 2| return a - b
  ✓ edit edited calc.py

✓ model_finished
  history:      harness explain #97efb25767
```

`calc.py` now reads `return a + b`.

Your run id will differ — use yours for everything below. `harness list` shows all runs.

## 5. Inspect what actually happened

```bash
harness explain #97efb25767
```

```
 1  06:34:45  · run created (scope personal:local)
 3  06:34:46  ▸ task: Fix the bug in calc.py: add() should return a + b, not a - b
 6  06:34:58  🧠 wants 1 tool call: grep 565→284tok
 9  06:34:58  · grep {"pattern":"add","path":"calc.py"}
10  06:34:58  ✓ grep → calc.py:1: def add(a, b):
13  06:35:08  🧠 wants 1 tool call: read 611→320tok
16  06:35:08  · read {"path":"calc.py","offset":1,"limit":10}
17  06:35:08  ✓ read → 1|def add(a, b): 2| return a - b
20  06:35:22  🧠 wants 1 tool call: edit 667→453tok
23  06:35:22  · edit {"path":"calc.py","old_string":"return a - b","new_string":"return a +…
24  06:35:22  ✓ edit → edited calc.py
```

Every model call, every tool argument, every result — with token accounting. Add `--verbose` for
full payloads.

## 6. Replay — free, and no model calls

```bash
harness replay #97efb25767
```

```
Replay of #97efb25767
reconstructed from the event log — no model calls, no cost

Run run_97efb25767
  status      completed (model_finished)
  events      28
  turns       1   model calls 4   tool calls 3
  tokens      3843 (in 2561 / out 1282)
```

Replay is reconstruction, not re-execution. It costs nothing and always reproduces what happened.

## 7. Fork — branch from any point

```bash
harness fork #97efb25767 --at 10
```

```
forked #97efb25767 @10 -> #a46d563042
  history up to that point is inherited; the future is new
  note: the WORKSPACE is not rewound automatically.
        run the fork in a fresh workspace, or restore a checkpoint first.
  continue with:  harness resume #a46d563042
```

The fork inherits history through event 10 and diverges after it. If you split mid-turn, the CLI
warns and suggests a clean boundary.

**`fork` rewinds history, not your files.** Run a fork in a fresh workspace, or restore a
checkpoint first.

## 8. Crash and resume

The core claim, demonstrable directly: start a run, kill the process, resume it.

```bash
harness run "run the test suite and fix whatever fails" &
sleep 10 && kill -9 %1          # or close the terminal

harness list                     # the run is still there
harness resume #<id>
```

```
resuming from event 23…
  ♻ Recovered from event #23 — edit: skip
```

`edit: skip` means the runtime verified the edit had already landed and did **not** repeat it. Had
it been a `bash` command — unverifiable — the run would have **paused and asked you** instead of
guessing.

## What to read next

- [`docs/RECOVERY.md`](../../docs/RECOVERY.md) — what is guaranteed after a crash, and what is not
- [`docs/TOOLS.md`](../../docs/TOOLS.md) — why `write`/`edit` and `bash` carry different guarantees
- [`docs/FORKING.md`](../../docs/FORKING.md) — history vs workspace
- [`ADRs/`](../../ADRs/) — 13 decisions and the evidence behind each
