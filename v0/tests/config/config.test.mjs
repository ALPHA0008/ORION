// W8 — configuration and permission rules.
//
// Two files, two very different risk profiles, and the tests reflect that.
//
// The CONFIG file is a convenience: getting it wrong costs a confusing run. Its rules are about
// clarity — env wins, unknown keys are errors rather than shrugs, and secrets are refused.
//
// The RULES file is policy: getting it wrong costs a security property. Its central invariant is
// that a rule may only RAISE strictness. There is deliberately no directive that can widen
// permission, and the tests assert the ABSENCE as well as the presence — a policy file that can
// grant is a file an attacker wants to write to.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfigFile, resolveConfig, describeConfig, configSearchPaths,
         CONFIG_SCHEMA, ConfigError } from '../../src/config/index.mjs';
import { readRuleFile, resolveRules, hasRules, describeRules, ruleSearchPaths,
         RULE_SCHEMA, RuleError } from '../../src/config/rules.mjs';
import { createAuthorizer, DEFAULT_DANGEROUS } from '../../src/auth/default/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w8c-${tag}-`));
const put = (dir, name, obj) => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  return p;
};

// ═══════════════════════════════════════════ layering
describe('w8/config: the environment always wins');
{
  const home = mk('home'); const work = mk('work');
  put(home, 'config.json', { model: 'user-model', posture: 'auto', provider: 'openai-compat' });
  put(work, '.orion.json', { model: 'project-model', baseUrl: 'http://project/v1' });

  const r = resolveConfig({ workspace: work, home, env: { ORION_MODEL: 'env-model' } });

  // The ordering that must not change: reversing it would break every existing deployment
  // SILENTLY — nothing errors, the run just quietly uses a different model.
  eq('env beats project', r.values.model, 'env-model');
  check('...and says so', /^env /.test(r.sources.model), r.sources.model);
  eq('project beats user', r.values.posture, 'auto');
  eq('...for a key only the project sets', r.values.baseUrl, 'http://project/v1');
  check('...attributed to the project file', /project/.test(r.sources.baseUrl), r.sources.baseUrl);
  eq('a user-only key survives', r.values.provider, 'openai-compat');
  check('...attributed to the user file', /user/.test(r.sources.provider), r.sources.provider);

  // Provenance is the point: "what will this run use, and why" must be answerable without
  // reading source.
  check('every value carries where it came from',
    Object.keys(r.values).every(k => typeof r.sources[k] === 'string'));

  eq('no files is not an error', resolveConfig({ workspace: mk('empty'), home: mk('empty2'), env: {} }).errors.length, 0);
}

describe('w8/config: a wrong file fails loudly, naming the field');
{
  const d = mk('bad');

  // A config file is meant to be committed. Accepting a literal key would put keys in version
  // control, and a comment saying "do not commit this" is not a mitigation.
  let e = null;
  try { readConfigFile(put(d, 'secret.json', { apiKey: 'sk-live-do-not-do-this' })); }
  catch (err) { e = err; }
  check('a literal apiKey is REFUSED', e instanceof ConfigError);
  eq('...naming the field', e.field, 'apiKey');
  check('...and teaching the alternative', /apiKeyEnv/.test(e.message), e.message);
  check('...without echoing the secret back', !/sk-live/.test(e.message), e.message);

  // A typo'd key that is silently ignored is a config file the operator believes is in force and
  // is not — the exact failure `orionctl config` exists to make impossible.
  e = null;
  try { readConfigFile(put(d, 'typo.json', { postures: 'auto' })); } catch (err) { e = err; }
  eq('an unknown key is an error, not a shrug', e?.field, 'postures');
  check('...listing what IS known', /posture/.test(e.message));

  e = null;
  try { readConfigFile(put(d, 'type.json', { model: 42 })); } catch (err) { e = err; }
  check('a wrong type is caught', e instanceof ConfigError);
  check('...naming the expected type', /must be a string/.test(e.message), e.message);

  e = null;
  try { readConfigFile(put(d, 'enum.json', { posture: 'yolo' })); } catch (err) { e = err; }
  check('an out-of-range enum is caught', e instanceof ConfigError);
  check('...listing the accepted values', /permissive.*auto.*strict/.test(e.message), e.message);

  e = null;
  try { readConfigFile(put(d, 'nested.json', { budget: { tokens: 'lots' } })); } catch (err) { e = err; }
  check('nested fields are typed too', /budget\.tokens/.test(String(e?.message)), String(e?.message));

  e = null;
  try { readConfigFile(put(d, 'broken.json', '{ not json')); } catch (err) { e = err; }
  check('malformed JSON is caught', e instanceof ConfigError);
  check('...naming the file', /broken\.json/.test(e.message));

  e = null;
  try { readConfigFile(put(d, 'array.json', '[1,2,3]')); } catch (err) { e = err; }
  check('a non-object file is caught', /must contain a JSON object/.test(String(e?.message)));

  eq('an absent file is simply absent', readConfigFile(path.join(d, 'nope.json')), null);
}

