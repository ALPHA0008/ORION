// Phase B — event ordering, projection determinism, projection boundedness.
import path from 'node:path'; import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { project, fold, emptyState, applyEvent, WINDOW } from '../../src/core/projection/index.mjs';
import { UnknownEventType } from '../../src/core/event/index.mjs';
import { describe, check, eq, throws, summary, tmpdir } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = tmpdir('eventstore');
const newStore = (n = 'a') => new Store(path.join(DIR, `${n}.db`), { durability: 'normal' });

// ═══════════════════════════════════════════════ 4.1 Event ordering
describe('4.1 event ordering: (run_id, seq) unique & monotonic');
{
  const s = newStore('ord');
  const r = uid(); s.createRun(r);

  const seqs = [];
  for (let i = 0; i < 50; i++) seqs.push(s.append(r, 'turn.started', { input: `i${i}` }));
  eq('seq allocation is contiguous from 1', seqs, Array.from({ length: 50 }, (_, i) => i + 2)); // +1 for run.created
  check('no duplicate seqs', new Set(seqs).size === seqs.length);
  check('strictly increasing', seqs.every((v, i) => i === 0 || v > seqs[i - 1]));

  // duplicate append at an existing seq must be rejected by the PK
  throws('duplicate (run_id,seq) rejected by PRIMARY KEY', () => {
    s.db.prepare('INSERT INTO events (run_id,seq,type,at,payload) VALUES (?,?,?,?,?)')
      .run(r, 5, 'turn.started', Date.now(), null);
  }, /UNIQUE|constraint/i);

  // no gaps
  const all = s.events(r);
  check('no gaps in the sequence', all.every((e, i) => e.seq === i + 1), `${all.length} events`);

  // out-of-order read is impossible: reads are ORDER BY seq
  const shuffledInsert = uid(); s.createRun(shuffledInsert);
  s.db.prepare('INSERT INTO events (run_id,seq,type,at,payload) VALUES (?,?,?,?,?)').run(shuffledInsert, 9, 'turn.started', 1, null);
  s.db.prepare('INSERT INTO events (run_id,seq,type,at,payload) VALUES (?,?,?,?,?)').run(shuffledInsert, 5, 'turn.started', 1, null);
  const read = s.events(shuffledInsert).map(e => e.seq);
  eq('reads are ordered regardless of insert order', read, [1, 5, 9]);

  // unknown type rejected (ADR-004: closed vocabulary)
  throws('unknown event type rejected', () => s.append(r, 'totally.made.up', {}), /unknown event type/);
  check('rejection is a typed error', (() => { try { s.append(r, 'nope', {}); } catch (e) { return e instanceof UnknownEventType; } })());

  // malformed payload rejected before it can corrupt the log
  const circular = {}; circular.self = circular;
  throws('non-serialisable payload rejected', () => s.append(r, 'turn.started', circular), /circular|JSON/i);

  // appendMany is all-or-nothing
  const before = s.lastSeq(r);
  try { s.appendMany(r, [{ type: 'turn.started', payload: { a: 1 } }, { type: 'bogus.type' }]); } catch {}
  eq('appendMany rolls back entirely on a bad entry', s.lastSeq(r), before);
  s.close();
}

// ═══════════════════════════════════ concurrent append (separate processes)
describe('4.1 concurrent append from multiple PROCESSES');
{
  const dbPath = path.join(DIR, 'concurrent.db');
  const s = new Store(dbPath, { durability: 'normal' });
  const r = uid(); s.createRun(r); s.close();

  const N_PROC = 4, N_EACH = 40;
  const script = path.join(HERE, '..', '_helpers', 'append-worker.mjs');
  const procs = Array.from({ length: N_PROC }, (_, i) =>
    spawnSync(process.execPath, [script, dbPath, r, String(N_EACH), `p${i}`], { encoding: 'utf8', timeout: 60_000 }));

  const allOk = procs.every(p => p.status === 0);
  check('all appender processes exited 0', allOk, procs.map(p => p.status).join(','));
  const returned = procs.flatMap(p => { try { return JSON.parse(p.stdout); } catch { return []; } });
  check('every process got a seq for every append', returned.length === N_PROC * N_EACH, `${returned.length}`);
  check('no two processes were given the same seq', new Set(returned).size === returned.length,
    `${new Set(returned).size} unique of ${returned.length}`);

  const s2 = new Store(dbPath, { durability: 'normal' });
  const evs = s2.events(r);
  check('log has exactly the expected number of events', evs.length === 1 + N_PROC * N_EACH, `${evs.length}`);
  check('log is gapless after concurrent writes', evs.every((e, i) => e.seq === i + 1));
  s2.close();
}

