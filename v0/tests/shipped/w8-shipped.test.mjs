// W8 — SHIPPED CONFIGURATION. Search, git, config and rules at the wiring a developer runs.
//
// The failure class this project has repeated SEVEN times across six waves is a mechanism that
// works in a unit test and is never reached at the composition root. `tests/search`,
// `tests/git` and `tests/config` prove the mechanisms. This suite proves the product composes
// them: tools reach the model through `makeTools`, rules reach the AUTHORIZER through
// `prepareRun`, and config and first-run behave through the real binary with a real exit code.
//
// Everything here either spawns `src/cli/index.mjs` as a subprocess or calls `prepareRun`. Where
// a subprocess is used it is because module-level constants (HOME) are read at import time — a
// test that sets them afterwards proves nothing, which is a trap this wave already fell into
// once.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { prepareRun } from '../../src/cli/index.mjs';
import { makeTools, toolDefinitions, mutatingTools } from '../../src/agent/tools/index.mjs';
import { LocalSandbox } from '../../src/sandbox/local/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'src', 'cli', 'index.mjs');
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w8s-${tag}-`));
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

/**
 * Run the real CLI as a subprocess with a controlled HOME.
 *
 * HOME is captured into a module constant when `cli/index.mjs` is imported, so an in-process test
 * that mutates `process.env.HOME` afterwards reads the DEVELOPER's real `~/.orion` instead of the
 * fixture. That produced a false pass earlier in this wave; a subprocess is the honest way.
 */
function cli(args, { cwd, home, env = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8',
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      HOME: home, USERPROFILE: home, ORION_HOME: path.join(home, '.orion'),
      ...env,
    },
  });
  return { code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? ''),
           all: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

// ═══════════════════════════════════════════ tools reach the model
describe('w8/shipped: the new tools are in the toolset the model is actually offered');
{
  const ws = mk('tools');
  const tools = makeTools(new LocalSandbox(ws));
  const defs = toolDefinitions(tools);
  const names = defs.map(d => d.function.name);

  check('glob is offered', names.includes('glob'), names.join(','));
  check('git is offered', names.includes('git'), names.join(','));
  eq('the toolset is 11', names.length, 11);

  // The W5-T1/T2 property: capability is declared on the tool and derived everywhere. Two new
  // ReadOnly tools must not enlarge the set that requires approval.
  eq('...and the mutating set is unchanged by two read-only additions',
    [...mutatingTools(tools)].sort().join(','), 'bash,edit,write');

  // Regex grep must be reachable BY THE MODEL, not merely by the sandbox. The schema is the only
  // channel through which the model can learn the option exists — an unwired flag here is
  // precisely the "works in a unit test" failure.
  const grep = defs.find(d => d.function.name === 'grep');
  for (const opt of ['regex', 'ignore_case', 'glob'])
    check(`grep exposes \`${opt}\` to the model`, !!grep.function.parameters.properties[opt]);
  check('...and still takes the original literal pattern',
    !!grep.function.parameters.properties.pattern);
  check('...with `pattern` still the only required argument',
    JSON.stringify(grep.function.parameters.required ?? []) === '["pattern"]',
    JSON.stringify(grep.function.parameters.required));
}

describe('w8/shipped: the wired tools search and read the real workspace');
{
  const ws = mk('live');
  write(path.join(ws, 'src', 'a.mjs'), 'export const alpha = 1;\n');
  write(path.join(ws, 'src', 'b.mjs'), 'export const beta = 2;\n');
  write(path.join(ws, 'notes.md'), 'alpha appears here too\n');
  const tools = makeTools(new LocalSandbox(ws));

  const g = await tools.glob.run({ pattern: 'src/*.mjs' });
  check('glob finds both sources', /a\.mjs/.test(g) && /b\.mjs/.test(g), g);
  check('...and excludes the non-matching file', !/notes\.md/.test(g), g);

  const lit = await tools.grep.run({ pattern: 'alpha' });
  check('literal grep still works unchanged', /a\.mjs/.test(lit), lit);

  // Backward compatibility is the load-bearing claim of Part 2: the SAME call shape must keep its
  // old meaning. `a.b` is a regex that matches `axb`, and a literal that does not.
  write(path.join(ws, 'dots.txt'), 'axb\na.b\n');
  const asLiteral = await tools.grep.run({ pattern: 'a.b' });
  check('a dot is still LITERAL by default', /a\.b/.test(asLiteral) && !/axb/.test(asLiteral),
    asLiteral);
  const asRegex = await tools.grep.run({ pattern: 'a.b', regex: true });
  check('...and a metacharacter only when regex is asked for', /axb/.test(asRegex), asRegex);

  // A broken pattern must fail loudly. Silently returning "no matches" would read to the model as
  // "the string is absent", which is a wrong answer rather than an error.
  let e = null;
  try { await tools.grep.run({ pattern: '([unclosed', regex: true }); } catch (err) { e = err; }
  check('a malformed regex FAILS rather than returning empty', e !== null);
  check('...saying what was wrong', /invalid regular expression/i.test(String(e?.message)),
    String(e?.message));
}

