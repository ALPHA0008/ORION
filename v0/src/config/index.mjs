// W8 — the configuration file, layered UNDER the environment.
//
// WHY A FILE AT ALL
//
// Until now ORION was configurable only by environment variables, which an operator has to
// re-export in every terminal and cannot commit next to the project they describe. The measured
// consequence is in `fresh-run-audit.md`: a new user's first run fails on configuration they had
// no way to persist.
//
// WHY THE ENVIRONMENT STILL WINS
//
// Env-over-file is the documented behaviour today, and reversing it would break every existing
// deployment silently — the worst kind of change, because nothing errors and the run just uses a
// different model. So the file is a DEFAULT and the environment is an OVERRIDE, which is also the
// order that makes CI sane: commit the project's settings, override per-invocation.
//
// WHY NO PLAINTEXT SECRETS
//
// The file is meant to be committed. `apiKey` is therefore NOT accepted as a literal; the schema
// takes `apiKeyEnv` — the NAME of an environment variable to read. A config file that invites a
// key into version control is a config file that puts keys in version control, and the polite
// version of that mistake (a comment saying "don't commit this") is not a mitigation. Supplying
// `apiKey` is a validation ERROR that names the field, not a warning.
//
// PRECEDENCE (weakest to strongest), mirroring the skills ladder from W7:
//
//   built-in defaults  →  ~/.orion/config.json (user)  →  <workspace>/.orion.json (project)  →  env
//
// Project beats user for the same reason it does for skills: the repository being worked on is a
// more specific statement of intent than a machine-wide preference.

import fs from 'node:fs';
import path from 'node:path';
import { parseServers } from '../mcp/servers.mjs';

/** Where configuration is read from, weakest first. */
export function configSearchPaths({ workspace = null, home = null } = {}) {
  const out = [];
  if (home) out.push({ scope: 'user', file: path.join(home, 'config.json') });
  if (workspace) out.push({ scope: 'project', file: path.join(workspace, '.orion.json') });
  return out;
}

/**
 * The schema, as data.
 *
 * Declared rather than hand-validated so the error messages can name the field and the accepted
 * shape without a second copy of the rules drifting from the first — the same
 * declare-once discipline W5-T1 imposed on tool capabilities.
 */
/**
 * @typedef {{ type: string, env?: string, describe?: string, enum?: string[],
 *             fields?: Record<string, string>,
 *             validate?: (value: any, ctx: { file: string|null, field: string }) => void }} ConfigSpec
 */
/** @type {Readonly<Record<string, ConfigSpec>>} */
export const CONFIG_SCHEMA = Object.freeze({
  provider: { type: 'string', env: 'ORION_PROVIDER',
    describe: 'openai-compat | anthropic' },
  baseUrl: { type: 'string', env: 'ORION_BASE_URL',
    describe: 'the provider endpoint' },
  model: { type: 'string', env: 'ORION_MODEL' },
  apiKeyEnv: { type: 'string',
    describe: 'NAME of the env var holding the key (never the key itself)' },
  posture: { type: 'string', env: 'ORION_POSTURE', enum: ['permissive', 'auto', 'strict'] },
  sandbox: { type: 'string', env: 'ORION_SANDBOX', enum: ['local', 'container'] },
  image: { type: 'string', env: 'ORION_IMAGE' },
  stream: { type: 'boolean', env: 'ORION_STREAM' },
  shims: { type: 'string', env: 'ORION_SHIMS' },
  budget: { type: 'object', describe: '{ tokens, tool_calls, cost_usd }',
    fields: { tokens: 'number', tool_calls: 'number', cost_usd: 'number' } },
  search: { type: 'object', describe: '{ maxHits, timeMs, maxResults }',
    fields: { maxHits: 'number', timeMs: 'number', maxResults: 'number' } },
  // W9 — MCP servers. The value is a map of arbitrary server names, so it cannot be checked by the
  // flat `fields` mechanism above; `validate` hands it to the MCP declaration parser, which is the
  // authority on that shape and refuses anything that would put a secret in a committed file.
  mcpServers: { type: 'object', describe: '{ "<name>": { command, args, env, cwd, timeoutMs } }',
    validate: (value, { file }) => { parseServers(value, { file }); } },
  // W10 — delegation limits. These may only make the shipped ceilings SMALLER (`resolveQuota`
  // clamps), for the same reason W8's rules may only raise strictness: a config file that could
  // raise `maxLiveChildren` would reintroduce the store contention the design rejected.
  subagents: { type: 'object',
    describe: '{ maxLiveChildren, maxChildren, maxDepth, maxTurns, timeoutMs, budget }',
    fields: { maxLiveChildren: 'number', maxChildren: 'number', maxDepth: 'number',
              maxTurns: 'number', timeoutMs: 'number', budget: 'object' } },
  // The model a subagent uses, when it should differ from the parent's. Explicit configuration
  // only — the runtime never selects a model for itself.
  childModel: { type: 'string', env: 'ORION_CHILD_MODEL' },
});

/** Keys a config file may NOT set, with the reason, so the refusal teaches rather than blocks. */
const FORBIDDEN = Object.freeze({
  apiKey: 'a config file is meant to be committed; put the key in an environment variable and '
        + 'name it with `apiKeyEnv` instead',
  ORION_API_KEY: 'use `apiKeyEnv: "ORION_API_KEY"` — the file names the variable, never the value',
});

