// Context compaction: elide SUPERSEDED tool results.
//
// WHY (measured, not assumed)
// ---------------------------
// eval/reports/v1-full-17.json, task `wide-units-mismatch`:
//   input_tokens 127,712 | output_tokens 731 | model_calls 22
//   -> 58.7% of ALL input tokens in a 17-task dataset, 22.8x the mean of the other 16 tasks
//   -> 175:1 input:output ratio; 88% of wall time is model time
//
// Cause is structural, not model-specific: the bounded projection resends the whole 40-message
// window on every model call, so N file reads cost O(N^2) input tokens while output stays flat.
// Before this module, `context.compacted` had never fired in any evaluation run: the runtime
// could FORGET context (drop past WINDOW) but could not COMPACT it.
//
// WHAT THIS DOES — and deliberately does not do
// ---------------------------------------------
// It elides only tool results that are provably SUPERSEDED:
//
//   1. a `read` of path P is superseded by any LATER `read`/`write`/`edit` of the same path P
//      — the newer content is authoritative and the older text is stale by definition;
//   2. an exactly-duplicated (tool, args) result is superseded by its later twin.
//
// The most recent result for any path is ALWAYS kept in full. Only the tail-most occurrence
// survives, so the agent never loses its current view of the world.
//
// It does NOT summarise, and it does NOT call a model. An LLM-generated summary would be a
// lossy, non-deterministic, and unverifiable transformation of state that the whole event-log
// design exists to keep exact. Elision is deterministic and fully reversible: the complete text
// remains in the event log and stays retrievable, exactly like clamped content.
//
// SAFETY: this only rewrites the OUTBOUND provider message array. It never mutates the event
// log or the projection, so replay/fork/resume are unaffected and a compacted run and an
// uncompacted run remain byte-identical in their durable history.

/** Tools whose results describe the content of a specific path. */
const PATH_TOOLS = new Set(['read', 'write', 'edit']);

const PLACEHOLDER = (name, hint) =>
  `[superseded ${name}${hint ? ` of ${hint}` : ''} — a newer result for this target appears below; ` +
  `full text remains in the run history]`;

/**
 * Decide which tool_call_ids are superseded, given the ordered message array.
 * Pure and deterministic: same input -> same decision.
 *
 * @param {Array} msgs provider message array (system + conversation)
 * @returns {{superseded:Set<string>, targets:Map<string,string>}}
 */
export function findSuperseded(msgs) {
  // tool_call_id -> { name, path, argKey }
  const meta = new Map();
  for (const m of msgs) {
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
    for (const tc of m.tool_calls) {
      let args = {};
      try { args = typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments) : (tc.function?.arguments ?? {}); } catch { /* keep {} */ }
      const name = tc.function?.name ?? '';
      meta.set(tc.id, {
        name,
        path: typeof args.path === 'string' ? args.path : null,
        argKey: `${name}:${stableArgs(args)}`,
      });
    }
  }

  // Walk tool results in order; the LAST occurrence per key wins.
  const lastByPath = new Map();   // path -> tool_call_id
  const lastByArgs = new Map();   // argKey -> tool_call_id
  const order = [];
  for (const m of msgs) {
    if (m.role !== 'tool' || !m.tool_call_id) continue;
    const info = meta.get(m.tool_call_id);
    if (!info) continue;
    order.push(m.tool_call_id);
    if (info.path && PATH_TOOLS.has(info.name)) lastByPath.set(info.path, m.tool_call_id);
    lastByArgs.set(info.argKey, m.tool_call_id);
  }

  const superseded = new Set();
  const targets = new Map();
  for (const id of order) {
    const info = meta.get(id);
    if (!info) continue;
    const winnerByPath = info.path && PATH_TOOLS.has(info.name) ? lastByPath.get(info.path) : null;
    const winnerByArgs = lastByArgs.get(info.argKey);
    // Superseded only if a strictly later result covers the same target.
    if ((winnerByPath && winnerByPath !== id) || (winnerByArgs && winnerByArgs !== id)) {
      superseded.add(id);
      targets.set(id, info.path ?? '');
    }
  }
  return { superseded, targets, meta };
}

/**
 * Rewrite an outbound message array, replacing superseded tool results with a short marker.
 *
 * @param {Array} msgs
 * @param {{minBytes?:number}} opts only elide results at least this large — eliding a 40-byte
 *        result costs more in marker text than it saves.
 * @returns {{messages:Array, elided:number, bytesSaved:number}}
 */
export function compactMessages(msgs, { minBytes = 200 } = {}) {
  const { superseded, targets, meta } = findSuperseded(msgs);
  if (superseded.size === 0) return { messages: msgs, elided: 0, bytesSaved: 0 };

  let elided = 0, bytesSaved = 0;
  const out = msgs.map((m) => {
    if (m.role !== 'tool' || !superseded.has(m.tool_call_id)) return m;
    const original = String(m.content ?? '');
    const name = meta.get(m.tool_call_id)?.name ?? 'result';
    const replacement = PLACEHOLDER(name, targets.get(m.tool_call_id));
    // Never let "compaction" make a message larger.
    if (original.length < minBytes || replacement.length >= original.length) return m;
    elided++;
    bytesSaved += original.length - replacement.length;
    return { ...m, content: replacement };
  });

  return { messages: out, elided, bytesSaved };
}

/** Order-independent, stable stringification of tool args for duplicate detection. */
function stableArgs(args) {
  if (args === null || typeof args !== 'object') return JSON.stringify(args ?? null);
  if (Array.isArray(args)) return `[${args.map(stableArgs).join(',')}]`;
  return `{${Object.keys(args).sort().map(k => `${JSON.stringify(k)}:${stableArgs(args[k])}`).join(',')}}`;
}
