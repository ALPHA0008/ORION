// Offline tool-choice experiment (brief §4-§7).
//
// QUESTION: does changing the TOOL INTERFACE change whether the model uses edit or write?
//
// This is an OFFLINE probe. The experimental interfaces (edit_range, patch) are implemented
// ONLY inside this file, against a scratch sandbox. They are NOT wired into the production
// runtime, the worker, the tool registry, or the real-eval runner. Per the critical rule of
// this phase, nothing here changes the shipped tool contract.
//
// DESIGN
//   Interface A (current)      : edit(path, old_string, new_string) + write(path, content)
//   Interface C (line-range)   : edit_range(path, start_line, end_line, replacement) + write
//   Interface B (patch)        : patch(path, diff) + write
//
// The underlying editing task is IDENTICAL across interfaces. Only the tool surface differs.
// Cases deliberately span easy (unique exact substring) through hard (tabs, repeats, long
// functions) so that "edit is inconvenient" can be separated from "model just prefers write".
//
// SAFETY: every experimental primitive keeps the production discipline — exact precondition,
// safe failure, verifiable effect. No fuzzy matching anywhere. A candidate that cannot fail
// closed is not a candidate.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenAICompatModel } from '../../../v0/src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../../v0/src/agent/model/shims/gemma-tool-calls.mjs';

// ── cases ────────────────────────────────────────────────────────────────────
// Real-shaped sources. TAB-indented ones mirror p-limit/camelcase/slugify, which is where
// every observed indentation mismatch occurred.

const TABBED = `import Queue from 'yocto-queue';

export default function pLimit(concurrency) {
	const queue = new Queue();
	let activeCount = 0;

	const resumeNext = () => {
		if (activeCount < concurrency && queue.size > 0) {
			activeCount++;
			queue.dequeue().run();
		}
	};

	const next = () => {
		activeCount--;
		resumeNext();
	};

	return next;
}
`;

const SPACED = TABBED.replace(/\t/g, '  ');

const REPEATED = `export function alpha(x) {
	let t = 0;
	for (const i of x) { t += i; }
	return t;
}

export function beta(x) {
	let t = 0;
	for (const i of x) { t += i; }
	return t;
}

export function gamma(x) {
	let t = 0;
	for (const i of x) { t += i; }
	return t;
}
`;

const LONG = `export function process(batch, options = {}) {
${Array.from({ length: 40 }, (_, i) => `\tconst step${i} = batch.filter(b => b.kind === '${i}');`).join('\n')}
	const total = batch.length;
	return { total, ok: true };
}
`;

export const CASES = [
  { id: 'easy-unique-spaces', difficulty: 'easy', file: 'index.js', src: SPACED,
    instruction: 'In index.js, change `activeCount--;` to `activeCount -= 1;`. Change nothing else.',
    check: (s) => s.includes('activeCount -= 1;') && !s.includes('activeCount--;') },

  { id: 'easy-unique-tabs', difficulty: 'easy', file: 'index.js', src: TABBED,
    instruction: 'In index.js, change `activeCount--;` to `activeCount -= 1;`. Change nothing else.',
    check: (s) => s.includes('activeCount -= 1;') && !s.includes('activeCount--;') },

  { id: 'hard-tabs-multiline', difficulty: 'hard', file: 'index.js', src: TABBED,
    instruction: 'In index.js, the resumeNext function uses `<` in its concurrency check. '
      + 'Change that comparison to `<=`. Change nothing else.',
    check: (s) => s.includes('activeCount <= concurrency') && !s.includes('activeCount < concurrency') },

  { id: 'hard-repeated-regions', difficulty: 'hard', file: 'index.js', src: REPEATED,
    instruction: 'In index.js, change ONLY the body of the `beta` function so it returns `t * 2` '
      + 'instead of `t`. Leave alpha and gamma untouched.',
    check: (s) => {
      const m = /export function beta\(x\) \{[\s\S]*?\n\}/.exec(s);
      return !!m && /return t \* 2;/.test(m[0])
        && /export function alpha[\s\S]*?return t;\n\}/.test(s)
        && /export function gamma[\s\S]*?return t;\n\}/.test(s);
    } },

  { id: 'hard-long-file', difficulty: 'hard', file: 'index.js', src: LONG,
    instruction: 'In index.js, change the returned object so it includes `ok: false` instead of '
      + '`ok: true`. Change nothing else.',
    check: (s) => s.includes('ok: false') && !s.includes('ok: true') },
];

// ── experimental primitives (offline only) ───────────────────────────────────

const readFile = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const writeFile = (dir, f, c) => fs.writeFileSync(path.join(dir, f), c);

