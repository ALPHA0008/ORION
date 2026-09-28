// W6.1 PROOF 2 — the container's resource limits actually BIND.
//
// WHY THIS EXISTS
//
// Wave 6 passed `--cpus`, `--memory` and `--pids-limit` to the runtime and asserted that the
// container started. Its own §11.4 recorded the gap honestly: "limits are set but not measured".
// That gap sits directly under W6-K. Auto-allow is justified by the claim that a command's blast
// radius is the sandbox rather than the host — and an unmeasured limit is the difference between
// "a runaway tool call is contained" and "a runaway tool call pins the developer's machine". It is
// the load-bearing property autonomy pays for, so it has to be measured, not requested.
//
// WHAT IS ASSERTED, ON TWO INDEPENDENT CHANNELS
//
//   1. The KERNEL applied the limit — read from cgroup v2 inside the container (`cpu.max`,
//      `memory.max`, `pids.max`). This proves the flag reached the kernel rather than being
//      accepted and dropped by the CLI.
//   2. The limit BITES under load — measured behaviour: CPU capped while six busy loops run on a
//      many-core host, an over-allocation OOM-killed, forks refused past the cap.
//
// Either alone would be weak. The cgroup read could show a limit nothing enforces; the behaviour
// alone could be a coincidence of the environment. Together they say the limit exists and works.
//
// THE LIMITS ARE THE SHIPPED DEFAULTS. `ContainerSandbox` is constructed the way the CLI
// constructs it — cpus 1.0, memory 512m, pidsLimit 256 — deliberately NOT tuned to make the test
// easier. Only `execTimeoutMs` is raised, because a deliberately runaway command needs longer than
// the 15s default to be observed being stopped; that is a harness concern, not a limit.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ContainerSandbox, detectRuntime, pruneOrionContainers, listOrionContainers }
  from '../../src/sandbox/container/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const execFile = promisify(execFileCb);

