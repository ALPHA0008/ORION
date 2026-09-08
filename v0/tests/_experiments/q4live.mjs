import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';
import { ContainerSandbox } from '../../src/sandbox/container/index.mjs';
import { attachCheckpoints } from '../../src/sandbox/local/index.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q4live-'));
const ws = path.join(dir, 'work');
const sb = new ContainerSandbox(ws, { execTimeoutMs: 30_000 });
console.log('capabilities:', JSON.stringify(sb.capabilities));

const acq = await sb.acquire();
console.log('acquired:', acq.name, acq.containerId.slice(0, 12));
try {
  // 1. Host writes, container reads — same bytes?
  sb.write('math.js', 'export const add = (a,b) => a - b;\n');
  const hostSha = crypto.createHash('sha256').update(sb.read('math.js')).digest('hex');
  const contSha = (await sb.exec('sha256sum math.js')).trim().split(/\s+/)[0];
  console.log('host sha :', hostSha.slice(0,16));
  console.log('cont sha :', contSha.slice(0,16));
  console.log('WITNESS IDENTICAL:', hostSha === contSha);

  // 2. Container writes, host sees it?
  await sb.exec('echo container-made > made-inside.txt');
  console.log('host sees container write:', sb.exists('made-inside.txt'), JSON.stringify(sb.read('made-inside.txt')));

  // 3. Network really off?
  let netErr = null;
  try { await sb.exec('wget -q -T 3 -O- http://169.254.169.254/ 2>&1 || nc -z -w2 1.1.1.1 53'); }
  catch (e) { netErr = e.kind + ': ' + e.message.slice(0, 70); }
  console.log('network egress:', netErr ?? 'SUCCEEDED (BAD)');

  // 4. Host git checkpoints over the SAME workspace
  attachCheckpoints(sb, path.join(dir, 'shadow.git'));
  const c1 = sb.snapshot('before');
  await sb.exec("sed -i 's/a - b/a + b/' math.js");
  console.log('container edited file:', sb.read('math.js').trim());
  const c2 = sb.snapshot('after');
  sb.restore(c1);
  console.log('after host restore   :', sb.read('math.js').trim());
  console.log('CHECKPOINTS WORK ACROSS THE BOUNDARY:', sb.read('math.js').includes('a - b'), '| commits:', sb.checkpoints().length);

  // 5. Taxonomy preserved
  let k = null; try { await sb.exec('exit 7'); } catch (e) { k = e.kind + '/' + e.exitCode; }
  console.log('nonzero taxonomy:', k);
} finally {
  console.log('release:', JSON.stringify(await sb.release()));
}