function toolsFor(iface, dir, log) {
  const write = {
    name: 'write',
    description: 'Write the FULL content of a file (creates or replaces).',
    parameters: { type: 'object', required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } } },
    run: ({ path: p, content }) => { writeFile(dir, p, content); log.push({ tool: 'write', ok: true, bytes: Buffer.byteLength(content) }); return `wrote ${p}`; },
  };

  if (iface === 'A') {
    return [{
      name: 'edit',
      description: 'Replace an exact unique substring in a file.',
      parameters: { type: 'object', required: ['path', 'old_string', 'new_string'],
        properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } } },
      run: ({ path: p, old_string, new_string }) => {
        const cur = readFile(dir, p);
        const n = cur.split(old_string).length - 1;
        if (n === 0) { log.push({ tool: 'edit', ok: false, why: 'not_found' }); throw new Error(`old_string not found in ${p}`); }
        if (n > 1) { log.push({ tool: 'edit', ok: false, why: 'ambiguous' }); throw new Error(`old_string is ambiguous in ${p} (${n} matches)`); }
        writeFile(dir, p, cur.replace(old_string, new_string));
        log.push({ tool: 'edit', ok: true });
        return `edited ${p}`;
      },
    }, write];
  }

  if (iface === 'C') {
    return [{
      name: 'edit_range',
      description: 'Replace lines start_line..end_line (1-based, inclusive) of a file with '
        + 'replacement text. Line numbers come from the numbered output of read.',
      parameters: { type: 'object', required: ['path', 'start_line', 'end_line', 'replacement'],
        properties: { path: { type: 'string' }, start_line: { type: 'integer' },
                      end_line: { type: 'integer' }, replacement: { type: 'string' } } },
      run: ({ path: p, start_line, end_line, replacement }) => {
        const lines = readFile(dir, p).split('\n');
        if (start_line < 1 || end_line > lines.length || end_line < start_line) {
          log.push({ tool: 'edit_range', ok: false, why: 'bad_range' });
          throw new Error(`invalid range ${start_line}-${end_line} (file has ${lines.length} lines)`);
        }
        const out = [...lines.slice(0, start_line - 1), ...replacement.split('\n'), ...lines.slice(end_line)];
        writeFile(dir, p, out.join('\n'));
        log.push({ tool: 'edit_range', ok: true });
        return `replaced lines ${start_line}-${end_line} of ${p}`;
      },
    }, write];
  }

  // Interface B — unified-diff patch with exact context matching
  return [{
    name: 'patch',
    description: 'Apply a unified diff to a file. Context and removed lines must match exactly.',
    parameters: { type: 'object', required: ['path', 'diff'],
      properties: { path: { type: 'string' }, diff: { type: 'string' } } },
    run: ({ path: p, diff }) => {
      const cur = readFile(dir, p).split('\n');
      const hunks = String(diff).split(/^@@.*$/m).slice(1);
      if (!hunks.length) { log.push({ tool: 'patch', ok: false, why: 'no_hunk' }); throw new Error('no @@ hunk header found'); }
      let out = cur.slice();
      for (const h of hunks) {
        const want = [], repl = [];
        for (const raw of h.split('\n')) {
          if (!raw) continue;
          const tag = raw[0], body = raw.slice(1);
          if (tag === ' ') { want.push(body); repl.push(body); }
          else if (tag === '-') want.push(body);
          else if (tag === '+') repl.push(body);
        }
        const idx = findBlock(out, want);
        if (idx < 0) { log.push({ tool: 'patch', ok: false, why: 'context_mismatch' }); throw new Error('hunk context does not match the file'); }
        out = [...out.slice(0, idx), ...repl, ...out.slice(idx + want.length)];
      }
      writeFile(dir, p, out.join('\n'));
      log.push({ tool: 'patch', ok: true });
      return `patched ${p}`;
    },
  }, write];
}

function findBlock(lines, want) {
  if (!want.length) return -1;
  for (let i = 0; i + want.length <= lines.length; i++) {
    let hit = true;
    for (let j = 0; j < want.length; j++) if (lines[i + j] !== want[j]) { hit = false; break; }
    if (hit) return i;
  }
  return -1;
}

// ── driver ───────────────────────────────────────────────────────────────────

const SYSTEM = 'You are a coding agent. Use the provided tools to make the requested change to '
  + 'the file, then stop. Do not explain at length. Make the minimal change requested.';

// Two renderings, so the probe can separate "substring editing is hard" from
// "our numbered-read format corrupts the indentation the model copies from".
//   'tab'  = production format: N + TAB + content  (separator merges with real indentation)
//   'pipe' = N + ' | ' + content                   (separator cannot be mistaken for indent)
function numbered(src, style = process.env.NUMBER_STYLE ?? 'tab') {
  const l = src.split('\n');
  const w = String(l.length).length;
  const sep = style === 'pipe' ? ' | ' : '\t';
  return l.map((s, i) => `${String(i + 1).padStart(w)}${sep}${s}`).join('\n');
}

