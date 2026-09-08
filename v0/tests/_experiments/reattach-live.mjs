// Does a REAL container survive the process that made it, and get reattached by identity?
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Store, uid } from '../../src/core/run/store.mjs';
import { ContainerSandbox } from '../../src/sandbox/container/index.mjs';
import { resolveResource, releaseResource } from '../../src/core/resource/index.mjs';
import { projectResources } from '../../src/core/projection/resource.mjs';

const phase = process.argv[2];
const dir = process.argv[3];
const ws = path.join(dir, 'work');
const st = new Store(path.join(dir, 'r.db'));
const runIdFile = path.join(dir, 'runid');

if (phase === 'start') {
  const runId = uid('run');
  fs.writeFileSync(runIdFile, runId);
  st.createRun(runId, { task: 'reattach proof' });
  const c = st.claim('w1', { runId, leaseMs: 60_000 });
  const sb = new ContainerSandbox(ws, { execTimeoutMs: 30_000 });
  const r = await resolveResource({ store: st, runId, backend: sb, leaseToken: c.leaseToken, env: {} });
  // Write a marker INSIDE the container's own filesystem (not the bind mount), so only the
  // ORIGINAL container can prove it is the same one.
  await sb.exec('echo original-container > /marker-in-container');
  console.log(JSON.stringify({ phase:'start', resolution:r.resolution, posture:r.posture,
    resource_id:r.resource_id, container:sb.containerName, id:sb.containerId.slice(0,12) }));
} else {
  const runId = fs.readFileSync(runIdFile, 'utf8');
  const c = st.claim('w2', { runId, leaseMs: 60_000, now: Date.now() + 120_000 });
  // A brand-new backend object with a DIFFERENT invented name — exactly what a resumed process has.
  const sb2 = new ContainerSandbox(ws, { execTimeoutMs: 30_000 });
  const invented = sb2.containerName;
  const r = await resolveResource({ store: st, runId, backend: sb2, leaseToken: c.leaseToken, env: {} });
  let marker = null;
  try { marker = (await sb2.exec('cat /marker-in-container')).trim(); } catch (e) { marker = 'ERR ' + e.kind; }
  console.log(JSON.stringify({ phase:'resume', resolution:r.resolution, posture:r.posture,
    inventedName: invented, boundTo: sb2.containerName, markerInsideContainer: marker,
    sameContainer: marker === 'original-container' }));
  const proj = projectResources(st.events(runId));
  console.log(JSON.stringify({ events: st.events(runId).filter(e=>e.type.startsWith('resource.')).map(e=>e.type),
    reattach_count: proj.current.reattach_count, reconstructed: proj.current.reconstructed }));
  await releaseResource({ store: st, runId, backend: sb2, leaseToken: c.leaseToken });
}
st.close();
