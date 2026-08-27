// Experiment 4 — the smallest end-to-end durable harness.
// SQLite + event log + Run + BOUNDED state projection (per Experiment 1) + one model
// + 6 tools + local sandbox + lease + single worker. Nothing else.
//
// Deliberately NOT included: memory, skills, subagents, MCP, Postgres, multi-worker.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// ============================== EVENT STORE ==============================
export class Store {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'); // FULL: log is source of truth
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL,
        payload TEXT, PRIMARY KEY (run_id, seq));
      CREATE TABLE IF NOT EXISTS snapshots (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY (run_id, seq));
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, parent_run_id TEXT, forked_from_seq INTEGER,
        scope TEXT NOT NULL, principal TEXT NOT NULL, status TEXT NOT NULL,
        lease_expires_at INTEGER, worker_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS human_requests (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, prompt TEXT NOT NULL, options TEXT,
        status TEXT NOT NULL, response TEXT, created_at INTEGER NOT NULL, expires_at INTEGER);
      CREATE INDEX IF NOT EXISTS runs_claimable ON runs(status, lease_expires_at);`);
  }
  createRun(runId, { scope = 'personal:u1', principal = 'u1', parent = null, forkedFromSeq = null } = {}) {
    this.db.prepare(`INSERT INTO runs (id,parent_run_id,forked_from_seq,scope,principal,status,created_at)
                     VALUES (?,?,?,?,?,'pending',?)`).run(runId, parent, forkedFromSeq, scope, principal, Date.now());
    this.append(runId, 'run.created', { scope, principal, parent, forkedFromSeq });
  }
  nextSeq(runId) {
    const r = this.db.prepare('SELECT COALESCE(MAX(seq),0) m FROM events WHERE run_id=?').get(runId);
    return Number(r.m) + 1;
  }
  append(runId, type, payload) {
    const seq = this.nextSeq(runId);
    this.db.prepare('INSERT INTO events (run_id,seq,type,at,payload) VALUES (?,?,?,?,?)')
      .run(runId, seq, type, Date.now(), payload ? JSON.stringify(payload) : null);
    return seq;
  }
  events(runId, afterSeq = 0, upToSeq = Number.MAX_SAFE_INTEGER) {
    return this.db.prepare('SELECT seq,type,at,payload FROM events WHERE run_id=? AND seq>? AND seq<=? ORDER BY seq')
      .all(runId, afterSeq, upToSeq)
      .map(r => ({ seq: Number(r.seq), type: r.type, at: Number(r.at), payload: r.payload ? JSON.parse(r.payload) : null }));
  }
  putSnapshot(runId, seq, state) {
    this.db.prepare('INSERT OR REPLACE INTO snapshots (run_id,seq,state) VALUES (?,?,?)')
      .run(runId, seq, JSON.stringify(state));
  }
  getSnapshot(runId, upToSeq = Number.MAX_SAFE_INTEGER) {
    const r = this.db.prepare('SELECT seq,state FROM snapshots WHERE run_id=? AND seq<=? ORDER BY seq DESC LIMIT 1')
      .get(runId, upToSeq);
    return r ? { seq: Number(r.seq), state: JSON.parse(r.state) } : null;
  }
  // ---- lease: claim a runnable run atomically ----
  claim(workerId, leaseMs = 30_000) {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT id FROM runs
        WHERE status IN ('pending','running')
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        ORDER BY created_at LIMIT 1`).get(now);
      if (!row) { this.db.exec('COMMIT'); return null; }
      this.db.prepare('UPDATE runs SET status=?, worker_id=?, lease_expires_at=?, attempts=attempts+1 WHERE id=?')
        .run('running', workerId, now + leaseMs, row.id);
      this.db.exec('COMMIT');
      this.append(row.id, 'run.leased', { worker_id: workerId, lease_expires_at: now + leaseMs });
      return row.id;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  renew(runId, workerId, leaseMs = 30_000) {
    const exp = Date.now() + leaseMs;
    this.db.prepare('UPDATE runs SET lease_expires_at=? WHERE id=? AND worker_id=?').run(exp, runId, workerId);
    this.append(runId, 'run.lease_renewed', { lease_expires_at: exp });
  }
  setStatus(runId, status, { releaseLease = false } = {}) {
    this.db.prepare(`UPDATE runs SET status=?${releaseLease ? ', lease_expires_at=NULL, worker_id=NULL' : ''} WHERE id=?`)
      .run(status, runId);
  }
  run(runId) { return this.db.prepare('SELECT * FROM runs WHERE id=?').get(runId); }
  close() { try { this.db.close(); } catch {} }
}