// ═══════════════════════════════════════════ rules reach the authorizer
describe('w8/shipped: a rule file reaches the AUTHORIZER through prepareRun');
{
  const home = mk('rhome'); const ws = mk('rws');
  write(path.join(home, '.orion', 'rules.json'), JSON.stringify({
    denyTools: ['bash'],
    denyCommandPatterns: ['\\bgit\\s+push\\b'],
    protectedPaths: ['(^|/)migrations/'],
  }));

  const store = new Store(path.join(mk('rdb'), 'runs.db'));
  const runId = store.createRun(uid('run'), { task: 'w8 rules wiring' });
  const prev = { HOME: process.env.HOME, UP: process.env.USERPROFILE, OH: process.env.ORION_HOME };
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.ORION_HOME = path.join(home, '.orion');

  let prepared = null;
  try {
    prepared = await prepareRun(store, runId, null, ws);
  } catch { /* reported below */ }

  check('prepareRun composed a run', prepared !== null);
  check('...and did not treat a VALID rule file as fatal', prepared?.fatal !== 'rules');

  process.env.HOME = prev.HOME; process.env.USERPROFILE = prev.UP; process.env.ORION_HOME = prev.OH;
  store.close?.();

  // The subprocess is the authoritative check, because HOME is read at import time. A rule file
  // that denies `bash` must make the SHIPPED authorizer deny bash.
  const probe = mk('probe');
  write(path.join(probe, 'p.mjs'), `
    import { prepareRun } from ${JSON.stringify(pathToFileURL(CLI).href)};
    import { Store, uid } from ${JSON.stringify(pathToFileURL(path.join(HERE, '..', '..', 'src', 'core', 'run', 'store.mjs')).href)};
    const store = new Store(process.argv[2]);
    const runId = store.createRun(uid('run'), { task: 'probe' });
    const { authorize } = await prepareRun(store, runId, null, process.argv[3]);
    const ctx = { run_id: runId, project: process.argv[3] };
    const d = (r) => authorize(r, ctx).decision;
    console.log(JSON.stringify({
      bash:      d({ kind:'tool', name:'bash',  args_digest:'x', effects:'Mutating', command:'ls' }),
      push:      d({ kind:'tool', name:'verify',args_digest:'x', effects:'ReadOnly', command:'git push origin main' }),
      rmrf:      d({ kind:'tool', name:'verify',args_digest:'x', effects:'ReadOnly', command:'rm -rf /' }),
      migration: d({ kind:'tool', name:'write', args_digest:'x', effects:'Mutating', path:'migrations/1.sql' }),
      ordinary:  d({ kind:'tool', name:'write', args_digest:'x', effects:'Mutating', path:'src/x.mjs' }),
    }));
  `);
  const pr = spawnSync(process.execPath,
    [path.join(probe, 'p.mjs'), path.join(mk('pdb'), 'r.db'), ws],
    { encoding: 'utf8', env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        HOME: home, USERPROFILE: home, ORION_HOME: path.join(home, '.orion'),
        ORION_BASE_URL: 'http://127.0.0.1:9/v1', ORION_MODEL: 'test-model',
        ORION_API_KEY: 'unused-by-this-probe' } });

  const line = String(pr.stdout ?? '').trim().split('\n').filter(l => l.startsWith('{')).pop();
  const dec = line ? JSON.parse(line) : null;
  check('the probe produced decisions', dec !== null, String(pr.stderr ?? '').slice(0, 300));

  if (dec) {
    eq('a rule-denied TOOL is denied by the shipped authorizer', dec.bash, 'deny');
    eq('a rule-denied COMMAND is denied', dec.push, 'deny');
    // The concatenation regression: adding "never git push" must not stop denying `rm -rf /`.
    eq('...and the BUILT-IN dangerous pattern still applies', dec.rmrf, 'deny');
    eq('a protected path escalates', dec.migration, 'escalate');
    eq('an unrelated write is unaffected', dec.ordinary, 'allow');
  }
}

