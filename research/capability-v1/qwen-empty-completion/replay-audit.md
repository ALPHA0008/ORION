# Qwen empty-completion — replay instrument audit

## What the earlier replay did (extract4.mjs / replay2.mjs / bisect*.mjs)

The pre-correction replay instrument had three fidelity defects, each separately enough to
invalidate `COLLAPSE` vs `NO_COLLAPSE` as evidence about the live run:

1. **It INCLUDED the terminal empty assistant response in the fed-back history.** The extractor
   pushed a `model.responded` with `content=''` / `tool_calls=[]` as a `role:assistant` message,
   then the continuation loop asked the model "what next" on top of its own failure. The
   phenomenon under test was treated as part of the causal input. This is the defect that
   most likely explains pytest-9359's earlier non-reproduction.
2. **It did NOT apply the projection's MSG_CLAMP (2,000 B).** The live request to the model uses
   `clampContent()` — tool results >2,000 chars are truncated to 2,000 with a
   `[…+N chars in the event log]` suffix. The replay sent the full un-clamped DB result. A
   3,566-char pytest grep result reached the earlier replay complete; the live model saw 2,000.
3. **Continuation used synthetic stubs**, not real tool execution or the durable results. Any
   `NO_COLLAPSE` after the reconstruction point could not be attributed to the real mechanism.

## What the corrected replay does

- Reconstructs the exact **outbound** message array from the durable event log, applying the same
  `clampContent` (MSG_CLAMP=2,000) and the exact tool.failed rendering `ERROR (tool.failed): …`.
- Truncates the history **immediately before the first terminal empty assistant response**
  (the first `model.responded` with `tool_calls=[]`). The terminal response is never fed back.
- Uses the real worker `DEFAULT_SYSTEM` prompt (the stage runner passes no custom systemPrompt)
  and the real user message (`turn.started.input`).
- Continuation executes **real tools** via the frozen `LocalSandbox` + `makeTools` (same WSL-bash
  shell, same PATH prefix with the task venv), so post-reconstruction results are genuine.
- Request body identical to the live invoke: model `qwen3.6:35b`, `localhost:11434/v1`,
  temperature 0, max_tokens 2048, `tool_choice:'auto'`, 6 tools (read/write/edit/grep/bash/ask_user).

## Fidelity validation (flask-4045, pytest-9359, pylint-7993)

| property            | flask-4045           | pytest-9359          | pylint-7993          |
|---------------------|----------------------|----------------------|----------------------|
| system prompt       | DEFAULT_SYSTEM       | DEFAULT_SYSTEM       | DEFAULT_SYSTEM       |
| user message        | turn.started input   | same                 | same                 |
| messages rebuilt    | 18                   | 24                   | 4                    |
| last history msg    | tool read (1,565 B)  | tool bash (158 B)    | tool bash (0 B)      |
| terminal included?  | no                   | no                   | no                   |
| content clamp       | 2,000 B              | 2,000 B              | 2,000 B              |
| tools/config        | identical (6 tools)  | identical            | identical            |

## Conclusion

The earlier instrument was **invalid** as evidence about the live mechanism. Its findings
(reproduce on flask, not on pytest) were artifacts of the terminal-message inclusion and the
stub/non-clamped content. That is what made the pytest-9359 "counterexample" — it was never a
working reproduction to begin with.