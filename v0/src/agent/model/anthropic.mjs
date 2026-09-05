// PROVIDER — Anthropic Messages API (`/v1/messages`).
//
// This provider exists to FALSIFY the abstraction, not to add coverage. A second
// OpenAI-compatible endpoint would prove nothing; Anthropic's wire format differs in exactly the
// places a leaky seam would show:
//
//   - the system prompt is a TOP-LEVEL field, not a message with role 'system';
//   - tool results are CONTENT BLOCKS on a user message, not a message with role 'tool';
//   - tool calls come back as `tool_use` blocks inside `content`, not as a `tool_calls` array;
//   - the stop reason is `stop_reason: 'tool_use' | 'end_turn' | …`, not `finish_reason`;
//   - authentication is `x-api-key` + `anthropic-version`, not `authorization: Bearer`.
//
// Everything vendor-specific is confined to this file. The core sees only a ModelResult, which is
// what makes the abstraction real rather than nominal: if the loop ever needed to know which
// provider produced a result, the design would be wrong (plan §10 stop rule).

import { ModelError } from './errors.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const backoff = (n) => Math.min(8_000, 200 * 2 ** (n - 1)) + Math.floor(Math.random() * 100);
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Translate the runtime's OpenAI-shaped message array into Anthropic's request shape.
 *
 * The runtime speaks one internal dialect (OpenAI-shaped) because that is what it has always
 * spoken and changing it would touch every projection. Translation therefore happens HERE, at the
 * provider edge, which is the only place that should know a second dialect exists.
 */
export function toAnthropicRequest({ messages, tools = [], model, temperature = 0, maxTokens = 2048 }) {
  let system = null;
  const out = [];

  for (const m of messages ?? []) {
    if (m.role === 'system') {
      // Anthropic carries the system prompt out-of-band. Multiple system messages concatenate.
      system = system == null ? String(m.content ?? '') : system + '\n\n' + String(m.content ?? '');
      continue;
    }

    if (m.role === 'tool') {
      // A tool RESULT is a content block on a user message. Consecutive results coalesce into one
      // message, which is what the API expects when several tools ran in the same turn.
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') };
      const prev = out[out.length - 1];
      if (prev && prev.role === 'user' && Array.isArray(prev.content)
          && prev.content.every(b => b.type === 'tool_result')) {
        prev.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant' && m.tool_calls?.length) {
      // A tool CALL is a `tool_use` block. Any prose the assistant produced alongside it is kept
      // as a preceding text block rather than dropped — losing it would silently change the
      // conversation the model sees.
      const content = [];
      const text = String(m.content ?? '');
      if (text) content.push({ type: 'text', text });
      for (const tc of m.tool_calls) {
        let input = {};
        try {
          input = typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments || '{}')
            : (tc.function?.arguments ?? {});
        } catch { input = {}; }
        content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name ?? 'unknown', input });
      }
      out.push({ role: 'assistant', content });
      continue;
    }

    out.push({ role: m.role, content: String(m.content ?? '') });
  }

  const body = { model, max_tokens: maxTokens, temperature, messages: out };
  if (system != null) body.system = system;
  if (tools.length) {
    // OpenAI tool definitions are {type:'function', function:{name, description, parameters}}.
    body.tools = tools.map(t => ({
      name: t.function?.name ?? t.name,
      description: t.function?.description ?? t.description ?? '',
      input_schema: t.function?.parameters ?? t.parameters ?? { type: 'object', properties: {} },
    }));
  }
  return body;
}

/**
 * Normalise an Anthropic response into the SAME ModelResult shape the OpenAI-compatible client
 * produces. Structural identity here is what lets a shim written against ModelResult work for
 * either provider, and what keeps the worker provider-agnostic.
 */
