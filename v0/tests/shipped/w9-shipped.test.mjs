// W9 — SHIPPED CONFIGURATION. MCP at the wiring a developer actually runs.
//
// The failure class this project has repeated across seven waves is a mechanism that works in a
// unit test and is never reached at the composition root. `tests/mcp` proves the mechanism and the
// live protocol. This suite proves the PRODUCT composes it: a server declared in `.orion.json`
// becomes a tool in the toolset the Worker is handed, reached through the real `prepareRun` and
// the real binary — not through a helper a test imported directly.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { prepareRun } from '../../src/cli/index.mjs';
import { loadSdk } from '../../src/mcp/client.mjs';
import { mcpResourceId, parseServers } from '../../src/mcp/servers.mjs';
import { mutatingTools } from '../../src/agent/tools/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'src', 'cli', 'index.mjs');
const FIXTURE = path.join(HERE, '..', 'mcp', 'fixtures', 'echo-server.mjs');
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w9s-${tag}-`));
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

const SDK = await loadSdk();
const SDK_OK = !SDK.error;

// HOME is captured into a module constant when `cli/index.mjs` is imported, so an in-process test
// that mutates it afterwards reads the developer's real `~/.orion`. Project-scoped config is read
// from the WORKSPACE, so the in-process checks below are honest; anything HOME-dependent uses a
// subprocess (the trap this project already fell into once, in W8).
const EMPTY_HOME = mk('emptyhome');
process.env.HOME = EMPTY_HOME;
process.env.USERPROFILE = EMPTY_HOME;
process.env.ORION_BASE_URL ??= 'http://127.0.0.1:9/v1';
process.env.ORION_MODEL ??= 'test-model';

function cli(args, { cwd, home = mk('h'), env = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
           HOME: home, USERPROFILE: home, ORION_HOME: path.join(home, '.orion'), ...env },
  });
  return { code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? ''),
           all: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

/** A workspace whose `.orion.json` declares the echo server. */
function workspaceWith(servers) {
  const ws = mk('ws');
  write(path.join(ws, '.orion.json'), JSON.stringify({ mcpServers: servers }, null, 2));
  return ws;
}

const prepared = async (ws) => {
  const store = new Store(path.join(mk('db'), 'runs.db'));
  const runId = store.createRun(uid('run'), { task: 'w9 shipped' });
  const p = await prepareRun(store, runId, null, ws);
  return { ...p, store, runId };
};

// ═══════════════════════════════════════════ the composition root
describe(`w9/shipped: a server in .orion.json becomes a tool the model is offered${SDK_OK ? '' : ' [SKIPPED — no SDK]'}`);
if (SDK_OK) {
  const ws = workspaceWith({
    demo: { command: process.execPath, args: [FIXTURE], env: ['ORION_TEST_TOKEN'] },
  });
  const p = await prepared(ws);

  // THE assertion of this suite. Not "the session manager can build tools" — that is the mechanism
  // suite. This is "the toolset the Worker is constructed with contains them".
  check('the MCP tool is in the composed toolset',
    !!p.tools['mcp__demo__echo'], Object.keys(p.tools).join(','));
  check('...for every advertised tool', ['echo', 'whoami', 'reach_out', 'explode']
    .every(t => !!p.tools[`mcp__demo__${t}`]), Object.keys(p.tools).join(','));

  // The built-in toolset is untouched: MCP adds capability and removes none.
  for (const builtin of ['read', 'grep', 'glob', 'git', 'write', 'edit', 'bash', 'verify'])
    check(`the built-in \`${builtin}\` survives`, !!p.tools[builtin]);
  // Asserted as a DELTA rather than a total. The absolute count was 15 when this was written and
  // became 16 the moment W10 added `subagent` — but the property being protected was never "the
  // toolset is 15", it was "MCP contributes exactly the four tools the server advertised, and
  // disturbs nothing else". The delta says that, and keeps saying it as the product grows.
  eq('MCP contributed exactly the four advertised tools',
    Object.keys(p.tools).filter(n => n.startsWith('mcp__')).length, 4);
  check('...all from the declared server',
    Object.keys(p.tools).filter(n => n.startsWith('mcp__')).every(n => n.startsWith('mcp__demo__')));

  // W5-T1/T2: capability is declared on the tool and derived everywhere. MCP tools are Mutating,
  // so they MUST appear in the mutating set — a third-party tool that slipped in as ReadOnly would
  // bypass the approval gate.
  const mut = mutatingTools(p.tools);
  check('every MCP tool is in the mutating set',
    ['echo', 'whoami'].every(t => mut.has(`mcp__demo__${t}`)), [...mut].join(','));
  check('...alongside the three built-in writers',
    ['bash', 'edit', 'write'].every(t => mut.has(t)));

  // The session is a W6 resource in THIS run's log, written before the worker existed.
  const acquired = p.store.events(p.runId).filter(e => e.type === 'resource.acquired');
  const mcpAcq = acquired.filter(e => e.payload.kind === 'mcp');
  eq('the session was acquired as a resource', mcpAcq.length, 1);
  eq('...with the derived id', mcpAcq[0].payload.resource_id, mcpResourceId({
    server: parseServers({ demo: { command: process.execPath, args: [FIXTURE] } })[0],
    project: ws }));

  // The manager is handed back so the caller can release it — and `run`/`resume` both do.
  check('prepareRun exposes the session manager', !!p.mcp);
  await p.mcp.releaseAll('test finished');
  eq('releasing writes resource.released',
    p.store.events(p.runId).filter(e => e.type === 'resource.released'
      && e.payload.kind === 'mcp').length, 1);
  p.store.close();
}

