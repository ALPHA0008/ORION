// Child process entry point. Used by the REAL-KILL test: the parent spawns this,
// then SIGKILLs it mid-run. Nothing is shared but the SQLite file.
import path from 'node:path';
import { Store, LocalSandbox, makeTools, makeAuthorizer } from './harness.mjs';
import { Worker } from './worker.mjs';
import { model } from './scenario.mjs';

const [, , dbPath, sandboxDir, runId, mode, killAfterMs] = process.argv;
const store = new Store(dbPath);
const sandbox = new LocalSandbox(sandboxDir);
const tools = makeTools(sandbox);
const authorize = makeAuthorizer(mode === 'escalate' ? { escalateTools: ['ask_user', 'bash'] } : {});

// If asked, die abruptly mid-flight (simulates power loss, OOM kill, SIGKILL).
if (killAfterMs && Number(killAfterMs) > 0) {
  setTimeout(() => process.kill(process.pid, 'SIGKILL'), Number(killAfterMs));
}
// Slow the tools down so the kill lands mid-run rather than after completion.
if (mode === 'slow') {
  for (const t of Object.values(tools)) {
    const orig = t.run;
    t.run = (args) => { const end = Date.now() + 400; while (Date.now() < end) {} return orig(args); };
  }
}

const claimed = store.claim('w_child_' + process.pid, 30_000);
const target = claimed ?? runId;
const w = new Worker(store, { sandbox, model: model(), tools, authorize, workerId: 'w_child_' + process.pid });
const state = store.events(target).some(e => e.type === 'turn.started');
const res = w.runOnce(target, state ? {} : { input: 'build the mini project' });
process.stdout.write(JSON.stringify({ runId: target, ...res }) + '\n');
store.close();
