// Local sandbox. NOT a security boundary against hostile code — it is a workspace scope.
// Phase M: it does enforce path containment (incl. symlink escape) and a bounded output size.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// W6 A: the contract this class is backend #1 of.
import { describeCapabilities, Isolation } from '../backend.mjs';

export const MAX_OUTPUT_BYTES = 64 * 1024;   // tool output bounded AT SOURCE (ADR-001 corollary)
export const MAX_ERROR_BYTES = 2 * 1024;     // error text must be FAR smaller than output
export const GREP_MAX_HITS = 500;

/**
 * The sandbox's error taxonomy, as a type rather than four ad-hoc augmentations of `Error`.
 *
 * W5 Q1: `#execError` built plain Errors and then attached `exitCode` and `kind` to each. That
 * works at runtime but the taxonomy — which recovery classification depends on — was invisible
 * to any checker, so a typo'd `kind` or a forgotten `exitCode` would have gone unnoticed. The
 * kinds are the contract: `output_overflow`, `timeout`, `shell_missing`, `nonzero_exit`.
 */
export class SandboxError extends Error {
  /** @param {string} message @param {{ kind: string, exitCode?: number|null }} info */
  constructor(message, { kind, exitCode = null }) {
    super(message);
    this.name = 'SandboxError';
    this.kind = kind;
    this.exitCode = exitCode;
  }
}

export class LocalSandbox {
  /**
   * W6 A — backend #1, and its capability declaration.
   *
   * `isolation: 'none'` is the honest value and it is load-bearing. This class enforces path
   * containment, including symlink escape, and bounds output — that is a WORKSPACE SCOPE, not OS
   * isolation (plan §13: "path containment is not OS isolation"). A command it runs is a command
   * running as this user, on this machine, with this network.
   *
   * W6-G derives posture from this field, so calling it anything stronger would not be a
   * documentation slip — it would silently auto-allow arbitrary commands on the host. The
   * temptation is real, because `none` is exactly what makes this backend escalate; that
   * escalation is the correct behaviour, and the container backend is how you get out of it.
   */
  capabilities = describeCapabilities({
    isolation: Isolation.NONE,
    network: 'host',        // no egress control whatsoever; the process inherits this machine's
    sharedWorkspace: true,  // trivially — the workspace IS a host directory
    runtime: null,
  });

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

  /**
   * Run a shell command in the workspace (W5 / X1 — now ASYNC).
   *
   * This was `execFileSync`, which blocked the event loop for the whole command. Two consequences
   * the plan calls the weakest decision in the tree: the runtime was capped at one run per
   * process, and — worse — the D1 lease heartbeat is a `setInterval`, which cannot fire while the
   * loop is blocked. A tool call longer than the lease therefore lost the lease, which is exactly
   * the failure D1 was built to prevent, reintroduced on the tool path (X2).
   *
   * The change is MECHANICAL, not a redesign. Same shell, same cwd, same scrubbed env, same
   * timeout, same output bounds, and the SAME ERROR TAXONOMY — output_overflow, timeout,
   * shell_missing, nonzero_exit — because recovery classification and every existing test depend
   * on those `kind` values. `exec` remains the boundary; nothing else gained the ability to spawn.
   *
   * Callers await it. `execSync` below is kept for the few genuinely synchronous internal uses
   * (checkpoints), which are not on the agent's tool path.
   */
  /**
   * @param {string} cmd
   * @param {{ onOutput?: ((d: {kind: string, text: string, bytes: number}) => void)|null }} [opts]
   */
  async exec(cmd, { onOutput = null } = {}) {
    if (typeof cmd !== 'string') throw new Error('cmd must be a string');

    // W6 L: `spawn`, not `execFile`.
    //
    // `execFile` buffers to completion, so nothing about a running command was observable until
    // it ended — a 90-second `npm test` was a blank pause. Streaming needs the chunks as they
    // arrive, which means owning the accumulation, the byte cap and the timeout that `execFile`
    // was providing. Each is reimplemented below and mapped onto the SAME error taxonomy via
    // `#execError`, because recovery classification keys off `kind` and the crash matrix depends
    // on those decisions not moving (W5 X1, W6 Q4).
    //
    // `onOutput` is optional and off by default: with no sink this behaves exactly as before,
    // which is what keeps every existing caller and the whole suite unaffected.
    const { spawn } = await import('node:child_process');
    const HARD_CAP = MAX_OUTPUT_BYTES * 4;   // the cap `execFile`'s maxBuffer used to enforce

    return new Promise((resolve, reject) => {
      const child = spawn(this.shell, ['-lc', cmd], {
        cwd: this.root, env: scrubEnv(process.env),
        stdio: ['ignore', 'pipe', 'pipe'],   // stdin closed: see below
      });

      let out = '', err = '', bytes = 0;
      let overflow = false, timedOut = false, settled = false;
      let spawnErr = null;

      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }, this.execTimeoutMs);

      const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };

