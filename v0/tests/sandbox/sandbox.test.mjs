// W6 A/B/E/F/G — the sandbox boundary: contract, isolation, egress, and posture derivation.
//
// Structured so the wave stays provable on a machine with no container runtime. Everything here
// except the live-container section runs everywhere; the live section skips LOUDLY, with its
// reason, rather than reporting green (plan §11.4).
//
// The hostile-repository section is the one that matters most. §7's Security row asks for a suite
// proving the workspace cannot reach the host filesystem or network, and the two backends give
// genuinely different answers to that — which is the point of declaring `isolation` at all.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalSandbox, SandboxError } from '../../src/sandbox/local/index.mjs';
import { ContainerSandbox, detectRuntime, pruneOrionContainers, CONTAINER_WORKSPACE }
  from '../../src/sandbox/container/index.mjs';
import { assertBackendContract, describeCapabilities, Isolation, REQUIRED_METHODS,
         REQUIRED_PROPERTIES } from '../../src/sandbox/backend.mjs';
import { createNetworkPolicy, hardBlockReason, networkFlagsFor } from '../../src/sandbox/network.mjs';
import { derivePosture } from '../../src/auth/posture.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w6-${tag}-`));

// ═══════════════════════════════════════════════════ A — the contract
describe('sandbox/A: both backends satisfy one contract');
{
  const local = new LocalSandbox(mk('local'));
  check('LocalSandbox satisfies the contract', assertBackendContract(local, 'LocalSandbox'));

  for (const m of REQUIRED_METHODS) eq(`local has ${m}()`, typeof local[m], 'function');
  for (const p of REQUIRED_PROPERTIES) check(`local has ${p}`, local[p] !== undefined);

  // W5 X1/X2 made this load-bearing: a synchronous exec cannot be renewed by the lease
  // heartbeat, so the contract refuses one rather than letting the defect return quietly.
  eq('exec is async, as the contract requires', local.exec.constructor.name, 'AsyncFunction');

  // The honesty rule. `LocalSandbox` must NOT claim isolation it does not have — posture is
  // derived from this field, so overstating it would silently auto-allow host commands.
  eq('LocalSandbox declares isolation=none', local.capabilities.isolation, Isolation.NONE);
  eq('...and is therefore not isolated', local.capabilities.isolated, false);

  // A backend that lies about its shape must be rejected at wiring time, not on first use.
  let threw = null;
  try { assertBackendContract({ read: () => '', capabilities: {} }, 'brokenBackend'); }
  catch (e) { threw = e; }
  check('an incomplete backend is rejected', threw !== null);
  check('and the error names everything missing at once',
    (String(threw?.message).match(/\n\s+- /g) ?? []).length >= 3,
    String(threw?.message).slice(0, 80));

  let badIso = null;
  try { describeCapabilities({ isolation: 'totally-isolated-trust-me' }); } catch (e) { badIso = e; }
  check('an unknown isolation level is refused', badIso !== null);
}

// ═══════════════════════════════════════════════════ F — network policy
describe('sandbox/F: egress is default-deny, and some things are never allowed');
{
  const none = createNetworkPolicy();
  eq('the default policy is `none`', none.mode, 'none');
  eq('a normal host is unreachable by default', none.check('example.com').allowed, false);

  // The rules that must survive every mode, every allowlist and every grant. Cloud metadata is
  // reachable from inside most hosted environments, needs no credentials, and returns real ones.
  const allowEverything = createNetworkPolicy({ mode: 'allowlist',
    allow: ['169.254.169.254', 'metadata.google.internal', '127.0.0.1', 'example.com'] });
  for (const target of ['169.254.169.254', 'http://169.254.169.254/latest/meta-data/',
                        'metadata.google.internal', '127.0.0.1', '169.254.42.7']) {
    const r = allowEverything.check(target);
    eq(`hard-blocked even when explicitly allowed: ${target.slice(0, 34)}`, r.allowed, false);
    check('  ...and says why', /hard-blocked/.test(r.reason), r.reason.slice(0, 60));
  }

  // The allowlist still works for legitimate destinations.
  const al = createNetworkPolicy({ mode: 'allowlist', allow: ['registry.npmjs.org', '.github.com'] });
  eq('an allowed host is reachable', al.check('registry.npmjs.org').allowed, true);
  eq('a suffix rule matches a subdomain', al.check('api.github.com').allowed, true);
  // The trap a naive suffix match falls into.
  eq('a suffix rule does NOT match a lookalike', al.check('notgithub.com').allowed, false);
  eq('an unlisted host is denied', al.check('evil.example').allowed, false);

  check('a bare metadata IP is recognised', !!hardBlockReason('169.254.169.254'));
  check('an ordinary IP is not', !hardBlockReason('8.8.8.8'));

  // `none` and `deny` both get the strongest available mechanism, not a filter.
  for (const mode of ['none', 'deny']) {
    const flags = networkFlagsFor(createNetworkPolicy({ mode }));
    eq(`mode '${mode}' runs with --network none`, flags.join(' '), '--network none');
  }
}

