// W6 C + D — resource identity and lifecycle, as a DERIVED projection over the event log.
//
// THE ARCHITECTURAL POINT (plan §9.3)
//
// The prior art for this is TrueForge's `TurnResourceResolver`, which reattaches a sandbox via
// `existing.sandbox_id`. Its mechanism is right and its STORAGE is wrong for ORION: it keeps the
// identity in a mutable `TurnRecord.snapshot` — state beside the log. Copying that shape would
// violate Invariant 1 (`Store.append` is the only mutation path) and make replay
// non-deterministic, because the binding a replay reconstructed would depend on whatever the
// snapshot happened to hold rather than on the events.
//
// So the current binding is a FOLD, exactly as `plan.*` works for plans. Everything follows:
//
//   - a binding survives a crash, because the worker holds none of it;
//   - `resume` reconstructs the identical binding, because it folds the same events;
//   - `replay` and `fork` reconstruct it too, at zero model cost;
//   - losing a resource cannot be silent, because `resource.lost` is appended, never overwritten.
//
// WHAT A RESOURCE IS
//
// Anything with durable identity and a lifecycle that a run binds to and that can outlive — or
// fail to outlive — the process. In W6 that is exactly one thing: the sandbox/workspace. MCP
// sessions (W9) are the next, which is why resource identity gates MCP rather than the reverse.
//
// WHY IDENTITY IS CONTENT-DERIVED, NOT RANDOM
//
// `resourceId()` hashes the things that make a workspace THAT workspace — its kind, its canonical
// path, and the run it belongs to. A random uuid would also be durable, but it could not answer
// the question recovery actually asks: "is the thing in front of me the thing I was bound to?"
// A derived id can be recomputed from the world and compared, so reattachment is verifiable
// rather than asserted. The run id is included so two runs over the same directory are distinct
// resources — they are, because each holds its own lease and its own checkpoint history.

import crypto from 'node:crypto';
import path from 'node:path';

/** Resource kinds. Deliberately small — a kind is added when a resource type is, not before. */
export const ResourceKind = Object.freeze({
  WORKSPACE: 'workspace',
  // W9 — an MCP session is a resource in exactly this sense: acquired, reattached, released or
  // lost, with a derived identity. Declaring the kind here rather than writing `'mcp'` at each
  // append site is what lets `bindingToReattach` scope by kind instead of guessing from shape.
  MCP: 'mcp',
});

/** Lifecycle states a binding can be in, derived by the fold below. */
export const BindingState = Object.freeze({
  BOUND: 'bound',         // acquired (or reattached) and usable
  RELEASED: 'released',   // deliberately let go; terminal for this binding
  LOST: 'lost',           // expected and not found; the log records what was done about it
});

/**
 * A stable, recomputable identity for a resource.
 *
 * Canonicalised so that the same workspace does not hash differently because of a trailing
 * separator or a drive-letter case difference on Windows — a spurious identity mismatch would
 * make recovery "recreate with notice" when it should have reattached, which is a correctness
 * bug that would look like a cosmetic one.
 */
export function resourceId({ kind = ResourceKind.WORKSPACE, root, runId }) {
  if (typeof root !== 'string' || !root) throw new Error('resourceId needs a root path');
  if (typeof runId !== 'string' || !runId) throw new Error('resourceId needs a runId');
  const canon = path.resolve(root).replace(/[\\/]+$/, '').toLowerCase();
  const h = crypto.createHash('sha256')
    .update(kind).update('\0').update(canon).update('\0').update(runId)
    .digest('hex').slice(0, 16);
  return `res_${kind}_${h}`;
}

/**
 * Fold the resource events of a run into its current bindings.
 *
 * @param {Array<{type: string, payload?: any, seq?: number, at?: number}>} events
 * @returns {{ bindings: Record<string, any>, current: any|null, history: any[] }}
 */
