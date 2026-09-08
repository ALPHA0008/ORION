// W6 G — posture DERIVED from the boundary, not configured.
//
// THE PROBLEM THIS SOLVES (plan §13)
//
// Posture used to be a flag someone set. That made it a guess: `--posture permissive` asserted
// that running arbitrary commands was acceptable, and nothing checked whether anything actually
// made it acceptable. The consequence ran the other way too, and it is the one users feel —
// because `LocalSandbox` has no isolation and `classifyShell` is correctly default-deny, every
// ordinary `npm test` came back UNSAFE and escalated. Autonomy was unreachable except by turning
// the policy down, which is the wrong lever: it makes the runtime quieter without making anything
// safer.
//
// So posture becomes a CONSEQUENCE. The backend declares what it guarantees (W6-A), and the
// posture follows from that declaration:
//
//   isolated (container)   ⇒ permissive — the blast radius is a container with no network
//   not isolated (local)   ⇒ auto       — the blast radius is the developer's machine
//
// WHAT ISOLATION DOES AND DOES NOT BUY, STATED HONESTLY
//
// It bounds blast radius. A command inside the container can, at worst, damage the workspace it
// was given — and the workspace is checkpointed, so that is recoverable. It cannot reach the host
// filesystem, and with `--network none` it cannot exfiltrate anything.
//
// It does NOT make an UNSAFE-to-retry command safe to retry. Those are different axes and
// collapsing them would be dishonest: `recovery_class` is about whether a crashed invocation can
// be reissued, and no boundary changes that. What isolation changes is whether a human needs to
// be asked BEFORE running it, which is the question posture actually governs. Recovery still
// classifies the same way and the crash matrix still makes the same decisions — verified, because
// if it did not, Q4 would have failed.
//
// WHAT NEVER MOVES
//
// Hard denials (`denyCommandPatterns`, `isKnownDangerous`) apply at every posture including
// permissive, and posture derivation cannot reach them. Autonomy is enabled by the boundary and
// by remembered approvals — never by weakening authorization (plan §13).

/** Ranked, so "the stricter of two postures" is well defined. */
export const POSTURE_RANK = Object.freeze({ permissive: 0, auto: 1, strict: 2 });

/**
 * Derive the posture a run should have, given the backend it will execute in.
 *
 * Returns the reason as well as the value, because an authorization decision the trajectory
 * cannot explain is not much better than one nobody made (Invariant 7). The reason string is
 * recorded on `resource.acquired`.
 *
 * @param {{ capabilities?: any, override?: string|null, env?: any }} opts
 * @returns {{posture: string, derived: boolean, reason: string, isolated: boolean}}
 */
export function derivePosture({ capabilities = null, override = null, env = process.env } = {}) {
  const isolated = capabilities?.isolated === true;
  const envOverride = override ?? (env?.ORION_POSTURE ? String(env.ORION_POSTURE).trim().toLowerCase() : null);

  // An operator override stays possible — deployments have reasons the runtime cannot see. But
  // it is recorded AS an override, so a reader can tell a derived posture from an asserted one.
  if (envOverride && envOverride in POSTURE_RANK) {
    const base = isolated ? 'permissive' : 'auto';
    // The override may only RAISE strictness relative to what the boundary earns. Letting it
    // lower the floor would reintroduce exactly the lever this part removes: declaring
    // `permissive` on an unisolated backend to silence escalation.
    const chosen = POSTURE_RANK[envOverride] >= POSTURE_RANK[base] ? envOverride : base;
    return {
      posture: chosen,
      derived: false,
      isolated,
      reason: chosen === envOverride
        ? `operator override: ${envOverride}`
        : `operator override '${envOverride}' ignored — it would lower the floor set by the `
          + `backend (${base}); posture may only be raised`,
    };
  }

  if (isolated) {
    return {
      posture: 'permissive',
      derived: true,
      isolated: true,
      reason: `backend declares isolation='${capabilities.isolation}' with network='${capabilities.network}'`
            + ` — commands are auto-allowed because the blast radius is the sandbox, not the host`,
    };
  }

  return {
    posture: 'auto',
    derived: true,
    isolated: false,
    reason: capabilities
      ? `backend declares isolation='${capabilities.isolation}' — path containment is not OS `
        + `isolation, so mutating and unsafe-to-retry commands still need a human`
      : 'no backend capabilities declared — assuming no isolation',
  };
}

/** The stricter of two postures. Postures compose as a FLOOR; a scope may only raise. */
export function strictest(a, b) {
  if (!a) return b; if (!b) return a;
  return (POSTURE_RANK[a] ?? 1) >= (POSTURE_RANK[b] ?? 1) ? a : b;
}
