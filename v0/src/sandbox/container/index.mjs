// W6 B — the container backend: one real isolation boundary.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// THE Q4 GATE, AND HOW THIS ANSWERS IT
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// The blocking question (plan §9.4): *does a container backend enable auto-allow WITHOUT breaking
// the recovery contract?* Three things are computed against the current filesystem identity —
// the ADR-011 pre-state witness (a sha256 of file bytes read through the sandbox),
// `attachCheckpoints` (which shells to HOST git against a host path), and the crash matrix. A
// container that copied the workspace in and out would change that identity, and recovery would
// then be reasoning about a world the run never touched. That is the failure the gate exists to
// catch, and it is a real risk, not a hypothetical one.
//
// The reconciliation is to isolate EXECUTION and share the WORKSPACE:
//
//   - the per-run workspace directory is BIND-MOUNTED into the container at a fixed path;
//   - filesystem primitives (read/write/exists/list/grep) stay on the HOST side of that mount,
//     inherited unchanged from `LocalSandbox` and still path-contained by `_abs`;
//   - only `exec` — the thing that runs foreign code — crosses into the container.
//
// Measured during W6: a sha256 taken inside the container equals the one taken on the host, and a
// file written in the container is visible host-side immediately. So the witness is the same
// witness and the checkpoints are the same checkpoints, computed by the same host `git` against
// the same bytes. Nothing is faked and nothing is special-cased for containers.
//
// This is also the honest security story rather than a convenient one. The threat is FOREIGN CODE
// — a hostile repository's test script, a malicious postinstall — and foreign code only ever runs
// through `exec`. ORION's own filesystem calls are not the attack surface; they are already
// contained, and pushing them through `docker exec` would buy nothing while breaking the identity
// the recovery contract depends on.
//
// WHAT IS ACTUALLY ISOLATED: process namespace, network stack (`--network none` by default),
// cpu and memory. WHAT IS DELIBERATELY NOT: the workspace bytes. A command in the container can
// still corrupt the workspace it was given — that is the job it was asked to do.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// WHY THE CONTAINER IS LONG-LIVED
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// `docker run --rm` per command would be simpler and would make this backend stateless — and
// stateless is precisely what W6 must NOT build, because then there is no resource whose identity
// has to survive a resume, and Recovery 2.0 would be an untested abstraction (plan §9.3). A
// long-lived container per run is a genuinely stateful resource: it can be reattached to, it can
// be found gone, and it can be in an unknown state. Those are the three cases the recovery
// vocabulary exists for.
//
// The container is NAMED deterministically from the resource id, so a resumed run can find it
// again even when the in-memory handle died with the process that held it.

import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalSandbox, SandboxError, MAX_OUTPUT_BYTES, MAX_ERROR_BYTES, scrubEnv } from '../local/index.mjs';
import { describeCapabilities, Isolation } from '../backend.mjs';
import { createNetworkPolicy, networkFlagsFor, ENFORCEABLE_MODES } from '../network.mjs';

const execFile = promisify(execFileCb);

/** Where the workspace is mounted inside the container. Fixed, so paths are predictable. */
export const CONTAINER_WORKSPACE = '/workspace';

/** Small, dependency-free, and present on every registry mirror. */
export const DEFAULT_IMAGE = 'alpine:3';

/**
 * Find a usable container runtime, or null.
 *
 * Checks that the CLI exists AND that its daemon answers. A present binary with a dead daemon is
 * the common case on a developer machine, and reporting it as "available" would turn every
 * container test into a confusing failure instead of an honest skip.
 */
export function detectRuntime({ candidates = ['docker', 'podman'], timeoutMs = 10_000 } = {}) {
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['version', '--format', '{{.Server.Version}}'],
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, encoding: 'utf8' });
      return bin;
    } catch { /* not installed, or the daemon is not answering — try the next */ }
  }
  return null;
}

