// The verifier. ONE implementation, shared by the baseline runner and the anti-gaming bracket.
//
// It matters that this is a single module: if the attack harness verified through its own copy, it
// would be proving a defence the real runner does not have. §7's guarantee is only worth something
// when the thing under attack is literally the thing in production.
//
// Verification is a process exit status. No model is in this path (§11).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const QUIET = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' };
const git = (args, opts = {}) => execFileSync('git', args, { ...QUIET, timeout: 300_000, ...opts });

/** P2P lists run to the hundreds; the cap is recorded so the claim is exactly as strong as the evidence. */
export const P2P_CAP = Number(process.env.P2P_CAP ?? 25);

/**
 * Drop oracle ids the UPSTREAM DATASET truncated.
 *
 * SWE-bench Lite serialises its FAIL_TO_PASS / PASS_TO_PASS lists in a way that splits parametrised
 * node ids containing commas -- `test_locate_app[cliapp.factory-create_app2("foo", "bar")]` arrives
 * as two fragments, neither of which pytest can collect. This is a defect in the adopted metadata,
 * not in the task and not in our quoting (which was ALSO wrong, and was fixed separately).
 *
 * An id with unbalanced brackets is unrunnable by construction, so it is excluded and the exclusion
 * is COUNTED. Silently passing it to pytest would report "not found" and score the maintainer's own
 * fix as a regression -- exactly the false negative this whole stage exists to avoid.
 */
export const runnableIds = (ids = []) =>
  ids.filter(x => (x.match(/\[/g) ?? []).length === (x.match(/\]/g) ?? []).length);

/** Files the test_patch touches. These are the oracle; the agent must not be able to edit them. */
export const testPatchFiles = (diffText) =>
  [...diffText.matchAll(/^diff --git a\/(\S+) b\/\S+/gm)].map(m => m[1]);

