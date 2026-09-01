// Generate failure-table.md, failure-taxonomy.md and trajectory-analysis.md from the report JSON.
//
// Projected rather than transcribed. Every number in these documents has to be recomputable from
// reports/failure-table.json, which is itself derived from the durable event log plus diff_stat.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../v0/src/core/run/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, '..', '..', 'research', 'capability-v1');
const B = '`';

const ft = JSON.parse(fs.readFileSync(path.join(HERE, 'reports', 'failure-table.json'), 'utf8'));
const run = JSON.parse(fs.readFileSync(path.join(HERE, 'runs', 'gemma4-31b.json'), 'utf8'));
const byId = new Map(run.results.map(r => [r.task_id, r]));

const fails = ft.rows.filter(r => r.gemma && !r.gemma.task_success);
const passes = ft.rows.filter(r => r.gemma?.task_success);

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = esc(s); return t.length > n ? t.slice(0, n) + '…' : t; };

// ── failure-table.md ─────────────────────────────────────────────────────────
{
  const L = [];
  L.push('# Failure Table — Stage 1 (Gemma, the sole valid arm)', '');
  L.push('**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**', '');
  L.push(`Corpus ${B}${ft.corpus_sha256?.slice(0, 16)}…${B} · runtime ${B}${String(run.runtime_commit).slice(0, 7)}${B} · **n=1 per task**`, '');
  L.push('Qwen contributes **nothing** to this table — see `qwen-invalidation.md`.', '');
  L.push('Confidence is trajectory-evidence strength, not intuition:');
  L.push('**HIGH** = the divergence is visible in the trajectory together with the actor\'s action at');
  L.push('that moment · **MEDIUM** = inferred from surrounding trajectory evidence · **LOW** = inferred');
  L.push('without a direct trace.', '');

  L.push('| Task | Result | First causal divergence | Mechanism | Evidence | Confidence |');
  L.push('|---|---|---|---|---|---|');
  for (const r of fails) {
    const d = r.gemma.diag, m = byId.get(r.task_id)?.metrics ?? {};
    L.push(`| ${B}${r.task_id}${B} | FAIL | ${cut(d.divergence, 130)} | ${B}${d.mechanism}${B} | `
      + `${m.tool_calls ?? 0} calls, ${m.tool_failed ?? 0} failed, exit ${B}${r.gemma.reason}${B} | ${d.confidence} |`);
  }
  for (const r of passes) {
    const m = byId.get(r.task_id)?.metrics ?? {};
    L.push(`| ${B}${r.task_id}${B} | **PASS** | — | — | ${m.tool_calls ?? 0} calls | — |`);
  }
  L.push('');
  L.push('## Mechanisms are split by TERMINAL CONDITION, deliberately', '');
  L.push('An earlier cut of this table put 10 of 14 failures in one bucket called "premature');
  L.push('termination". That was a reporting artifact hiding two mechanisms that imply **opposite**');
  L.push('interventions:', '');
  L.push(`- ${B}termination${B} — the agent stopped because it **believed it was finished**`);
  L.push(`  (${B}model_finished${B}) while the world was unchanged.`);
  L.push(`- ${B}long-horizon execution${B} — the **runtime** had to stop it (${B}no_progress${B},`);
  L.push(`  ${B}max_turns${B}), typically mid-loop.`, '');
  L.push('Merging them would have pointed the first V1 intervention at whichever happened to be larger.', '');
  fs.writeFileSync(path.join(DOCS, 'failure-table.md'), L.join('\n'));
}

