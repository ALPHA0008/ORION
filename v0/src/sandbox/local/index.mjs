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

// ── W8 (X6) — LAYERED SEARCH BUDGETS ────────────────────────────────────────
//
// A recursive walk over a repository the agent did not write is unbounded by nature: a
// `node_modules` nobody excluded, a symlink loop, a monorepo with 400k files. An agent that hangs
// is worse than one that returns a truncated answer, because the run's lease expires and the
// crash looks like a product fault. So every level of the walk carries a ceiling, and hitting any
// of them is REPORTED rather than silently absorbed — the same honesty contract `grep` has always
// had for unreadable paths.
//
// The numbers are chosen against the shape of a real repository, not guessed:
//
//   GREP_MAX_HITS 500      unchanged from W1. 500 `path:line:` lines is already more than a
//                          model can use; past that the right move is a narrower pattern.
//   SEARCH_TIME_MS 5_000   the total wall clock for one search. A tool call that takes longer
//                          than this has stopped being a search and started being a scan; the
//                          lease heartbeat (W5 X2) keeps the run alive, but the model is idle.
//   SEARCH_DIR_MS 750      per-directory. One pathological directory (hundreds of thousands of
//                          entries) must not consume the whole budget and starve the rest of
//                          the tree — the failure mode where a search "found nothing" because it
//                          spent all its time in one place.
//   SEARCH_MAX_FILES 20_000  files opened. This is the read ceiling; it bounds I/O even when the
//                          clock says there is time left.
//   SEARCH_MAX_ENTRIES 100_000  directory entries visited. Bounds a walk that is wide rather
//                          than deep, which the file ceiling alone would not catch.
//   GLOB_MAX_RESULTS 1_000 paths returned. Higher than the grep cap because a path is ~20x
//                          smaller than a match line, so the byte cost is comparable.
//   SEARCH_MAX_DEPTH 24    directory depth. A symlink loop that survives the containment check
//                          would otherwise recurse forever; depth is the cheap backstop.
export const SEARCH_TIME_MS = 5_000;
export const SEARCH_DIR_MS = 750;
export const SEARCH_MAX_FILES = 20_000;
export const SEARCH_MAX_ENTRIES = 100_000;
export const GLOB_MAX_RESULTS = 1_000;
export const SEARCH_MAX_DEPTH = 24;

/** Directories never walked: the runtime's own state, VCS internals, and dependency trees. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.orion']);

/**
 * Translate a glob pattern into a RegExp over a POSIX-style relative path.
 *
 * Supports the subset that actually appears in use: `**` (any depth, including none), `*` (any
 * run without a separator), `?` (one non-separator), `[abc]` classes, and `{a,b}` alternation.
 * Everything else is escaped literally — a pattern is a path expression, not a regex, and
 * quietly treating a user's `.` or `+` as a metacharacter is how a glob silently over-matches.
 */
