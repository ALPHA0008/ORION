#!/usr/bin/env node
// E3 — the store's concurrency ceiling, measured against the real thing.
//
// THE ONE QUESTION
//
// Can N `orionctl run` processes write the SAME SQLite store at once without corruption or
// contention that breaks runs? That number gates W13 ops sizing, W14 storage, and container
// sizing — and until now it has been argued from the PRAGMAs rather than measured.
//
// EXPERIMENT DESIGN — what is shared and what is not, and why
//
//   SHARED: `ORION_HOME`, and therefore ONE `orion.db`. This is the variable under test. Every
//   concurrent process opens the same file, takes the same write lock, and appends to the same
//   `events` table.
//
//   NOT SHARED: the workspace. Each run gets its own copy of the source repo under one shared
//   base directory. That is deliberate. If every process wrote the SAME files, the failures would
//   be filesystem and W6-resource contention — a real phenomenon, but a DIFFERENT one, and it
//   would mask the store measurement behind edit collisions the store never sees. Separate
//   workspaces also happen to be the realistic shape of the question this gates: two developers
//   on two checkouts sharing one store.
//
// WHAT COUNTS AS A FAILURE (stated up front, not discovered afterwards)
//
//   A level PASSES only if every run at that level completed AND every run in the shared store
//   replays clean. Specifically, after each level the whole store is swept:
//     - `verifyProjectionEquivalence` must hold for every run (snapshot-assisted projection
//       equals full replay);
//     - every run's `seq` must be exactly 1..N with no gap and no duplicate — interleaved
//       appends from N processes allocating sequence numbers is precisely where a single-writer
//       store would corrupt;
//     - no run may end `lease_lost`, and no run may be left non-terminal.
//   A corrupted run is a FAIL regardless of wall time. The store's invariants outrank throughput.
//
// A NOTE ON WHAT THE WALL-CLOCK NUMBERS MEAN
//
// One local model serves every concurrent process, so generation time is largely SERIALISED by
// Ollama no matter how many runs are in flight. Wall time at high N therefore measures the model
// server, not the store. That confound is reported rather than engineered away: the runs are what
// an operator would actually experience, and the store verdict (the point of E3) is unaffected by
// how slowly the tokens arrived.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V0 = path.resolve(HERE, '..');
const ROOT = path.resolve(V0, '..');
const REPOS = path.join(ROOT, 'research', 'repos');
const CLI = path.join(V0, 'src', 'cli', 'index.mjs');
const RESULTS = path.join(HERE, 'results');

// Same PATH discipline as E4: the sandbox shells to bash AND node, and without node on PATH the
// verify tool fails exit 127 — an environment defect that reads exactly like a model failure.
// The runner owns the PATH rather than trusting the operator's shell.
const NODE_DIR = path.dirname(process.execPath);
const GIT_BIN = 'C:\\Users\\abhijith.p\\AppData\\Local\\Programs\\Git\\bin';
const GIT_USR = 'C:\\Users\\abhijith.p\\AppData\\Local\\Programs\\Git\\usr\\bin';
const RUN_PATH = [NODE_DIR, GIT_BIN, GIT_USR, process.env.PATH ?? ''].join(path.delimiter);

