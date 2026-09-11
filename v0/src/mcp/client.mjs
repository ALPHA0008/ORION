// W9 — the MCP client: connecting to third-party code, inside the W6 boundary.
//
// THE FIRST JUSTIFIED DEPENDENCY
//
// `@modelcontextprotocol/sdk` is the only dependency this project has taken, and it is taken
// LAZILY and OPTIONALLY:
//
//   - it is declared in `optionalDependencies` at an EXACT pin (no caret). A range on a package
//     that speaks a protocol to third-party code means a `npm install` months from now silently
//     changes what the harness trusts;
//   - `dependencies` stays empty, so `npm install @kernlbase/orion` still installs zero required
//     packages and every non-MCP user pays nothing for this wave;
//   - it is imported by DYNAMIC import at connect time, inside a try/catch. A tree without the SDK
//     is not a broken tree: MCP degrades, the tools are excluded, and the run continues on
//     built-in tools. That is the same posture the container backend takes when Docker is absent,
//     except that here falling back is safe — an absent MCP server removes capability, it does not
//     silently remove isolation.
//
// Reimplementing the protocol to avoid the dependency was the alternative, and it is the worse
// one: a hand-rolled JSON-RPC client that is subtly wrong against real servers is a larger
// liability than a pinned, audited SDK.
//
// WHERE THE SERVER ACTUALLY RUNS
//
// This is the security core of the wave. An MCP server is third-party code with network access,
// invoked by a model. When the run has a container sandbox, the server is spawned INSIDE that
// container via `docker exec -i`, so it inherits — without this module enforcing anything itself —
// the container's `--network none`, its cgroup CPU/memory/PID limits, and its filesystem view.
// The isolation is the W6 boundary's, not a new one invented here.
//
// On `LocalSandbox` there is no such boundary, and this module does not pretend otherwise: the
// server runs as an ordinary child process with a scrubbed environment, and `isolated: false` is
// reported so the caller can record it honestly.

import { spawn } from 'node:child_process';
import { scrubEnv } from '../sandbox/local/index.mjs';
import { MCP_CONNECT_TIMEOUT_MS, MCP_MAX_RESULT_BYTES } from './servers.mjs';

/** Why a connection or call failed, in terms a caller can branch on. */
export const McpFailure = Object.freeze({
  NO_SDK: 'sdk_missing',
  UNREACHABLE: 'server_unreachable',
  SERVER_ERROR: 'server_error',
  TIMEOUT: 'timeout',
  BAD_SCHEMA: 'bad_schema',
});

export class McpError extends Error {
  /** @param {string} message @param {{ kind: string, server?: string|null }} info */
  constructor(message, { kind, server = null }) {
    super(message);
    this.name = 'McpError';
    this.kind = kind;
    this.server = server;
  }
}

/**
 * Load the SDK, or explain precisely why MCP is unavailable.
 *
 * Cached across calls including the failure, so a tree without the SDK does not pay a failed
 * module resolution once per server per run.
 */
let sdkCache;
export async function loadSdk() {
  if (sdkCache !== undefined) return sdkCache;
  try {
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
    ]);
    sdkCache = { Client, StdioClientTransport };
  } catch (e) {
    sdkCache = { error: String(e?.message ?? e) };
  }
  return sdkCache;
}

/** Test seam: forget a cached load so a suite can exercise both branches. */
export function resetSdkCache() { sdkCache = undefined; }

/**
 * Build the argv that starts a server, given where it has to run.
 *
 * Pure and exported because it is the single most security-relevant decision in the wave, and a
 * test asserting "the server really is wrapped in `docker exec` on a container sandbox" should not
 * need a running daemon to make that assertion.
 */
