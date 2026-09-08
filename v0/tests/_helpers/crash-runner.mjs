// Child process: run an agent turn, and SIGKILL itself at a named crash point.
// The crash point is a hook marker fired by the Worker (see worker.mjs #hook).
import path from 'node:path';
import { Store } from '../../src/core/run/store.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
// W6 J: the SAME matrix must run under the isolation boundary. Selected by env so the crash
// points, the script model and every recovery assertion stay byte-identical between the two —
// a container-specific runner would prove the container, not that the boundary changed nothing.
import { ContainerSandbox } from '../../src/sandbox/container/index.mjs';
import { resolveResource } from '../../src/core/resource/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { makeScriptModel } from './script-model.mjs';

const [, , dbPath, workDir, runId, crashPoint, nthStr, mode] = process.argv;
const nth = Number(nthStr || 1);

const store = new Store(dbPath);
const useContainer = process.env.CRASH_BACKEND === 'container';
const sandbox = useContainer
  ? new ContainerSandbox(workDir, { execTimeoutMs: 30_000,
      // A deterministic name derived from the workspace, so a resumed child process finds the
      // container its predecessor was killed holding. Without this, reattachment after SIGKILL
      // would be impossible in principle rather than merely untested.
      containerName: 'orion-crash-' + Buffer.from(workDir).toString('hex').slice(-16) })
  : new LocalSandbox(workDir);
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

// W6 C/D/I: bind the resource — acquire on the first run, reattach after a crash. Under the
// local backend this is a directory probe; under the container it is a real reattachment to a
// container that outlived the process SIGKILL'd while holding it.
await resolveResource({
  store, runId, backend: sandbox, leaseToken: claimed.leaseToken, env: {},
});

const started = store.events(runId).some(e => e.type === 'turn.started');
const w = new Worker(store, { sandbox, model: makeScriptModel(), tools, authorize,
  workerId: 'w_' + process.pid, hooks, maxTurns: 25 });
const res = await w.run(runId, claimed.leaseToken, started ? {} : { input: 'build the mini project' });
process.stdout.write(JSON.stringify(res) + '\n');
store.close();
