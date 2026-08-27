// Experiment 1 — Event Log Performance
// Measures append, fold, snapshot-load, memory, db size across event counts and stores.
import { SqliteEventStore, PgEventStore, generateRun, fold, emptyState, applyEvent } from './eventstore.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const TMP = process.env.BENCH_TMP || path.join(os.tmpdir(), 'evlog-bench');
fs.mkdirSync(TMP, { recursive: true });

const SIZES = (process.env.SIZES || '10,100,1000,10000,100000,1000000').split(',').map(Number);
const rows = [];

const pct = (a, p) => { if (!a.length) return 0; const s=[...a].sort((x,y)=>x-y); return s[Math.min(s.length-1, Math.floor(s.length*p))]; };
const ms = (ns) => Number(ns) / 1e6;
const now = () => process.hrtime.bigint();

function memMB() { return process.memoryUsage().heapUsed / 1e6; }

// ---------------- SQLite ----------------
function benchSqlite(n) {
  const file = path.join(TMP, `ev-${n}.db`);
  try { fs.rmSync(file, { force: true }); fs.rmSync(file+'-wal',{force:true}); fs.rmSync(file+'-shm',{force:true}); } catch {}
  const store = new SqliteEventStore(file);
  const events = [...generateRun('r1', n)];
  const actual = events.length;

  // --- append: single-event (per-turn realistic path), measured individually
  const appendLat = [];
  const t0 = now();
  for (const e of events) { const a = now(); store.append(e); appendLat.push(ms(now()-a)); }
  const appendTotal = ms(now()-t0);

  // --- full fold from event 1 (cold: re-read from db)
  const f0 = now(); const evAll = store.readFrom('r1', 0); const readMs = ms(now()-f0);
  const g0 = now(); const st = fold(evAll, emptyState('r1')); const foldMs = ms(now()-g0);
  const fullLoad = readMs + foldMs;

  // --- in-memory fold only (pure reducer cost, no IO)
  const p0 = now(); fold(evAll, emptyState('r1')); const pureFold = ms(now()-p0);

  // --- db size for EVENTS ONLY (measured before any snapshot rows exist)
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  let eventsOnlyBytes = 0;
  for (const f of [file, file+'-wal']) { try { eventsOnlyBytes += fs.statSync(f).size; } catch {} }

  // --- snapshot + tail replay, at several intervals
  const snapResults = {};
  for (const interval of [100, 500, 1000, 5000]) {
    if (interval > actual) { snapResults[interval] = null; continue; }
    // build snapshots every `interval` events
    let s = emptyState('r1');
    const b0 = now();
    for (let i = 0; i < evAll.length; i++) {
      s = applyEvent(s, evAll[i]);
      if (evAll[i].seq % interval === 0) store.putSnapshot('r1', evAll[i].seq, s);
    }
    const buildMs = ms(now()-b0);
    // measure a cold load using latest snapshot + tail
    const l = [];
    for (let k = 0; k < 20; k++) { const a = now(); store.load('r1'); l.push(ms(now()-a)); }
    const snapCount = store.db.prepare('SELECT COUNT(*) c, SUM(LENGTH(state)) b FROM snapshots WHERE run_id=?').get('r1');
    snapResults[interval] = { buildMs, p50: pct(l,0.5), p95: pct(l,0.95), p99: pct(l,0.99), max: Math.max(...l),
      snap_count: Number(snapCount.c||0), snap_bytes: Number(snapCount.b||0) };
    store.db.exec('DELETE FROM snapshots');
  }

  const size = eventsOnlyBytes;

  const stateBytes = Buffer.byteLength(JSON.stringify(st));
  store.close();
  return {
    store: 'sqlite', n: actual,
    append_p50: pct(appendLat,0.5), append_p95: pct(appendLat,0.95), append_p99: pct(appendLat,0.99),
    append_total_ms: appendTotal,
    read_ms: readMs, fold_ms: foldMs, pure_fold_ms: pureFold, full_load_ms: fullLoad,
    snap: snapResults, db_bytes: size, state_bytes: stateBytes,
    bytes_per_event: size / actual,
  };
}

