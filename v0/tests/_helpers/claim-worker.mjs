// Child process: repeatedly claim a run, do a little work, complete it. Print claims made.
import { Store } from '../../src/core/run/store.mjs';
const [, , dbPath, workerId, maxRuns] = process.argv;
const s = new Store(dbPath, { durability: 'normal' });
const claims = [];
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && claims.length < Number(maxRuns)) {
  const c = s.claim(workerId, { leaseMs: 4000 });
  if (!c) break;
  claims.push({ runId: c.runId, worker: workerId, at: Date.now() });
  // simulate a little work with a renewal in the middle
  s.append(c.runId, 'turn.started', { input: `work by ${workerId}` });
  s.renew(c.runId, c.leaseToken, { leaseMs: 4000 });
  s.append(c.runId, 'model.responded', { content: 'ok', input_tokens: 5, output_tokens: 2 });
  s.append(c.runId, 'run.completed', { reason: 'model_finished', result: 'done' });
  s.setStatus(c.runId, 'completed', { leaseToken: c.leaseToken, releaseLease: true });
}
s.close();
process.stdout.write(JSON.stringify(claims));
