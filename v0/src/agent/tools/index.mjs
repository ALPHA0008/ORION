// V0 toolset: read, write, edit, grep, bash, ask_user.
// Each tool computes recovery() FROM ITS ARGUMENTS (ADR-002).

import { RecoveryClass, classifyShell, isKnownDangerous } from '../../core/recovery/index.mjs';
import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** Distinguish "genuinely absent" from "could not be read". Only the former is evidence. */
const isMissing = (e) => e?.code === 'ENOENT' || /ENOENT|no such file/i.test(String(e?.message ?? ''));

/** Pre-state witness sentinel for "the file did not exist" — distinct from any real hash. */
export const ABSENT = 'absent:no-such-file';

// Budget for one page of `read`. Deliberately below MSG_CLAMP (2,000 B) so a full page plus its
// footer survives the projection clamp intact — a page that gets clamped would reintroduce the
// exact invisible-tail problem this paging exists to solve.
const READ_PAGE_BYTES = 1_500;

// ── read fidelity (ADR-012) ──────────────────────────────────────────────────
//
// The line-number separator was a TAB, which MERGED with source indentation:
//
//   file    : "\t\treturn 1;"        (2 tabs)
//   rendered: "3\t\t\treturn 1;"     (a run of 3 — separator + 2)
//
// A model copying the visible indentation emitted one tab too many, so every `edit` on a
// tab-indented file failed with `old_string not found`. Measured A/B (phase 3): TAB separator
// 2/10 correct with 48 not-found; pipe separator 10/10 with 0. This caused a false diagnosis that
// the `edit` primitive was weak — it was not; the representation was corrupting the bytes.
//
// The delimiter must be a character that CANNOT occur as leading whitespace, so the boundary
// between the number and the content is unambiguous by construction rather than by convention.
// Content after it is the source line byte-for-byte, so it can be copied straight into
// `edit(old_string, …)` — escaping (`\t`) or markers (`[TAB]`) would be reconstructable but would
// require the model to decode a convention first, and would themselves be ambiguous for a file
// that literally contains those characters.
const LINE_NO_SEP = '|';

// ── edit diagnostics (capability experiment 02) ──────────────────────────────
//
// MEASURED: 62 `old_string not found` errors across 18 real-repository runs; ZERO ambiguity
// errors. The one case where the exact bytes were captured (`plimit-active-count`) was an
// INDENTATION mismatch — the file has one tab before `const next`, the model sent two. The patch
// was semantically correct. 9 of 11 failing runs re-read the file first and still resent a
// byte-inequivalent string, because ordinary output renders a leading tab indistinguishably from
// spaces.
//
// The tool remains EXACT: no fuzzy matching, no nearest-match apply. A fuzzy apply would patch
// text the model never specified AND break the SELF_VERIFYING content-addressed precondition
// (ADR-002/003) that makes replay safe. Only the error message changes.
const DIAG_MAX_LINES = 8;        // show a patch region, never a file
const DIAG_MAX_BYTES = 1_200;    // hard cap, well under MSG_CLAMP (2,000)

/** Render whitespace visibly — the whole point is that tabs and spaces must be distinguishable. */
const showWs = (s) => s.replace(/\t/g, '→').replace(/ /g, '·');
const stripIndent = (s) => s.split('\n').map(l => l.replace(/^[ \t]+/, '')).join('\n');
const collapseWs = (s) => s.replace(/[ \t]+/g, ' ');
const normEol = (s) => s.replace(/\r\n/g, '\n');

/**
 * Explain why an exact match failed. Classifies ONLY what the bytes support; when nothing
 * supports a class it says so rather than inventing a nearest match.
 *
 * @returns {string} bounded, model-actionable diagnostic
 */