describe('w8/config: the effective view never prints a secret');
{
  const home = mk('h'); const work = mk('w');
  put(work, '.orion.json', { baseUrl: 'http://x/v1', model: 'm', apiKeyEnv: 'MY_KEY' });

  const set = describeConfig({ workspace: work, home, env: { MY_KEY: 'sk-super-secret-value' } });
  check('it reports the key as SET', /\(set\)/.test(set.text), set.text);
  check('...and never prints the value', !set.text.includes('sk-super-secret-value'), set.text);
  eq('...naming the variable it read', set.keyVar, 'MY_KEY');
  eq('...and the boolean is accurate', set.keySet, true);

  const unset = describeConfig({ workspace: work, home, env: {} });
  check('an absent key is reported as NOT SET', /\(NOT SET\)/.test(unset.text), unset.text);
  eq('...and the boolean agrees', unset.keySet, false);

  check('the resolved values are shown', /baseUrl/.test(set.text) && /http:\/\/x\/v1/.test(set.text));
  check('...with their source', /project/.test(set.text));
}

describe('w8/config: the schema documents the env var each key shadows');
{
  // The file layers UNDER the environment, so every file key that has an env equivalent must
  // name it — otherwise the layering is untestable and the docs are a second copy of the truth.
  for (const [key, spec] of Object.entries(CONFIG_SCHEMA)) {
    if (!spec.env) continue;
    check(`${key} names its env var`, /^ORION_/.test(spec.env), spec.env);
  }
  check('the search order is user then project', configSearchPaths({ workspace: '/w', home: '/h' })
    .map(x => x.scope).join(',') === 'user,project');
}

// ═══════════════════════════════════════════ rules
describe('w8/rules: a rule may only RAISE strictness');
{
  const d = mk('rules');

  // THE invariant. There is no `allowTools`, and asking for one gets an explanation rather than a
  // generic unknown-key error — because "how do I permit this?" is the question a deployer will
  // actually have, and the answer (a stronger sandbox, or an auditable grant) is the design.
  let e = null;
  try { readRuleFile(put(d, 'allow.json', { allowTools: ['bash'] })); } catch (err) { e = err; }
  check('allowTools is refused', e instanceof RuleError);
  check('...explaining that rules cannot grant', /cannot grant permission/.test(e.message), e.message);
  check('...and pointing at the two real levers', /container/.test(e.message) && /grant/.test(e.message));

  for (const widening of ['allowCommands', 'allowPaths', 'allowlist']) {
    let err = null;
    try { readRuleFile(put(d, `${widening}.json`, { [widening]: [] })); } catch (x) { err = x; }
    check(`${widening} is refused too`, err instanceof RuleError);
  }

  // Every accepted directive restricts. That is checked structurally rather than by inspection.
  for (const key of Object.keys(RULE_SCHEMA)) {
    check(`${key} is a restricting directive`, /^(deny|escalate|protected)/.test(key), key);
  }
}