export function globToRegExp(pattern) {
  const p = String(pattern ?? '').replace(/\\/g, '/');
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**/` matches zero or more directories; a bare `**` matches across separators.
        i++;
        if (p[i + 1] === '/') { i++; out += '(?:[^/]*/)*'; }
        else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const close = p.indexOf(']', i + 1);
      if (close < 0) out += '\\[';
      else { out += p.slice(i, close + 1); i = close; }
    } else if (c === '{') {
      const close = p.indexOf('}', i + 1);
      if (close < 0) out += '\\{';
      else {
        out += '(?:' + p.slice(i + 1, close).split(',')
          .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
        i = close;
      }
    } else if (c === '/') {
      // Match EITHER separator. The walk always builds POSIX-style relative paths, so this is
      // not needed internally — but a caller on Windows will reasonably pass a path with
      // backslashes, and a matcher that silently fails to match it is a trap that reads as
      // "the file does not exist". Normalising the pattern alone would not fix that direction.
      out += '[/\\\\]';
    } else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * A budget that every walk shares.
 *
 * Kept as an object rather than closures so the caller can read back WHY a search stopped — the
 * distinction between "found nothing" and "ran out of time before it could look" is exactly the
 * thing a model must not have to guess at.
 */
function makeBudget({ timeMs = SEARCH_TIME_MS, maxFiles = SEARCH_MAX_FILES,
                      maxEntries = SEARCH_MAX_ENTRIES, maxDepth = SEARCH_MAX_DEPTH } = {}) {
  return {
    startedAt: Date.now(), timeMs, maxFiles, maxEntries, maxDepth,
    files: 0, entries: 0,
    stopped: null,          // 'time' | 'files' | 'entries' | 'depth' | 'hits'
    dirTimeouts: [],        // directories abandoned on the per-directory clock
    outOfTime() { return Date.now() - this.startedAt >= this.timeMs; },
  };
}

/** Human-readable budget notes, appended to the [INCOMPLETE RESULT] block. */
function budgetNotes(b) {
  const n = [];
  if (b.stopped === 'time')
    n.push(`search STOPPED after ${b.timeMs}ms — narrow the path or pattern`);
  if (b.stopped === 'files')
    n.push(`search STOPPED after reading ${b.maxFiles} files`);
  if (b.stopped === 'entries')
    n.push(`search STOPPED after visiting ${b.maxEntries} directory entries`);
  if (b.stopped === 'depth')
    n.push(`search STOPPED at depth ${b.maxDepth}`);
  if (b.dirTimeouts.length)
    n.push(`${b.dirTimeouts.length} director(y/ies) abandoned after ${SEARCH_DIR_MS}ms: ` +
      `${b.dirTimeouts.slice(0, 3).join(', ')}${b.dirTimeouts.length > 3 ? ', …' : ''}`);
  return n;
}

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
  /**
   * @param {string} pattern
   * @param {string} [start]
   * @param {{ regex?: boolean, ignoreCase?: boolean, maxHits?: number, timeMs?: number,
   *           glob?: string }} [opts]
   */
  grep(pattern, start = '.', opts = {}) {
    const {
      // W8: REGEX, opt-in and BACKWARD COMPATIBLE. The default stays literal, so every existing
      // caller — and every model that learned the old call shape — behaves exactly as before.
      // Opting in rather than auto-detecting is deliberate: a literal search for `a.b` must not
      // silently become a regex that also matches `axb`, which is precisely the kind of quiet
      // over-match that makes a search untrustworthy.
      regex = false,
      ignoreCase = false,
      maxHits = GREP_MAX_HITS,
      timeMs = SEARCH_TIME_MS,
      glob = null,               // restrict to paths matching a glob, e.g. '**/*.mjs'
    } = opts;

    let re = null;
    if (regex) {
      try { re = new RegExp(pattern, ignoreCase ? 'i' : ''); }
      catch (e) {
        // A malformed regex is a CALLER error and must say so. Returning "(no matches)" would be
        // indistinguishable from a correct search that found nothing — the worst possible
        // failure for a tool an agent uses to decide what exists.
        throw new SandboxError(`invalid regular expression: ${String(e.message ?? e)}`,
          { kind: 'bad_pattern' });
      }
    }
    const needle = ignoreCase && !regex ? String(pattern).toLowerCase() : String(pattern);
    const globRe = glob ? globToRegExp(glob) : null;
    const matches = (line) => re
      ? re.test(line)
      : (ignoreCase ? line.toLowerCase() : line).includes(needle);

    const hits = [];
    const skipped = { dirs: [], files: [] };
    const budget = makeBudget({ timeMs });
    let truncated = false;

    // Scanning one file, factored out so `walk` and the file-path entry below share it.
    const scanFile = (rel) => {
      if (globRe && !globRe.test(rel)) return;
      if (budget.files >= budget.maxFiles) { budget.stopped ??= 'files'; return; }
      budget.files++;
      let text;
      // Files are read as UTF-8. A binary file is therefore scanned as lossy-decoded text rather
      // than detected and skipped: it will not crash, but matches in it are not meaningful.
      try { text = fs.readFileSync(this._abs(rel), 'utf8'); }
      catch (e) { skipped.files.push(`${rel} (${e.code ?? 'error'})`); return; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!matches(lines[i])) continue;
        hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (hits.length >= maxHits) { truncated = true; return; }
      }
    };

    const walk = (rel, depth = 0) => {
      if (truncated || budget.stopped) return;
      if (depth > budget.maxDepth) { budget.stopped ??= 'depth'; return; }
      if (budget.outOfTime()) { budget.stopped ??= 'time'; return; }
      let entries;
      try { entries = fs.readdirSync(this._abs(rel), { withFileTypes: true }); }
      catch (e) { skipped.dirs.push(`${rel} (${e.code ?? 'error'})`); return; }
      // Per-directory clock: one pathological directory must not starve the rest of the tree.
      const dirStart = Date.now();
      for (const ent of entries) {
        if (truncated || budget.stopped) return;
        if (Date.now() - dirStart >= SEARCH_DIR_MS) { budget.dirTimeouts.push(rel); return; }
        if (budget.entries++ >= budget.maxEntries) { budget.stopped ??= 'entries'; return; }
        // Name-based, like the existing .git / node_modules exclusions, so it applies at any
        // depth. `.orion` is the runtime's OWN state — event-log database and workspace shadow
        // repos — and searching it fed the agent its own trajectory as if it were source.
        if (SKIP_DIRS.has(ent.name)) continue;
        const child = rel === '.' ? ent.name : `${rel}/${ent.name}`;
        if (ent.isDirectory()) { walk(child, depth + 1); continue; }
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
      notes.push(`results TRUNCATED at ${maxHits} matches — narrow the pattern or path`);
    if (skipped.files.length)
      notes.push(`${skipped.files.length} file(s) unreadable and SKIPPED: ` +
        `${skipped.files.slice(0, 5).join(', ')}${skipped.files.length > 5 ? ', …' : ''}`);
    if (skipped.dirs.length)
      notes.push(`${skipped.dirs.length} director(y/ies) unreadable and SKIPPED: ` +
        `${skipped.dirs.slice(0, 5).join(', ')}${skipped.dirs.length > 5 ? ', …' : ''}`);
    notes.push(...budgetNotes(budget));

    const body = hits.length ? hits.join('\n') : '(no matches)';
    const suffix = notes.length ? `\n\n[INCOMPLETE RESULT] ${notes.join('; ')}` : '';
    // Clamp the BODY, then append the notice, so truncation can never eat the warning.
    return clamp(body, 'grep') + suffix;
  }

  /**
   * W8 — find files by glob. The other half of "see a repository you did not write".
   *
   * Shares grep's budgets and its honesty contract verbatim: a capped or abandoned walk says so
   * in the same `[INCOMPLETE RESULT]` block, because a truncated file listing that looks complete
   * is how an agent concludes a symbol does not exist.
   *
   * @param {string} pattern
   * @param {{ path?: string, maxResults?: number, timeMs?: number, filesOnly?: boolean }} [opts]
   */
  glob(pattern, { path: start = '.', maxResults = GLOB_MAX_RESULTS,
                  timeMs = SEARCH_TIME_MS, filesOnly = true } = {}) {
    if (typeof pattern !== 'string' || !pattern.trim())
      throw new SandboxError('glob needs a pattern, e.g. "**/*.mjs"', { kind: 'bad_pattern' });

    let re;
    try { re = globToRegExp(pattern); }
    catch (e) {
      throw new SandboxError(`invalid glob pattern: ${String(e.message ?? e)}`, { kind: 'bad_pattern' });
    }

    const found = [];
    const skipped = { dirs: [] };
    const budget = makeBudget({ timeMs });
    let truncated = false;

    // Patterns are matched against the path RELATIVE TO THE SEARCH ROOT, so `**/*.mjs` behaves
    // the same whether the caller searched `.` or `src` — the alternative (matching the
    // workspace-relative path) makes a scoped search silently miss everything.
    const base = start === '.' ? '' : `${String(start).replace(/\\/g, '/').replace(/\/+$/, '')}/`;

    const walk = (rel, depth = 0) => {
      if (truncated || budget.stopped) return;
      if (depth > budget.maxDepth) { budget.stopped ??= 'depth'; return; }
      if (budget.outOfTime()) { budget.stopped ??= 'time'; return; }
      let entries;
      try { entries = fs.readdirSync(this._abs(rel), { withFileTypes: true }); }
      catch (e) { skipped.dirs.push(`${rel} (${e.code ?? 'error'})`); return; }
      const dirStart = Date.now();
      for (const ent of entries) {
        if (truncated || budget.stopped) return;
        if (Date.now() - dirStart >= SEARCH_DIR_MS) { budget.dirTimeouts.push(rel); return; }
        if (budget.entries++ >= budget.maxEntries) { budget.stopped ??= 'entries'; return; }
        if (SKIP_DIRS.has(ent.name)) continue;
        const child = rel === '.' ? ent.name : `${rel}/${ent.name}`;
        const relToBase = base && child.startsWith(base) ? child.slice(base.length) : child;
        const isDir = ent.isDirectory();
        if ((!filesOnly || !isDir) && re.test(relToBase)) {
          found.push(isDir ? `${child}/` : child);
          if (found.length >= maxResults) { truncated = true; return; }
        }
        if (isDir) walk(child, depth + 1);
      }
    };
    walk(start);

    const notes = [];
    if (truncated)
      notes.push(`results TRUNCATED at ${maxResults} paths — narrow the pattern or path`);
    if (skipped.dirs.length)
      notes.push(`${skipped.dirs.length} director(y/ies) unreadable and SKIPPED: ` +
        `${skipped.dirs.slice(0, 5).join(', ')}${skipped.dirs.length > 5 ? ', …' : ''}`);
    notes.push(...budgetNotes(budget));

    const body = found.length ? found.sort().join('\n') : '(no matches)';
    const suffix = notes.length ? `\n\n[INCOMPLETE RESULT] ${notes.join('; ')}` : '';
    return clamp(body, 'glob') + suffix;
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
/**
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, string|undefined>}
 */
export function scrubEnv(env) {
  /** @type {Record<string, string|undefined>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!SECRET_RE.test(k)) out[k] = v;
  return out;
}