export function fromAnthropicResponse(json, { duration_ms = null, attempts = 1, pricing = null } = {}) {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
  const tool_calls = blocks
    .filter(b => b.type === 'tool_use')
    .map((b, i) => ({ id: b.id ?? `tc_${i}`, name: b.name ?? 'unknown', args: b.input ?? {}, argError: null }));

  const inTok = json?.usage?.input_tokens ?? 0;
  const outTok = json?.usage?.output_tokens ?? 0;
  const cacheRead = json?.usage?.cache_read_input_tokens ?? 0;

  return {
    content: text,
    tool_calls,
    // `stop_reason: 'tool_use'` is Anthropic's equivalent of finish_reason 'tool_calls'.
    // The runtime's `finish` means "the model stopped and asked for nothing", so it must be
    // false whenever tool calls are present, exactly as on the OpenAI path.
    finish: json?.stop_reason !== 'tool_use' && tool_calls.length === 0,
    finish_reason: json?.stop_reason ?? null,
    input_tokens: inTok, output_tokens: outTok, cache_read_tokens: cacheRead,
    cost_usd: pricing
      ? round6((inTok / 1e6) * pricing.in_per_mtok + (outTok / 1e6) * pricing.out_per_mtok)
      : null,
    duration_ms,
    ext: { model: json?.model ?? null, finish_reason: json?.stop_reason ?? null,
           stop_sequence: json?.stop_sequence ?? null, attempts },
  };
}

export function createAnthropicModel({
  baseUrl = 'https://api.anthropic.com', apiKey = null, model = 'claude-sonnet-5',
  name = null, timeoutMs = 60_000, maxRetries = 3, pricing = null,
  anthropicVersion = '2023-06-01',
  // F5: NOT 'streaming'. This provider has no invokeStream — Anthropic's SSE format differs from
  // the OpenAI one and implementing it is a separate piece of work, not a rename. Declaring a
  // capability that is not implemented is exactly the silent-fallback failure this runtime
  // refuses: the worker would select streaming and then quietly not stream. It is added here the
  // day invokeStream exists, and not before.
  capabilities = ['tools'],
  shims = [],
} = {}) {
  const endpoint = String(baseUrl).replace(/\/+$/, '') + '/v1/messages';

  return {
    name: name ?? `anthropic:${model}`,
    provider: 'anthropic',
    endpoint,
    capabilities: new Set(capabilities),

    async invoke({ messages, tools = [], temperature = 0, maxTokens = 2048, signal = null }) {
      const body = toAnthropicRequest({ messages, tools, model, temperature, maxTokens });
      let attempt = 0, lastErr = null;
      const started = Date.now();

      while (attempt <= maxRetries) {
        attempt++;
        const ac = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; ac.abort(new Error('model request timeout')); }, timeoutMs);
        if (signal) signal.addEventListener('abort', () => ac.abort(signal.reason), { once: true });
        try {
          const res = await fetch(endpoint, {
            method: 'POST', signal: ac.signal,
            headers: {
              'content-type': 'application/json',
              'anthropic-version': anthropicVersion,
              ...(apiKey ? { 'x-api-key': apiKey } : {}),
            },
            body: JSON.stringify(body),
          });
          clearTimeout(timer);

          if (res.status === 429 || res.status >= 500) {
            const retryAfter = Number(res.headers.get('retry-after')) || null;
            lastErr = new ModelError(`provider ${res.status}`, {
              retryable: true, status: res.status,
              kind: res.status === 429 ? 'rate_limit' : 'server_error' });
            lastErr.retryAfterMs = retryAfter ? retryAfter * 1000 : backoff(attempt);
            if (attempt > maxRetries) throw lastErr;
            await sleep(lastErr.retryAfterMs);
            continue;
          }
          if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new ModelError(`provider ${res.status}: ${t.slice(0, 300)}`,
              { retryable: false, status: res.status, kind: 'client_error' });
          }

          let json;
          try { json = await res.json(); }
          catch (e) {
            lastErr = new ModelError(`malformed JSON from provider: ${e.message}`,
              { retryable: true, status: res.status, kind: 'malformed' });
            if (attempt > maxRetries) throw lastErr;
            await sleep(backoff(attempt));
            continue;
          }

          let out = fromAnthropicResponse(json, {
            duration_ms: Date.now() - started, attempts: attempt, pricing });
          for (const shim of shims) out = shim(out);
          return out;
        } catch (err) {
          clearTimeout(timer);
          if (err instanceof ModelError) throw err;
          const kind = timedOut ? 'timeout' : 'network';
          lastErr = new ModelError(`${kind}: ${err?.message ?? err}`,
            { retryable: true, status: null, kind });
          if (attempt > maxRetries) throw lastErr;
          await sleep(backoff(attempt));
        }
      }
      throw lastErr ?? new ModelError('model unavailable', { retryable: true, kind: 'unknown' });
    },
  };
}