describe('w8/rules: validation is loud, because failing open is the wrong direction');
{
  const d = mk('badrules');
  let e = null;
  try { readRuleFile(put(d, 'r1.json', { denyTools: 'bash' })); } catch (err) { e = err; }
  check('a non-array directive is caught', /must be an array/.test(String(e?.message)));

  e = null;
  try { readRuleFile(put(d, 'r2.json', { denyCommandPatterns: ['([unclosed'] })); } catch (err) { e = err; }
  check('an invalid regex is caught', e instanceof RuleError);
  check('...quoting the offending pattern', /\(\[unclosed/.test(e.message), e.message);
  eq('...and naming the directive', e.field, 'denyCommandPatterns');

  e = null;
  try { readRuleFile(put(d, 'r3.json', { denyTools: [42] })); } catch (err) { e = err; }
  check('a non-string tool name is caught', e instanceof RuleError);

  e = null;
  try { readRuleFile(put(d, 'r4.json', '{ oops')); } catch (err) { e = err; }
  check('malformed JSON is caught', /not valid JSON/.test(String(e?.message)));

  eq('an absent rule file is simply absent', readRuleFile(path.join(d, 'none.json')), null);
}

describe('w8/rules: scopes UNION rather than override');
{
  const home = mk('rh'); const work = mk('rw');
  put(home, 'rules.json', { denyTools: ['bash'], protectedPaths: ['(^|/)secrets/'] });
  put(work, '.orion-rules.json', { escalateTools: ['write'] });

  const { rules, files } = resolveRules({ workspace: work, home });
  eq('both files are read', files.length, 2);

  // Union, not override — the only composition consistent with "may only raise strictness". If a
  // project file replaced the user's, then saying nothing about `bash` would silently PERMIT it,
  // which is exactly the widening the design forbids.
  check('the user denial survives a project file that is silent about it',
    rules.denyTools.includes('bash'), JSON.stringify(rules.denyTools));
  check('...and the project escalation is added', rules.escalateTools.includes('write'));
  eq('...and the user protection survives', rules.protectedPaths.length, 1);
  check('hasRules reports correctly', hasRules(rules));
  check('...and is false for nothing', !hasRules(resolveRules({ workspace: mk('x'), home: mk('y') }).rules));

  const desc = describeRules({ workspace: work, home });
  check('the description names the files', /user/.test(desc.text) && /project/.test(desc.text));
  check('...and lists the rules', /bash/.test(desc.text));
}

describe('w8/rules: rules reach the authorizer and cannot displace the built-in denials');
{
  const home = mk('ah');
  put(home, 'rules.json', {
    denyTools: ['bash'],
    denyCommandPatterns: ['\\bgit\\s+push\\b'],
    protectedPaths: ['(^|/)migrations/'],
  });
  const { rules } = resolveRules({ workspace: mk('aw'), home });

  // Composed the way the CLI composes it: the deployer's patterns are CONCATENATED with the
  // built-in one, never substituted for it.
  const az = createAuthorizer({
    posture: 'auto',
    denyTools: rules.denyTools,
    escalateTools: rules.escalateTools,
    denyCommandPatterns: [DEFAULT_DANGEROUS, ...rules.denyCommandPatterns],
    protectedPaths: rules.protectedPaths,
  });
  const ctx = { run_id: 'r', project: '/p' };

  eq('a denied tool is denied',
    az({ kind: 'tool', name: 'bash', args_digest: 'x', effects: 'Mutating', command: 'ls' }, ctx).decision,
    'deny');
  eq('a denied command pattern is denied',
    az({ kind: 'tool', name: 'verify', args_digest: 'x', effects: 'ReadOnly', command: 'git push origin main' }, ctx).decision,
    'deny');
  eq('...on ANY command-bearing tool (W4.5 F1)',
    az({ kind: 'tool', name: 'bash', args_digest: 'x', effects: 'Mutating', command: 'git push' }, ctx).decision,
    'deny');

  // THE regression this concatenation exists to prevent: adding "never git push" must not stop
  // denying `rm -rf /`.
  eq('the BUILT-IN dangerous pattern still applies',
    az({ kind: 'tool', name: 'verify', args_digest: 'x', effects: 'ReadOnly', command: 'rm -rf /' }, ctx).decision,
    'deny');

  eq('a protected path escalates',
    az({ kind: 'tool', name: 'write', args_digest: 'x', effects: 'Mutating', path: 'migrations/1.sql' }, ctx).decision,
    'escalate');
  eq('an unrelated write is unaffected',
    az({ kind: 'tool', name: 'write', args_digest: 'x', effects: 'Mutating', path: 'src/x.mjs' }, ctx).decision,
    'allow');
  eq('an unrelated command is unaffected',
    az({ kind: 'tool', name: 'verify', args_digest: 'x', effects: 'ReadOnly', command: 'git pull' }, ctx).decision,
    'allow');

  // A grant cannot reach past a rule-supplied denial, exactly as it cannot reach past the
  // built-in one — the ordering in `auth/default` is what guarantees this and it must not change.
  const withGrant = createAuthorizer({
    posture: 'auto',
    denyTools: rules.denyTools,
    denyCommandPatterns: [DEFAULT_DANGEROUS, ...rules.denyCommandPatterns],
    grants: () => [{ type: 'grant.created', at: 1, payload: {
      grant_id: 'g1', scope: 'project', command: 'git push origin main', project: '/p',
      decided_by: 'human', tool: null, resource_id: null, run_id: null, expires_at: null } }],
  });
  eq('a remembered approval cannot unlock a rule denial',
    withGrant({ kind: 'tool', name: 'verify', args_digest: 'x', effects: 'ReadOnly', command: 'git push origin main' }, ctx).decision,
    'deny');

  check('the rule search order is user then project',
    ruleSearchPaths({ workspace: '/w', home: '/h' }).map(x => x.scope).join(',') === 'user,project');
}

process.exit(summary('w8 config', path.join(HERE, '..', 'results-w8-config.json')) ? 1 : 0);