// ═══════════════════════════════════════════════════ G — posture derivation
describe('sandbox/G: posture is derived from the boundary, not configured');
{
  const localCaps = describeCapabilities({ isolation: Isolation.NONE });
  const contCaps = describeCapabilities({ isolation: Isolation.CONTAINER, network: 'none', runtime: 'docker' });

  const l = derivePosture({ capabilities: localCaps, env: {} });
  eq('no isolation ⇒ auto (escalate mutating/unsafe work)', l.posture, 'auto');
  eq('...and it is DERIVED, not asserted', l.derived, true);
  check('...and it says why', /not OS isolation/.test(l.reason), l.reason.slice(0, 60));

  const c = derivePosture({ capabilities: contCaps, env: {} });
  eq('isolation ⇒ permissive (auto-allow)', c.posture, 'permissive');
  eq('...also derived', c.derived, true);
  check('...and the reason names the blast radius',
    /blast radius/.test(c.reason), c.reason.slice(0, 60));

  // An operator may RAISE strictness — deployments have reasons the runtime cannot see.
  eq('an override may raise the floor', derivePosture({ capabilities: contCaps, override: 'strict', env: {} }).posture, 'strict');
  eq('...and is marked as an override', derivePosture({ capabilities: contCaps, override: 'strict', env: {} }).derived, false);

  // But it may NOT lower it. This is the lever W6 removes: declaring `permissive` on an
  // unisolated backend to silence escalation would make autonomy a config flag again.
  const lowered = derivePosture({ capabilities: localCaps, override: 'permissive', env: {} });
  eq('an override may NOT lower the floor the backend earns', lowered.posture, 'auto');
  check('...and the refusal is explained', /would lower the floor/.test(lowered.reason),
    lowered.reason.slice(0, 70));

  // Absent capabilities must fail safe, never open.
  eq('an undeclared backend is assumed unisolated', derivePosture({ env: {} }).posture, 'auto');
}

// ═══════════════════════════════════════════════════ E — hostile repository, LOCAL backend
describe('sandbox/E: a hostile repo cannot escape the workspace path (local)');
{
  const root = mk('hostile-local');
  const sb = new LocalSandbox(path.join(root, 'work'));
  const outside = path.join(root, 'SECRET.txt');
  fs.writeFileSync(outside, 'host-secret');

  // Path containment: this is what `LocalSandbox` DOES guarantee, and all it guarantees.
  for (const p of ['../SECRET.txt', '../../SECRET.txt', 'a/../../SECRET.txt',
                   path.join(root, 'SECRET.txt')]) {
    let threw = null;
    try { sb.read(p); } catch (e) { threw = e; }
    check(`traversal refused: ${p.slice(-24)}`, threw !== null && /escapes sandbox/.test(threw.message),
      String(threw?.message).slice(0, 50));
  }

  let nullThrew = null;
  try { sb.read('a\0b'); } catch (e) { nullThrew = e; }
  check('a null byte in a path is refused', nullThrew !== null);

  // And the honest limit, asserted rather than hoped for: a COMMAND is not contained at all.
  // This is why `isolation: 'none'` is the correct declaration and why posture escalates here.
  const escaped = await sb.exec(`cat ${JSON.stringify(outside).replace(/\\\\/g, '/')} 2>/dev/null || echo BLOCKED`);
  check('a shell command CAN read outside the workspace (documented, not a defect)',
    /host-secret/.test(escaped), escaped.trim().slice(0, 40));
  check('...which is exactly why this backend declares isolation=none',
    sb.capabilities.isolated === false);
}

// ═══════════════════════════════════════════════════ B/E — live container
const runtime = detectRuntime();
describe('sandbox/B: the container backend is a real boundary');

