// Minimal probe: can this model emit a literal TAB inside a tool-call string argument?
//
// The interface probe showed a clean split — space-indented file 2/2 correct, tab-indented file
// 0/2 with six consecutive `old_string not found`. This isolates the mechanism: capture the raw
// bytes the model puts in `old_string` and see whether a tab is ever present.
//
// Offline. Touches no production code.

import { createOpenAICompatModel } from '../../../v0/src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../../v0/src/agent/model/shims/gemma-tool-calls.mjs';

const model = createOpenAICompatModel({
  baseUrl: process.env.HARNESS_BASE_URL, apiKey: process.env.HARNESS_API_KEY,
  model: process.env.HARNESS_MODEL, timeoutMs: 120_000, maxRetries: 2,
  shims: [applyGemmaToolCallShim],
});

const echo = [{
  type: 'function',
  function: {
    name: 'echo',
    description: 'Echo a string back verbatim.',
    parameters: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
  },
}];

const PROMPTS = [
  ['plain-tab', 'Call echo with text set to exactly one TAB character followed by "const x = 1;". '
    + 'The first character must be a real tab (U+0009), not spaces.'],
  ['copy-tabbed-line', 'Here is a line from a file, where → marks a real tab character:\n'
    + '→const resumeNext = () => {\n\n'
    + 'Call echo with text set to that exact line, converting → back into a real tab character.'],
  ['two-tabs', 'Call echo with text set to exactly two TAB characters followed by "activeCount--;". '
    + 'Use real tab characters (U+0009).'],
];

console.log(`tab probe — model=${process.env.HARNESS_MODEL}`);
console.log('─'.repeat(78));
for (const [id, prompt] of PROMPTS) {
  for (let rep = 0; rep < 2; rep++) {
    let resp;
    try {
      resp = await model.invoke({
        messages: [{ role: 'user', content: prompt }],
        tools: echo,
      });
    } catch (e) { console.log(`  ${id} #${rep}  MODEL ERROR ${String(e.message).slice(0, 60)}`); continue; }

    const tc = (resp.tool_calls ?? [])[0];
    if (!tc) { console.log(`  ${id} #${rep}  no tool call; text="${String(resp.content).slice(0, 60)}"`); continue; }
    const text = String(tc.args?.text ?? '');
    const tabs = (text.match(/\t/g) ?? []).length;
    const leadSpaces = (/^ +/.exec(text) ?? [''])[0].length;
    console.log(`  ${id.padEnd(18)} #${rep}  tabs=${tabs} leading_spaces=${leadSpaces}  raw=${JSON.stringify(text.slice(0, 46))}`);
  }
}
