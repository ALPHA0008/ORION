// W5 P4 / experiment E1 — what does FULL durability actually cost at scale?
//
// The claim under test is Invariant 9's practical edge: the log is append-only and fsync'd, so
// the question a user will ask is "does it stay usable when a run gets long?" Answering it with
// a measurement rather than an assumption is the point.
//
// Measures, for both synchronous=FULL and synchronous=NORMAL:
//   - append throughput (events/sec) at 100k and 1M events
//   - the resulting database size
//   - full-log read time (what replay pays)
//
// Usage: node durability.mjs [n ...]        e.g. `node durability.mjs 100000 1000000`
//
// ── MEASURED 2026-09-08 ──────────────────────────────────────────────────────────────────
// Windows 11 (10.0.26100), Intel Core Ultra 9 285K (24 cores), 63 GB, Node v24.18.0, NVMe.
//
//   durability   events    ev/sec   µs/ev   append_s   read_ms   db_MB   B/ev
//   full        100,000     3,667   272.7       27.3       166    35.1    368
//   normal      100,000    40,520    24.7        2.5       153    35.1    368
//   full      1,000,000     3,430   291.5      291.5     2,201   355.2    372
//   normal    1,000,000    28,464    35.1       35.1     1,929   355.2    372
//
// WHAT THIS SAYS
//
// 1. Throughput is essentially FLAT in log size: FULL moves 3,667 ev/s at 100k and 3,430 ev/s
//    at 1M. Appending to a million-event log costs about what appending to a hundred-thousand-
//    event one does. That is the property that matters for Invariant 9 — a long-lived run does
//    not progressively slow down.
//
// 2. FULL costs 8-11x NORMAL (272.7 vs 24.7 µs/event at 100k). This is the fsync, and it is the
//    price of the durability guarantee, not a defect. The default stays `full`: the event log is
//    the only record of what a run did, and a lost tail after a power failure means an effect
//    that happened with nothing to say it did — precisely the orphan recovery cannot repair.
//
// 3. It is nowhere near the binding constraint. At 3,430 ev/s, a real run's ~10-100 events per
//    turn cost 3-30 ms; a single model call costs hundreds to thousands of ms. The log is three
//    to four orders of magnitude away from being the bottleneck, so trading the guarantee for
//    speed would buy nothing a user could perceive.
//
// 4. Storage is ~370 B/event, stable across both scales. A 1M-event run is ~355 MB, and reading
//    the entire log back — what replay pays — is 2.2 s. Both are linear and unsurprising.
//
// The tests deliberately use `durability: 'normal'`: they create thousands of databases and are
// measuring semantics, not fsync behaviour. Shipped defaults are what `full` protects.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, uid } from '../../src/core/run/store.mjs';

const SCALES = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [100_000, 1_000_000];
const PAYLOAD = { tool_call_id: 'tc_0123456789abcdef', name: 'read', result: 'x'.repeat(200) };

function measure(durability, n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dur-${durability}-`));
  const dbPath = path.join(dir, 'run.db');
  const store = new Store(dbPath, { durability });
  const runId = uid('run');
  store.createRun(runId, { task: 'durability experiment' });
  const claim = store.claim('w', { runId, leaseMs: 3_600_000 });

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) {
    store.append(runId, 'tool.succeeded', PAYLOAD, { leaseToken: claim.leaseToken });
  }
  const t1 = process.hrtime.bigint();
  const appendMs = Number(t1 - t0) / 1e6;

  const t2 = process.hrtime.bigint();
  const events = store.events(runId);
  const t3 = process.hrtime.bigint();
  const readMs = Number(t3 - t2) / 1e6;

  const bytes = fs.statSync(dbPath).size;
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });

  return {
    durability, events: n, read_back: events.length,
    append_ms: Math.round(appendMs),
    events_per_sec: Math.round(n / (appendMs / 1000)),
    us_per_event: +(appendMs * 1000 / n).toFixed(1),
    read_ms: Math.round(readMs),
    db_mb: +(bytes / 1024 / 1024).toFixed(1),
    bytes_per_event: Math.round(bytes / n),
  };
}

const rows = [];
for (const n of SCALES) {
  for (const d of ['full', 'normal']) {
    process.stderr.write(`measuring ${d} @ ${n.toLocaleString()} ...\n`);
    rows.push(measure(d, n));
  }
}

console.log(JSON.stringify(rows, null, 2));
console.log('\n' + ['durability', 'events', 'ev/sec', 'us/ev', 'append_s', 'read_ms', 'db_MB', 'B/ev']
  .map(s => s.padStart(10)).join(''));
for (const r of rows) {
  console.log([r.durability, r.events.toLocaleString(), r.events_per_sec.toLocaleString(),
    r.us_per_event, (r.append_ms / 1000).toFixed(1), r.read_ms, r.db_mb, r.bytes_per_event]
    .map(s => String(s).padStart(10)).join(''));
}
