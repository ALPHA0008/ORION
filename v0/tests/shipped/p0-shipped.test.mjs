// P0 — SHIPPED CONFIGURATION for the baseline-integrity fixes.
//
// Everything here drives the real `orionctl` binary as a subprocess, because both defects covered
// are properties of the composed product, not of a module:
//
//   T4  the checkpoint shadow repo the CLI composes is unique per workspace. The old name was the
//       first 8 bytes of the path as hex, so any two workspaces under the same 8-character prefix
//       (every temp dir, every C:\Users\...) shared ONE shadow repo — checkpoints and forks of one
//       project could rewind into another.
//   T5  `orionctl <verb> --json 2>&1` is machine-readable. On Node 22 `node:sqlite` prints an
//       ExperimentalWarning to stderr at import; a script that merges the streams (the ordinary
//       `2>&1 | jq` idiom) gets that warning glued to the JSON.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeProvider } from '../_helpers/fake-provider.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'src', 'cli', 'index.mjs');
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `p0s-${tag}-`));

/** Hermetic env: an empty user HOME (no user skills/config), a private ORION_HOME. */
const baseEnv = (home, work, extra = {}) => ({
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  HOME: home, USERPROFILE: home, ORION_HOME: path.join(home, '.orion'), ORION_WORKSPACE: work,
  ...extra,
});

/** Run the bin with stdout and stderr pointed at the SAME file descriptor — a literal `2>&1`. */
function orionctlMerged(args, env, cwd) {
  const outFile = path.join(mk('merged'), 'out.txt');
  const fd = fs.openSync(outFile, 'w');
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, stdio: ['ignore', fd, fd], timeout: 60_000 });
  fs.closeSync(fd);
  return { status: r.status, out: fs.readFileSync(outFile, 'utf8') };
}

// ═══════════════════════════════════════════ T4 — shadow repos via the composed CLI
describe('shipped/P0-T4: `orionctl run` gives each workspace its own shadow repo');
{
  const fp = await startFakeProvider({});
  const home = mk('home');
  const base = path.join(mk('ws'), 'a-deliberately-long-common-prefix-for-both-projects');
  const workspaces = ['proj-a', 'proj-b'].map(n => path.join(base, n));
  const results = [];
  for (const ws of workspaces) {
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'README.md'), `# ${path.basename(ws)}\n`);
    const r = await new Promise((res) => {
      const c = spawn(process.execPath, [CLI, 'run', 'say hi'], {
        cwd: ws, env: baseEnv(home, ws, { ORION_BASE_URL: fp.url, ORION_MODEL: 'test-model' }) });
      let out = '';
      c.stdout.on('data', d => (out += d)); c.stderr.on('data', d => (out += d));
      c.on('exit', (code) => res({ code, out }));
    });
    results.push(r);
  }
  check('both runs went through the real binary and exited 0 (the run outcome itself is not under test)', results.every(r => r.code === 0),
    results.map(r => `${r.code}: ${r.out.slice(-160)}`).join(' | '));
  const shadows = path.join(home, '.orion', 'workspaces');
  const dirs = fs.existsSync(shadows) ? fs.readdirSync(shadows).filter(n => n.endsWith('.git')) : [];
  eq('two workspaces under one long prefix produced two shadow repos', dirs.length, 2);
  check('...each a real bare git repo', dirs.length > 0 && dirs.every(n => fs.existsSync(path.join(shadows, n, 'HEAD'))));
  fp.close?.();
}

// ═══════════════════════════════════════════ T5 — --json survives 2>&1
describe('shipped/P0-T5: `orionctl grants --json 2>&1` is pure JSON');
{
  const home = mk('home'); const work = mk('work');
  const r = orionctlMerged(['grants', '--json'], baseEnv(home, work), work);
  eq('`orionctl grants --json` exits 0', r.status, 0);
  let parsed = null; try { parsed = JSON.parse(r.out); } catch { /* reported below */ }
  check('the merged stdout+stderr parses as JSON', parsed !== null, JSON.stringify(r.out.slice(0, 160)));
  check('...and carries no ExperimentalWarning', !/ExperimentalWarning/.test(r.out),
    JSON.stringify(r.out.slice(0, 160)));
  check('...with the grants shape', Array.isArray(parsed?.active), JSON.stringify(parsed)?.slice(0, 120));
}

