// Part C — repeatability analysis for the 8 HIGH-confidence failure tasks.
//
// SCOPE, stated here because it is easy to lose: these 8 are the HIGH-confidence failures only
// (2 long-horizon + 4 editing + 2 termination) out of a 14-failure distribution of 6+4+4. The 6
// MEDIUM-confidence failures remain at n=1. This measures repeatability FOR THESE EIGHT; it does
// not replicate the Stage-1 distribution.
//
// The n=3 labels (STABLE_SUCCESS / STABLE_FAILURE / HIGH_VARIANCE) are only applied where 3 runs
// actually exist — the same discipline that forbade using them at n=1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../v0/src/core/run/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'runs', 'repeats');
const DOCS = path.join(HERE, '..', '..', 'research', 'capability-v1');
const B = '`';

/** Mechanism at first causal divergence — same rules as failure-table.mjs, applied per repeat. */
function mechanism(r, ev) {
  if (r.task_success) return 'PASS';
  if (r.outcome === 'INFRA' || r.run_error) return 'environment/infrastructure';
  if (r.timed_out) return 'long-horizon execution';

  const started = ev.filter(e => e.type === 'tool.started');
  const succeeded = ev.filter(e => e.type === 'tool.succeeded');
  const pathOf = (e) => started.find(x => x.payload.tool_call_id === e.payload.tool_call_id)
    ?.payload?.args?.path ?? '';
  const isTest = (p) => /(^|[\\/])tests?[\\/]|(^|[\\/])testing[\\/]|test_[^\\/]*\.py$/i.test(p);
  const isScratch = (p) => /(^|[\\/])(reproduce|repro|scratch|test_repro)[^\\/]*\.py$/i.test(p)
                        || /(^|[\\/])repro[\\/]/i.test(p);

  const muts = succeeded.filter(e => ['write', 'edit'].includes(e.payload.name));
  const srcMut = muts.filter(e => { const p = pathOf(e); return p && !isTest(p) && !isScratch(p); });

  // diff_stat is authoritative on whether the WORLD changed (bash writes are invisible to the
  // tool-level log — see research/mutation-observability/).
  const lines = String(r.diff_stat ?? '').split(String.fromCharCode(10)).filter(l => l.trim());
  const worldChanged = lines.length > 0;
  const onlyNew = worldChanged && lines.every(l => l.includes('(new file)'));

  if (srcMut.length === 0 && (!worldChanged || onlyNew))
    return /model_finished/.test(r.reason ?? '') ? 'termination' : 'long-horizon execution';
  if (r.fail_to_pass_now_passes === false) return 'editing';
  if (r.pass_to_pass_still_passes === false) return 'reasoning';
  return 'UNRESOLVED';
}

// ── gather ───────────────────────────────────────────────────────────────────
const byTask = new Map();
// RUN_LABEL selects which model's artifacts to analyse. Without it the classifier would glob the
// Gemma and Model-B artifacts together and silently average two different models into one
// "repeatability" table -- the arms must never be blended.
const LABEL = process.env.RUN_LABEL ?? 'gemma4-31b';
const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.json') && f.startsWith(LABEL + '-'));
if (!files.length) { console.error(`no artifacts for label "${LABEL}" in ${DIR}`); process.exit(1); }
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const r = d.results[0];
  let ev = [];
  if (r.db && fs.existsSync(r.db)) {
    try { const s = new Store(r.db); ev = s.events(r.run_id); s.close(); } catch { /* unreadable */ }
  }
  const rec = byTask.get(r.task_id) ?? { task_id: r.task_id, repository: r.repository, runs: [] };
  rec.runs.push({
    repeat: d.repeat_index, success: !!r.task_success, reason: r.reason ?? r.outcome,
    mechanism: mechanism(r, ev),
    tool_calls: r.metrics?.tool_calls ?? 0,
    diff: String(r.diff_stat ?? '').split(String.fromCharCode(10)).filter(Boolean)
      .map(l => l.split('|')[0].trim()).filter(Boolean).join(', '),
  });
  byTask.set(r.task_id, rec);
}
for (const rec of byTask.values()) rec.runs.sort((a, b) => a.repeat - b.repeat);