describe('w8/shipped: config `search` budgets reach the COMPOSED tools, not just the module');
{
  // The quoted failure: config.search resolves and displays, but the search layer used its own
  // defaults. A test that imports `makeTools` and passes a bag of options proves the MECHANISM;
  // this proves the PRODUCT: a committed `.orion.json` search override lands in the tools that
  // `prepareRun` hands the worker. HOME is read at import time, hence the subprocess probe.
  const home = mk('searhome'); const ws = mk('searws');
  write(path.join(ws, '.orion.json'), JSON.stringify({
    baseUrl: 'http://127.0.0.1:9/v1', model: 'probe-model',
    search: { maxHits: 1 },
  }));
  // Four matching files, so an un-wired search returns 4 hits and a wired maxHits=1 returns 1.
  for (const n of ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'])
    write(path.join(ws, n), 'export const needle = 1;\n');

  const probe = mk('searchprobe');
  write(path.join(probe, 'p.mjs'), `
    import { prepareRun } from ${JSON.stringify(pathToFileURL(CLI).href)};
    import { Store, uid } from ${JSON.stringify(pathToFileURL(path.join(HERE, '..', '..', 'src', 'core', 'run', 'store.mjs')).href)};
    const store = new Store(process.argv[2]);
    const runId = store.createRun(uid('run'), { task: 'search wiring' });
    const prepared = await prepareRun(store, runId, null, process.argv[3]);
    store.close?.();
    const g = await prepared.tools.grep.run({ pattern: 'needle' });
    console.log(JSON.stringify({
      base: (String(g).match(/:1: export/g) ?? []).length,
      truncated: /TRUNCATED at 1 matches/.test(String(g)),
      toolsExposed: !!prepared.tools,
    }));
  `);
  const pr = spawnSync(process.execPath,
    [path.join(probe, 'p.mjs'), path.join(mk('searchdb'), 's.db'), ws],
    { encoding: 'utf8', env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        HOME: home, USERPROFILE: home, ORION_HOME: path.join(home, '.orion'),
        ORION_API_KEY: 'unused-by-this-probe' } });

  const line = String(pr.stdout ?? '').trim().split('\n').filter(l => l.startsWith('{')).pop();
  const dec = line ? JSON.parse(line) : null;
  check('the probe reached prepareRun.composed tools', dec?.toolsExposed === true,
    String(pr.stderr ?? '').slice(0, 300));

  if (dec) {
    // The config's maxHits=1 is measured: 1 hit, truncation notice — NOT the sandbox default 100.
    eq('config search.maxHits=1 caps grep at 1 hit', dec.base, 1);
    check('...with the honest truncation notice', dec.truncated === true);
    check('...and the matched file present', dec.base === 1);
  }

  // In-process keep-alive so the describe block's async work has settled.
  await new Promise(r => setImmediate(r));
}

describe('w8/shipped: an INVALID rule file refuses the run rather than running weaker');
{
  const home = mk('badhome'); const ws = mk('badws');
  write(path.join(home, '.orion', 'rules.json'), '{ "denyTools": "bash" }');

  const r = cli(['run', 'anything'], { cwd: ws, home,
    env: { ORION_BASE_URL: 'http://127.0.0.1:9/v1', ORION_MODEL: 'test-model',
           ORION_API_KEY: 'x' } });

  check('the run does not proceed', r.code !== 0, `exit ${r.code}`);
  check('...and says the rules are the reason',
    /rules? (are|is) invalid|permission rules/i.test(r.all), r.all.slice(0, 400));
  check('...naming the offending directive', /denyTools/.test(r.all), r.all.slice(0, 400));
  // Degrading to "no rules" would run with LESS restriction than the operator wrote — the one
  // failure mode a policy file must never have.
  check('...and does not silently continue with weaker policy',
    !/starting|turn 1/i.test(r.all), r.all.slice(0, 400));
}

