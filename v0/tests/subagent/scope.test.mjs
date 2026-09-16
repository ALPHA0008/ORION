// W10 — delegation policy: what a child may do, and what it can never do.
//
// This is the security suite of the wave. Delegation is the most attractive privilege-escalation
// route in an agent runtime: a model that cannot run `bash` has an obvious move available if
// spawning a child could grant it one. So these tests assert ABSENCES as hard as presences —
// there must be no path that removes a denial, lowers a posture, or grants a tool the parent
// never held.
//
// Everything here is pure: no store, no model, no sandbox. The policy has to be checkable without
// running anything, because "we tested it end to end once" is not an argument about a lattice.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChildTools, childAuthOptions, narrowestPosture, mutatingGrants,
         DEFAULT_CHILD_TOOLS, CHILD_FORBIDDEN_TOOLS, ScopeError } from '../../src/core/child/scope.mjs';
import { resolveQuota, canSpawn, QuotaKind, MAX_LIVE_CHILDREN, MAX_CHILD_DEPTH,
         MAX_CHILDREN_PER_RUN, DEFAULT_CHILD_BUDGET, CHILD_TIMEOUT_MS,
         CHILD_MAX_TURNS } from '../../src/core/child/quota.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { makeTools, mutatingTools } from '../../src/agent/tools/index.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';
import fs from 'node:fs'; import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mk = (t) => fs.mkdtempSync(path.join(os.tmpdir(), `w10s-${t}-`));
const PARENT = makeTools(new LocalSandbox(mk('ws')));

// ═══════════════════════════════════════════ posture
describe('w10/scope: a child inherits a posture floor and can only go STRICTER');
{
  // Plan §13, verbatim: "a child inherits a posture, it never widens it."
  eq('an auto parent asking for permissive stays auto', narrowestPosture('auto', 'permissive'), 'auto');
  eq('a strict parent asking for auto stays strict', narrowestPosture('strict', 'auto'), 'strict');
  eq('a strict parent asking for permissive stays strict',
    narrowestPosture('strict', 'permissive'), 'strict');

  // The direction that IS allowed, because it is always safe.
  eq('an auto parent may run a strict child', narrowestPosture('auto', 'strict'), 'strict');
  eq('a permissive parent may run a strict child', narrowestPosture('permissive', 'strict'), 'strict');
  eq('no request means the parent posture', narrowestPosture('auto', null), 'auto');
  eq('...for a permissive parent too', narrowestPosture('permissive', null), 'permissive');

  let e = null;
  try { narrowestPosture('auto', 'yolo'); } catch (err) { e = err; }
  check('an unknown posture is refused, not silently ignored', e instanceof ScopeError);
  check('...naming the accepted values', /permissive.*auto.*strict/.test(String(e?.message)));

  // An unknown PARENT posture degrades to `auto` rather than to nothing, because a missing value
  // must never read as "no restriction".
  eq('an unknown parent posture degrades to auto, never to permissive',
    narrowestPosture(undefined, null), 'auto');
}

// ═══════════════════════════════════════════ toolset
describe('w10/scope: a child is read-only by default');
{
  const { tools, granted } = resolveChildTools(PARENT, null);
  const mut = mutatingTools(tools);
  eq('no mutating tool is granted by default', mut.size, 0, [...mut].join(','));
  check('...and the read-only floor IS granted',
    ['read', 'grep', 'glob'].every(n => granted.includes(n)), granted.join(','));
  check('every default tool is one the parent holds',
    DEFAULT_CHILD_TOOLS.every(n => !(n in PARENT) || granted.includes(n)));

  // Default-deny on mutation is what makes the grant visible in `child.spawned.scopes`. An
  // inherited-by-default `write` would be invisible in the log and identical in shape to an
  // escalation.
  check('`write` is absent unless asked for', !granted.includes('write'));
  check('`bash` is absent unless asked for', !granted.includes('bash'));
}