const ENDPOINT = {
  ORION_BASE_URL: process.env.ORION_BASE_URL ?? 'http://localhost:11434/v1',
  ORION_MODEL: process.env.ORION_MODEL ?? 'qwen3.6:35b-a3b-q4_K_M',
  ORION_API_KEY: process.env.ORION_API_KEY ?? 'ollama',
};

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const LEVELS = (flag('levels', '1,2,4,8,16')).split(',').map(Number).filter(Boolean);
const REPS = Number(flag('reps', '2'));
const LABEL = flag('label', `e3-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const SCRATCH = flag('scratch', path.join(os.tmpdir(), 'opencode'));

/**
 * The workload.
 *
 * Deliberately ONE small, real task rather than E4's full matrix: E3 varies CONCURRENCY, so the
 * task must be a constant. It is a genuine agent loop (read a real file from a real repo, then
 * answer) — enough work that model generation dominates process setup, which is the condition the
 * brief asks for, while staying short enough that level 16 is tractable.
 *
 * Reused from the E4 manifest where possible so the two tracks describe the same kind of work.
 */
// A SUBTREE of a real repo, not the whole repo — and the reason matters enough to state here.
//
// The first control run at level 1 FAILED after 295s with repeated `model.failed … timeout`, while
// a bare generate against the same endpoint returned in 1.1s. Cause: every one of the six repos in
// research/repos/ is itself an agent framework, so the harness (correctly, per W7) loaded the
// workspace's own agent instructions and skills — for `ruflo`, a 25,273-byte AGENTS.md plus 137
// skills totalling 18,703 bytes of disclosure. That ~44KB system prompt is more than this local
// model can turn around inside the model timeout.
//
// That is the harness working as designed, not a defect. But E3 varies CONCURRENCY, so every other
// input has to be a constant — and a workload whose prompt size depends on which agent repo it
// landed in is not a constant. This subtree is real third-party source (two dependency-free .mjs
// modules, 10 files, 47KB) carrying no AGENTS.md and no skills directory, so the prompt is small,
// fixed, and identical at every level.
const TASK_REPO = path.join('ruflo', 'plugins', 'ruflo-adr', 'scripts');
const TASK_FILE = 'lib/index-records.mjs';
const TASK_TEXT = `Read the file ${TASK_FILE} and explain in at most 3 lines what the function edgeKey does.`;

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.venv',
                      '__pycache__', '.orion', 'target', '.brain']);
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) { try { fs.copyFileSync(s, d); } catch { /* unreadable: skip */ } }
  }
}

/** Spawn one CLI run. Never hangs: a timeout is an OUTCOME, recorded as such. */
function spawnRun(ws, orionHome, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [CLI, 'run', TASK_TEXT], {
      cwd: ws, shell: false,
      env: { ...process.env, PATH: RUN_PATH, ...ENDPOINT,
             ORION_HOME: orionHome, ORION_WORKSPACE: ws },
    });
    let out = ''; let err = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} },
      timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      const id = (out.match(/Run #([0-9a-f]+)/) ?? [])[1] ?? null;
      resolve({ code, out, err, timedOut, ms: Date.now() - t0,
                runId: id ? `run_${id}` : null });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e.message ?? e), timedOut, ms: Date.now() - t0, runId: null });
    });
  });
}

/**
 * Sweep the SHARED store and prove it is intact.
 *
 * This is the actual verdict of E3. Wall time is context; THIS is the measurement.
 */
async function sweepStore(orionHome) {
  // `pathToFileURL`, not a bare path: a Windows path with a drive letter (and a space, here)
  // is rejected by the ESM loader with ERR_UNSUPPORTED_ESM_URL_SCHEME.
  const { Store } = await import(pathToFileURL(path.join(V0, 'src/core/run/store.mjs')).href);
  const { verifyProjectionEquivalence } = await import(
    pathToFileURL(path.join(V0, 'src/core/replay/index.mjs')).href);

  const store = new Store(path.join(orionHome, 'orion.db'));
  const problems = [];
  let checked = 0;

  try {
    for (const row of store.listRuns({ limit: 10_000 })) {
      checked++;
      const events = store.events(row.id);

      // Sequence integrity: N processes allocating seq against one table is exactly where a
      // single-writer store would tear. A gap or a duplicate is corruption, full stop.
      const seqs = events.map(e => Number(e.seq));
      const gaps = seqs.filter((s, i) => s !== i + 1).length;
      if (gaps) problems.push({ run: row.id, kind: 'seq_gap', detail: `${gaps} of ${seqs.length} seqs out of order` });
      if (new Set(seqs).size !== seqs.length)
        problems.push({ run: row.id, kind: 'seq_duplicate', detail: 'duplicate seq in one run' });

      // Replay equivalence: snapshot-assisted projection must equal full replay (Invariant 2).
      try {
        const eq = verifyProjectionEquivalence(store, row.id);
        if (!eq.equal) problems.push({ run: row.id, kind: 'replay_mismatch', detail: 'cold !== warm projection' });
      } catch (e) {
        problems.push({ run: row.id, kind: 'replay_threw', detail: String(e.message ?? e).slice(0, 100) });
      }

      // A lost lease under concurrency means one process fenced another out — the thing the
      // lease exists to do, but at level N it would mean the store could not carry N writers.
      if (events.some(e => e.type === 'run.lease_lost'))
        problems.push({ run: row.id, kind: 'lease_lost', detail: 'run lost its lease' });

      const last = events.at(-1)?.type ?? '(none)';
      if (!['run.completed', 'run.failed', 'run.paused', 'run.parked'].includes(last))
        problems.push({ run: row.id, kind: 'non_terminal', detail: `ends at ${last}` });
    }
  } finally { try { store.close(); } catch {} }

  return { checked, problems };
}

/** One level: N concurrent processes against ONE shared store. */
async function runLevel(level, rep, sourceRepo) {
  const base = fs.mkdtempSync(path.join(SCRATCH, `e3-L${level}r${rep}-`));
  const orionHome = path.join(base, '.orion');
  fs.mkdirSync(orionHome, { recursive: true });

  // Per-run workspace copies, prepared BEFORE the clock starts so the measurement is of the runs
  // and the store, not of the filesystem copy.
  const workspaces = [];
  for (let i = 0; i < level; i++) {
    const ws = path.join(base, `ws${i}`);
    copyTree(sourceRepo, ws);
    workspaces.push(ws);
  }

  // Generous per-run ceiling: one local model serves every process, so at level 16 a run
  // legitimately waits a long time for its turn at the GPU/CPU. A timeout here must mean
  // "wedged", not "queued".
  const timeoutMs = Math.max(10, level * 3) * 60_000;

  const t0 = Date.now();
  const runs = await Promise.all(workspaces.map(ws => spawnRun(ws, orionHome, timeoutMs)));
  const totalMs = Date.now() - t0;

  const sweep = await sweepStore(orionHome);
  const completed = runs.filter(r => /✓ (completed|model_finished)|model_finished/.test(r.out)).length;
  const timeouts = runs.filter(r => r.timedOut).length;
  const noRunId = runs.filter(r => !r.runId).length;

  const wall = runs.map(r => r.ms);
  const mean = wall.reduce((a, b) => a + b, 0) / wall.length;

  const failures = [];
  for (const r of runs) {
    if (r.timedOut) failures.push({ kind: 'timeout', detail: `run exceeded ${timeoutMs / 60000}m` });
    else if (!r.runId) failures.push({ kind: 'no_run', detail: `cli exit ${r.code}: ${r.err.slice(0, 120)}` });
    else if (!/model_finished|✓ completed/.test(r.out)) {
      const tail = r.out.split('\n').filter(Boolean).at(-2) ?? r.out.slice(-120);
      failures.push({ kind: 'run_not_completed', run: r.runId, detail: tail.trim().slice(0, 140) });
    }
  }
  for (const p of sweep.problems) failures.push({ kind: `store_${p.kind}`, run: p.run, detail: p.detail });

  // THE verdict: the store's invariants outrank throughput.
  const storeClean = sweep.problems.length === 0;
  const allRan = timeouts === 0 && noRunId === 0;
  const pass = storeClean && allRan && completed === level;

  return {
    level, rep, pass,
    runsSpawned: level, completed, timeouts,
    meanMsPerRun: Math.round(mean),
    minMsPerRun: Math.min(...wall), maxMsPerRun: Math.max(...wall),
    totalWallMs: totalMs,
    storeRunsChecked: sweep.checked,
    storeClean,
    failures,
    base, orionHome,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(SCRATCH, { recursive: true });
const sourceRepo = path.join(REPOS, TASK_REPO);
if (!fs.existsSync(sourceRepo)) { console.error(`missing source repo: ${sourceRepo}`); process.exit(2); }

console.log(`E3 — store concurrency ceiling`);
console.log(`  model    ${ENDPOINT.ORION_MODEL} @ ${ENDPOINT.ORION_BASE_URL}`);
console.log(`  levels   ${LEVELS.join(', ')}   reps ${REPS}`);
console.log(`  cores    ${os.cpus().length}   free RAM ${(os.freemem() / 1e9).toFixed(1)}GB`);
console.log(`  workload "${TASK_TEXT.slice(0, 70)}…"`);
console.log('');

const all = [];
for (const level of LEVELS) {
  for (let rep = 1; rep <= REPS; rep++) {
    process.stdout.write(`  L${String(level).padStart(2)} rep${rep} … `);
    const r = await runLevel(level, rep, sourceRepo);
    all.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  `
      + `mean ${(r.meanMsPerRun / 1000).toFixed(1)}s/run  total ${(r.totalWallMs / 1000).toFixed(1)}s  `
      + `completed ${r.completed}/${r.level}  store ${r.storeClean ? 'clean' : 'DIRTY'}  `
      + `(${r.storeRunsChecked} runs swept)`);
    for (const f of r.failures.slice(0, 4)) console.log(`         ${f.kind}: ${f.detail}`);
  }
}