// cgroup LAYOUT. Docker Desktop on WSL2 may run cgroup v1 (P0 triage, ledger P0-07). The limits
// are the same kernel facts under different file names, so each layout gets its own EXACT
// assertions; an unrecognised layout is a loud SKIP-with-reason, never a green pass.
const CG = {
  v2: { cpu: '/sys/fs/cgroup/cpu.max', mem: '/sys/fs/cgroup/memory.max',
        pids: '/sys/fs/cgroup/pids.max', pidsCurrent: '/sys/fs/cgroup/pids.current',
        pidsEvents: '/sys/fs/cgroup/pids.events', memEvents: '/sys/fs/cgroup/memory.events' },
  v1: { cpuQuota: '/sys/fs/cgroup/cpu/cpu.cfs_quota_us', cpuPeriod: '/sys/fs/cgroup/cpu/cpu.cfs_period_us',
        mem: '/sys/fs/cgroup/memory/memory.limit_in_bytes',
        pids: '/sys/fs/cgroup/pids/pids.max', pidsCurrent: '/sys/fs/cgroup/pids/pids.current',
        pidsEvents: '/sys/fs/cgroup/pids/pids.events', memEvents: '/sys/fs/cgroup/memory/memory.oom_control' },
};
async function cgroupLayout(sb) {
  try {
    const out = (await sb.exec('if [ -f /sys/fs/cgroup/cgroup.controllers ]; then echo v2; '
      + 'elif [ -f /sys/fs/cgroup/cpu/cpu.cfs_quota_us ]; then echo v1; else echo unknown; fi')).trim();
    return out === 'v2' || out === 'v1' ? out : 'unknown';
  } catch { return 'unknown'; }
}
function skipUnknownLayout(what) {
  check(`SKIPPED — ${what} UNPROVEN: unknown cgroup layout`, true,
    'neither cgroup v2 nor v1 files found in the container; the report must say so');
  console.log(`\n  limits: ${what} UNPROVEN: unknown cgroup layout\n`);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const runtime = detectRuntime();
// Containers already present before this suite ran. Everything here removes ONLY what it
// created, so a concurrent run against the same daemon is never collateral damage.
const preexisting = new Set(runtime ? await listOrionContainers({ runtime }) : []);

describe('limits/PROOF-2: the container resource limits bind');

if (!runtime) {
  // Loud skip, never a green pass (plan §11.4).
  check('SKIPPED — no container runtime (docker/podman) available', true,
    'the limits claim is UNPROVEN on this machine; the report must say so');
  console.log('\n  limits/PROOF-2: SKIPPED — no container runtime\n');
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w61-limits-'));
  // Shipped defaults for every limit. Only the exec timeout is raised.
  const sb = new ContainerSandbox(path.join(dir, 'work'), { runtime, execTimeoutMs: 120_000 });

  eq('the shipped default cpu quota', sb.limits.cpus, '1.0');
  eq('the shipped default memory limit', sb.limits.memory, '512m');
  eq('the shipped default pids limit', sb.limits.pidsLimit, 256);
  check('...and they are declared in the capabilities', !!sb.capabilities.limits);

  await sb.acquire();
  const name = sb.containerName;
  /** Host-side view of the container, which the container itself cannot forge. */
  const stats = async (fmt) => (await execFile(runtime,
    ['stats', '--no-stream', '--format', fmt, name], { encoding: 'utf8', timeout: 60_000 })).stdout.trim();
  const inspect = async (fmt) => (await execFile(runtime,
    ['inspect', '--format', fmt, name], { encoding: 'utf8', timeout: 60_000 })).stdout.trim();

  try {
    // ── channel 1: the kernel applied the limits ────────────────────────────
    const layout = await cgroupLayout(sb);
    console.log(`  cgroup layout: ${layout}`);
    // A read failure is a FAILED assertion for this channel, never a suite crash: channels 2+
    // must still run.
    const read = async (p) => {
      try { return (await sb.exec(`cat ${p}`)).trim(); }
      catch (e) { check(`read ${p}`, false, e?.message ?? String(e)); return ''; }
    };
    if (layout === 'v2') {
      const cpuMax = await read(CG.v2.cpu);
      const memMax = await read(CG.v2.mem);
      const pidMax = await read(CG.v2.pids);

      // cgroup v2 `cpu.max` is "<quota> <period>". 1.0 CPU = quota equal to period.
      const [quota, period] = cpuMax.split(/\s+/).map(Number);
      check('cgroup cpu.max is a real quota, not "max"', Number.isFinite(quota), cpuMax);
      eq('...equal to 1.0 CPU (quota == period)', quota, period);
      eq('cgroup memory.max is 512MiB', Number(memMax), 512 * 1024 * 1024);
      eq('cgroup pids.max is 256', Number(pidMax), 256);
    } else if (layout === 'v1') {
      // cgroup v1: cfs_quota_us -1 = unlimited, pids.max "max" = unlimited — both FAIL below.
      const quotaRaw = await read(CG.v1.cpuQuota);
      const quota = Number(quotaRaw);
      const period = Number(await read(CG.v1.cpuPeriod));
      const memMax = await read(CG.v1.mem);
      const pidMax = await read(CG.v1.pids);
      check('cgroup v1 cpu.cfs_quota_us is a real quota, not -1',
        Number.isFinite(quota) && quota > 0, quotaRaw);
      eq('...equal to 1.0 CPU (quota == period)', quota, period);
      eq('cgroup v1 memory.limit_in_bytes is 512MiB', Number(memMax), 512 * 1024 * 1024);
      eq('cgroup v1 pids.max is 256', Number(pidMax), 256);
    } else {
      skipUnknownLayout('limits channel 1');
    }

    // ── channel 2a: CPU — the quota caps real load ──────────────────────────
    //
    // SIX busy loops on a host with many cores. Unlimited, this would measure ~600%; the
    // container is capped at 1.0 CPU, so it must stay at ~100%. That gap is what makes this a
    // measurement rather than a formality — a broken quota could not accidentally pass.
    const cores = os.cpus().length;
    check('the host has enough cores for this to be a real test', cores >= 4, `${cores} cores`);

    await sb.exec('for i in 1 2 3 4 5 6; do (while :; do :; done) & done; echo started');
    await new Promise(r => setTimeout(r, 4_000));   // let the scheduler settle

    const samples = [];
    for (let i = 0; i < 5; i++) {
      const pct = Number(String(await stats('{{.CPUPerc}}')).replace('%', ''));
      if (Number.isFinite(pct)) samples.push(pct);
      await new Promise(r => setTimeout(r, 600));
    }
    const peak = Math.max(...samples);
    // Kill the load before asserting, so a failure cannot leave the host pinned.
    await sb.exec('pkill -f "while :" 2>/dev/null; kill -9 -1 2>/dev/null; true').catch(() => {});

    check('CPU usage was actually sampled', samples.length >= 3, JSON.stringify(samples));
    check('six busy loops did NOT exceed the 1.0-CPU quota',
      peak <= 150, `peak ${peak}% across ${JSON.stringify(samples)} on a ${cores}-core host`);
    check('...and the load was real (not silently absent)', peak >= 50,
      `peak ${peak}% — below this the loops never ran and the test would be vacuous`);
  } finally {
    await sb.release();
  }

  // ── channel 2b: MEMORY — over-allocation is killed, not tolerated ────────
  {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'w61-mem-'));
    const mem = new ContainerSandbox(path.join(d2, 'work'), { runtime, execTimeoutMs: 120_000 });
    await mem.acquire();
    try {
      // `tail /dev/zero` reads an endless stream into its own heap — anonymous memory, which is
      // what the cgroup limit governs. (A `dd` to /dev/shm would hit docker's separate 64MB shm
      // cap instead and prove nothing about `--memory`.)
      let err = null;
      try { await mem.exec('tail /dev/zero'); } catch (e) { err = e; }

      check('an over-allocation FAILED rather than succeeding', err !== null,
        'if this passes, 512m did not bind');
      eq('...classified as a nonzero exit', err?.kind, 'nonzero_exit');
      eq('...with exit 137 (SIGKILL — the OOM killer)', err?.exitCode, 137);

      // The runtime's own record, which the container cannot forge.
      const oom = (await execFile(runtime, ['inspect', '--format', '{{.State.OOMKilled}}', mem.containerName],
        { encoding: 'utf8', timeout: 60_000 })).stdout.trim();
      eq('the runtime recorded an OOM kill', oom, 'true');

      // And the kernel's counter (v2 memory.events "oom N"; v1 memory.oom_control "oom_kill N").
      const memLayout = await cgroupLayout(mem);
      if (memLayout === 'unknown') {
        skipUnknownLayout('limits channel 2b kernel OOM counter');
      } else {
        let events = '';
        try { events = await mem.exec(`cat ${CG[memLayout].memEvents}`); }
        catch (e) { events = `read failed: ${e?.message ?? e}`; }
        const re = memLayout === 'v2' ? /^oom (\d+)$/m : /^oom_kill (\d+)$/m;
        const oomCount = Number(re.exec(events)?.[1] ?? 0);
        check(`the cgroup (${memLayout}) counted at least one OOM`, oomCount >= 1,
          events.replace(/\s+/g, ' '));
      }

      // NOT business as usual: the container survived, only the runaway process died. That is the
      // containment property — a bad tool call must not take the resource down with it.
      const running = (await execFile(runtime, ['inspect', '--format', '{{.State.Running}}', mem.containerName],
        { encoding: 'utf8', timeout: 60_000 })).stdout.trim();
      eq('the container itself survived the OOM', running, 'true');
      const stillWorks = await mem.exec('echo alive');
      eq('...and is still usable afterwards', stillWorks.trim(), 'alive');
    } finally {
      await mem.release();
    }
  }

  // ── channel 2c: PIDS — forks are refused past the cap ────────────────────
  {
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'w61-pids-'));
    const pids = new ContainerSandbox(path.join(d3, 'work'), { runtime, execTimeoutMs: 120_000 });
    await pids.acquire();
    const pidLayout = await cgroupLayout(pids);
    try {
      if (pidLayout === 'unknown') { skipUnknownLayout('limits channel 2c'); } else {
      const P = CG[pidLayout];
      // 400 spawn attempts against a 256 cap. The interesting numbers are read from the kernel
      // afterwards rather than inferred from the shell's exit status, because a shell that cannot
      // fork often reports success for the statement that failed.
      const out = await pids.exec(
        'i=0; while [ $i -lt 400 ]; do (sleep 20 &) 2>/dev/null; i=$((i+1)); done; '
        + `echo "current=$(cat ${P.pidsCurrent})"; `
        + `echo "max=$(cat ${P.pids})"; `
        + `cat ${P.pidsEvents}`);

      const current = Number(/current=(\d+)/.exec(out)?.[1] ?? -1);
      const max = Number(/max=(\d+)/.exec(out)?.[1] ?? -1);
      const denied = Number(/^max (\d+)$/m.exec(out)?.[1] ?? 0);

      eq('the cap is the shipped 256', max, 256);
      check('the process count NEVER exceeded the cap', current > 0 && current <= max,
        `current=${current} max=${max}`);
      // The decisive number: `pids.events: max N` counts fork attempts the kernel REFUSED. Zero
      // would mean 400 spawns fitted under a 256 cap, which is impossible — so a zero here means
      // the load never happened and the assertion above is vacuous.
      check('the kernel actually REFUSED forks past the cap', denied >= 1,
        `pids.events max=${denied} (fork denials); out: ${out.replace(/\s+/g, ' ').slice(0, 120)}`);
      check('...and it refused many, not one', denied >= 10, `${denied} denials`);
      }
    } finally {
      await pids.release();
    }
  }

  // Remove ONLY the containers this suite created. A blanket prune would delete a container
  // belonging to anything else running against the same daemon — which is exactly how the
  // first full-suite run of W6.1 killed a concurrently-running gate and reported a crash
  // that looked like a product defect.
  await pruneOrionContainers({ runtime, keep: preexisting });
}

process.exit(summary('limits', path.join(HERE, '..', 'results-limits.json')) ? 1 : 0);