function diagnoseEditMiss(path, src, old) {
  const candidate = (normalise, kind, hint) => {
    const at = normalise(src).indexOf(normalise(old));
    if (at < 0) return null;
    const line = normalise(src).slice(0, at).split('\n').length;   // 1-based
    const span = Math.min(old.split('\n').length, DIAG_MAX_LINES);
    return { kind, hint, line, lines: src.split('\n').slice(line - 1, line - 1 + span) };
  };

  // Most specific evidence-supported explanation wins.
  const found =
       candidate(normEol, 'EOL_MISMATCH', 'the line endings differ (CRLF vs LF)')
    ?? candidate(stripIndent, 'INDENTATION_MISMATCH', 'the leading indentation differs')
    ?? candidate(collapseWs, 'WHITESPACE_MISMATCH', 'the whitespace differs')
    ?? candidate((s) => s.replace(/\s+/g, ''), 'WHITESPACE_MISMATCH', 'the whitespace differs');

  if (!found) {
    // Is any part of it present at all? Distinguishes "wrong region" from "wrong context".
    const probe = old.split('\n').map(l => l.trim()).filter(l => l.length > 8);
    const hits = probe.filter(l => src.replace(/\s+/g, '').includes(l.replace(/\s+/g, ''))).length;
    if (probe.length && hits === 0)
      return `old_string not found in ${path} — none of its lines appear in this file at all. `
           + `Check the path, or read the file to locate the correct region.`;
    if (probe.length && hits < probe.length)
      return `old_string not found in ${path} — ${hits} of ${probe.length} lines appear, but not `
           + `as one contiguous block. The surrounding context differs; read the region and copy it verbatim.`;
    return `old_string not found in ${path}. Read the file and copy the target text verbatim.`;
  }

  const shown = found.lines.map(showWs).join('\n');
  const last = found.line + found.lines.length - 1;
  let out = `old_string not found in ${path} — it matches at line ${found.line} except that `
          + `${found.hint} (${found.kind}).\n`
          + `Lines ${found.line}-${last} contain exactly (→=tab, ·=space):\n`
          + `${shown}\n`
          + `Copy that text verbatim as old_string, converting → back to tab and · back to space.`;
  if (Buffer.byteLength(out) > DIAG_MAX_BYTES)
    out = out.slice(0, DIAG_MAX_BYTES) + '\n…[diagnostic truncated]';
  return out;
}

/**
 * Read a file as numbered lines, windowed by `offset`/`limit`, and self-describing at the edges.
 *
 * The footer is the important part: when content remains, it states the EXACT next call to make.
 * The failure mode being fixed was an agent re-issuing an identical read forever, so the result
 * must make "there is more, ask for it this way" unmissable — and must differ between pages, so
 * that a repeated identical request is never rewarded with an identical result.
 */
function readPaged(sandbox, path, offset, limit) {
  const raw = sandbox.read(path);

  // The sandbox independently clamps very large files at MAX_OUTPUT_BYTES and splices a
  // `…[file X truncated: N bytes > L limit]…` marker into the middle. That marker must stay
  // visible on the FIRST page — paging it to some later page would hide from the agent that
  // the file is not fully retrievable at all, which is precisely the class of silent
  // invisibility this iteration exists to remove.
  const sandboxTruncated = /…\[file .*? truncated: \d+ bytes > \d+ limit\]…/.exec(raw);

  const lines = raw.split('\n');
  // A trailing newline yields a final empty element; don't report a phantom line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;

  const start = Math.max(1, Number.isFinite(offset) ? Math.trunc(offset) : 1);
  if (start > total)
    return `[${path}: ${total} lines total; offset ${start} is past the end]`;

  const maxLines = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : Infinity;
  const width = String(total).length;
  const out = [];
  let bytes = 0, i = start;
  for (; i <= total && out.length < maxLines; i++) {
    const line = `${String(i).padStart(width)}${LINE_NO_SEP}${lines[i - 1]}`;
    // Always emit at least one line, even if that single line exceeds the page budget;
    // otherwise a file with one very long line could never be read at all.
    if (bytes + line.length > READ_PAGE_BYTES && out.length > 0) break;
    out.push(line);
    bytes += line.length + 1;
  }
  const last = i - 1;

  const header = start > 1 ? `[${path}: lines ${start}-${last} of ${total}]\n` : '';
  let footer = '';
  if (last < total) {
    footer = `\n[${total - last} more lines. To continue, call read with `
           + `path="${path}", offset=${last + 1}]`;
  } else if (start > 1) {
    footer = `\n[end of ${path}]`;
  }
  // Surface the sandbox's own hard truncation on every page, so it can never be paged out of
  // sight: this file cannot be read in full no matter how far the agent pages.
  if (sandboxTruncated && !out.some(l => l.includes('truncated:')))
    footer += `\n${sandboxTruncated[0]}`;

  return header + out.join('\n') + footer;
}