async function runCase(model, iface, kase, rep) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iface-'));
  writeFile(dir, kase.file, kase.src);
  const log = [];
  const tools = toolsFor(iface, dir, log);
  const defs = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `File ${kase.file} (numbered for reference):\n\n${numbered(kase.src)}\n\nTask: ${kase.instruction}` },
  ];

  let calls = 0, inTok = 0, outTok = 0;
  for (let turn = 0; turn < 6; turn++) {
    let resp;
    try { resp = await model.invoke({ messages, tools: defs }); }
    catch (e) { log.push({ tool: '(model)', ok: false, why: String(e.message).slice(0, 80) }); break; }
    inTok += resp.input_tokens || 0; outTok += resp.output_tokens || 0;
    const tcs = resp.tool_calls ?? [];
    messages.push({ role: 'assistant', content: resp.content ?? '',
      ...(tcs.length ? { tool_calls: tcs.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) } })) } : {}) });
    if (!tcs.length) break;
    for (const tc of tcs) {
      calls++;
      const tool = byName[tc.name];
      let content;
      if (!tool) content = `unknown tool ${tc.name}`;
      else { try { content = tool.run(tc.args ?? {}); } catch (e) { content = `ERROR: ${e.message}`; } }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(content) });
    }
  }

  const final = readFile(dir, kase.file);
  const correct = kase.check(final);
  // Did unrelated content survive? Compare non-target line count as a crude integrity signal.
  const intact = Math.abs(final.split('\n').length - kase.src.split('\n').length) <= 3;
  fs.rmSync(dir, { recursive: true, force: true });

  return {
    interface: iface, case: kase.id, difficulty: kase.difficulty, repeat: rep,
    correct, intact, tool_calls: calls,
    used: log.map(l => `${l.tool}${l.ok ? '' : ':' + (l.why ?? 'fail')}`),
    edit_attempts: log.filter(l => ['edit', 'edit_range', 'patch'].includes(l.tool)).length,
    edit_failures: log.filter(l => ['edit', 'edit_range', 'patch'].includes(l.tool) && !l.ok).length,
    writes: log.filter(l => l.tool === 'write').length,
    write_bytes: log.filter(l => l.tool === 'write').reduce((a, l) => a + (l.bytes || 0), 0),
    input_tokens: inTok, output_tokens: outTok,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

if (!process.env.HARNESS_BASE_URL) { console.error('No model configured.'); process.exit(2); }
const model = createOpenAICompatModel({
  baseUrl: process.env.HARNESS_BASE_URL, apiKey: process.env.HARNESS_API_KEY,
  model: process.env.HARNESS_MODEL, timeoutMs: 120_000, maxRetries: 2,
  shims: [applyGemmaToolCallShim],
});

const ifaces = (process.env.IFACES ?? 'A,C,B').split(',');
const repeats = Number(process.env.IFACE_REPEATS ?? 2);
const only = process.env.ONLY_CASE;
const results = [];

console.log(`interface probe — model=${process.env.HARNESS_MODEL} interfaces=${ifaces.join(',')} repeats=${repeats}`);
console.log('─'.repeat(96));
for (const iface of ifaces) {
  for (const kase of CASES) {
    if (only && kase.id !== only) continue;
    for (let r = 0; r < repeats; r++) {
      const x = await runCase(model, iface, kase, r);
      results.push(x);
      console.log(`  ${iface}  ${x.case.padEnd(22)} #${r}  ${x.correct ? 'OK  ' : 'WRONG'} ` +
        `calls=${String(x.tool_calls).padStart(2)} editFail=${x.edit_failures} writes=${x.writes} ` +
        `out=${String(x.output_tokens).padStart(5)}  ${x.used.join(' ')}`);
    }
  }
}

const out = process.env.IFACE_OUT ?? path.join(process.cwd(), 'eval', 'real', 'reports', 'interface-probe.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ model: process.env.HARNESS_MODEL, at: new Date().toISOString(), repeats, results }, null, 2));

console.log('─'.repeat(96));
for (const iface of ifaces) {
  const rs = results.filter(r => r.interface === iface);
  if (!rs.length) continue;
  const c = rs.filter(r => r.correct).length;
  const w = rs.filter(r => r.writes > 0).length;
  const ef = rs.reduce((a, r) => a + r.edit_failures, 0);
  console.log(`  ${iface}: correct ${c}/${rs.length}  used-write ${w}/${rs.length}  ` +
    `edit-failures ${ef}  mean-out-tokens ${Math.round(rs.reduce((a, r) => a + r.output_tokens, 0) / rs.length)}`);
}
console.log(`\nwrote ${out}`);