describe('w10/scope: a parent can grant only what it holds');
{
  const { tools, granted, refused } = resolveChildTools(PARENT, ['read', 'write', 'bash']);
  check('an explicitly granted mutating tool IS granted', granted.includes('write'));
  eq('...and appears in the mutating summary', mutatingGrants(tools).includes('write'), true);
  eq('nothing was refused for a parent that holds all three', refused.length, 0);

  // THE rule that makes "a child cannot widen" structural rather than a check someone could
  // forget. The parent cannot delegate a capability it does not have.
  const poor = { read: PARENT.read, grep: PARENT.grep };
  const r2 = resolveChildTools(poor, ['read', 'bash', 'mcp__evil__exec']);
  check('a tool the parent lacks is refused', !r2.granted.includes('bash'), r2.granted.join(','));
  check('...and an MCP tool it lacks is refused too', !r2.granted.includes('mcp__evil__exec'));
  eq('...both reported', r2.refused.length, 2);
  check('...explaining that the parent does not have it',
    r2.refused.every(x => /does not have/.test(x.why)), JSON.stringify(r2.refused));

  // `ask_user` would park the child waiting for a human it cannot reach while the parent blocks
  // on the child — a deadlock with no participant able to break it.
  const r3 = resolveChildTools(PARENT, ['read', 'ask_user']);
  check('`ask_user` is refused even though the parent has it', !r3.granted.includes('ask_user'));
  check('...explaining the deadlock', /deadlock/.test(r3.refused[0]?.why ?? ''), r3.refused[0]?.why);
  eq('the forbidden list is declared once', CHILD_FORBIDDEN_TOOLS.includes('ask_user'), true);

  // FOUND BY THIS SUITE. The parent's denial reached the child's AUTHORIZER but not its TOOLSET,
  // so a run that denies `bash` would still have offered `bash` to its child — policy would have
  // refused the call, but only after the model spent a turn discovering that delegation is a
  // dead end. Both halves are needed: the authorizer is the guarantee, the toolset is the reason
  // the model never tries.
  const denied = resolveChildTools(PARENT, ['read', 'bash'], { denyTools: ['bash'] });
  check('a tool the PARENT denies is not offered to the child', !denied.granted.includes('bash'),
    denied.granted.join(','));
  check('...saying delegation is not a way around a denial',
    /cannot be a way around a denial/.test(denied.refused[0]?.why ?? ''), denied.refused[0]?.why);
  check('...while the rest of the grant survives', denied.granted.includes('read'));
  eq('a denied tool is not restored by the read-only floor either',
    resolveChildTools(PARENT, ['nope'], { denyTools: ['read'] }).granted.includes('read'), false);

  // A toolless child looks exactly like a broken one, so the read-only floor is restored rather
  // than leaving it blind.
  const r4 = resolveChildTools(PARENT, ['nothing_real']);
  check('a child whose every request was refused still gets the read-only floor',
    r4.granted.includes('read'), r4.granted.join(','));
  eq('...and still nothing mutating', mutatingTools(r4.tools).size, 0);
}

