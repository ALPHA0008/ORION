// Bracket SWE-bench Lite candidates for LOCAL reproducibility (§6, §7).
//
// A task is ACCEPTED only if, on this machine, all of the following hold:
//   1. the base commit is reachable in the public repository
//   2. the environment installs
//   3. the test_patch applies
//   4. preflight-negative: the FAIL_TO_PASS test FAILS without the gold patch
//   5. oracle-positive:    the FAIL_TO_PASS test PASSES with the gold patch
//
// Anything else is REJECTED with a recorded reason. Negative findings are useful (§6), and a task
// that cannot be reproduced must never be silently patched (§7).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
// Tranche 2 keeps its own roots so Stage-1 venvs and worktrees are never touched.
const SUITE = process.env.SUITE ?? 'capability-v1';
const ROOT = path.join(os.tmpdir(), SUITE);
const QUIET = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };

const REPO_URL = (repo) => `https://github.com/${repo}.git`;
const mirrorDir = (repo) => path.join(ROOT, '_cache', repo.replace('/', '__') + '.git');

function git(args, opts = {}) {
  return execFileSync('git', args, { ...QUIET, timeout: 900_000, ...opts });
}

/** Bare mirror per repository, cloned once and reused. */
function ensureMirror(repo) {
  const dir = mirrorDir(repo);
  if (!fs.existsSync(path.join(dir, 'HEAD'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(['clone', '--bare', '--quiet', REPO_URL(repo), dir]);
  }
  return dir;
}

const hasCommit = (repo, sha) => {
  try { git(['--git-dir', mirrorDir(repo), 'cat-file', '-e', `${sha}^{commit}`]); return true; }
  catch { return false; }
};

/** Per-(repo, commit) working tree. */
function checkout(repo, sha, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // A REAL local clone, not a --work-tree checkout: several of these projects use
  // setuptools_scm, which derives the package version from git metadata and fails
  // ("metadata-generation-failed") without a .git directory. That would reject tasks for a
  // defect in our checkout strategy rather than in the task.
  git(['clone', '--quiet', '--no-checkout', '--local', mirrorDir(repo), dest]);
  // Disable line-ending rewriting BEFORE the checkout populates the tree. On Windows git would
  // otherwise write CRLF, every file would read as modified, and the LF-based test_patch would
  // fail to apply — rejecting the task for a defect in our checkout rather than in the task.
  for (const [k, v] of [['core.autocrlf', 'false'], ['core.safecrlf', 'false'], ['core.fileMode', 'false']])
    git(['-C', dest, 'config', k, v]);
  git(['-C', dest, 'checkout', '-f', '--detach', sha]);
}

// The interpreter is the binding constraint, not the task supply. Python 3.13/3.14 removed stdlib
// modules these era-pinned repos import (`imp`, `cgi`, `ast.Str`), which rejected 30 of 32
// candidates for a property of THIS MACHINE rather than of the task. SWE-bench solves this with a
// per-task Docker image; Docker is not serving here, so we reproduce the essential part of it —
// an era-appropriate interpreter — with `uv`, which can provision arbitrary CPython versions.
const PYVER = process.env.PYVER ?? '3.9';
const venvDir = (taskId) => path.join(ROOT, '_venvs', `${taskId}-py${PYVER}`);
const pyExe = (venv) => process.platform === 'win32'
  ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');

/**
 * ONE VIRTUALENV PER TASK. A shared venv let one task's transitive dependencies stay installed and
 * auto-load as pytest plugins into the next task, where an older pytest rejected them
 * (`addini` assertion) — a cross-task contamination that rejected valid tasks. Docker gives each
 * SWE-bench task its own image; this is the same isolation property, minus the container.
 */
function makeVenv(taskId) {
  const venv = venvDir(taskId);
  const py = pyExe(venv);
  if (!fs.existsSync(py)) {
    fs.mkdirSync(path.dirname(venv), { recursive: true });
    execSync(`uv venv --python ${PYVER} "${venv}"`, { ...QUIET, timeout: 600_000 });
    execSync(`"${py}" -m ensurepip --upgrade`, { ...QUIET, timeout: 300_000 });
  }
  return py;
}

/**
 * Provision the task's dependency universe AS IT WAS on the day the fix was merged.
 *
 * The second constraint after the interpreter is dependency drift: flask 2.0 against today's
 * Werkzeug fails at import, and no amount of task-level care fixes that. SWE-bench solves it with a
 * frozen image per instance. `uv --exclude-newer` reproduces the same property from the instance's
 * own `created_at` -- a general rule derived from adopted metadata, NOT a hand-maintained pin table
 * that would quietly encode our guesses about each repo.
 *
 * Build backend vs. runtime dependency: setuptools/wheel are installed CURRENT and deliberately
 * outside the date pin. A 2021 setuptools predates PEP 660 and cannot build an editable install at
 * all. The backend only has to build the tree; what the tests import is what the pin governs.
 */
function buildRequires(dir) {
  // `--no-build-isolation` means build-time requirements are no longer fetched automatically, so
  // whatever the project declares as its build backend has to be present up front. pytest and
  // pylint both build through setuptools_scm and fail without it. Read the declaration rather than
  // hardcoding a list, then always add setuptools/wheel as the floor.
  const names = new Set(['setuptools', 'wheel']);
  const f = path.join(dir, 'pyproject.toml');
  if (fs.existsSync(f)) {
    // The closing bracket must be the one that ENDS the list, not a `]` inside an extras marker.
    // `setuptools-scm[toml]>=6.2.3` truncated a lazier pattern mid-entry, so setuptools_scm was
    // never installed, pytest built as version 0.0.0 with no generated `_version.py`, and the
    // package failed at import -- which surfaced as "the gold patch does not fix the bug".
    const m = fs.readFileSync(f, 'utf8').match(/requires\s*=\s*\[([\s\S]*?)\]\s*(?:\r?\n|$)/);
    for (const q of m?.[1].match(/"([^"]+)"|'([^']+)'/g) ?? []) {
      const n = q.replace(/["']/g, '').split(/[<>=!~;[\s]/)[0].trim();
      if (n) names.add(n);
    }
  }
  return [...names].join(' ');
}

const TODAY = new Date().toISOString().slice(0, 10);

// §3 kill-criteria. A candidate that cannot be bracketed inside this ceiling is recorded as
// unreproducible and abandoned -- a perfect sweep is not worth the phase it would consume.
const CANDIDATE_CEILING_MS = Number(process.env.CANDIDATE_CEILING_MS ?? 480_000);

/**
 * Repair holes in the reconstructed dependency universe.
 *
 * `--exclude-newer` recreates the index as of a date, but a package whose only release before that
 * date was later YANKED leaves a hole the resolver cannot fill. It then backtracks -- silently and
 * catastrophically. Pinning flask to 2021 produced pytest **3.5.1**, five years out of era, because
 * `atomicwrites` had no usable pre-2021 release; the ancient pytest then failed on every task and
 * looked exactly like "the maintainer's fix does not work".
 *
 * uv names the offending package in its own hint, so the hole is lifted for THAT package only and
 * the install is retried. This stays a general rule -- no hand-maintained list of exceptions.
 */
function pipInstall(py, dir, args, isoDate, timeout = 900_000) {
  // `atomicwrites` is seeded because its hole is SILENT: uv does not fail, it backtracks, and a
  // 2021 pin quietly yields pytest 3.5.1. Verified: with this one override the same pin resolves
  // pytest 6.2.4.
  const lifted = ['atomicwrites'];
  const over = lifted.map(n => `--exclude-newer-package ${n}=${TODAY}`).join(' ');
  const pin = isoDate ? `--exclude-newer ${isoDate}` : '';
  const run = (cmd) => execSync(cmd, { cwd: dir, ...QUIET, timeout });

  // Era build tools FIRST. A project that generates its version at build time (pytest, via
  // setuptools_scm) needs the backend it was written against; a modern one writes the generated
  // module somewhere the 2023 source does not import from, and the package imports as broken.
  // Only if the era's backend genuinely cannot build -- pre-PEP-660 setuptools has no
  // `build_editable` at all -- is a current backend substituted.
  const attempt = (buildPin, upgrade = '') => {
    run(`uv pip install --python "${py}" ${buildPin} ${over} ${upgrade} -q ${buildRequires(dir)}`);
    run(`uv pip install --python "${py}" ${pin} ${over} --no-build-isolation -q ${args}`);
  };
  try { attempt(pin); return [...lifted, 'build:era']; }
  catch (e) {
    // Fall back ONLY for the specific gap this was written for: pre-PEP-660 setuptools has no
    // `build_editable` hook at all. A blanket catch here masked a real failure once already --
    // it swapped in a modern setuptools_scm whose generated-version layout the era's source does
    // not import from, and the package installed "successfully" but was broken at import.
    const err = String(e.stderr ?? '') + String(e.stdout ?? '') + String(e.message ?? '');
    if (!/build_editable|BuildMetaLegacyBackend|build backend returned an err|Failed to build/i.test(err)) throw e;
    // --upgrade matters: the first attempt already installed the ERA build tools, and without it
    // uv treats them as satisfied and leaves them in place. That produced a modern setuptools
    // calling into a 2014 `wheel` that has no `wheel.wheelfile` -- a half-swapped toolchain that
    // fails more confusingly than either version alone.
    attempt('', '--upgrade');
    return [...lifted, 'build:current'];
  }
}

/** The resolved test-runner version. Recorded so a silently-backtracked resolution is visible. */
function pytestVersion(py, dir) {
  try { return String(execSync(`"${py}" -m pytest --version`, { cwd: dir, ...QUIET, timeout: 120_000 }))
    .match(/\d+\.\d+[\w.]*/)?.[0] ?? 'unknown'; }
  catch (e) { return String((e.stdout ?? '') + (e.stderr ?? '')).match(/\d+\.\d+[\w.]*/)?.[0] ?? 'unknown'; }
}

/**
 * Per-repository test invocation.
 *
 * Assuming pytest everywhere was wrong. Django ships its own runner and uses dotted ids
 * (`mail.tests.MailTests.test_x`); handing one to pytest yields "file or directory not found",
 * which the bracket then recorded as `BASELINE_NOT_REPRODUCIBLE` -- i.e. "the maintainer's own fix
 * does not work" -- for a task whose tests we had never actually run.
 *
 * Django ids are additionally run at CLASS granularity. `mail.tests.MailTests.test_non_ascii_dns_...`
 * calls `delattr(DNS_NAME, '_fqdn')` and depends on an earlier test in its class having cached that
 * attribute, so standalone it raises `AttributeError: _fqdn` even with the gold patch applied.
 * Measured: clean tree -> FAILED (errors=1), gold patch -> OK across 45 tests. Running the class is
 * what makes the oracle meaningful; running the method alone measures test isolation instead.
 */
const TEST_STRATEGY = {
  'django/django': {
    // `runtests.py` lives in tests/ and bootstraps its own settings.
    cmd: (py, id) => `"${py}" runtests.py --settings=test_sqlite --parallel=1 "${classOf(id)}"`,
    cwd: (dir) => path.join(dir, 'tests'),
    // Django's runner reports OK / FAILED rather than pytest's exit-code conventions.
    // Django's runner writes its verdict (OK / FAILED) to STDERR, while stdout carries only the
    // "Testing against Django installed in ..." banner. Matching on a captured tail therefore read
    // the banner and never the verdict, so every Django task failed the oracle check. The EXIT CODE
    // is unambiguous and is what unittest guarantees: 0 = all passed, non-zero = failures/errors.
    // Measured on a verified tree: clean -> exit 1 "FAILED (errors=1)", gold -> exit 0 "OK" (45 tests).
    passed: (out, ok) => ok,
  },
};
/**
 * Reduce a Django test id to CLASS granularity, in the format `runtests.py` accepts.
 *
 * SWE-bench records Django ids as unittest prints them -- `test_x (mail.tests.MailTests)`, with the
 * dotted path in PARENTHESES. An earlier version split on '.' and produced
 * `test_non_ascii_dns_non_unicode_email (mail`, which runtests.py tried to import as a module.
 * Both id shapes are handled: parenthesised, and plain dotted.
 */
const classOf = (id) => {
  const s = String(id).trim();
  const paren = s.match(/^\s*(\S+)\s*\(([^)]+)\)\s*$/);
  if (paren) return paren[2].trim();          // `test_x (a.b.C)` -> `a.b.C`
  const parts = s.split('.');
  return parts.length > 1 && /^test/.test(parts.at(-1)) ? parts.slice(0, -1).join('.') : s;
};

/** Run one test id under the repository's own convention; return { passed, output }. */
function runTest(py, dir, nodeId, timeout = 300_000, repo = null) {
  const s = TEST_STRATEGY[repo];
  const cmd = s ? s.cmd(py, nodeId) : `"${py}" -m pytest "${nodeId}" -x -q -p no:cacheprovider`;
  const cwd = s ? s.cwd(dir) : dir;
  const opts = { cwd, ...QUIET, timeout, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } };
  try {
    const out = String(execSync(cmd, opts));
    return { passed: s ? s.passed(out, true) : true, output: out.slice(-800) };
  } catch (e) {
    // stderr FIRST: django writes its verdict there, and a stdout-first concatenation pushed it
    // out of the retained tail, leaving only the banner as evidence.
    const out = String(e.stderr ?? '') + String(e.stdout ?? '');
    return { passed: s ? s.passed(out, false) : false, output: out.slice(-800) };
  }
}

function applyPatch(dir, diffText, name) {
  // Per-task patch file: a shared name let one task's diff linger and be re-applied against the
  // next task's tree, which surfaced as a bogus "patch does not apply" rejection.
  const f = path.join(dir, `.__${name}.diff`);
  fs.writeFileSync(f, diffText.endsWith('\n') ? diffText : diffText + '\n', { encoding: 'utf8' });
  git(['-C', dir, 'apply', '--whitespace=nowarn', f]);
}

/**
 * Map a bracket stage plus its evidence onto the §6 rejection vocabulary.
 *
 * The stage says WHERE it failed; the category says WHAT KIND of failure it is, which is what
 * decides whether the corpus is limited by task quality or by our ability to reproduce an
 * environment. Those imply completely different next steps, so both are recorded.
 */
function categorise(stage, detail = '') {
  const d = String(detail);
  if (stage === 'mirror') return 'REPOSITORY_UNAVAILABLE';
  if (stage === 'commit-unreachable') return 'REPOSITORY_UNAVAILABLE';
  if (stage === 'no-test') return 'TASK_NOT_OBSERVABLE';
  // Prose where a test id belongs: there is no executable oracle, so nothing to verify.
  if (stage === 'unaddressable-id') return 'TASK_NOT_OBSERVABLE';
  if (stage === 'preflight-positive') return 'TASK_TOO_TRIVIAL';   // already satisfied on a clean tree
  if (stage === 'venv' || stage === 'checkout') return 'ENVIRONMENT_UNREPRODUCIBLE';
  if (stage === 'install')
    return /No solution found|Failed to (download and )?build|resolv/i.test(d)
      ? 'DEPENDENCY_UNRESOLVABLE' : 'ENVIRONMENT_UNREPRODUCIBLE';
  if (stage === 'test-patch') return 'BASELINE_NOT_REPRODUCIBLE';
  if (stage === 'gold-patch') return 'BASELINE_NOT_REPRODUCIBLE';
  if (stage === 'oracle-negative') {
    // An import/collection error is the environment failing to reconstruct, not the maintainer's
    // fix being wrong. A clean assertion failure is the oracle genuinely not holding here.
    if (/ModuleNotFoundError|ImportError|AttributeError|no name .* in any of|PluginValidationError/i.test(d))
      return 'ENVIRONMENT_UNREPRODUCIBLE';
    return 'BASELINE_NOT_REPRODUCIBLE';
  }
  if (stage === 'timebox') return 'ENVIRONMENT_UNREPRODUCIBLE';
  return 'OTHER';
}

/**
 * Is this an id a test runner can actually be pointed at?
 *
 * Accepts: pytest node ids (`path/to/test.py::Class::test_x`), unittest print form
 * (`test_x (a.b.C)`), and plain dotted paths (`a.b.C.test_x`). Rejects free prose.
 */
function addressableTestId(id) {
  const s = String(id ?? '').trim();
  if (!s || /\s{2,}/.test(s)) return false;
  if (s.includes('::')) return true;                                  // pytest node id
  if (/^\S+\s*\([\w.]+\)$/.test(s)) return true;                       // test_x (a.b.C)
  if (/^[\w]+(\.[\w]+)+$/.test(s)) return true;                        // dotted path
  return false;
}

// ── main ─────────────────────────────────────────────────────────────────────
const data = JSON.parse(fs.readFileSync(path.join(FIX, process.env.CANDIDATES ?? 'swebench-lite-candidates.json'), 'utf8'));
const only = process.env.ONLY_REPO;
const limit = Number(process.env.LIMIT ?? 0);
let cands = data.candidates;
if (only) cands = cands.filter(c => c.repository === only);
if (process.env.ONLY_IDS) {
  const ids = new Set(process.env.ONLY_IDS.split(',').map(x => x.trim()));
  cands = cands.filter(c => ids.has(c.task_id));
}
if (limit) cands = cands.slice(0, limit);

console.log(`bracketing ${cands.length} candidates  (python ${PYVER})`);
console.log('─'.repeat(96));

const accepted = [], rejected = [];
for (const c of cands) {
  const t0 = Date.now();
  const label = c.task_id.padEnd(28);
  const reject = (stage, detail) => {
    rejected.push({ task_id: c.task_id, repository: c.repository, base_commit: c.base_commit,
                    python: PYVER, status: 'rejected', stage, reason: categorise(stage, detail),
                    evidence: String(detail).slice(0, 400) });
    console.log(`  REJECT ${label} ${categorise(stage, detail).padEnd(28)} ${stage}`);
    // A rejected task keeps nothing: its tree and its interpreter are both discarded, so a long
    // bracketing sweep does not accumulate gigabytes of dead environments.
    if (process.env.KEEP) return;   // diagnostics: keep the evidence when investigating a rejection
    for (const d of [path.join(ROOT, 'work', c.task_id), venvDir(c.task_id)])
      { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  };

  try {
    ensureMirror(c.repository);
  } catch (e) { reject('mirror', e.message); continue; }

  if (!hasCommit(c.repository, c.base_commit)) { reject('commit-unreachable', c.base_commit.slice(0, 12)); continue; }

  const dir = path.join(ROOT, 'work', c.task_id);
  let py;
  try { py = makeVenv(c.task_id); }
  catch (e) { reject('venv', e.message); continue; }

  // Always a fresh tree per task; never inherit another task's applied patches.
  try { checkout(c.repository, c.base_commit, dir); }
  catch (e) { reject('checkout', e.message); continue; }

  // The test runner is resolved by the same date pin as everything else, so it is era-correct by
  // construction -- except for the pytest repo itself, where naming pytest as a dependency would
  // collide with the editable install of the package under test.
  const installArgs = '-e .';
  const overBudget = () => Date.now() - t0 > CANDIDATE_CEILING_MS;
  let lifted = [];
  try {
    // Django is pure Python with a near-empty runtime dependency set, and the era pin actively
    // breaks it: `asgiref` has a yank-hole, and pinning further makes the project's own version
    // metadata unsatisfiable ("only django==4.1.dev is available and you require django"). The pin
    // exists to stop dependency drift breaking era code; with no dependencies to drift it buys
    // nothing and costs reproducibility.
    const NO_DATE_PIN = new Set(['django/django']);
    lifted = pipInstall(py, dir, installArgs, NO_DATE_PIN.has(c.repository) ? null : c.created_at);
    // The repo under test IS pytest for one of these projects; naming pytest as a dependency there
    // would collide with the editable install of the package being tested.
    if (c.repository !== 'pytest-dev/pytest' && !TEST_STRATEGY[c.repository])
      execSync(`uv pip install --python "${py}" -q "pytest<8"`, { cwd: dir, ...QUIET, timeout: 900_000 });
  }
  catch (e) { reject('install', e.message); continue; }

  if (overBudget()) { reject('timebox', `exceeded ${CANDIDATE_CEILING_MS / 1000}s ceiling during provisioning`); continue; }

  try { applyPatch(dir, c.test_patch, 'tp'); }
  catch (e) { reject('test-patch', e.message); continue; }

  const test = c.fail_to_pass[0];
  if (!test) { reject('no-test', 'FAIL_TO_PASS empty'); continue; }

  // Some SWE-bench instances record PROSE DOCSTRING SUMMARIES where a test id belongs -- e.g.
  // django-15629's FAIL_TO_PASS is ["AlterField operation of db_collation on primary keys changes
  // any FKs", ...]. No runner can address those, so the task has no executable oracle. 32 of 277
  // Tranche-2 candidates are affected, so this is a systematic upstream metadata defect rather than
  // a per-task accident. Detected BEFORE provisioning: rejecting it later as "the gold patch does
  // not fix the bug" would blame the task for a missing id.
  if (!addressableTestId(test)) { reject('unaddressable-id', `FAIL_TO_PASS is prose, not a test id: "${String(test).slice(0, 70)}"`); continue; }

  const neg = runTest(py, dir, test, 600_000, c.repository);
  if (neg.passed) { reject('preflight-positive', 'test passes WITHOUT the fix'); continue; }

  try { applyPatch(dir, c.gold_patch, 'gold'); }
  catch (e) { reject('gold-patch', e.message); continue; }

  const pos = runTest(py, dir, test, 600_000, c.repository);
  // Keep enough of the failure to diagnose it. A bare last line ("AssertionError") cannot
  // distinguish a genuine task defect from an environment artifact, and that distinction decides
  // whether the task is rejected honestly or rejected for a flaw in this script.
  if (!pos.passed) { reject('oracle-negative', pos.output.replace(/\s+/g, ' ').slice(-260)); continue; }

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  accepted.push({ ...c, status: 'accepted', reason: 'BRACKETED', verified_test: test, python: PYVER, venv: venvDir(c.task_id),
                  install_args: installArgs, exclude_newer: c.created_at, exclude_newer_lifted: lifted, pytest_version: pytestVersion(py, dir), bracket_seconds: Number(secs) });
  console.log(`  ACCEPT ${label} preflight=FAIL oracle=PASS  ${secs}s`);
}

console.log('─'.repeat(96));
console.log(`accepted ${accepted.length} / ${cands.length}`);
const byStage = {};
for (const r of rejected) byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
console.log('rejections by stage:', JSON.stringify(byStage));

const outFile = process.env.OUT ?? path.join(FIX, 'bracket-results.json');
const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { accepted: [], rejected: [] };
fs.writeFileSync(outFile, JSON.stringify({
  at: new Date().toISOString(),
  accepted: [...prev.accepted.filter(a => !accepted.some(x => x.task_id === a.task_id)), ...accepted],
  rejected: [...prev.rejected.filter(a => !rejected.some(x => x.task_id === a.task_id)
                                      && !accepted.some(x => x.task_id === a.task_id)), ...rejected],
}, null, 2));
console.log(`wrote ${outFile}`);