// ═══════════════════════════════════════════ T6 — legacy shadow repo notice
// Before the T4 fix a workspace's shadow was `hex(workspace).slice(0,16).git`. Such a store may
// still exist on disk, possibly SHARED between projects. The CLI must never open it again (that
// would re-open the cross-project exposure), but it must tell the user it is there and can be
// deleted — on stderr, and as an attributable `degraded` event in the run's own log.
/** Recursive listing with sizes and content hashes-by-length: any use of the repo changes it. */
function snapshotTree(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) { out.push(`${path.relative(dir, p)}/`); walk(p); }
      else { const s = fs.statSync(p); out.push(`${path.relative(dir, p)}:${s.size}:${s.mtimeMs}`); }
    }
  };
  walk(dir);
  return out.join('\n');
}

async function runCli(ws, home, fpUrl) {
  return new Promise((res) => {
    const c = spawn(process.execPath, [CLI, 'run', 'say hi'], {
      cwd: ws, env: baseEnv(home, ws, { ORION_BASE_URL: fpUrl, ORION_MODEL: 'test-model' }) });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', d => (stdout += d)); c.stderr.on('data', d => (stderr += d));
    c.on('exit', (code) => res({ code, stdout, stderr }));
  });
}

describe('shipped/P0-T6: a legacy shadow repo is reported, never used');
{
  const fp = await startFakeProvider({});
  const home = mk('home');
  const ws = path.join(mk('ws'), 'legacy-proj');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'README.md'), '# legacy\n');
  const shadows = path.join(home, '.orion', 'workspaces');
  fs.mkdirSync(shadows, { recursive: true });
  const legacyName = Buffer.from(ws).toString('hex').slice(0, 16) + '.git';
  const legacy = path.join(shadows, legacyName);
  // A real bare repo, so any use (commit, fetch, gc) would visibly change it.
  const init = spawnSync('git', ['init', '--bare', '-q', legacy], { encoding: 'utf8' });
  eq('the legacy shadow fixture is a real bare repo', init.status, 0);
  fs.writeFileSync(path.join(legacy, 'ORION-SENTINEL'), 'other-project-history\n');
  const before = snapshotTree(legacy);

  const r = await runCli(ws, home, fp.url);
  eq('the run exits 0 (the run outcome itself is not under test)', r.code, 0);

  // (1) not used / not read-into
  eq('the legacy shadow is byte-for-byte untouched', snapshotTree(legacy), before);
  const dirs = fs.readdirSync(shadows).filter(n => n.endsWith('.git'));
  check('...and the run used a NEW, differently-named shadow', dirs.some(n => n !== legacyName),
    JSON.stringify(dirs));

  // (2) visible one-line notice on stderr
  const lines = r.stderr.split(/\r?\n/).filter(l => /legacy checkpoint/i.test(l));
  check('stderr carries a "legacy checkpoint" notice', lines.length >= 1, JSON.stringify(r.stderr.slice(-300)));
  check('...on ONE line that names the store path so the user can delete it',
    lines.some(l => l.includes(legacyName)), JSON.stringify(lines));

  // (3) attributable `degraded` event in the run log (existing type — no new event type)
  const { Store } = await import('../../src/core/run/store.mjs');
  const store = new Store(path.join(home, '.orion', 'orion.db'));
  const runs = store.db.prepare('SELECT id FROM runs').all();
  eq('exactly one run was created', runs.length, 1);
  const deg = runs.length ? store.events(runs[0].id).filter(e => e.type === 'degraded') : [];
  const legacyEv = deg.find(e => /legacy/i.test(JSON.stringify(e.payload ?? {})));
  check('the run log has a `degraded` event about the legacy checkpoint store', !!legacyEv,
    JSON.stringify(deg.map(e => e.payload)));
  check('...with a subsystem and a human reason (projection fields)',
    typeof legacyEv?.payload?.subsystem === 'string' && /legacy checkpoint/i.test(String(legacyEv?.payload?.reason)),
    JSON.stringify(legacyEv?.payload));
  store.close?.();
  fp.close?.();
}

describe('shipped/P0-T6: with no legacy shadow there is no notice (the notice is not unconditional)');
{
  const fp = await startFakeProvider({});
  const home = mk('home');
  const ws = path.join(mk('ws'), 'clean-proj');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'README.md'), '# clean\n');
  const r = await runCli(ws, home, fp.url);
  eq('the run exits 0', r.code, 0);
  check('stderr has no "legacy checkpoint" notice', !/legacy checkpoint/i.test(r.stderr),
    JSON.stringify(r.stderr.slice(-200)));
  fp.close?.();
}

process.exit(summary('shipped/p0') ? 1 : 0);
