// W6 A — the SandboxBackend contract.
//
// WHY THIS EXISTS
//
// Until now there was exactly one sandbox, so "the sandbox interface" was whatever
// `LocalSandbox` happened to expose and whatever the worker happened to call. That is not a
// contract, and it made two things impossible: a second implementation, and — more importantly —
// deriving anything from what a sandbox actually GUARANTEES. W6-G makes posture a consequence of
// the boundary rather than a guess, and a guess is all it could ever be without a declared
// capability.
//
// WHAT THIS IS NOT
//
// It is not an abstraction invented ahead of its second implementation. Every member below is
// something `LocalSandbox` already had and the worker or the toolset already calls; the container
// backend (W6-B) implements the same set. Nothing was added speculatively, and nothing that only
// one backend needs lives here.
//
// THE HONESTY RULE
//
// `capabilities.isolation` is a claim the backend makes about itself, and posture is derived from
// it, so a dishonest declaration is a security bug rather than a documentation one. `LocalSandbox`
// declares `none` — it enforces path containment, which is a workspace scope and NOT OS isolation
// (plan §13). It would be easy and wrong to call that 'partial' to unlock a friendlier posture.

/**
 * Isolation levels a backend may claim, ordered weakest to strongest.
 *
 *   none      — path containment only. The command runs as this user, on this machine, with this
 *               network. `LocalSandbox`. Honest name for what it is.
 *   container — a separate OS-level namespace: its own filesystem view, process tree and network
 *               stack. Escaping requires a container-runtime vulnerability rather than a relative
 *               path. The workspace is deliberately SHARED (see `sharedWorkspace` below).
 */
export const Isolation = Object.freeze({
  NONE: 'none',
  CONTAINER: 'container',
});

/** Isolation levels strong enough for a command to be auto-allowed without a human (W6-G). */
export const ISOLATED_LEVELS = Object.freeze(new Set([Isolation.CONTAINER]));

/**
 * The methods every backend must provide.
 *
 * Split by why they exist, because the two groups have different failure modes: a missing
 * filesystem method breaks a tool, a missing `exec` breaks the entire execution model.
 */
export const REQUIRED_METHODS = Object.freeze([
  // filesystem — what the read/write/edit/grep tools call
  'read', 'write', 'exists', 'list', 'grep',
  // execution — what bash/verify call. Async since W5 X1.
  'exec',
  // containment — the path check every filesystem method routes through
  '_abs',
]);

/** Properties every backend must carry. */
export const REQUIRED_PROPERTIES = Object.freeze([
  'root',            // the host-visible workspace path (see `sharedWorkspace`)
  'execTimeoutMs',   // bounded execution is part of the contract, not a local detail
  'capabilities',    // the declaration W6-G derives posture from
]);

/**
 * Describe a backend's guarantees.
 *
 * `sharedWorkspace` is the field that makes W6 possible at all, and it deserves its explanation
 * here rather than in a commit message.
 *
 * The Q4 gate asks whether a container backend can enable auto-allow WITHOUT breaking the
 * recovery contract. The ADR-011 pre-state witness is a sha256 of file bytes read through the
 * sandbox; `attachCheckpoints` shells to HOST git against a host path. Both are computed against
 * a filesystem identity. A container that copied the workspace in and out would CHANGE that
 * identity, and the honest consequence would be that recovery no longer reasons about the world
 * the run actually touched.
 *
 * So the container backend bind-mounts the workspace instead. The bytes are the same bytes: a
 * sha256 taken inside the container equals the one taken on the host (measured, W6). Execution is
 * isolated — network, process tree, cpu and memory — while the workspace stays shared and
 * host-addressable. `sharedWorkspace: true` is a backend asserting exactly that, which is what
 * lets checkpoints and witnesses keep working untouched rather than being faked.
 *
 * @param {{ isolation: string, network?: string, sharedWorkspace?: boolean,
 *           runtime?: string|null, limits?: any }} c
 * @returns {any}
 */
export function describeCapabilities({
  isolation,
  network = 'host',
  sharedWorkspace = true,
  runtime = null,
  limits = null,
} = /** @type {any} */ ({})) {
  if (!Object.values(Isolation).includes(/** @type {any} */ (isolation)))
    throw new Error(`unknown isolation level: ${isolation}`);
  return Object.freeze({
    isolation: /** @type {string} */ (isolation),
    network,                 // 'host' | 'none' | 'restricted'
    sharedWorkspace,         // see the note above — the Q4 reconciliation
    runtime,                 // 'docker' | 'podman' | null
    limits: limits ? Object.freeze({ ...limits }) : null,
    /** True when this backend is strong enough for autonomous execution (W6-G). */
    isolated: ISOLATED_LEVELS.has(/** @type {any} */ (isolation)),
  });
}

/**
 * Assert that `backend` satisfies the contract. Throws with everything missing at once.
 *
 * Called by the tests for BOTH backends and — deliberately — at the CLI composition root, so a
 * backend that does not satisfy the contract fails at wiring time rather than on the first tool
 * call of a real run. A structural check is also what keeps the container backend provable on a
 * machine with no container runtime (W6-B): the interface and its capability declaration can be
 * verified even when no container can be started.
 */
export function assertBackendContract(backend, label = 'backend') {
  const missing = [];
  for (const m of REQUIRED_METHODS) {
    if (typeof backend?.[m] !== 'function') missing.push(`method ${m}()`);
  }
  for (const p of REQUIRED_PROPERTIES) {
    if (backend?.[p] === undefined) missing.push(`property ${p}`);
  }
  // `exec` is async since W5 X1. A synchronous exec would block the event loop and silently
  // defeat the tool-path lease heartbeat (W5 X2) — the exact defect that wave closed.
  if (typeof backend?.exec === 'function' && backend.exec.constructor.name !== 'AsyncFunction')
    missing.push('exec() must be async (W5 X1/X2 — a blocking exec defeats the lease heartbeat)');

  const caps = backend?.capabilities;
  if (caps) {
    if (!Object.values(Isolation).includes(caps.isolation))
      missing.push(`capabilities.isolation is not a known level: ${caps.isolation}`);
    if (typeof caps.isolated !== 'boolean')
      missing.push('capabilities.isolated must be a boolean (build it with describeCapabilities)');
  }

  if (missing.length)
    throw new Error(`${label} does not satisfy the SandboxBackend contract:\n  - ${missing.join('\n  - ')}`);
  return true;
}
