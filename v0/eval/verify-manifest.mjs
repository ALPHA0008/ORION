// Manifest self-check: every referenced file must exist, every seed must match EXACTLY once,
// and every seeded file must actually FAIL its verify command before the run (otherwise the task
// is a no-op that would score as a free pass).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2] ?? 'd:/Abhijith P/Desktop/harness');
const REPOS = path.join(ROOT, 'research', 'repos');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'v0/eval/tasks/E4-TASKS.json'), 'utf8'));

let bad = 0;
for (const t of manifest.tasks) {
  const repoDir = path.join(REPOS, t.workspaceDir);
  const problems = [];

  if (!fs.existsSync(repoDir)) problems.push('repo dir missing');

  if (t.expectRead) {
    if (!fs.existsSync(path.join(repoDir, t.expectRead))) problems.push(`expectRead missing: ${t.expectRead}`);
  }

  if (t.seed) {
    const f = path.join(repoDir, t.seed.file);
    if (!fs.existsSync(f)) problems.push(`seed file missing: ${t.seed.file}`);
    else {
      const src = fs.readFileSync(f, 'utf8');
      const n = src.split(t.seed.find).length - 1;
      if (n !== 1) problems.push(`seed.find matches ${n}x (need exactly 1): ${t.seed.find}`);
    }
  }

  // The strongest check: a seeded task's verify must FAIL on the seeded copy. If it passes, the
  // model would be scored correct for doing nothing.
  if (t.seed && t.verify && !problems.length) {
    const tmp = fs.mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'e4check-'));
    try {
      const rel = t.seed.file;
      fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
      const src = fs.readFileSync(path.join(repoDir, rel), 'utf8');
      fs.writeFileSync(path.join(tmp, rel), src.replace(t.seed.find, t.seed.replace));
      let seededFails = false;
      try { execFileSync(process.execPath, ['-e', `process.exit(0)`], { cwd: tmp }); } catch { /* noop */ }
      try {
        execFileSync('bash', ['-lc', t.verify], { cwd: tmp, stdio: 'pipe', timeout: 60_000 });
      } catch { seededFails = true; }
      if (!seededFails) problems.push('verify PASSES on the seeded copy — the task is a no-op');

      // And it must PASS on the pristine copy, or the task is unwinnable.
      fs.writeFileSync(path.join(tmp, rel), src);
      try {
        execFileSync('bash', ['-lc', t.verify], { cwd: tmp, stdio: 'pipe', timeout: 60_000 });
      } catch (e) {
        problems.push(`verify FAILS on the pristine copy — unwinnable: ${String(e.stderr ?? e).slice(0, 120)}`);
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  if (problems.length) { bad++; console.log(`FAIL ${t.id}`); for (const p of problems) console.log(`      ${p}`); }
  else console.log(`ok   ${t.id}  (${t.type})`);
}
console.log(`\n${manifest.tasks.length - bad}/${manifest.tasks.length} tasks valid`);
process.exit(bad ? 1 : 0);
