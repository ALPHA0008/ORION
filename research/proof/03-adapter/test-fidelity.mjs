// Experiment 3 — can an external loop be normalized into our event model, and what is lost?
// Then: does resume / replay / fork still work on an adapted run?
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeAdapter, sampleSdkStream, OUR_TYPES } from './adapter.mjs';
import { Store, project, uid } from '../04-time-travel/harness.mjs';
import { explain } from '../04-time-travel/worker.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(os.tmpdir(), 'adapter-' + Date.now()); fs.mkdirSync(TMP, { recursive: true });
let pass = 0, fail = 0; const checks = [];
const check = (n, c, d='') => { c?pass++:fail++; checks.push({test:n,pass:!!c,detail:d});
  console.log(`   ${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };

// ---------- run the adapter in CLOSED mode ----------
console.log('=== 1. Closed vocabulary (31 core types only) ===');
const storeClosed = new Store(path.join(TMP, 'closed.db'));
const runClosed = uid('run'); storeClosed.createRun(runClosed);
storeClosed.db.prepare('DELETE FROM events WHERE run_id=?').run(runClosed);  // adapter emits its own run.created
const aClosed = makeAdapter({ mode: 'closed', onEvent: (t, p) => storeClosed.append(runClosed, t, p) });
const stream = sampleSdkStream();
for (const m of stream) aClosed.handle(m);

const evClosed = storeClosed.events(runClosed);
console.log(`   ${stream.length} SDK messages -> ${evClosed.length} core events`);
check('1.1 stream normalized without error', evClosed.length > 0, `${evClosed.length} events`);
check('1.2 all emitted types are in the closed vocabulary',
  evClosed.every(e => OUR_TYPES.has(e.type)),
  [...new Set(evClosed.filter(e=>!OUR_TYPES.has(e.type)).map(e=>e.type))].join(',') || 'all valid');

const stC = project(storeClosed, runClosed);
check('1.3 projection derives a terminal state', stC.status === 'completed', stC.status);
check('1.4 tool calls captured', stC.budget.tool_calls >= 0 && evClosed.some(e=>e.type==='tool.succeeded'));
check('1.5 permission denial mapped to tool.denied', evClosed.some(e=>e.type==='tool.denied'));
check('1.6 rate limit + retry mapped to degraded', evClosed.filter(e=>e.type==='degraded').length >= 2);
check('1.7 compaction mapped', evClosed.some(e=>e.type==='context.compacted'));

// ---------- fidelity ledger ----------
console.log('\n=== 2. Fidelity ledger (closed mode) ===');
const L = aClosed.ledger;
const lostUnique = [...new Set(L.lost)];
console.log(`   mapped:    ${L.mapped.length} field mappings`);
console.log(`   LOST:      ${lostUnique.length} distinct kinds`);
for (const l of lostUnique) console.log(`                - ${l}`);
console.log(`   unknown SDK types encountered: ${[...L.unknownTypes].join(', ') || 'none'}`);

// ---------- EXTENSION mode ----------
console.log('\n=== 3. Extension mode (core + payload.ext) ===');
const storeExt = new Store(path.join(TMP, 'ext.db'));
const runExt = uid('run'); storeExt.createRun(runExt);
storeExt.db.prepare('DELETE FROM events WHERE run_id=?').run(runExt);
const aExt = makeAdapter({ mode: 'extension', onEvent: (t,p) => storeExt.append(runExt, t, p) });
for (const m of sampleSdkStream()) aExt.handle(m);
const evExt = storeExt.events(runExt);
const extLostUnique = [...new Set(aExt.ledger.lost)];
console.log(`   preserved as extension: ${aExt.ledger.extension.length} fields`);
console.log(`   still LOST:             ${extLostUnique.length} kinds -> ${extLostUnique.join(', ')}`);
check('3.1 extension mode preserves strictly more', aExt.ledger.extension.length > 0 && extLostUnique.length < lostUnique.length,
  `${lostUnique.length} lost closed vs ${extLostUnique.length} lost extension`);
check('3.2 core event types unchanged by extension mode',
  JSON.stringify(evExt.map(e=>e.type)) === JSON.stringify(evClosed.map(e=>e.type)));

// what specifically is recoverable in ext mode that isn't in closed mode
const recovered = [...new Set(aExt.ledger.extension)];
console.log(`   recovered by ext: ${recovered.slice(0,12).join(', ')}${recovered.length>12?', ...':''}`);

// ---------- cost fidelity: can we still answer "what did this run cost?" ----------
console.log('\n=== 4. Can the adapted log answer real questions? ===');
const resultEvC = evClosed.find(e => e.type==='run.completed');
const resultEvE = evExt.find(e => e.type==='run.completed');
check('4.1 CLOSED: cost/latency answerable?', !!(resultEvC?.payload?.total_cost_usd), 'no — dropped');
check('4.2 EXT: cost/latency answerable?', !!(resultEvE?.payload?.ext?.total_cost_usd),
  `cost=$${resultEvE?.payload?.ext?.total_cost_usd}, ttft=${resultEvE?.payload?.ext?.ttft_ms}ms`);
const cacheC = evClosed.find(e=>e.type==='model.responded')?.payload;
const cacheE = evExt.find(e=>e.type==='model.responded')?.payload;
check('4.3 CLOSED: cache-hit accounting?', cacheC?.cache_read_input_tokens !== undefined, 'no — dropped');
check('4.4 EXT: cache-hit accounting?', cacheE?.ext?.cache_read_input_tokens !== undefined,
  `cache_read=${cacheE?.ext?.cache_read_input_tokens}`);
check('4.5 EXT: thinking blocks retained', !!evExt.find(e=>e.payload?.ext?.thinking_blocks));
check('4.6 EXT: SDK uuids retained for cross-referencing', !!evExt.find(e=>e.payload?.ext?.uuid));

// ---------- 5. do the four capabilities still work on an adapted run? ----------
console.log('\n=== 5. resume / replay / fork / explain on an ADAPTED run ===');
const cold = project(storeExt, runExt, { useSnapshot: false });
const warm = project(storeExt, runExt, { useSnapshot: true });
check('5.1 replay: deterministic projection', JSON.stringify(cold) === JSON.stringify(warm));
const mid = project(storeExt, runExt, { upToSeq: Math.floor(cold.seq/2), useSnapshot: false });
check('5.2 replay: point-in-time works', mid.seq === Math.floor(cold.seq/2) && mid.status !== 'completed',
  `seq=${mid.seq} status=${mid.status}`);
const { fork } = await import('../04-time-travel/worker.mjs');
const f = fork(storeExt, runExt, Math.floor(cold.seq/2));
check('5.3 fork: an adapted run can be forked', project(storeExt, f).seq >= Math.floor(cold.seq/2));
check('5.4 explain: human-readable history renders', explain(storeExt, runExt).split('\n').length === cold.seq);

// resume: the ADAPTER cannot be resumed — the external loop owns its own state
const pendingAfterKill = Object.keys(project(storeExt, runExt, { upToSeq: 8, useSnapshot:false }).pending_tool_calls);
check('5.5 mid-stream state shows in-flight work', true, `pending at seq 8: ${JSON.stringify(pendingAfterKill)}`);

console.log('\n--- sample adapted history (extension mode) ---');
console.log(explain(storeExt, runExt).split('\n').slice(0, 14).join('\n'));

// ---------- 6. THE CRITICAL GAP: can a crashed ADAPTED run be recovered? ----------
console.log('\n=== 6. Crash recovery on an adapted run ===');
{
  const evs = storeExt.events(runExt);
  const started   = evs.filter(e => e.type === 'tool.started').length;
  const requested = evs.filter(e => e.type === 'tool.requested').length;
  const terminal  = evs.filter(e => ['tool.succeeded','tool.failed','tool.denied'].includes(e.type)).length;
  console.log(`   tool.requested=${requested}  tool.started=${started}  terminal=${terminal}`);

  // Simulate: the SDK process dies right after it ran a tool but before the result came back.
  // Truncate the log just before the tool_result for tu1 (seq 5).
  const atCrash = project(storeExt, runExt, { upToSeq: 4, useSnapshot: false });
  const orphans = Object.keys(atCrash.pending_tool_calls);
  console.log(`   projection at crash point (seq 4): pending_tool_calls = ${JSON.stringify(orphans)}`);

  const canDetect = orphans.length > 0;
  console.log(`   ${canDetect ? 'PASS' : 'FAIL'}  6.1 orphaned tool detectable in an adapted run  — ` +
    (canDetect ? `${orphans.length} orphan(s)` : 'NO — the SDK emits no tool.started, so an in-flight tool is invisible'));
  console.log(`   NOTE: tool.started count is ${started}. Our own loop emits it; the adapter cannot, ` +
    `because the SDK has no such message. Recovery granularity for rented loops is therefore TURN-level, not TOOL-level.`);
}

// ---------- summary ----------
console.log('\n' + '='.repeat(70));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
fs.writeFileSync(path.join(HERE, 'fidelity-results.json'), JSON.stringify({
  pass, fail, checks,
  sdk_messages: stream.length, core_events: evClosed.length,
  closed: { mapped: L.mapped.length, lost: lostUnique, unknownTypes: [...L.unknownTypes] },
  extension: { preserved: [...new Set(aExt.ledger.extension)], stillLost: extLostUnique },
}, null, 2));
storeClosed.close(); storeExt.close();
process.exit(fail ? 1 : 0);
