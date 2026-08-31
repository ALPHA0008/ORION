// Qwen endpoint smoke test (brief §2–§3).
//
// Establishes, BEFORE any benchmarking, that the second model is actually usable through the
// SAME model interface the harness already has:
//   1. responds at all
//   2. follows the chat protocol
//   3. produces a tool call
//   4. accepts a tool result and continues
//
// It also records HOW the tool call arrives (native `tool_calls` vs text), which determines
// whether an adapter is needed and keeps MODEL EFFECT separable from ADAPTER EFFECT (§15).

import { createOpenAICompatModel } from '../../../v0/src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../../v0/src/agent/model/shims/gemma-tool-calls.mjs';

const BASE = process.env.HARNESS_BASE_URL;
const MODEL = process.env.HARNESS_MODEL;
const USE_SHIM = process.env.USE_SHIM === '1';

if (!BASE || !MODEL) { console.error('set HARNESS_BASE_URL and HARNESS_MODEL'); process.exit(2); }

const model = createOpenAICompatModel({
  baseUrl: BASE, apiKey: process.env.HARNESS_API_KEY ?? 'unused',
  model: MODEL, timeoutMs: 300_000, maxRetries: 1,
  shims: USE_SHIM ? [applyGemmaToolCallShim] : [],
});

const TOOLS = [{
  type: 'function',
  function: {
    name: 'read',
    description: 'Read a UTF-8 file from the workspace.',
    parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
  },
}];

console.log(`qwen smoke — model=${MODEL} base=${BASE} shim=${USE_SHIM}`);
console.log('─'.repeat(70));

// 1. plain response
{
  const t0 = Date.now();
  const r = await model.invoke({ messages: [{ role: 'user', content: 'Reply with exactly: OK' }], tools: [] });
  console.log(`1. plain response      : ${((Date.now() - t0) / 1000).toFixed(1)}s  content=${JSON.stringify(String(r.content).slice(0, 60))}`);
  console.log(`   tokens in=${r.input_tokens} out=${r.output_tokens}`);
  console.log(`   ext keys: ${JSON.stringify(Object.keys(r.ext ?? {}))}`);
}

// 2. tool call
let firstCall = null;
{
  const t0 = Date.now();
  const r = await model.invoke({
    messages: [
      { role: 'system', content: 'You are a coding agent. Use the tools provided.' },
      { role: 'user', content: 'Read the file src/index.js and tell me what it contains.' },
    ],
    tools: TOOLS,
  });
  firstCall = (r.tool_calls ?? [])[0];
  console.log(`2. tool call           : ${((Date.now() - t0) / 1000).toFixed(1)}s  calls=${(r.tool_calls ?? []).length}`);
  console.log(`   name=${firstCall?.name} args=${JSON.stringify(firstCall?.args)}`);
  console.log(`   shimmed=${r.ext?.shimmed ?? false}  content_when_calling=${JSON.stringify(String(r.content ?? '').slice(0, 80))}`);
}

// 3. continue after a tool result
if (firstCall) {
  const t0 = Date.now();
  const r = await model.invoke({
    messages: [
      { role: 'system', content: 'You are a coding agent. Use the tools provided.' },
      { role: 'user', content: 'Read the file src/index.js and tell me what it contains.' },
      { role: 'assistant', content: '',
        tool_calls: [{ id: firstCall.id, type: 'function',
                       function: { name: firstCall.name, arguments: JSON.stringify(firstCall.args ?? {}) } }] },
      { role: 'tool', tool_call_id: firstCall.id, content: 'export const VERSION = 42;' },
    ],
    tools: TOOLS,
  });
  const saw42 = /42/.test(String(r.content ?? ''));
  console.log(`3. continue after tool : ${((Date.now() - t0) / 1000).toFixed(1)}s  used_result=${saw42}`);
  console.log(`   content=${JSON.stringify(String(r.content ?? '').slice(0, 100))}`);
  console.log(`\nVERDICT: ${saw42 ? 'usable through the existing model interface' : 'DID NOT use the tool result — investigate before benchmarking'}`);
} else {
  console.log('\nVERDICT: no tool call produced — an adapter is required before benchmarking');
}
