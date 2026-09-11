// W9 — turning a server's advertisement into tools the model can call.
//
// An MCP tool becomes an ORDINARY entry in the toolset: `{ description, schema, effects, recovery,
// run }`, exactly like `read` or `bash`. That is the whole integration. The worker already appends
// `tool.requested` / `tool.authorized` / `tool.started` / `tool.succeeded`, already routes through
// the authorizer, already applies the recovery contract — so MCP inherits every one of those
// properties by being shaped like a tool rather than by re-implementing any of it.
//
// WHY EVERY MCP TOOL IS `Mutating` + `UNSAFE`
//
// This is the conservative choice, made deliberately:
//
//   - `effects: 'Mutating'` — the harness cannot know what third-party code does. A server tool
//     called `get_issue` may post a comment. Declaring ReadOnly would mean skipping the approval
//     gate for code this project has never seen, and `effects` is the input to that gate (W5-T1).
//   - `recovery: UNSAFE` — after a crash, an MCP call that started and never finished has an
//     unknowable outcome. UNSAFE escalates to a human instead of re-issuing, which is the correct
//     default for a remote effect with no dedup key. A server that genuinely supports idempotent
//     retries can be recognised later; guessing in that direction now would silently double a
//     side effect.
//
// A server cannot lower either of these. The declaration lives here, on our side of the boundary,
// and nothing in the advertisement can reach it.

import { qualifyToolName, MCP_PREFIX, MCP_TIMEOUT_MS } from './servers.mjs';
import { RecoveryClass } from '../core/recovery/index.mjs';

/** JSON Schema we will hand to the model when a server advertises nothing usable. */
const EMPTY_SCHEMA = Object.freeze({ type: 'object', properties: {} });

/**
 * Is this advertisement usable as a tool schema?
 *
 * A server that advertises a malformed tool gets that TOOL excluded and the rest kept — scope §6.
 * Rejecting the whole server for one bad entry would turn a cosmetic defect in third-party code
 * into a total loss of capability.
 */
export function validateAdvertisement(t) {
  if (!t || typeof t !== 'object') return 'advertisement is not an object';
  if (typeof t.name !== 'string' || !t.name.trim()) return 'advertisement has no name';
  if (t.name.includes('__'))
    return `tool name \`${t.name}\` contains \`__\`, which would make the qualified name ambiguous`;
  const s = t.inputSchema;
  if (s !== undefined && s !== null) {
    if (typeof s !== 'object' || Array.isArray(s)) return `inputSchema for \`${t.name}\` is not an object`;
    if (s.type !== undefined && s.type !== 'object')
      return `inputSchema for \`${t.name}\` must describe an object, got \`${s.type}\``;
  }
  return null;
}

/**
 * Build the ORION tool entries for one connected session.
 *
 * @returns {{ tools: Record<string, any>, excluded: {name: string, why: string}[] }}
 */
export function toolsForSession(session, manager) {
  /** @type {Record<string, any>} */
  const tools = {};
  const excluded = [];
  if (!session?.ok) return { tools, excluded };

  for (const advert of session.tools ?? []) {
    const why = validateAdvertisement(advert);
    if (why) { excluded.push({ name: String(advert?.name ?? '<unnamed>'), why }); continue; }

    const qualified = qualifyToolName(session.name, advert.name);
    const schema = normaliseSchema(advert.inputSchema);

    tools[qualified] = {
      // The server's own description is what the model reads. Prefixing it with the server name
      // is the one edit made: without it, two servers offering `search` give the model two
      // identical descriptions and no way to choose between them.
      description: `[mcp:${session.name}] ${String(advert.description ?? advert.name).trim()}`,
      schema,
      effects: 'Mutating',
      recovery: () => ({ class: RecoveryClass.UNSAFE }),
      // Provenance travels WITH the tool, so the worker can attribute the result without knowing
      // anything about MCP. `mcp` is the marker every attribution path keys on.
      mcp: { server: session.name, tool: advert.name, session_id: session.resourceId,
             isolated: session.isolated === true },
      timeoutMs: session.server?.timeoutMs ?? MCP_TIMEOUT_MS,
      run: async (args) => manager.callTool(session.name, advert.name, args),
    };
  }
  return { tools, excluded };
}

/**
 * Coerce an advertised schema into the shape `toolDefinitions` and `validateArgs` expect.
 *
 * MCP advertises JSON Schema, which is what the model wants anyway, so this is mostly a pass
 * through with a guarantee that `type` and `properties` exist — `validateArgs` reads both, and a
 * server that omits them should not crash the harness.
 */
export function normaliseSchema(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...EMPTY_SCHEMA };
  return {
    ...input,
    type: 'object',
    properties: (input.properties && typeof input.properties === 'object') ? input.properties : {},
    ...(Array.isArray(input.required) ? { required: input.required } : {}),
  };
}

/**
 * Merge MCP tools into the built-in toolset.
 *
 * BUILT-IN TOOLS WIN (scope §8). In practice there is no collision — a built-in name can never
 * start with `mcp__` — but asserting the precedence explicitly means a future built-in cannot be
 * shadowed by a server that decides to advertise the same name.
 */
export function mergeTools(builtin, mcpTools) {
  const out = { ...builtin };
  const shadowed = [];
  for (const [name, tool] of Object.entries(mcpTools ?? {})) {
    if (name in out) { shadowed.push(name); continue; }
    out[name] = tool;
  }
  return { tools: out, shadowed };
}

/** Every MCP tool name in a toolset — the set compaction and attribution ask about. */
export const mcpToolNames = (tools) =>
  new Set(Object.keys(tools ?? {}).filter(n => n.startsWith(MCP_PREFIX)));
