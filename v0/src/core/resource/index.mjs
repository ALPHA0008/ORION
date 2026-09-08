// W6 C/D/H/I/J — the resource resolver: acquire, reattach, or record the loss.
//
// This is ORION's answer to TrueForge's `TurnResourceResolver`, with the storage inverted. The
// mechanism is the same and it is the right one — look up the resource you were bound to, and
// reattach to it by identity rather than building a new one. What differs is where the identity
// lives: TrueForge keeps it in a mutable `TurnRecord.snapshot`, and here it is derived by folding
// `resource.*` events (plan §9.3). That is the difference between preserving replay and quietly
// breaking it.
//
// THE THREE OUTCOMES, AND WHY ALL THREE MUST BE NAMED
//
// When a run resumes, the resource it was bound to is in one of exactly three states, and before
// W6 the runtime had a word for none of them:
//
//   still alive   → REATTACH. The world the recovery contract reasoned about is the world we are
//                   back in. This is the case that makes resume trustworthy.
//   gone          → RECREATE, and say so. A fresh sandbox is usable, but it is NOT the same world:
//                   anything the run did that lived only in the resource is gone. Recording
//                   `resource.lost` with `action: 'recreated'` is what stops that from being a
//                   silent substitution — the old behaviour, where `LocalSandbox` was rebuilt from
//                   a path every time and nobody was told.
//   unknown       → ESCALATE. The resource exists but its state cannot be established. Guessing
//                   here is how a run duplicates an effect, so a human decides.
//
// The reason this matters more than it used to: a path is not stateful, so reconstructing a
// `LocalSandbox` was invisible AND harmless. A container is stateful, so the same silent
// reconstruction would hand the run a different world with the same name.

import { resourceId, projectResources, bindingToReattach, ResourceKind, BindingState }
  from '../projection/resource.mjs';
import { derivePosture } from '../../auth/posture.mjs';
import { LeaseLostError } from '../run/store.mjs';

/** How a resource was resolved. Returned to the caller and recorded in the log. */
export const Resolution = Object.freeze({
  ACQUIRED: 'acquired',
  REATTACHED: 'reattached',
  RECREATED: 'recreated',
  ESCALATED: 'escalated',
});

/**
 * Bind a run to its workspace resource, appending the lifecycle event that says what happened.
 *
 * `backend` is a live sandbox instance. Backends that can genuinely be reattached to implement
 * `reattach()` / `alive()` (the container does); those that cannot are handled by the liveness
 * probe below, which is honest about what a local directory can and cannot promise.
 *
 * @param {object} opts
 * @param {import('../run/store.mjs').Store} opts.store
 * @param {string} opts.runId
 * @param {any}    opts.backend      a sandbox instance (LocalSandbox or ContainerSandbox)
 * @param {string} opts.leaseToken
 * @param {string} [opts.backendName]
 * @param {string|null} [opts.postureOverride]
 * @param {any} [opts.env]
 * @returns {Promise<{resolution: string, resource_id: string, posture: string,
 *                    postureReason: string, binding: any, escalate?: string}>}
 */
export async function resolveResource({
  store, runId, backend, leaseToken,
  backendName = backend?.constructor?.name ?? 'unknown',
  postureOverride = null,
  env = process.env,
}) {
  const id = resourceId({ kind: ResourceKind.WORKSPACE, root: backend.root, runId });
  const posture = derivePosture({ capabilities: backend.capabilities, override: postureOverride, env });

  const prior = bindingToReattach(store.events(runId));

  const append = (type, payload) => store.append(runId, type, payload, { leaseToken });

  // ── no prior binding: this is a fresh acquisition ─────────────────────────
  if (!prior) {
    if (typeof backend.acquire === 'function') await backend.acquire();
    append('resource.acquired', {
      resource_id: id,
      kind: ResourceKind.WORKSPACE,
      backend: backendName,
      root: backend.root,
      container_path: backend.containerName ? '/workspace' : null,
      handle_name: backend.containerName ?? null,
      handle: backend.containerId ?? null,
      capabilities: backend.capabilities ?? null,
      // The DERIVED posture and its reason travel with the acquisition, so a reader can see not
      // only what was allowed later but what made it allowable (Invariant 7).
      posture: posture.posture,
      posture_derived: posture.derived,
      posture_reason: posture.reason,
    });
    return { resolution: Resolution.ACQUIRED, resource_id: id, posture: posture.posture,
             postureReason: posture.reason, binding: bindingToReattach(store.events(runId)) };
  }

  // ── a prior binding exists: is it the same resource, and is it alive? ─────
  //
  // Identity first. If the recomputed id differs, the run is being resumed against a DIFFERENT
  // workspace — a moved or renamed directory. Reattaching would silently apply the run's history
  // to the wrong tree, so this is a loss, not a reattachment.
  if (prior.resource_id !== id) {
    append('resource.lost', {
      resource_id: prior.resource_id,
      reason: `workspace identity changed (expected ${prior.resource_id}, found ${id})`,
      action: 'escalated',
      found_resource_id: id,
    });
    return { resolution: Resolution.ESCALATED, resource_id: prior.resource_id,
             posture: posture.posture, postureReason: posture.reason, binding: prior,
             escalate: 'the workspace this run was bound to is not the one present now' };
  }

  const probe = await probeLiveness(backend, prior);

  if (probe.alive) {
    append('resource.reattached', {
      resource_id: id,
      backend: backendName,
      root: backend.root,
      handle_name: backend.containerName ?? null,
      handle: backend.containerId ?? null,
      evidence: probe.evidence,
      capabilities: backend.capabilities ?? null,
      posture: posture.posture,
      posture_reason: posture.reason,
    });
    return { resolution: Resolution.REATTACHED, resource_id: id, posture: posture.posture,
             postureReason: posture.reason, binding: bindingToReattach(store.events(runId)) };
  }

  if (probe.unknown) {
    append('resource.lost', { resource_id: id, reason: probe.reason, action: 'escalated' });
    return { resolution: Resolution.ESCALATED, resource_id: id, posture: posture.posture,
             postureReason: posture.reason, binding: prior, escalate: probe.reason };
  }

  // Gone, and recreatable. Recreate — and RECORD that this is not the same world.
  if (typeof backend.acquire === 'function') await backend.acquire();
  append('resource.lost', {
    resource_id: id,
    reason: probe.reason,
    action: 'recreated',
    handle_name: backend.containerName ?? null,
    handle: backend.containerId ?? null,
    // Stated in the payload as well as implied by `action`, because this is the sentence a human
    // reading `explain` needs to see: the run continues, on a resource that was rebuilt.
    note: 'the resource was rebuilt — state held only inside it did not survive',
  });
  return { resolution: Resolution.RECREATED, resource_id: id, posture: posture.posture,
           postureReason: posture.reason, binding: bindingToReattach(store.events(runId)) };
}