export function makeTools(sandbox) {
  return {
    read: {
      // CAPABILITY ITERATION 01 (real-repository baseline).
      //
      // Measured: 15 of 15 real-repository failures re-read one identical file 2-4 times and
      // then died on no_progress. Cause: the bounded projection clamps every tool result at
      // MSG_CLAMP (2,000 bytes), so on camelcase/index.js (7,527 B) the agent saw 27% of the
      // file, could not find what it needed, and re-issued the SAME read — getting the same
      // truncated bytes every time. Pass rate tracked file visibility exactly: 411 B file ->
      // 100%, 7,527 B file -> 0%.
      //
      // The clamp is correct (ADR-001) and is NOT changed. What was missing is a way to reach
      // the rest of the file. Paging makes the remainder retrievable in clamp-sized bites.
      description:
        'Read a UTF-8 file from the workspace. Returns numbered lines. Large files are '
        + 'truncated, so use `offset` (1-based first line) and `limit` (number of lines) to '
        + 'page through the rest — the footer tells you the next offset to use.',
      schema: { type: 'object', required: ['path'],
        properties: {
          path: { type: 'string' },
          offset: { type: 'integer', description: '1-based line to start from (default 1).' },
          limit: { type: 'integer', description: 'Maximum lines to return (default: all).' },
        } },
      effects: 'ReadOnly',
      recovery: () => ({ class: RecoveryClass.READ_ONLY }),
      run: ({ path, offset, limit }) => readPaged(sandbox, path, offset, limit),
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
      // `expected_pre_sha` is declared so the schema accepts it, but is deliberately NOT
      // described to the model: the runtime injects it (ADR-011). The model-facing contract
      // remains write(path, content) and no model is asked for a correctness-critical hash.
      schema: { type: 'object', required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' },
                      expected_pre_sha: { type: 'string' } } },
      effects: 'Mutating',

      // ADR-011: capture a trusted PRE-STATE WITNESS (the runtime computes it, never the model).
      // The worker folds this into `args` before appending `tool.started`, so it is durable and
      // available to `#reconcile` after a crash.
      captureWitness: (args) => {
        if (args?.expected_pre_sha !== undefined) return args;   // already witnessed
        let pre;
        try { pre = sha(sandbox.read(args.path)); }
        catch (e) { pre = isMissing(e) ? ABSENT : null; }        // null = could not observe
        return pre === null ? args : { ...args, expected_pre_sha: pre };
      },

      // WHY THIS EXISTS (measured, phase 4):
      // Post-state-only verification collapses two different worlds onto one answer —
      // "never applied" and "applied, then a third party changed the file" both look like
      // `not-applied`, so SAFE_RETRY reissued and silently destroyed the concurrent change.
      // Reproduced with a real SIGKILL and on real pinned repository bytes.
      //
      // `edit` never had this problem because its precondition is the PRE-state. This gives
      // `write` the equivalent evidence.
      recovery: ({ path, content, expected_pre_sha }) => ({
        // The class follows the evidence actually carried, not the operation's name.
        // SAFE_RETRY asserts f(f(x)) == f(x) "for these args" — true in isolation, false with a
        // concurrent writer. With a witness the retry is only ever issued when the pre-state is
        // verified intact, which is precisely SELF_VERIFYING.
        class: expected_pre_sha === undefined ? RecoveryClass.SAFE_RETRY : RecoveryClass.SELF_VERIFYING,
        precondition: expected_pre_sha ?? sha(content),
        // A whole-file write is NOT self-rejecting on replay the way `edit` is: re-applying it
        // overwrites whatever moved the file. So an unknown outcome must escalate rather than
        // ride the class's AUTO_REISSUE membership (ADR-011).
        escalateOnUnknown: expected_pre_sha !== undefined,
        verify: () => {
          let cur;
          try { cur = sandbox.read(path); }
          catch (e) {
            if (!isMissing(e)) return 'unknown';        // I/O error proves nothing
            // File absent: the write cannot have landed. If it was absent beforehand too, the
            // world is exactly what the caller expected, so a retry is safe.
            if (expected_pre_sha === undefined || expected_pre_sha === ABSENT) return 'not-applied';
            return 'unknown';                           // it existed before and is gone now
          }
          // Applied is checked first: if the content matches the target the effect is present,
          // whatever the pre-state was (this also covers a third party producing the same bytes).
          if (cur === content) return 'applied';
          if (expected_pre_sha === undefined) return 'not-applied';   // legacy, unwitnessed
          // Pre-state intact => the effect never landed and the world is untouched: safe retry.
          if (sha(cur) === expected_pre_sha) return 'not-applied';
          // Neither the expected pre-state nor the target: the world moved for a reason we
          // cannot attribute. Do NOT guess, and above all do not overwrite it.
          return 'unknown';
        },
      }),

      run: ({ path, content, expected_pre_sha }) => {
        // Pre-effect conflict detection (distinct from post-crash verification): if the file
        // changed between witness capture and now, the caller's intent no longer applies.
        if (expected_pre_sha !== undefined) {
          let cur;
          try { cur = sha(sandbox.read(path)); }
          catch (e) { cur = isMissing(e) ? ABSENT : null; }
          if (cur !== null && cur !== expected_pre_sha)
            throw new Error(
              `${path} changed since it was read (expected ${String(expected_pre_sha).slice(0, 12)}, `
              + `found ${String(cur).slice(0, 12)}). Re-read the file and reapply your change so the `
              + `other edit is not lost.`);
        }
        sandbox.write(path, content);
        return `wrote ${path} (${content.length} bytes)`;
      },
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
        // The tool stays EXACT. A no-match modifies nothing; only the ERROR gets richer.
        if (n === 0) throw new Error(diagnoseEditMiss(path, cur, old_string));
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

    // WAVE 1 (D2): verification as first-class trajectory evidence.
    //
    // `bash` can already run a test command, but its result is just output — indistinguishable
    // in the log from `ls`. `verify` exists so that "did the work actually hold up?" is a
    // recorded, machine-readable claim: it captures the command, its exit status and a PASS/FAIL
    // verdict as an ordinary tool.succeeded/tool.failed pair, which `explain`, `replay` and any
    // later evaluation can read without re-deriving intent from prose.
    //
    // On the guard: `classifyShell` is deliberately NOT used here. It answers a different
    // question — "is re-running this after a crash safe?" — and it default-denies, so every
    // real test command (`pytest`, `npm test`, `make test`) classifies UNSAFE. Gating on it
    // would make `verify` refuse exactly the commands it exists to run.
    //
    // What matters for `verify` is that it must not be a hole around the shell policy. So it
    // reuses the SAME explicitly-dangerous denylist that governs `bash`, via `isKnownDangerous`,
    // and re-runs are safe by construction: a check that mutates the thing it is checking is
    // not a check. Recovery class stays READ_ONLY, which is honest — re-running a test suite
    // after a crash is exactly what recovery should do.
    verify: {
      description: 'Run a read-only check (a test suite, a linter, a build) and record whether it '
                 + 'passed. Use this to prove the task is actually done. Do not use it to change files.',
      schema: { type: 'object', required: ['cmd'],
        properties: { cmd: { type: 'string' },
                      expect: { type: 'string', description: 'optional substring that must appear in the output' } } },
      effects: 'ReadOnly',
      recovery: () => ({ class: RecoveryClass.READ_ONLY }),
      run: ({ cmd, expect }) => {
        if (isKnownDangerous(cmd)) {
          throw new Error(`verify refuses a command with known side effects: ${cmd}. `
                        + 'Use bash if you genuinely need to change the world.');
        }
        let out, ok = true, exitCode = 0;
        try {
          out = sandbox.exec(cmd);
        } catch (e) {
          // A failing check is a RESULT, not a tool error — the agent must be able to read the
          // failure and act on it. Only the refusal above is a genuine tool error.
          ok = false;
          exitCode = e?.exitCode ?? 1;
          out = String(e?.stdout ?? e?.message ?? '');
        }
        if (ok && typeof expect === 'string' && expect.length && !String(out).includes(expect)) {
          ok = false;
          out = `expected substring not found: ${JSON.stringify(expect)}\n${out}`;
        }
        return `${ok ? 'PASS' : 'FAIL'} (exit ${exitCode}) ${cmd}\n${out}`;
      },
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
    function: { name, description: t.description, parameters: stripInternal(t.schema) },
  }));
}

