// Part A, Q5 + Q6 — per-call attribution and pre-effect conflict for bash mutations.
//
// Q5: given bash calls A, B, C, can a specific filesystem change be tied to a specific call?
// Q6: if a third party changes the file between the worker's expectation and the effect, does the
//     runtime prevent bash from overwriting it (as ADR-011 does for `write`)?
//
// Both are answered against the real stack. No v0/src modification.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../v0/src/core/run/store.mjs';
import { LocalSandbox } from '../../v0/src/sandbox/local/index.mjs';
import { makeTools } from '../../v0/src/agent/tools/index.mjs';
import { createAuthorizer } from '../../v0/src/auth/default/index.mjs';
import { Worker } from '../../v0/src/agent/loop/worker.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(os.tmpdir(), 'attribution-probe');
const git = (a, o = {}) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });

function fixture() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  git(['init', '-q'], { cwd: ROOT });
  for (const [k, v] of [['user.email', 'p@l'], ['user.name', 'p'], ['core.autocrlf', 'false']])
    git(['config', k, v], { cwd: ROOT });
  fs.writeFileSync(path.join(ROOT, 'a.py'), 'A0\n');
  fs.writeFileSync(path.join(ROOT, 'b.py'), 'B0\n');
  git(['add', '-A'], { cwd: ROOT });
  git(['commit', '-qm', 'base'], { cwd: ROOT });
}

/** A scripted model: emits the given bash commands one per turn, then finishes. */
function scriptedModel(cmds) {
  let i = 0;
  return {
    async invoke() {
      if (i < cmds.length) {
        const cmd = cmds[i++];
        return { content: '', tool_calls: [{ id: `tc_${i}`, name: 'bash', args: { cmd } }],
                 finish: false, input_tokens: 1, output_tokens: 1 };
      }
      return { content: 'done', tool_calls: [], finish: true, input_tokens: 1, output_tokens: 1 };
    },
  };
}

// ── Q5: per-call attribution ─────────────────────────────────────────────────
async function attribution() {
  fixture();
  const store = new Store(path.join(ROOT, '.probe.db'));
  const sandbox = new LocalSandbox(ROOT);
  const tools = makeTools(sandbox);
  const runId = uid('run');
  store.createRun(runId, { task: 'attribution' });
  const lease = store.claim('probe', { runId, leaseMs: 120_000 });

  const cmds = [
    `echo A1 > a.py`,        // call 1 mutates a.py
    `echo NOOP_READ`,        // call 2 mutates nothing
    `echo B1 > b.py`,        // call 3 mutates b.py
  ];
  const worker = new Worker(store, {
    sandbox, tools, model: scriptedModel(cmds),
    authorize: createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false }),
    workerId: 'probe', maxTurns: 10, leaseMs: 120_000,
  });
  await worker.run(runId, lease.leaseToken, { input: 'probe' });

  const ev = store.events(runId);
  const started = ev.filter(e => e.type === 'tool.started');
  const succeeded = ev.filter(e => e.type === 'tool.succeeded');

  // What does the event log record about WHICH FILES each call touched?
  const perCall = started.map(e => {
    const ok = succeeded.find(s => s.payload.tool_call_id === e.payload.tool_call_id);
    return {
      tool_call_id: e.payload.tool_call_id,
      cmd: String(e.payload.args?.cmd ?? '').slice(0, 40),
      // The decisive question: is there ANY field naming the files affected?
      payload_keys_started: Object.keys(e.payload),
      payload_keys_succeeded: ok ? Object.keys(ok.payload) : null,
      names_files: /files|paths|mutated|diff/i.test(JSON.stringify(e.payload) + JSON.stringify(ok?.payload ?? {})),
    };
  });
  const finalDiff = git(['-C', ROOT, 'status', '--porcelain']).trim();
  store.close();
  return { calls: perCall, final_diff: finalDiff,
           per_call_attribution: perCall.some(c => c.names_files) ? 'PRESENT' : 'ABSENT' };
}

// ── Q6: pre-effect conflict ──────────────────────────────────────────────────
/**
 * Does bash refuse to overwrite a file a third party changed after the worker last observed it?
 * `write` does (ADR-011 §4). The comparison is what matters, not bash's result alone.
 */
function conflict() {
  fixture();
  const sandbox = new LocalSandbox(ROOT);
  const tools = makeTools(sandbox);
  const p = path.join(ROOT, 'a.py');

  // --- bash arm ---
  const witnessBash = typeof tools.bash.captureWitness === 'function'
    ? tools.bash.captureWitness({ cmd: `echo AGENT > a.py` }) : null;
  fs.writeFileSync(p, 'THIRD_PARTY\n');            // concurrent change AFTER any witness
  let bashRefused = false, bashErr = null;
  try { tools.bash.run({ cmd: `echo AGENT > a.py` }); }
  catch (e) { bashRefused = true; bashErr = String(e.message).slice(0, 100); }
  const bashFinal = fs.readFileSync(p, 'utf8').trim();

  // --- write arm, same scenario ---
  fs.writeFileSync(p, 'A0\n');
  const wArgs = { path: 'a.py', content: 'AGENT\n' };
  const w = tools.write.captureWitness(wArgs);      // worker captures witness here
  fs.writeFileSync(p, 'THIRD_PARTY\n');             // concurrent change AFTER the witness
  let writeRefused = false, writeErr = null;
  try { tools.write.run({ ...wArgs, ...(w || {}) }); }
  catch (e) { writeRefused = true; writeErr = String(e.message).slice(0, 100); }
  const writeFinal = fs.readFileSync(p, 'utf8').trim();

  return {
    bash: { captures_witness: !!witnessBash, refused: bashRefused, error: bashErr,
            final_content: bashFinal, third_party_change_preserved: bashFinal === 'THIRD_PARTY' },
    write: { captures_witness: !!w, refused: writeRefused, error: writeErr,
             final_content: writeFinal, third_party_change_preserved: writeFinal === 'THIRD_PARTY' },
  };
}

const attr = await attribution();
const conf = conflict();
const dir = path.join(HERE, 'results');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'attribution-conflict.json'),
  JSON.stringify({ at: new Date().toISOString(), attribution: attr, conflict: conf }, null, 2));

console.log('=== Q5 per-call attribution ===');
for (const c of attr.calls)
  console.log(`  ${c.tool_call_id.padEnd(8)} ${c.cmd.padEnd(24)} names_files=${c.names_files}`);
console.log('  started payload keys  :', attr.calls[0]?.payload_keys_started?.join(', '));
console.log('  succeeded payload keys:', attr.calls[0]?.payload_keys_succeeded?.join(', '));
console.log('  PER_CALL_MUTATION_ATTRIBUTION =', attr.per_call_attribution);
console.log('  final workspace diff  :', JSON.stringify(attr.final_diff));

console.log('\n=== Q6 pre-effect conflict (third party changed the file) ===');
console.log('  bash : refused=' + conf.bash.refused + '  third-party change preserved=' + conf.bash.third_party_change_preserved
  + '  final=' + JSON.stringify(conf.bash.final_content));
console.log('  write: refused=' + conf.write.refused + '  third-party change preserved=' + conf.write.third_party_change_preserved
  + '  final=' + JSON.stringify(conf.write.final_content));
if (conf.write.error) console.log('  write refusal:', conf.write.error);
console.log(`\nwrote ${path.join(dir, 'attribution-conflict.json')}`);
