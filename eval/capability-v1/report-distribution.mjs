// §16-17 — corpus distribution and the repository-dominance check.
//
// Generated, because the dominance number is exactly the kind of inconvenient fact that a
// hand-written summary quietly rounds off.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = '`';

const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', 'frozen-corpus.json'), 'utf8'));
const ft = JSON.parse(fs.readFileSync(path.join(HERE, 'reports', 'failure-table.json'), 'utf8'));

const byRepo = {};
for (const t of corpus.tasks) (byRepo[t.repository] ??= []).push(t);
const py = {};
for (const t of corpus.tasks) py[t.python] = (py[t.python] ?? 0) + 1;
const p2p = corpus.tasks.map(t => t.pass_to_pass.length).sort((a, b) => a - b);

// Failure accounting per arm present in the table.
const arms = ['gemma', 'qwen'].filter(a => ft.rows.some(r => r[a]));
const stats = {};
for (const arm of arms) {
  const tot = {}, fail = {}, mech = {};
  for (const r of ft.rows) {
    if (!r[arm]) continue;
    tot[r.repository] = (tot[r.repository] ?? 0) + 1;
    if (!r[arm].task_success) {
      fail[r.repository] = (fail[r.repository] ?? 0) + 1;
      const m = r[arm].diag.mechanism;
      (mech[m] ??= {})[r.repository] = ((mech[m] ?? {})[r.repository] ?? 0) + 1;
    }
  }
  stats[arm] = { tot, fail, mech, F: Object.values(fail).reduce((a, b) => a + b, 0) };
}

const L = [];
L.push('# Corpus Distribution (§16-17)', '');
L.push('**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**', '');
L.push(`Corpus ${B}${corpus.corpus_version}${B} · sha256 ${B}${corpus.corpus_sha256.slice(0, 24)}…${B} · **${corpus.count} tasks**`, '');

L.push('## What the corpus IS', '', '| dimension | distribution |', '|---|---|');
L.push(`| repositories | ${Object.entries(byRepo).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} **${v.length}**`).join(' · ')} |`);
L.push(`| languages | Python ${corpus.count}/${corpus.count} (100%) |`);
L.push(`| test frameworks | pytest ${corpus.count}/${corpus.count} (100%) |`);
L.push(`| interpreters | ${Object.entries(py).map(([k, v]) => `${k} × ${v}`).join(' · ')} |`);
L.push('| files touched by gold patch | **exactly 1 in every task** |');
L.push(`| declared PASS_TO_PASS | min ${p2p[0]} · median ${p2p[Math.floor(p2p.length / 2)]} · max ${p2p.at(-1)} |`, '');

for (const arm of arms) {
  const { tot, fail, mech, F } = stats[arm];
  const name = arm === 'gemma' ? 'Gemma' : 'Qwen';
  L.push(`## Failure distribution by repository — ${name} (n=1)`, '');
  L.push('| repository | tasks | failures | share of failures |', '|---|---|---|---|');
  for (const rp of Object.keys(tot).sort((a, b) => (fail[b] ?? 0) - (fail[a] ?? 0)))
    L.push(`| ${rp} | ${tot[rp]} | ${fail[rp] ?? 0} | **${F ? Math.round(100 * (fail[rp] ?? 0) / F) : 0}%** |`);
  const top = Math.max(0, ...Object.values(fail));
  L.push('', `Largest single-repository share of failures: **${F ? Math.round(100 * top / F) : 0}%**.`, '');

  L.push(`### Mechanism generalisation — ${name} (§25 filter)`, '');
  L.push('| mechanism | failures | repositories | spread |', '|---|---|---|---|');
  const entries = Object.entries(mech)
    .sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0));
  for (const [m, c] of entries) {
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    L.push(`| ${B}${m}${B} | ${n} | **${Object.keys(c).length}/4** | ${Object.entries(c).map(([k, v]) => `${k.split('/')[1]} ${v}`).join(', ')} |`);
  }
  L.push('');
}

L.push('## Why dominance alone does not settle the question', '');
L.push('Dominance in the failure **count** is not the same as dominance in the failure **mechanism**.');
L.push('A repository can contribute most of the failures while contributing none of the *generalising*');
L.push('ones. The generalisation table above is what decides whether a candidate bottleneck is a');
L.push('property of the agent or an artifact of one over-represented repository — which is precisely');
L.push('what the §25 filter exists to prevent optimising for.', '');

L.push('## What the corpus does NOT represent', '');
L.push('- **No multi-file change.** Every gold patch touches exactly one file. That is what SWE-bench');
L.push('  *Lite* is, not a filter we applied. This corpus cannot measure multi-file refactoring,');
L.push('  cross-module reasoning, or architectural change, and no result here may be read as if it could.');
L.push('- **One language, one test framework.** Python and pytest throughout.');
L.push('- **Not the hard end of the range.** django, sympy, matplotlib and the scientific stack were');
L.push(`  excluded for buildability (${B}corpus-selection.md${B}). The top of the difficulty range is truncated,`);
L.push('  so a *success* rate here does not transfer upward; a *failure* here probably does.');
L.push('- **Four repositories, two of them developer tooling** (pytest, pylint) with unusual test idioms.');
L.push('- **n=1 per task.** Nothing here supports a stability claim about any individual task (§4, §18).');

fs.writeFileSync(path.join(HERE, '..', '..', 'research', 'capability-v1', 'corpus-distribution.md'), L.join('\n'));
console.log('corpus-distribution.md written');
for (const arm of arms) {
  const { fail, F } = stats[arm];
  console.log(`  ${arm}: ${F} failures, top repo share ${F ? Math.round(100 * Math.max(...Object.values(fail)) / F) : 0}%`);
}
