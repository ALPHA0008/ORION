// W6.1 PROOF 3 — the network policy, verified against a LIVE container.
//
// WHY THIS EXISTS, AND WHAT IT FOUND
//
// Wave 6's §11.4 disclosed: "network allowlist mode is unit-tested, not exercised live". Running
// it live found something worse than an untested path — an UNENFORCED one.
//
// Measured, before the fix: with a policy allowing only `registry.npmjs.org`,
// `networkFlagsFor()` returned `[]`, so the container was started on the runtime's default bridge
// with full egress. `example.com` was reachable. The raw IP `1.1.1.1` was reachable. And
// `capabilities.network` reported `'restricted'`. Nothing in `src/` ever called `policy.check()`,
// so the allowlist was a data structure no code consulted.
//
// A backend that declares a restriction it does not provide is a capability LIE, and the backend
// contract treats that as a security bug rather than a documentation one — a declaration is what
// posture and operator trust are built on. So the fix fails CLOSED: a mode the backend cannot
// enforce is refused at construction, which is wiring time.
//
// WHAT THIS PROVES, AND WHAT IT CANNOT
//
// It proves the shipped default is a real boundary: `--network none` denies egress live, including
// every hard-block target. It proves an unenforceable policy is now refused rather than silently
// granting the internet.
//
// It does NOT prove "an allowed destination succeeds", because there is no enforcement mechanism
// for a per-domain allowlist to succeed against. Building one (an egress proxy on an `--internal`
// network, or in-container firewall rules needing NET_ADMIN) is a mechanism W6 did not build and
// this hardening wave is not the place to add. That is stated in the report as a still-open gap
// rather than papered over — which is the honest disposition, because the alternative was leaving
// a mode that reads as "restricted egress" and delivers none.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContainerSandbox, detectRuntime, pruneOrionContainers, listOrionContainers }
  from '../../src/sandbox/container/index.mjs';
import { createNetworkPolicy, networkFlagsFor, ENFORCEABLE_MODES, hardBlockReason }
  from '../../src/sandbox/network.mjs';
