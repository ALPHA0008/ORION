// W10 — what a child is allowed to do, and why it can never be more than its parent.
//
// THE ONE INVARIANT THIS FILE EXISTS TO ENFORCE
//
// Plan §13: "a child inherits a posture, it never widens it." Delegation is the most attractive
// possible privilege-escalation route in an agent runtime — a model that cannot run `bash` has an
// obvious move available if spawning a child could grant it one. So the parent's policy is a
// FLOOR, and every operation here is intersection or union-toward-strictness. There is deliberately
// no code path that removes a denial, lowers a posture, or grants a tool the parent lacked, and
// the tests assert the ABSENCE as much as the presence.
//
// WHY DEFAULT-DENY ON MUTATION
//
// A child starts read-only (scope §1: "default = read-only + verify; mutating tools must be
// explicitly granted by the parent"). That is not timidity: the parent model chooses the grant,
// and a model that has to name `write` explicitly has made a decision a reviewer can see in
// `child.spawned.scopes`. An inherited-by-default mutation capability would be invisible in the
// log and identical in shape to an escalation.

import { EFFECTS } from '../../agent/tools/index.mjs';

/** Postures, weakest to strictest. Duplicated nowhere — this is the ordering authority for W10. */
const RANK = Object.freeze({ permissive: 0, auto: 1, strict: 2 });

/** Tools a child may always use: they read the world and cannot change it. */
export const DEFAULT_CHILD_TOOLS = Object.freeze([
  'read', 'grep', 'glob', 'git', 'verify', 'plan', 'plan_step',
]);

/**
 * Tools a child may NEVER be granted, however the parent asks.
 *
 * `ask_user` pauses a run waiting for a human. A child is not attached to a terminal, so a child
 * that asks a question parks forever holding a lease and a quota slot while the parent blocks on
 * its result — a deadlock with no participant able to break it. The parent must ask on the
 * child's behalf.
 *
 * `subagent` at the leaf is bounded by depth rather than forbidden outright (scope §6 permits a
 * grandchild), so it is handled by the quota, not here.
 */
export const CHILD_FORBIDDEN_TOOLS = Object.freeze(['ask_user']);

export class ScopeError extends Error {
  /** @param {string} message @param {{ field?: string|null }} [info] */
  constructor(message, { field = null } = {}) {
    super(message);
    this.name = 'ScopeError';
    this.field = field;
  }
}

/**
 * The strictest of two postures.
 *
 * Used rather than "the child's posture" so that a parent running `strict` cannot spawn a child
 * running `auto`. The child may ask to be STRICTER than its parent, which is always safe.
 */
export function narrowestPosture(parent, requested) {
  const p = RANK[parent] === undefined ? 'auto' : parent;
  if (!requested) return p;
  if (RANK[requested] === undefined)
    throw new ScopeError(`unknown posture \`${requested}\` — use permissive, auto or strict`,
      { field: 'posture' });
  return RANK[requested] > RANK[p] ? requested : p;
}

/**
 * Resolve the toolset a child may use.
 *
 * `available` is the parent's own composed toolset, so a tool the parent does not have cannot be
 * granted to a child no matter what the model asks for — including MCP tools, which are named
 * `mcp__server__tool` and are subject to exactly the same rule as everything else.
 *
 * @param {Record<string, any>} available the parent's composed tools
 * @param {string[]|null} requested tool names the parent explicitly grants
 * @returns {{ tools: Record<string, any>, granted: string[], refused: {name: string, why: string}[] }}
 */
export function resolveChildTools(available, requested = null, { denyTools = [] } = {}) {
  const parentNames = new Set(Object.keys(available ?? {}));
  // The parent's own denials remove the tool from the child's TOOLSET, not merely from its policy.
  // Both halves are needed and they do different jobs: the authorizer refusal is the guarantee,
  // and this is the reason the model is never offered a tool that would be refused — an offered-
  // then-denied tool costs a turn and teaches the model the runtime is unreliable.
  const denied = new Set(denyTools.map(String));
  const wanted = Array.isArray(requested) && requested.length
    ? requested.map(String)
    : DEFAULT_CHILD_TOOLS.filter(n => parentNames.has(n));

  /** @type {Record<string, any>} */
  const tools = {};
  const granted = [];
  const refused = [];

  for (const name of wanted) {
    if (CHILD_FORBIDDEN_TOOLS.includes(name)) {
      refused.push({ name, why: `\`${name}\` would park the child waiting for a human it cannot `
        + `reach, deadlocking the parent that is waiting for the child` });
      continue;
    }
    if (!parentNames.has(name)) {
      // The parent cannot delegate what it does not hold. This is the rule that makes the
      // "child cannot widen" claim structural rather than a check someone could forget.
      refused.push({ name, why: `the parent run does not have \`${name}\`, so it cannot grant it` });
      continue;
    }
    if (denied.has(name)) {
      refused.push({ name, why: `\`${name}\` is denied by this run's own policy, and delegation `
        + `cannot be a way around a denial` });
      continue;
    }
    tools[name] = available[name];
    granted.push(name);
  }

  // A child with no tools at all can still think and answer, but it cannot look at anything, and a
  // silently toolless child looks exactly like a broken one. Give it the read-only floor back.
  if (!granted.length) {
    for (const name of DEFAULT_CHILD_TOOLS) {
      if (!parentNames.has(name) || denied.has(name)) continue;
      tools[name] = available[name];
      granted.push(name);
    }
  }

  return { tools, granted, refused };
}

/** Which of a child's granted tools can change the world — recorded at spawn, for the reviewer. */
export function mutatingGrants(tools) {
  return Object.entries(tools ?? {})
    .filter(([, t]) => t?.effects === EFFECTS.MUTATING)
    .map(([name]) => name)
    .sort();
}

/**
 * Compose the child's authorizer options from the parent's.
 *
 * Every field moves in ONE direction:
 *   - posture   → the stricter of the two
 *   - denyTools → union (parent's denials plus whatever the child adds, plus every tool the
 *                 parent holds that was not granted to the child)
 *   - patterns  → union
 *
 * The third of those is the important one and the least obvious. Restricting the child's TOOLSET
 * is not by itself a policy decision — it changes what the model is offered, not what the
 * authorizer would permit. If a child somehow emitted a call to an ungranted tool (a replayed log,
 * a crafted argument, a future code path), the authorizer must still refuse it. So the ungranted
 * names are added as explicit denials: defence in depth, where the depth is "the policy engine
 * agrees with the toolset".
 */
export function childAuthOptions(parentOpts, { granted, posture }) {
  const parentTools = new Set(parentOpts?.availableTools ?? []);
  const grantedSet = new Set(granted ?? []);
  const ungranted = [...parentTools].filter(n => !grantedSet.has(n));

  return {
    posture,
    denyTools: [...new Set([...(parentOpts?.denyTools ?? []), ...ungranted,
                            ...CHILD_FORBIDDEN_TOOLS])],
    escalateTools: [...new Set(parentOpts?.escalateTools ?? [])],
    denyCommandPatterns: [...(parentOpts?.denyCommandPatterns ?? [])],
    protectedPaths: [...(parentOpts?.protectedPaths ?? [])],
    // NO `grants`. A child starts COLD (scope §4): approvals a human gave the parent do not carry
    // into delegated work. Otherwise "approve this once" would silently become "approve this for
    // every child the model later decides to spawn", which is not what the human agreed to.
    grants: null,
  };
}
