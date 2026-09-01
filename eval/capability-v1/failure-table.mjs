// §21-23 — the failure table, built from trajectories rather than from scores.
//
// The primary deliverable of this stage is not "N passed". It is: for each meaningful failure, the
// FIRST CAUSAL DIVERGENCE, what the agent knew at that moment, what it did, and what it would have
// had to do instead. Everything here is derived from the durable event log.
//
// Confidence is evidence-strength, not intuition (§21):
//   HIGH   - the divergence is visible in the trajectory WITH the actor's action at that moment
//   MEDIUM - inferred from surrounding trajectory evidence
//   LOW    - inferred without a direct trajectory trace (includes: no trajectory available)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../../v0/src/core/run/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MUTATING = new Set(['write', 'edit']);
const isTestPath = (p = '') => /(^|[\\/])tests?[\\/]|(^|[\\/])testing[\\/]|test_[^\\/]*\.py$|_test\.py$/i.test(p);

function loadEvents(r) {
  if (!r?.db || !fs.existsSync(r.db)) return [];
  try { const s = new Store(r.db); const ev = s.events(r.run_id); s.close(); return ev; }
  catch { return []; }
}

/**
 * The first causal divergence, and the mechanism it implies.
 *
 * Ordered by how early the divergence is: an agent that never opened a source file diverged long
 * before the one that opened the right file and edited it wrongly. Reporting the LAST symptom
 * instead would attribute nearly everything to "editing".
 */
function diagnose(r, ev) {
  const started = ev.filter(e => e.type === 'tool.started');
  const succeeded = ev.filter(e => e.type === 'tool.succeeded');
  // The path lives on tool.started; tool.succeeded carries only the result. Joining on
  // tool_call_id recovers it -- without this every mutation looked pathless and fell through the
  // source/test split silently.
  const pathOf = (e) => started.find(x => x.payload.tool_call_id === e.payload.tool_call_id)
    ?.payload?.args?.path
    ?? (String(e.payload.result ?? '').match(/^wrote (\S+)/) ?? [])[1] ?? '';

  const mutations = succeeded.filter(e => MUTATING.has(e.payload.name));
  // A NEW scratch file at the repo root -- reproduce_issue.py, repro/test_path_error.py -- is the
  // agent reproducing the bug, not fixing it. Counting those as "editing" attributed the failure to
  // a wrong edit when the agent had never touched the source at all. That inverts the diagnosis:
  // the divergence is that it stopped after reproducing.
  const isScratch = (p) => /(^|[\/])(reproduce|repro|scratch|test_repro)[^\/]*\.py$/i.test(p)
                        || /(^|[\/])repro[\/]/i.test(p);
  const srcMut = mutations.filter(e => { const p = pathOf(e); return p && !isTestPath(p) && !isScratch(p); });
  const testMut = mutations.filter(e => isTestPath(pathOf(e)) && !isScratch(pathOf(e)));
  const scratchMut = mutations.filter(e => isScratch(pathOf(e)));
  const failedCalls = ev.filter(e => e.type === 'tool.failed');
  const at = (e) => e ? new Date(e.at).toISOString().slice(11, 19) : null;

  if (!ev.length)
    return { divergence: 'no trajectory recorded', mechanism: 'environment/infrastructure', confidence: 'LOW' };

  if (r.outcome === 'INFRA' || r.run_error)
    return { divergence: r.infra ?? r.run_error, mechanism: 'environment/infrastructure', confidence: 'HIGH' };

  if (r.timed_out)
    return { divergence: `wall clock exhausted after ${started.length} tool calls`,
             mechanism: 'long-horizon execution', confidence: 'MEDIUM',
             note: 'deployment-attributable unless trajectory shows genuine looping (§19)' };

  // Never touched source: the divergence is that the agent never attempted the actual change.
  // Writing a reproduction script counts as investigation, not as attempting the fix.
  if (srcMut.length === 0 && testMut.length === 0) {
    const reads = started.filter(e => ['read', 'grep'].includes(e.payload.name));
    const repro = scratchMut.length
      ? `; wrote ${scratchMut.length} reproduction script(s) but never edited source` : '';
    return {
      divergence: `${started.length} tool calls, ${reads.length} read/grep, ZERO source edits${repro}; stopped with reason=${r.reason}`,
      at: at((scratchMut.at(-1) ?? started.at(-1))),
      mechanism: reads.length >= 3 ? 'premature termination' : 'context acquisition',
      confidence: 'HIGH',
      note: scratchMut.length ? 'reproduced the bug, then stopped without fixing it' : undefined,
    };
  }

  // Edited ONLY tests: the agent mistook changing the oracle for changing the world.
  if (srcMut.length === 0 && testMut.length > 0) {
    return {
      divergence: `first mutation was a TEST file (${testMut[0].payload.args?.path}); source never modified`,
      at: at(testMut[0]),
      mechanism: 'test interpretation',
      confidence: 'HIGH',
      note: 'oracle-restore discarded these edits, so the verdict is correct',
    };
  }

  // Source was edited but the target test still fails: a wrong edit, or the wrong file.
  if (r.fail_to_pass_now_passes === false) {
    return {
      divergence: `edited ${[...new Set(srcMut.map(pathOf))].filter(Boolean).join(', ') || 'source'}; FAIL_TO_PASS still fails`,
      at: at(srcMut[0]),
      mechanism: 'editing',
      confidence: 'HIGH',
    };
  }

  // Target fixed but the suite regressed.
  if (r.fail_to_pass_now_passes === true && r.pass_to_pass_still_passes === false) {
    return {
      divergence: 'FAIL_TO_PASS satisfied but PASS_TO_PASS regressed',
      at: at(srcMut.at(-1)),
      mechanism: 'reasoning',
      confidence: 'HIGH',
      note: 'the fix was too broad -- a real capability failure, not a verifier artefact',
    };
  }

  if (failedCalls.length >= 3)
    return { divergence: `${failedCalls.length} failed tool calls`, at: at(failedCalls[0]),
             mechanism: 'tool argument construction', confidence: 'MEDIUM' };

  return { divergence: 'UNRESOLVED', mechanism: 'UNRESOLVED', confidence: 'LOW' };
}

