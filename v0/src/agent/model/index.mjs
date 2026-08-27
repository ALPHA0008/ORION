// Model interface (Phase H). Deliberately thin: the core knows nothing vendor-specific.
//
//   interface Model { name, capabilities: Set<string>, invoke(ctx): Promise<ModelResult> }
//
// ModelResult = { content, tool_calls[], input_tokens, output_tokens,
//                 cache_read_tokens?, cost_usd?, ttft_ms?, duration_ms?, finish, ext? }
//
// Provider quirks live in explicitly named shims, never in the core.

export class ModelError extends Error {
  constructor(msg, { retryable = false, status = null, kind = 'unknown' } = {}) {
    super(msg); this.name = 'ModelError';
    this.retryable = retryable; this.status = status; this.kind = kind;
  }
}

/**
 * OpenAI-compatible chat-completions client.
 * Works against any endpoint speaking that wire format (OpenAI, OpenRouter, Together,
 * Ollama's /v1, LM Studio, vLLM…). ONE provider, per Phase H — not a multi-provider layer.
 */
export function createOpenAICompatModel({
  baseUrl, apiKey = null, model = 'gpt-4o-mini', name = null,
  timeoutMs = 60_000, maxRetries = 3, pricing = null,   // {in_per_mtok, out_per_mtok}
  capabilities = ['tools'],
  shims = [],          // provider quirk shims, applied to the normalised result in order
} = {}) {
  if (!baseUrl) throw new Error('baseUrl is required');
  const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';

  return {
    name: name ?? `openai-compat:${model}`,
    capabilities: new Set(capabilities),

    async invoke({ messages, tools = [], temperature = 0, maxTokens = 2048, signal = null }) {
      const body = {
        model, messages, temperature, max_tokens: maxTokens,
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      };

      let attempt = 0, lastErr = null;
      const started = Date.now();
      while (attempt <= maxRetries) {
        attempt++;
        const ac = new AbortController();
        let timedOut = false;
        // NB: aborting with a custom Error makes fetch reject with THAT error, whose
        // .name is 'Error' — not 'AbortError'. Track the timeout explicitly.
        const timer = setTimeout(() => { timedOut = true; ac.abort(new Error('model request timeout')); }, timeoutMs);
        if (signal) signal.addEventListener('abort', () => ac.abort(signal.reason), { once: true });
        try {
          const res = await fetch(endpoint, {
            method: 'POST', signal: ac.signal,
            headers: { 'content-type': 'application/json',
                       ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
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
            const text = await res.text().catch(() => '');
            throw new ModelError(`provider ${res.status}: ${text.slice(0, 300)}`,
              { retryable: false, status: res.status, kind: 'client_error' });
          }

          let json;
          try { json = await res.json(); }
          catch (e) {
            // Malformed body IS retryable — a truncated stream is transient.
            lastErr = new ModelError(`malformed JSON from provider: ${e.message}`,
              { retryable: true, kind: 'malformed' });
            if (attempt > maxRetries) throw lastErr;
            await sleep(backoff(attempt)); continue;
          }

          let out = normalise(json, { pricing, duration_ms: Date.now() - started, attempts: attempt });
          for (const shim of shims) out = shim(out);   // named provider shims (see shims/)
          return out;

        } catch (err) {
          clearTimeout(timer);
          if (err instanceof ModelError && !err.retryable) throw err;
          const transient = timedOut || err?.name === 'AbortError' || err?.name === 'TypeError' ||
                            (err instanceof ModelError && err.retryable);
          if (!transient) throw new ModelError(String(err?.message ?? err), { retryable: false, kind: 'unknown' });
          lastErr = err instanceof ModelError ? err
                  : new ModelError(String(err?.message ?? err),
                      { retryable: true, kind: timedOut ? 'timeout' : 'network' });
          if (attempt > maxRetries) throw lastErr;
          await sleep(backoff(attempt));
        }
      }
      throw lastErr ?? new ModelError('exhausted retries', { retryable: false });
    },
  };
}

/** Wire format -> ModelResult. This is the one place provider shape is known. */
function normalise(json, { pricing, duration_ms, attempts }) {
  const choice = json?.choices?.[0];
  if (!choice) throw new ModelError('provider returned no choices', { retryable: true, kind: 'malformed' });
  const msg = choice.message ?? {};
  const usage = json.usage ?? {};
  const inTok  = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outTok = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? 0;

  const tool_calls = (msg.tool_calls ?? []).map((tc, i) => {
    let args = {};
    let argError = null;
    try { args = typeof tc.function?.arguments === 'string'
      ? JSON.parse(tc.function.arguments || '{}') : (tc.function?.arguments ?? {}); }
    catch (e) { argError = `unparseable arguments: ${e.message}`; }
    return { id: tc.id ?? `tc_${i}`, name: tc.function?.name ?? 'unknown', args, argError };
  });

  return {
    content: msg.content ?? '',
    tool_calls,
    finish: choice.finish_reason !== 'tool_calls' && tool_calls.length === 0,
    finish_reason: choice.finish_reason ?? null,
    input_tokens: inTok, output_tokens: outTok, cache_read_tokens: cacheRead,
    cost_usd: pricing ? round6((inTok / 1e6) * pricing.in_per_mtok + (outTok / 1e6) * pricing.out_per_mtok) : null,
    duration_ms,
    ext: { model: json.model ?? null, finish_reason: choice.finish_reason ?? null,
           system_fingerprint: json.system_fingerprint ?? null, attempts },
  };
}

const backoff = (n) => Math.min(8000, 200 * 2 ** (n - 1)) + Math.floor(Math.random() * 100);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const round6 = (n) => Math.round(n * 1e6) / 1e6;