      const onChunk = (kind) => (buf) => {
        const text = buf.toString('utf8');
        bytes += Buffer.byteLength(text, 'utf8');
        if (kind === 'stdout') out += text; else err += text;
        // The cap is enforced on the ACCUMULATION, so a runaway command is stopped rather than
        // buffered forever — the same guarantee `maxBuffer` gave, applied by us.
        if (bytes > HARD_CAP && !overflow) {
          overflow = true;
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
          return;
        }
        if (onOutput) {
          try { onOutput({ kind, text, bytes }); }
          catch { /* a broken observer must never fail the command it is watching */ }
        }
      };
      child.stdout?.on('data', onChunk('stdout'));
      child.stderr?.on('data', onChunk('stderr'));

      // A spawn failure (missing shell) arrives as 'error', not as an exit code.
      child.on('error', (e) => { spawnErr = e; });

      const settle = (code, signal) => finish(() => {
        if (overflow)
          return reject(this.#execError(
            Object.assign(new Error('maxBuffer exceeded'), { code: 'ENOBUFS' }), out, err));
        if (spawnErr) return reject(this.#execError(spawnErr, out, err));
        if (timedOut)
          return reject(this.#execError(
            Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), out, err));
        if (code === 0) return resolve(clamp(out, 'stdout'));
        return reject(this.#execError(
          Object.assign(new Error(`exit ${code ?? signal}`),
            { code: typeof code === 'number' ? code : undefined, signal }), out, err));
      });

      // `close` is the preferred settling point: it fires once every stdio stream has drained,
      // so no trailing output is lost on the normal path.
      child.on('close', settle);

      // `exit` is the settling point when WE killed it — and it has to be, because `close` can
      // hang far past the kill. `bash -lc 'sleep 30'` given SIGTERM terminates the shell, but the
      // orphaned `sleep` inherits the pipes and keeps them open, so `close` waits for the full 30
      // seconds. Measured: a 15s timeout took 30.5s to report, which is the timeout not working.
      //
      // On a kill we do not care about draining an orphan's output, so settle on process exit and
      // tear the pipes down. Only on this path — an ordinary command still waits for `close`.
      child.on('exit', (code, signal) => {
        if (!timedOut && !overflow) return;
        try { child.stdout?.destroy(); child.stderr?.destroy(); } catch { /* already gone */ }
        settle(code, signal);
      });
    });
  }

  /**
   * Translate a child_process failure into this sandbox's error taxonomy.
   *
   * Extracted so the async and sync paths cannot drift: a divergence here would silently change
   * recovery classification, which is the one thing the crash matrix depends on.
   */
  #execError(err, stdout, stderr) {
    if (err.code === 'ENOBUFS' || /maxBuffer/i.test(err.message ?? '')) {
      return new SandboxError(
        `command produced more than ${MAX_OUTPUT_BYTES * 4} bytes and was aborted — ` +
        `redirect output to a file and read it in slices`, { kind: 'output_overflow' });
    }
    if (err.signal === 'SIGTERM' || err.killed) {
      return new SandboxError(
        `command timed out after ${this.execTimeoutMs}ms and was killed`, { kind: 'timeout' });
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
      return new SandboxError(
        `shell not found: ${this.shell} (${err.code})${hint}`, { kind: 'shell_missing' });
    }
    const detail = shorten(String(stderr ?? err.stderr ?? '') || String(stdout ?? err.stdout ?? ''), MAX_ERROR_BYTES);
    return new SandboxError(
      `command failed (exit ${err.status ?? err.code ?? err.signal ?? '?'}): ${detail}`,
      { kind: 'nonzero_exit',
        exitCode: typeof err.code === 'number' ? err.code : (err.status ?? null) });
  }

  /**
   * Synchronous exec, retained for internal callers that are NOT on the agent's tool path
   * (workspace checkpoints shell to git). Kept deliberately un-exported to the tools so the
   * blocking behaviour cannot creep back into a run.
   */
  execSync(cmd) {
    if (typeof cmd !== 'string') throw new Error('cmd must be a string');
    try {
      return clamp(execFileSync(this.shell, ['-lc', cmd], {
        cwd: this.root, encoding: 'utf8', timeout: this.execTimeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES * 4, stdio: ['ignore', 'pipe', 'pipe'],
        env: scrubEnv(process.env),
      }), 'stdout');
    } catch (err) {
      throw this.#execError(err, err.stdout, err.stderr);
    }
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