export function projectResources(events) {
  /** @type {Record<string, any>} */
  const bindings = {};
  const history = [];
  let currentId = null;

  for (const e of events ?? []) {
    if (!e?.type?.startsWith('resource.')) continue;
    const p = e.payload ?? {};
    const id = p.resource_id;
    if (!id) continue;

    switch (e.type) {
      case 'resource.acquired': {
        bindings[id] = {
          resource_id: id,
          kind: p.kind ?? ResourceKind.WORKSPACE,
          backend: p.backend ?? null,
          root: p.root ?? null,
          container_path: p.container_path ?? null,
          // The durable way to FIND the resource again. A container id is assigned by the
          // runtime and is only discoverable by asking it about something; the name is the
          // something. Without this on the binding, a resumed run would construct a backend with
          // a fresh name and could never reattach to what it was actually bound to.
          handle_name: p.handle_name ?? null,
          handle: p.handle ?? null,
          capabilities: p.capabilities ?? null,
          posture: p.posture ?? null,
          state: BindingState.BOUND,
          acquired_at: e.at ?? null,
          acquired_seq: e.seq ?? null,
          reattach_count: 0,
          // A resource that has ever been reconstructed is NOT the same world the recovery
          // contract originally reasoned about. That fact is carried forward on the binding so a
          // consumer cannot read the current state and miss it.
          reconstructed: false,
          lost_reason: null,
        };
        currentId = id;
        break;
      }
      case 'resource.reattached': {
        // A reattach with no prior acquire is not nonsense — a log can be replayed from a
        // snapshot boundary — so synthesise the binding rather than dropping the event.
        const b = bindings[id] ?? {
          resource_id: id, kind: p.kind ?? ResourceKind.WORKSPACE, backend: p.backend ?? null,
          root: p.root ?? null, container_path: p.container_path ?? null,
          handle_name: p.handle_name ?? null, handle: p.handle ?? null,
          capabilities: p.capabilities ?? null, posture: p.posture ?? null,
          acquired_at: null, acquired_seq: null, reattach_count: 0,
          reconstructed: false, lost_reason: null,
        };
        bindings[id] = {
          ...b,
          state: BindingState.BOUND,
          // A reattach may legitimately carry a fresh capability/posture view (the backend was
          // re-probed), but it must never silently clear a `reconstructed` flag.
          capabilities: p.capabilities ?? b.capabilities,
          posture: p.posture ?? b.posture,
          handle_name: p.handle_name ?? b.handle_name,
          handle: p.handle ?? b.handle,
          reattach_count: (b.reattach_count ?? 0) + 1,
          reconstructed: b.reconstructed || p.reconstructed === true,
          lost_reason: null,
        };
        currentId = id;
        break;
      }
      case 'resource.released': {
        if (bindings[id]) bindings[id] = { ...bindings[id], state: BindingState.RELEASED };
        if (currentId === id) currentId = null;
        break;
      }
      case 'resource.lost': {
        // `resource.lost` records the loss AND the disposition. When the disposition was to
        // recreate, the binding stays usable but is permanently marked `reconstructed` — the run
        // continues on a world that is not provably the one it started on, and a reader must be
        // able to see that without reconstructing the history themselves.
        const b = bindings[id];
        const recreated = p.action === 'recreated';
        if (b) {
          bindings[id] = {
            ...b,
            state: recreated ? BindingState.BOUND : BindingState.LOST,
            reconstructed: b.reconstructed || recreated,
            // A recreate produces a NEW handle; carrying the dead one forward would make a later
            // reattach probe ask about something that no longer exists.
            handle_name: recreated ? (p.handle_name ?? b.handle_name) : b.handle_name,
            handle: recreated ? (p.handle ?? null) : b.handle,
            lost_reason: p.reason ?? 'unknown',
          };
        }
        if (!recreated && currentId === id) currentId = null;
        break;
      }
      default: break;   // another resource.* type would be a contract addition, not a surprise
    }

    history.push({ type: e.type, resource_id: id, seq: e.seq ?? null, at: e.at ?? null,
                   reason: p.reason ?? null, action: p.action ?? null });
  }

  return { bindings, current: currentId ? bindings[currentId] : null, history };
}

/** The binding a resume should try to reattach to, or null when there is nothing to reattach. */
export function bindingToReattach(events, { kind = ResourceKind.WORKSPACE } = {}) {
  // KIND-SCOPED since W9, and this is a correctness fix rather than a generalisation.
  //
  // Until W9 a run bound exactly one resource, so "the current binding" and "the workspace
  // binding" were the same thing and `current` could stand in for both. MCP sessions are also W6
  // resources and are acquired AFTER the workspace, so `current` became the MCP session — and
  // `resolveResource` then compared the workspace's derived id against an MCP id, found a
  // mismatch, and would have declared the workspace lost on every resumed run that used a server.
  // Measured directly in the W9 gate before this fix.
  //
  // Scoping by kind restores the original meaning exactly: a log with only workspace resources
  // folds to the same answer it always did.
  const { bindings } = projectResources(events);
  let best = null;
  for (const b of Object.values(bindings)) {
    if (b.kind !== kind || b.state !== BindingState.BOUND) continue;
    if (!best || (b.acquired_seq ?? 0) >= (best.acquired_seq ?? 0)) best = b;
  }
  return best;
}

/** One-line human summary, for `explain`. */
export function summariseResources(events) {
  const { bindings } = projectResources(events);
  const rows = Object.values(bindings);
  if (!rows.length) return null;
  return rows.map((b) => {
    const marks = [];
    if (b.reattach_count) marks.push(`reattached ${b.reattach_count}x`);
    if (b.reconstructed) marks.push('RECONSTRUCTED');
    if (b.lost_reason) marks.push(`lost: ${b.lost_reason}`);
    return `${b.resource_id} ${b.kind}/${b.backend ?? '?'} ${b.state}`
         + (marks.length ? ` (${marks.join(', ')})` : '');
  }).join('\n');
}