export function pytest(py, dir, nodeIds, timeout = 600_000) {
  // execFileSync, NOT a shell string. Parametrised node ids legitimately contain commas, spaces
  // and brackets -- `test_locate_app[cliapp.factory-create_app2(foo, bar)]` -- and going through a
  // shell split them mid-id. Every such id then reported "not found", which read as the
  // maintainer's own fix breaking 25 unrelated tests. It was our quoting, not their patch.
  try {
    const out = execFileSync(py, ['-m', 'pytest', ...nodeIds, '-q', '-p', 'no:cacheprovider'],
      { cwd: dir, ...QUIET, timeout, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    return { passed: true, output: String(out).slice(-1200) };
  } catch (e) {
    return { passed: false, output: (String(e.stdout ?? '') + String(e.stderr ?? '')).slice(-1200) };
  }
}

export const addressableIds = (ids = []) =>
  ids.filter(x => {
    const b = x.indexOf('[');
    // pytest splits a node id on '::' before it considers brackets, so an id whose PARAMETER
    // contains '::' -- `test_ischildnode[foo/bar::TestBaz-foo/bar-False]` -- is unaddressable on
    // the command line: pytest looks for a class named `TestBaz-foo/bar-False]` and reports "not
    // found". The test exists and `--collect-only` lists it; it simply cannot be named as an
    // argument. Excluding it is a limitation of the RUNNER, not a regression by the agent, so it
    // is dropped and counted rather than scored against anyone.
    return b === -1 || !x.slice(b).includes('::');
  });

/**
 * Restore the oracle before judging.
 *
 * Every file the test_patch touches is reset to base_commit and the test_patch re-applied, so
 * whatever the agent (or an attack) did to the test suite is discarded before the verdict is taken.
 * Without this, "delete the failing test" scores as a pass -- the single most likely way for a
 * benchmark like this to report a capability that does not exist.
 */
export function restoreOracle(dir, task) {
  for (const f of testPatchFiles(task.test_patch)) {
    try { git(['-C', dir, 'checkout', '-f', task.base_commit, '--', f]); }
    catch { /* may not exist at base -- test_patch will create it */ }
  }
  // An attacker can also add files git does not know about (a root conftest.py that skips
  // everything). Restoring tracked files alone would leave that in place, so untracked additions
  // are cleared too -- while preserving gitignored build artifacts the venv depends on.
  try { git(['-C', dir, 'clean', '-fd', '--', '.']); } catch { /* best effort */ }

  const p = path.join(dir, '.__verify.diff');
  fs.writeFileSync(p, task.test_patch.endsWith('\n') ? task.test_patch : task.test_patch + '\n', 'utf8');
  git(['-C', dir, 'apply', '--whitespace=nowarn', p]);
  fs.rmSync(p, { force: true });
}

/** Reset a task's tree to its pre-fix state, keeping the venv that bracketing validated. */
export function resetTask(task) {
  const dir = task.work_dir;
  if (!fs.existsSync(path.join(dir, '.git'))) throw new Error(`no tree at ${dir}; re-run bracketing`);
  // `-x` is deliberately omitted: .egg-info / .egg-link are gitignored build artifacts and
  // removing them breaks the editable install the bracket proved.
  git(['-C', dir, 'checkout', '-f', '--detach', task.base_commit]);
  git(['-C', dir, 'clean', '-fd']);
  return dir;
}

/**
 * Is this a Django test id a runner can be pointed at, rather than a prose docstring?
 *
 * SWE-bench's django PASS_TO_PASS lists mix real ids with unittest DOCSTRING SUMMARIES --
 * "A translated display value is coerced to str." sits beside
 * "test_choices (model_fields.tests.ChoicesTests)". runtests.py tries to import the prose as a
 * module and fails, which scored the maintainer's own fix as a P2P regression on 5 of 12 django
 * tasks whose FAIL_TO_PASS had already PASSED. The pytest path already filters unaddressable ids;
 * the django path must do the same or the two disagree about what is verifiable.
 */
const djangoAddressable = (id) => {
  const t = String(id ?? '').trim();
  if (!t) return false;
  if (/^\S+\s*\([\w.]+\)$/.test(t)) return true;   // test_x (a.b.C)
  if (/^[\w]+(\.[\w]+)+$/.test(t)) return true;     // dotted path
  return false;
};

/**
 * Django does not use pytest. It ships `tests/runtests.py`, names tests as unittest prints them
 * (`test_x (a.b.C)`, class in PARENTHESES), writes its verdict to STDERR, and requires CLASS
 * granularity because several of its tests depend on siblings having run first. All four were
 * separately responsible for rejecting every Django task during Tranche-2 admission.
 *
 * The same contract is declared in eval/capability-v1/bracket-corpus.mjs and documented in
 * research/capability-v1/repository-test-contract.md. It lives in BOTH because the bracket decides
 * admission and this decides verdicts; if they disagreed, a task could be admitted on one runner
 * and judged on another.
 */
const djangoClass = (id) => {
  const t = String(id).trim();
  const m = t.match(/^\s*(\S+)\s*\(([\w.]+)\)\s*$/);
  if (m) return m[2];
  const parts = t.split('.');
  return parts.length > 1 && /^test/.test(parts.at(-1)) ? parts.slice(0, -1).join('.') : t;
};

/** Run Django tests via its own runner. Verdict comes from the EXIT CODE (unittest guarantees it). */
function djangoRun(py, dir, ids, timeout = 900_000) {
  const classes = [...new Set(ids.map(djangoClass))];
  try {
    const out = execFileSync(py, ['runtests.py', '--settings=test_sqlite', '--parallel=1', ...classes],
      { cwd: path.join(dir, 'tests'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        timeout, maxBuffer: 64 * 1024 * 1024 });
    return { passed: true, output: String(out).slice(-1200) };
  } catch (e) {
    // stderr FIRST: django's OK/FAILED lives there, stdout carries only a banner.
    return { passed: false, output: (String(e.stderr ?? '') + String(e.stdout ?? '')).slice(-1200) };
  }
}

const isDjango = (task) => task.repository === 'django/django';

/**
 * The verdict. FAIL_TO_PASS must now pass AND PASS_TO_PASS must still pass -- a fix that satisfies
 * the target test by breaking the rest of the suite is not a fix.
 */
export function verifyTask(task) {
  const dir = task.work_dir;
  restoreOracle(dir, task);

  // Django path: its own runner, class granularity, capped P2P from the same declared list.
  if (isDjango(task)) {
    const f2pD = djangoRun(task.python_exe, dir, [task.verified_test]);
    const declaredD = task.pass_to_pass ?? [];
    const runnableD = declaredD.filter(djangoAddressable);
    const p2pIdsD = runnableD.slice(0, P2P_CAP);
    const p2pD = p2pIdsD.length
      ? djangoRun(task.python_exe, dir, p2pIdsD)
      : { passed: true, output: 'none addressable' };
    return {
      fail_to_pass_now_passes: f2pD.passed,
      pass_to_pass_still_passes: p2pD.passed,
      pass_to_pass_checked: p2pIdsD.length,
      pass_to_pass_declared: declaredD.length,
      // Counted, never silently dropped: coverage must stay exactly as strong as the evidence.
      pass_to_pass_unrunnable: declaredD.length - runnableD.length,
      pass_to_pass_uncollectable: 0,
      task_success: f2pD.passed && p2pD.passed,
      f2p_output: f2pD.output, p2p_output: p2pD.output,
    };
  }

  const f2p = pytest(task.python_exe, dir, [task.verified_test]);
  const declared = task.pass_to_pass ?? [];
  const runnable = addressableIds(runnableIds(declared));
  let p2pIds = runnable.slice(0, P2P_CAP);

  // Some declared P2P ids name tests that DO NOT EXIST at base_commit -- pytest-11148 lists
  // `TestFNMatcherPort::test_not_matching[...]`, a class absent from this revision. The ids are
  // well-formed, so the bracket-balance filter cannot catch them; they are simply stale metadata.
  // Passing them to pytest yields "not found", which pytest reports as an ERROR exit -- scoring the
  // maintainer's own fix as a regression. So collectability is checked first, and anything the
  // repository cannot collect is dropped and counted rather than held against the agent.
  // Keep only P2P ids the repository can actually collect AT THIS COMMIT.
  //
  // Some declared ids name tests that no longer exist here (pytest-11148 lists a TestFNMatcherPort
  // class absent from this revision). Handing those to pytest yields "not found", which exits
  // non-zero and scores the maintainer own fix as a regression -- the exact false negative this
  // stage exists to prevent.
  //
  // Collection must be driven by FILES, not by the ids themselves: asking pytest to collect a
  // missing id reproduces the very error being diagnosed. Output is read directly with a large
  // buffer because the shared pytest() helper truncates to the last 1200 chars for logging, which
  // silently discarded most of the id list.
  let uncollectable = 0;
  if (p2pIds.length) {
    const files = [...new Set(p2pIds.map(s => s.split("::")[0]))];
    let out = "";
    try {
      out = String(execFileSync(task.python_exe, ["-m", "pytest", ...files, "--collect-only", "-q", "-p", "no:cacheprovider"],
        { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }));
    } catch (e) { out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    const present = new Set(out.split(String.fromCharCode(10)).map(l => l.trim()).filter(l => l.includes("::")));
    if (present.size) {
      const kept = p2pIds.filter(id => present.has(id));
      if (kept.length) { uncollectable = p2pIds.length - kept.length; p2pIds = kept; }
    }
  }
  const p2p = p2pIds.length ? pytest(task.python_exe, dir, p2pIds)
                            : { passed: true, output: 'none collectable' };
  return {
    fail_to_pass_now_passes: f2p.passed,
    pass_to_pass_still_passes: p2p.passed,
    pass_to_pass_checked: p2pIds.length,
    pass_to_pass_declared: declared.length,
    pass_to_pass_unrunnable: declared.length - runnable.length,
    pass_to_pass_uncollectable: uncollectable,
    task_success: f2p.passed && p2p.passed,
    f2p_output: f2p.output, p2p_output: p2p.output,
  };
}