/**
 * A container-isolated sandbox.
 *
 * Extends `LocalSandbox` deliberately: the filesystem half of the contract is IDENTICAL by
 * construction rather than by a parallel implementation that could drift. Only `exec` and the
 * capability declaration differ, which is exactly the difference the boundary makes.
 */
export class ContainerSandbox extends LocalSandbox {
  /**
   * @param {string} root  host workspace directory (bind-mounted into the container)
   */
  constructor(root, {
    execTimeoutMs = 15_000,
    runtime = null,
    image = DEFAULT_IMAGE,
    containerName = null,
    network = null,                 // a policy from ../network.mjs; default-deny when absent
    cpus = '1.0',
    memory = '512m',
    pidsLimit = 256,
    user = null,                    // e.g. '1000:1000'; null keeps the image's default
  } = {}) {
    super(root, { execTimeoutMs });

    this.runtime = runtime ?? detectRuntime();
    if (!this.runtime)
      throw new SandboxError('no container runtime found (looked for docker, podman)',
        { kind: 'runtime_missing' });

    this.image = image;
    this.networkPolicy = network ?? createNetworkPolicy({ mode: 'none' });

    // W6.1 PROOF 3: refuse a policy this backend cannot actually enforce, HERE — at construction,
    // which is wiring time — rather than on `acquire()` or, worse, never. Before this, an
    // `allowlist` policy produced a container on the default bridge with full egress while
    // `capabilities.network` said `'restricted'`; measured live, an unlisted host and a raw IP
    // were both reachable. Failing closed is symmetric with `makeSandbox`'s refusal to fall back
    // to the local sandbox when a container was asked for: in both cases the quiet path would
    // leave the operator believing in a boundary that is not there.
    if (!ENFORCEABLE_MODES.has(this.networkPolicy.mode))
      throw new SandboxError(
        `network policy mode '${this.networkPolicy.mode}' cannot be enforced by the container `
        + `backend (per-domain egress filtering is not implemented). Use 'none' or 'deny'.`,
        { kind: 'network_policy_unenforceable' });

    this.limits = Object.freeze({ cpus, memory, pidsLimit });
    this.user = user;
    this.containerName = containerName ?? `orion-${path.basename(this.root)}-${Date.now().toString(36)}`;
    /** The live handle. Null until `acquire()` or `reattach()`. */
    this.containerId = null;

    this.capabilities = describeCapabilities({
      isolation: Isolation.CONTAINER,
      // Both enforceable modes receive `--network none`, so both declare `none`. `deny` used to
      // declare `restricted`, which understated it rather than overstating — but a capability
      // should say what the backend actually provides, and what it provides here is no network
      // stack at all. The unenforceable modes are refused above, so there is no third case.
      network: 'none',
      // The Q4 reconciliation, declared rather than implied — see the header.
      sharedWorkspace: true,
      runtime: this.runtime,
      limits: this.limits,
    });
  }

