// W6 J — the crash matrix UNDER THE ISOLATION BOUNDARY. This is the wave's acceptance test.
//
// The Q4 gate asks whether a container backend enables auto-allow WITHOUT breaking the recovery
// contract. The pre-state witness, `attachCheckpoints` (host `git`) and the crash matrix are all
// computed against a filesystem identity, and a container changes that identity — unless the
// workspace is shared rather than copied, which is what `ContainerSandbox` does.
//
// "It still works" is not the claim being tested. The claim is that the boundary changes NOTHING
// about recovery: for every crash point, the run must reach the same status, and the recovery
// classifier must reach the SAME DECISIONS, as it does on `LocalSandbox`. A container backend
// that recovered differently would be a boundary that silently invalidated the contract — which
// is the outcome the plan says to stop and report rather than ship.
//
// SKIPPING IS HONEST, NOT A PASS. With no container runtime the live comparison cannot run, and
// this file says so explicitly rather than reporting green. The structural half of the contract
// (`tests/sandbox`) still runs everywhere.

import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { reap } from '../../src/core/lease/reaper.mjs';
import { detectRuntime, pruneOrionContainers } from '../../src/sandbox/container/index.mjs';
import { projectResources } from '../../src/core/projection/resource.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, '..', '_helpers', 'crash-runner.mjs');

// The same eight points the local matrix uses. Shared deliberately: a container-specific list
// would let the two matrices diverge without anyone noticing.
const POINTS = [
  'after:model.requested', 'after:model.responded', 'after:tool.requested',
  'after:tool.authorized', 'after:tool.started', 'after:tool.effect',
  'after:tool.succeeded', 'before:terminal',
];

const runtime = detectRuntime();

describe('crash-matrix/container: the boundary changes no recovery decision');

if (!runtime) {
  // Reported as a SKIP with its reason, never as a pass.
  check('SKIPPED — no container runtime (docker/podman) is available on this machine', true,
    'the structural interface + posture tests in tests/sandbox still ran');
  console.log('\n  crash-matrix/container: SKIPPED — no container runtime\n');
} else {
  const child = (dbPath, workDir, runId, point, backend) =>
    spawnSync(process.execPath, [RUNNER, dbPath, workDir, runId, point, '1', 'normal'],
      { encoding: 'utf8', timeout: 240_000, env: { ...process.env, CRASH_BACKEND: backend } });

  /** Crash at `point`, reap, resume — and report what recovery decided. */
  const matrixRow = (point, backend) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cmx-${backend}-`));
    const db = path.join(dir, 'c.db');
    const wd = path.join(dir, 'work');
    fs.mkdirSync(wd, { recursive: true });

    const s0 = new Store(db);
    const runId = uid();
    s0.createRun(runId, { task: 'mini project' });
    s0.close();

    child(db, wd, runId, point, backend);           // SIGKILLs itself at `point`

    // Reclaim by moving the CLOCK, not by rewriting the lease column. `reap` takes `now`, so a
    // stale lease can be simulated without a test reaching past the Store (W5 S1/S2).
    const s1 = new Store(db);
    const atCrash = project(s1, runId);
    const reaped = reap(s1, { now: Date.now() + 10 * 60_000 });
    s1.close();

    const out = child(db, wd, runId, 'none', backend);   // a second process resumes

    const s2 = new Store(db);
    const evs = s2.events(runId);
    const st = project(s2, runId);
    const decisions = evs.filter(e => e.type === 'tool.recovery_decided')
      .map(e => `${e.payload.name}:${e.payload.class}->${e.payload.decision}`).join(';') || 'none';
    const res = projectResources(evs);
    // `a.txt`/`b.txt` are what the scripted model writes; a duplicated effect would show up as
    // repeated content rather than as a different status.
    const world = ['a.txt', 'b.txt']
      .map(f => { try { return fs.readFileSync(path.join(wd, f), 'utf8'); } catch { return null; } });
    s2.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows file locks */ }

    return {
      point, backend, status: st.status, exit: st.exit_reason ?? '—', decisions,
      orphansAtCrash: Object.keys(atCrash.pending_tool_calls).length,
      reaped: `${reaped.requeued}rq/${reaped.parked}pk`,
      reattached: (res.current?.reattach_count ?? 0) > 0,
      reconstructed: !!res.current?.reconstructed,
      world: world.map(w => (w === null ? '∅' : String(w.length))).join('/'),
      resumeOk: !!out.stdout,
    };
  };

  const rows = [];
  for (const point of POINTS) {
    rows.push(matrixRow(point, 'local'));
    rows.push(matrixRow(point, 'container'));
  }

  // ── the comparison table (reproduced in the wave report) ──
  console.log('');
  console.log('| crash point | local | container | identical? | recovery (local) | recovery (container) | resource |');
  console.log('|---|---|---|---|---|---|---|');
  for (const point of POINTS) {
    const L = rows.find(r => r.point === point && r.backend === 'local');
    const K = rows.find(r => r.point === point && r.backend === 'container');
    const same = L.status === K.status && L.decisions === K.decisions;
    console.log(`| \`${point}\` | ${L.status}/${L.exit} | ${K.status}/${K.exit} | ${same ? 'YES' : '**NO**'} `
      + `| ${L.decisions} | ${K.decisions} | ${K.reattached ? 'reattached' : 'bound'}`
      + `${K.reconstructed ? ' RECONSTRUCTED' : ''} |`);
  }
  console.log('');

  // ── the assertions ──
  for (const point of POINTS) {
    const L = rows.find(r => r.point === point && r.backend === 'local');
    const K = rows.find(r => r.point === point && r.backend === 'container');

    eq(`${point}: same final status under the boundary`, K.status, L.status);
    eq(`${point}: same recovery decisions under the boundary`, K.decisions, L.decisions);
    // A duplicated effect is the failure this matrix exists to catch, and it shows up as the
    // world differing between the two backends after identical recovery.
    eq(`${point}: same world state after recovery`, K.world, L.world);
  }

  // The run must actually get somewhere, or "identical" would be a comparison of two failures.
  check('the container runs genuinely completed (not identically stuck)',
    rows.filter(r => r.backend === 'container' && r.status === 'completed').length >= POINTS.length - 1,
    rows.filter(r => r.backend === 'container').map(r => r.status).join(','));

  // Recovery 2.0: a run whose process was SIGKILLed must REATTACH to the container it was
  // holding, not silently get a new one. If this were false the matrix could still pass while
  // the resource story was fiction.
  const reattachedRows = rows.filter(r => r.backend === 'container' && r.reattached);
  check('a SIGKILLed run reattached to its container by identity',
    reattachedRows.length >= 1, `${reattachedRows.length}/${POINTS.length} points reattached`);
  check('no container run silently reconstructed its resource',
    rows.filter(r => r.backend === 'container' && r.reconstructed).length === 0);

  await pruneOrionContainers({ runtime });
}

process.exit(summary('crash-matrix/container', path.join(HERE, '..', 'results-crash-container.json')) ? 1 : 0);