// ═══════════════════════════════════ process death during append
describe('4.1 process death during append');
{
  const dbPath = path.join(DIR, 'crashappend.db');
  const s = new Store(dbPath); const r = uid(); s.createRun(r);
  for (let i = 0; i < 10; i++) s.append(r, 'turn.started', { i });
  const before = s.lastSeq(r); s.close();

  const script = path.join(HERE, '..', '_helpers', 'crash-append.mjs');
  const p = spawnSync(process.execPath, [script, dbPath, r], { encoding: 'utf8', timeout: 30_000 });
  check('appender died by signal', p.signal === 'SIGKILL' || p.status !== 0, `${p.signal}/${p.status}`);

  const s3 = new Store(dbPath);
  const after = s3.events(r);
  check('committed event survived the kill', after.length === before + 1, `${before} -> ${after.length}`);
  check('log still gapless after a kill', after.every((e, i) => e.seq === i + 1));
  check('every payload still parses', after.every(e => e.payload === null || typeof e.payload === 'object'));
  s3.close();
}

// ═══════════════════════════════════════ 4.2 projection determinism
describe('4.2 projection determinism');
{
  const s = newStore('det');
  const r = uid(); s.createRun(r);
  s.claim('w1', { runId: r });
  for (let i = 0; i < 120; i++) {
    s.append(r, 'turn.started', { input: `t${i}` });
    s.append(r, 'model.requested', { model: 'm' });
    s.append(r, 'model.responded', { content: `c${i}`, input_tokens: 10, output_tokens: 5,
      tool_calls: [{ id: `tc${i}`, name: 'read', args: { path: 'a' } }] });
    s.append(r, 'tool.started', { tool_call_id: `tc${i}`, name: 'read', args: { path: 'a' } });
    s.append(r, 'tool.succeeded', { tool_call_id: `tc${i}`, name: 'read', result: 'x'.repeat(200) });
    if (i % 25 === 0) s.append(r, 'degraded', { subsystem: 'model', reason: 'retry' });
  }
  const evs = s.events(r);
  const a = JSON.stringify(fold(evs, emptyState(r)));
  const b = JSON.stringify(fold(evs, emptyState(r)));
  const c = JSON.stringify(fold(evs, emptyState(r)));
  check('fold is deterministic across 3 runs', a === b && b === c);

  // snapshot + tail == full replay, at several snapshot points
  let okAll = true, worst = '';
  for (const at of [10, 97, 300, 500, evs.length]) {
    const upto = Math.min(at, evs.length);
    let st = emptyState(r);
    for (const e of s.events(r, 0, upto)) st = applyEvent(st, e);
    s.putSnapshot(r, upto, st);
    const warm = JSON.stringify(project(s, r, { useSnapshot: true }));
    const cold = JSON.stringify(project(s, r, { useSnapshot: false }));
    if (warm !== cold) { okAll = false; worst = `mismatch at snapshot ${upto}`; }
  }
  check('snapshot+tail == full replay at every snapshot point', okAll, worst);

  // projection must not mutate the stored snapshot (aliasing bug guard)
  const snapBefore = JSON.stringify(s.getSnapshot(r).state);
  project(s, r, { useSnapshot: true });
  project(s, r, { useSnapshot: true });
  check('projecting does not mutate the stored snapshot', JSON.stringify(s.getSnapshot(r).state) === snapBefore);
  s.close();
}

// ═══════════════════════════════════════ 4.3 projection boundedness
describe('4.3 projection boundedness (1k / 10k / 100k / 1m)');
{
  const s = newStore('bounded');
  const sizes = [1_000, 10_000, 100_000, 1_000_000];
  const measured = [];
  for (const n of sizes) {
    const r = uid(); s.createRun(r);
    // build the log in batches for speed
    const batch = [];
    for (let i = 0; batch.length < n - 1; i++) {
      batch.push({ type: 'turn.started', payload: { input: `t${i}` } });
      batch.push({ type: 'model.responded', payload: { content: `c${i}`, input_tokens: 10, output_tokens: 5 } });
      batch.push({ type: 'tool.started', payload: { tool_call_id: `tc${i}`, name: 'read', args: { path: 'p' } } });
      batch.push({ type: 'tool.succeeded', payload: { tool_call_id: `tc${i}`, name: 'read', result: 'y'.repeat(400) } });
    }
    batch.length = n - 1;
    for (let i = 0; i < batch.length; i += 5000) s.appendMany(r, batch.slice(i, i + 5000));

    const st = project(s, r, { useSnapshot: false });
    const bytes = Buffer.byteLength(JSON.stringify(st));
    measured.push({ n, bytes, hot: st.recent_messages.length, total: st.message_count });
    console.log(`     n=${String(n).padStart(9)}  state=${String(bytes).padStart(6)}B  hot=${st.recent_messages.length}  total_msgs=${st.message_count}`);
  }
  const [small, large] = [measured[0], measured[measured.length - 1]];
  const growth = large.bytes / small.bytes;
  check('hot state does NOT grow with event count', growth < 1.5,
    `${small.bytes}B @${small.n} -> ${large.bytes}B @${large.n} (${growth.toFixed(2)}x over 1000x more events)`);
  check('hot message window stays at the cap', measured.every(m => m.hot <= WINDOW));
  check('full message count is still tracked', large.total > large.hot, `${large.total} total vs ${large.hot} hot`);
  check('state stays under 32KB at 1M events', large.bytes < 32_768, `${large.bytes}B`);
  s.close();
}

process.exit(summary('event-store', path.join(HERE, '../results-unit.json')) ? 1 : 0);