describe(`w9/shipped: an MCP tool really executes through the composed toolset${SDK_OK ? '' : ' [SKIPPED]'}`);
if (SDK_OK) {
  const ws = workspaceWith({ demo: { command: process.execPath, args: [FIXTURE] } });
  const p = await prepared(ws);

  // Calling `tools[name].run(args)` is exactly what the Worker does, so this is the product path
  // rather than a simulation of it.
  eq('the tool runs and returns the server\'s answer',
    await p.tools['mcp__demo__echo'].run({ msg: 'shipped' }), 'echo: shipped');

  // The provenance the worker folds into `tool.succeeded.ext.mcp`.
  const prov = p.tools['mcp__demo__echo'].mcp;
  eq('provenance names the server', prov.server, 'demo');
  eq('...the unqualified tool', prov.tool, 'echo');
  check('...and the session id', /^res_mcp_[0-9a-f]{16}$/.test(prov.session_id), prov.session_id);

  await p.mcp.releaseAll();
  p.store.close();
}

describe(`w9/shipped: a rule file denies an MCP tool through the real authorizer${SDK_OK ? '' : ' [SKIPPED]'}`);
if (SDK_OK) {
  const ws = workspaceWith({ demo: { command: process.execPath, args: [FIXTURE] } });
  // The rules layer needs no new syntax for MCP: a qualified tool name is just a tool name.
  write(path.join(ws, '.orion-rules.json'), JSON.stringify({ denyTools: ['mcp__demo__echo'] }));
  const p = await prepared(ws);
  const ctx = { run_id: p.runId, project: ws };

  eq('the denied MCP tool is denied by the SHIPPED authorizer',
    p.authorize({ kind: 'tool', name: 'mcp__demo__echo', args_digest: 'x',
                  effects: 'Mutating' }, ctx).decision, 'deny');
  eq('...while a sibling tool from the same server is unaffected',
    p.authorize({ kind: 'tool', name: 'mcp__demo__whoami', args_digest: 'x',
                  effects: 'Mutating' }, ctx).decision, 'allow');
  eq('...and built-in policy is untouched',
    p.authorize({ kind: 'tool', name: 'verify', args_digest: 'x', effects: 'ReadOnly',
                  command: 'rm -rf /' }, ctx).decision, 'deny');

  await p.mcp.releaseAll();
  p.store.close();
}

describe('w9/shipped: an unreachable server degrades the run rather than ending it');
{
  const ws = workspaceWith({ broken: { command: path.join(mk('nope'), 'not-a-binary'), args: [] } });
  const p = await prepared(ws);

  check('the run was still composed', !!p.tools);
  check('...with the built-in tools intact', !!p.tools.read && !!p.tools.bash);
  eq('...and no MCP tools', Object.keys(p.tools).filter(n => n.startsWith('mcp__')).length, 0);

  const deg = p.store.events(p.runId).filter(e => e.type === 'degraded'
    && e.payload.what === 'mcp_server_unavailable');
  eq('the absence is recorded, not silent', deg.length, 1);
  eq('...naming the server the operator declared', deg[0].payload.server, 'broken');

  await p.mcp?.releaseAll();
  p.store.close();
}

