#!/usr/bin/env node
// W5 E1 — the evaluation harness's own gate. Runs in CI; needs no model.
//
// WHY THIS EXISTS
//
// `eval/` was never in CI because its only entry point (`eval/cli/index.mjs run`) requires a
// live model, and correctly refuses to fabricate one. So the harness that measures the runtime
// was itself unmeasured — and W5 proved the cost of that immediately: making
// `LocalSandbox.exec` async (X1) turned every synchronous `sandbox.exec` in the verifiers into
// a Promise that never throws, so eleven call sites across three files began reporting PASS
// regardless of the code under test. Nothing caught it. A benchmark that cannot fail is worse
// than no benchmark, because it produces numbers people believe.
//
// WHAT IT CHECKS
//
//   1. Every task validates against the schema (`validateTask`).
//   2. Every fixture materialises into a real sandbox without throwing. (Note: `base_commit`
//      hashes the fixture BEFORE a task's optional `mutate`, so it deliberately does not equal
//      a hash of the files on disk — it identifies the base repository state, not the mutated
//      one. Re-deriving it here would assert the wrong thing.)
//   3. THE LOAD-BEARING ONE: for every task with a mechanically checkable verifier, the
//      verifier FAILS on the untouched fixture. A task that already passes before the agent
//      touches anything measures nothing. This is the check that would have caught the X1
//      regression on its first run.
//   4. Verifier plumbing is honest: a verifier reports FAIL by returning FAIL, never by
//      throwing, and never by silently resolving a Promise it forgot to await.
//
// It deliberately does NOT check that a task is passable — that requires an agent. Task
// difficulty is a hypothesis measured by real runs (see benchmark-methodology.md).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalSandbox } from '../v0/src/sandbox/local/index.mjs';
import { TASKS } from './tasks/index.mjs';
import { validateTask, OUTCOME } from './tasks/schema.mjs';
import { verify } from './evaluators/index.mjs';
import { resolveConfig, configDrift, SHIPPED_DEFAULTS } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`); }
  else { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`); }
};

function freshSandbox(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `eval-selfcheck-${tag}-`));
  return new LocalSandbox(dir, { execTimeoutMs: 30_000 });
}

// ── 1. schema ────────────────────────────────────────────────────────────────
console.log('\n── eval/selfcheck: task definitions ──────────────────────────');
check('at least one task is defined', TASKS.length > 0, `${TASKS.length} tasks`);
{
  const bad = [];
  for (const t of TASKS) {
    try { validateTask(t); } catch (e) { bad.push(`${t.task_id}: ${e.message}`); }
  }
  check('every task validates against the schema', bad.length === 0, bad.join(' | ').slice(0, 300));
}
{
  const ids = TASKS.map(t => t.task_id);
  check('task ids are unique', new Set(ids).size === ids.length);
}

// ── 2 & 3. fixtures materialise, and the bug is real ────────────────────────
console.log('\n── eval/selfcheck: fixtures materialise ──────────────────────');

// Tasks graded on the AGENT'S FINAL TEXT rather than on repository state cannot be probed
// without a run: their verifier reads `ctx.result`, which is empty here, so it would fail
// trivially and prove nothing. They are listed explicitly rather than pattern-matched, so
// adding a task cannot silently opt out of the gate.
const TEXT_GRADED = new Set(['explore-find-tax-rate', 'readme-injection']);

const probed = [];
for (const t of TASKS) {
  const sandbox = freshSandbox(t.task_id.slice(0, 12));
  let setupOk = true, setupErr = '';
  try { t.setup(sandbox); } catch (e) { setupOk = false; setupErr = String(e?.message ?? e); }
  check(`${t.task_id}: fixture materialises`, setupOk, setupErr.slice(0, 160));
  if (!setupOk) continue;

  if (TEXT_GRADED.has(t.task_id)) continue;
  probed.push({ t, sandbox });
}

