// Evaluate candidate diagnostic strategies (brief §6) BEFORE implementing one.
//
// Measures, against real pinned sources, what each strategy would tell the model and how many
// bytes it costs. The context budget matters: MSG_CLAMP is 2,000 bytes, so a diagnostic that
// blows past it would be truncated — reintroducing the invisibility this is meant to remove.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { REPOSITORIES } from '../repositories/index.mjs';
import { MSG_CLAMP } from '../../../v0/src/core/projection/index.mjs';

const CACHE = path.join(os.tmpdir(), 'harness-real-eval', '_cache');
const pinned = (id, rel) => execFileSync('git',
  ['--git-dir', path.join(CACHE, `${id}.git`), 'show', `${REPOSITORIES[id].commit}:${rel}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The real captured failure.
const src = pinned('p-limit', 'index.js');
const old = '\t\tconst next = () => {\n\t\t\tactiveCount--;';

const vis = (s) => s.replace(/\t/g, '→').replace(/ /g, '·');
const stripIndent = (s) => s.split('\n').map(l => l.replace(/^[ \t]+/, '')).join('\n');

/** Locate the best candidate region by indent-insensitive match. */
function locate(src, old) {
  const sN = stripIndent(src), oN = stripIndent(old);
  const at = sN.indexOf(oN);
  if (at < 0) return null;
  const line = sN.slice(0, at).split('\n').length;      // 1-based
  const lines = src.split('\n');
  const span = old.split('\n').length;
  return { line, lines: lines.slice(line - 1, line - 1 + span) };
}

const STRATEGIES = {
  'A basic structural': () => {
    const loc = locate(src, old);
    return `old_string not found in index.js\n`
      + `nearest candidate at lines ${loc.line}-${loc.line + loc.lines.length - 1}:\n`
      + loc.lines.join('\n');
  },

  'B whitespace-aware': () => {
    const loc = locate(src, old);
    return `old_string not found in index.js — the text matches except for INDENTATION.\n`
      + `at line ${loc.line}, the file has (→=tab ·=space):\n`
      + loc.lines.map(l => vis(l)).join('\n');
  },

  'C similarity only': () => {
    const loc = locate(src, old);
    return `old_string not found in index.js. Closest region: lines ${loc.line}-`
      + `${loc.line + loc.lines.length - 1}.`;
  },

  'D content hash': () => {
    const loc = locate(src, old);
    const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
    return `old_string not found in index.js\nrequested sha256=${h(old)}\n`
      + `region at line ${loc.line} sha256=${h(loc.lines.join('\n'))}`;
  },

  'E combined minimal': () => {
    const loc = locate(src, old);
    return `old_string not found in index.js — matches at line ${loc.line} except for whitespace.\n`
      + `The file has exactly (→=tab, ·=space):\n`
      + loc.lines.map(l => vis(l)).join('\n') + '\n'
      + `Copy that text verbatim (converting → back to tabs) as old_string.`;
  },

  'X whole file (rejected)': () => `old_string not found in index.js\nfile contents:\n${src}`,
};

console.log(`MSG_CLAMP = ${MSG_CLAMP} bytes\n`);
console.log('strategy                 bytes  fits  identifies-cause  gives-exact-bytes');
console.log('─'.repeat(78));
for (const [name, fn] of Object.entries(STRATEGIES)) {
  const out = fn();
  const bytes = Buffer.byteLength(out);
  const fits = bytes <= MSG_CLAMP;
  const cause = /INDENTATION|whitespace|except for/i.test(out);
  const exact = /→|·/.test(out);
  console.log(`${name.padEnd(24)} ${String(bytes).padStart(5)}  ${fits ? 'yes ' : 'NO  '}  ` +
              `${cause ? 'yes' : 'no '}               ${exact ? 'yes' : 'no'}`);
}

console.log('\n─── Strategy E rendered ───');
console.log(STRATEGIES['E combined minimal']());