// ── failure-taxonomy.md ──────────────────────────────────────────────────────
{
  const mech = {};
  for (const r of fails) {
    const m = r.gemma.diag.mechanism;
    (mech[m] ??= { n: 0, repos: {}, conf: {}, tasks: [] });
    mech[m].n++;
    mech[m].repos[r.repository.split('/')[1]] = (mech[m].repos[r.repository.split('/')[1]] ?? 0) + 1;
    mech[m].conf[r.gemma.diag.confidence] = (mech[m].conf[r.gemma.diag.confidence] ?? 0) + 1;
    mech[m].tasks.push(r.task_id);
  }
  const L = [];
  L.push('# Failure Taxonomy — Stage 1', '');
  L.push('**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**', '');
  L.push(`**${fails.length} agent failures** out of ${ft.rows.length} tasks. Single arm (Gemma), **n=1**.`, '');
  L.push('| mechanism | freq | repos | tasks | confidence | severity |');
  L.push('|---|---|---|---|---|---|');
  for (const [m, v] of Object.entries(mech).sort((a, b) => b[1].n - a[1].n)) {
    const conf = Object.entries(v.conf).map(([k, c]) => `${k}×${c}`).join(', ');
    L.push(`| ${B}${m}${B} | **${v.n}** | ${Object.keys(v.repos).length}/4 — ${Object.entries(v.repos).map(([k, c]) => `${k} ${c}`).join(', ')} | ${v.n} | ${conf} | task not solved |`);
  }
  L.push('');
  L.push('## No mechanism dominates', '');
  const top = Math.max(...Object.values(mech).map(v => v.n));
  L.push(`The largest bucket holds **${top} of ${fails.length}** failures and spans only`);
  L.push(`**${Math.max(...Object.values(mech).map(v => Object.keys(v.repos).length))} of 4** repositories.`, '');
  L.push('This matters more than any individual count. There is no mechanism here with the frequency');
  L.push('*and* the repository spread *and* the trajectory confidence to carry a confident');
  L.push('single-intervention decision on its own — and saying so is the honest reading of the');
  L.push('evidence, not a failure of the analysis.', '');
  L.push('## Severity is uniform, so it cannot break the tie', '');
  L.push('Every failure here has the same consequence: the task is not solved. None is catastrophic');
  L.push('(no data loss, no corruption, no unsafe action), and none is cosmetic. Severity therefore');
  L.push('does not discriminate between mechanisms, and frequency alone must not be allowed to decide');
  L.push('(§19, §22).', '');
  fs.writeFileSync(path.join(DOCS, 'failure-taxonomy.md'), L.join('\n'));
}

// ── trajectory-analysis.md ───────────────────────────────────────────────────
{
  const L = [];
  L.push('# Trajectory Analysis — Stage 1', '');
  L.push('**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**', '');
  L.push('§12 requires the *first causal divergence*, not the final error. What follows is read from');
  L.push('the durable event log, one turn at a time.', '');

  const show = ['pytest-dev__pytest-6116', 'pylint-dev__pylint-6506', 'pallets__flask-5063'];
  for (const id of show) {
    const r = byId.get(id); if (!r) continue;
    let ev = [];
    try { const s = new Store(r.db); ev = s.events(r.run_id); s.close(); } catch { continue; }
    const row = ft.rows.find(x => x.task_id === id);
    L.push(`## ${B}${id}${B} — ${B}${row.gemma.diag.mechanism}${B} (exit ${B}${r.reason}${B})`, '');
    L.push('```');
    let n = 0;
    for (const e of ev) {
      if (e.type === 'tool.started') {
        n++;
        if (n <= 34) L.push(`T${String(n).padStart(2)} ${e.payload.name.padEnd(5)} ${cut(JSON.stringify(e.payload.args), 88)}`);
      }
    }
    if (n > 34) L.push(`... (${n} tool calls total)`);
    L.push('```', '');
    L.push(`**First causal divergence:** ${esc(row.gemma.diag.divergence)}`, '');
  }

  L.push('## What the trajectories show that the score does not', '');
  L.push(`- ${B}pytest-6116${B}: five consecutive ${B}grep${B} calls, four of them byte-identical and none`);
  L.push('  carrying a `path`, then ADR-006 stops the run. The agent never read a single file. This is');
  L.push('  a degenerate repeat loop, not a considered decision to stop.');
  L.push(`- ${B}pylint-6506${B}: 31 calls of genuine, competent investigation — it located`);
  L.push('  `config_initialization.py` and `run.py`, read the right regions, and reasoned correctly');
  L.push('  about `Run.__init__`. Then it wrote 1 731 characters of accurate analysis and stopped');
  L.push('  **without editing anything**. The diagnosis was right; the action never came.');
  L.push(`- ${B}flask-5063${B}: edited ${B}src/flask/cli.py${B} and still failed — a genuine wrong edit, the`);
  L.push('  only mechanism here that is unambiguously about *coding* rather than about control flow.', '');
  L.push('## The distinction that matters for the intervention', '');
  L.push('`pylint-6506` and `pytest-6116` both end with an unchanged repository, and a naive reading');
  L.push('files them together. They are not alike:', '');
  L.push('| | `pylint-6506` | `pytest-6116` |');
  L.push('|---|---|---|');
  L.push('| investigation | thorough, correct | none — 5 calls, 0 files read |');
  L.push('| final output | 1 731 chars of correct analysis | empty content + a tool call |');
  L.push('| stopped by | **itself** (`model_finished`) | **the runtime** (`no_progress`) |');
  L.push('| what was missing | the decision to act | the ability to escape a loop |', '');
  L.push('One needs a nudge from analysis to action. The other needs loop-breaking. A single');
  L.push('intervention aimed at "premature termination" would address neither properly.', '');
  fs.writeFileSync(path.join(DOCS, 'trajectory-analysis.md'), L.join('\n'));
}

console.log('failure-table.md · failure-taxonomy.md · trajectory-analysis.md written');
console.log(`  ${fails.length} agent failures, ${passes.length} passes`);