if (!runtime) {
  check('SKIPPED — no container runtime (docker/podman) available', true,
    'structural contract, network policy and posture derivation above still ran');
  console.log('\n  sandbox/B live matrix: SKIPPED — no container runtime\n');
} else {
  const root = mk('hostile-container');
  const ws = path.join(root, 'work');
  const outside = path.join(root, 'SECRET.txt');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(outside, 'host-secret');

  const sb = new ContainerSandbox(ws, { execTimeoutMs: 30_000, runtime });
  eq('declares container isolation', sb.capabilities.isolation, Isolation.CONTAINER);
  eq('...and is therefore isolated', sb.capabilities.isolated, true);
  eq('declares no network', sb.capabilities.network, 'none');
  check('declares a shared workspace (the Q4 reconciliation)', sb.capabilities.sharedWorkspace);
  check('satisfies the same contract as the local backend', assertBackendContract(sb, 'ContainerSandbox'));

  // Not bound yet: executing must fail loudly rather than silently running somewhere.
  let unbound = null;
  try { await sb.exec('echo hi'); } catch (e) { unbound = e; }
  eq('an unbound container refuses to execute', unbound?.kind, 'not_bound');

  await sb.acquire();
  try {
    // ── the Q4 property: the workspace is the SAME bytes on both sides ──
    sb.write('math.js', 'export const add = (a,b) => a - b;\n');
    const hostText = sb.read('math.js');
    const contSha = (await sb.exec('sha256sum math.js')).trim().split(/\s+/)[0];
    const { createHash } = await import('node:crypto');
    const hostSha = createHash('sha256').update(hostText).digest('hex');
    eq('a witness taken INSIDE the container equals the host witness', contSha, hostSha);

    await sb.exec('echo made-inside > inside.txt');
    check('a container write is visible host-side immediately', sb.exists('inside.txt'));
    eq('...with the expected content', sb.read('inside.txt').trim(), 'made-inside');

    // ── the host filesystem is NOT reachable ──
    const hostProbe = await sb.exec(
      `cat ${JSON.stringify(outside).replace(/\\/g, '/')} 2>/dev/null || echo BLOCKED`);
    check('the host filesystem is unreachable from inside', /BLOCKED/.test(hostProbe), hostProbe.trim().slice(0, 40));
    const rootProbe = await sb.exec('ls / | tr "\\n" " "');
    check('only the workspace is mounted', !/Users|home\/abhijith/.test(rootProbe), rootProbe.slice(0, 70));
    eq('the workspace is at the declared path',
      (await sb.exec('pwd')).trim(), CONTAINER_WORKSPACE);

    // ── the network is NOT reachable ──
    let netBlocked = false;
    try {
      const r = await sb.exec('wget -q -T 3 -O- http://169.254.169.254/ 2>&1 || echo NONET');
      netBlocked = /NONET/.test(r);
    } catch (e) { netBlocked = true; }
    check('cloud metadata is unreachable (--network none)', netBlocked);
    let dnsBlocked = false;
    try {
      const r = await sb.exec('wget -q -T 3 -O- http://example.com/ 2>&1 || echo NONET');
      dnsBlocked = /NONET/.test(r);
    } catch (e) { dnsBlocked = true; }
    check('general egress is unreachable', dnsBlocked);

    // ── the error taxonomy is IDENTICAL, which recovery depends on ──
    let nz = null; try { await sb.exec('exit 7'); } catch (e) { nz = e; }
    eq('nonzero exit is classified the same way', nz?.kind, 'nonzero_exit');
    eq('...carrying the exit code', nz?.exitCode, 7);

    const slow = new ContainerSandbox(ws, { execTimeoutMs: 2_000, runtime,
      containerName: sb.containerName });
    await slow.reattach(sb.containerName);
    let to = null; try { await slow.exec('sleep 30'); } catch (e) { to = e; }
    eq('a timeout is classified the same way', to?.kind, 'timeout');

    // ── reattachment by name: the Recovery 2.0 primitive ──
    const fresh = new ContainerSandbox(ws, { execTimeoutMs: 30_000, runtime });
    const r = await fresh.reattach(sb.containerName);
    check('a fresh instance can reattach by name', r.reattached, r.reason);
    eq('...to the same container id', r.containerId, sb.containerId);

    const missing = await fresh.reattach('orion-does-not-exist-at-all');
    eq('reattaching to an absent container reports absent, not an exception', missing.state, 'absent');
    eq('...and does not claim success', missing.reattached, false);
  } finally {
    const rel = await sb.release();
    check('release removes the container', rel.released, rel.reason);
    eq('release is idempotent', (await sb.release()).released, false);
    await pruneOrionContainers({ runtime });
  }
}

process.exit(summary('sandbox', path.join(HERE, '..', 'results-sandbox.json')) ? 1 : 0);
