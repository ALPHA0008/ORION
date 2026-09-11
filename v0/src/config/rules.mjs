// W8 — the permission rule file: the authorizer's knobs, without code.
//
// WHAT THIS IS AND IS NOT
//
// `createAuthorizer` has always taken `denyTools`, `escalateTools`, `denyCommandPatterns` and
// `protectedPaths`. Until now the only way to set them was to edit `src/cli/index.mjs`, which
// means a deployer with a policy ("never `git push`", "never touch `migrations/`") had to fork the
// runtime. This file exposes those EXACT knobs. It does not add a policy engine, it does not
// change how a decision is reached, and it cannot introduce a new decision kind — plan §13's rule
// is that policy is maintained, not weakened, and the way to honour that is to expose what exists
// rather than to invent alongside it.
//
// THE ONE DIRECTION RULES MAY MOVE
//
// `auth/default` composes postures as a FLOOR: a narrower scope may only RAISE strictness. A rule
// file must obey the same lattice, and here that has a concrete consequence worth stating —
// **there is no `allowTools`, and there is deliberately no way to un-deny anything.** Every
// directive below can only add a denial, an escalation, or a protection. A deployer who wants
// more permission changes the posture (which is derived from the sandbox boundary, W6-G) or the
// grant store (W6-M, which is auditable and revocable); they do not get a file that quietly
// widens what an agent may do, because a file that can widen permission is a file an attacker
// wants to write to.

import fs from 'node:fs';
import path from 'node:path';

export class RuleError extends Error {
  /** @param {string} message @param {{ field?: string, file?: string }} [info] */
  constructor(message, { field = null, file = null } = {}) {
    super(message);
    this.name = 'RuleError';
    this.field = field;
    this.file = file;
  }
}

/**
 * Directives, and the knob each maps to.
 *
 * Every one of these RESTRICTS. That is the whole design constraint, and it is checked by the
 * absence of any permitting directive rather than by a runtime guard — a knob that cannot be
 * expressed cannot be misused.
 */
export const RULE_SCHEMA = Object.freeze({
  denyTools: { of: 'string',
    describe: 'tool names that may never run, at any posture' },
  escalateTools: { of: 'string',
    describe: 'tool names that always require a human' },
  denyCommandPatterns: { of: 'regex',
    describe: 'regular expressions; any command-bearing tool whose command matches is denied' },
  protectedPaths: { of: 'regex',
    describe: 'regular expressions; mutating a matching path always escalates' },
});

export function ruleSearchPaths({ workspace = null, home = null } = {}) {
  const out = [];
  if (home) out.push({ scope: 'user', file: path.join(home, 'rules.json') });
  if (workspace) out.push({ scope: 'project', file: path.join(workspace, '.orion-rules.json') });
  return out;
}

/** Compile one pattern, with an error that names the offending value rather than the field alone. */
function compilePattern(value, field, file) {
  if (typeof value !== 'string')
    throw new RuleError(`${file}: \`${field}\` entries must be strings, got ${typeof value}`,
      { field, file });
  try { return new RegExp(value); }
  catch (e) {
    throw new RuleError(`${file}: \`${field}\` contains an invalid regular expression `
      + `${JSON.stringify(value)} — ${String(e.message ?? e)}`, { field, file });
  }
}

/** Read and validate one rule file. Returns null when absent. */
export function readRuleFile(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return null; }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) {
    throw new RuleError(`${file} is not valid JSON: ${String(e.message ?? e)}`, { file });
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    throw new RuleError(`${file} must contain a JSON object`, { file });

  const out = { denyTools: [], escalateTools: [], denyCommandPatterns: [], protectedPaths: [] };
  for (const [key, value] of Object.entries(data)) {
    const spec = RULE_SCHEMA[key];
    if (!spec) {
      // Named refusal for the thing a deployer will reach for first, because "why can't I allow
      // a tool?" deserves an answer rather than a generic unknown-key error.
      if (/^allow/i.test(key))
        throw new RuleError(
          `${file}: \`${key}\` is not supported. Rules may only RAISE strictness — they cannot `
          + `grant permission. Widen access by choosing a sandbox that earns a more permissive `
          + `posture (ORION_SANDBOX=container), or by recording a grant (orionctl answer `
          + `--remember), which is auditable and revocable.`, { field: key, file });
      throw new RuleError(
        `${file}: unknown rule \`${key}\`. Known rules: ${Object.keys(RULE_SCHEMA).join(', ')}`,
        { field: key, file });
    }
    if (!Array.isArray(value))
      throw new RuleError(`${file}: \`${key}\` must be an array`, { field: key, file });
    out[key] = spec.of === 'regex'
      ? value.map(v => compilePattern(v, key, file))
      : value.map(v => {
          if (typeof v !== 'string')
            throw new RuleError(`${file}: \`${key}\` entries must be strings`, { field: key, file });
          return v;
        });
  }
  return out;
}

/**
 * Resolve rules across the ladder.
 *
 * Rules are UNIONED rather than overridden, which is the only composition consistent with
 * "may only raise strictness": if a user-level rule denies `bash` and a project file does not
 * mention it, the project has not permitted it — it has said nothing, and silence must not
 * relax a restriction that already exists.
 *
 * @returns {{ rules: any, files: {scope:string,file:string}[], errors: RuleError[] }}
 */
export function resolveRules({ workspace = null, home = null } = {}) {
  const rules = { denyTools: [], escalateTools: [], denyCommandPatterns: [], protectedPaths: [] };
  const files = [];
  const errors = [];

  for (const { scope, file } of ruleSearchPaths({ workspace, home })) {
    let data;
    try { data = readRuleFile(file); }
    catch (e) { errors.push(e); continue; }
    if (!data) continue;
    files.push({ scope, file });
    for (const k of Object.keys(rules)) rules[k].push(...data[k]);
  }

  // De-duplicate the name lists; patterns are compiled objects and are left as-is.
  rules.denyTools = [...new Set(rules.denyTools)];
  rules.escalateTools = [...new Set(rules.escalateTools)];
  return { rules, files, errors };
}

/** Whether any rule is actually in force — used to keep the CLI's default path untouched. */
export const hasRules = (r) =>
  !!(r && (r.denyTools.length || r.escalateTools.length
        || r.denyCommandPatterns.length || r.protectedPaths.length));

/** Human summary for `orionctl config`. */
export function describeRules({ workspace = null, home = null } = {}) {
  const { rules, files, errors } = resolveRules({ workspace, home });
  const lines = [];
  lines.push(files.length
    ? `rule files: ${files.map(f => `${f.scope} → ${f.file}`).join(', ')}`
    : 'rule files: none found (code defaults only)');
  if (hasRules(rules)) {
    for (const k of Object.keys(rules)) {
      if (!rules[k].length) continue;
      lines.push(`  ${k.padEnd(20)} ${rules[k].map(String).join(', ')}`);
    }
  }
  return { text: lines.join('\n'), rules, files, errors };
}
