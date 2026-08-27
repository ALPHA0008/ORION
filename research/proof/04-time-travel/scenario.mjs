// A single agent scenario shared by all acceptance tests, so results are comparable.
// Task: build a 3-file mini project, edit it, run a check, summarise.
import { makeScriptedModel } from './worker.mjs';

export function buildScript() {
  // Deterministic policy keyed on what the agent has already observed.
  const done = (s, marker) => s.recent_messages.some(m => m.role === 'tool' && String(m.content).includes(marker));
  return [
    { when: s => !done(s, 'wrote a.txt'),
      reply: { content: 'Creating a.txt', tool_calls: [{ id: 'tc1', name: 'write',
        args: { path: 'a.txt', content: 'alpha\nVALUE=1\n' } }] } },
    { when: s => !done(s, 'wrote b.txt'),
      reply: { content: 'Creating b.txt', tool_calls: [{ id: 'tc2', name: 'write',
        args: { path: 'b.txt', content: 'beta\nVALUE=2\n' } }] } },
    { when: s => !done(s, 'wrote c.txt'),
      reply: { content: 'Creating c.txt', tool_calls: [{ id: 'tc3', name: 'write',
        args: { path: 'c.txt', content: 'gamma\nVALUE=3\n' } }] } },
    { when: s => !done(s, 'a.txt:2'),
      reply: { content: 'Locating VALUE lines', tool_calls: [{ id: 'tc4', name: 'grep',
        args: { pattern: 'VALUE', path: '.' } }] } },
    { when: s => !done(s, 'edited b.txt'),
      reply: { content: 'Bumping b', tool_calls: [{ id: 'tc5', name: 'edit',
        args: { path: 'b.txt', old_string: 'VALUE=2', new_string: 'VALUE=20' } }] } },
    { when: s => !done(s, 'CHECK-OK'),
      reply: { content: 'Verifying', tool_calls: [{ id: 'tc6', name: 'bash',
        args: { cmd: 'cat b.txt | grep -q "VALUE=20" && echo CHECK-OK' } }] } },
    { when: () => true,
      reply: { content: 'Created 3 files, bumped b.txt VALUE to 20, verified CHECK-OK.', finish: true } },
  ];
}

export const model = (opts = {}) => makeScriptedModel(buildScript(), opts);
