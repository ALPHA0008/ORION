// Real-repository environment provisioning.
//
// Contract: every task runs against a FRESH isolated checkout at an exact commit, with
// dependencies installed, and the environment is destroyed afterwards.
//
// The single most important property here is the INFRA_FAILURE boundary. Anything that fails
// for a reason unrelated to the agent — network, registry, missing toolchain, a repo that moved —
// must be reported as INFRA_FAILURE and excluded from the capability score. An agent must never
// be blamed for npm being down.
//
// PERFORMANCE: a bare mirror of each repo is cached once under <root>/_cache and every task
// checkout is made from that cache, so 20 tasks do not mean 20 network clones. node_modules is
// installed once per (repo, commit) into <root>/_deps and hard-copied per task, because npm
// install is 19-51s and doing it per task would dominate the benchmark.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';

export class InfraFailure extends Error {
  constructor(message, stage) { super(message); this.name = 'InfraFailure'; this.stage = stage; }
}

const QUIET = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { ...QUIET, ...opts, timeout: opts.timeout ?? 300_000 });
  } catch (e) {
    const detail = String(e.stderr || e.stdout || e.message).slice(0, 400);
    throw new InfraFailure(`git ${args[0]} failed: ${detail}`, opts.stage ?? 'git');
  }
}

export class RealEnvironment {
  /**
   * @param {object} repo entry from repositories/index.mjs
   * @param {{root?:string, offline?:boolean}} opts
   */
  constructor(repo, { root = path.join(os.tmpdir(), 'harness-real-eval') } = {}) {
    this.repo = repo;
    this.root = root;
    this.cacheDir = path.join(root, '_cache', repo.id + '.git');
    this.depsDir = path.join(root, '_deps', `${repo.id}@${repo.commit.slice(0, 12)}`);
    this.dir = null;
  }