describe('w10/scope: the AUTHORIZER agrees with the toolset (defence in depth)');
{
  const { granted } = resolveChildTools(PARENT, ['read', 'grep']);
  const opts = childAuthOptions(
    { availableTools: Object.keys(PARENT), denyTools: [], escalateTools: [],
      denyCommandPatterns: [], protectedPaths: [] },
    { granted, posture: 'auto' });
  const az = createAuthorizer(opts);
  const ctx = { run_id: 'r', project: '/p' };

  // Restricting the toolset changes what the model is OFFERED. It is not by itself a policy
  // decision — so an ungranted tool must also be DENIED, in case a call for it ever arrives by
  // another route (a replayed log, a crafted argument, a future code path).
  eq('an ungranted tool is denied by policy, not merely absent',
    az({ kind: 'tool', name: 'bash', args_digest: 'x', effects: 'Mutating', command: 'ls' }, ctx).decision,
    'deny');
  eq('...and so is `write`',
    az({ kind: 'tool', name: 'write', args_digest: 'x', effects: 'Mutating', path: 'a.txt' }, ctx).decision,
    'deny');
  eq('a granted read-only tool is allowed',
    az({ kind: 'tool', name: 'read', args_digest: 'x', effects: 'ReadOnly', path: 'a.txt' }, ctx).decision,
    'allow');

  // The parent's own denials survive into the child: union, never replacement.
  const strictParent = childAuthOptions(
    { availableTools: Object.keys(PARENT), denyTools: ['grep'], escalateTools: ['read'],
      denyCommandPatterns: [/\bgit\s+push\b/], protectedPaths: ['(^|/)secrets/'] },
    { granted: ['read', 'grep'], posture: 'auto' });
  check('a parent denial is inherited', strictParent.denyTools.includes('grep'));
  check('a parent escalation is inherited', strictParent.escalateTools.includes('read'));
  eq('a parent command pattern is inherited', strictParent.denyCommandPatterns.length, 1);
  eq('a parent protected path is inherited', strictParent.protectedPaths.length, 1);

  // A child starts COLD. Otherwise "approve this once" silently becomes "approve this for every
  // child the model later decides to spawn", which is not what the human agreed to.
  eq('a child inherits NO grants', strictParent.grants, null);
}

describe('w10/scope: there is no code path that widens a child');
{
  // Structural: the options a child is built with may only ever be a superset of denials and a
  // non-lower posture. Asserted by construction over many shapes rather than by inspection.
  const parentOpts = {
    availableTools: Object.keys(PARENT),
    denyTools: ['bash'], escalateTools: ['write'],
    denyCommandPatterns: [/x/], protectedPaths: ['y'],
  };
  for (const req of [null, ['read'], ['read', 'write', 'bash'], ['ask_user'], []]) {
    const { granted } = resolveChildTools(PARENT, req, { denyTools: parentOpts.denyTools });
    const opts = childAuthOptions(parentOpts, { granted, posture: 'auto' });
    check(`denials never shrink for ${JSON.stringify(req)}`,
      parentOpts.denyTools.every(d => opts.denyTools.includes(d)), opts.denyTools.join(','));
    check(`...escalations never shrink for ${JSON.stringify(req)}`,
      parentOpts.escalateTools.every(d => opts.escalateTools.includes(d)));
    check(`...and a denied parent tool is never granted for ${JSON.stringify(req)}`,
      !granted.includes('bash'));
  }
}

// ═══════════════════════════════════════════ quotas
describe('w10/quota: the shipped ceilings are small and declared');
{
  // "Parallelism designed, not assumed" (plan §10.2 W10). Two, not ten: one is not parallelism,
  // and ten is a thundering herd against a single-file store and one container's CPU quota.
  eq('at most 2 live children', MAX_LIVE_CHILDREN, 2);
  eq('delegation is at most 2 deep', MAX_CHILD_DEPTH, 2);
  eq('at most 8 children per run', MAX_CHILDREN_PER_RUN, 8);
  eq('a child gets a smaller budget than a parent', DEFAULT_CHILD_BUDGET.tokens, 120_000);
  check('...smaller than the worker default of 500k', DEFAULT_CHILD_BUDGET.tokens < 500_000);
  eq('a child has a wall clock', CHILD_TIMEOUT_MS, 10 * 60_000);
  eq('a child has fewer turns than a parent', CHILD_MAX_TURNS, 20);
  check('...fewer than the parent default of 40', CHILD_MAX_TURNS < 40);
}

