// W9 — MCP server DECLARATIONS: what the config file is allowed to say.
//
// This module is deliberately pure. It parses and validates the `mcpServers` block and computes a
// stable identity for each declaration; it connects to nothing and spawns nothing. Keeping the
// declaration layer free of I/O is what lets the validation tests run without Docker, without the
// SDK installed, and without a server on the machine.
//
// WHY A SERVER DECLARATION IS A SECURITY OBJECT
//
// `{ "command": "npx", "args": ["-y", "some-server"] }` is a request to execute third-party code
// that the model will then invoke. It is the single most dangerous thing the config file can
// express, which is why:
//
//   - the declaration is validated STRICTLY and a bad one is fatal rather than skipped. A server
//     the operator believes is declared and is not is the config failure this project already
//     decided to make impossible (W8);
//   - `env` may name variables to PASS THROUGH, never values to set. A config file is meant to be
//     committed, and the W8 rule that a secret's value never lives in the file does not get an
//     exception for MCP;
//   - identity is DERIVED from the declaration (W6's `resourceId` discipline), so the same server
//     declaration reattaches to the same session after a crash and a CHANGED declaration
//     deliberately does not.

import path from 'node:path';
import crypto from 'node:crypto';

/** Wall clock for one MCP request (tools/list, tools/call) before it is abandoned. */
export const MCP_TIMEOUT_MS = 120_000;

/** How long a server gets to complete the protocol handshake before it is called unreachable. */
export const MCP_CONNECT_TIMEOUT_MS = 30_000;

/** Bytes of a single MCP tool result that reach the model before the result is clamped. */
export const MCP_MAX_RESULT_BYTES = 64 * 1024;

/** The prefix that makes an MCP tool distinguishable from a built-in one, at runtime. */
export const MCP_PREFIX = 'mcp__';

/** Keys a server declaration may carry, and the type each must be. */
const SERVER_FIELDS = Object.freeze({
  command: 'string',
  args: 'array',
  env: 'array',
  cwd: 'string',
  timeoutMs: 'number',
  enabled: 'boolean',
});

export class McpConfigError extends Error {
  /** @param {string} message @param {{ field?: string|null, file?: string|null }} [info] */
  constructor(message, { field = null, file = null } = {}) {
    super(message);
    this.name = 'McpConfigError';
    this.field = field;
    this.file = file;
  }
}

/**
 * A server NAME becomes part of every tool name the model sees (`mcp__<name>__<tool>`), so it has
 * to survive being parsed back out. Restricting it to `[A-Za-z0-9_-]` keeps the three-part split
 * unambiguous — a name containing `__` would make `mcp__a__b__c` mean two different things.
 */
export function validateServerName(name, { file = null } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name))
    throw new McpConfigError(
      `mcpServers: \`${name}\` is not a usable server name — use letters, digits, hyphen and `
      + `underscore only (it becomes part of the tool name the model sees).`,
      { field: `mcpServers.${name}`, file });
  if (name.includes('__'))
    throw new McpConfigError(
      `mcpServers: \`${name}\` may not contain a double underscore — \`${MCP_PREFIX}\` uses \`__\` `
      + `as its separator, so the tool name could not be parsed back into server and tool.`,
      { field: `mcpServers.${name}`, file });
  return name;
}

/**
 * Validate the whole `mcpServers` block and return normalised declarations.
 *
 * Throws `McpConfigError` on anything malformed. The CLI turns that into a non-zero exit — a
 * config error that lets the run continue would mean running without a server the operator
 * declared, which is the silent-weakening failure mode W8 established as unacceptable.
 */