export function transportArgv(server, sandbox) {
  const isolated = sandbox?.capabilities?.isolated === true;
  const runtime = sandbox?.runtime;
  const containerId = sandbox?.containerId;

  if (isolated && runtime && containerId) {
    // `-i` keeps stdin open: MCP is a bidirectional stdio protocol, and without it the server
    // reads EOF immediately and exits, which surfaces as an unreachable server rather than as a
    // missing flag.
    const workdir = server.cwd ?? sandbox.containerWorkspace ?? '/workspace';
    return {
      command: runtime,
      args: ['exec', '-i', '--workdir', workdir, containerId, server.command, ...server.args],
      isolated: true,
    };
  }
  return {
    command: server.command,
    args: [...server.args],
    isolated: false,
  };
}

/**
 * The variables a process needs merely to START. Everything else is opt-in.
 *
 * This is an ALLOWLIST, and the distinction is the whole point. `scrubEnv` — which every other
 * child process in this project uses — is a DENYLIST: it strips names that look like secrets and
 * passes everything else. That is the right trade for running the user's own commands, and the
 * wrong one for third-party code, because it only protects against credentials whose names we
 * anticipated. A live probe of this wave's own test server confirmed the gap: with a denylist the
 * server could read an unrelated variable that simply did not match the secret pattern.
 *
 * The list mirrors the one the MCP SDK itself inherits by default, kept here rather than imported
 * so this decision does not depend on the optional dependency being loadable.
 */
const BASE_ENV_ALLOW = Object.freeze([
  // POSIX
  'PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'USER',
  // Windows
  'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PROCESSOR_ARCHITECTURE',
  'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERNAME', 'USERPROFILE',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'COMSPEC', 'PATHEXT', 'WINDIR',
]);

/**
 * The environment an MCP server is given: a minimal base, plus exactly what was declared.
 *
 * A server that needs a token gets that token and the handful of variables required to execute at
 * all — not the ambient environment, which on a developer machine holds every other credential
 * they own. `scrubEnv` is still applied on top, so a secret-shaped name can never survive even if
 * it were somehow allowlisted or explicitly named.
 */
export function serverEnv(server, env = process.env) {
  /** @type {Record<string,string|undefined>} */
  const inherited = {};
  for (const k of BASE_ENV_ALLOW) {
    const v = env[k];
    if (v !== undefined) inherited[k] = v;
  }
  // The INHERITED half is scrubbed, because it was never deliberately chosen — it is whatever the
  // machine happened to have. The DECLARED half is not, and must not be: `SECRET_RE` matches
  // `TOKEN`, so scrubbing declared names would make `env: ["GITHUB_TOKEN"]` silently pass nothing
  // and leave the operator debugging an auth failure in someone else's server. An explicit
  // declaration IS the authorization; that is the entire point of naming variables one at a time.
  const base = /** @type {Record<string,string|undefined>} */ ({ ...scrubEnv(inherited) });

  const passed = [];
  for (const name of server.env ?? []) {
    const v = env[name];
    if (v === undefined || v === '') continue;
    base[name] = v;
    passed.push(name);
  }
  return { env: base, passed };
}

/** The base variables an MCP server inherits, exported so a test can assert the allowlist shape. */
export const baseEnvAllowList = () => [...BASE_ENV_ALLOW];

/**
 * Connect to one MCP server and list what it offers.
 *
 * Returns a live connection plus the advertised tools. Never throws for an ordinary failure — the
 * caller gets `{ ok: false, kind, error }` because "this server is unreachable" is an ANSWER the
 * run continues past, exactly as W8 made "not a git repository" an answer rather than a crash.
 */
