// PROVIDER SHIM — Gemma-on-vLLM native tool-call format.
//
// WHY THIS EXISTS (do not move this into the core):
// The vLLM server hosting `gemma4-31b` was started WITHOUT
// `--enable-auto-tool-choice --tool-call-parser ...`. The model correctly decides to call
// tools, but vLLM returns them as raw text in `message.content` with `tool_calls: []`:
//
//   <|tool_call>call:write{content:<|"|>hello world<|"|>,path:<|"|>a.txt<|"|>}<tool_call|>
//
// An OpenAI-compatible client sees "no tool calls, finish_reason=stop" and terminates the run
// immediately. That is a real, observed provider quirk — exactly the class of thing
// MODEL-ADAPTERS.md says belongs in a named shim.
//
// This shim is OPT-IN and never runs unless a caller asks for it.

/** Does this content look like an unparsed Gemma tool call? */
export function looksLikeGemmaToolCall(content) {
  return typeof content === 'string' && /<\|tool_call>/.test(content);
}

/**
 * Parse Gemma's native tool-call syntax out of `content`.
 * Returns { tool_calls, residualContent } — residual is whatever prose surrounded the calls.
 *
 * Grammar observed (temperature 0, 3 independent probes):
 *   <|tool_call> call : NAME { KEY : <|"|> VALUE <|"|> , ... } <tool_call|>
 *
 * Values are delimited by the literal sentinel `<|"|>` on both sides, which means a value may
 * itself contain quotes, braces, commas and newlines — so we scan for the sentinel rather than
 * trying to tokenise with a regex over the value body.
 */
export function parseGemmaToolCalls(content) {
  const text = String(content ?? '');
  const calls = [];
  let residual = '';
  let i = 0;

  const OPEN = '<|tool_call>';
  const CLOSE = '<tool_call|>';
  const SENT = '<|"|>';

  while (i < text.length) {
    const start = text.indexOf(OPEN, i);
    if (start === -1) { residual += text.slice(i); break; }
    residual += text.slice(i, start);

    // The closing marker is optional in practice (truncation, max_tokens); tolerate its absence.
    let end = text.indexOf(CLOSE, start);
    const bodyEnd = end === -1 ? text.length : end;
    const body = text.slice(start + OPEN.length, bodyEnd);
    i = end === -1 ? text.length : end + CLOSE.length;

    const parsed = parseOneCall(body, SENT);
    if (parsed) calls.push(parsed);
    else residual += text.slice(start, bodyEnd); // unparseable: keep it visible rather than drop it
  }

  return { tool_calls: calls, residualContent: residual.trim() };
}

function parseOneCall(body, SENT) {
  // body looks like:  call:NAME{k:<|"|>v<|"|>,k2:<|"|>v2<|"|>}
  const m = /^\s*call\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(body);
  if (!m) return null;
  const name = m[1];
  let p = m[0].length;

  const args = {};
  // Scan key:<|"|>value<|"|> pairs until the matching closing brace.
  while (p < body.length) {
    while (p < body.length && /[\s,]/.test(body[p])) p++;
    if (body[p] === '}') break;

    const km = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/.exec(body.slice(p));
    if (!km) break;
    p += km[0].length;
    const key = km[1];

    if (body.startsWith(SENT, p)) {
      p += SENT.length;
      const close = body.indexOf(SENT, p);
      if (close === -1) { args[key] = body.slice(p); p = body.length; break; }
      args[key] = body.slice(p, close);
      p = close + SENT.length;
    } else {
      // Unsentinelled scalar (number / bare word) — read to the next comma or closing brace.
      const stop = findStop(body, p);
      args[key] = coerce(body.slice(p, stop).trim());
      p = stop;
    }
  }
  return { name, args };
}

function findStop(s, from) {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '}') { if (depth === 0) return i; depth--; }
    else if (c === ',' && depth === 0) return i;
  }
  return s.length;
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d*\.\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * SECOND OBSERVED QUIRK: Gemma emits reasoning-channel markers that vLLM does not strip:
 *
 *   <|channel>thought
<channel|>I fixed the bug in `src/calc.js` by ...
 *
 * Left in place these leak into the stored result, into `explain`, and back into the next
 * prompt as if they were the assistant's words. Strip them from content and keep the channel
 * text under ext.reasoning so nothing is lost.
 */
const CHANNEL_RE = /<\|channel>\s*([A-Za-z_]*)\s*<channel\|>/g;

export function stripGemmaChannels(content) {
  const text = String(content ?? '');
  if (!/<\|channel>/.test(text)) return { content: text, channels: [] };
  const channels = [];
  let m;
  CHANNEL_RE.lastIndex = 0;
  while ((m = CHANNEL_RE.exec(text)) !== null) channels.push(m[1] || 'unnamed');
  return { content: text.replace(CHANNEL_RE, '').trim(), channels };
}

/**
 * Apply the shim to a normalised ModelResult, in place of the provider's empty tool_calls.
 * No-ops unless the content actually carries the marker, so it is safe to leave enabled.
 * Emits `shimmed: true` so the runtime can record that a provider workaround fired.
 */
export function applyGemmaToolCallShim(result) {
  const shimsApplied = [];

  // 1. strip reasoning-channel markers from content (always safe)
  const ch = stripGemmaChannels(result.content);
  let content = ch.content;
  let ext = result.ext ?? {};
  if (ch.channels.length) {
    shimsApplied.push('gemma-channel-markers');
    ext = { ...ext, channels: ch.channels };
  }

  // 2. parse native tool calls, but only if the provider did not
  let tool_calls = result.tool_calls ?? [];
  let finish = result.finish;
  if (!tool_calls.length && looksLikeGemmaToolCall(content)) {
    const parsed = parseGemmaToolCalls(content);
    if (parsed.tool_calls.length) {
      shimsApplied.push('gemma-native-tool-calls');
      content = parsed.residualContent;
      tool_calls = parsed.tool_calls.map((t, i) =>
        ({ id: `gemma_${i}_${Date.now().toString(36)}`, ...t, argError: null }));
      finish = false;
    }
  }

  if (!shimsApplied.length) return result;
  return { ...result, content, tool_calls, finish,
           ext: { ...ext, shimmed: shimsApplied.join('+') } };
}
