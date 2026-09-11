// W8 — git-aware navigation, READ-ONLY.
//
// WHY READ-ONLY, AND WHY THAT IS NOT TIMIDITY
//
// The wave's scope says read-only first, and there is a specific reason beyond caution. The
// workspace already has a git relationship the runtime depends on: `attachCheckpoints` maintains
// a SHADOW repository (`GIT_DIR` pointing at `~/.orion/workspaces/*.git`, `GIT_WORK_TREE` at the
// sandbox root) so a fork can rewind the world to a checkpoint. That shadow is what makes W6's
// recovery contract able to restore a tree.
//
// A `git commit` or `git checkout` tool would operate on the PROJECT's own repository, and the
// two would then be writing to the same working tree with different notions of what HEAD means.
// Getting that wrong does not produce a wrong answer; it produces a destroyed working tree during
// a recovery. So writes wait until there is a design for the interaction, and this wave ships the
// half that cannot damage anything.
//
// EVERY COMMAND RUNS WITH AN EXPLICIT, EMPTY-ISH ENVIRONMENT
//
// The shadow repo is selected by `GIT_DIR`/`GIT_WORK_TREE` environment variables. If those leaked
// into these tools, `git status` would report on the SHADOW rather than on the project — an
// answer that is confidently wrong. They are cleared explicitly below.

import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { scrubEnv, MAX_OUTPUT_BYTES } from './local/index.mjs';

const execFile = promisify(execFileCb);

/** Wall clock for one git invocation. A repository check should be fast or be reported slow. */
export const GIT_TIMEOUT_MS = 10_000;

/** How much git output reaches the model before it is clamped. */
export const GIT_MAX_BYTES = 32 * 1024;

/**
 * The two failures a git tool must handle as ANSWERS rather than crashes.
 *
 * "not a git repository" is a perfectly ordinary state — plenty of workspaces are not repos — and
 * "git is not installed" is an environment fact the operator can act on. Both were the difference
 * between a tool that tells you something and a stack trace.
 */
export const GitUnavailable = Object.freeze({
  NO_GIT: 'git_not_found',
  NOT_A_REPO: 'not_a_git_repo',
});

export class GitError extends Error {
  /** @param {string} message @param {{ kind: string }} info */
  constructor(message, { kind }) {
    super(message);
    this.name = 'GitError';
    this.kind = kind;
  }
}

function clampGit(s, what) {
  const text = String(s ?? '');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= GIT_MAX_BYTES) return text;
  const head = text.slice(0, Math.floor(GIT_MAX_BYTES * 0.8));
  return `${head}\n\n[INCOMPLETE RESULT] ${what} truncated: ${bytes} bytes > ${GIT_MAX_BYTES} limit`
       + ` — narrow the path or use --staged`;
}

/**
 * Run a read-only git command inside the workspace.
 *
 * `cwd` is the sandbox root, so git resolves the PROJECT's repository by its normal upward search.
 * The environment is scrubbed of credentials (as every child process here is) and, critically,
 * of `GIT_DIR`/`GIT_WORK_TREE` — see the header.
 */
async function git(root, args, { timeoutMs = GIT_TIMEOUT_MS } = {}) {
  /** @type {Record<string, string|undefined>} */
  const env = { ...scrubEnv(process.env) };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'])
    delete env[k];
  // Never let git open a pager or prompt for credentials: either would hang the tool call until
  // the timeout, which reads to the model as "the repository is slow" rather than "it is stuck".
  env.GIT_PAGER = 'cat';
  env.GIT_TERMINAL_PROMPT = '0';

  try {
    const { stdout } = await execFile('git', args, {
      cwd: root, encoding: 'utf8', timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES * 4, env,
    });
    return stdout;
  } catch (e) {
    const stderr = String(e?.stderr ?? '');

    // Output larger than the buffer is a BOUND being reached, not a failure. Node rejects with
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER and hands back the stdout it did capture; returning that
    // lets `clampGit` do its job and tell the model the answer is partial.
    //
    // Reporting this as an error was doubly wrong: a big-but-ordinary diff became a hard failure,
    // and the message quoted stderr — which on a core.autocrlf workspace holds git's "LF will be
    // replaced by CRLF" advice. So the tool blamed line endings for what was really a size limit.
    if (e?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && typeof e?.stdout === 'string')
      return e.stdout;

    if (e?.code === 'ENOENT')
      throw new GitError('git is not installed or not on PATH', { kind: GitUnavailable.NO_GIT });
    if (/not a git repository/i.test(stderr))
      throw new GitError('this workspace is not a git repository', { kind: GitUnavailable.NOT_A_REPO });
    if (e?.killed || e?.signal === 'SIGTERM')
      throw new GitError(`git ${args[0]} timed out after ${timeoutMs}ms`, { kind: 'timeout' });
    throw new GitError(`git ${args[0]} failed: ${stderr.trim().slice(0, 300) || String(e?.message ?? e)}`,
      { kind: 'git_failed' });
  }
}

