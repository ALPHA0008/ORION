// Real-repository verification.
//
// Deterministic only. No LLM judge. Never scores from the agent's own prose — an agent that
// says "I fixed it" and changed nothing must FAIL, so the world state is always what is checked.
//
// ANTI-GAMING (section 17). The agent runs inside a sandbox rooted at the checkout, so it can
// edit the repository's tests. Before running anything we assert the test files are byte-identical
// to the pinned originals. Weakening or deleting a test is therefore a FAIL, not a pass.
// Hidden tests are written into the tree only AFTER the agent has finished, so they cannot be
// read, edited, or targeted during the run.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { OUTCOME } from '../tasks/schema.mjs';

const QUIET = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };

function runIn(dir, cmd, timeoutMs = 300_000) {
  try {
    const out = execSync(cmd, {
      cwd: dir, ...QUIET, timeout: timeoutMs,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    });
    return { ok: true, output: String(out) };
  } catch (e) {
    if (e.killed || e.signal === 'SIGTERM') return { ok: false, timedOut: true, output: 'timed out' };
    return { ok: false, output: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}

/**
 * Verify a completed run.
 *
 * @param {object} task
 * @param {object} repo
 * @param {{dir:string, testFileGuard?:Map<string,string>}} ctx
 */
export function verifyReal(task, repo, ctx) {
  const { dir } = ctx;
  try {
    // ── anti-gaming: the repo's own tests must be untouched ─────────────
    if (ctx.testFileGuard) {
      for (const [rel, expected] of ctx.testFileGuard) {
        const abs = path.join(dir, rel);
        if (!fs.existsSync(abs))
          return { outcome: OUTCOME.FAIL, detail: `agent deleted test file ${rel}`, evidence: 'anti-gaming guard' };
        if (fs.readFileSync(abs, 'utf8') !== expected)
          return { outcome: OUTCOME.FAIL, detail: `agent modified test file ${rel}`, evidence: 'anti-gaming guard' };
      }
    }

    const v = task.verification;
    const parts = [];

    // ── the repository's own suite ──────────────────────────────────────
    if (v.method === 'test_command' || (v.method === 'composite' && v.test_command)) {
      const r = runIn(dir, repo.test_command, task.timeout_ms);
      if (r.timedOut)
        return { outcome: OUTCOME.TIMEOUT, detail: 'repository test suite timed out', evidence: r.output.slice(-800) };
      parts.push({ name: 'repo_suite', pass: r.ok, evidence: tail(r.output) });
      if (v.method === 'test_command') {
        return {
          outcome: r.ok ? OUTCOME.PASS : OUTCOME.FAIL,
          detail: r.ok ? `${repo.test_command} passed` : `${repo.test_command} failed`,
          evidence: tail(r.output),
        };
      }
    }

    // ── file-state assertions ───────────────────────────────────────────
    if (v.method === 'file_state') {
      const misses = [];
      for (const a of v.assertions ?? []) {
        const abs = path.join(dir, a.path);
        const exists = fs.existsSync(abs);
        if (a.absent) { if (exists) misses.push(`${a.path} should be absent`); continue; }
        if (!exists) { misses.push(`${a.path} missing`); continue; }
        const c = fs.readFileSync(abs, 'utf8');
        if (a.contains && !c.includes(a.contains)) misses.push(`${a.path} lacks ${JSON.stringify(a.contains)}`);
        if (a.notContains && c.includes(a.notContains)) misses.push(`${a.path} still has ${JSON.stringify(a.notContains)}`);
        if (a.matches && !new RegExp(a.matches).test(c)) misses.push(`${a.path} !~ ${a.matches}`);
      }
      return { outcome: misses.length ? OUTCOME.FAIL : OUTCOME.PASS,
               detail: misses.length ? misses.join('; ') : 'file assertions held' };
    }

    // ── repository invariant (arbitrary programmatic check) ─────────────
    if (v.method === 'repo_invariant') {
      const r = v.check({ dir, repo, run: (cmd) => runIn(dir, cmd) });
      return { outcome: r.pass ? OUTCOME.PASS : OUTCOME.FAIL, detail: r.detail ?? '' };
    }

    // ── hidden tests: injected only now, never visible during the run ───
    if (v.method === 'hidden_test' || (v.method === 'composite' && v.hidden_tests)) {
      for (const h of v.hidden_tests ?? []) {
        const abs = path.join(dir, h.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, h.source);
        const r = runIn(dir, h.run, 120_000);
        parts.push({ name: `hidden:${path.basename(h.path)}`, pass: r.ok, evidence: tail(r.output) });
      }
    }

    if (!parts.length)
      return { outcome: OUTCOME.INFRA_FAILURE, detail: `unknown verification method ${v.method}` };

    const failed = parts.filter(p => !p.pass);
    return {
      outcome: failed.length ? OUTCOME.FAIL : OUTCOME.PASS,
      detail: failed.length ? `failed: ${failed.map(f => f.name).join(', ')}` : 'all checks passed',
      evidence: parts.map(p => `[${p.pass ? 'ok' : 'FAIL'}] ${p.name}\n${p.evidence}`).join('\n---\n').slice(-3000),
      parts,
    };
  } catch (e) {
    // A crash in OUR verifier is our fault, never the agent's.
    return { outcome: OUTCOME.INFRA_FAILURE, detail: `verifier threw: ${String(e.message).slice(0, 300)}` };
  }
}

const tail = (s) => String(s ?? '').replace(/\[[0-9;]*m/g, '').slice(-1200);

/** Snapshot the repository's test files so tampering can be detected after the run. */
export function snapshotTestFiles(dir) {
  const guard = new Map();
  const roots = ['test', 'tests', '__tests__'];
  const add = (rel) => {
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) guard.set(rel, fs.readFileSync(abs, 'utf8'));
  };
  for (const f of ['test.js', 'test.mjs', 'test.cjs', 'test-d.ts']) add(f);
  for (const r of roots) {
    const abs = path.join(dir, r);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    for (const e of fs.readdirSync(abs, { withFileTypes: true, recursive: true })) {
      if (!e.isFile()) continue;
      const rel = path.relative(dir, path.join(e.parentPath ?? e.path ?? abs, e.name)).split(path.sep).join('/');
      if (/\.(js|mjs|cjs|ts)$/.test(rel)) guard.set(rel, fs.readFileSync(path.join(dir, rel), 'utf8'));
    }
  }
  return guard;
}