import { makeSandbox } from '../../src/cli/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const runtime = detectRuntime();
// Containers already present before this suite ran. Everything here removes ONLY what it
// created, so a concurrent run against the same daemon is never collateral damage.
const preexisting = new Set(runtime ? await listOrionContainers({ runtime }) : []);
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w61net-${tag}-`));

// ═══════════════════════════════════════ fail-closed (runs everywhere)
describe('network-live/PROOF-3: an unenforceable policy is REFUSED, not silently granted');
{
  eq('only none and deny are enforceable by this backend',
    [...ENFORCEABLE_MODES].sort().join(','), 'deny,none');

  for (const mode of ['none', 'deny']) {
    eq(`mode '${mode}' maps to --network none`,
      networkFlagsFor(createNetworkPolicy({ mode })).join(' '), '--network none');
  }

  // The flag builder refuses rather than returning [] — returning [] is what handed the
  // container a default bridge with full egress.
  let flagErr = null;
  try { networkFlagsFor(createNetworkPolicy({ mode: 'allowlist', allow: ['x.com'] })); }
  catch (e) { flagErr = e; }
  check('networkFlagsFor REFUSES an unenforceable mode', flagErr !== null);
  check('...and explains that the container would otherwise be unrestricted',
    /unrestricted egress|cannot be enforced/.test(String(flagErr?.message)),
    String(flagErr?.message).slice(0, 90));

  // `policy.check()` is still a correct decision function — it is the mechanism that is missing,
  // not the logic. It stays exported for a deployer implementing enforcement elsewhere.
  const al = createNetworkPolicy({ mode: 'allowlist', allow: ['registry.npmjs.org'] });
  eq('check() still allows a listed host', al.check('registry.npmjs.org').allowed, true);
  eq('check() still denies an unlisted host', al.check('example.com').allowed, false);
  eq('check() still hard-blocks metadata even when allow-listed',
    createNetworkPolicy({ mode: 'allowlist', allow: ['169.254.169.254'] })
      .check('169.254.169.254').allowed, false);

  // The shipped CLI path can never construct an unenforceable policy: `makeSandbox` hardcodes
  // `mode: 'none'`. The exposure was for a library consumer, not for `orionctl` — asserted so a
  // future config knob cannot quietly reintroduce it.
  if (runtime) {
    const { sandbox } = makeSandbox(mk('cli'), { ORION_SANDBOX: 'container' });
    eq('the shipped CLI builds a `none` policy', sandbox.networkPolicy.mode, 'none');
    eq('...and declares it truthfully', sandbox.capabilities.network, 'none');
  }
}

// ═══════════════════════════════════════ live
describe('network-live/PROOF-3: --network none denies egress, live');

if (!runtime) {
  check('SKIPPED — no container runtime (docker/podman) available', true,
    'the live egress claim is UNPROVEN on this machine; the report must say so');
  console.log('\n  network-live/PROOF-3 live section: SKIPPED — no container runtime\n');
} else {
  // Built through the COMPOSITION ROOT, not a raw docker call, so this exercises what a user
  // actually gets from `ORION_SANDBOX=container`.
  const { sandbox: sb } = makeSandbox(mk('live'), { ORION_SANDBOX: 'container' });
  eq('the shipped backend is container-isolated', sb.capabilities.isolated, true);
  eq('...declaring no network', sb.capabilities.network, 'none');

  await sb.acquire();
  try {
    // There is no interface to send from — the strongest form of "default deny". Assert the
    // absence of a network stack directly, then confirm behaviourally.
    const ifaces = await sb.exec('ip -o addr 2>/dev/null || ifconfig -a 2>/dev/null || echo NOTOOL');
    check('the container has no non-loopback interface',
      !/inet (?!127\.)/.test(ifaces) || /NOTOOL/.test(ifaces),
      ifaces.replace(/\s+/g, ' ').slice(0, 90));

    /**
     * Probe a destination; returns true when it was UNREACHABLE.
     *
     * The sentinel comes from WGET'S OWN exit status, and that detail is the whole reliability of
     * this test. The first version of this probe piped wget through `head` and treated non-empty
     * output as "reachable" — but busybox wget prints `wget: bad address 'example.com'` to stdout
     * and the PIPELINE exits 0, so the denial message was read as content. That version reported
     * the boundary broken while it was working perfectly. Taking `&&`/`||` off wget directly
     * removes the ambiguity, and the positive control below proves the probe can still see a
     * reachable host — without it, "everything is denied" could just mean "the probe is broken".
     */
    const denied = async (target) => {
      try {
        const out = await sb.exec(
          `wget -q -T 4 -O /tmp/probe ${JSON.stringify(target)} && echo __REACHED__ || echo __DENIED__`);
        return /__DENIED__/.test(out) && !/__REACHED__/.test(out);
      } catch { return true; }   // a nonzero exit is also a denial
    };

    // The hard-block list, live. With no network stack these are unreachable by construction,
    // which is a STRONGER guarantee than the blocklist that `check()` applies — worth asserting
    // precisely because `check()` has no enforcement mechanism behind it in this backend.
    for (const target of ['http://169.254.169.254/latest/meta-data/',
                          'http://metadata.google.internal/',
                          'http://127.0.0.1:11434/v1/models']) {
      check(`hard-block target unreachable: ${target.slice(0, 44)}`, await denied(target));
    }

    // Ordinary destinations, live. These are the ones that were REACHABLE under the old
    // allowlist mode — the exfiltration route the fix closes.
    for (const target of ['http://example.com/', 'http://1.1.1.1/', 'https://registry.npmjs.org/']) {
      check(`ordinary egress denied: ${target}`, await denied(target));
    }

    // DNS is unavailable too — name resolution is itself an exfiltration channel.
    let dnsFailed = false;
    try {
      const r = await sb.exec('nslookup example.com >/dev/null 2>&1 && echo __RESOLVED__ || echo __NODNS__');
      dnsFailed = /__NODNS__/.test(r);
    } catch { dnsFailed = true; }
    check('DNS resolution is unavailable', dnsFailed);

    // THE POSITIVE CONTROL. Without it, every denial above could equally mean "the probe never
    // works", and the whole section would be vacuous. A container on the runtime's default
    // network, probed by the SAME command, must report reachable.
    const control = await (async () => {
      const { execFile: ef } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const run = promisify(ef);
      try {
        const { stdout } = await run(runtime,
          ['run', '--rm', sb.image, 'sh', '-c',
           'wget -q -T 8 -O /tmp/probe http://example.com/ && echo __REACHED__ || echo __DENIED__'],
          { encoding: 'utf8', timeout: 120_000 });
        return /__REACHED__/.test(stdout);
      } catch { return false; }
    })();
    check('CONTROL: the same probe DOES reach the internet from a networked container', control,
      control ? 'so the denials above are real' : 'the probe may be broken, or this host has no egress');

    // And the workspace still works — denial of egress must not break the sandbox's real job.
    sb.write('probe.txt', 'still functional\n');
    eq('the sandbox is still usable with no network',
      (await sb.exec('cat probe.txt')).trim(), 'still functional');
  } finally {
    await sb.release();
  }

  // `deny` mode reaches the same live outcome as `none`, since both map to `--network none`.
  {
    const d = mk('deny');
    const sb2 = new ContainerSandbox(path.join(d, 'work'),
      { runtime, execTimeoutMs: 60_000, network: createNetworkPolicy({ mode: 'deny' }) });
    eq("mode 'deny' also declares no network", sb2.capabilities.network, 'none');
    await sb2.acquire();
    try {
      let reachable = true;
      try {
        const out = await sb2.exec('wget -q -T 4 -O /tmp/probe http://example.com/ && echo __REACHED__ || echo __DENIED__');
        reachable = /__REACHED__/.test(out);
      } catch { reachable = false; }
      eq("mode 'deny' denies egress live", reachable, false);
    } finally { await sb2.release(); }
  }

  // A container can never be built from an unenforceable policy — the check is at construction,
  // so it fails before anything is started.
  let ctorErr = null;
  try {
    new ContainerSandbox(path.join(mk('refuse'), 'work'),
      { runtime, network: createNetworkPolicy({ mode: 'allowlist', allow: ['example.com'] }) });
  } catch (e) { ctorErr = e; }
  check('the container backend refuses an unenforceable policy at construction', ctorErr !== null);
  eq('...with a named error kind', ctorErr?.kind, 'network_policy_unenforceable');

  // Remove ONLY the containers this suite created. A blanket prune would delete a container
  // belonging to anything else running against the same daemon — which is exactly how the
  // first full-suite run of W6.1 killed a concurrently-running gate and reported a crash
  // that looked like a product defect.
  await pruneOrionContainers({ runtime, keep: preexisting });
}

process.exit(summary('network-live', path.join(HERE, '..', 'results-network-live.json')) ? 1 : 0);
