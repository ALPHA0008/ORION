// Real-repository runner.
//
// Same harness-agnostic shape as the synthetic runner so a second harness can be plugged in
// later (section 20 — NOT yet). The V0 runtime is FROZEN for this phase: this file consumes it
// and does not modify it.

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { Store, uid } from '../../../v0/src/core/run/store.mjs';
import { LocalSandbox } from '../../../v0/src/sandbox/local/index.mjs';
import { makeTools } from '../../../v0/src/agent/tools/index.mjs';
import { createAuthorizer } from '../../../v0/src/auth/default/index.mjs';
import { Worker, DEFAULT_SYSTEM } from '../../../v0/src/agent/loop/worker.mjs';
import { createOpenAICompatModel } from '../../../v0/src/agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../../../v0/src/agent/model/shims/gemma-tool-calls.mjs';
import { trajectoryMetrics } from '../../metrics/index.mjs';
import { RealEnvironment, InfraFailure } from '../environments/index.mjs';
import { getRepo } from '../repositories/index.mjs';
import { snapshotTestFiles } from '../evaluators/index.mjs';

export function buildModel({ timeoutMs = 180_000 } = {}) {
  return createOpenAICompatModel({
    baseUrl: process.env.HARNESS_BASE_URL,
    apiKey: process.env.HARNESS_API_KEY,
    model: process.env.HARNESS_MODEL,
    timeoutMs, maxRetries: 2,
    shims: [applyGemmaToolCallShim],
  });
}

function restrictTools(all, allowed) {
  const out = {};
  for (const name of allowed) if (all[name]) out[name] = all[name];
  if (all.ask_user) out.ask_user = all.ask_user;   // escalation must always be possible
  return out;
}

export const realV0Runner = {
  name: 'harness-v0',
  capabilities: {
    trajectory: 'event_log',
    recovery_granularity: 'tool',
    replay: true, fork: true, resume: true,
    context_compaction: process.env.HARNESS_COMPACT === '1' ? 'supersede' : 'none',
  },

  /**
   * @returns {object} run result, or { infraError } if the ENVIRONMENT failed (never the agent's fault)
   */
  async run(task, { model, root } = {}) {
    const repo = getRepo(task.repository);
    const env = new RealEnvironment(repo, { root });

    // ── environment provisioning: failures here are INFRA, not capability ──
    let dir, guard;
    try {
      dir = env.provision(task.task_id);
      task.mutate(dir);
      guard = snapshotTestFiles(dir);
    } catch (e) {
      try { env.destroy(); } catch { /* best effort */ }
      return {
        infraError: e instanceof InfraFailure
          ? `${e.stage}: ${e.message}` : `setup failed: ${String(e.message).slice(0, 300)}`,
        env: null,
      };
    }

    const storeDir = path.join(root ?? os.tmpdir(), '_runs');
    fs.mkdirSync(storeDir, { recursive: true });
    const store = new Store(path.join(storeDir, `${task.task_id}-${Date.now()}.db`));
    const sandbox = new LocalSandbox(dir);
    const tools = restrictTools(makeTools(sandbox), task.allowed_tools);

    // Permissive posture: this benchmark measures CAPABILITY, not the approval UX.
    // Hard denials (rm -rf /, mkfs) still apply.
    const authorize = createAuthorizer({ posture: 'permissive', escalateUnsafeRecovery: false });

    const runId = uid('run');
    store.createRun(runId, { task: task.description });
    const claim = store.claim('real-eval', { runId, leaseMs: task.timeout_ms + 120_000 });

    const worker = new Worker(store, {
      sandbox, tools, model, authorize,
      workerId: 'real-eval',
      maxTurns: task.max_turns,
      leaseMs: task.timeout_ms + 120_000,
      compactContext: process.env.HARNESS_COMPACT === '1',
      // ADR-013: the declared completion contract. Every real task in this benchmark requires a
      // world-state change, and each carries a DETERMINISTIC check (its own test command) — no
      // LLM judge. The runtime does not decide what correctness means; it asks the predicate the
      // task handed it. Opt-in so before/after is a clean A/B.
      ...(process.env.COMPLETION_CONTRACT === '1'
        ? { completionContract: {
              requires_world_change: true,
              objectiveSatisfied: () => {
                try { execSync(repo.test_command, { cwd: dir, stdio: 'ignore', timeout: 120_000,
                                                    env: { ...process.env, CI: '1' } });
                      return true; }
                catch { return false; }
              },
            } }
        : {}),
      // Phase 9 experiment ONLY (§8). Not shipped; opt-in so before/after is a clean A/B.
      ...(process.env.ACTION_PROMPT === '1'
        ? { systemPrompt: DEFAULT_SYSTEM + String.fromCharCode(10) +
            'After identifying the required change, continue executing the task. Do not report ' +
            'completion until the requested world-state change has been made and verified.' }
        : {}),
      budget: { tokens: 4_000_000, tool_calls: 600, cost_usd: 100 },
    });

    const t0 = Date.now();
    let res, timedOut = false, runError = null;
    try {
      res = await Promise.race([
        worker.run(runId, claim.leaseToken, { input: task.description }),
        new Promise((_, rej) =>
          setTimeout(() => rej(Object.assign(new Error('task timeout'), { __timeout: true })), task.timeout_ms)),
      ]);
    } catch (e) {
      if (e.__timeout) timedOut = true; else runError = e;
    }
    const wallMs = Date.now() - t0;

    return {
      runner: this.name, repo, dir, env, store, sandbox, runId, guard,
      result: res?.result ?? null,
      status: res?.status ?? (timedOut ? 'timeout' : 'error'),
      reason: res?.reason ?? null,
      timedOut,
      // A crash inside the RUNTIME is a runtime failure, not an environment failure. It is
      // surfaced as a normal agent-side error so it cannot be hidden as INFRA.
      runError: runError ? String(runError.message).slice(0, 300) : null,
      metrics: trajectoryMetrics(store, runId, { wallMs }),
      close: () => { try { store.close(); } catch {} try { env.destroy(); } catch {} },
    };
  },
};

export const REAL_RUNNERS = { 'harness-v0': realV0Runner };
