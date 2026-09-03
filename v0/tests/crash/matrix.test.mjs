// Phase D — crash matrix. Real SIGKILL at each named point in the loop.
// For every crash point we record: last durable event, world-side effect, reconstructed
// state, recovery decision, final result, and whether any side effect was duplicated.
import path from 'node:path'; import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { reap } from '../../src/core/lease/reaper.mjs';
import { describe, check, summary, tmpdir } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, '..', '_helpers', 'crash-runner.mjs');
const DIR = tmpdir('crash');

// crash points exposed by Worker#hook, in loop order
const POINTS = [
  { id: 'after:model.requested', label: 'after model request (before response)' },
  { id: 'after:model.responded', label: 'after model response' },
  { id: 'after:tool.requested',  label: 'after tool requested' },
  { id: 'after:tool.authorized', label: 'after authorization' },
  { id: 'after:tool.started',    label: 'after tool started (before effect)' },
  { id: 'after:tool.effect',     label: 'AFTER TOOL EFFECT (before terminal event)' },
  { id: 'after:tool.succeeded',  label: 'after tool succeeded' },
  { id: 'before:terminal',       label: 'before terminal event' },
];

function runChild(dbPath, workDir, runId, point, nth = 1, mode = 'normal') {
  return spawnSync(process.execPath, [RUNNER, dbPath, workDir, runId, point, String(nth), mode],
    { encoding: 'utf8', timeout: 60_000 });
}

const rows = [];

// ── golden: one clean run, no crash. Everything else is compared against this. ──
const goldenDir = path.join(DIR, 'golden');
const goldenDb = path.join(goldenDir, 'g.db');
fs.mkdirSync(goldenDir, { recursive: true });
const gs = new Store(goldenDb); const goldenRun = uid(); gs.createRun(goldenRun, { task: 'mini project' }); gs.close();
runChild(goldenDb, path.join(goldenDir, 'work'), goldenRun, 'none');
const gsb = new LocalSandbox(path.join(goldenDir, 'work'));
const GOLDEN = {
  files: ['a.txt', 'b.txt'].map(f => (gsb.exists(f) ? gsb.read(f) : null)),
  status: (() => { const s = new Store(goldenDb); const st = project(s, goldenRun); s.close(); return st.status; })(),
};
console.log(`  golden run: status=${GOLDEN.status}  b.txt=${JSON.stringify(GOLDEN.files[1])}`);

describe('Phase D — crash matrix (real SIGKILL at each loop position)');
for (const pt of POINTS) {
  for (const nth of [1, 3]) {                        // early and mid-run
    const tag = `${pt.id.replace(/[:.]/g, '_')}_n${nth}`;
    const dbPath = path.join(DIR, `${tag}.db`);
    const workDir = path.join(DIR, `${tag}-work`);
    const s0 = new Store(dbPath); const runId = uid(); s0.createRun(runId, { task: 'mini project' }); s0.close();

    const c1 = runChild(dbPath, workDir, runId, pt.id, nth);
    // The child prints {crashed_at,nth} immediately before killing itself.
    const firedLine = (c1.stdout || '').split(String.fromCharCode(10)).find(l => l.includes('crashed_at'));
    const crashFired = !!firedLine;
    const crashed = crashFired && (c1.signal === 'SIGKILL' || c1.status !== 0);
    // Some points occur only once per run (e.g. before:terminal), so nth=3 is unreachable.
    const applicable = crashFired;

    const s1 = new Store(dbPath);
    const atCrash = project(s1, runId, { useSnapshot: false });
    const lastEvent = s1.events(runId).slice(-1)[0];
    const orphans = Object.entries(atCrash.pending_tool_calls).filter(([, v]) => !v.escalated);

    // world-side effect at the moment of the crash
    const sb = new LocalSandbox(workDir);
    const worldBefore = ['a.txt', 'b.txt'].map(f => (sb.exists(f) ? sb.read(f) : null));

    // reaper must reclaim it
    s1.db.prepare('UPDATE runs SET lease_expires_at=? WHERE id=?').run(Date.now() - 1, runId);
    const reaped = reap(s1);
    s1.close();

    // second process resumes
    const c2 = runChild(dbPath, workDir, runId, 'none');
    let final = {}; try { final = JSON.parse((c2.stdout || '').trim().split('\n').pop()); } catch {}

    const s2 = new Store(dbPath);
    const end = project(s2, runId, { useSnapshot: false });
    const recEvents = s2.events(runId).filter(e => e.type === 'tool.recovery_decided');
    const sb2 = new LocalSandbox(workDir);

    // Duplicate-effect probe: compare the FINAL WORLD to the golden no-crash run.
    // A duplicated effect shows up as content that differs from golden (e.g. VALUE=200
    // from a doubly-applied edit, or appended/repeated text).
    const finalFiles = ['a.txt', 'b.txt'].map(f => (sb2.exists(f) ? sb2.read(f) : null));
    const bTxt = finalFiles[1] ?? '';
    const doubleEdit = /VALUE=200/.test(bTxt);
    const worldMatchesGolden = JSON.stringify(finalFiles) === JSON.stringify(GOLDEN.files);
    const reachedTerminal = ['completed', 'failed', 'parked'].includes(end.status);
    const dupTerminal = doubleEdit;

    rows.push({
      point: pt.id, label: pt.label, nth,
      crashed, applicable,
      last_durable_event: lastEvent ? `${lastEvent.seq} ${lastEvent.type}` : 'none',
      events_at_crash: atCrash.seq,
      world_effect_at_crash: worldBefore.map(v => (v === null ? '—' : `${v.trim().split('\n').pop()}`)).join(' / '),
      orphans_detected: orphans.length,
      orphan_names: orphans.map(([, v]) => v.name).join(','),
      reaper: `${reaped.requeued}rq/${reaped.parked}pk`,
      recovery_decisions: recEvents.map(e => `${e.payload.name}:${e.payload.class}->${e.payload.decision}${e.payload.verified ? `(${e.payload.verified})` : ''}`).join(' '),
      final_status: final.status ?? '?',
      final_reason: final.reason ?? '',
      events_at_end: end.seq,
      duplicate_side_effect: doubleEdit,
      world_matches_golden: worldMatchesGolden,
      run_status: end.status,
      correct_final_state: worldMatchesGolden && !doubleEdit,
    });
    s2.close();
  }
}

