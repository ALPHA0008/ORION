// Streaming — DURABLE PARTIAL EXECUTION (Wave 4b).
//
// The framing that matters: streaming here is NOT "render tokens as they arrive". Terminal
// rendering is a consumer of the stream, never its purpose. The requirement is that a
// partially-completed model call leaves durable, attributable evidence, so that
//
//   - a crash mid-stream is recoverable rather than a total loss of the turn;
//   - `ttft_ms` becomes observable — it is only measurable if the response is read incrementally,
//     which is why it has been declared in the payload contract and set by nothing until now;
//   - replay reconstructs what was streamed with ZERO model calls, like everything else here.
//
// If streaming were only cosmetic it would be the first feature in this runtime that produces no
// trajectory, which is exactly the disconnected-feature failure the design is meant to avoid.
//
// CADENCE IS THE LOAD-BEARING DECISION. Recording one event per token would multiply the event
// log by the token count and reintroduce unbounded inline content from the other direction. So
// deltas are emitted on a BYTE or TIME threshold, and an accumulation that crosses the Wave 3
// artifact threshold is promoted to an artifact instead of being carried inline.

/** Emit a delta at most this often, by accumulated bytes… */
export const DELTA_BYTES = 1_024;
/** …or by elapsed time, whichever comes first. Bounds latency for a slow trickle. */
export const DELTA_MS = 400;

/**
 * Parse an SSE byte stream into `data:` payloads.
 *
 * Server-Sent Events are newline-delimited, but a chunk boundary can fall anywhere — including
 * mid-line and mid-UTF-8-character. The buffer below is what makes the parse correct rather than
 * usually-correct; a naive per-chunk split silently corrupts multi-byte characters.
 */
export async function* sseEvents(body, { signal = null } = {}) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    if (signal?.aborted) return;
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      if (data) yield data;
    }
  }
}

/**
 * Accumulate streamed fragments into a ModelResult, emitting bounded delta callbacks.
 *
 * `onDelta({ kind, bytes, text })` is called at the cadence above — NOT per fragment. The caller
 * (the worker) decides what to durably record; this function only decides *when* there is enough
 * to be worth recording.
 */
export function createStreamAccumulator({ onDelta, deltaBytes = DELTA_BYTES, deltaMs = DELTA_MS } = {}) {
  let text = '';
  let pending = '';
  let lastFlush = Date.now();
  let ttftMs = null;
  const started = Date.now();
  const toolCalls = new Map();     // index -> { id, name, argsText }
  let chunks = 0;

  const flush = (force = false) => {
    if (!pending) return;
    const bigEnough = Buffer.byteLength(pending) >= deltaBytes;
    const oldEnough = Date.now() - lastFlush >= deltaMs;
    if (!force && !bigEnough && !oldEnough) return;
    chunks++;
    onDelta?.({ kind: 'text', bytes: Buffer.byteLength(pending), text: pending });
    pending = '';
    lastFlush = Date.now();
  };

  return {
    /** Feed one decoded provider fragment. Returns nothing; side effects are the callbacks. */
    push({ textDelta = '', toolCall = null } = {}) {
      // First observable output IS time-to-first-token. Measured once, from the call's start.
      if (ttftMs === null && (textDelta || toolCall)) ttftMs = Date.now() - started;
      if (textDelta) { text += textDelta; pending += textDelta; flush(); }
      if (toolCall) {
        const cur = toolCalls.get(toolCall.index) ?? { id: null, name: null, argsText: '' };
        if (toolCall.id) cur.id = toolCall.id;
        if (toolCall.name) cur.name = toolCall.name;
        if (toolCall.argsDelta) cur.argsText += toolCall.argsDelta;
        toolCalls.set(toolCall.index, cur);
      }
    },

    /** Close the stream and produce the ModelResult. */
    finish({ finishReason = null, usage = null, aborted = false } = {}) {
      flush(true);
      const tool_calls = [...toolCalls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([i, tc]) => {
          let args = {}, argError = null;
          try { args = tc.argsText ? JSON.parse(tc.argsText) : {}; }
          catch (e) { argError = `unparseable arguments: ${e.message}`; }
          return { id: tc.id ?? `tc_${i}`, name: tc.name ?? 'unknown', args, argError };
        });
      return {
        content: text,
        tool_calls,
        finish: finishReason !== 'tool_calls' && tool_calls.length === 0,
        finish_reason: finishReason,
        input_tokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
        cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
        cost_usd: null,
        ttft_ms: ttftMs,
        duration_ms: Date.now() - started,
        ext: { streamed: true, chunks, aborted, bytes: Buffer.byteLength(text) },
      };
    },

    get stats() { return { chunks, bytes: Buffer.byteLength(text), ttftMs }; },
  };
}

/** Decode one OpenAI-compatible `chat.completion.chunk` payload into accumulator input. */
export function decodeOpenAIChunk(data) {
  let json;
  try { json = JSON.parse(data); } catch { return null; }
  const choice = json.choices?.[0];
  if (!choice) return { usage: json.usage ?? null };
  const d = choice.delta ?? {};
  const out = { finishReason: choice.finish_reason ?? null, usage: json.usage ?? null };
  if (typeof d.content === 'string' && d.content) out.textDelta = d.content;
  if (Array.isArray(d.tool_calls) && d.tool_calls.length) {
    const tc = d.tool_calls[0];
    out.toolCall = {
      index: tc.index ?? 0,
      id: tc.id ?? null,
      name: tc.function?.name ?? null,
      argsDelta: tc.function?.arguments ?? '',
    };
  }
  return out;
}
