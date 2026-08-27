// Child process for real-model crash tests. Claims a run and works it with the REAL model.
// Killed by the PARENT via SIGKILL — never self-killed (a busy child cannot fire its own timer).
import path from 'node:path';
import { Store } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { createOpenAICompatModel } from '../../src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../src/agent/model/shims/gemma-tool-calls.mjs';

const [, , dbPath, workDir, runId, task, mode] = process.argv;

const store = new Store(dbPath);
const sandbox = new LocalSandbox(workDir);
const tools = makeTools(sandbox);

// `auto` posture escalates UNSAFE shell; `permissive` lets bash through so a crash test can
// reach a tool effect without a human in the loop.
const authorize = createAuthorizer(
  mode === 'deny-bash' ? { denyTools: ['bash'] } :
  mode === 'permissive' ? { posture: 'permissive', escalateUnsafeRecovery: false } : {});

const model = createOpenAICompatModel({
  baseUrl: process.env.HARNESS_BASE_URL, apiKey: process.env.HARNESS_API_KEY,
  model: process.env.HARNESS_MODEL, timeoutMs: 120_000, maxRetries: 2,
  shims: [applyGemmaToolCallShim],
});

const claimed = store.claim('w_' + process.pid, { leaseMs: 30_000, runId });
if (!claimed) { process.stdout.write(JSON.stringify({ status: 'no-claim' }) + '\n'); process.exit(0); }

// announce readiness so the parent can time the kill against real progress
process.stdout.write(JSON.stringify({ event: 'claimed', pid: process.pid, seq: store.lastSeq(runId) }) + '\n');

const started = store.events(runId).some(e => e.type === 'turn.started');
const w = new Worker(store, { sandbox, model, tools, authorize,
  workerId: 'w_' + process.pid, maxTurns: 14 });

try {
  const res = await w.run(runId, claimed.leaseToken, started ? {} : { input: task });
  process.stdout.write(JSON.stringify({ status: res.status, reason: res.reason, seq: store.lastSeq(runId) }) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ status: 'error', error: String(e.message) }) + '\n');
}
store.close();