export class ConfigError extends Error {
  /** @param {string} message @param {{ field?: string, file?: string }} [info] */
  constructor(message, { field = null, file = null } = {}) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
    this.file = file;
  }
}

/** Read and validate one config file. Returns null when absent. */
export function readConfigFile(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return null; }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) {
    throw new ConfigError(`${file} is not valid JSON: ${String(e.message ?? e)}`, { file });
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    throw new ConfigError(`${file} must contain a JSON object`, { file });

  for (const [key, why] of Object.entries(FORBIDDEN)) {
    if (key in data) throw new ConfigError(`${file}: \`${key}\` is not allowed — ${why}`,
      { field: key, file });
  }

  for (const [key, value] of Object.entries(data)) {
    const spec = CONFIG_SCHEMA[key];
    // Unknown keys are an ERROR, not a shrug. A typo'd `postures` that is silently ignored is a
    // config file the operator believes is in force and is not — the exact failure this command
    // exists to make impossible.
    if (!spec)
      throw new ConfigError(
        `${file}: unknown setting \`${key}\`. Known settings: ${Object.keys(CONFIG_SCHEMA).join(', ')}`,
        { field: key, file });
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (actual !== spec.type)
      throw new ConfigError(`${file}: \`${key}\` must be a ${spec.type}, got ${actual}`,
        { field: key, file });
    if (spec.enum && !spec.enum.includes(value))
      throw new ConfigError(
        `${file}: \`${key}\` must be one of ${spec.enum.join(', ')} — got ${JSON.stringify(value)}`,
        { field: key, file });
    // A key whose shape is richer than `fields` can express validates itself. The hook throws its
    // own typed error (naming the exact nested field), which is what keeps an `mcpServers` typo as
    // loud as a top-level one.
    if (spec.validate && value) spec.validate(value, { file, field: key });
    if (spec.fields && value) {
      for (const [k, v] of Object.entries(value)) {
        if (!spec.fields[k])
          throw new ConfigError(
            `${file}: unknown \`${key}.${k}\`. Known: ${Object.keys(spec.fields).join(', ')}`,
            { field: `${key}.${k}`, file });
        if (typeof v !== spec.fields[k])
          throw new ConfigError(`${file}: \`${key}.${k}\` must be a ${spec.fields[k]}`,
            { field: `${key}.${k}`, file });
      }
    }
  }
  return data;
}

/**
 * Resolve the effective configuration.
 *
 * Returns both the values AND where each came from. The provenance is the point: "what will this
 * run actually use, and why" is a question an operator currently has to answer by reading source,
 * and `orionctl config` exists to answer it directly.
 *
 * @returns {{ values: Record<string,any>, sources: Record<string,string>,
 *             files: {scope:string,file:string}[], errors: ConfigError[] }}
 */
export function resolveConfig({ workspace = null, home = null, env = process.env } = {}) {
  /** @type {Record<string, any>} */
  const values = {};
  /** @type {Record<string, string>} */
  const sources = {};
  const files = [];
  const errors = [];

  for (const { scope, file } of configSearchPaths({ workspace, home })) {
    let data;
    try { data = readConfigFile(file); }
    catch (e) { errors.push(e); continue; }
    if (!data) continue;
    files.push({ scope, file });
    for (const [k, v] of Object.entries(data)) { values[k] = v; sources[k] = `${scope} (${file})`; }
  }

  // The environment layers LAST and wins — the documented behaviour, unchanged.
  for (const [key, spec] of Object.entries(CONFIG_SCHEMA)) {
    if (!spec.env) continue;
    const raw = env[spec.env];
    if (raw === undefined || raw === '') continue;
    values[key] = spec.type === 'boolean'
      ? !['0', 'off', 'false', 'no'].includes(String(raw).trim().toLowerCase())
      : raw;
    sources[key] = `env ${spec.env}`;
  }

  return { values, sources, files, errors };
}

/**
 * Render the effective configuration for a human.
 *
 * Secrets are never printed. `apiKeyEnv` names a variable, and this reports only whether that
 * variable is SET — an operator debugging "why is it unauthorised" needs to know the key is
 * missing, and needs the key itself to stay out of their scrollback and their bug reports.
 */
export function describeConfig({ workspace = null, home = null, env = process.env } = {}) {
  const { values, sources, files, errors } = resolveConfig({ workspace, home, env });
  const lines = [];

  lines.push(files.length
    ? `config files: ${files.map(f => `${f.scope} → ${f.file}`).join(', ')}`
    : 'config files: none found (built-in defaults + environment only)');

  const keyVar = values.apiKeyEnv ?? 'ORION_API_KEY';
  const keySet = !!(env[keyVar] ?? env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY);
  lines.push('');
  lines.push('effective configuration:');
  for (const key of Object.keys(CONFIG_SCHEMA)) {
    if (values[key] === undefined) continue;
    const shown = typeof values[key] === 'object'
      ? JSON.stringify(values[key]) : String(values[key]);
    lines.push(`  ${key.padEnd(12)} ${shown.padEnd(34)} ${sources[key] ?? ''}`);
  }
  lines.push(`  ${'apiKey'.padEnd(12)} ${(keySet ? '(set)' : '(NOT SET)').padEnd(34)} env ${keyVar}`);

  return { text: lines.join('\n'), values, sources, files, errors, keyVar, keySet };
}