// ── main ─────────────────────────────────────────────────────────────────────
const load = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
const g = load(path.join(HERE, 'runs', (process.env.GEMMA ?? 'gemma4-31b') + '.json'));
const q = load(path.join(HERE, 'runs', (process.env.QWEN ?? 'qwen3.6_35b') + '.json'));
if (!g && !q) { console.error('no run files found'); process.exit(1); }

const byTask = new Map();
for (const [arm, data] of [['gemma', g], ['qwen', q]]) {
  for (const r of data?.results ?? []) {
    const row = byTask.get(r.task_id) ?? { task_id: r.task_id, repository: r.repository };
    // A PASS has no first-wrong-turn to find. Diagnosing one produced nonsense -- a passing run
    // was labelled 'tool argument construction' because it had recoverable failed calls along the
    // way. Failed calls the agent RECOVERED from are not the mechanism of anything.
    row[arm] = r.task_success
      ? { ...r, diag: { divergence: null, mechanism: 'PASS', confidence: 'HIGH' } }
      : { ...r, diag: diagnose(r, loadEvents(r)) };
    byTask.set(r.task_id, row);
  }
}

/** §23 — what a Gemma/Qwen difference (or agreement) licenses us to claim. */
function differential(row) {
  const gp = row.gemma?.task_success, qp = row.qwen?.task_success;
  if (gp === undefined || qp === undefined) return 'SINGLE_ARM';
  if (gp && qp) return 'BOTH_PASS';
  if (!gp && !qp) {
    const gm = row.gemma.diag.mechanism, qm = row.qwen.diag.mechanism;
    // A shared failure is evidence for a HARNESS bottleneck only when the MECHANISM matches too --
    // two models failing the same task for different reasons is not cross-model evidence.
    if (gm === qm && gm !== 'UNRESOLVED' && gm !== 'environment/infrastructure')
      return 'BOTH_FAIL_SAME_MECHANISM';
    if (gm === 'environment/infrastructure' || qm === 'environment/infrastructure') return 'INFRASTRUCTURE';
    return 'BOTH_FAIL_DIFFERENT_MECHANISM';
  }
  return 'MODEL_SPECIFIC';
}

const rows = [...byTask.values()].sort((a, b) => a.task_id.localeCompare(b.task_id));
for (const r of rows) r.differential = differential(r);

const outDir = path.join(HERE, 'reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'failure-table.json'), JSON.stringify({
  at: new Date().toISOString(),
  corpus_version: g?.corpus_version ?? q?.corpus_version,
  corpus_sha256: g?.corpus_sha256 ?? q?.corpus_sha256,
  rows,
}, null, 2));

const mark = (a) => a === undefined ? '—' : (a.task_success ? 'PASS' : 'FAIL');
console.log(`${rows.length} tasks`);
for (const r of rows)
  console.log(`  ${r.task_id.padEnd(28)} G=${mark(r.gemma).padEnd(5)} Q=${mark(r.qwen).padEnd(5)} ${r.differential}`);
const tally = {};
for (const r of rows) tally[r.differential] = (tally[r.differential] ?? 0) + 1;
console.log(JSON.stringify(tally, null, 1));
console.log(`wrote ${path.join(outDir, 'failure-table.json')}`);
