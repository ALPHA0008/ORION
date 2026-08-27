// Experiment 1c — bounded projection on Postgres.
// bench.mjs (unbounded) showed p99=100ms snapshot load at 100k events on PG,
// which BLOWS the 50ms p99 target. Does bounding the projection fix it?
import { PgEventStore, generateRun } from './eventstore.mjs';
import path from 'node:path'; import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const OUT = path.dirname(fileURLToPath(import.meta.url));
const ms = n => Number(n)/1e6, now = () => process.hrtime.bigint();
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(s.length*p))];};

const WINDOW = 40;
const emptyBounded = (r) => ({ run_id:r, status:'pending', seq:0, recent_messages:[], message_count:0,
  pending_tool_calls:{}, budget_consumed:{tokens:0,tool_calls:0,model_calls:0},
  open_human_requests:{}, children_count:0, degradation_count:0, last_degradation:null,
  lease_expires_at:null, worker_id:null, attempts:0 });
function applyBounded(s,e){ const p=e.payload||{}; s.seq=e.seq;
  const push=m=>{s.message_count++;s.recent_messages.push(m);if(s.recent_messages.length>WINDOW)s.recent_messages.shift();};
  switch(e.type){
    case 'run.created':s.status='pending';break;
    case 'run.leased':s.status='running';s.worker_id=p.worker_id;s.lease_expires_at=p.lease_expires_at;s.attempts++;break;
    case 'run.lease_renewed':s.lease_expires_at=p.lease_expires_at;break;
    case 'run.completed':s.status='completed';break;
    case 'turn.started':push({role:'user',content:p.input??''});break;
    case 'model.requested':s.budget_consumed.model_calls++;break;
    case 'model.responded':s.budget_consumed.tokens+=(p.input_tokens||0)+(p.output_tokens||0);
      push({role:'assistant',content:p.content??'',tool_calls:p.tool_calls});break;
    case 'tool.started':s.pending_tool_calls[p.tool_call_id]={name:p.name};s.budget_consumed.tool_calls++;break;
    case 'tool.succeeded':delete s.pending_tool_calls[p.tool_call_id];push({role:'tool',tool_call_id:p.tool_call_id,content:p.result??''});break;
    case 'tool.failed':case 'tool.timed_out':delete s.pending_tool_calls[p.tool_call_id];push({role:'tool',tool_call_id:p.tool_call_id,content:'[fail]'});break;
    case 'human.requested':s.open_human_requests[p.request_id]={prompt:p.prompt};break;
    case 'human.responded':case 'human.timed_out':delete s.open_human_requests[p.request_id];break;
    case 'degraded':s.degradation_count++;s.last_degradation={subsystem:p.subsystem,at:e.at};break;
    default:break; } return s; }

const pgPath = path.join(OUT,'..','..','repos','qm','node_modules','pg','lib','index.js');
const { default: pg } = await import(pathToFileURL(pgPath).href);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const store = new PgEventStore(c); await store.init();

const out = [];
for (const n of (process.env.SIZES||'1000,10000,100000').split(',').map(Number)) {
  const runId = `b${n}`;
  await c.query('DELETE FROM events WHERE run_id=$1',[runId]);
  await c.query('DELETE FROM snapshots WHERE run_id=$1',[runId]);
  const events=[...generateRun(runId,n)]; const actual=events.length;
  for (let i=0;i<events.length;i+=1000) await store.appendBatch(events.slice(i,i+1000));
  const evAll = await store.readFrom(runId,0);

  const row = { n: actual, snap: {} };
  for (const iv of [1000, 5000]) {
    if (iv > actual) continue;
    await c.query('DELETE FROM snapshots WHERE run_id=$1',[runId]);
    let s = emptyBounded(runId);
    for (const e of evAll){ s=applyBounded(s,e); if(e.seq%iv===0) await store.putSnapshot(runId,e.seq,s); }
    const lat=[];
    for(let k=0;k<20;k++){ const a=now();
      const snap=await store.getSnapshot(runId);
      const tail=await store.readFrom(runId, snap?snap.seq:0);
      let st=snap?snap.state:emptyBounded(runId);
      for(const e of tail) st=applyBounded(st,e);
      lat.push(ms(now()-a)); }
    const sm = await c.query('SELECT COUNT(*) c, SUM(LENGTH(state::text)) b FROM snapshots WHERE run_id=$1',[runId]);
    row.snap[iv]={p50:pct(lat,0.5),p95:pct(lat,0.95),p99:pct(lat,0.99),max:Math.max(...lat),
      snap_count:Number(sm.rows[0].c), snap_bytes:Number(sm.rows[0].b||0)};
  }
  // bounded state size
  let sb=emptyBounded(runId); for(const e of evAll) sb=applyBounded(sb,e);
  row.bounded_state_bytes = Buffer.byteLength(JSON.stringify(sb));
  out.push(row);
  console.log(`pg-bounded n=${actual} state=${(row.bounded_state_bytes/1e3).toFixed(1)}KB`);
  for(const [iv,r] of Object.entries(row.snap))
    console.log(`    snapshot@${iv}: load p50=${r.p50.toFixed(2)} p95=${r.p95.toFixed(2)} p99=${r.p99.toFixed(2)}ms | ${r.snap_count} snaps ${(r.snap_bytes/1e6).toFixed(2)}MB`);
}
await c.end();
fs.writeFileSync(path.join(OUT,'results-pg-bounded.json'), JSON.stringify(out,null,2));
console.log('done');