// The ceiling: the highest level where EVERY rep passed.
const byLevel = new Map();
for (const r of all) {
  const cur = byLevel.get(r.level) ?? { level: r.level, reps: [], pass: true };
  cur.reps.push(r); cur.pass = cur.pass && r.pass;
  byLevel.set(r.level, cur);
}
const ordered = [...byLevel.values()].sort((a, b) => a.level - b.level);
let ceiling = 0; let brokeAt = null;
for (const l of ordered) {
  if (l.pass) ceiling = l.level;
  else { brokeAt = l; break; }
}

console.log('');
console.log('level | mean wall/run | total wall | completed | store  | verdict');
for (const l of ordered) {
  const mean = l.reps.reduce((a, r) => a + r.meanMsPerRun, 0) / l.reps.length;
  const tot = l.reps.reduce((a, r) => a + r.totalWallMs, 0) / l.reps.length;
  const comp = l.reps.reduce((a, r) => a + r.completed, 0);
  const spawn = l.reps.reduce((a, r) => a + r.level, 0);
  console.log(`${String(l.level).padStart(5)} | ${(mean / 1000).toFixed(1).padStart(13)}s | `
    + `${(tot / 1000).toFixed(1).padStart(10)}s | ${String(comp + '/' + spawn).padStart(9)} | `
    + `${(l.reps.every(r => r.storeClean) ? 'clean' : 'DIRTY').padStart(6)} | ${l.pass ? 'PASS' : 'FAIL'}`);
}
console.log('');
console.log(`CEILING: ${ceiling} concurrent runs against one store`);
if (brokeAt) {
  console.log(`broke at ${brokeAt.level}:`);
  for (const r of brokeAt.reps) for (const f of r.failures.slice(0, 3)) console.log(`  ${f.kind}: ${f.detail}`);
}

fs.mkdirSync(RESULTS, { recursive: true });
const out = path.join(RESULTS, `${LABEL}.json`);
fs.writeFileSync(out, JSON.stringify({
  label: LABEL, generated: new Date().toISOString(),
  model: ENDPOINT.ORION_MODEL, endpoint: ENDPOINT.ORION_BASE_URL,
  host: { cores: os.cpus().length, totalRamGB: Number((os.totalmem() / 1e9).toFixed(1)) },
  workload: { repo: TASK_REPO, file: TASK_FILE, task: TASK_TEXT },
  levels: LEVELS, reps: REPS, ceiling,
  brokeAt: brokeAt ? { level: brokeAt.level, failures: brokeAt.reps.flatMap(r => r.failures) } : null,
  results: all,
}, null, 2));
console.log(`\nresults → ${out}`);
