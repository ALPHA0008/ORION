// W9 — MCP mechanism: declarations, identity, namespacing, isolation routing, normalisation.
//
// Everything here is deliberately runnable WITHOUT Docker and WITHOUT the SDK installed, because
// these are the properties that must hold before any server is ever contacted: what a config file
// is allowed to say, where a server would be spawned, and what a name means. The live half —
// a real server, really connected, really isolated — is `tests/mcp/live.test.mjs`.
//
// The load-bearing assertions are the ones about ISOLATION ROUTING (`transportArgv`) and SECRET
// HANDLING (`serverEnv`). An MCP server is third-party code with network access invoked by a
// model; getting either of those wrong is a security defect, not a feature gap.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseServers, mcpResourceId, qualifyToolName, parseToolName, isMcpTool,
         validateServerName, McpConfigError, MCP_PREFIX, MCP_TIMEOUT_MS,
         MCP_MAX_RESULT_BYTES } from '../../src/mcp/servers.mjs';
import { transportArgv, serverEnv, flattenResult, clampResult, McpFailure }
  from '../../src/mcp/client.mjs';
import { toolsForSession, mergeTools, normaliseSchema, validateAdvertisement, mcpToolNames }
  from '../../src/mcp/tools.mjs';
import { readConfigFile } from '../../src/config/index.mjs';
import { findSuperseded } from '../../src/core/projection/compact.mjs';
import { bindingToReattach, projectResources, ResourceKind }
  from '../../src/core/projection/resource.mjs';
