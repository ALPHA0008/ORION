// W9 — MCP sessions ARE W6 resources.
//
// THE CONSTRAINT THIS MODULE EXISTS TO OBEY
//
// Plan §10.2 W9: "MCP must not introduce a second state system. Session state lives as resource
// events, never in memory only."
//
// So there is no session table, no registry object that outlives a run, and no field that is the
// truth about a session. The truth is `resource.acquired` / `resource.reattached` /
// `resource.released` / `resource.lost` in the run's log — the same four events W6 already uses for
// container sandboxes, with `kind: 'mcp'`. The `Map` below holds LIVE HANDLES (an open stdio pipe
// cannot be stored in a log) and is rebuilt from nothing on every process start. If this module
// vanished mid-run, `explain` would still narrate every session the run opened and closed.
//
// SINGLE-FLIGHT, AND WHY IT IS A CORRECTNESS PROPERTY
//
// A turn can emit several tool calls at once, and several of them may belong to the same server.
// Connecting per call would spawn N processes for one server, emit N `resource.acquired` events
// for one identity, and leave N-1 of them to leak. `#inflight` stores the PROMISE, not the result,
// so concurrent callers await the same connection — the pattern the plan names as TrueForge's
// `getOrCreateToolSource`.
//
// WHAT "REATTACH" HONESTLY MEANS FOR A STDIO SERVER
//
// A stdio MCP server is a child process of this harness (or a `docker exec` into the run's
// container). When the harness is SIGKILLed, that pipe dies with it — there is no handle to
// recover, and pretending otherwise would be the dishonest kind of reattach. What DOES survive is
// the W6 container: it is still running, still holds the server's on-disk state, and is still
// identified by the same derived id. So on resume the session is recorded as `resource.lost` with
// `action: 'recreated'` and reconnected INTO THE SAME CONTAINER. The capability is real, the
// event log says exactly what happened, and nothing claims a pipe was recovered that was not.

import { mcpResourceId, qualifyToolName, MCP_TIMEOUT_MS } from './servers.mjs';
import { connectServer, flattenResult, withTimeout, McpError, McpFailure } from './client.mjs';
import { projectResources } from '../core/projection/resource.mjs';
import { LeaseLostError } from '../core/run/store.mjs';

/** Lifecycle state of one session, as folded from the log. */
export const SessionState = Object.freeze({
  BOUND: 'bound',
  DEGRADED: 'degraded',
  RELEASED: 'released',
  LOST: 'lost',
});

/**
 * Owns every MCP connection a run makes, and records each one as a W6 resource.
 *
 * One instance per run, created at the composition root. Nothing else in the codebase may open an
 * MCP connection — that is what keeps "every MCP call is attributable" true by construction rather
 * than by review.
 */
export class McpSessionManager {
  /**
   * @param {{ store: any, runId: string, leaseToken?: any, project: string,
   *           sandbox?: any, env?: any, servers?: any[], log?: (s: string) => void }} opts
   */
  constructor({ store, runId, leaseToken = null, project, sandbox = null,
                env = process.env, servers = [], log = null }) {
    this.store = store;
    this.runId = runId;
    this.leaseToken = leaseToken;
    this.project = project;
    this.sandbox = sandbox;
    this.env = env;
    this.servers = new Map(servers.map(s => [s.name, s]));
    this.log = log;
    /** @type {Map<string, Promise<any>>} live connection promises, keyed by server name */
    this.inflight = new Map();
    /** @type {Map<string, any>} resolved sessions, keyed by server name */
    this.sessions = new Map();
  }