describe('w10/quota: config may only make the ceilings SMALLER');
{
  const raised = resolveQuota({ maxLiveChildren: 50, maxChildren: 999, maxDepth: 9,
                                budget: { tokens: 10_000_000 } });
  eq('a raised live limit is clamped', raised.maxLive, MAX_LIVE_CHILDREN);
  eq('...a raised total is clamped', raised.maxTotal, MAX_CHILDREN_PER_RUN);
  eq('...a raised depth is clamped', raised.maxDepth, MAX_CHILD_DEPTH);
  eq('...and a raised token budget is clamped', raised.budget.tokens, DEFAULT_CHILD_BUDGET.tokens);

  const lowered = resolveQuota({ maxLiveChildren: 1, maxChildren: 2, maxDepth: 1,
                                 budget: { tokens: 1000 } });
  eq('a lowered live limit is honoured', lowered.maxLive, 1);
  eq('...a lowered total is honoured', lowered.maxTotal, 2);
  eq('...a lowered depth is honoured', lowered.maxDepth, 1);
  eq('...and a lowered budget is honoured', lowered.budget.tokens, 1000);

  const nonsense = resolveQuota({ maxLiveChildren: -5, maxChildren: 0, maxDepth: 'x' });
  eq('a nonsense value falls back to the ceiling, never to unlimited',
    nonsense.maxLive, MAX_LIVE_CHILDREN);
  eq('...for zero too', nonsense.maxTotal, MAX_CHILDREN_PER_RUN);
  eq('...and for a non-number', nonsense.maxDepth, MAX_CHILD_DEPTH);
  eq('an empty config is all defaults', resolveQuota().maxLive, MAX_LIVE_CHILDREN);
}

describe('w10/quota: spawning is refused for a named reason, from the LOG');
{
  const quota = resolveQuota();
  const spawn = (id) => ({ type: 'child.spawned', seq: 1, payload: { parent_run: 'p', child_run: id } });
  const finish = (id, status = 'completed', tokens = 0) =>
    ({ type: 'child.finished', seq: 2, payload: { parent_run: 'p', child_run: id, status, tokens } });

  eq('an empty log may spawn', canSpawn([], { quota, depth: 1 }).ok, true);

  const twoLive = [spawn('c1'), spawn('c2')];
  const live = canSpawn(twoLive, { quota, depth: 1 });
  eq('a third concurrent child is refused', live.ok, false);
  eq('...for the live-count reason', live.kind, QuotaKind.TOO_MANY_LIVE);
  check('...telling the model what to do', /wait for one to finish/.test(live.reason), live.reason);

  // Finishing one frees the slot — the counter is a FOLD, so this is automatic.
  eq('finishing one frees a slot',
    canSpawn([...twoLive, finish('c1')], { quota, depth: 1 }).ok, true);

  const many = [];
  for (let i = 0; i < MAX_CHILDREN_PER_RUN; i++) { many.push(spawn(`c${i}`), finish(`c${i}`)); }
  const total = canSpawn(many, { quota, depth: 1 });
  eq('the lifetime total is enforced even when none are live', total.ok, false);
  eq('...for the total reason', total.kind, QuotaKind.TOO_MANY_TOTAL);

  const deep = canSpawn([], { quota, depth: MAX_CHILD_DEPTH + 1 });
  eq('a grandchild beyond the depth ceiling is refused', deep.ok, false);
  eq('...for the depth reason', deep.kind, QuotaKind.TOO_DEEP);
  eq('a grandchild WITHIN the ceiling is allowed (scope §6)',
    canSpawn([], { quota, depth: 2 }).ok, true);

  // The aggregate budget. Without this, delegation is a way to spend without limit: ten children
  // at the per-child cap would cost ten times the parent's ceiling while the parent's own counter
  // reads nearly zero.
  const spent = [spawn('c1'), finish('c1', 'completed', 100_000)];
  const budgeted = canSpawn(spent, { quota, depth: 1,
    parentBudget: { tokens: 150_000 }, parentTokens: 10_000 });
  eq('delegated tokens count against the parent budget', budgeted.ok, false);
  eq('...for the budget reason', budgeted.kind, QuotaKind.BUDGET);
  check('...showing the arithmetic', /110000 tokens/.test(budgeted.reason), budgeted.reason);

  eq('a generous budget still permits spawning',
    canSpawn(spent, { quota, depth: 1, parentBudget: { tokens: 5_000_000 }, parentTokens: 10_000 }).ok,
    true);
  eq('no declared budget does not block', canSpawn([], { quota, depth: 1 }).ok, true);
}

process.exit(summary('w10 scope', path.join(HERE, '..', 'results-w10-scope.json')) ? 1 : 0);