export async function connectServer(server, { sandbox = null, env = process.env,
                                              connectTimeoutMs = MCP_CONNECT_TIMEOUT_MS } = {}) {
  const sdk = await loadSdk();
  if (sdk.error) {
    return { ok: false, kind: McpFailure.NO_SDK,
      error: `@modelcontextprotocol/sdk is not installed, so MCP servers cannot be used. `
           + `Install it with \`npm install @modelcontextprotocol/sdk\` — it is an OPTIONAL `
           + `dependency, so a tree without it is a working tree without MCP. (${sdk.error})` };
  }

  const argv = transportArgv(server, sandbox);
  const { env: childEnv, passed } = serverEnv(server, env);

  let client = null;
  try {
    const transport = new sdk.StdioClientTransport({
      command: argv.command,
      args: argv.args,
      env: childEnv,
      // The server's stderr is its diagnostics channel, not its protocol channel. Piping it keeps
      // a chatty server from interleaving into this process's stdout — which would corrupt
      // `--json` output, a lesson this project already paid for once.
      stderr: 'pipe',
      ...(argv.isolated ? {} : (server.cwd ? { cwd: server.cwd } : {})),
    });

    client = new sdk.Client({ name: 'orion', version: 'w9' }, { capabilities: {} });

    await withTimeout(client.connect(transport), connectTimeoutMs,
      () => new McpError(`server \`${server.name}\` did not complete the MCP handshake within `
        + `${connectTimeoutMs}ms`, { kind: McpFailure.TIMEOUT, server: server.name }));

    // A server that advertises NOTHING is still a successful connection — it may offer resources
    // or prompts rather than tools. Treating an empty tool list as a failure would disconnect a
    // perfectly working server.
    let tools = [];
    let degraded = null;
    try {
      const listed = await withTimeout(client.listTools(), connectTimeoutMs,
        () => new McpError(`server \`${server.name}\` did not answer tools/list within `
          + `${connectTimeoutMs}ms`, { kind: McpFailure.TIMEOUT, server: server.name }));
      tools = Array.isArray(listed?.tools) ? listed.tools : [];
    } catch (e) {
      // Failing to advertise is DEGRADED, not fatal: the session stays up, and the run proceeds
      // with no tools from this server rather than with no run.
      degraded = String(e?.message ?? e);
    }

    return { ok: true, client, tools, degraded, isolated: argv.isolated,
             argv, envPassed: passed };
  } catch (e) {
    try { await client?.close?.(); } catch { /* the connection never came up */ }
    const msg = String(e?.message ?? e);
    const kind = e instanceof McpError ? e.kind
      : /ENOENT|not found|spawn/i.test(msg) ? McpFailure.UNREACHABLE
      : McpFailure.SERVER_ERROR;
    return { ok: false, kind, error: msg, argv };
  }
}

/** Race a promise against a wall clock, so one wedged server cannot consume a whole turn. */
export async function withTimeout(promise, ms, makeError) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(makeError()), ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Flatten an MCP tool result into the string shape every other tool in this project returns.
 *
 * MCP content is a typed array (`text`, `image`, `resource`). The model's tool channel is text, so
 * non-text parts are DESCRIBED rather than dropped — a silently missing image would read as a
 * server that returned nothing, which is the same class of lie as a silently truncated search.
 */
export function flattenResult(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const out = [];
  for (const p of parts) {
    if (p?.type === 'text') out.push(String(p.text ?? ''));
    else if (p?.type === 'image') out.push(`[image: ${p.mimeType ?? 'unknown'}, not shown]`);
    else if (p?.type === 'resource')
      out.push(`[resource: ${p.resource?.uri ?? 'unknown'}]`
        + (typeof p.resource?.text === 'string' ? `\n${p.resource.text}` : ''));
    else if (p?.type) out.push(`[${p.type}: not rendered]`);
  }
  // `structuredContent` is the newer typed channel; when a server sends only that, rendering it is
  // the difference between an answer and an empty string.
  if (!out.length && result?.structuredContent !== undefined)
    out.push(JSON.stringify(result.structuredContent, null, 2));

  return clampResult(out.join('\n').trim());
}

/** The same honesty contract the search layer uses: a clamped answer SAYS it was clamped. */
export function clampResult(text, max = MCP_MAX_RESULT_BYTES) {
  const s = String(text ?? '');
  const bytes = Buffer.byteLength(s, 'utf8');
  if (bytes <= max) return s;
  return `${s.slice(0, Math.floor(max * 0.8))}\n\n[INCOMPLETE RESULT] MCP result truncated: `
       + `${bytes} bytes > ${max} limit — narrow the request.`;
}