/** Is this workspace a git repository at all? Cheap, and the precondition for everything else. */
export async function isRepo(root) {
  try {
    const out = await git(root, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch { return false; }
}

/**
 * `git status` — what has changed, in porcelain form.
 *
 * Porcelain v1 rather than the human format because it is stable across git versions and is what
 * a consumer should parse; the branch header is requested explicitly so the answer includes
 * "where am I" as well as "what changed".
 *
 * @param {string} root
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function status(root, { timeoutMs } = {}) {
  const out = await git(root, ['status', '--porcelain=v1', '--branch'], { timeoutMs });
  const lines = out.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    const branch = lines[0] ?? '';
    return clampGit(`${branch}\n(working tree clean)`, 'git status');
  }
  return clampGit(lines.join('\n'), 'git status');
}

/**
 * `git diff` — the worktree by default, the index with `staged`.
 *
 * `--no-color` and `--no-ext-diff` so the output is the diff and not a terminal rendering of one,
 * and so a configured external differ cannot execute something unexpected.
 *
 * @param {string} root
 * @param {{ staged?: boolean, path?: string|null, timeoutMs?: number }} [opts]
 */
export async function diff(root, { staged = false, path: p = null, timeoutMs } = {}) {
  const args = ['diff', '--no-color', '--no-ext-diff'];
  if (staged) args.push('--staged');
  if (p) args.push('--', p);
  const out = await git(root, args, { timeoutMs });
  return clampGit(out.trim() || `(no ${staged ? 'staged ' : ''}changes)`, 'git diff');
}

/**
 * `git branch` — local branches, current one marked, most-recent first.
 *
 * @param {string} root
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function branches(root, { timeoutMs } = {}) {
  const out = await git(root,
    ['branch', '--list', '--no-color', '--sort=-committerdate',
     '--format=%(if)%(HEAD)%(then)* %(else)  %(end)%(refname:short)\t%(committerdate:relative)'],
    { timeoutMs });
  return clampGit(out.trim() || '(no branches)', 'git branch');
}

/**
 * Blame-lite: who last touched each line of a file.
 *
 * `--line-porcelain` would be exhaustive and enormous; the short form carries the author and date
 * per line, which is what "who owns this?" actually needs. A path is REQUIRED — blaming a whole
 * tree is not a question anyone asks and would blow every budget in the wave.
 *
 * @param {string} root
 * @param {{ path?: string|null, lines?: string|null, timeoutMs?: number }} [opts]
 */
export async function blame(root, { path: p, lines = null, timeoutMs } = {}) {
  if (!p) throw new GitError('blame needs a file path', { kind: 'bad_args' });
  // NOT `--no-color`: git-blame has no such flag, only `--no-color-lines` and `--no-color-by-age`,
  // so the abbreviation is ambiguous and git rejects the whole invocation. Blame does not colour
  // its output by default anyway; the two explicit flags below keep it that way even if the
  // repository's config turns them on.
  const args = ['blame', '--no-color-lines', '--no-color-by-age', '-w'];
  if (lines) args.push('-L', String(lines));
  args.push('--', p);
  const out = await git(root, args, { timeoutMs });
  return clampGit(out.trim() || '(no blame output)', 'git blame');
}

/**
 * `git log` for a path — the change history a reader needs to understand why code looks like it does.
 *
 * @param {string} root
 * @param {{ path?: string|null, limit?: number, timeoutMs?: number }} [opts]
 */
export async function log(root, { path: p = null, limit = 20, timeoutMs } = {}) {
  const n = Math.max(1, Math.min(200, Number(limit) || 20));
  const args = ['log', '--no-color', `-n${n}`, '--date=short',
                '--format=%h %ad %an — %s'];
  if (p) args.push('--', p);
  const out = await git(root, args, { timeoutMs });
  return clampGit(out.trim() || '(no commits)', 'git log');
}
