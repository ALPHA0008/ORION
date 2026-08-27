// A deterministic scripted model used for crash/concurrency tests.
// NOT a real LLM. Real-model behaviour is tested separately (Phase H/I).
export function makeScriptModel({ failFirstN = 0, degradeAt = null, nondeterministic = false } = {}) {
  let calls = 0;
  const seen = (s, marker) => s.recent_messages.some(m => m.role === 'tool' && String(m.content).includes(marker));
  return {
    name: 'script-v1',
    capabilities: new Set(['tools']),
    async invoke({ messages }) {
      calls++;
      if (calls <= failFirstN) { const e = new Error('simulated provider 503'); e.retryable = true; e.kind = 'server_error'; throw e; }
      // reconstruct visible progress from the message array the worker built
      const toolText = messages.filter(m => m.role === 'tool').map(m => String(m.content)).join('\n');
      const has = (m) => toolText.includes(m);
      const base = { input_tokens: 100 + messages.length * 5, output_tokens: 30,
                     cost_usd: 0.0001, duration_ms: 5,
                     degrade: degradeAt === calls ? { subsystem: 'model', reason: 'primary down, using fallback' } : null };
      const tc = (id, name, args) => ({ ...base, content: `step ${calls}`, finish: false,
                                        tool_calls: [{ id, name, args }] });
      if (!has('wrote a.txt')) return tc('tc1', 'write', { path: 'a.txt', content: 'alpha\nVALUE=1\n' });
      if (!has('wrote b.txt')) return tc('tc2', 'write', { path: 'b.txt', content: 'beta\nVALUE=2\n' });
      if (!has('a.txt:2'))     return tc('tc3', 'grep',  { pattern: 'VALUE', path: '.' });
      if (!has('edited b.txt'))return tc('tc4', 'edit',  { path: 'b.txt', old_string: 'VALUE=2', new_string: 'VALUE=20' });
      if (!has('CHECK-OK'))    return tc('tc5', 'bash',  { cmd: 'echo CHECK-OK' });
      const marker = nondeterministic ? ` [nonce ${Math.random().toString(16).slice(2, 8)}]` : '';
      return { ...base, content: `Created a.txt and b.txt, bumped VALUE to 20.${marker}`, tool_calls: [], finish: true };
    },
  };
}
