// FIX-winci — a daemon that ANSWERS but runs WINDOWS containers is not a usable runtime.
//
// GitHub windows-latest ships Docker in Windows-container mode. `detectRuntime` only asked
// "does the daemon answer?", so every container suite proceeded and died on
// `invalid option: Windows does not support PidsLimit` (and a Linux image cannot run there at
// all). The fix must make detection require a LINUX-container engine; the container suites'
// skip path (`const runtime = detectRuntime(); if (!runtime) SKIP`) then engages loudly.
//
// A fake `docker` placed first on PATH answers version/info with a chosen OSType, so the REAL
// detection code path is exercised with no real daemon, on Windows and Linux alike.
import { detectRuntime } from '../../src/sandbox/container/index.mjs';
import { installFakeRuntimes, withProcessEnv } from '../_helpers/fake-docker.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

describe('winci: fake runtime sanity (the instrument itself)');
{
  const fk = installFakeRuntimes({ docker: 'windows', podman: 'dead' });
  // Proving the fake is reachable by bare name: a daemon that answers is at least tried.
  withProcessEnv(fk.env(), () => detectRuntime({ candidates: ['docker'] }));
  const calls = fk.calls();
  check('detection actually invoked the fake docker (instrument reachable)',
    calls.some((c) => c.bin === 'docker' && c.args[0] === 'version'), JSON.stringify(calls).slice(0, 200));
  fk.cleanup();
}

describe('winci: a Windows-container daemon is NOT a usable runtime');
{
  const fk = installFakeRuntimes({ docker: 'windows', podman: 'dead' });
  const rt = withProcessEnv(fk.env(), () => detectRuntime({ candidates: ['docker'] }));
  eq('detectRuntime({candidates:[docker]}) -> null when OSType=windows', rt, null);
  const calls = fk.calls();
  check('...and detection never tried to `docker run` anything',
    !calls.some((c) => c.args[0] === 'run'), JSON.stringify(calls).slice(0, 200));
  fk.cleanup();
}

describe('winci: the container suites\' skip helper (bare detectRuntime()) reports no runtime');
{
  // Every container suite (sandbox, limits, network-live, crash/matrix-container, w6-shipped,
  // mcp/live) gates on `detectRuntime()` with DEFAULT candidates. Under a windows-mode docker and
  // a dead podman it must return null so they SKIP loudly instead of crashing on PidsLimit.
  const fk = installFakeRuntimes({ docker: 'windows', podman: 'dead' });
  const rt = withProcessEnv(fk.env(), () => detectRuntime());
  eq('default detectRuntime() -> null (suites take their SKIPPED branch)', rt, null);
  fk.cleanup();
}

describe('winci: podman is still chosen when docker is windows-mode but podman is linux');
{
  const fk = installFakeRuntimes({ docker: 'windows', podman: 'linux' });
  const rt = withProcessEnv(fk.env(), () => detectRuntime());
  eq('falls through the windows docker to the linux podman', rt, 'podman');
  fk.cleanup();
}

describe('winci GUARD: a Linux-container daemon is still detected');
{
  const fk = installFakeRuntimes({ docker: 'linux', podman: 'dead' });
  const rt = withProcessEnv(fk.env(), () => detectRuntime());
  eq('OSType=linux -> docker', rt, 'docker');
  fk.cleanup();
}

describe('winci GUARD: a dead daemon is still not a runtime');
{
  const fk = installFakeRuntimes({ docker: 'dead', podman: 'dead' });
  const rt = withProcessEnv(fk.env(), () => detectRuntime());
  eq('dead docker + dead podman -> null', rt, null);
  fk.cleanup();
}

process.exit(summary('sandbox/wincontainers') ? 1 : 0);