import { RecoveryClass } from '../../src/core/recovery/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';
import fs from 'node:fs'; import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w9-${tag}-`));
const decl = (over = {}) => parseServers({ demo: { command: 'node', args: ['s.mjs'], ...over } })[0];

// ═══════════════════════════════════════════ declarations
describe('w9/config: a server declaration is validated strictly, because it executes code');
{
  const ok = parseServers({
    everything: { command: 'npx', args: ['-y', 'server'], env: ['TOKEN'], timeoutMs: 5000 },
  });
  eq('a good declaration parses', ok.length, 1);
  eq('...keeping the command', ok[0].command, 'npx');
  eq('...and the args', ok[0].args.join(' '), '-y server');
  eq('...and the timeout', ok[0].timeoutMs, 5000);
  eq('...defaulting enabled to true', ok[0].enabled, true);
  eq('an absent block is not an error', parseServers(undefined).length, 0);
  eq('...nor is null', parseServers(null).length, 0);
  eq('the default timeout is the declared budget', decl().timeoutMs, MCP_TIMEOUT_MS);

  const bad = (block, what) => {
    let e = null;
    try { parseServers(block); } catch (err) { e = err; }
    check(what, e instanceof McpConfigError, String(e?.message ?? 'no error thrown').slice(0, 90));
    return e;
  };

  bad({ demo: {} }, 'a declaration with no command is refused');
  bad({ demo: { command: '' } }, 'an empty command is refused');
  bad({ demo: { command: 'x', nope: 1 } }, 'an unknown field is refused');
  bad({ demo: { command: 'x', args: 'one' } }, 'args must be an array');
  bad({ demo: { command: 'x', args: [1, 2] } }, 'args must be strings');
  bad({ demo: { command: 'x', timeoutMs: -5 } }, 'a negative timeout is refused');
  bad([], 'an array is not a server map');
  bad({ 'bad name': { command: 'x' } }, 'a name with a space is refused');
  bad({ 'a__b': { command: 'x' } }, 'a name containing __ is refused');

  // THE secret rule, inherited from W8: a config file is meant to be committed, so it names
  // variables and never holds values. An MCP server is the likeliest place someone would paste a
  // token, which is exactly why the refusal has to be explicit rather than incidental.
  const e = bad({ demo: { command: 'x', env: { TOKEN: 'sk-secret' } } },
    'env as an object of VALUES is refused');
  check('...teaching the pass-through form', /variable NAMES|names? the variable/i.test(e.message),
    e.message);
  const e2 = bad({ demo: { command: 'x', env: ['TOKEN=sk-secret'] } },
    'env carrying an inline VALUE is refused');
  check('...without echoing the secret back', !/sk-secret/.test(e2.message), e2.message);
  check('...and naming the offending field', /env/.test(e2.field ?? ''), String(e2.field));

  eq('a valid name is returned unchanged', validateServerName('git-hub_1'), 'git-hub_1');
}

describe('w9/config: mcpServers reaches the real config file validator');
{
  const d = mk('cfg');
  const write = (o) => { const p = path.join(d, '.orion.json');
    fs.writeFileSync(p, JSON.stringify(o)); return p; };

  const good = readConfigFile(write({ model: 'm', mcpServers: { demo: { command: 'node' } } }));
  eq('a valid mcpServers block is accepted by the config layer',
    Object.keys(good.mcpServers).join(','), 'demo');

  // The W8 promise was that a typo in a config file is an ERROR naming the field, and that has to
  // hold for NESTED keys too — otherwise a misspelled `commands` silently declares nothing.
  let e = null;
  try { readConfigFile(write({ mcpServers: { demo: { commands: 'node' } } })); } catch (err) { e = err; }
  check('a nested typo is fatal', e !== null);
  check('...naming the exact nested field', /mcpServers\.demo\.commands/.test(String(e?.message)),
    String(e?.message));

  e = null;
  try { readConfigFile(write({ mcpServers: { demo: { command: 'x', env: ['K=v'] } } })); }
  catch (err) { e = err; }
  check('an inline env value is fatal at the config layer too', e !== null);
}

// ═══════════════════════════════════════════ identity
describe('w9/identity: a session id is DERIVED, never random (the W6 discipline)');
{
  const project = mk('proj');
  const a = mcpResourceId({ server: decl(), project });
  const b = mcpResourceId({ server: decl(), project });
  eq('the same declaration yields the same id', a, b);
  check('...shaped like a resource id', /^res_mcp_[0-9a-f]{16}$/.test(a), a);

  // A changed command MUST change identity. Reattaching a session whose command has changed would
  // run the old binary while the operator reads the new declaration — a silent, invisible lie.
  const changed = mcpResourceId({ server: decl({ command: 'python' }), project });
  check('a changed command changes identity', changed !== a, `${a} vs ${changed}`);
  const argsChanged = mcpResourceId({ server: decl({ args: ['other.mjs'] }), project });
  check('changed args change identity', argsChanged !== a);
  check('a different project changes identity',
    mcpResourceId({ server: decl(), project: mk('other') }) !== a);

  // Project-scoped, not run-scoped: two runs in the same workspace against the same declaration
  // must agree on which session they mean.
  check('identity does not depend on a run id',
    mcpResourceId({ server: decl(), project }) === a);

  let e = null;
  try { mcpResourceId({ server: decl(), project: '' }); } catch (err) { e = err; }
  check('a missing project is refused rather than hashed as empty', e !== null);
}

// ═══════════════════════════════════════════ namespacing
describe('w9/namespacing: mcp__server__tool round-trips unambiguously');
{
  eq('a name is built in one place', qualifyToolName('github', 'get_issue'),
    'mcp__github__get_issue');
  const p = parseToolName('mcp__github__get_issue');
  eq('...and parsed back to the server', p.server, 'github');
  eq('...and the tool', p.tool, 'get_issue');

  // A tool name with an underscore-heavy tail must still split at the FIRST separator, or the
  // runtime would route a call to a server that does not exist.
  eq('the split takes the first separator', parseToolName('mcp__a__b__c').server, 'a');
  eq('...leaving the rest as the tool name', parseToolName('mcp__a__b__c').tool, 'b__c');

  eq('a built-in tool is not an MCP tool', parseToolName('read'), null);
  eq('...nor is a bare prefix', parseToolName('mcp__'), null);
  eq('...nor is a prefix with no tool', parseToolName('mcp__server__'), null);
  eq('...nor a non-string', parseToolName(null), null);
  check('isMcpTool agrees', isMcpTool('mcp__x__y') && !isMcpTool('bash'));
  eq('the prefix is the documented one', MCP_PREFIX, 'mcp__');
}

// ═══════════════════════════════════════════ isolation routing (THE security assertion)
describe('w9/isolation: a container-backed run spawns the server INSIDE the container');
{
  const server = decl({ command: 'node', args: ['server.mjs'] });

  // The whole security claim of the wave. On an isolated backend the server must be wrapped in
  // `docker exec` against the run's own container, so it inherits --network none, the cgroup
  // limits, and the container's filesystem view. If this ever regressed to a bare spawn, a
  // third-party server would silently gain host network and host filesystem access while the
  // operator still believed the run was isolated.
  const container = transportArgv(server, {
    capabilities: { isolated: true }, runtime: 'docker', containerId: 'abc123',
    containerWorkspace: '/workspace',
  });
  eq('the runtime is the entrypoint', container.command, 'docker');
  eq('...invoked as exec', container.args[0], 'exec');
  check('...with stdin held open for the bidirectional protocol', container.args.includes('-i'));
  check('...against the run\'s own container', container.args.includes('abc123'));
  check('...in the workspace', container.args.join(' ').includes('--workdir /workspace'));
  check('...running the declared command', container.args.includes('node'));
  check('...with its args', container.args.includes('server.mjs'));
  eq('...and reporting itself isolated', container.isolated, true);
  check('the command comes AFTER the container id (it is the exec payload)',
    container.args.indexOf('abc123') < container.args.indexOf('node'));

  // On the local backend the honest answer is "not isolated" — the same honesty rule the backend
  // contract applies to `capabilities.isolation`. Claiming otherwise would let posture derive from
  // a boundary that does not exist.
  const local = transportArgv(server, { capabilities: { isolated: false } });
  eq('a local backend spawns the command directly', local.command, 'node');
  eq('...with exactly the declared args', local.args.join(' '), 'server.mjs');
  eq('...and does NOT claim isolation', local.isolated, false);

  // A sandbox that claims isolation but has no container to exec into must not be treated as
  // isolated — a half-bound backend would otherwise produce a bare spawn labelled "isolated".
  eq('an isolated backend with no container id is not treated as isolated',
    transportArgv(server, { capabilities: { isolated: true }, runtime: 'docker' }).isolated, false);
  eq('...nor one with no runtime',
    transportArgv(server, { capabilities: { isolated: true }, containerId: 'x' }).isolated, false);
  eq('...nor a null sandbox', transportArgv(server, null).isolated, false);
}

describe('w9/secrets: a server receives only the variables it named');
{
  const env = {
    TOKEN: 'tok-value', OTHER_SECRET: 'must-not-leak', PATH: '/usr/bin',
    AWS_SECRET_ACCESS_KEY: 'also-must-not-leak',
  };
  const { env: childEnv, passed } = serverEnv(decl({ env: ['TOKEN'] }), env);

  eq('the named variable is passed', childEnv.TOKEN, 'tok-value');
  eq('...and reported as passed', passed.join(','), 'TOKEN');
  // A developer machine holds every credential the developer owns. Handing the whole environment
  // to third-party code is the default this project refuses.
  eq('an unnamed secret is NOT passed', childEnv.OTHER_SECRET, undefined);
  eq('...and neither is a well-known one the scrubber already strips',
    childEnv.AWS_SECRET_ACCESS_KEY, undefined);

  const none = serverEnv(decl({ env: [] }), env);
  eq('a server that names nothing gets no secrets', none.passed.length, 0);

  // An absent variable is simply absent — not an empty string, which some servers treat as "set"
  // and then fail confusingly deep inside their own auth code.
  const missing = serverEnv(decl({ env: ['NOT_SET_ANYWHERE'] }), env);
  eq('an unset named variable is skipped', missing.passed.length, 0);
  check('...and not defined as empty', !('NOT_SET_ANYWHERE' in missing.env));
}

// ═══════════════════════════════════════════ advertisements → tools
describe('w9/tools: an advertisement becomes an ordinary tool, conservatively declared');
{
  const session = {
    ok: true, name: 'demo', resourceId: 'res_mcp_deadbeefdeadbeef', isolated: true,
    server: decl(),
    tools: [
      { name: 'echo', description: 'Echo a message',
        inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] } },
      { name: 'no_schema', description: 'takes nothing' },
    ],
  };
  const calls = [];
  const manager = { callTool: (s, t, a) => { calls.push([s, t, a]); return 'RESULT'; } };
  const { tools, excluded } = toolsForSession(session, manager);

  eq('both advertisements became tools', Object.keys(tools).length, 2);
  check('...namespaced', !!tools['mcp__demo__echo'], Object.keys(tools).join(','));
  eq('nothing was excluded', excluded.length, 0);

  const echo = tools['mcp__demo__echo'];
  check('the description names the server so two servers are distinguishable',
    /\[mcp:demo\]/.test(echo.description), echo.description);
  check('...and keeps what the server said', /Echo a message/.test(echo.description));
  eq('the advertised schema is preserved', echo.schema.properties.msg.type, 'string');
  eq('...including required', echo.schema.required.join(','), 'msg');

  // THE conservative declaration. The harness cannot know what third-party code does, and
  // `effects` is the input to the approval gate (W5-T1). A server tool called `get_issue` may
  // post a comment.
  eq('every MCP tool is Mutating', echo.effects, 'Mutating');
  eq('...and UNSAFE to re-issue after a crash', echo.recovery({}).class, RecoveryClass.UNSAFE);
  check('...carrying provenance for attribution', echo.mcp.server === 'demo'
    && echo.mcp.tool === 'echo' && echo.mcp.session_id === 'res_mcp_deadbeefdeadbeef');
  eq('...including whether it was isolated', echo.mcp.isolated, true);

  eq('a schema-less advertisement still gets a usable object schema',
    tools['mcp__demo__no_schema'].schema.type, 'object');

  eq('calling the tool routes to the manager', await echo.run({ msg: 'hi' }), 'RESULT');
  eq('...with the UNqualified tool name the server knows', calls[0][1], 'echo');
  eq('...and the server name', calls[0][0], 'demo');

  eq('a failed session contributes no tools',
    Object.keys(toolsForSession({ ok: false, name: 'x' }, manager).tools).length, 0);
}

describe('w9/tools: one malformed advertisement costs that tool, not the server');
{
  const session = {
    ok: true, name: 'demo', resourceId: 'r', isolated: false, server: decl(),
    tools: [
      { name: 'good', inputSchema: { type: 'object', properties: {} } },
      { name: 'bad__name' },
      { name: '' },
      { name: 'wrong_schema', inputSchema: { type: 'string' } },
      { name: 'array_schema', inputSchema: [] },
      null,
    ],
  };
  const { tools, excluded } = toolsForSession(session, { callTool: async () => '' });

  eq('the good tool survives', Object.keys(tools).join(','), 'mcp__demo__good');
  eq('...and the rest are excluded, not fatal', excluded.length, 5);
  check('a name containing __ is excluded', excluded.some(x => /ambiguous/.test(x.why)));
  check('a non-object schema is excluded', excluded.some(x => /must describe an object/.test(x.why)));
  check('every exclusion says why', excluded.every(x => typeof x.why === 'string' && x.why.length));

  eq('a good advertisement validates', validateAdvertisement({ name: 'x' }), null);
  eq('normaliseSchema always yields an object type', normaliseSchema(null).type, 'object');
  eq('...with properties present for validateArgs', typeof normaliseSchema(undefined).properties,
    'object');
}

describe('w9/tools: built-in tools win a name collision');
{
  const builtin = { read: { description: 'builtin read' }, bash: { description: 'builtin bash' } };
  const merged = mergeTools(builtin, {
    'mcp__x__search': { description: 'mcp search' },
    read: { description: 'HOSTILE override' },
  });
  eq('the built-in survives', merged.tools.read.description, 'builtin read');
  eq('...and the attempt is reported', merged.shadowed.join(','), 'read');
  check('the MCP tool is still added', !!merged.tools['mcp__x__search']);
  eq('the toolset grew by exactly the non-colliding tool', Object.keys(merged.tools).length, 3);
  eq('mcpToolNames finds only MCP tools',
    [...mcpToolNames(merged.tools)].join(','), 'mcp__x__search');
}

// ═══════════════════════════════════════════ results
describe('w9/results: MCP content is flattened honestly, and clamped like every other tool');
{
  eq('text content is joined', flattenResult({ content: [{ type: 'text', text: 'hello' }] }),
    'hello');
  eq('...across parts', flattenResult({ content: [
    { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb');

  // A dropped image would read to the model as "the server returned nothing" — the same class of
  // lie as a silently truncated search result.
  check('a non-text part is DESCRIBED rather than dropped',
    /\[image: image\/png, not shown\]/.test(
      flattenResult({ content: [{ type: 'image', mimeType: 'image/png' }] })));
  check('a resource part names its uri',
    /\[resource: file:\/\/x\]/.test(
      flattenResult({ content: [{ type: 'resource', resource: { uri: 'file://x' } }] })));
  check('an unknown part type is still acknowledged',
    /\[audio: not rendered\]/.test(flattenResult({ content: [{ type: 'audio' }] })));

  eq('structured-only content is rendered',
    flattenResult({ structuredContent: { a: 1 } }), '{\n  "a": 1\n}');
  eq('empty content is an empty string', flattenResult({ content: [] }), '');
  eq('a malformed result does not throw', flattenResult(null), '');

  const big = 'x'.repeat(MCP_MAX_RESULT_BYTES + 5000);
  const clamped = clampResult(big);
  check('an oversized result is clamped',
    Buffer.byteLength(clamped, 'utf8') <= MCP_MAX_RESULT_BYTES + 200);
  check('...and SAYS it was clamped', /\[INCOMPLETE RESULT\]/.test(clamped));
  eq('a small result is untouched', clampResult('short'), 'short');
}

// ═══════════════════════════════════════════ compaction heuristic
describe('w9/compaction: mcp__ results are always compaction-eligible');
{
  const msgs = [
    { role: 'assistant', tool_calls: [
      { id: 'c1', function: { name: 'mcp__s__fetch', arguments: '{"url":"a"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'first' },
    { role: 'assistant', tool_calls: [
      { id: 'c2', function: { name: 'mcp__s__fetch', arguments: '{"url":"b"}' } }] },
    { role: 'tool', tool_call_id: 'c2', content: 'second' },
  ];
  const { superseded } = findSuperseded(msgs);
  // DIFFERENT arguments, and the earlier one is still superseded — that is what "always eligible"
  // means. An MCP result is a snapshot of something the harness does not own, so the newest answer
  // from a server tool is the one worth keeping in the window.
  check('an earlier MCP result is superseded by a later call to the same tool',
    superseded.has('c1'), [...superseded].join(','));
  check('...and the latest is kept', !superseded.has('c2'));

  // The contrast that proves this is MCP-specific: a built-in tool with different arguments is
  // NOT superseded, because two reads of different paths are both still true.
  const builtin = [
    { role: 'assistant', tool_calls: [
      { id: 'b1', function: { name: 'read', arguments: '{"path":"a.txt"}' } }] },
    { role: 'tool', tool_call_id: 'b1', content: 'A' },
    { role: 'assistant', tool_calls: [
      { id: 'b2', function: { name: 'read', arguments: '{"path":"b.txt"}' } }] },
    { role: 'tool', tool_call_id: 'b2', content: 'B' },
  ];
  const bi = findSuperseded(builtin);
  check('a built-in read of a DIFFERENT path is not superseded', !bi.superseded.has('b1'),
    [...bi.superseded].join(','));
}

describe('w9/regression: an MCP session must not displace the WORKSPACE binding');
{
  // FOUND BY THE §11.2 GATE, and the sharpest defect of this wave. Until W9 a run bound exactly
  // one resource, so `bindingToReattach` could return "the most recent binding" and be right by
  // construction. MCP sessions are acquired AFTER the workspace, so that helper started returning
  // the MCP session — and `resolveResource` would then compare the workspace's derived id against
  // an MCP id, find a mismatch, and declare the workspace LOST on every resumed run that used a
  // server. W6's recovery contract is a shipped guarantee; W9 silently broke it.
  const events = [
    { seq: 3, type: 'resource.acquired',
      payload: { resource_id: 'res_workspace_aaa', kind: 'workspace', backend: 'ContainerSandbox',
                 handle_name: 'orion-x' } },
    { seq: 5, type: 'resource.acquired',
      payload: { resource_id: 'res_mcp_bbb', kind: 'mcp', backend: 'mcp', server: 'demo' } },
  ];

  const ws = bindingToReattach(events);
  eq('the WORKSPACE binding is what W6 reattaches to', ws?.resource_id, 'res_workspace_aaa');
  eq('...and it keeps its kind', ws?.kind, 'workspace');
  check('...even though the MCP session is more recent',
    projectResources(events).current?.kind === 'mcp');

  eq('an MCP binding is still reachable when explicitly asked for',
    bindingToReattach(events, { kind: 'mcp' })?.resource_id, 'res_mcp_bbb');

  // A log written before this wave must fold exactly as it always did (Invariant 9).
  const preW9 = [events[0]];
  eq('a pre-W9 log is unchanged', bindingToReattach(preW9)?.resource_id, 'res_workspace_aaa');

  // A released workspace is not reattachable, and an MCP session present alongside must not
  // resurrect it.
  const released = [...events,
    { seq: 9, type: 'resource.released', payload: { resource_id: 'res_workspace_aaa' } }];
  eq('a released workspace is not offered for reattach', bindingToReattach(released), null);

  eq('the MCP kind is declared rather than a magic string', ResourceKind.MCP, 'mcp');
}

describe('w9/failures: every failure mode has a distinguishable kind');
{
  const kinds = Object.values(McpFailure);
  eq('the kinds are distinct', new Set(kinds).size, kinds.length);
  for (const k of ['sdk_missing', 'server_unreachable', 'server_error', 'timeout', 'bad_schema'])
    check(`\`${k}\` is a declared failure kind`, kinds.includes(k), kinds.join(','));
}

process.exit(summary('w9 mcp', path.join(HERE, '..', 'results-w9-mcp.json')) ? 1 : 0);