  /** Run a runtime CLI command (not a sandboxed command — this is the control plane). */
  async #rt(args, { timeoutMs = 60_000 } = {}) {
    return execFile(this.runtime, args, {
      encoding: 'utf8', timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES * 4,
      // The control plane needs the real PATH to find the runtime, but must not hand the
      // container's own environment any of this process's credentials.
      env: scrubEnv(process.env),
    });
  }

  /**
   * Start the container and bind to it.
   *
   * `sleep infinity` as the entrypoint: the container exists to be `exec`'d into, and a container
   * that exits immediately cannot be a resource with a lifecycle.
   */
  async acquire() {
    const netFlags = networkFlagsFor(this.networkPolicy);
    const args = [
      'run', '--detach',
      '--name', this.containerName,
      ...netFlags,
      '--cpus', String(this.limits.cpus),
      '--memory', String(this.limits.memory),
      '--pids-limit', String(this.limits.pidsLimit),
      // The workspace, and ONLY the workspace. Nothing else of the host is visible.
      '--volume', `${this.root}:${CONTAINER_WORKSPACE}`,
      '--workdir', CONTAINER_WORKSPACE,
      ...(this.user ? ['--user', this.user] : []),
      this.image,
      'sh', '-c', 'sleep infinity',
    ];
    const { stdout } = await this.#rt(args, { timeoutMs: 120_000 });
    this.containerId = stdout.trim();
    return { containerId: this.containerId, name: this.containerName };
  }

  /**
   * Try to bind to an EXISTING container by name — the Recovery 2.0 path (W6-I).
   *
   * Returns a verdict rather than throwing, because "the resource is gone" is a normal outcome
   * that the caller must record as an event and act on, not an exception to be swallowed.
   *
   * @returns {Promise<{reattached: boolean, state: string, containerId: string|null, reason: string}>}
   */
  async reattach(name = this.containerName) {
    let out;
    try {
      const r = await this.#rt(['inspect', '--format', '{{.Id}} {{.State.Running}}', name],
        { timeoutMs: 30_000 });
      out = r.stdout.trim();
    } catch {
      return { reattached: false, state: 'absent', containerId: null,
               reason: `no container named ${name}` };
    }
    const [id, running] = out.split(/\s+/);
    if (running !== 'true')
      return { reattached: false, state: 'stopped', containerId: id ?? null,
               reason: `container ${name} exists but is not running` };

    this.containerName = name;
    this.containerId = id;
    return { reattached: true, state: 'running', containerId: id,
             reason: `reattached to ${name}` };
  }

  /**
   * Stop and remove the container.
   *
   * Idempotent, and the second call reports `released: false` rather than `true`. That
   * distinction matters because `docker rm --force` exits 0 for a container that does not exist:
   * without clearing the binding here, releasing twice would claim to have removed something
   * twice, and a caller could not tell "I released it" from "it was already gone". The binding is
   * dropped along with the container — after a release there is nothing left to reattach to.
   */
  async release() {
    if (!this.containerId && !this.containerName) return { released: false, reason: 'nothing bound' };
    const name = this.containerName;
    try {
      await this.#rt(['rm', '--force', name], { timeoutMs: 60_000 });
      const id = this.containerId;
      this.containerId = null;
      this.containerName = null;
      return { released: true, reason: `removed ${name}`, containerId: id };
    } catch (e) {
      return { released: false, reason: `could not remove ${name}: ${e?.message ?? e}` };
    }
  }

  /** Is the bound container actually alive right now? */
  async alive() {
    if (!this.containerName) return false;
    try {
      const { stdout } = await this.#rt(['inspect', '--format', '{{.State.Running}}', this.containerName],
        { timeoutMs: 30_000 });
      return stdout.trim() === 'true';
    } catch { return false; }
  }

  /**
   * Run a command INSIDE the container.
   *
   * The error taxonomy is deliberately identical to `LocalSandbox` — `output_overflow`,
   * `timeout`, `shell_missing`, `nonzero_exit` — because recovery classification keys off `kind`
   * and the crash matrix depends on those decisions being the same. A container-specific taxonomy
   * would make the boundary change recovery behaviour, which is precisely what Q4 forbids.
   */
  async exec(cmd) {
    if (typeof cmd !== 'string') throw new Error('cmd must be a string');
    if (!this.containerId) throw new SandboxError(
      'container sandbox is not bound — call acquire() or reattach() first',
      { kind: 'not_bound' });

    try {
      const { stdout } = await execFile(
        this.runtime,
        ['exec', '--workdir', CONTAINER_WORKSPACE, this.containerId, 'sh', '-lc', cmd],
        {
          encoding: 'utf8',
          timeout: this.execTimeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES * 4,
          env: scrubEnv(process.env),
        });
      return clampOut(stdout ?? '');
    } catch (err) {
      throw this.#containerExecError(err);
    }
  }

  /** Map a `docker exec` failure onto the shared taxonomy. */
  #containerExecError(err) {
    if (err.code === 'ENOBUFS' || /maxBuffer/i.test(err.message ?? '')) {
      return new SandboxError(
        `command produced more than ${MAX_OUTPUT_BYTES * 4} bytes and was aborted — ` +
        `redirect output to a file and read it in slices`, { kind: 'output_overflow' });
    }
    if (err.killed || err.signal === 'SIGTERM') {
      return new SandboxError(
        `command timed out after ${this.execTimeoutMs}ms and was killed`, { kind: 'timeout' });
    }
    const stderr = String(err.stderr ?? '');
    // The RUNTIME failing is not the command failing, and conflating them would misreport a dead
    // daemon as a failing test. `docker exec` uses 125/126 for its own errors.
    if (/is not running|No such container|Cannot connect to the Docker daemon/i.test(stderr)) {
      return new SandboxError(
        `container ${this.containerName} is not available: ${shortenErr(stderr)}`,
        { kind: 'resource_lost' });
    }
    const detail = shortenErr(stderr || String(err.stdout ?? ''));
    return new SandboxError(
      `command failed (exit ${err.code ?? '?'}): ${detail}`,
      { kind: 'nonzero_exit', exitCode: typeof err.code === 'number' ? err.code : null });
  }

  /**
   * The synchronous path stays on the HOST, unchanged.
   *
   * `execSync` exists for workspace checkpoints, which shell to host `git` against the host side
   * of the bind mount (see the header). Routing it through the container would require git inside
   * the image and would move checkpoint history into a resource that can be destroyed — breaking
   * the very recovery property this backend has to preserve.
   */
}