// ============================== BOUNDED PROJECTION ==============================
// Experiment 1 finding: the projection MUST be bounded or snapshot load degrades.
export const WINDOW = 40;
export function emptyState(runId) {
  return { run_id: runId, status: 'pending', seq: 0,
    recent_messages: [], message_count: 0,
    pending_tool_calls: {}, open_human_requests: {},
    budget: { tokens: 0, tool_calls: 0, model_calls: 0 },
    degradations: [], degradation_count: 0,
    result: null, exit_reason: null };
}
export function applyEvent(s, e) {
  const p = e.payload || {}; s.seq = e.seq;
  const push = (m) => { s.message_count++; s.recent_messages.push(m);
    if (s.recent_messages.length > WINDOW) s.recent_messages.shift(); };
  switch (e.type) {
    case 'run.created':   s.status = 'pending'; break;
    case 'run.leased':    s.status = 'running'; break;
    case 'run.paused':    s.status = 'paused'; break;
    case 'run.resumed':   s.status = 'running'; break;
    case 'run.completed': s.status = 'completed'; s.result = p.result; s.exit_reason = p.reason; break;
    case 'run.failed':    s.status = 'failed'; s.exit_reason = p.reason; break;
    case 'turn.started':  push({ role: 'user', content: p.input }); break;
    case 'model.requested':  s.budget.model_calls++; break;
    case 'model.responded':
      s.budget.tokens += (p.input_tokens || 0) + (p.output_tokens || 0);
      push({ role: 'assistant', content: p.content, tool_calls: p.tool_calls || null }); break;
    case 'tool.started':
      s.pending_tool_calls[p.tool_call_id] = { name: p.name, args: p.args };
      s.budget.tool_calls++; break;
    case 'tool.succeeded':
      delete s.pending_tool_calls[p.tool_call_id];
      push({ role: 'tool', tool_call_id: p.tool_call_id, name: p.name, content: p.result }); break;
    case 'tool.failed':
      delete s.pending_tool_calls[p.tool_call_id];
      push({ role: 'tool', tool_call_id: p.tool_call_id, name: p.name, content: `ERROR: ${p.error}` }); break;
    case 'tool.denied':
      delete s.pending_tool_calls[p.tool_call_id];
      push({ role: 'tool', tool_call_id: p.tool_call_id, name: p.name, content: `DENIED: ${p.reason}` }); break;
    case 'tool.escalated':
      s.pending_tool_calls[p.tool_call_id] = { name: p.name, args: p.args, escalated: true }; break;
    case 'human.requested': s.open_human_requests[p.request_id] = { prompt: p.prompt, tool_call_id: p.tool_call_id }; break;
    case 'human.responded': {
      delete s.open_human_requests[p.request_id];
      break;
    }
    case 'degraded':
      s.degradation_count++;
      s.degradations.push({ subsystem: p.subsystem, reason: p.reason, at: e.at });
      if (s.degradations.length > 10) s.degradations.shift();   // bounded
      break;
    default: break;
  }
  return s;
}
export function project(store, runId, { upToSeq = Number.MAX_SAFE_INTEGER, useSnapshot = true } = {}) {
  let base = null, from = 0;
  if (useSnapshot) {
    const snap = store.getSnapshot(runId, upToSeq);
    if (snap) { base = snap.state; from = snap.seq; }
  }
  let s = base ?? emptyState(runId);
  for (const e of store.events(runId, from, upToSeq)) s = applyEvent(s, e);
  return s;
}

