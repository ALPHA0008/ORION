// Experiment 1b — the unbounded-projection problem.
// Finding from bench.mjs: snapshot load cost is dominated by the SIZE OF THE STATE
// (8MB at 100k events), not by the tail replay length. Snapshot interval barely matters.
// Hypothesis: a BOUNDED projection (counters + windowed messages + open items) makes
// snapshot load O(1) and keeps turn overhead flat regardless of run length.
import { SqliteEventStore, generateRun, emptyState, applyEvent } from './eventstore.mjs';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(os.tmpdir(), 'evlog-bench2');
fs.mkdirSync(TMP, { recursive: true });
const ms = n => Number(n)/1e6, now = () => process.hrtime.bigint();
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*p))];};

// ---- BOUNDED projection: everything an agent turn actually needs, nothing more ----
const WINDOW = 40; // messages retained in the hot projection
function emptyBounded(runId) {
  return { run_id: runId, status:'pending', seq:0,
    recent_messages: [],           // ring buffer, max WINDOW
    message_count: 0,              // full count retained as a counter
    pending_tool_calls: {},        // bounded: open calls only
    budget_consumed: { tokens:0, tool_calls:0, model_calls:0 },
    open_human_requests: {},       // bounded: open only
    children_count: 0,
    degradation_count: 0,
    last_degradation: null,        // full list is a query over the log
    lease_expires_at: null, worker_id: null, attempts: 0 };
}
function applyBounded(s, e) {
  const p = e.payload || {}; s.seq = e.seq;
  const push = (m) => { s.message_count++; s.recent_messages.push(m);
    if (s.recent_messages.length > WINDOW) s.recent_messages.shift(); };
  switch (e.type) {
    case 'run.created': s.status='pending'; break;
    case 'run.leased': s.status='running'; s.worker_id=p.worker_id; s.lease_expires_at=p.lease_expires_at; s.attempts++; break;
    case 'run.lease_renewed': s.lease_expires_at=p.lease_expires_at; break;
    case 'run.paused': s.status='paused'; s.lease_expires_at=null; s.worker_id=null; break;
    case 'run.resumed': s.status='running'; break;
    case 'run.parked': s.status='parked'; break;
    case 'run.completed': s.status='completed'; break;
    case 'run.failed': s.status='failed'; break;
    case 'turn.started': push({role:'user', content:p.input??''}); break;
    case 'model.requested': s.budget_consumed.model_calls++; break;
    case 'model.responded':
      s.budget_consumed.tokens += (p.input_tokens||0)+(p.output_tokens||0);
      push({role:'assistant', content:p.content??'', tool_calls:p.tool_calls}); break;
    case 'tool.started': s.pending_tool_calls[p.tool_call_id]={name:p.name,started_at:e.at}; s.budget_consumed.tool_calls++; break;
    case 'tool.succeeded': delete s.pending_tool_calls[p.tool_call_id]; push({role:'tool',tool_call_id:p.tool_call_id,content:p.result??''}); break;
    case 'tool.failed': case 'tool.timed_out': delete s.pending_tool_calls[p.tool_call_id]; push({role:'tool',tool_call_id:p.tool_call_id,content:`[${e.type}]`}); break;
    case 'tool.denied': push({role:'tool',tool_call_id:p.tool_call_id,content:'[denied]'}); break;
    case 'context.compacted': break; // window already bounds it
    case 'human.requested': s.open_human_requests[p.request_id]={prompt:p.prompt}; break;
    case 'human.responded': case 'human.timed_out': delete s.open_human_requests[p.request_id]; break;
    case 'child.spawned': s.children_count++; break;
    case 'degraded': s.degradation_count++; s.last_degradation={subsystem:p.subsystem,reason:p.reason,at:e.at}; break;
    default: break;
  }
  return s;
}

const SIZES = (process.env.SIZES || '1000,10000,100000,1000000').split(',').map(Number);
const out = [];

for (const n of SIZES) {
  const file = path.join(TMP, `b-${n}.db`);
  for (const f of [file, file+'-wal', file+'-shm']) { try { fs.rmSync(f,{force:true}); } catch {} }
  const store = new SqliteEventStore(file);
  const events = [...generateRun('r1', n)];
  const actual = events.length;
  store.appendBatch(events);
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  let dbBytes = 0; for (const f of [file, file+'-wal']) { try { dbBytes += fs.statSync(f).size; } catch {} }

  const evAll = store.readFrom('r1', 0);

  // --- unbounded projection state size
  let su = emptyState('r1'); for (const e of evAll) su = applyEvent(su, e);
  const unboundedBytes = Buffer.byteLength(JSON.stringify(su));

  // --- bounded projection state size
  const bf0 = now(); let sb = emptyBounded('r1'); for (const e of evAll) sb = applyBounded(sb, e);
  const boundedFoldMs = ms(now()-bf0);
  const boundedBytes = Buffer.byteLength(JSON.stringify(sb));

  // --- snapshot load latency: BOUNDED state, snapshot every `iv`, measure cold load
  const results = {};
  for (const iv of [200, 1000, 5000]) {
    if (iv > actual) continue;
    store.db.exec('DELETE FROM snapshots');
    let s = emptyBounded('r1');
    for (const e of evAll) { s = applyBounded(s, e); if (e.seq % iv === 0) store.putSnapshot('r1', e.seq, s); }
    const snapMeta = store.db.prepare('SELECT COUNT(*) c, SUM(LENGTH(state)) b FROM snapshots').get();
    const lat = [];
    for (let k=0;k<30;k++){
      const a = now();
      const snap = store.getSnapshot('r1');
      const tail = store.readFrom('r1', snap ? snap.seq : 0);
      let st = snap ? snap.state : emptyBounded('r1');
      for (const e of tail) st = applyBounded(st, e);
      lat.push(ms(now()-a));
    }
    results[iv] = { p50:pct(lat,0.5), p95:pct(lat,0.95), p99:pct(lat,0.99), max:Math.max(...lat),
      snap_count:Number(snapMeta.c||0), snap_total_bytes:Number(snapMeta.b||0) };
  }

  // --- append latency at this scale (single-event path, the real per-turn cost)
  const al = [];
  for (let k=0;k<200;k++){ const a=now();
    store.append({run_id:'r1',seq:actual+1+k,type:'tool.succeeded',at:Date.now(),payload:{tool_call_id:'z',result:'x'.repeat(400)}});
    al.push(ms(now()-a)); }

  const row = { n: actual, db_bytes: dbBytes, bytes_per_event: dbBytes/actual,
    unbounded_state_bytes: unboundedBytes, bounded_state_bytes: boundedBytes,
    bounded_fold_ms: boundedFoldMs,
    append_p50: pct(al,0.5), append_p99: pct(al,0.99),
    snap: results };
  out.push(row);
  console.log(`n=${actual}  db=${(dbBytes/1e6).toFixed(1)}MB (${(dbBytes/actual).toFixed(0)} B/ev)  unbounded_state=${(unboundedBytes/1e6).toFixed(2)}MB  bounded_state=${(boundedBytes/1e3).toFixed(1)}KB  append_p99=${pct(al,0.99).toFixed(3)}ms`);
  for (const [iv,r] of Object.entries(results))
    console.log(`    snapshot@${iv}: load p50=${r.p50.toFixed(2)} p95=${r.p95.toFixed(2)} p99=${r.p99.toFixed(2)}ms | ${r.snap_count} snaps, ${(r.snap_total_bytes/1e6).toFixed(1)}MB total`);
  store.close();
}
fs.writeFileSync(path.join(OUT,'results-bounded.json'), JSON.stringify(out,null,2));
console.log('done');
