// Local sandbox. NOT a security boundary against hostile code — it is a workspace scope.
// Phase M: it does enforce path containment (incl. symlink escape) and a bounded output size.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const MAX_OUTPUT_BYTES = 64 * 1024;   // tool output bounded AT SOURCE (ADR-001 corollary)
export const MAX_ERROR_BYTES = 2 * 1024;     // error text must be FAR smaller than output
export const GREP_MAX_HITS = 500;

export class LocalSandbox {
  constructor(root, { execTimeoutMs = 15_000, shell = null } = {}) {
    // NB: fs.mkdirSync(recursive) returns the FIRST directory created (or undefined),
    // not the target path — realpath the target itself.
    fs.mkdirSync(root, { recursive: true });
    this.root = fs.realpathSync(root);
    this.execTimeoutMs = execTimeoutMs;
    this.shell = shell ?? (process.platform === 'win32' ? 'bash' : 'sh');
  }

  /** Resolve inside the sandbox, rejecting traversal and symlink escapes. */
  _abs(p) {
    if (typeof p !== 'string' || p.length === 0) throw new Error('path must be a non-empty string');
    if (p.includes('\0')) throw new Error('path contains a null byte');
    const abs = path.resolve(this.root, p);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path escapes sandbox: ${p}`);
    // symlink escape: check the deepest existing ancestor's real path
    let probe = abs;
    while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
    const realProbe = fs.realpathSync(probe);
    const realRel = path.relative(this.root, realProbe);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error(`path escapes sandbox via symlink: ${p}`);
    return abs;
  }

  read(p) {
    const buf = fs.readFileSync(this._abs(p));
    return clamp(buf.toString('utf8'), `file ${p}`);
  }
  write(p, content) {
    if (typeof content !== 'string') throw new Error('content must be a string');
    const a = this._abs(p);
    fs.mkdirSync(path.dirname(a), { recursive: true });
    fs.writeFileSync(a, content);
    return a;
  }
  exists(p) { try { fs.accessSync(this._abs(p)); return true; } catch { return false; } }
  list(p = '.') { return fs.readdirSync(this._abs(p)); }

  /**
   * Search for a literal string. NEVER silently incomplete: unreadable paths and hit
   * truncation are counted and reported in the result. An agent that reads "(no matches)"
   * when half the tree was unreadable will confidently conclude the wrong thing.
   */
  grep(pattern, start = '.') {
    const hits = [];
    const skipped = { dirs: [], files: [] };
    let truncated = false;

    // Scanning one file, factored out so `walk` and the file-path entry below share it.
    const scanFile = (rel) => {
      let text;
      // Files are read as UTF-8. A binary file is therefore scanned as lossy-decoded text rather
      // than detected and skipped: it will not crash, but matches in it are not meaningful.
      try { text = fs.readFileSync(this._abs(rel), 'utf8'); }
      catch (e) { skipped.files.push(`${rel} (${e.code ?? 'error'})`); return; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes(pattern)) continue;
        hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (hits.length >= GREP_MAX_HITS) { truncated = true; return; }
      }
    };

    const walk = (rel) => {
      if (truncated) return;
      let entries;
      try { entries = fs.readdirSync(this._abs(rel), { withFileTypes: true }); }
      catch (e) { skipped.dirs.push(`${rel} (${e.code ?? 'error'})`); return; }
      for (const ent of entries) {
        if (truncated) return;
        // Name-based, like the existing .git / node_modules exclusions, so it applies at any
        // depth. `.orion` is the runtime's OWN state — event-log database and workspace shadow
        // repos — and searching it fed the agent its own trajectory as if it were source.
        if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === '.orion') continue;
        const child = rel === '.' ? ent.name : `${rel}/${ent.name}`;
        if (ent.isDirectory()) { walk(child); continue; }
        scanFile(child);
      }
    };

    // A FILE path must be searched directly. Previously every start went through walk(), so
    // readdirSync() threw ENOTDIR on a file and it was reported as an unreadable *directory* —
    // "(no matches)" for a file that plainly contained the pattern.
    let startIsDir = true;
    try { startIsDir = fs.statSync(this._abs(start)).isDirectory(); }
    catch { /* leave it to walk(), which records the error in skipped.dirs as before */ }
    if (startIsDir) walk(start);
    else scanFile(start);

    const notes = [];
    if (truncated)
      notes.push(`results TRUNCATED at ${GREP_MAX_HITS} matches — narrow the pattern or path`);
    if (skipped.files.length)
      notes.push(`${skipped.files.length} file(s) unreadable and SKIPPED: ` +
        `${skipped.files.slice(0, 5).join(', ')}${skipped.files.length > 5 ? ', …' : ''}`);
    if (skipped.dirs.length)
      notes.push(`${skipped.dirs.length} director(y/ies) unreadable and SKIPPED: ` +
        `${skipped.dirs.slice(0, 5).join(', ')}${skipped.dirs.length > 5 ? ', …' : ''}`);

    const body = hits.length ? hits.join('\n') : '(no matches)';
    const suffix = notes.length ? `\n\n[INCOMPLETE RESULT] ${notes.join('; ')}` : '';
    // Clamp the BODY, then append the notice, so truncation can never eat the warning.
    return clamp(body, 'grep') + suffix;
  }

  exec(cmd) {
    if (typeof cmd !== 'string') throw new Error('cmd must be a string');
    let out;
    try {
      out = execFileSync(this.shell, ['-lc', cmd], {
        cwd: this.root, encoding: 'utf8', timeout: this.execTimeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES * 4, stdio: ['ignore', 'pipe', 'pipe'],
        // Phase M: do not forward the parent's secrets into tool execution.
        env: scrubEnv(process.env),
      });
    } catch (err) {
      // Distinguish the failure modes an operator actually needs to tell apart.
      if (err.code === 'ENOBUFS' || /maxBuffer/i.test(err.message ?? '')) {
        const e = new Error(`command produced more than ${MAX_OUTPUT_BYTES * 4} bytes and was aborted — ` +
          `redirect output to a file and read it in slices`);
        e.exitCode = null; e.kind = 'output_overflow'; throw e;
      }
      if (err.signal === 'SIGTERM' || err.killed) {
        const e = new Error(`command timed out after ${this.execTimeoutMs}ms and was killed`);
        e.exitCode = null; e.kind = 'timeout'; throw e;
      }
      // The SHELL ITSELF is missing — not the command. Without this branch the failure fell
      // through to the generic handler and surfaced as "command failed (exit ?):" with an empty
      // detail, because a spawn failure has no exit status and no stderr. On Windows, where the
      // shell is `bash` resolved through PATH, that is the difference between a user knowing they
      // need Git Bash and staring at a blank error.
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        const hint = process.platform === 'win32'
          ? ' — install Git for Windows (Git Bash) or set the `shell` option to an available shell'
          : ' — set the `shell` option to an available shell';
        const e = new Error(`shell not found: ${this.shell} (${err.code})${hint}`);
        e.exitCode = null; e.kind = 'shell_missing'; throw e;
      }
      const stderr = (err.stderr || '').toString();
      const stdout = (err.stdout || '').toString();
      const detail = shorten(stderr || stdout, MAX_ERROR_BYTES);
      const e = new Error(`command failed (exit ${err.status ?? err.signal ?? '?'}): ${detail}`);
      e.exitCode = err.status ?? null; e.kind = 'nonzero_exit';
      throw e;
    }
    return clamp(out, 'stdout');
  }
}

// ── Workspace checkpoints (git shadow repo) ─────────────────────────────────
// Finding (Phase J): forking a RUN forks the event log, not the world. To fork
// coherently the workspace must also be rewound to the fork point. A bare shadow
// git repo gives diffing, history and restore for free without touching the user's
// own .git (idea borrowed from Hermes; see LESSONS.md L-03).
export function attachCheckpoints(sandbox, shadowDir) {
  fs.mkdirSync(shadowDir, { recursive: true });
  const git = (args) => execFileSync('git', args, {
    cwd: sandbox.root, encoding: 'utf8',
    env: { ...scrubEnv(process.env), GIT_DIR: shadowDir, GIT_WORK_TREE: sandbox.root,
           GIT_AUTHOR_NAME: 'orion', GIT_AUTHOR_EMAIL: 'orion@local',
           GIT_COMMITTER_NAME: 'orion', GIT_COMMITTER_EMAIL: 'orion@local' } });
  // init must NOT see GIT_WORK_TREE, so run it with a clean env
  if (!fs.existsSync(path.join(shadowDir, 'HEAD'))) {
    execFileSync('git', ['init', '--bare', '-q', shadowDir], { env: scrubEnv(process.env) });
    // Never rewrite bytes: a checkpoint must restore the file exactly as written.
    for (const [k, v] of [['core.autocrlf', 'false'], ['core.safecrlf', 'false'], ['core.fileMode', 'false']])
      execFileSync('git', ['--git-dir', shadowDir, 'config', k, v], { env: scrubEnv(process.env) });
  }

  sandbox.snapshot = (label = 'checkpoint') => {
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', label]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  /**
   * Restore the workspace to a checkpoint.
   * Two cases git does not handle with a single command:
   *  - restoring to an EMPTY commit: `checkout -- .` fails with "pathspec '.' did not match",
   *    because there are no tracked paths at that ref. Found restoring a fork to a point
   *    before any file existed.
   *  - files created AFTER the checkpoint are not removed by `checkout`, so the restored tree
   *    would be a superset of the checkpoint. `read-tree` + `checkout-index` gives exact state.
   */
  sandbox.restore = (ref) => {
    const files = git(['ls-tree', '-r', '--name-only', ref]).trim();
    // wipe anything tracked-or-untracked that is not in the target tree, then materialise it
    git(['read-tree', ref]);
    try { git(['checkout-index', '-a', '-f']); } catch { /* empty tree: nothing to materialise */ }
    // remove files present in the working tree but absent from the target commit
    const keep = new Set(files ? files.split(String.fromCharCode(10)).filter(Boolean) : []);
    const walk = (rel) => {
      let ents; try { ents = fs.readdirSync(path.join(sandbox.root, rel), { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { walk(child); continue; }
        if (!keep.has(child)) { try { fs.rmSync(path.join(sandbox.root, child), { force: true }); } catch {} }
      }
    };
    walk('');
    return ref;
  };
  sandbox.checkpoints = () => git(['log', '--format=%H %s']).trim().split(String.fromCharCode(10)).filter(Boolean);
  return sandbox;
}

/** Tight clamp for error text: head + tail, never the whole stream. */
function shorten(s, max) {
  const t = String(s ?? '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.floor(max * 0.7))}
…[${t.length - max} more chars omitted]…
${t.slice(-Math.floor(max * 0.2))}`;
}

function clamp(s, what) {
  const b = Buffer.byteLength(s, 'utf8');
  if (b <= MAX_OUTPUT_BYTES) return s;
  const head = s.slice(0, Math.floor(MAX_OUTPUT_BYTES * 0.6));
  const tail = s.slice(-Math.floor(MAX_OUTPUT_BYTES * 0.2));
  return `${head}\n…[${what} truncated: ${b} bytes > ${MAX_OUTPUT_BYTES} limit]…\n${tail}`;
}

/** Drop anything that looks like a credential before handing the env to a child process. */
const SECRET_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|SESSION|COOKIE|AUTH)/i;
export function scrubEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!SECRET_RE.test(k)) out[k] = v;
  return out;
}