// ═══════════════════════════════════════════ config command + first run
describe('w8/shipped: `orionctl config` prints the effective configuration, never a secret');
{
  const home = mk('chome'); const ws = mk('cws');
  write(path.join(ws, '.orion.json'), JSON.stringify({ model: 'project-model', baseUrl: 'http://p/v1' }));

  const r = cli(['config'], { cwd: ws, home,
    env: { ORION_MODEL: 'env-model', ORION_API_KEY: 'sk-secret-must-not-appear' } });

  eq('the command succeeds', r.code, 0);
  check('it shows the winning value', /env-model/.test(r.all), r.all);
  check('...attributed to the environment', /env/.test(r.all), r.all);
  check('...and the project value it overrode is visible as a source', /project/.test(r.all), r.all);
  check('the file-supplied baseUrl is shown', /http:\/\/p\/v1/.test(r.all), r.all);

  // THE constraint stated in the wave: do not print secrets.
  check('the API KEY VALUE never appears', !r.all.includes('sk-secret-must-not-appear'));
  check('...only whether it is set', /\(set\)/.test(r.all), r.all);

  const unset = cli(['config'], { cwd: ws, home, env: { ORION_MODEL: 'env-model' } });
  check('an absent key is reported honestly', /\(NOT SET\)/.test(unset.all), unset.all);

  const json = cli(['config', '--json'], { cwd: ws, home,
    env: { ORION_MODEL: 'env-model', ORION_API_KEY: 'sk-secret-must-not-appear' } });
  eq('--json succeeds', json.code, 0);
  const parsed = JSON.parse(json.out);
  eq('...and is machine-readable', parsed.effective.model, 'env-model');
  check('...carrying provenance per key', /env/.test(String(parsed.sources.model)),
    String(parsed.sources.model));
  // The JSON form is the one most likely to be pasted into a bug report, so it reports only
  // WHETHER the key is set and which variable holds it.
  eq('...naming the key variable without its value', parsed.api_key_env, 'ORION_API_KEY');
  eq('...and reporting only that it is set', parsed.api_key_set, true);
  check('...and still carries no secret', !json.all.includes('sk-secret-must-not-appear'));
}

describe('w8/shipped: an invalid config file names the field and exits non-zero');
{
  const home = mk('bchome'); const ws = mk('bcws');
  write(path.join(ws, '.orion.json'), JSON.stringify({ postures: 'auto' }));
  const r = cli(['config'], { cwd: ws, home });
  check('it exits non-zero', r.code !== 0, `exit ${r.code}`);
  check('...naming the offending field', /postures/.test(r.all), r.all.slice(0, 300));

  const secret = mk('secretws');
  write(path.join(secret, '.orion.json'), JSON.stringify({ apiKey: 'sk-inline-key' }));
  const s = cli(['config'], { cwd: secret, home: mk('sh') });
  check('an inline plaintext key is refused', s.code !== 0, `exit ${s.code}`);
  check('...teaching the env-var alternative', /apiKeyEnv|ORION_API_KEY/.test(s.all), s.all.slice(0, 400));
  check('...without echoing the key back', !s.all.includes('sk-inline-key'), s.all.slice(0, 400));
}

describe('w8/shipped: an unconfigured first run exits NON-ZERO (the measured bug)');
{
  // `research/productization/fresh-run-audit.md:92` measured this exiting 0 — the runtime told a
  // new user nothing was wrong and did no work. An honest failure is the whole fix.
  const home = mk('fresh'); const ws = mk('freshws');
  const r = cli(['run', 'do something'], { cwd: ws, home });

  check('it exits non-zero', r.code !== 0, `exit ${r.code}`);
  check('...saying what is missing', /ORION_BASE_URL|not configured|ORION_API_KEY/i.test(r.all),
    r.all.slice(0, 500));
  check('...and how to fix it', /ORION_BASE_URL/.test(r.all), r.all.slice(0, 500));
  check('...mentioning the config file as an alternative', /\.orion\.json/.test(r.all),
    r.all.slice(0, 800));

  // Bounded and non-interactive: the wave forbids a wizard, and a first run must not hang waiting
  // for input that a CI process will never supply.
  check('...in a bounded message', r.all.length < 4000, `${r.all.length} bytes`);
  check('...and prints no secret-shaped value', !/sk-[A-Za-z0-9]{8}/.test(r.all));
}

process.exit(summary('w8 shipped', path.join(HERE, '..', 'results-shipped-w8.json')) ? 1 : 0);
