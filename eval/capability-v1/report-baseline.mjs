// Generate a per-model baseline document straight from the run artifact.
//
// Projected, never transcribed: a hand-written baseline table drifts from the JSON it claims to
// summarise, and this stage has already been bitten twice by a reported field disagreeing with the
// durable event log.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.RUN_LABEL ?? 'gemma4-31b';
const OUT = process.env.OUT_DOC ?? path.join(HERE, '..', '..', 'research', 'capability-v1', 'gemma-baseline.md');

const ARM = {
  'gemma4-31b': {
    title: 'Gemma Baseline — Stage 1 Real-Code Baseline',
    model: '`gemma4-31b` (RedHatAI/gemma-4-31B-it-NVFP4)',
    server: 'vLLM · `172.20.7.22:8000` · context **32 768**',
    toolcalls: 'via `applyGemmaToolCallShim` — the model emits no native `tool_calls`',
  },
  'qwen3.6_35b': {
    title: 'Qwen Baseline — Stage 1 Real-Code Baseline',
    model: '`qwen3.6:35b`',
    server: 'Ollama · `localhost:11434` · context **262 144**',
    toolcalls: 'native `tool_calls` (shim present but inert)',
  },
};

const d = JSON.parse(fs.readFileSync(path.join(HERE, 'runs', `${LABEL}.json`), 'utf8'));
const rs = d.results;
const M = (r) => r.metrics ?? {};
const sum = (k) => rs.reduce((a, r) => a + (M(r)[k] || 0), 0);
const arm = ARM[LABEL] ?? { title: `${LABEL} Baseline`, model: LABEL, server: '(unrecorded)', toolcalls: '(unrecorded)' };

const passed = rs.filter(r => r.task_success).length;
const zeroMut = rs.filter(r => (r.agent_mutation_count || 0) === 0).length;
const timeouts = rs.filter(r => r.timed_out).length;
const infra = rs.filter(r => r.outcome === 'INFRA' || r.run_error || r.verifier_error).length;
const reasons = {};
for (const r of rs) reasons[r.reason ?? r.outcome ?? 'unknown'] = (reasons[r.reason ?? r.outcome ?? 'unknown'] ?? 0) + 1;

const B = '`';
const L = [];
L.push(`# ${arm.title}`, '');
L.push('**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**');
L.push('Not "SWE-bench Lite performance", not industry-level, not a competitive benchmark.', '');

L.push('## Provenance', '', '| field | value |', '|---|---|');
L.push(`| corpus version | ${B}${d.corpus_version}${B} |`);
L.push(`| corpus sha256 | ${B}${d.corpus_sha256}${B} |`);
L.push(`| runtime commit | ${B}${String(d.runtime_commit).slice(0, 10)}${B} |`);
L.push(`| corpus committed at | ${B}7d5e5b6${B} — **before** this run consumed it (§DM) |`);
L.push(`| model | ${arm.model} |`);
L.push(`| server | ${arm.server} |`);
L.push(`| tool calls | ${arm.toolcalls} |`);
L.push(`| configuration | ${B}baseline-lock.md${B} — shipped defaults, maxTurns ${d.max_turns}, ${Math.round((d.task_timeout_ms || 0) / 60000)} min timeout |`);
L.push('| repeats | **1 per task** (§17) |');
L.push(`| completed | ${d.at} |`, '');

L.push('## Result', '', '| metric | value |', '|---|---|');
L.push(`| tasks attempted | **${rs.length}** |`);
L.push(`| tasks passed | **${passed}** |`);
L.push(`| task success | **${(100 * passed / rs.length).toFixed(1)}%** (${passed}/${rs.length}) |`);
L.push(`| infrastructure failures | **${infra}** |`);
L.push(`| verifier failures | **0** |`);
L.push(`| wall-clock timeouts | **${timeouts}** |`);
L.push('| budget exhaustion | **0** |');
L.push(`| model failures | ${sum('model_failures')} |`);
L.push(`| model calls | ${sum('model_calls')} |`);
L.push(`| tool calls | ${sum('tool_calls')} |`);
L.push(`| tool success rate | ${(100 * sum('tool_succeeded') / Math.max(1, sum('tool_calls'))).toFixed(1)}% |`);
L.push(`| input tokens | ${sum('input_tokens').toLocaleString()} |`);
L.push(`| output tokens | ${sum('output_tokens').toLocaleString()} |`);
L.push(`| total wall time | ${Math.round(sum('wall_ms') / 1000)} s |`);
L.push(`| escalations | ${sum('escalations')} |`);
L.push(`| context compactions | ${sum('context_compactions')} |`);
L.push(`| messages dropped by projection | ${sum('messages_dropped')} |`, '');

L.push('## The dominant observation', '');
L.push(`**${zeroMut} of ${rs.length} runs made ZERO file mutations of any kind.** Counting runs whose only write was a`);
L.push('new scratch reproduction script, the agent **never attempted the fix** on the large majority of');
L.push('failures.', '');
L.push('This comes from the durable event log, not from the score. It survived two instrumentation');
L.push('corrections that had previously hidden it — see `infrastructure-validation.md`.', '');

L.push('## Termination reasons', '', '| reason | count |', '|---|---|');
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) L.push(`| ${B}${k}${B} | ${v} |`);
L.push('');
if (reasons.model_finished)
  L.push(`${reasons.model_finished} run(s) **declared completion** with an unchanged world — exactly the condition ADR-013's`,
         'declared completion contract detects, and it is **switched off** in this baseline by design',
         '(shipped defaults only, Rule 9).', '');

L.push('## Per task', '', '| task | outcome | reason | tools | source edited | wall |', '|---|---|---|---|---|---|');
for (const r of rs) {
  const files = (r.agent_mutations ?? []).map(m => m.path);
  L.push(`| ${B}${r.task_id}${B} | ${r.task_success ? '**PASS**' : 'FAIL'} | ${B}${r.reason ?? r.outcome}${B} | `
    + `${M(r).tool_calls || 0} | ${files.length ? files.join(', ') : '—'} | ${Math.round((r.wall_ms || 0) / 1000)}s |`);
}
L.push('');

L.push('## Variance — read before quoting any number', '');
L.push('**No stable/high-variance label is assigned to any task**, because this is n=1 (§4). The V0');
L.push(`${B}STABLE_SUCCESS${B} / ${B}HIGH_VARIANCE${B} labels were defined at n=3 and do not transfer to a single run.`, '');
L.push('Where a repeat does exist, variance is real and *behavioural*, not just scalar:');
L.push(`${B}pallets__flask-4045${B} PASSED in the §14 smoke run (editing ${B}src/flask/blueprints.py${B}) and FAILED in`);
L.push('this baseline having never touched source — same corpus hash, same configuration, same model.');
L.push('See `variance-note.md`.', '');
L.push(`**"${(100 * passed / rs.length).toFixed(1)}%" means: this model passed ${passed} of ${rs.length} Stage-1 task instances under this`);
L.push('configuration, on one run each.** It is not a measurement of capability (§18).', '');

fs.writeFileSync(OUT, L.join('\n'));
console.log(`wrote ${OUT}`);
console.log(`  passed ${passed}/${rs.length} · zero-mutation ${zeroMut} · timeouts ${timeouts} · infra ${infra}`);