// ---------------- Postgres ----------------
async function benchPg(n, client) {
  const store = new PgEventStore(client);
  await store.init();
  const runId = `r${n}`;
  await client.query('DELETE FROM events WHERE run_id=$1', [runId]);
  await client.query('DELETE FROM snapshots WHERE run_id=$1', [runId]);
  const events = [...generateRun(runId, n)];
  const actual = events.length;

  // append individually only for small n (round trips dominate); batch for large
  let appendLat = [], appendTotal = 0, mode = 'single';
  if (actual <= 10000) {
    const t0 = now();
    for (const e of events) { const a = now(); await store.append(e); appendLat.push(ms(now()-a)); }
    appendTotal = ms(now()-t0);
  } else {
    mode = 'batch1000';
    const t0 = now();
    for (let i = 0; i < events.length; i += 1000) {
      const chunk = events.slice(i, i+1000);
      const a = now(); await store.appendBatch(chunk); appendLat.push(ms(now()-a)/chunk.length);
    }
    appendTotal = ms(now()-t0);
  }

  const f0 = now(); const evAll = await store.readFrom(runId, 0); const readMs = ms(now()-f0);
  const g0 = now(); const st = fold(evAll, emptyState(runId)); const foldMs = ms(now()-g0);

  const snapResults = {};
  for (const interval of [1000]) {
    if (interval > actual) { snapResults[interval] = null; continue; }
    let s = emptyState(runId);
    for (let i = 0; i < evAll.length; i++) {
      s = applyEvent(s, evAll[i]);
      if (evAll[i].seq % interval === 0) await store.putSnapshot(runId, evAll[i].seq, s);
    }
    const l = [];
    for (let k = 0; k < 10; k++) { const a = now(); await store.load(runId); l.push(ms(now()-a)); }
    snapResults[interval] = { p50: pct(l,0.5), p95: pct(l,0.95), p99: pct(l,0.99), max: Math.max(...l) };
    await client.query('DELETE FROM snapshots WHERE run_id=$1', [runId]);
  }

  const { rows: sz } = await client.query(
    `SELECT pg_total_relation_size('events') AS b`);
  return {
    store: 'postgres', n: actual, append_mode: mode,
    append_p50: pct(appendLat,0.5), append_p95: pct(appendLat,0.95), append_p99: pct(appendLat,0.99),
    append_total_ms: appendTotal,
    read_ms: readMs, fold_ms: foldMs, pure_fold_ms: foldMs, full_load_ms: readMs+foldMs,
    snap: snapResults, db_bytes: Number(sz[0].b), state_bytes: Buffer.byteLength(JSON.stringify(st)),
    bytes_per_event: Number(sz[0].b)/actual,
  };
}

// ---------------- run ----------------
const which = process.argv[2] || 'sqlite';
if (which === 'sqlite') {
  for (const n of SIZES) {
    const before = memMB();
    const r = benchSqlite(n);
    r.heap_delta_mb = memMB() - before;
    rows.push(r);
    console.log(`sqlite n=${r.n} append_p50=${r.append_p50.toFixed(4)}ms full_load=${r.full_load_ms.toFixed(1)}ms pure_fold=${r.pure_fold_ms.toFixed(1)}ms db=${(r.db_bytes/1e6).toFixed(1)}MB state=${(r.state_bytes/1e6).toFixed(2)}MB`);
    for (const [iv, s] of Object.entries(r.snap)) if (s) console.log(`         snap@${iv}: p50=${s.p50.toFixed(2)} p95=${s.p95.toFixed(2)} p99=${s.p99.toFixed(2)}ms`);
    global.gc?.();
  }
  fs.writeFileSync(path.join(OUT, 'results-sqlite.json'), JSON.stringify(rows, null, 2));
} else {
  const { pathToFileURL } = await import('node:url');
  const pgPath = path.join(OUT, '..', '..', 'repos', 'qm', 'node_modules', 'pg', 'lib', 'index.js');
  const { default: pg } = await import(pathToFileURL(pgPath).href);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  for (const n of SIZES) {
    const r = await benchPg(n, client);
    rows.push(r);
    console.log(`pg n=${r.n} (${r.append_mode}) append_p50=${r.append_p50.toFixed(4)}ms full_load=${r.full_load_ms.toFixed(1)}ms db=${(r.db_bytes/1e6).toFixed(1)}MB`);
    for (const [iv, s] of Object.entries(r.snap)) if (s) console.log(`      snap@${iv}: p50=${s.p50.toFixed(2)} p95=${s.p95.toFixed(2)} p99=${s.p99.toFixed(2)}ms`);
  }
  await client.end();
  fs.writeFileSync(path.join(OUT, 'results-postgres.json'), JSON.stringify(rows, null, 2));
}
console.log('done');