// Local copies of the two bounding helpers. `LocalSandbox` keeps them module-private, and
// exporting them purely for a subclass would widen its surface for no one else's benefit.
function clampOut(s) {
  const b = Buffer.byteLength(s, 'utf8');
  if (b <= MAX_OUTPUT_BYTES) return s;
  const head = s.slice(0, Math.floor(MAX_OUTPUT_BYTES * 0.6));
  const tail = s.slice(-Math.floor(MAX_OUTPUT_BYTES * 0.2));
  return `${head}\n…[stdout truncated: ${b} bytes > ${MAX_OUTPUT_BYTES} limit]…\n${tail}`;
}

function shortenErr(s) {
  const t = String(s ?? '').trim();
  if (t.length <= MAX_ERROR_BYTES) return t;
  return `${t.slice(0, Math.floor(MAX_ERROR_BYTES * 0.7))}\n…[${t.length - MAX_ERROR_BYTES} more chars omitted]…\n${t.slice(-Math.floor(MAX_ERROR_BYTES * 0.2))}`;
}

/** Every container this runtime owns, by name. */
export async function listOrionContainers({ runtime = null, prefix = 'orion-' } = {}) {
  const rt = runtime ?? detectRuntime();
  if (!rt) return [];
  try {
    const { stdout } = await execFile(rt,
      ['ps', '--all', '--filter', `name=${prefix}`, '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 60_000, env: scrubEnv(process.env) });
    return stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

/**
 * Sweep containers this runtime left behind.
 *
 * `keep` is the W6.1 addition and it is not optional in practice: a container belonging to a run
 * that is still resumable MUST survive, because reattaching to it is the whole of Recovery 2.0
 * (W6-I). Pruning indiscriminately would turn every reattach into a recreate-with-notice — the
 * cleanup would quietly destroy the property the wave was built to provide. Tests that own every
 * container in the environment pass no `keep` and sweep everything.
 */
export async function pruneOrionContainers({ runtime = null, prefix = 'orion-', keep = null } = {}) {
  const rt = runtime ?? detectRuntime();
  if (!rt) return { pruned: 0, kept: 0, runtime: null };
  const names = await listOrionContainers({ runtime: rt, prefix });
  const spare = keep instanceof Set ? keep : new Set(keep ?? []);
  let pruned = 0;
  for (const n of names) {
    if (spare.has(n)) continue;
    try {
      await execFile(rt, ['rm', '--force', n], { timeout: 60_000, env: scrubEnv(process.env) });
      pruned++;
    } catch { /* already gone */ }
  }
  return { pruned, kept: names.length - pruned, runtime: rt };
}