export function parseServers(block, { file = null } = {}) {
  if (block === undefined || block === null) return [];
  if (typeof block !== 'object' || Array.isArray(block))
    throw new McpConfigError(
      `mcpServers must be an object mapping a server name to its declaration, got `
      + `${Array.isArray(block) ? 'array' : typeof block}`, { field: 'mcpServers', file });

  const out = [];
  for (const [name, decl] of Object.entries(block)) {
    validateServerName(name, { file });
    if (decl === null || typeof decl !== 'object' || Array.isArray(decl))
      throw new McpConfigError(
        `mcpServers.${name} must be an object with at least a \`command\``,
        { field: `mcpServers.${name}`, file });

    for (const [k, v] of Object.entries(decl)) {
      const want = SERVER_FIELDS[k];
      if (!want)
        throw new McpConfigError(
          `mcpServers.${name}.${k} is not a known field. Known: ${Object.keys(SERVER_FIELDS).join(', ')}`,
          { field: `mcpServers.${name}.${k}`, file });
      const actual = Array.isArray(v) ? 'array' : typeof v;
      if (actual !== want) {
        // `env` gets the teaching message rather than the generic type error, because
        // `{"env": {"TOKEN": "..."}}` is the shape OTHER MCP clients use. Someone copying a
        // working config from elsewhere will write exactly that, and the useful reply is why this
        // runtime refuses values — not "expected array, got object".
        if (k === 'env')
          throw new McpConfigError(
            `mcpServers.${name}.env must be a list of variable NAMES to pass through, not a map of `
            + `values — e.g. ["GITHUB_TOKEN"]. Other MCP clients accept {"NAME": "value"} here; this `
            + `one does not, because a config file is meant to be committed and the value would be `
            + `committed with it. The file names the variable; the value stays in the environment.`,
            { field: `mcpServers.${name}.env`, file });
        throw new McpConfigError(
          `mcpServers.${name}.${k} must be ${want === 'array' ? 'an array' : `a ${want}`}, got ${actual}`,
          { field: `mcpServers.${name}.${k}`, file });
      }
    }

    if (typeof decl.command !== 'string' || !decl.command.trim())
      throw new McpConfigError(
        `mcpServers.${name} needs a non-empty \`command\` — the executable that speaks MCP on stdio`,
        { field: `mcpServers.${name}.command`, file });

    for (const a of decl.args ?? []) {
      if (typeof a !== 'string')
        throw new McpConfigError(`mcpServers.${name}.args must contain only strings`,
          { field: `mcpServers.${name}.args`, file });
    }

    // `env` is a list of variable NAMES to pass through from the ambient environment — never
    // `{"KEY": "secret"}`. The W8 rule (a config file is committed, so a value in it is a leaked
    // value) applies here exactly as it applies to `apiKey`, and an MCP server is the most likely
    // place someone would want to paste a token.
    for (const e of decl.env ?? []) {
      if (typeof e !== 'string')
        throw new McpConfigError(
          `mcpServers.${name}.env must be a list of variable NAMES to pass through, not values — `
          + `e.g. ["GITHUB_TOKEN"]. The file names the variable; the value stays in the environment.`,
          { field: `mcpServers.${name}.env`, file });
      if (e.includes('='))
        throw new McpConfigError(
          `mcpServers.${name}.env: \`${e.split('=')[0]}=...\` looks like a VALUE. List only the `
          + `variable name; its value is read from the environment at connect time and never `
          + `stored in the file.`,
          { field: `mcpServers.${name}.env`, file });
    }

    if (decl.timeoutMs !== undefined && (!Number.isFinite(decl.timeoutMs) || decl.timeoutMs <= 0))
      throw new McpConfigError(`mcpServers.${name}.timeoutMs must be a positive number`,
        { field: `mcpServers.${name}.timeoutMs`, file });

    out.push(Object.freeze({
      name,
      command: decl.command,
      args: Object.freeze([...(decl.args ?? [])]),
      env: Object.freeze([...(decl.env ?? [])]),
      cwd: decl.cwd ?? null,
      timeoutMs: decl.timeoutMs ?? MCP_TIMEOUT_MS,
      enabled: decl.enabled !== false,
    }));
  }
  return out;
}

/**
 * A stable, recomputable identity for one MCP session.
 *
 * The same discipline as W6's `resourceId`: DERIVED, never random, so a resumed run recomputes the
 * identity of the session it was using rather than storing and trusting a handle. The declaration
 * is part of the hash, so editing a server's command yields a DIFFERENT id — which is correct.
 * Reattaching a session whose command has changed would silently run the old binary while the
 * operator reads the new declaration.
 *
 * `project` (not the run) carries the scope: MCP sessions are project-scoped, so two runs in the
 * same workspace against the same declaration agree on identity.
 */
export function mcpResourceId({ server, project }) {
  if (!server?.name) throw new Error('mcpResourceId needs a server declaration');
  if (typeof project !== 'string' || !project) throw new Error('mcpResourceId needs a project');
  const canon = path.resolve(project).replace(/[\\/]+$/, '').toLowerCase();
  const decl = JSON.stringify([server.name, server.command, server.args, server.cwd ?? '']);
  const h = crypto.createHash('sha256')
    .update('mcp').update('\0').update(canon).update('\0').update(decl)
    .digest('hex').slice(0, 16);
  return `res_mcp_${h}`;
}

/** `mcp__<server>__<tool>` — the one place the wire name is built. */
export const qualifyToolName = (server, tool) => `${MCP_PREFIX}${server}__${tool}`;

/**
 * Split a qualified name back into its parts, or null when it is not an MCP tool.
 *
 * Everything that needs to know "is this an MCP call, and whose?" routes through here rather than
 * re-deriving the split — the W5-T1 declare-once rule applied to a naming convention.
 */
export function parseToolName(name) {
  if (typeof name !== 'string' || !name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const i = rest.indexOf('__');
  if (i <= 0 || i + 2 >= rest.length) return null;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

/** True when this tool name belongs to an MCP server rather than the built-in toolset. */
export const isMcpTool = (name) => parseToolName(name) !== null;
