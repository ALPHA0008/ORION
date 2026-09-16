// W10 — the `subagent` tool: how a model asks for delegation.
//
// Like MCP tools in W9, this is an ORDINARY tool: `{description, schema, effects, recovery, run}`.
// The worker already appends `tool.requested` / `authorized` / `started` / `succeeded`, already
// routes through the authorizer, already applies the recovery contract — so delegation inherits
// every one of those properties by being shaped like a tool rather than by re-implementing them.
// A deployer who wants to forbid delegation writes `denyTools: ["subagent"]` and is done.
//
// WHY `Mutating` AND `UNSAFE`
//
// The same reasoning W9 applied to third-party code, for a stronger reason. A child can do
// anything its granted toolset allows, which may include `write` and `bash`. Declaring the
// delegation ReadOnly would mean the parent's approval gate never sees an operation whose blast
// radius is "whatever the child decides to do".
//
// `UNSAFE` follows from the same fact: after a crash, a `subagent` call that started and never
// finished has an unknowable outcome — the child may have written half a file. Re-issuing would
// duplicate that effect, so recovery escalates to a human instead, which is correct for a remote
// effect with no dedup key.

import { RecoveryClass } from '../recovery/index.mjs';
import { spawnChild } from './executor.mjs';
import { QuotaError, DEFAULT_CHILD_BUDGET } from './quota.mjs';
import { DEFAULT_CHILD_TOOLS } from './scope.mjs';

/**
 * Build the `subagent` tool for one parent run.
 *
 * Returns null when delegation is unavailable (no model factory), so a caller that cannot support
 * children simply does not offer the tool — rather than offering one that always fails, which
 * would waste a turn teaching the model that delegation is broken.
 */
export function makeSubagentTool(ctx) {
  if (!ctx?.makeModel || !ctx?.store) return null;

  return {
    description:
      'Delegate ONE bounded sub-task to a subagent with its own fresh context window. Use it when '
      + 'a sub-task needs a lot of reading to produce a small answer (surveying files, tracing a '
      + 'call graph, checking a hypothesis) — the subagent burns its own context and returns only '
      + 'the conclusion. Give `task` everything it needs: it CANNOT see this conversation. It is '
      + `read-only by default (${DEFAULT_CHILD_TOOLS.join(', ')}); pass \`tools\` to grant more, `
      + 'which you can only do for tools you have yourself. Returns the subagent\'s answer and its '
      + 'run id. Not for trivial work — a subagent costs a full model loop.',
    schema: {
      type: 'object',
      required: ['task'],
      properties: {
        task: { type: 'string',
          description: 'The complete, self-contained instruction. The subagent sees only this.' },
        reason: { type: 'string',
          description: 'Why delegate this (recorded in the trajectory for a reviewer).' },
        tools: { type: 'array', items: { type: 'string' },
          description: 'Extra tools to grant, e.g. ["write"]. Read-only tools are granted by '
                     + 'default. You cannot grant a tool you do not have.' },
        posture: { type: 'string',
          description: 'Optional: run the child STRICTER than this run (permissive|auto|strict). '
                     + 'It can never be more permissive.' },
      },
    },
    effects: 'Mutating',
    recovery: () => ({ class: RecoveryClass.UNSAFE }),
    // Declared so `explain` and any future consumer can identify delegation without string-matching
    // the tool name — the same declare-once discipline W5-T1 established for capabilities.
    delegates: true,
    run: async ({ task, reason = null, tools: allowTools = null, posture = null }) => {
      if (typeof task !== 'string' || !task.trim())
        throw new Error('subagent needs a `task` — a complete instruction the child can act on alone');

      try {
        const res = await spawnChild({
          ...ctx,
          task: task.trim(),
          reason,
          allowTools: Array.isArray(allowTools) ? allowTools : null,
          requestedPosture: posture,
        });
        return renderResult(res);
      } catch (e) {
        // A quota refusal is an ANSWER, not a crash: the model must learn it cannot spawn right
        // now and adapt (do the work itself, or wait). Throwing an opaque error would just cost a
        // turn. The distinction matters — `tool.failed` with a reason the model can act on beats
        // an exception it cannot.
        if (e instanceof QuotaError)
          throw new Error(`cannot delegate: ${e.message}. Do this work directly instead.`);
        throw e;
      }
    },
  };
}

/**
 * Render the child's outcome for the parent's message window.
 *
 * Bounded on purpose. The child's full trajectory stays in the child's log; what comes back here
 * is the answer plus the id needed to go and read the rest. A result that dumped the child's whole
 * transcript would defeat the only reason delegation saves anything.
 */
export function renderResult({ child_run, status, result, detail, tokens, granted, refused }) {
  const head = `subagent ${child_run} — ${status}`
    + (tokens ? ` (${tokens} tokens)` : '')
    + `\ntools: ${granted.join(', ') || 'none'}`
    + (refused?.length ? `  [refused: ${refused.map(r => r.name).join(', ')}]` : '');

  if (status === 'completed')
    return `${head}\n\n${result || '(the subagent finished without leaving an answer)'}`;

  // An honest failure, with whatever the child did manage to say. Reporting a failed child as a
  // bare error would hide work it actually completed before failing, and the parent needs that to
  // decide whether to retry, do it itself, or report the failure upward.
  return `${head}\nreason: ${detail ?? 'unknown'}\n\n`
    + (result ? `the subagent's last words:\n${result}`
              : 'the subagent produced no answer. Do this work directly, or delegate a narrower task.')
    + `\n\nFull trajectory: orionctl explain ${child_run}`;
}