// ── assertions over the whole matrix ──
const applicableRows = rows.filter(r => r.applicable);
const skipped = rows.filter(r => !r.applicable);
check('every REACHABLE crash point actually killed the process',
  applicableRows.every(r => r.crashed) && applicableRows.length > 0,
  `${applicableRows.length} fired, ${skipped.length} unreachable (${skipped.map(r => `${r.point}/n${r.nth}`).join(',') || 'none'})`);
check('no crash produced a duplicated side effect', rows.every(r => !r.duplicate_side_effect),
  rows.filter(r => r.duplicate_side_effect).map(r => r.point).join(',') || 'none');
check('every crashed run reached a terminal state after resume',
  rows.every(r => ['completed', 'failed', 'parked'].includes(r.run_status)),
  rows.map(r => r.run_status).join(','));
check('final world state matches the golden no-crash run in every case',
  rows.every(r => r.world_matches_golden),
  rows.filter(r => !r.world_matches_golden).map(r => `${r.point}/n${r.nth}`).join(',') || 'all match');
const effectCrashes = rows.filter(r => r.point === 'after:tool.effect');
check('crash AFTER the effect is detected as an orphan', effectCrashes.every(r => r.orphans_detected >= 1),
  effectCrashes.map(r => `${r.nth}:${r.orphans_detected}`).join(' '));
check('orphans produce an explicit recovery decision', effectCrashes.every(r => r.recovery_decisions.length > 0),
  effectCrashes.map(r => r.recovery_decisions).join(' | '));

// ── render the matrix ──
const md = [];
md.push('| crash point | nth | last durable event | orphans | recovery decision | final | world | dup effect |');
md.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  md.push(`| \`${r.point}\`${r.applicable ? '' : ' *(unreachable)*'} | ${r.nth} | ${r.last_durable_event} | ${r.orphans_detected}${r.orphan_names ? ` (${r.orphan_names})` : ''} | ${r.recovery_decisions || '—'} | ${r.run_status} | ${r.world_matches_golden ? 'match' : '**DIFF**'} | ${r.duplicate_side_effect ? '**YES**' : 'no'} |`);
}
console.log('\n' + md.join('\n'));

fs.writeFileSync(path.join(HERE, '..', 'crash-matrix.json'), JSON.stringify(rows, null, 2));
process.exit(summary('crash-matrix', path.join(HERE, '../results-crash.json')) ? 1 : 0);
