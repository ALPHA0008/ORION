// V0 toolset: read, write, edit, grep, bash, ask_user.
// Each tool computes recovery() FROM ITS ARGUMENTS (ADR-002).

import { RecoveryClass, classifyShell } from '../../core/recovery/index.mjs';
import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** Distinguish "genuinely absent" from "could not be read". Only the former is evidence. */
const isMissing = (e) => e?.code === 'ENOENT' || /ENOENT|no such file/i.test(String(e?.message ?? ''));

export function makeTools(sandbox) {
  return {
    read: {
      description: 'Read a UTF-8 file from the workspace.',
      schema: { type: 'object', required: ['path'],
        properties: { path: { type: 'string' } } },
      effects: 'ReadOnly',
      recovery: () => ({ class: RecoveryClass.READ_ONLY }),
      run: ({ path }) => sandbox.read(path),
    },

    grep: {
      description: 'Search the workspace for a literal string. Returns path:line: matches.',
      schema: { type: 'object', required: ['pattern'],
        properties: { pattern: { type: 'string' }, path: { type: 'string' } } },
      effects: 'ReadOnly',
      recovery: () => ({ class: RecoveryClass.READ_ONLY }),
      run: ({ pattern, path = '.' }) => sandbox.grep(pattern, path),
    },

    write: {
      description: 'Write the FULL content of a file (creates or replaces).',
      schema: { type: 'object', required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } } },
      effects: 'Mutating',
      // Whole-content write is naturally idempotent, and cheap to verify by hashing.
      recovery: ({ path, content }) => ({
        class: RecoveryClass.SAFE_RETRY,
        precondition: sha(content),
        verify: () => {
          // Only "the file is not there" proves the write did not land. A permission
          // error, EISDIR or an I/O error proves nothing — those are 'unknown'.
          try { return sandbox.read(path) === content ? 'applied' : 'not-applied'; }
          catch (e) { return isMissing(e) ? 'not-applied' : 'unknown'; }
        },
      }),
      run: ({ path, content }) => { sandbox.write(path, content); return `wrote ${path} (${content.length} bytes)`; },
    },

    edit: {
      description: 'Replace an exact unique substring in a file.',
      schema: { type: 'object', required: ['path', 'old_string', 'new_string'],
        properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } } },
      effects: 'Mutating',
      // Content-addressed precondition: the effect invalidates it, so a replay rejects itself.
      recovery: ({ path, old_string, new_string }) => ({
        class: RecoveryClass.SELF_VERIFYING,
        precondition: old_string,
        verify: () => {
          let c;
          try { c = sandbox.read(path); }
          catch (e) { return isMissing(e) ? 'not-applied' : 'unknown'; }
          const hasOld = c.includes(old_string), hasNew = c.includes(new_string);
          if (hasOld && !hasNew) return 'not-applied';
          if (!hasOld && hasNew) return 'applied';
          return 'unknown';   // ambiguous (e.g. old is a substring of new)
        },
      }),
      run: ({ path, old_string, new_string }) => {
        const cur = sandbox.read(path);
        const n = cur.split(old_string).length - 1;
        if (n === 0) throw new Error(`old_string not found in ${path}`);
        if (n > 1)   throw new Error(`old_string is ambiguous in ${path} (${n} matches) — include more context`);
        sandbox.write(path, cur.replace(old_string, new_string));
        return `edited ${path}`;
      },
    },

    bash: {
      description: 'Run a shell command in the workspace.',
      schema: { type: 'object', required: ['cmd'], properties: { cmd: { type: 'string' } } },
      effects: 'Mutating',
      // ADR-002: argument-dependent. Conservative classifier; unknown => UNSAFE => escalate.
      recovery: ({ cmd }) => ({ class: classifyShell(cmd) }),
      run: ({ cmd }) => sandbox.exec(cmd),
    },

    ask_user: {
      description: 'Ask the human a question and wait. The run pauses durably.',
      schema: { type: 'object', required: ['prompt'],
        properties: { prompt: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } },
      effects: 'ReadOnly',
      recovery: () => ({ class: RecoveryClass.READ_ONLY }),
      // Handled by the runtime as an escalation; never executed directly.
      run: () => { throw new Error('ask_user is handled by the runtime, not executed'); },
      alwaysEscalate: true,
    },
  };
}

/** Model-facing tool definitions (JSON-schema function shape). */
export function toolDefinitions(tools) {
  return Object.entries(tools).map(([name, t]) => ({
    type: 'function',
    function: { name, description: t.description, parameters: t.schema },
  }));
}

/** Minimal argument validation — enough to turn a bad model call into a clean tool.failed. */
export function validateArgs(tool, args) {
  const errs = [];
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be a JSON object'];
  for (const r of tool.schema?.required ?? []) if (!(r in args)) errs.push(`missing required property: ${r}`);
  for (const [k, v] of Object.entries(args)) {
    const spec = tool.schema?.properties?.[k];
    if (!spec) { errs.push(`unknown property: ${k}`); continue; }
    const t = spec.type === 'array' ? (Array.isArray(v) ? 'array' : typeof v) : typeof v;
    if (spec.type && t !== spec.type) errs.push(`property ${k} must be ${spec.type}, got ${t}`);
  }
  return errs;
}
