// Child process: run an agent turn, and SIGKILL itself at a named crash point.
// The crash point is a hook marker fired by the Worker (see worker.mjs #hook).
import path from 'node:path';
import { Store } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { makeScriptModel } from './script-model.mjs';

const [, , dbPath, workDir, runId, crashPoint, nthStr, mode] = process.argv;
const nth = Number(nthStr || 1);

const store = new Store(dbPath);
const sandbox = new LocalSandbox(workDir);
const tools = makeTools(sandbox);
const authorize = createAuthorizer(
  mode === 'escalate' ? { escalateTools: ['bash'] } :
  mode === 'deny'     ? { denyTools: ['edit'] } : {});

const counters = Object.create(null);
const hooks = crashPoint && crashPoint !== 'none' ? {
  beforeAppend(marker) {
    if (marker !== crashPoint) return;
    counters[marker] = (counters[marker] || 0) + 1;
    if (counters[marker] === nth) {
      process.stdout.write(JSON.stringify({ crashed_at: marker, nth }) + '\n');
      process.kill(process.pid, 'SIGKILL');
    }
  },
} : {};

const claimed = store.claim('w_' + process.pid, { leaseMs: 30_000, runId });
if (!claimed) { process.stdout.write(JSON.stringify({ status: 'no-claim' }) + '\n'); process.exit(0); }

const started = store.events(runId).some(e => e.type === 'turn.started');
const w = new Worker(store, { sandbox, model: makeScriptModel(), tools, authorize,
  workerId: 'w_' + process.pid, hooks, maxTurns: 25 });
const res = await w.run(runId, claimed.leaseToken, started ? {} : { input: 'build the mini project' });
process.stdout.write(JSON.stringify(res) + '\n');
store.close();