/**
 * Hide runtime-injected properties from the model (ADR-011).
 *
 * `expected_pre_sha` is validated like any other argument, but the model must never be asked to
 * supply it: a correctness-critical hash produced by an LLM would be untrustworthy, and a
 * silently wrong or omitted one would weaken the guarantee without any signal.
 */
const INTERNAL_ARGS = new Set(['expected_pre_sha']);
function stripInternal(schema) {
  if (!schema?.properties) return schema;
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([k]) => !INTERNAL_ARGS.has(k)));
  return { ...schema, properties };
}

/** Minimal argument validation — enough to turn a bad model call into a clean tool.failed. */
export function validateArgs(tool, args) {
  const errs = [];
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be a JSON object'];
  for (const r of tool.schema?.required ?? []) if (!(r in args)) errs.push(`missing required property: ${r}`);
  for (const [k, v] of Object.entries(args)) {
    const spec = tool.schema?.properties?.[k];
    if (!spec) { errs.push(`unknown property: ${k}`); continue; }
    // JSON has no integer type: `2` arrives as a `number`. A schema declaring `integer` must
    // therefore accept any number with no fractional part, or it is unsatisfiable — which is
    // exactly what happened when `read` gained offset/limit: every paged call the model made
    // was rejected with "must be integer, got number" and the run died on no_progress.
    const t = spec.type === 'array' ? (Array.isArray(v) ? 'array' : typeof v)
            : spec.type === 'integer' && typeof v === 'number' && Number.isInteger(v) ? 'integer'
            : typeof v;
    if (spec.type && t !== spec.type) errs.push(`property ${k} must be ${spec.type}, got ${t}`);
  }
  return errs;
}
