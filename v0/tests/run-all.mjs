import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const suites = [
  ['unit/event-store',      ['--max-old-space-size=6144']],
  ['concurrency/lease',     []],
  ['fencing/fencing',       []],
  ['runner/runner',         []],
  ['crash/matrix',          []],
  ['recovery/recovery',     []],
  ['replay/semantics',      []],
  ['integration/provider',  []],
  ['security/security',     []],
  ['compaction/compaction', []],
];

/** A required suite is healthy only with a normal exit and an explicit summary. */
export function assessSuiteResult(processResult, output) {
  const m = String(output ?? '').match(/(?:^|\r?\n)[^\r\n]*:\s+(\d+) passed,\s+(\d+) failed\b/);
  const pass = m ? Number(m[1]) : 0;
  const fail = m ? Number(m[2]) : 0;
  if (processResult?.error) return { ok: false, pass, fail, reason: `suite process error: ${processResult.error.message}` };
  if (processResult?.signal) return { ok: false, pass, fail, reason: `suite terminated by ${processResult.signal}` };
  if (processResult?.status !== 0) return { ok: false, pass, fail, reason: `suite exited with status ${processResult?.status}` };
  if (!m) return { ok: false, pass, fail, reason: 'suite produced no test summary' };
  if (fail !== 0) return { ok: false, pass, fail, reason: `suite reported ${fail} failed assertion(s)` };
  return { ok: true, pass, fail, reason: null };
}

export function main() {
  let totalPass = 0, totalFail = 0;
  const rows = [];
  for (const [s, nodeArgs] of suites) {
    const file = path.join(HERE, `${s}.test.mjs`);
    const t0 = Date.now();
    const p = spawnSync(process.execPath, [...nodeArgs, file], { encoding: 'utf8', timeout: 900_000 });
    const out = (p.stdout || '') + (p.stderr || '');
    const result = assessSuiteResult(p, out);
    const ms = Date.now() - t0;
    totalPass += result.pass;
    // Missing summary, timeout, crash, signal, and reported assertion failures all fail the run.
    if (!result.ok) totalFail += result.fail || 1;
    rows.push({ suite: s, ...result, ms, exit: p.status, signal: p.signal ?? null });
    console.log(`${result.ok ? 'OK  ' : 'FAIL'}  ${s.padEnd(24)} ${String(result.pass).padStart(3)} passed, ${result.fail} failed  (${(ms / 1000).toFixed(1)}s)`);
    if (!result.ok) {
      console.log(`      ${result.reason}`);
      console.log(out.split('\n').filter(l => l.includes('FAIL')).slice(0, 8).map(l => '      ' + l).join('\n'));
    }
  }
  console.log('\n' + '═'.repeat(60));
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed across ${suites.length} suites`);
  process.exitCode = totalFail ? 1 : 0;
  return { totalPass, totalFail, rows };
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url))) main();
