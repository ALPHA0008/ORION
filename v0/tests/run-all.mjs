import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const suites = [
  ['unit/event-store',      ['--max-old-space-size=6144']],
  ['repl/repl',             []],
  ['leaseheartbeat/leaseheartbeat', []],
  ['truthfulcompletion/truthfulcompletion', []],
  ['planning/planning',     []],
  ['context/context',       []],
  ['providers/providers',   []],
  ['streaming/streaming',   []],
  ['shipped/shipped',       []],
  ['concurrency/lease',     []],
  ['fencing/fencing',       []],
  ['runner/runner',         []],
  ['crash/matrix',          []],
  ['recovery/recovery',     []],
  ['replay/semantics',      []],
  ['integration/provider',  []],
  ['security/security',     []],
  ['compaction/compaction', []],
  ['readpaging/readpaging', []],
  ['readfidelity/readfidelity', []],
  ['editdiag/editdiag',     []],
  ['writerecovery/writerecovery', []],
  ['writewitness/writewitness', []],
  ['escalationgate/escalationgate', []],
  ['escalationgate/escalation-lifecycle', []],
  ['escalationgate/bypass', []],
  ['worldstate/worldstate',   []],
  ['completiongate/completiongate', []],
  ['completioncontract/completioncontract', []],
  ['worldstate/concurrent-race', []],
  ['worldstate/real-repo-race', []],
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

/**
 * Shell preflight.
 *
 * Several suites shell out through LocalSandbox. On Windows the sandbox resolves the bare name
 * `bash` through PATH, and what that finds is not always a shell that can run the workspace:
 * WSL's C:\Windows\System32\bash.exe resolves first when Git for Windows is absent, and it
 * executes in a DIFFERENT filesystem namespace (`/mnt/d/...`), so workspace paths do not match
 * and commands silently produce empty output.
 *
 * Diagnosed once, loudly, before 24 suites fail in confusing ways further down. This checks
 * that the shell can (a) run at all, (b) see the directory we hand it, and (c) evaluate the
 * POSIX constructs the suites actually use.
 */
export function preflightShell() {
  if (process.platform !== 'win32') return { ok: true };
  const probe = 'i=1; while [ "$i" -le 3 ]; do echo "row $i"; i=$((i+1)); done';
  const r = spawnSync('bash', ['-lc', probe], { encoding: 'utf8', cwd: HERE, timeout: 30_000 });
  if (r.error || r.status !== 0) {
    return { ok: false, reason: `\`bash\` could not run a POSIX loop (${r.error?.code ?? 'exit ' + r.status}).` };
  }
  const got = (r.stdout || '').trim();
  if (!/row 1[\s\S]*row 3/.test(got)) {
    return { ok: false, reason: `\`bash\` ran but produced unusable output: ${JSON.stringify(got.slice(0, 60))}. `
      + 'This is the signature of WSL bash resolving ahead of Git Bash — it executes in a different '
      + 'filesystem namespace and cannot see the Windows workspace.' };
  }
  return { ok: true };
}

export function main() {
  let totalPass = 0, totalFail = 0;
  const rows = [];

  const pf = preflightShell();
  if (!pf.ok) {
    console.log('SHELL PREFLIGHT FAILED');
    console.log(`  ${pf.reason}`);
    console.log('  Fix: install Git for Windows and ensure its bin/ precedes C:\\Windows\\System32 on PATH,');
    console.log('       so `bash` resolves to Git Bash rather than WSL.');
    console.log('  These suites exercise a real shell; running them against an unusable one produces');
    console.log('  failures that look like product defects but are environment defects.');
    process.exitCode = 1;
    return { totalPass: 0, totalFail: 1, rows: [], preflight: pf };
  }
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
      const failLines = out.split('\n').filter(l => l.includes('FAIL')).slice(0, 8);
      if (failLines.length) {
        console.log(failLines.map(l => '      ' + l).join('\n'));
      } else {
        // A suite that CRASHED has no FAIL lines, so filtering for them printed nothing at all
        // and the stack trace — the only thing that explains the crash — was discarded. This is
        // the case that matters most on a runner you cannot attach to: twice now a CI failure
        // has been "suite exited with status N" with no further detail anywhere.
        const tail = out.split('\n').filter(l => l.trim()).slice(-20);
        console.log('      --- no assertion failures; last output before the exit ---');
        console.log(tail.map(l => '      ' + l).join('\n'));
      }
    }
  }
  console.log('\n' + '═'.repeat(60));
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed across ${suites.length} suites`);
  process.exitCode = totalFail ? 1 : 0;
  return { totalPass, totalFail, rows };
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url))) main();
