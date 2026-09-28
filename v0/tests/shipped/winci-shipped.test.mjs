// FIX-winci — SHIPPED: `ORION_SANDBOX=container orionctl run` against a Windows-container daemon
// must refuse fail-closed with an actionable message, never fall back to local, and never reach
// `docker run` (where CI died on "Windows does not support PidsLimit").
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installFakeRuntimes } from '../_helpers/fake-docker.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'src', 'cli', 'index.mjs');
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `winci-${tag}-`));

function orionctl(args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 120_000, env });
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), status: r.status };
}

for (const want of ['container', 'docker']) {
  describe(`shipped/winci: ORION_SANDBOX=${want} with a Windows-container docker refuses`);
  const fk = installFakeRuntimes({ docker: 'windows', podman: 'dead' });
  const home = mk('home'), work = mk('ws');
  const env = fk.env({ ...process.env, ORION_HOME: home, ORION_WORKSPACE: work,
    ORION_SANDBOX: want, ORION_BASE_URL: 'http://127.0.0.1:9/v1', ORION_MODEL: 'test-model' });
  const p = orionctl(['run', 'echo hi'], env);
  const calls = fk.calls();
  eq('exits 2 (fail-closed refusal)', p.status, 2, p.out.slice(0, 300));
  check('message names Windows containers as the reason', /windows container/i.test(p.out), p.out.slice(0, 300));
  check('message is actionable: switch Docker Desktop to Linux containers',
    /linux containers/i.test(p.out), p.out.slice(0, 300));
  check('never attempted `docker run` (no PidsLimit crash path)',
    !calls.some((c) => c.args[0] === 'run'), JSON.stringify(calls.map((c) => c.args[0])));
  check('did not fall back to local (no PidsLimit error, no run started)',
    !/PidsLimit/.test(p.out) && !/LocalSandbox/.test(p.out), p.out.slice(0, 300));
  fk.cleanup();
}

describe('shipped/winci GUARD: a Linux-container docker is accepted by the CLI wiring');
{
  const fk = installFakeRuntimes({ docker: 'linux', podman: 'dead' });
  const env = fk.env({ ...process.env, ORION_HOME: mk('home'), ORION_WORKSPACE: mk('ws'),
    ORION_SANDBOX: 'container', ORION_BASE_URL: 'http://127.0.0.1:9/v1', ORION_MODEL: 'test-model' });
  const p = orionctl(['run', 'echo hi'], env);
  check('no "no usable container runtime" refusal for a linux engine',
    !/no (usable )?container runtime/i.test(p.out), p.out.slice(0, 300));
  fk.cleanup();
}

process.exit(summary('shipped/winci') ? 1 : 0);
