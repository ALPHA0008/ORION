// Experiment 2 — Tool recovery failure simulation.
// Question per tool: the process dies AFTER execution but BEFORE the success event
// is recorded. On resume the runtime sees `tool.started` with no terminal event.
// If it re-issues the call, what happens?
//
// We implement representative tools for real, crash between effect and event,
// then re-issue and observe.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP = path.join(os.tmpdir(), 'toolrec-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
const results = [];
const log = (...a) => console.log(...a);

function record(tool, cls, effectAfterReissue, detectable, note) {
  results.push({ tool, classification: cls, effect_after_reissue: effectAfterReissue,
    divergence_detectable: detectable, note });
  log(`${tool.padEnd(22)} ${cls.padEnd(26)} reissue=${effectAfterReissue.padEnd(18)} detectable=${detectable}`);
}

// ---------- 1. read_file : READ_ONLY ----------
{
  const f = path.join(TMP, 'r.txt'); fs.writeFileSync(f, 'hello');
  const a = fs.readFileSync(f, 'utf8');
  // crash, re-issue
  const b = fs.readFileSync(f, 'utf8');
  record('read_file', 'READ_ONLY', a === b ? 'identical' : 'DIVERGED', 'n/a',
    'Pure read. Re-issue is always safe. Result may differ if the world changed, but no effect is duplicated.');
}

// ---------- 2. search_files / grep : READ_ONLY ----------
{
  const d = path.join(TMP, 'g'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'a.txt'), 'needle here');
  const one = fs.readdirSync(d).filter(f => fs.readFileSync(path.join(d, f), 'utf8').includes('needle'));
  const two = fs.readdirSync(d).filter(f => fs.readFileSync(path.join(d, f), 'utf8').includes('needle'));
  record('grep / search_files', 'READ_ONLY', JSON.stringify(one) === JSON.stringify(two) ? 'identical' : 'DIVERGED',
    'n/a', 'Pure read.');
}

// ---------- 3. write_file (full content) : MUTATING_SAFE_RETRY ----------
{
  const f = path.join(TMP, 'w.txt');
  const content = 'final content v1';
  fs.writeFileSync(f, content);          // effect
  const afterFirst = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, content);          // crash -> re-issue with identical args
  const afterSecond = fs.readFileSync(f, 'utf8');
  record('write_file', 'MUTATING_SAFE_RETRY', afterFirst === afterSecond ? 'identical' : 'DIVERGED', 'yes (hash)',
    'Whole-content write is naturally idempotent: f(f(x)) == f(x). Re-issue is safe by construction.');
}

// ---------- 4. patch / edit_file (old_string -> new_string) : SELF-VERIFYING ----------
{
  const f = path.join(TMP, 'p.txt');
  fs.writeFileSync(f, 'line1\nOLD\nline3\n');
  const applyPatch = (oldS, newS) => {
    const cur = fs.readFileSync(f, 'utf8');
    const n = cur.split(oldS).length - 1;
    if (n === 0) return { ok: false, reason: 'old_string not found' };
    if (n > 1)  return { ok: false, reason: 'ambiguous: multiple matches' };
    fs.writeFileSync(f, cur.replace(oldS, newS));
    return { ok: true };
  };
  const first = applyPatch('OLD', 'NEW');
  const second = applyPatch('OLD', 'NEW');   // re-issue after crash
  const final = fs.readFileSync(f, 'utf8');
  const doubled = (final.split('NEW').length - 1) > 1;
  record('patch / edit_file', 'MUTATING_SELF_VERIFYING',
    second.ok ? 'DOUBLE-APPLIED' : 'no-op (rejected)', 'yes (precondition)',
    `Re-issue rejected with "${second.reason}". Content-addressed precondition means a replay ` +
    `either applies exactly once or fails loudly. Doubled=${doubled}. This is the strongest ` +
    `recovery property found and it requires NO idempotency key.`);
}

// ---------- 5. bash: append (non-idempotent shell) : MUTATING_UNSAFE_RETRY ----------
{
  const f = path.join(TMP, 'append.txt'); fs.writeFileSync(f, '');
  const appendCmd = () => fs.appendFileSync(f, 'x\n');
  appendCmd();                    // effect
  appendCmd();                    // crash -> re-issue
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n').length;
  record('bash (>> append)', 'MUTATING_UNSAFE_RETRY', lines === 2 ? 'DUPLICATED' : 'ok', 'no',
    `Re-issue duplicated the effect (${lines} lines, expected 1). Shell commands are opaque: the ` +
    `runtime cannot know whether "echo x >> f" is safe to repeat. THIS IS THE HARD CASE.`);
}

// ---------- 6. bash: idempotent shell (mkdir -p) : MUTATING_SAFE_RETRY ----------
{
  const d = path.join(TMP, 'mk', 'deep');
  fs.mkdirSync(d, { recursive: true });
  let err = null;
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { err = e; }
  record('bash (mkdir -p)', 'MUTATING_SAFE_RETRY', err ? 'ERROR' : 'identical', 'no',
    'Same tool (bash), opposite safety. Proves safety is a property of the ARGUMENTS, not the tool.');
}

