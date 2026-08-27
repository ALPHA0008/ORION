// A REAL HTTP server speaking the OpenAI chat-completions wire format, which can be told
// to misbehave. This exercises the real client path (sockets, retries, timeouts, JSON
// parsing, tool-call decoding) over a real network stack.
//
// IT IS NOT A LANGUAGE MODEL. It does not test real model *behaviour* — only our handling
// of provider behaviour. Real-model testing requires credentials (see V0-READINESS.md).

import http from 'node:http';

export function startFakeProvider({
  script = null,            // (req, callIndex) => {content, tool_calls, finish}
  faults = [],              // e.g. ['429','500','timeout','malformed','bad-tool-json','empty-choices']
  nondeterministic = false, // append a random nonce so identical input -> different output
  latencyMs = 0,
  port = 0,
} = {}) {
  let callIndex = 0;
  const calls = [];
  const faultQueue = [...faults];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', async () => {
      const parsed = safeJson(body);
      const idx = callIndex++;
      calls.push({ idx, at: Date.now(), messages: parsed?.messages ?? [], tools: parsed?.tools?.length ?? 0 });

      const fault = faultQueue.shift();
      if (latencyMs) await sleep(latencyMs);

      if (fault === 'timeout') { /* never respond */ return; }
      if (fault === '429') {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        return res.end(JSON.stringify({ error: { message: 'rate limited' } }));
      }
      if (fault === '500') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'internal' } }));
      }
      if (fault === '400') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'bad request: context too long' } }));
      }
      if (fault === 'malformed') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{"choices": [ this is not json');
      }
      if (fault === 'empty-choices') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ choices: [], usage: {} }));
      }

      const out = script
        ? script({ messages: parsed?.messages ?? [] }, idx)
        : { content: 'ok', tool_calls: [], finish: true };

      const nonce = nondeterministic ? ` [nonce ${Math.random().toString(16).slice(2, 10)}]` : '';
      const toolCalls = (out.tool_calls ?? []).map((t, i) => ({
        id: t.id ?? `call_${idx}_${i}`, type: 'function',
        function: {
          name: t.name,
          // 'bad-tool-json' makes the provider emit unparseable arguments (a real failure mode)
          arguments: fault === 'bad-tool-json' ? '{"path": ' : JSON.stringify(t.args ?? {}),
        },
      }));

      const payload = {
        id: `chatcmpl-${idx}`, object: 'chat.completion', model: 'fake-1',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: (out.content ?? '') + nonce,
                     ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
          finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
        }],
        usage: { prompt_tokens: 100 + idx * 7, completion_tokens: 25,
                 prompt_tokens_details: { cached_tokens: idx > 0 ? 80 : 0 } },
        system_fingerprint: 'fp_fake',
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({
        url: `http://127.0.0.1:${p}/v1`,
        port: p,
        calls,
        get callCount() { return callIndex; },
        pushFault: (f) => faultQueue.push(f),
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

/** A scripted policy shaped like the crash-test scenario, for use over real HTTP. */
export function projectScript() {
  return ({ messages }) => {
    const toolText = messages.filter(m => m.role === 'tool').map(m => String(m.content)).join('\n');
    const has = (m) => toolText.includes(m);
    if (!has('wrote a.txt')) return { content: 'Creating a.txt', tool_calls: [{ name: 'write', args: { path: 'a.txt', content: 'alpha\nVALUE=1\n' } }] };
    if (!has('wrote b.txt')) return { content: 'Creating b.txt', tool_calls: [{ name: 'write', args: { path: 'b.txt', content: 'beta\nVALUE=2\n' } }] };
    if (!has('edited b.txt')) return { content: 'Bumping b', tool_calls: [{ name: 'edit', args: { path: 'b.txt', old_string: 'VALUE=2', new_string: 'VALUE=20' } }] };
    if (!has('CHECK-OK')) return { content: 'Verifying', tool_calls: [{ name: 'bash', args: { cmd: 'echo CHECK-OK' } }] };
    return { content: 'Done: created a.txt and b.txt, bumped VALUE to 20.', tool_calls: [], finish: true };
  };
}