describe('w9/shipped: a project with no mcpServers is byte-for-byte the pre-W9 product');
{
  const ws = mk('plain');
  const p = await prepared(ws);
  eq('no session manager is created', p.mcp, null);
  eq('no MCP tool is composed', Object.keys(p.tools).filter(n => n.startsWith('mcp__')).length, 0);
  // Likewise a delta: what W9 guarantees is that MCP adds nothing mutating, not that the mutating
  // set is frozen forever. W10's `subagent` is legitimately Mutating and is not an MCP tool.
  eq('...and MCP added nothing to the mutating set',
    [...mutatingTools(p.tools)].filter(n => n.startsWith('mcp__')).length, 0);
  check('...leaving the three built-in writers intact',
    ['bash', 'edit', 'write'].every(n => mutatingTools(p.tools).has(n)),
    [...mutatingTools(p.tools)].join(','));
  eq('no resource beyond the workspace was acquired',
    p.store.events(p.runId).filter(e => e.type === 'resource.acquired'
      && e.payload.kind === 'mcp').length, 0);
  p.store.close();
}

// ═══════════════════════════════════════════ the binary
describe('w9/shipped: `orionctl config` shows declared servers, and a bad one exits non-zero');
{
  const ws = mk('cfgws');
  write(path.join(ws, '.orion.json'), JSON.stringify({
    model: 'm', mcpServers: { demo: { command: 'node', args: ['s.mjs'], env: ['GITHUB_TOKEN'] } },
  }));
  const r = cli(['config'], { cwd: ws, env: { GITHUB_TOKEN: 'ghp-must-not-appear' } });
  eq('the command succeeds', r.code, 0);
  check('the declared server is visible', /demo/.test(r.all), r.all.slice(0, 600));
  check('...and the variable NAME it passes', /GITHUB_TOKEN/.test(r.all));
  // The W8 rule, still true now that a second place can name a credential.
  check('...but never the value', !r.all.includes('ghp-must-not-appear'));

  // An inline env VALUE is the mistake a user copying another client's config will make, and it
  // must be fatal rather than quietly accepted into a committed file.
  const bad = mk('badws');
  write(path.join(bad, '.orion.json'), JSON.stringify({
    mcpServers: { demo: { command: 'node', env: { TOKEN: 'sk-inline-secret' } } } }));
  const b = cli(['config'], { cwd: bad });
  check('an inline env value exits non-zero', b.code !== 0, `exit ${b.code}`);
  check('...naming the offending field', /mcpServers\.demo\.env/.test(b.all), b.all.slice(0, 500));
  check('...teaching the pass-through form', /variable NAMES/.test(b.all), b.all.slice(0, 500));
  check('...without echoing the secret', !b.all.includes('sk-inline-secret'));

  const typo = mk('typows');
  write(path.join(typo, '.orion.json'), JSON.stringify({
    mcpServers: { demo: { commands: 'node' } } }));
  const t = cli(['config'], { cwd: typo });
  check('a nested typo exits non-zero', t.code !== 0, `exit ${t.code}`);
  check('...naming the exact field', /mcpServers\.demo\.commands/.test(t.all), t.all.slice(0, 400));

  const noCmd = mk('nocmdws');
  write(path.join(noCmd, '.orion.json'), JSON.stringify({ mcpServers: { demo: {} } }));
  const n = cli(['config'], { cwd: noCmd });
  check('a server with no command exits non-zero', n.code !== 0, `exit ${n.code}`);
  check('...saying what is missing', /command/.test(n.all), n.all.slice(0, 400));
}

describe('w9/shipped: the CLI documents MCP where an operator will look');
{
  const h = cli(['--help']);
  eq('help still works', h.code, 0);
  check('help mentions the mcpServers field', /mcpServers/.test(h.all), h.all.slice(-900));
  check('...and that servers run inside the sandbox',
    /sandbox|container|isolat/i.test(h.all));
}

describe('w9/shipped: MCP is optional — the package declares zero required dependencies');
{
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8'));
  eq('there are no required dependencies', Object.keys(pkg.dependencies ?? {}).length, 0);

  // The dependency is real, optional, and EXACT-pinned. A range on a package that speaks a
  // protocol to third-party code means a future `npm install` silently changes what the harness
  // trusts.
  const opt = pkg.optionalDependencies ?? {};
  check('the SDK is declared optional', '@modelcontextprotocol/sdk' in opt, JSON.stringify(opt));
  check('...at an exact version, not a range',
    /^\d+\.\d+\.\d+$/.test(opt['@modelcontextprotocol/sdk'] ?? ''),
    opt['@modelcontextprotocol/sdk']);
}

process.exit(summary('w9 shipped', path.join(HERE, '..', 'results-shipped-w9.json')) ? 1 : 0);