/**
 * Is the prior binding's resource still there?
 *
 * @returns {Promise<{alive: boolean, unknown?: boolean, reason: string, evidence: string}>}
 */
async function probeLiveness(backend, prior) {
  // A backend that models a live handle answers for itself.
  if (typeof backend.reattach === 'function') {
    let r;
    try {
      // Ask about the name RECORDED IN THE LOG, not the one this freshly-constructed backend
      // happens to have invented. That distinction is the whole of reattachment: the log is what
      // remembers, the instance is what forgets.
      r = await backend.reattach(prior.handle_name ?? backend.containerName);
    } catch (e) {
      // The runtime itself failed to answer. That is genuinely UNKNOWN — the container may be
      // running and unreachable, and destroying or duplicating it on a guess is exactly the
      // orphan-effect class recovery exists to prevent.
      return { alive: false, unknown: true,
               reason: `could not determine resource state: ${String(e?.message ?? e)}`,
               evidence: 'probe failed' };
    }
    if (r.reattached) return { alive: true, reason: r.reason, evidence: `handle ${r.containerId?.slice(0, 12)}` };
    // 'absent' and 'stopped' are both recoverable by recreating; neither is ambiguous.
    return { alive: false, reason: r.reason, evidence: r.state };
  }

  // A plain local workspace has no handle, so liveness is the directory still being there and
  // still being usable. This is deliberately a weak claim, and the honest one: a local sandbox
  // cannot tell you whether anything ELSE changed the directory while the run was away.
  try {
    backend.list('.');
    return { alive: true, reason: 'workspace directory is present and readable',
             evidence: 'directory probe' };
  } catch (e) {
    return { alive: false, reason: `workspace directory is unusable: ${String(e?.message ?? e)}`,
             evidence: 'directory probe failed' };
  }
}

/**
 * Release the binding, recording it. Safe to call when nothing is bound.
 *
 * A LOST LEASE IS NOT AN ERROR HERE, and getting that wrong crashed the §11.2 manual gate: the
 * CLI releases after every run, including one that ended as `lease_lost`, and appending with a
 * dead token threw `LeaseLostError` straight out of the command. The run had already finished
 * correctly — the file was fixed and the test passed — and the process died anyway while tearing
 * down, which on Windows surfaced as a libuv assertion rather than a legible error.
 *
 * Losing the lease means another worker owns this run now. It is that worker's job to record the
 * release, not ours, so the correct behaviour is to stop quietly rather than to fail the command.
 * The backend handle is still torn down first: a container we started must not be left running
 * just because we no longer hold the lease.
 */
export async function releaseResource({ store, runId, backend, leaseToken, reason = 'run finished' }) {
  const prior = bindingToReattach(store.events(runId));
  if (!prior) return { released: false };
  let detail = reason;
  if (typeof backend?.release === 'function') {
    const r = await backend.release();
    detail = `${reason}: ${r.reason}`;
  }
  try {
    store.append(runId, 'resource.released', { resource_id: prior.resource_id, reason: detail },
      { leaseToken });
  } catch (err) {
    if (err instanceof LeaseLostError)
      return { released: false, resource_id: prior.resource_id, reason: 'lease lost before release' };
    throw err;
  }
  return { released: true, resource_id: prior.resource_id };
}

export { resourceId, projectResources, bindingToReattach, ResourceKind, BindingState };
