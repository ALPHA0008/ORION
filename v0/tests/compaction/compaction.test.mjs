// Context compaction (compact.mjs).
//
// The dangerous failure mode is eliding something the agent still needs. These tests exist
// mainly to prove that CANNOT happen: the newest result for any target is always kept whole.

import { compactMessages, findSuperseded } from '../../src/core/projection/compact.mjs';
import { repairOrphans } from '../../src/agent/loop/worker.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const big = (s) => s.repeat(400);                       // ~comfortably over minBytes
const call = (id, name, args) => ({ role: 'assistant', content: '',
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const result = (id, content) => ({ role: 'tool', tool_call_id: id, content });



// ── 1. two reads of the same path: only the older is elided ─────────────
{
  const msgs = [
    { role: 'system', content: 'sys' },
    call('a', 'read', { path: 'x.js' }), result('a', big('OLD ')),
    call('b', 'read', { path: 'x.js' }), result('b', big('NEW ')),
  ];
  const { messages, elided } = compactMessages(msgs);
  ok('elides exactly one of two reads of same path', elided === 1, `elided=${elided}`);
  ok('OLDER read is the one elided', /superseded/.test(messages[2].content));
  ok('NEWEST read kept verbatim', messages[4].content === big('NEW '));
}

// ── 2. different paths are never confused ───────────────────────────────
{
  const msgs = [
    call('a', 'read', { path: 'x.js' }), result('a', big('X ')),
    call('b', 'read', { path: 'y.js' }), result('b', big('Y ')),
  ];
  const { elided } = compactMessages(msgs);
  ok('distinct paths are not superseded', elided === 0, `elided=${elided}`);
}

// ── 3. a write supersedes an earlier read of the same path ──────────────
{
  const msgs = [
    call('a', 'read',  { path: 'x.js' }), result('a', big('BEFORE ')),
    call('b', 'write', { path: 'x.js', content: 'zz' }), result('b', 'wrote x.js'),
  ];
  const { messages, elided } = compactMessages(msgs);
  ok('write supersedes prior read', elided === 1 && /superseded/.test(messages[1].content));
}

// ── 4. THE SAFETY PROPERTY: the last result per path always survives ────
{
  const paths = ['a.js', 'b.js', 'c.js'];
  const msgs = [];
  // read each path 3 times, interleaved
  for (let round = 0; round < 3; round++)
    for (const p of paths) {
      const id = `${p}-${round}`;
      msgs.push(call(id, 'read', { path: p }), result(id, big(`${p}#${round} `)));
    }
  const { messages } = compactMessages(msgs);
  const survivors = messages.filter(m => m.role === 'tool' && !/superseded/.test(m.content));
  ok('exactly one surviving result per path', survivors.length === paths.length,
     `survivors=${survivors.length}`);
  ok('survivor is the LATEST round for every path',
     survivors.every(m => m.content.startsWith(m.tool_call_id.split('-')[0] + '#2')));
}

// ── 5. duplicate identical calls (no path) are deduped ──────────────────
{
  const msgs = [
    call('a', 'bash', { cmd: 'ls -R' }), result('a', big('LISTING ')),
    call('b', 'bash', { cmd: 'ls -R' }), result('b', big('LISTING ')),
  ];
  const { elided } = compactMessages(msgs);
  ok('identical repeated command elided once', elided === 1, `elided=${elided}`);
}

// ── 6. distinct commands are untouched ──────────────────────────────────
{
  const msgs = [
    call('a', 'bash', { cmd: 'node test/a.mjs' }), result('a', big('A ')),
    call('b', 'bash', { cmd: 'node test/b.mjs' }), result('b', big('B ')),
  ];
  ok('distinct commands untouched', compactMessages(msgs).elided === 0);
}

// ── 7. never grows a message; small results left alone ──────────────────
{
  const msgs = [
    call('a', 'read', { path: 'x.js' }), result('a', 'tiny'),
    call('b', 'read', { path: 'x.js' }), result('b', 'tiny2'),
  ];
  const { messages, elided, bytesSaved } = compactMessages(msgs);
  ok('small results are not elided', elided === 0 && bytesSaved === 0);
  ok('no message grew', messages.every((m, i) =>
       String(m.content ?? '').length <= String(msgs[i].content ?? '').length));
}

// ── 8. output stays a valid provider transcript ─────────────────────────
{
  const msgs = [
    { role: 'system', content: 'sys' },
    call('a', 'read', { path: 'x.js' }), result('a', big('OLD ')),
    call('b', 'read', { path: 'x.js' }), result('b', big('NEW ')),
  ];
  const { messages } = compactMessages(msgs);
  ok('same message count', messages.length === msgs.length);
  ok('roles unchanged', messages.every((m, i) => m.role === msgs[i].role));
  ok('tool_call_ids preserved',
     messages.filter(m => m.role === 'tool').every((m, i) =>
       m.tool_call_id === msgs.filter(x => x.role === 'tool')[i].tool_call_id));
  ok('survives repairOrphans unchanged', repairOrphans(messages).length === messages.length);
}

// ── 9. determinism ──────────────────────────────────────────────────────
{
  const build = () => [
    call('a', 'read', { path: 'x.js' }), result('a', big('1 ')),
    call('b', 'read', { path: 'x.js' }), result('b', big('2 ')),
    call('c', 'bash', { cmd: 'ls' }),    result('c', big('3 ')),
  ];
  const r1 = JSON.stringify(compactMessages(build()).messages);
  const r2 = JSON.stringify(compactMessages(build()).messages);
  ok('deterministic across identical inputs', r1 === r2);
  // arg key order must not matter
  const m1 = [call('a', 'read', { path: 'x.js', limit: 5 }), result('a', big('A ')),
              call('b', 'read', { limit: 5, path: 'x.js' }), result('b', big('B '))];
  ok('arg key order does not affect supersession', compactMessages(m1).elided === 1);
}

// ── 10. malformed input must not throw ──────────────────────────────────
{
  const weird = [
    { role: 'assistant', tool_calls: [{ id: 'z', function: { name: 'read', arguments: '{bad json' } }] },
    result('z', big('Z ')),
    { role: 'tool', tool_call_id: 'orphan', content: 'no matching call' },
    { role: 'user', content: null },
  ];
  let threw = false;
  try { compactMessages(weird); findSuperseded(weird); } catch { threw = true; }
  ok('malformed messages do not throw', !threw);
}

console.log(`\ncompaction: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