// ── classify ─────────────────────────────────────────────────────────────────
const N_REQUIRED = 3;
for (const rec of byTask.values()) {
  const n = rec.runs.length;
  const passes = rec.runs.filter(r => r.success).length;
  rec.n = n;
  if (n < N_REQUIRED) {
    // The same rule that forbade labelling at n=1 applies to an incomplete n=2.
    rec.label = `INCOMPLETE (n=${n})`;
    rec.mechanism_stable = null;
  } else {
    rec.label = passes === n ? 'STABLE_SUCCESS' : passes === 0 ? 'STABLE_FAILURE' : 'HIGH_VARIANCE';
    const mechs = new Set(rec.runs.filter(r => !r.success).map(r => r.mechanism));
    // A mechanism that changes between repeats is NOT stable, even if the outcome is.
    rec.mechanism_stable = mechs.size <= 1;
    rec.mechanisms = [...mechs];
  }
}

const rows = [...byTask.values()].sort((a, b) => a.task_id.localeCompare(b.task_id));
fs.mkdirSync(path.join(HERE, 'reports'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'reports', process.env.REPEAT_REPORT ?? 'repeatability.json'),
  JSON.stringify({ at: new Date().toISOString(), n_required: N_REQUIRED, rows }, null, 2));

// ── document ─────────────────────────────────────────────────────────────────
const complete = rows.filter(r => r.n >= N_REQUIRED);
const L = [];
L.push('# Repeatability — the 8 HIGH-confidence failure tasks', '');
L.push('**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**');
L.push(`Corpus ${B}CAPABILITY_V1_STAGE1${B} · model ${B}${LABEL}${B} · n=${N_REQUIRED} · nothing tuned between repeats.`, '');
L.push('## Scope — what this does and does not measure', '');
L.push('These 8 are the **HIGH-confidence failures only**: 2 long-horizon + 4 editing + 2 termination,');
L.push('against a full Stage-1 distribution of **6 + 4 + 4**. The **6 MEDIUM-confidence failures remain');
L.push('at n=1** and are not touched here.', '');
L.push('> This tests repeatability **for these eight cases**. It does **not** replicate the Stage-1');
L.push('> failure distribution, and no claim in this file should be read as if it did.', '');
L.push('The Stage-1 baseline artifact was hashed before the study and re-checked after every run; it is');
L.push('byte-identical. Repeats live in `runs/repeats/`, each independently inspectable.', '');

L.push('## Per-task results', '', '| task | r1 | r2 | r3 | label | mechanism stable? |', '|---|---|---|---|---|---|');
for (const r of rows) {
  const cell = (i) => { const x = r.runs.find(v => v.repeat === i);
    return x ? (x.success ? '**PASS**' : x.mechanism) : '—'; };
  const ms = r.mechanism_stable === null ? '—' : (r.mechanism_stable ? 'yes' : '**NO**');
  L.push(`| ${B}${r.task_id}${B} | ${cell(1)} | ${cell(2)} | ${cell(3)} | ${r.label} | ${ms} |`);
}
L.push('');

const tally = {};
for (const r of complete) tally[r.label] = (tally[r.label] ?? 0) + 1;
L.push('## Outcome stability', '', '| label | count |', '|---|---|');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
L.push('');

const unstable = complete.filter(r => r.mechanism_stable === false);
L.push('## Mechanism stability', '');
if (complete.length === 0) L.push('_No task has reached n=3 yet._', '');
else {
  L.push(`Of ${complete.length} task(s) at n=${N_REQUIRED}, **${unstable.length}** changed mechanism between repeats.`, '');
  if (unstable.length) {
    L.push('| task | mechanisms observed |', '|---|---|');
    for (const r of unstable) L.push(`| ${B}${r.task_id}${B} | ${r.mechanisms.join(', ')} |`);
    L.push('');
    L.push('A mechanism that changes between repeats of the *same task* is **not stable**, even when');
    L.push('the pass/fail outcome is. This is the distinction that decides whether a mechanism can');
    L.push('support an intervention, and it is why outcome stability alone is not enough (§26).', '');
  }
}
// REPEAT_DOC keeps each model's write-up in its own file. Without it a Model-B run overwrites the
// Gemma repeatability document in place -- which happened once and was recovered from git.
fs.writeFileSync(path.join(DOCS, process.env.REPEAT_DOC ?? 'repeatability.md'), L.join('\n'));

console.log(`tasks: ${rows.length} · complete at n=${N_REQUIRED}: ${complete.length}`);
for (const r of rows)
  console.log(`  ${r.task_id.padEnd(28)} n=${r.n} ${String(r.label).padEnd(18)} `
    + r.runs.map(x => x.success ? 'PASS' : x.mechanism.slice(0, 12)).join(' | '));
console.log(`\nwrote research/capability-v1/repeatability.md`);