// ============================== SANDBOX (local) ==============================
export class LocalSandbox {
  constructor(root) { this.root = root; fs.mkdirSync(root, { recursive: true }); }
  _abs(p) {
    const a = path.resolve(this.root, p);
    if (!a.startsWith(path.resolve(this.root))) throw new Error('path escapes sandbox');
    return a;
  }
  read(p) { return fs.readFileSync(this._abs(p), 'utf8'); }
  write(p, c) { const a = this._abs(p); fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, c); }
  exists(p) { try { fs.accessSync(this._abs(p)); return true; } catch { return false; } }
  list(p = '.') { return fs.readdirSync(this._abs(p)); }
  exec(cmd) {
    return execFileSync(process.platform === 'win32' ? 'bash' : 'sh', ['-lc', cmd],
      { cwd: this.root, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  // ---- git shadow-repo checkpoints (Hermes L-03) ----
  initCheckpoints(store) {
    this.shadow = path.join(store, 'shadow.git');
    if (!fs.existsSync(this.shadow)) {
      fs.mkdirSync(this.shadow, { recursive: true });
      this._git(['init', '--bare', '-q']);
    }
  }
  _git(args) {
    return execFileSync('git', args, { cwd: this.shadow, encoding: 'utf8',
      env: { ...process.env, GIT_DIR: this.shadow, GIT_WORK_TREE: this.root,
             GIT_AUTHOR_NAME: 'harness', GIT_AUTHOR_EMAIL: 'h@local',
             GIT_COMMITTER_NAME: 'harness', GIT_COMMITTER_EMAIL: 'h@local' } });
  }
  snapshot(label) {
    if (!this.shadow) return null;
    this._git(['add', '-A']);
    try { return this._git(['commit', '-q', '-m', label, '--allow-empty']) , this._git(['rev-parse', 'HEAD']).trim(); }
    catch { return null; }
  }
  restore(ref) { this._git(['checkout', '-f', ref, '--', '.']); }
}

// ============================== TOOLS (6) ==============================
// Per Experiment 2: recovery() is declared PER INVOCATION, not per tool.
export function makeTools(sandbox) {
  return {
    read: {
      schema: { path: 'string' },
      recovery: () => ({ class: 'READ_ONLY' }),
      run: ({ path: p }) => sandbox.read(p),
    },
    grep: {
      schema: { pattern: 'string', path: 'string' },
      recovery: () => ({ class: 'READ_ONLY' }),
      run: ({ pattern, path: p = '.' }) => {
        const hits = [];
        const walk = (d) => { for (const f of sandbox.list(d)) {
          const rel = d === '.' ? f : `${d}/${f}`;
          let isDir = false; try { isDir = fs.statSync(sandbox._abs(rel)).isDirectory(); } catch {}
          if (isDir) walk(rel);
          else { const c = sandbox.read(rel); c.split('\n').forEach((ln, i) => {
            if (ln.includes(pattern)) hits.push(`${rel}:${i + 1}: ${ln.trim()}`); }); }
        } };
        walk(p);
        return hits.join('\n') || '(no matches)';
      },
    },
    write: {
      schema: { path: 'string', content: 'string' },
      // whole-content write is naturally idempotent (Exp 2, sim #3)
      recovery: ({ path: p, content }) => ({
        class: 'SAFE_RETRY',
        verify: () => { try { return sandbox.read(p) === content ? 'applied' : 'not-applied'; }
                        catch { return 'not-applied'; } },
      }),
      run: ({ path: p, content }) => { sandbox.write(p, content); return `wrote ${p} (${content.length} bytes)`; },
    },
    edit: {
      schema: { path: 'string', old_string: 'string', new_string: 'string' },
      // content-addressed precondition => self-verifying (Exp 2, sim #4)
      recovery: ({ path: p, old_string, new_string }) => ({
        class: 'SELF_VERIFYING',
        precondition: old_string,
        verify: () => { try { const c = sandbox.read(p);
          if (c.includes(new_string) && !c.includes(old_string)) return 'applied';
          if (c.includes(old_string)) return 'not-applied';
          return 'unknown'; } catch { return 'unknown'; } },
      }),
      run: ({ path: p, old_string, new_string }) => {
        const cur = sandbox.read(p);
        const n = cur.split(old_string).length - 1;
        if (n === 0) throw new Error(`old_string not found in ${p}`);
        if (n > 1) throw new Error(`old_string ambiguous in ${p} (${n} matches)`);
        sandbox.write(p, cur.replace(old_string, new_string));
        return `edited ${p}`;
      },
    },
    bash: {
      schema: { cmd: 'string' },
      // Exp 2 §3.1: safety depends on ARGS, not the tool. Heuristic classifier.
      recovery: ({ cmd }) => {
        const SAFE = /^\s*(mkdir -p|ls|cat|pwd|echo [^>]*$|test |true|which |node --version)/;
        const UNSAFE = /(>>|git push|curl -X (POST|PUT|DELETE)|rm -rf|npm publish|mail )/;
        if (UNSAFE.test(cmd)) return { class: 'UNSAFE' };
        if (SAFE.test(cmd)) return { class: 'SAFE_RETRY' };
        return { class: 'UNSAFE' }; // default deny: escalate rather than guess
      },
      run: ({ cmd }) => sandbox.exec(cmd),
    },
    ask_user: {
      schema: { prompt: 'string', options: 'array?' },
      recovery: () => ({ class: 'READ_ONLY' }),
      run: () => { throw new Error('ask_user must be handled by the runtime as an escalation'); },
    },
  };
}

// ============================== AUTHORIZATION SEAM ==============================
// allow | deny | escalate  — the single seam (ARCHITECTURE 7)
export function makeAuthorizer(rules = {}) {
  const { denyTools = [], escalateTools = ['ask_user'], denyPattern = null } = rules;
  return function authorize(action) {
    if (action.kind === 'tool') {
      if (denyTools.includes(action.name)) return { decision: 'deny', reason: `tool ${action.name} denied by policy` };
      if (escalateTools.includes(action.name))
        return { decision: 'escalate', prompt: action.args?.prompt ?? `Approve ${action.name}?`, options: action.args?.options };
      if (denyPattern && action.name === 'bash' && denyPattern.test(action.args?.cmd ?? ''))
        return { decision: 'deny', reason: 'command matches deny policy' };
      // Exp 2: unsafe-to-retry mutations escalate when the policy asks for it
      if (rules.escalateUnsafe && action.recovery?.class === 'UNSAFE')
        return { decision: 'escalate', prompt: `Run unsafe-to-retry ${action.name}: ${JSON.stringify(action.args).slice(0,120)}?` };
    }
    return { decision: 'allow' };
  };
}

export const uid = (p = 'r') => `${p}_${crypto.randomBytes(5).toString('hex')}`;
