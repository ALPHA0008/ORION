# Corrected replay method (applies to all Qwen diagnosis replays)

## Non-negotiables

1. **Boundary.** Replay history ends at the last real tool result that precedes the first
   terminal `model.responded` with `tool_calls=[]`. The terminal empty completion is the
   phenomenon measured; it is never included as model input. `run.completed model_finished`
   events are never part of the message array either.
2. **Content.** Assistant `content` and tool results are taken verbatim from the durable event
   log payloads and passed through the projection's `clampContent` (MSG_CLAMP=2,000) exactly as
   the live worker's `#buildMessages` does. `tool.failed` renders as
   `ERROR (tool.failed): <message>`. `tool.succeeded` renders as `<result>`.
3. **Tool-call format.** Assistant messages carry
   `{ id, type:'function', function:{ name, arguments: JSON.stringify(args) } }` — the exact shape
   produced by `#buildMessages`. `repairOrphans` is not needed because the reconstruction only
   accepts well-paired tool messages.
4. **Request body.** `{ model:'qwen3.6:35b', messages, temperature:0, max_tokens:2048,
   tools, tool_choice:'auto' }` to `http://localhost:11434/v1/chat/completions`. Six tools:
   read/write/edit/grep/bash/ask_user, schemas identical to `toolDefinitions(makeTools(sandbox))`.
5. **Continuation.** When the model issues a tool call, the WHOLE history (including the assistant
   tool-call messages) is submitted and the tool executes against the real task workdir via the
   frozen `LocalSandbox` + `makeTools`, with the task venv `Scripts` dir prepended to PATH (same as
   the live runner). Results are clamped and returned as `role:'tool'` messages.
6. **Fidelity check on entry.** Reported reconstructed message count, last message role/name/length,
   live vs replayed input/output tokens for the terminal round. If the replayed terminal token
   count diverges wildly from the live terminal, the instrument is wrong and the result is void.

## Determinism

`temperature=0` → a given message array deterministically produces the same completion. The
reproduction quality is therefore checked by comparing `inTokens`/`outTokens`/`finish_reason`
between live and replay terminal rounds.

## Boundaries intentionally NOT tested

- No retry logic, no changed prompts, no changed tools, no changed model config, no changed
  temperature, no changed max_tokens, no runner/harness modifications, Gemma untouched.
- These are diagnosis-only replays for the Qwen arm.