  /** Clone (or update) the bare mirror used as the local source for all checkouts. */
  #ensureMirror() {
    if (fs.existsSync(path.join(this.cacheDir, 'HEAD'))) {
      // Already mirrored. Verify the pinned commit is present; only fetch if it is not.
      try {
        git(['--git-dir', this.cacheDir, 'cat-file', '-e', `${this.repo.commit}^{commit}`]);
        return;
      } catch { /* fall through to fetch */ }
    }
    fs.mkdirSync(path.dirname(this.cacheDir), { recursive: true });
    if (!fs.existsSync(path.join(this.cacheDir, 'HEAD'))) {
      git(['clone', '--bare', '--quiet', this.repo.url, this.cacheDir], { stage: 'clone', timeout: 600_000 });
    } else {
      git(['--git-dir', this.cacheDir, 'fetch', '--quiet', 'origin', '+refs/heads/*:refs/heads/*'],
          { stage: 'fetch', timeout: 600_000 });
    }
    // The pin must exist, or the task is not reproducible and that is OUR bug, not the agent's.
    git(['--git-dir', this.cacheDir, 'cat-file', '-e', `${this.repo.commit}^{commit}`], { stage: 'verify-pin' });
  }

  /** Install dependencies once per (repo, commit) into a shared cache. */
  #ensureDeps() {
    const stamp = path.join(this.depsDir, '.install-ok');
    if (fs.existsSync(stamp)) return;

    fs.rmSync(this.depsDir, { recursive: true, force: true });
    fs.mkdirSync(this.depsDir, { recursive: true });
    this.#checkoutInto(this.depsDir);

    try {
      execSync(this.repo.install, {
        cwd: this.depsDir, ...QUIET, timeout: 900_000,
        env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', CI: '1' },
      });
    } catch (e) {
      const detail = String(e.stderr || e.stdout || e.message).slice(0, 600);
      throw new InfraFailure(`dependency install failed: ${detail}`, 'install');
    }
    if (!fs.existsSync(path.join(this.depsDir, 'node_modules')))
      throw new InfraFailure('install reported success but node_modules is absent', 'install');
    fs.writeFileSync(stamp, new Date().toISOString());
  }

  #checkoutInto(dest) {
    fs.mkdirSync(dest, { recursive: true });
    // A worktree-free checkout: read the pinned tree straight out of the mirror.
    git(['--git-dir', this.cacheDir, '--work-tree', dest, 'checkout', '-f', this.repo.commit, '--', '.'],
        { stage: 'checkout' });
  }

  /**
   * Provision a fresh isolated working directory for ONE task.
   * @returns {string} absolute path to the checkout
   */
  provision(taskId) {
    this.#ensureMirror();
    this.#ensureDeps();

    const dir = path.join(this.root, 'work', `${this.repo.id}-${taskId}-${process.pid}-${counter++}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    this.#checkoutInto(dir);

    // Attach the prepared node_modules WITHOUT copying it.
    //
    // Measured: camelcase's tree is 15,325 files / 124 MB, and cpSync of it took ~200s per
    // provision — two provisions per bracket made a single task take 402s, which would put a
    // 20-task benchmark hours out of reach. A directory link is O(1).
    //
    // The link is safe because dependencies are READ-ONLY for these tasks: the agent is asked to
    // fix repository source, never to mutate node_modules, and each task's own source tree is a
    // genuinely separate checkout. `verifyReal` additionally guards the repo's test files.
    const src = path.join(this.depsDir, 'node_modules');
    const dst = path.join(dir, 'node_modules');
    try {
      // 'junction' works on Windows without elevation and behaves like a dir symlink elsewhere.
      fs.symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      // Fall back to a real copy if linking is unavailable (e.g. restrictive filesystem).
      try {
        fs.cpSync(src, dst, { recursive: true, dereference: false, force: true });
      } catch (e2) {
        throw new InfraFailure(
          `could not stage node_modules (link: ${String(e.message).slice(0, 120)}; copy: ${String(e2.message).slice(0, 120)})`,
          'stage-deps');
      }
    }

    // Disable git's line-ending rewriting: on Windows autocrlf silently corrupts content and
    // has already caused a bug in this project's checkpoint/restore path.
    for (const [k, v] of [['core.autocrlf', 'false'], ['core.safecrlf', 'false'], ['core.fileMode', 'false']]) {
      try { git(['-C', dir, 'config', k, v]); } catch { /* not a repo yet; harmless */ }
    }

    this.dir = dir;
    return dir;
  }

  /** Verify the freshly provisioned checkout can actually run its tests (used by preflight). */
  runTests(dir = this.dir, timeoutMs = 300_000) {
    try {
      const out = execSync(this.repo.test_command, {
        cwd: dir, ...QUIET, timeout: timeoutMs,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      });
      return { ok: true, output: String(out).slice(-4000) };
    } catch (e) {
      if (e.killed || e.signal === 'SIGTERM')
        return { ok: false, timedOut: true, output: 'test command timed out' };
      return { ok: false, output: String(e.stdout || '').slice(-3000) + String(e.stderr || '').slice(-1000) };
    }
  }

  destroy() {
    if (!this.dir) return;
    // CRITICAL: node_modules is a junction/symlink into the SHARED dependency cache. A recursive
    // remove that followed it would delete the cache for every other task. Unlink the link
    // itself first, then remove the checkout.
    const nm = path.join(this.dir, 'node_modules');
    try {
      const st = fs.lstatSync(nm);
      if (st.isSymbolicLink() || st.isDirectory() === false) fs.unlinkSync(nm);
      else if (st.isDirectory() && isJunction(nm)) fs.rmdirSync(nm);
    } catch { /* absent or already gone */ }
    try { fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
    this.dir = null;
  }
}

let counter = 0;

/** A Windows junction reports as a directory to stat() but as a link to lstat(). */
function isJunction(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** Preflight: is the whole real-eval pipeline usable at all right now? */
export function checkInfrastructure() {
  const problems = [];
  try { execFileSync('git', ['--version'], QUIET); } catch { problems.push('git not available'); }
  try { execFileSync('node', ['--version'], QUIET); } catch { problems.push('node not available'); }
  try { execSync('npm ping', { ...QUIET, timeout: 60_000 }); }
  catch { problems.push('npm registry unreachable'); }
  return { ok: problems.length === 0, problems };
}