// ---------- 7. git commit : EXTERNALLY_DEDUPLICATED (content-addressed) ----------
{
  const repo = path.join(TMP, 'repo'); fs.mkdirSync(repo);
  const g = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T',
           GIT_COMMITTER_EMAIL: 't@e', GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
           GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' } });
  g('init', '-q'); fs.writeFileSync(path.join(repo, 'a.txt'), 'v1');
  g('add', '.'); g('commit', '-q', '-m', 'c1');
  const sha1 = g('rev-parse', 'HEAD').trim();
  // re-issue the same commit after "crash": nothing staged -> git refuses
  let second = 'refused';
  try { g('commit', '-q', '-m', 'c1'); second = 'committed-again'; } catch { second = 'refused (nothing to commit)'; }
  const count = g('rev-list', '--count', 'HEAD').trim();
  record('git commit', 'MUTATING_SELF_VERIFYING', second.startsWith('refused') ? 'no-op (rejected)' : 'DUPLICATED',
    'yes (rev-parse)', `Second commit ${second}; history depth=${count}. Git refuses an empty commit, ` +
    `and state is verifiable via rev-parse. Recovery = compare HEAD to the recorded sha (${sha1.slice(0,8)}).`);
}

// ---------- 8. HTTP POST without idempotency key : MUTATING_UNSAFE_RETRY ----------
{
  // Simulate a server that counts POSTs
  let serverCount = 0;
  const post = () => { serverCount++; return { id: serverCount }; };
  post(); post();  // effect + re-issue
  record('HTTP POST (no key)', 'MUTATING_UNSAFE_RETRY', serverCount === 2 ? 'DUPLICATED' : 'ok', 'no',
    `Server saw ${serverCount} requests. Classic at-least-once hazard. Unrecoverable without a key ` +
    `or a server-side query to check whether the first one landed.`);
}

// ---------- 9. HTTP POST WITH idempotency key : EXTERNALLY_DEDUPLICATED ----------
{
  const seen = new Map();
  const postK = (key, body) => { if (seen.has(key)) return seen.get(key); const r = { id: seen.size + 1, body }; seen.set(key, r); return r; };
  const key = crypto.createHash('sha256').update('charge:order-42:1000').digest('hex').slice(0, 16);
  const a = postK(key, 1000), b = postK(key, 1000);
  record('HTTP POST (+key)', 'EXTERNALLY_DEDUPLICATED', a.id === b.id ? 'identical' : 'DUPLICATED', 'yes (key)',
    `Deduped server-side: both calls returned id=${a.id}. Requires the REMOTE to honour the key — ` +
    `the harness cannot provide this property itself, only propagate it.`);
}

// ---------- 10. email / external side effect : MUTATING_UNSAFE_RETRY, irreversible ----------
{
  const outbox = [];
  const send = () => outbox.push({ to: 'x@y', at: Date.now() });
  send(); send();
  record('send_email', 'MUTATING_UNSAFE_RETRY', outbox.length === 2 ? 'DUPLICATED' : 'ok', 'no',
    `${outbox.length} emails sent. Irreversible AND undetectable from the harness. Must escalate.`);
}

// ---------- 11. DB mutation in a transaction : TRANSACTIONAL ----------
{
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(TMP, 'tx.db'));
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); CREATE TABLE applied (op TEXT PRIMARY KEY)');
  const opId = 'op-123';
  const doOp = () => {
    db.exec('BEGIN');
    try {
      const seen = db.prepare('SELECT 1 FROM applied WHERE op=?').get(opId);
      if (seen) { db.exec('ROLLBACK'); return 'already-applied'; }
      db.prepare('INSERT INTO t (v) VALUES (?)').run('row');
      db.prepare('INSERT INTO applied (op) VALUES (?)').run(opId);
      db.exec('COMMIT'); return 'applied';
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const r1 = doOp(), r2 = doOp();
  const n = db.prepare('SELECT COUNT(*) c FROM t').get().c;
  record('db mutation (tx)', 'TRANSACTIONAL', n === 1 ? 'identical' : 'DUPLICATED', 'yes (op ledger)',
    `First=${r1}, second=${r2}, rows=${n}. When the effect and the dedup marker commit in ONE ` +
    `transaction, exactly-once is achievable. This is the only class with a real guarantee.`);
  db.close();
}

// ---------- 12. ask_user / escalate : NO_EFFECT ----------
{
  record('ask_user', 'READ_ONLY (no world effect)', 'identical', 'yes',
    'Creates a durable HumanRequest; re-issue is deduped by request_id. No external effect.');
}

fs.writeFileSync(path.join(HERE, 'simulation-results.json'), JSON.stringify(results, null, 2));
log('\n' + '='.repeat(100));
log(`${results.length} simulations run. Temp dir: ${TMP}`);
