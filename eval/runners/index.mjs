// Runners execute ONE task and return a trajectory + final workspace.
//
// The interface is deliberately harness-agnostic so QM / Hermes / LangGraph / OpenHands / a raw
// SDK loop can be plugged in later (§24). Each runner declares what it can actually report —
// nothing pretends to trajectory fidelity it does not have.
//
//   interface Runner {
//     name: string
//     capabilities: { trajectory: 'event_log' | 'transcript' | 'none', ... }
//     run(task, { workdir, model }): Promise<RunResult>
//   }

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Store, uid } from '../../v0/src/core/run/store.mjs';
import { LocalSandbox } from '../../v0/src/sandbox/local/index.mjs';
import { makeTools } from '../../v0/src/agent/tools/index.mjs';
import { createAuthorizer } from '../../v0/src/auth/default/index.mjs';
import { Worker } from '../../v0/src/agent/loop/worker.mjs';
import { createOpenAICompatModel } from '../../v0/src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../v0/src/agent/model/shims/gemma-tool-calls.mjs';
import { trajectoryMetrics } from '../metrics/index.mjs';
import { OUTCOME } from '../tasks/schema.mjs';

export function buildModel({ baseUrl, apiKey, model, timeoutMs = 120_000 } = {}) {
  return createOpenAICompatModel({
    baseUrl: baseUrl ?? process.env.HARNESS_BASE_URL,
    apiKey: apiKey ?? process.env.HARNESS_API_KEY,
    model: model ?? process.env.HARNESS_MODEL,
    timeoutMs, maxRetries: 2,
    shims: [applyGemmaToolCallShim],
  });
}

/** Restrict the toolset to what the task allows. */
function restrictTools(all, allowed) {
  const out = {};
  for (const name of allowed) if (all[name]) out[name] = all[name];
  // ask_user is always available so the agent can escalate rather than guess
  if (all.ask_user) out.ask_user = all.ask_user;
  return out;
}

export const v0Runner = {
  name: 'harness-v0',
  capabilities: {
    trajectory: 'event_log',      // full durable trajectory, not just a transcript
    recovery_granularity: 'tool',
    replay: true, fork: true, resume: true,
    context_compaction: process.env.HARNESS_COMPACT === '1' ? 'supersede' : 'none',
  },

  async run(task, { model, evalRoot } = {}) {
    const dir = path.join(evalRoot ?? os.tmpdir(), `eval-${task.task_id}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const store = new Store(path.join(dir, 'run.db'));
    const sandbox = new LocalSandbox(path.join(dir, 'work'));

    task.setup(sandbox);

    const allTools = makeTools(sandbox);
    const tools = restrictTools(allTools, task.allowed_tools);

    // Permissive posture: the benchmark measures CAPABILITY, not the approval UX. Hard denials
    // (rm -rf /, mkfs) still apply. Tools the task did not allow simply do not exist.
    const authorize = createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false });

    const runId = uid('run');
    store.createRun(runId, { task: task.description });
    const claim = store.claim('eval', { runId, leaseMs: task.timeout_ms + 60_000 });

    const worker = new Worker(store, {
      sandbox, tools, model, authorize,
      workerId: 'eval',
      maxTurns: task.max_turns,
      leaseMs: task.timeout_ms + 60_000,
      // A/B switch for the compaction iteration. Default OFF so the baseline path is
      // unchanged and `compare` measures exactly one variable.
      compactContext: process.env.HARNESS_COMPACT === '1',
      budget: { tokens: 2_000_000, tool_calls: 400, cost_usd: 50 },
    });

    const t0 = Date.now();
    let res, timedOut = false, infraError = null;
    try {
      res = await Promise.race([
        worker.run(runId, claim.leaseToken, { input: task.description }),
        new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('task timeout'), { __timeout: true })), task.timeout_ms)),
      ]);
    } catch (e) {
      if (e.__timeout) timedOut = true;
      else infraError = e;
    }
    const wallMs = Date.now() - t0;

    const metrics = trajectoryMetrics(store, runId, { wallMs });
    return {
      runner: this.name, dir, store, sandbox, runId,
      result: res?.result ?? null,
      status: res?.status ?? (timedOut ? 'timeout' : 'error'),
      reason: res?.reason ?? null,
      timedOut, infraError: infraError ? String(infraError.message) : null,
      metrics,
      close: () => { try { store.close(); } catch {} },
    };
  },
};

/** Runner registry — add external harnesses here when §24 comes around. */
export const RUNNERS = { 'harness-v0': v0Runner };