  /**
   * Append a lifecycle event, tolerating a lease that is already gone.
   *
   * Release happens AFTER the run reaches a terminal state, and at that point the lease may
   * legitimately have been dropped — W6's `releaseResource` catches exactly this and reports
   * "lease lost before release" rather than failing. Without the same tolerance here, the final
   * `resource.released` threw out of `releaseAll`, the CLI printed "lease lost" on an otherwise
   * finished run, and the still-open stdio transport then tripped a libuv double-close assertion
   * on Windows. Measured in the W9 gate; the crash was the second-order effect of this throw.
   */
  #append(type, payload) {
    try {
      return this.store.append(this.runId, type, payload, { leaseToken: this.leaseToken });
    } catch (err) {
      if (err instanceof LeaseLostError) return null;
      throw err;
    }
  }

  /**
   * Had this run already bound this resource id? Read from the LOG, not from a field.
   *
   * This is what makes resume correct after a crash: a fresh process has an empty `sessions` map
   * but a full event log, and the log is what says whether a prior binding exists.
   */
  #priorBinding(resourceId) {
    try {
      const events = this.store.events?.(this.runId) ?? [];
      const { bindings } = projectResources(events);
      return bindings?.[resourceId] ?? null;
    } catch { return null; }
  }

  /**
   * Connect to a server, or return the connection already being made.
   *
   * Never throws: a failed connection is recorded as `degraded` and returned as a failed session,
   * because one unreachable server must not end a run that has ten other working tools.
   */
  getOrCreate(name) {
    const existing = this.inflight.get(name);
    if (existing) return existing;

    const server = this.servers.get(name);
    if (!server) {
      return Promise.resolve({ ok: false, name, kind: McpFailure.UNREACHABLE,
        error: `no MCP server named \`${name}\` is declared` });
    }

    const p = this.#connect(server).catch(e => ({
      ok: false, name, kind: McpFailure.SERVER_ERROR, error: String(e?.message ?? e),
    }));
    this.inflight.set(name, p);
    return p;
  }

  async #connect(server) {
    const resourceId = mcpResourceId({ server, project: this.project });
    const prior = this.#priorBinding(resourceId);

    const res = await connectServer(server, { sandbox: this.sandbox, env: this.env });

    if (!res.ok) {
      // A server that will not come up is DEGRADED, never fatal. The event is what makes the
      // absence visible in the trajectory — a run that quietly had fewer tools than the operator
      // configured is the failure this event exists to prevent.
      this.#append('degraded', {
        // `subsystem` + `reason` is the shape `explain` renders (`DEGRADED [subsystem] reason`).
        // The first version of this used its own field names and printed `⚠ [undefined]` in the
        // gate — a degraded event nobody can read defeats the entire point of recording it.
        subsystem: 'mcp',
        reason: `MCP server \`${server.name}\` is unavailable (${res.kind}): ${res.error}`,
        what: 'mcp_server_unavailable',
        server: server.name,
        resource_id: resourceId,
        kind: res.kind,
        detail: res.error,
        // Expected and explicable, rather than mysterious: with `--network none` a server that
        // needs to fetch itself (`npx -y ...`) cannot, and saying so beats a bare ENOENT.
        note: res.kind === McpFailure.NO_SDK
          ? 'the optional @modelcontextprotocol/sdk is not installed'
          : 'the run continues with built-in tools only',
      });
      const session = { ok: false, name: server.name, resourceId, kind: res.kind,
                        error: res.error, state: SessionState.DEGRADED, tools: [] };
      this.sessions.set(server.name, session);
      return session;
    }

    // A prior binding means this run already had this session and is coming back to it. The pipe
    // itself cannot be recovered (see the header), so the log says `lost` + `recreated` rather
    // than claiming a reattach that did not happen.
    if (prior && prior.state === 'bound') {
      this.#append('resource.lost', {
        resource_id: resourceId,
        reason: 'the MCP stdio session did not survive the process that owned it',
        action: 'recreated',
        kind: 'mcp',
        server: server.name,
      });
      this.#append('resource.reattached', {
        resource_id: resourceId,
        kind: 'mcp',
        backend: 'mcp',
        server: server.name,
        root: this.project,
        handle_name: server.name,
        handle: null,
        evidence: 'reconnected into the same resource identity',
        isolated: res.isolated,
        capabilities: { isolated: res.isolated, network: res.isolated ? 'none' : 'host' },
      });
    } else {
      this.#append('resource.acquired', {
        resource_id: resourceId,
        kind: 'mcp',
        backend: 'mcp',
        server: server.name,
        root: this.project,
        handle_name: server.name,
        handle: null,
        // The command is recorded because "what third-party code did this run execute?" must be
        // answerable from the log alone (Invariant 7). The ENV VALUES are not — only which
        // variable names were passed, so a token never enters the trajectory.
        command: server.command,
        args: server.args,
        env_passed: res.envPassed,
        isolated: res.isolated,
        capabilities: { isolated: res.isolated, network: res.isolated ? 'none' : 'host' },
        tools: res.tools.map(t => t.name),
      });
    }

    if (res.degraded) {
      this.#append('degraded', {
        subsystem: 'mcp',
        reason: `\`${server.name}\` connected but did not advertise a usable tool list: ${res.degraded}`,
        what: 'mcp_tools_unavailable', server: server.name, resource_id: resourceId,
        detail: res.degraded,
        note: 'the server is connected but advertised no usable tool list',
      });
    }

    const session = {
      ok: true, name: server.name, resourceId, client: res.client, server,
      tools: res.tools, isolated: res.isolated, state: SessionState.BOUND,
    };
    this.sessions.set(server.name, session);
    this.log?.(`  mcp: ${server.name} connected`
      + `${res.isolated ? ' (in container, --network none)' : ' (local, NOT isolated)'}`
      + `  ${res.tools.length} tool${res.tools.length === 1 ? '' : 's'}`);
    return session;
  }

  /** Connect to every declared+enabled server. Used at run start so tools exist for turn 1. */
  async connectAll() {
    const names = [...this.servers.values()].filter(s => s.enabled).map(s => s.name);
    return Promise.all(names.map(n => this.getOrCreate(n)));
  }

  /**
   * Invoke one tool on one server.
   *
   * Errors are CLASSIFIED, because the caller has to distinguish "the tool ran and said no" from
   * "the server died" — the second is a lost resource and the first is not.
   */
  async callTool(serverName, toolName, args) {
    const session = await this.getOrCreate(serverName);
    if (!session.ok)
      throw new McpError(`MCP server \`${serverName}\` is unavailable: ${session.error}`,
        { kind: session.kind, server: serverName });

    const timeoutMs = session.server?.timeoutMs ?? MCP_TIMEOUT_MS;
    let result;
    try {
      result = await withTimeout(
        session.client.callTool({ name: toolName, arguments: args ?? {} }),
        timeoutMs,
        () => new McpError(`\`${qualifyToolName(serverName, toolName)}\` did not answer within `
          + `${timeoutMs}ms`, { kind: McpFailure.TIMEOUT, server: serverName }));
    } catch (e) {
      // A dead transport is a LOST RESOURCE, and the log has to say so — otherwise a resumed run
      // would believe it still holds a session that no longer exists.
      const msg = String(e?.message ?? e);
      const kind = e instanceof McpError ? e.kind : McpFailure.SERVER_ERROR;
      if (kind !== McpFailure.TIMEOUT || /closed|EPIPE|ECONNRESET/i.test(msg)) {
        session.state = SessionState.LOST;
        this.sessions.delete(serverName);
        this.inflight.delete(serverName);
        this.#append('resource.lost', {
          resource_id: session.resourceId, kind: 'mcp', server: serverName,
          reason: msg, action: 'released',
        });
      }
      throw new McpError(msg, { kind, server: serverName });
    }

    // `isError` is the protocol's way of saying the TOOL failed while the SERVER is healthy. That
    // distinction has to survive into the trajectory: it becomes `tool.failed`, not a lost
    // resource, and the session stays up for the next call.
    if (result?.isError) {
      throw new McpError(flattenResult(result) || 'the MCP tool reported an error',
        { kind: McpFailure.SERVER_ERROR, server: serverName });
    }
    return flattenResult(result);
  }

  /** Provenance for one call, folded into `tool.succeeded.ext.mcp` by the worker. */
  provenance(serverName, toolName) {
    const s = this.sessions.get(serverName);
    return {
      server: serverName,
      tool: toolName,
      session_id: s?.resourceId ?? mcpResourceId({
        server: this.servers.get(serverName) ?? { name: serverName, command: '', args: [] },
        project: this.project }),
      isolated: s?.isolated ?? false,
    };
  }

  /**
   * Close every session and record it.
   *
   * Called on normal completion AND on failure, because a released resource that was never
   * recorded as released is indistinguishable in the log from one that leaked.
   */
  async releaseAll(reason = 'run finished') {
    const names = [...this.sessions.keys()];
    for (const name of names) {
      const s = this.sessions.get(name);
      if (!s?.ok) continue;
      try { await s.client?.close?.(); } catch { /* already gone; the event still records intent */ }
      this.#append('resource.released', {
        resource_id: s.resourceId, kind: 'mcp', server: name, reason,
      });
      s.state = SessionState.RELEASED;
    }
    this.sessions.clear();
    this.inflight.clear();
  }
}
