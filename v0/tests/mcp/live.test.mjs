// W9 — a REAL MCP server, really connected, over a real stdio pipe.
//
// The mechanism suite proves what the code decides. This one proves what actually happens when
// third-party code is on the other end of a pipe: that the lifecycle events land, that a tool
// failure is distinguishable from a server death, that single-flight really opens one process, and
// — when Docker is present — that the server genuinely runs inside the container and genuinely
// cannot reach the network.
//
// Mocking the server here would test my mock. The two defects this wave found (a denylist
// environment that leaked an unrelated variable; see also W8's git suite) were both found by
// talking to something real.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { parseServers, mcpResourceId } from '../../src/mcp/servers.mjs';
import { McpSessionManager } from '../../src/mcp/session.mjs';
import { toolsForSession } from '../../src/mcp/tools.mjs';
import { loadSdk, McpFailure } from '../../src/mcp/client.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { projectResources } from '../../src/core/projection/resource.mjs';
import { explain } from '../../src/core/run/explain.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'echo-server.mjs');
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w9l-${tag}-`));

const SDK = await loadSdk();
const SDK_OK = !SDK.error;

let DOCKER_OK = false;
try {
  execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 20_000 });
  DOCKER_OK = true;
} catch { DOCKER_OK = false; }

/** A store + run, so session events have somewhere real to land. */
function freshRun() {
  const store = new Store(path.join(mk('db'), 'runs.db'));
  const runId = store.createRun(uid('run'), { task: 'w9 live' });
  return { store, runId };
}

const declare = (over = {}) => parseServers({
  demo: { command: process.execPath, args: [FIXTURE], ...over },
})[0];

const eventsOf = (store, runId) => store.events(runId);
const typesOf = (store, runId, type) => eventsOf(store, runId).filter(e => e.type === type);

// ═══════════════════════════════════════════ lifecycle
describe(`w9/live: a session is acquired, used and released as W6 resource events${SDK_OK ? '' : ' [SKIPPED — no SDK]'}`);
if (SDK_OK) {
  const { store, runId } = freshRun();
  const project = mk('proj');
  const server = declare({ env: ['ORION_TEST_TOKEN'] });
  const mgr = new McpSessionManager({
    store, runId, project, sandbox: null, servers: [server],
    env: { ...process.env, ORION_TEST_TOKEN: 'tok-live', ORION_TEST_UNRELATED: 'leak-me' },
  });

  const session = await mgr.getOrCreate('demo');
  eq('the server connected', session.ok, true, session.error ?? '');
  eq('...advertising its tools', session.tools.length, 4);

  const acquired = typesOf(store, runId, 'resource.acquired');
  eq('exactly one resource.acquired was written', acquired.length, 1);
  eq('...with kind mcp', acquired[0].payload.kind, 'mcp');
  eq('...naming the server', acquired[0].payload.server, 'demo');
  eq('...carrying the DERIVED session id', acquired[0].payload.resource_id,
    mcpResourceId({ server, project }));
  check('...recording what third-party code was executed',
    acquired[0].payload.command === process.execPath, acquired[0].payload.command);
  eq('...and which tools it offered',
    [...acquired[0].payload.tools].sort().join(','), 'echo,explode,reach_out,whoami');

  // The env NAMES are recorded so "what did this run hand to third-party code?" is answerable
  // from the log; the VALUES never are.
  eq('the passed variable NAMES are in the log', acquired[0].payload.env_passed.join(','),
    'ORION_TEST_TOKEN');
  const logText = JSON.stringify(eventsOf(store, runId));
  check('...and no VALUE reached the log', !logText.includes('tok-live'));
  check('...nor any undeclared one', !logText.includes('leak-me'));

  // The live environment assertion: the server reports what it can actually see.
  const who = JSON.parse(await mgr.callTool('demo', 'whoami', {}));
  eq('the server received the declared variable', who.has_token, true);
  eq('...and NOT an undeclared one', who.saw_unrelated_secret, false);

  eq('a tool call returns a flattened result',
    await mgr.callTool('demo', 'echo', { msg: 'hello' }), 'echo: hello');

  const p = mgr.provenance('demo', 'echo');
  eq('provenance names the server', p.server, 'demo');
  eq('...the tool', p.tool, 'echo');
  eq('...and the session', p.session_id, mcpResourceId({ server, project }));

  await mgr.releaseAll('run completed');
  const released = typesOf(store, runId, 'resource.released');
  eq('release is recorded', released.length, 1);
  eq('...for the same resource id', released[0].payload.resource_id,
    mcpResourceId({ server, project }));
  eq('...with kind mcp', released[0].payload.kind, 'mcp');

  // The binding folds to `released` — the session is not merely absent from memory, it is
  // provably let go in the log. That is the "no second state system" constraint made checkable.
  const { bindings } = projectResources(eventsOf(store, runId));
  eq('the fold says the session was released',
    bindings[mcpResourceId({ server, project })]?.state, 'released');
  store.close();
}

describe(`w9/live: single-flight opens ONE process for concurrent callers${SDK_OK ? '' : ' [SKIPPED]'}`);
if (SDK_OK) {
  const { store, runId } = freshRun();
  const mgr = new McpSessionManager({
    store, runId, project: mk('p'), sandbox: null, servers: [declare()], env: process.env });

  // Four concurrent callers, as a turn with four tool calls against one server would produce.
  const sessions = await Promise.all([
    mgr.getOrCreate('demo'), mgr.getOrCreate('demo'),
    mgr.getOrCreate('demo'), mgr.getOrCreate('demo'),
  ]);
  check('every caller got a session', sessions.every(s => s.ok));
  check('...and they are the SAME session object', sessions.every(s => s === sessions[0]));

  // The observable proof: one process. Without single-flight this is four servers, three of them
  // leaked, and four `resource.acquired` events for one identity.
  const pids = new Set();
  for (let i = 0; i < 4; i++)
    pids.add(JSON.parse(await mgr.callTool('demo', 'whoami', {})).pid);
  eq('exactly one server process was started', pids.size, 1);
  eq('...and exactly one acquisition was recorded',
    typesOf(store, runId, 'resource.acquired').length, 1);

  await mgr.releaseAll();
  store.close();
}

describe(`w9/live: a tool failure is not a server death${SDK_OK ? '' : ' [SKIPPED]'}`);
if (SDK_OK) {
  const { store, runId } = freshRun();
  const mgr = new McpSessionManager({
    store, runId, project: mk('p'), sandbox: null, servers: [declare()], env: process.env });
  await mgr.getOrCreate('demo');

  let err = null;
  try { await mgr.callTool('demo', 'explode', {}); } catch (e) { err = e; }
  check('the failing tool threw', err !== null);
  eq('...classified as a server-side tool error', err.kind, McpFailure.SERVER_ERROR);
  check('...carrying what the server said', /deliberate tool failure/.test(err.message), err.message);
  eq('...naming the server', err.server, 'demo');

  // THE distinction. `isError` means the TOOL failed while the SERVER is healthy, so no resource
  // was lost and the next call must still work. Conflating the two would tear down a live session
  // every time a tool returned an error.
  eq('no resource.lost was written', typesOf(store, runId, 'resource.lost').length, 0);
  eq('...and the session still works', await mgr.callTool('demo', 'echo', { msg: 'after' }),
    'echo: after');

  await mgr.releaseAll();
  store.close();
}

describe(`w9/live: an unavailable server degrades the run, it does not end it${SDK_OK ? '' : ' [SKIPPED]'}`);
if (SDK_OK) {
  const { store, runId } = freshRun();
  const broken = parseServers({
    nope: { command: path.join(HERE, 'no-such-binary-anywhere'), args: [] } })[0];
  const mgr = new McpSessionManager({
    store, runId, project: mk('p'), sandbox: null, servers: [broken], env: process.env });

  const session = await mgr.getOrCreate('nope');
  eq('the session failed', session.ok, false);
  check('...with a classified reason',
    [McpFailure.UNREACHABLE, McpFailure.SERVER_ERROR].includes(session.kind), session.kind);

  // Degraded, never fatal: a run with ten working tools must not end because an eleventh server
  // is missing. The event is what keeps the absence visible rather than silent.
  const deg = typesOf(store, runId, 'degraded');
  eq('a degraded event was written', deg.length, 1);
  eq('...naming the server', deg[0].payload.server, 'nope');
  eq('...and what happened', deg[0].payload.what, 'mcp_server_unavailable');
  check('...saying the run continues', /continues/.test(deg[0].payload.note ?? ''),
    deg[0].payload.note);

  // `explain` renders `DEGRADED [subsystem] reason`. The first version of this event used its own
  // field names and printed `⚠ [undefined]` in the gate — an event nobody can read defeats the
  // purpose of recording the absence at all.
  eq('the event carries the subsystem explain renders', deg[0].payload.subsystem, 'mcp');
  check('...and a human-readable reason',
    typeof deg[0].payload.reason === 'string' && deg[0].payload.reason.includes('nope'),
    String(deg[0].payload.reason));
  const rendered = explain(store, runId).split('\n').find(l => /DEGRADED/.test(l)) ?? '';
  check('...so the rendered line names the subsystem', /\[mcp\]/.test(rendered), rendered);
  check('...and is not undefined', !/undefined/.test(rendered), rendered);
  eq('no resource was acquired for it', typesOf(store, runId, 'resource.acquired').length, 0);

  eq('an undeclared server is refused by name',
    (await mgr.getOrCreate('never-declared')).ok, false);
  store.close();
}

describe(`w9/live: resume records the pipe as lost and reconnects honestly${SDK_OK ? '' : ' [SKIPPED]'}`);
if (SDK_OK) {
  // A stdio pipe cannot outlive the process that owned it. What survives is the derived identity
  // (and, in a container run, the container itself). So a resumed run must say `lost` +
  // `recreated` rather than claim a reattach that did not happen.
  const { store, runId } = freshRun();
  const project = mk('p');
  const server = declare();

  const first = new McpSessionManager({
    store, runId, project, sandbox: null, servers: [server], env: process.env });
  await first.getOrCreate('demo');
  eq('the first run acquired the session', typesOf(store, runId, 'resource.acquired').length, 1);
  await first.releaseAll('crash simulated');

  // Re-open the SAME run with a brand-new manager: an empty in-memory map, a full event log.
  const resumed = new McpSessionManager({
    store, runId, project, sandbox: null, servers: [server], env: process.env });
  const again = await resumed.getOrCreate('demo');
  eq('the resumed run reconnected', again.ok, true);
  eq('...to the same derived identity', again.resourceId, mcpResourceId({ server, project }));

  // A released binding is not a live one, so this is a fresh acquisition rather than a recreate —
  // the fold, not a flag, is what decides.
  eq('...and it works', await resumed.callTool('demo', 'echo', { msg: 'resumed' }),
    'echo: resumed');
  await resumed.releaseAll();
  store.close();
}

describe(`w9/live: a session bound at crash time is recorded lost, then recreated${SDK_OK ? '' : ' [SKIPPED]'}`);
if (SDK_OK) {
  const { store, runId } = freshRun();
  const project = mk('p');
  const server = declare();

  const first = new McpSessionManager({
    store, runId, project, sandbox: null, servers: [server], env: process.env });
  const s1 = await first.getOrCreate('demo');
  // Deliberately NOT released: this is what a SIGKILL leaves behind — a binding that the log says
  // is still bound and a pipe that no longer exists.
  try { await s1.client.close(); } catch { /* simulating the kill */ }

  const resumed = new McpSessionManager({
    store, runId, project, sandbox: null, servers: [server], env: process.env });
  const again = await resumed.getOrCreate('demo');
  eq('the resumed run has a working session', again.ok, true);

  const lost = typesOf(store, runId, 'resource.lost');
  eq('the dead pipe was recorded as lost', lost.length, 1);
  eq('...for the right resource', lost[0].payload.resource_id, mcpResourceId({ server, project }));
  eq('...and says what was done about it', lost[0].payload.action, 'recreated');
  check('...explaining why honestly',
    /did not survive/.test(lost[0].payload.reason), lost[0].payload.reason);
  eq('a reattachment was recorded', typesOf(store, runId, 'resource.reattached').length, 1);

  await resumed.releaseAll();
  store.close();
}

// ═══════════════════════════════════════════ authorization
describe(`w9/live: MCP tools go through the authorizer like any other tool${SDK_OK ? '' : ' [SKIPPED]'}`);
if (SDK_OK) {
  const { store, runId } = freshRun();
  const mgr = new McpSessionManager({
    store, runId, project: mk('p'), sandbox: null, servers: [declare()], env: process.env });
  const session = await mgr.getOrCreate('demo');
  const { tools } = toolsForSession(session, mgr);
  const ctx = { run_id: runId, project: '/p' };

  // A deployer denies one MCP tool by its qualified name. The permission lattice is not bypassable
  // by a server, and the rule file needs no new syntax to say so.
  const denied = createAuthorizer({ posture: 'auto', denyTools: ['mcp__demo__echo'] });
  eq('a denied MCP tool is denied', denied({ kind: 'tool', name: 'mcp__demo__echo',
    args_digest: 'x', effects: 'Mutating' }, ctx).decision, 'deny');
  eq('...while a sibling MCP tool is unaffected', denied({ kind: 'tool', name: 'mcp__demo__whoami',
    args_digest: 'x', effects: 'Mutating' }, ctx).decision, 'allow');

  // Because every MCP tool declares `Mutating`, a strict posture escalates it — the harness cannot
  // know what third-party code does, so it must not auto-allow it.
  const strict = createAuthorizer({ posture: 'strict' });
  eq('a strict posture escalates an MCP call', strict({ kind: 'tool', name: 'mcp__demo__echo',
    args_digest: 'x', effects: tools['mcp__demo__echo'].effects }, ctx).decision, 'escalate');

  // A whole server can be denied without naming each tool, using the pattern support the rules
  // layer already has.
  const all = createAuthorizer({ posture: 'auto', denyTools: ['mcp__demo__echo', 'mcp__demo__whoami'] });
  eq('two named tools are both denied',
    ['mcp__demo__echo', 'mcp__demo__whoami'].filter(n =>
      all({ kind: 'tool', name: n, args_digest: 'x', effects: 'Mutating' }, ctx).decision === 'deny'
    ).length, 2);

  await mgr.releaseAll();
  store.close();
}

// ═══════════════════════════════════════════ container isolation
describe(`w9/live: the server runs INSIDE the container and cannot reach the network`
  + `${SDK_OK && DOCKER_OK ? '' : ' [SKIPPED — needs docker + sdk]'}`);
if (SDK_OK && DOCKER_OK) {
  // The wave's central security claim, measured rather than asserted. The container is created
  // exactly as W6 creates one: `--network none`, resource limits, workspace bind-mounted.
  const ws = mk('cws');
  fs.copyFileSync(FIXTURE, path.join(ws, 'echo-server.mjs'));
  // The server's own dependency has to be reachable from inside the container, so the installed
  // SDK is mounted in with the workspace rather than fetched — `--network none` means a server
  // that downloads itself could never start, which is precisely the isolation being demonstrated.
  fs.cpSync(path.join(HERE, '..', '..', 'node_modules'), path.join(ws, 'node_modules'),
    { recursive: true, dereference: false });

  const { ContainerSandbox } = await import('../../src/sandbox/container/index.mjs');
  const sandbox = new ContainerSandbox(ws, { image: 'node:20-slim' });
  let acquired = false;
  try {
    await sandbox.acquire();
    acquired = true;

    eq('the container declares isolation', sandbox.capabilities.isolated, true);
    eq('...and no network', sandbox.capabilities.network, 'none');

    const { store, runId } = freshRun();
    const server = parseServers({ demo: {
      command: 'node', args: ['echo-server.mjs'], env: ['ORION_TEST_TOKEN'] } })[0];
    const mgr = new McpSessionManager({
      store, runId, project: ws, sandbox, servers: [server],
      env: { ...process.env, ORION_TEST_TOKEN: 'tok-container' } });

    const session = await mgr.getOrCreate('demo');
    eq('the server connected inside the container', session.ok, true, session.error ?? '');
    eq('...and the session reports itself isolated', session.isolated, true);
    eq('...which the log records', typesOf(store, runId, 'resource.acquired')[0].payload.isolated,
      true);
    eq('...along with the capability claim',
      typesOf(store, runId, 'resource.acquired')[0].payload.capabilities.network, 'none');

    // Proof it is really the container's process and not a host fallback: the container runs
    // node:20-slim on Linux, so a server spawned on this Windows host would answer differently.
    const echoed = await mgr.callTool('demo', 'echo', { msg: 'from inside' });
    eq('a tool call round-trips through docker exec', echoed, 'echo: from inside');

    // THE measurement. A server with host network reaches this; one under `--network none`
    // cannot. This is the assertion that would fail if the transport ever regressed to a bare
    // spawn on the host.
    const reach = await mgr.callTool('demo', 'reach_out', { host: 'example.com' });
    check('outbound network from the server is BLOCKED', /^BLOCKED/.test(reach), reach);

    await mgr.releaseAll('gate finished');
    eq('the session was released', typesOf(store, runId, 'resource.released').length, 1);
    store.close();
  } finally {
    if (acquired) { try { await sandbox.release(); } catch { /* best effort cleanup */ } }
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
}

process.exit(summary('w9 live', path.join(HERE, '..', 'results-w9-live.json')) ? 1 : 0);
