// Experiment 3 — ONE external harness adapter: Claude Agent SDK -> our event vocabulary.
//
// The external message shapes below are taken from the REAL SDK type definitions shipped in
// qm/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts (v0.3.211) — notably
// SDKResultSuccess (sdk.d.ts:4191-4211), SDKAssistantMessage (:2803), SDKAssistantMessageError
// (:2846), SDKCompactBoundaryMessage (:2888). The SDK exposes 100 distinct `type:` discriminators;
// our proposed vocabulary has 31. This adapter measures what survives the translation.

import { EVENT_TYPES } from '../01-event-log/eventstore.mjs';

export const OUR_TYPES = new Set(EVENT_TYPES);

// ---------------------------------------------------------------------------
// Fidelity ledger: every external field is accounted for as one of
//   mapped      -> lands in a core event field
//   extension   -> preserved, but only inside payload.ext (not first-class)
//   lost        -> not representable at all
// ---------------------------------------------------------------------------
export function makeAdapter({ onEvent, mode = 'closed' }) {
  const ledger = { mapped: [], extension: [], lost: [], unknownTypes: new Set() };
  const note = (kind, what) => ledger[kind].push(what);

  let pendingToolUse = new Map();   // tool_use_id -> {name, input}

  function emit(type, payload, ext) {
    if (!OUR_TYPES.has(type)) { ledger.unknownTypes.add(type); }
    if (ext && Object.keys(ext).length) {
      if (mode === 'closed') { for (const k of Object.keys(ext)) note('lost', k); }
      else { payload = { ...payload, ext }; for (const k of Object.keys(ext)) note('extension', k); }
    }
    onEvent(type, payload);
  }

  return {
    ledger,
    // Translate one SDK message into zero or more of our events.
    handle(msg) {
      switch (msg.type) {

        case 'system':
          if (msg.subtype === 'init') {
            note('mapped', 'system.init -> run.created');
            emit('run.created', { scope: 'external', principal: 'sdk' },
                 { session_id: msg.session_id, cwd: msg.cwd, tools: msg.tools,
                   mcp_servers: msg.mcp_servers, permissionMode: msg.permissionMode,
                   slash_commands: msg.slash_commands, apiKeySource: msg.apiKeySource,
                   output_style: msg.output_style, agents: msg.agents });
          } else {
            ledger.unknownTypes.add(`system.${msg.subtype}`);
            emit('degraded', { subsystem: 'adapter', reason: `unmapped system.${msg.subtype}` }, msg);
          }
          return;

        case 'assistant': {
          const content = msg.message?.content ?? [];
          const text = content.filter(c => c.type === 'text').map(c => c.text).join('');
          const thinking = content.filter(c => c.type === 'thinking');
          const toolUses = content.filter(c => c.type === 'tool_use');
          for (const t of toolUses) pendingToolUse.set(t.id, { name: t.name, input: t.input });

          note('mapped', 'assistant.text -> model.responded.content');
          note('mapped', 'assistant.tool_use -> model.responded.tool_calls');
          note('mapped', 'assistant.usage -> model.responded tokens');

          emit('model.responded', {
            content: text,
            tool_calls: toolUses.map(t => ({ id: t.id, name: t.name, args: t.input })),
            input_tokens: msg.message?.usage?.input_tokens ?? 0,
            output_tokens: msg.message?.usage?.output_tokens ?? 0,
          }, {
            // things our core event has no field for:
            uuid: msg.uuid,
            parent_tool_use_id: msg.parent_tool_use_id,
            thinking_blocks: thinking.length ? thinking : undefined,
            stop_reason: msg.message?.stop_reason,
            cache_creation_input_tokens: msg.message?.usage?.cache_creation_input_tokens,
            cache_read_input_tokens: msg.message?.usage?.cache_read_input_tokens,
            model: msg.message?.model,
            error: msg.error,
          });
          if (msg.error) {
            note('mapped', 'assistant.error -> model.failed');
            emit('model.failed', { error: msg.error, retryable: ['rate_limit','overloaded','server_error'].includes(msg.error) });
          }
          return;
        }

        case 'user': {
          // tool_result blocks arrive as user messages in the SDK
          const content = msg.message?.content ?? [];
          const results = Array.isArray(content) ? content.filter(c => c.type === 'tool_result') : [];
          if (results.length) {
            for (const r of results) {
              const pend = pendingToolUse.get(r.tool_use_id);
              note('mapped', 'user.tool_result -> tool.succeeded|failed');
              // NOTE: the SDK never emits a distinct "tool started" signal.
              emit(r.is_error ? 'tool.failed' : 'tool.succeeded', {
                tool_call_id: r.tool_use_id, name: pend?.name ?? 'unknown',
                ...(r.is_error ? { error: strOf(r.content) } : { result: strOf(r.content) }),
              }, { parent_tool_use_id: msg.parent_tool_use_id, uuid: msg.uuid });
              pendingToolUse.delete(r.tool_use_id);
            }
          } else {
            note('mapped', 'user.text -> turn.started');
            emit('turn.started', { input: strOf(content) }, { uuid: msg.uuid });
          }
          return;
        }

        case 'result': {
          note('mapped', 'result -> run.completed|failed');
          const t = msg.is_error ? 'run.failed' : 'run.completed';
          emit(t, { result: msg.result, reason: msg.subtype },
            { duration_ms: msg.duration_ms, duration_api_ms: msg.duration_api_ms,
              ttft_ms: msg.ttft_ms, num_turns: msg.num_turns,
              total_cost_usd: msg.total_cost_usd, usage: msg.usage,
              modelUsage: msg.modelUsage, stop_reason: msg.stop_reason,
              permission_denials: msg.permission_denials, api_error_status: msg.api_error_status,
              structured_output: msg.structured_output });
          // permission denials DO have a home
          for (const d of msg.permission_denials ?? []) {
            note('mapped', 'permission_denial -> tool.denied');
            emit('tool.denied', { tool_call_id: d.tool_use_id, name: d.tool_name, reason: 'permission_denied' });
          }
          return;
        }

        case 'compact_boundary':
          note('mapped', 'compact_boundary -> context.compacted');
          emit('context.compacted', { summary: '(sdk compaction)', trigger: msg.compact_metadata?.trigger },
            { pre_tokens: msg.compact_metadata?.pre_tokens });
          return;

        case 'stream_event':
          // partial assistant deltas: high volume, no core equivalent
          note('lost', 'stream_event (token deltas)');
          return;

        case 'rate_limit_event':
          note('mapped', 'rate_limit_event -> degraded');
          emit('degraded', { subsystem: 'model', reason: 'rate limited' }, msg);
          return;

        case 'api_retry':
          note('mapped', 'api_retry -> degraded');
          emit('degraded', { subsystem: 'model', reason: `api retry #${msg.attempt ?? '?'}` }, msg);
          return;

        case 'can_use_tool':
          note('mapped', 'can_use_tool -> tool.requested (authorization hook)');
          emit('tool.requested', { tool_call_id: msg.tool_use_id, name: msg.tool_name, args: msg.input });
          return;

        case 'tool_progress':
        case 'tool_use_summary':
        case 'task_started':
        case 'task_progress':
        case 'task_updated':
        case 'task_notification':
        case 'thinking_tokens':
        case 'status':
        case 'session_state_changed':
        case 'background_tasks_changed':
        case 'files_persisted':
        case 'commands_changed':
          note('lost', `${msg.type} (no core equivalent)`);
          ledger.unknownTypes.add(msg.type);
          return;

        default:
          ledger.unknownTypes.add(msg.type);
          note('lost', `${msg.type} (unhandled)`);
          return;
      }
    },
  };
}

function strOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (typeof x === 'string' ? x : x?.text ?? JSON.stringify(x))).join('');
  return JSON.stringify(c ?? '');
}

// ---------------------------------------------------------------------------
// A realistic SDK message stream, shaped to the real type definitions.
// (No credentials available, so this is a faithful reconstruction of the wire
//  format from sdk.d.ts, NOT a live capture. Stated as a limitation.)
// ---------------------------------------------------------------------------
export function sampleSdkStream() {
  return [
    { type: 'system', subtype: 'init', session_id: 's1', cwd: '/w', tools: ['Read','Write','Bash'],
      mcp_servers: [], model: 'claude-x', permissionMode: 'default', apiKeySource: 'env',
      slash_commands: ['/help'], output_style: 'default', agents: ['general'] },
    { type: 'user', uuid: 'u1', session_id: 's1', parent_tool_use_id: null,
      message: { role: 'user', content: 'build the mini project' } },
    { type: 'stream_event', uuid: 'se1', event: { type: 'content_block_delta', delta: { text: 'Cre' } } },
    { type: 'stream_event', uuid: 'se2', event: { type: 'content_block_delta', delta: { text: 'ating' } } },
    { type: 'assistant', uuid: 'a1', session_id: 's1', parent_tool_use_id: null,
      message: { role: 'assistant', model: 'claude-x', stop_reason: 'tool_use',
        content: [ { type: 'thinking', thinking: 'I should write a.txt first' },
                   { type: 'text', text: 'Creating a.txt' },
                   { type: 'tool_use', id: 'tu1', name: 'Write', input: { path: 'a.txt', content: 'alpha' } } ],
        usage: { input_tokens: 1200, output_tokens: 60, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } } },
    { type: 'can_use_tool', tool_use_id: 'tu1', tool_name: 'Write', input: { path: 'a.txt' } },
    { type: 'tool_progress', tool_use_id: 'tu1', progress: 0.5 },
    { type: 'user', uuid: 'u2', session_id: 's1', parent_tool_use_id: null,
      message: { role: 'user', content: [ { type: 'tool_result', tool_use_id: 'tu1', is_error: false, content: 'wrote a.txt' } ] } },
    { type: 'rate_limit_event', retry_after: 2 },
    { type: 'api_retry', attempt: 1 },
    { type: 'assistant', uuid: 'a2', session_id: 's1', parent_tool_use_id: null,
      message: { role: 'assistant', model: 'claude-x', stop_reason: 'tool_use',
        content: [ { type: 'text', text: 'Now editing' },
                   { type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'rm -rf /' } } ],
        usage: { input_tokens: 1400, output_tokens: 45 } } },
    { type: 'user', uuid: 'u3', session_id: 's1',
      message: { role: 'user', content: [ { type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: 'permission denied' } ] } },
    { type: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 40000 } },
    { type: 'assistant', uuid: 'a3', session_id: 's1',
      message: { role: 'assistant', model: 'claude-x', stop_reason: 'end_turn',
        content: [ { type: 'text', text: 'Done: created a.txt.' } ],
        usage: { input_tokens: 800, output_tokens: 20 } } },
    { type: 'result', subtype: 'success', is_error: false, duration_ms: 8100, duration_api_ms: 6200,
      ttft_ms: 410, num_turns: 3, result: 'Done: created a.txt.', stop_reason: 'end_turn',
      total_cost_usd: 0.0123, usage: { input_tokens: 3400, output_tokens: 125 },
      modelUsage: { 'claude-x': { inputTokens: 3400, outputTokens: 125, costUSD: 0.0123 } },
      permission_denials: [ { tool_name: 'Bash', tool_use_id: 'tu2', tool_input: { command: 'rm -rf /' } } ] },
  ];
}