console.log('\n── eval/selfcheck: the bug is real (verifier fails pre-fix) ───');
for (const { t, sandbox } of probed) {
  let r = null, threw = null;
  try {
    r = await verify(t, { sandbox, result: '', runId: 'selfcheck', store: null });
  } catch (e) { threw = e; }

  // A verifier must REPORT failure, not throw it. Throwing loses the evidence and is
  // indistinguishable from a harness bug.
  check(`${t.task_id}: verifier returns a verdict instead of throwing`, threw === null,
    threw ? String(threw.message ?? threw).slice(0, 140) : '');
  if (threw) continue;

  check(`${t.task_id}: verdict is a known outcome`,
    Object.values(OUTCOME).includes(r.outcome), String(r.outcome));

  // THE GATE. An unfixed fixture must not satisfy its own verifier.
  check(`${t.task_id}: FAILS on the untouched fixture (the bug is real)`,
    r.outcome === OUTCOME.FAIL, `got ${r.outcome}${r.detail ? `: ${String(r.detail).slice(0, 90)}` : ''}`);
}

// ── 4. the async trap that caused this file to exist ────────────────────────
console.log('\n── eval/selfcheck: verifiers await the sandbox ────────────────');
{
  // Direct regression probe for the X1 fallout. If a verifier calls the now-async
  // `sandbox.exec` without awaiting it, the Promise never throws and the check reports PASS on
  // broken code. Assert at the source level that nothing in the verifier path does this: a
  // behavioural probe would only catch it for whichever task happened to be exercised.
  const files = ['evaluators/index.mjs', 'tasks/index.mjs', 'tasks/hard.mjs'];
  const offenders = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(HERE, rel), 'utf8');
    src.split(/\r?\n/).forEach((line, i) => {
      // Remove the correctly-awaited calls, then flag whatever sandbox `.exec(` is left. Doing
      // it by subtraction avoids a lookbehind that has to guess at intervening whitespace —
      // the first version of this check used one and reported eleven false positives.
      // Matching on the RECEIVER keeps RegExp `.exec()` out of the results.
      const remaining = line.replace(/await\s+(?:ctx\.sandbox|sandbox|sb)\.exec\(/g, '');
      if (/\b(?:ctx\.sandbox|sandbox|sb)\.exec\(/.test(remaining)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  check('no verifier calls sandbox.exec without awaiting it', offenders.length === 0,
    offenders.join(', '));
}

// ── 5. E3: the eval measures what the product ships ─────────────────────────
console.log('\n── eval/selfcheck: measured config == shipped defaults ────────');
{
  // The eval used to default `compactContext` OFF while the Worker shipped it ON, so every
  // unlabelled report described a configuration nobody runs. Two things are asserted: the
  // eval's default now IS the shipped default, and SHIPPED_DEFAULTS still matches the Worker's
  // actual constructor defaults — the second is what stops this from silently rotting when the
  // Worker's defaults next change.
  const cfg = resolveConfig();
  const drift = configDrift(cfg);
  check('the eval default configuration matches shipped defaults',
    Object.keys(drift).length === 0, JSON.stringify(drift));

  // Read the Worker's real defaults by constructing one with nothing specified.
  const { Worker } = await import('../v0/src/agent/loop/worker.mjs');
  const w = new Worker(null, {});
  const mismatched = Object.entries(SHIPPED_DEFAULTS)
    .filter(([k, v]) => w[k] !== v)
    .map(([k, v]) => `${k}: table says ${JSON.stringify(v)}, Worker uses ${JSON.stringify(w[k])}`);
  check('SHIPPED_DEFAULTS still matches the Worker constructor', mismatched.length === 0,
    mismatched.join(' | '));
}

// ── summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(62));
console.log(`eval/selfcheck: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? `  :: ${f.detail}` : ''}`);
}
fs.writeFileSync(path.join(HERE, 'reports', 'selfcheck.json'),
  JSON.stringify({ at: new Date().toISOString(), pass, fail, failures }, null, 2) + '\n');
process.exit(fail ? 1 : 0);
