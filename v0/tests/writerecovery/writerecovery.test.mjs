// write() recovery audit (brief §11–§12).
//
// The models frequently escape through `write` when `edit` fails. The runtime's strongest
// safety properties are built around content-addressed `edit`, so this measures — rather than
// assumes — what `write` can and cannot establish after a crash.
//
// It changes no production behaviour; it characterises the existing contract.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { RecoveryClass } from '../../src/core/recovery/index.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrec-'));
const sandbox = new LocalSandbox(dir);
const tools = makeTools(sandbox);

const CONTENT = 'export const a = 1;\nexport const b = 2;\n';
const rec = (args) => tools.write.recovery(args);

// ── contract shape ───────────────────────────────────────────────────────
{
  const r = rec({ path: 'x.js', content: CONTENT });
  ok('write declares SAFE_RETRY', r.class === RecoveryClass.SAFE_RETRY, r.class);
  ok('write has a content-addressed precondition', typeof r.precondition === 'string' && r.precondition.length > 0);
  ok('write exposes verify()', typeof r.verify === 'function');
}

// ── Case 1: the write did NOT happen ─────────────────────────────────────
{
  const r = rec({ path: 'absent.js', content: CONTENT });
  ok('Case 1 (never written) -> not-applied', r.verify() === 'not-applied', r.verify());
}

// ── Case 2: the write COMPLETED ──────────────────────────────────────────
{
  sandbox.write('done.js', CONTENT);
  const r = rec({ path: 'done.js', content: CONTENT });
  ok('Case 2 (completed) -> applied', r.verify() === 'applied', r.verify());
}

// ── Case 3: PARTIAL write (crash mid-write) ──────────────────────────────
{
  // Simulate a torn write: the file exists but holds a prefix of the intended content.
  sandbox.write('partial.js', CONTENT.slice(0, 12));
  const r = rec({ path: 'partial.js', content: CONTENT });
  const v = r.verify();
  ok('Case 3 (partial) -> not-applied (retry is safe)', v === 'not-applied', v);
  // The important property: retrying converges, because the write is whole-content.
  tools.write.run({ path: 'partial.js', content: CONTENT });
  ok('  retry after a partial write converges to applied', r.verify() === 'applied');
}

// ── Case 4: the file CHANGED between read and write ──────────────────────
{
  sandbox.write('changed.js', CONTENT);
  // Someone else (or an earlier turn) modified the file after the model read it.
  sandbox.write('changed.js', CONTENT + 'export const c = 3;\n');
  const r = rec({ path: 'changed.js', content: CONTENT });
  const v = r.verify();
  ok('Case 4 (changed underneath) -> not-applied', v === 'not-applied', v);
  // THE RISK: verify() says not-applied, so a recovering worker retries, and the retry
  // OVERWRITES the third-party change. write cannot distinguish "my write did not land"
  // from "my write landed and someone else then changed the file".
  tools.write.run({ path: 'changed.js', content: CONTENT });
  const after = sandbox.read('changed.js');
  ok('  retry silently discards the concurrent change (measured, not fixed)',
     !after.includes('export const c = 3;'),
     'if this ever fails, write gained lost-update protection');
}

// ── the asymmetry with edit ──────────────────────────────────────────────
{
  // edit is SELF_VERIFYING: its precondition is the OLD bytes, so a replay rejects itself.
  sandbox.write('cmp.js', CONTENT);
  const e = tools.edit.recovery({ path: 'cmp.js', old_string: 'const a = 1;', new_string: 'const a = 9;' });
  ok('edit declares SELF_VERIFYING', e.class === RecoveryClass.SELF_VERIFYING, e.class);
  ok('edit before applying -> not-applied', e.verify() === 'not-applied', e.verify());
  tools.edit.run({ path: 'cmp.js', old_string: 'const a = 1;', new_string: 'const a = 9;' });
  ok('edit after applying -> applied', e.verify() === 'applied', e.verify());
  // A second identical edit CANNOT re-apply: the precondition is gone.
  let threw = false;
  try { tools.edit.run({ path: 'cmp.js', old_string: 'const a = 1;', new_string: 'const a = 9;' }); }
  catch { threw = true; }
  ok('edit replay is self-rejecting (precondition consumed)', threw);
}

// ── unknown is reachable, not collapsed into a guess ─────────────────────
{
  const r = rec({ path: 'a-directory', content: CONTENT });
  fs.mkdirSync(path.join(dir, 'a-directory'), { recursive: true });
  const v = r.verify();
  ok('unreadable target -> unknown (not a false not-applied)', v === 'unknown', v);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nwriterecovery: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
