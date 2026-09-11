// W8 — git-aware navigation, read-only.
//
// These tests build REAL repositories in a temp dir and run REAL git against them. Mocking
// execFile here would test my mock rather than the thing that actually breaks: argument shape,
// environment inheritance, and how git reports its two ordinary failures.
//
// If `git` is not on PATH, the suite proves the honest-failure path and skips the live half —
// stated out loud rather than silently passing a hollow run.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isRepo, status, diff, branches, blame, log, GitError, GitUnavailable,
         GIT_TIMEOUT_MS, GIT_MAX_BYTES } from '../../src/sandbox/git.mjs';
import { makeTools, toolDefinitions, mutatingTools } from '../../src/agent/tools/index.mjs';
import { RecoveryClass } from '../../src/core/recovery/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let GIT_OK = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { GIT_OK = false; }

const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w8g-${tag}-`));
const run = (cwd, ...args) => execFileSync('git', args, {
  cwd, stdio: 'pipe', encoding: 'utf8',
  env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined,
         GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T',
         GIT_COMMITTER_EMAIL: 't@e' },
});

/** A repo with one commit and one dirty file. */
function repo() {
  const d = mk('repo');
  run(d, 'init', '-q', '-b', 'main');
  run(d, 'config', 'user.email', 't@e'); run(d, 'config', 'user.name', 'T');
  run(d, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(d, 'a.txt'), 'first line\nsecond line\n');
  run(d, 'add', 'a.txt'); run(d, 'commit', '-q', '-m', 'initial commit');
  return d;
}

// ═══════════════════════════════════════════ honest failure
describe('w8/git: the two ordinary failures are ANSWERS, not stack traces');
{
  // A workspace that is not a repo is a completely normal state. Before this, asking about it
  // produced a raw exception; the value here is that the model gets a sentence it can act on.
  const plain = mk('plain');
  eq('a non-repo is reported as not-a-repo, not crashed', await isRepo(plain), false);

  let e = null;
  try { await status(plain); } catch (err) { e = err; }
  check('...and status raises a typed GitError', e instanceof GitError);
  eq('...with the kind a caller can branch on', e.kind, GitUnavailable.NOT_A_REPO);
  check('...phrased for a human', /not a git repository/i.test(e.message), e.message);

  eq('the two unavailability kinds are distinguishable',
    GitUnavailable.NO_GIT === GitUnavailable.NOT_A_REPO, false);

  // A missing binary must not be indistinguishable from an empty repository — "git isn't
  // installed" is actionable, "no output" is not.
  check('a missing binary has its own kind', GitUnavailable.NO_GIT === 'git_not_found');

  let be = null;
  try { await blame(plain, { path: null }); } catch (err) { be = err; }
  eq('blame without a path is rejected before invoking git', be?.kind, 'bad_args');
}

describe('w8/git: budgets are declared, bounded, and shared with the search layer');
{
  eq('a git call has a wall clock', GIT_TIMEOUT_MS, 10_000);
  eq('output is clamped', GIT_MAX_BYTES, 32 * 1024);
  check('the clamp is smaller than the buffer it reads into', GIT_MAX_BYTES < 1024 * 1024);
}

// ═══════════════════════════════════════════ live
describe(`w8/git: live navigation against a real repository${GIT_OK ? '' : ' [SKIPPED — no git]'}`);
if (GIT_OK) {
  const d = repo();

  eq('a repo is recognised', await isRepo(d), true);

  const clean = await status(d);
  check('a clean tree says so plainly', /working tree clean/.test(clean), clean);
  check('...and still reports the branch', /## main/.test(clean), clean);

  fs.writeFileSync(path.join(d, 'a.txt'), 'first line\nCHANGED\n');
  fs.writeFileSync(path.join(d, 'new.txt'), 'brand new\n');

  const dirty = await status(d);
  check('a modified file appears', /a\.txt/.test(dirty), dirty);
  check('...marked modified', / M a\.txt/.test(dirty), dirty);
  check('an untracked file appears', /\?\? new\.txt/.test(dirty), dirty);

  const wt = await diff(d);
  check('the worktree diff shows the removal', /^-second line$/m.test(wt), wt);
  check('...and the addition', /^\+CHANGED$/m.test(wt), wt);
  // `--no-color` is passed explicitly: a repository with `color.diff = always` would otherwise
  // hand the model escape sequences to read around. The ESC byte is written as an escape so the
  // source stays plain text — a literal one tripped the 0x08-class lint.
  check('...without ANSI colour', !/\x1b\[/.test(wt), JSON.stringify(wt.slice(0, 60)));

  // The staged/worktree distinction is the whole point of having a `staged` flag: before `git
  // add`, one is empty and the other is not. A tool that conflated them would report changes as
  // ready to commit when they are not.
  const staged0 = await diff(d, { staged: true });
  check('nothing is staged yet', /no staged changes/.test(staged0), staged0);
  run(d, 'add', 'a.txt');
  const staged1 = await diff(d, { staged: true });
  check('...and after add, the staged diff is populated', /\+CHANGED/.test(staged1), staged1);

  const scoped = await diff(d, { staged: true, path: 'nonexistent.txt' });
  check('a path scope that matches nothing is reported, not errored',
    /no staged changes/.test(scoped), scoped);

  const b = await branches(d);
  check('the current branch is marked', /^\*\s+main/m.test(b), b);

  const l = await log(d, { limit: 5 });
  check('the log carries the subject', /initial commit/.test(l), l);
  check('...an abbreviated sha', /^[0-9a-f]{7,}\s/m.test(l), l);
  check('...and a date', /\d{4}-\d{2}-\d{2}/.test(l), l);

  const l1 = await log(d, { limit: 1 });
  eq('the limit is honoured', l1.trim().split('\n').length, 1);
  // An unbounded or negative limit must not become "every commit in a large repo".
  check('a nonsense limit is clamped, not obeyed',
    (await log(d, { limit: -5 })).trim().split('\n').length >= 1);

  const bl = await blame(d, { path: 'a.txt' });
  check('blame names the author', /T /.test(bl), bl);
  check('...and carries the line content', /first line/.test(bl), bl);

  const bl1 = await blame(d, { path: 'a.txt', lines: '1,1' });
  eq('a line range narrows the output', bl1.trim().split('\n').length, 1);

  // THE bug this module was written to avoid. `attachCheckpoints` shells to git with GIT_DIR and
  // GIT_WORK_TREE pointing at the W6 SHADOW repository. If those leaked into a status call, the
  // tool would confidently describe the wrong repository. This asserts they are cleared.
  const shadow = mk('shadow');
  run(shadow, 'init', '-q', '--bare');
  const prevDir = process.env.GIT_DIR, prevWt = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = shadow;
  process.env.GIT_WORK_TREE = d;
  try {
    const leaked = await status(d);
    check('an inherited GIT_DIR does NOT redirect the answer to the shadow repo',
      /## main/.test(leaked), leaked);
    check('...and the project changes are still the ones reported',
      /a\.txt/.test(leaked), leaked);
    eq('...and isRepo still answers about the project', await isRepo(d), true);
  } finally {
    if (prevDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = prevDir;
    if (prevWt === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = prevWt;
  }

  // Large output must be clamped with the same honesty contract the search layer uses: the model
  // is told the answer is partial rather than being handed a silent prefix.
  const big = mk('big');
  run(big, 'init', '-q', '-b', 'main');
  run(big, 'config', 'user.email', 't@e'); run(big, 'config', 'user.name', 'T');
  run(big, 'config', 'commit.gpgsign', 'false');
  // autocrlf makes git print advice to stderr on every diff of an LF file. That advice must not
  // be mistaken for a failure — it was, and the resulting error blamed line endings for a size
  // limit. Windows developers hit this on an ordinary large diff.
  run(big, 'config', 'core.autocrlf', 'true');
  // Committed empty first: `git diff` compares the worktree against the INDEX, so an untracked
  // file produces no diff at all. The file has to be tracked for the clamp to have anything to
  // clamp — the earlier version of this test passed a zero-byte diff to the size check.
  fs.writeFileSync(path.join(big, 'huge.txt'), 'seed\n');
  run(big, 'add', 'huge.txt'); run(big, 'commit', '-q', '-m', 'seed');
  fs.writeFileSync(path.join(big, 'huge.txt'),
    Array.from({ length: 4000 }, (_, i) => `line ${i} ${'x'.repeat(60)}`).join('\n'));
  const huge = await diff(big);
  check('...and the oversized diff is genuinely large before clamping',
    huge.length > 1000, String(huge.length));
  check('oversized output is clamped', Buffer.byteLength(huge, 'utf8') <= GIT_MAX_BYTES + 400);
  check('...and SAYS it was clamped', /\[INCOMPLETE RESULT\]/.test(huge), huge.slice(-200));
  check('...naming a size limit rather than blaming line endings',
    !/CRLF/.test(huge), huge.slice(-200));

  // A small diff on the same autocrlf repo still warns on stderr but succeeds outright — the
  // resolve path, distinct from the maxBuffer path above.
  fs.writeFileSync(path.join(big, 'huge.txt'), 'seed\nsecond\n');
  const small = await diff(big);
  check('a warning on a SUCCESSFUL run is not promoted to an error',
    /\+second/.test(small), small);
  check('...and the warning text is not shown to the model', !/CRLF/.test(small), small);
}

// ═══════════════════════════════════════════ tool surface
describe('w8/git: the tool is declared read-only and reaches the model');
{
  const live = GIT_OK ? repo() : mk('nogit');
  const tools = makeTools({ root: live });

  check('a git tool exists', !!tools.git);
  const defs = toolDefinitions(tools);
  const g = defs.find(d => d.function.name === 'git');
  check('...and is offered to the model', !!g);
  check('...as ONE tool with a selector, not five sibling tools',
    !!g.function.parameters?.properties?.what);
  check('...whose description names the five queries',
    ['status', 'diff', 'branch', 'log', 'blame']
      .every(v => g.function.description.includes(v)), g.function.description);

  eq('git is declared ReadOnly', tools.git.effects, 'ReadOnly');
  // Capability metadata is declared once and derived everywhere (W5-T1/T2). If `git` were
  // mislabelled Mutating it would demand approval for a status call; the reverse would let a real
  // mutator bypass one.
  check('...so it is not in the mutating set', !mutatingTools(tools).has('git'),
    [...mutatingTools(tools)].join(','));
  eq('...and the mutating set is still exactly the three writers',
    [...mutatingTools(tools)].sort().join(','), 'bash,edit,write');

  eq('a read-only tool never needs a human after a crash',
    tools.git.recovery({}).class, RecoveryClass.READ_ONLY);

  // The scope boundary made mechanical rather than documentary. The dispatcher is what enforces
  // "no git writes in W8": every write verb must fall through to the error case. If someone later
  // wires `commit` without designing the shadow-repo interaction, this fails loudly.
  for (const write of ['commit', 'checkout', 'push', 'reset', 'merge', 'rebase', 'add', 'stash']) {
    let err = null;
    try { await tools.git.run({ what: write }); } catch (e) { err = e; }
    check(`${write} is NOT a supported query`, err !== null && /unknown git query/i.test(err.message),
      String(err?.message).slice(0, 80));
  }

  let bad = null;
  try { await tools.git.run({ what: 'nonsense' }); } catch (e) { bad = e; }
  check('an unknown query names the ones that exist',
    /status.*diff.*branch.*log.*blame/.test(String(bad?.message)), String(bad?.message));

  if (GIT_OK) {
    const out = await tools.git.run({ what: 'status' });
    check('...and the wired tool actually answers about the real repo',
      /## main/.test(out), out);
    check('the "branches" spelling is accepted as well as "branch"',
      /main/.test(await tools.git.run({ what: 'branches' })));
  }
}

process.exit(summary('w8 git', path.join(HERE, '..', 'results-w8-git.json')) ? 1 : 0);
