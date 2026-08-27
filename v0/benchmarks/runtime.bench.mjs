// Phase O — reproducible runtime benchmarks. No model required.
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../src/core/run/store.mjs';
import { project, emptyState, applyEvent } from '../src/core/projection/index.mjs';
import { replay, fork } from '../src/core/replay/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(os.tmpdir(), 'v0-bench-' + Date.now()); fs.mkdirSync(DIR, { recursive: true });
const ms = n => Number(n) / 1e6, now = () => process.hrtime.bigint();
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const SIZES = (process.env.SIZES || '1000,10000,100000,1000000').split(',').map(Number);
const DUR = process.env.DURABILITY || 'normal';
const rows = [];

for (const n of SIZES) {
  const db = path.join(DIR, `b${n}.db`);
  const s = new Store(db, { durability: DUR });
  const r = uid(); s.createRun(r);

  // ---- build
  const batch = [];
  for (let i = 0; batch.length < n - 1; i++) {
    batch.push({ type: 'turn.started', payload: { input: `t${i}` } });
    batch.push({ type: 'model.responded', payload: { content: `c${i}`, input_tokens: 100, output_tokens: 30, cost_usd: 0.0001 } });
    batch.push({ type: 'tool.started', payload: { tool_call_id: `tc${i}`, name: 'read', args: { path: 'p' } } });
    batch.push({ type: 'tool.succeeded', payload: { tool_call_id: `tc${i}`, name: 'read', result: 'y'.repeat(400) } });
  }
  batch.length = n - 1;
  const tb = now();
  for (let i = 0; i < batch.length; i += 5000) s.appendMany(r, batch.slice(i, i + 5000));
  const buildMs = ms(now() - tb);

  // ---- append latency (single-event, the real per-turn path)
  const al = [];
  for (let k = 0; k < 300; k++) { const a = now(); s.append(r, 'degraded', { subsystem: 'bench', reason: 'x' }); al.push(ms(now() - a)); }

  // ---- full replay (no snapshot)
  const rl = [];
  for (let k = 0; k < 5; k++) { const a = now(); project(s, r, { useSnapshot: false }); rl.push(ms(now() - a)); }

  // ---- snapshot load (snapshot every 1000)
  let st = emptyState(r);
  for (const e of s.events(r)) { st = applyEvent(st, e); if (e.seq % 1000 === 0) s.putSnapshot(r, e.seq, st); }
  const sl = [];
  for (let k = 0; k < 30; k++) { const a = now(); project(s, r, { useSnapshot: true }); sl.push(ms(now() - a)); }

  // ---- fork
  const fl = [];
  for (let k = 0; k < 3; k++) { const a = now(); fork(s, r, Math.floor(s.lastSeq(r) / 2)); fl.push(ms(now() - a)); }

  s.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  let bytes = 0; for (const f of [db, db + '-wal']) { try { bytes += fs.statSync(f).size; } catch {} }
  const stateBytes = Buffer.byteLength(JSON.stringify(project(s, r)));
  const heap = process.memoryUsage().heapUsed / 1e6;

  rows.push({ n: s.lastSeq(r), build_ms: +buildMs.toFixed(1),
    append_p50: +pct(al, .5).toFixed(4), append_p95: +pct(al, .95).toFixed(4), append_p99: +pct(al, .99).toFixed(4),
    full_replay_p50: +pct(rl, .5).toFixed(1),
    snapshot_load_p50: +pct(sl, .5).toFixed(3), snapshot_load_p95: +pct(sl, .95).toFixed(3), snapshot_load_p99: +pct(sl, .99).toFixed(3),
    fork_p50_ms: +pct(fl, .5).toFixed(1),
    db_mb: +(bytes / 1e6).toFixed(1), bytes_per_event: Math.round(bytes / s.lastSeq(r)),
    hot_state_bytes: stateBytes, heap_mb: +heap.toFixed(1) });
  console.log(`n=${String(rows.at(-1).n).padStart(8)}  append p50=${rows.at(-1).append_p50}ms p99=${rows.at(-1).append_p99}ms  ` +
    `replay=${rows.at(-1).full_replay_p50}ms  snap_load p99=${rows.at(-1).snapshot_load_p99}ms  ` +
    `fork=${rows.at(-1).fork_p50_ms}ms  db=${rows.at(-1).db_mb}MB (${rows.at(-1).bytes_per_event}B/ev)  hot=${rows.at(-1).hot_state_bytes}B`);
  s.close();
}
fs.writeFileSync(path.join(HERE, `results-${DUR}.json`), JSON.stringify({ durability: DUR, rows }, null, 2));
const cols = Object.keys(rows[0]);
fs.writeFileSync(path.join(HERE, `results-${DUR}.csv`),
  cols.join(',') + '\n' + rows.map(r => cols.map(c => r[c]).join(',')).join('\n'));
console.log(`\nwrote benchmarks/results-${DUR}.{json,csv}`);
