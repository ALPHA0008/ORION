// Shared setup for real-model experiments.
// Requires: HARNESS_BASE_URL, HARNESS_API_KEY, HARNESS_MODEL.
// Every experiment refuses to run rather than silently substituting a fake model.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox, attachCheckpoints } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { createOpenAICompatModel } from '../../src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../src/agent/model/shims/gemma-tool-calls.mjs';

export const CFG = {
  baseUrl: process.env.HARNESS_BASE_URL,
  apiKey: process.env.HARNESS_API_KEY ?? null,
  model: process.env.HARNESS_MODEL ?? 'gemma4-31b',
};

export function requireRealModel() {
  if (!CFG.baseUrl) {
    console.error('\nREAL MODEL NOT CONFIGURED — refusing to run.');
    console.error('  set HARNESS_BASE_URL, HARNESS_API_KEY, HARNESS_MODEL');
    console.error('  (this experiment must never silently fall back to a scripted model)\n');
    process.exit(2);
  }
}

/** The real model, with the Gemma/vLLM tool-call shim enabled. */
export function realModel(opts = {}) {
  return createOpenAICompatModel({
    baseUrl: CFG.baseUrl, apiKey: CFG.apiKey, model: CFG.model,
    timeoutMs: 120_000, maxRetries: 2,
    shims: [applyGemmaToolCallShim],
    ...opts,
  });
}

export function mkEnv(tag, { checkpoints = false } = {}) {
  const dir = path.join(os.tmpdir(), `rm-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  const store = new Store(path.join(dir, 'h.db'));
  let sandbox = new LocalSandbox(path.join(dir, 'work'));
  if (checkpoints) sandbox = attachCheckpoints(sandbox, path.join(dir, 'shadow.git'));
  return { dir, store, sandbox, tools: makeTools(sandbox) };
}

export function mkWorker(store, sandbox, tools, opts = {}) {
  return new Worker(store, {
    sandbox, tools,
    model: opts.model ?? realModel(),
    authorize: opts.authorize ?? createAuthorizer(),
    workerId: opts.workerId ?? uid('w'),
    maxTurns: opts.maxTurns ?? 14,
    ...opts,
  });
}

/** Metrics for Step 14. Derived entirely from the event log. */
export function metrics(store, runId, wallMs) {
  const ev = store.events(runId);
  const count = (t) => ev.filter(e => e.type === t).length;
  const tok = ev.filter(e => e.type === 'model.responded')
    .reduce((a, e) => ({
      in: a.in + (e.payload.input_tokens || 0),
      out: a.out + (e.payload.output_tokens || 0),
      cost: a.cost + (e.payload.cost_usd || 0),
    }), { in: 0, out: 0, cost: 0 });
  return {
    wall_ms: wallMs,
    events: ev.length,
    model_calls: count('model.requested'),
    model_failures: count('model.failed'),
    tool_calls: count('tool.started'),
    tool_succeeded: count('tool.succeeded'),
    tool_failed: count('tool.failed'),
    tool_denied: count('tool.denied'),
    degraded: count('degraded'),
    recovery_decisions: count('tool.recovery_decided'),
    human_requests: count('human.requested'),
    input_tokens: tok.in,
    output_tokens: tok.out,
    est_cost_usd: Number(tok.cost.toFixed(6)),
    shimmed_responses: ev.filter(e => e.type === 'model.responded' && e.payload?.ext?.shimmed).length,
  };
}

export function fmtMetrics(m) {
  return [
    `  wall            ${(m.wall_ms / 1000).toFixed(1)}s`,
    `  events          ${m.events}`,
    `  model calls     ${m.model_calls}  (failures ${m.model_failures}, shimmed ${m.shimmed_responses})`,
    `  tool calls      ${m.tool_calls}  (ok ${m.tool_succeeded}, failed ${m.tool_failed}, denied ${m.tool_denied})`,
    `  tokens          in ${m.input_tokens} / out ${m.output_tokens}`,
    `  degraded        ${m.degraded}`,
    `  recovery        ${m.recovery_decisions}`,
    `  human requests  ${m.human_requests}`,
  ].join('\n');
}

export { uid };
