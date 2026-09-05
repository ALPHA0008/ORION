#!/usr/bin/env node
// Phase K — the time-travel CLI. The user should never need to know what "event sourcing" is.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../core/run/store.mjs';
import { LocalSandbox, attachCheckpoints } from '../sandbox/local/index.mjs';
import { makeTools } from '../agent/tools/index.mjs';
import { createAuthorizer } from '../auth/default/index.mjs';
import { Worker } from '../agent/loop/worker.mjs';
import { project } from '../core/projection/index.mjs';
import { explain, summarise } from '../core/run/explain.mjs';
import { replay, fork, rerun, nearestTurnBoundary } from '../core/replay/index.mjs';
import { reap, expireHumanRequests } from '../core/lease/reaper.mjs';
import { createProvider } from '../agent/model/index.mjs';
import { applyGemmaToolCallShim } from '../agent/model/shims/gemma-tool-calls.mjs';
import { projectPlan, planSatisfied, summarisePlan } from '../core/projection/plan.mjs';
import { repl, banner } from './repl.mjs';

const HOME = process.env.ORION_HOME ?? path.join(os.homedir(), '.orion');
const DB = path.join(HOME, 'orion.db');
const WORK = process.env.ORION_WORKSPACE ?? process.cwd();

// Colour only on a TTY. Piped or redirected the Proxy returns identity functions, so `--json`
// and every other machine-read path stays free of escape sequences.
const C = process.stdout.isTTY
  ? { dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
      r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m`,
      // bright cyan for the wordmark, magenta for accents — the banner should read as a logo,
      // not as more output.
      cb: s => `\x1b[96m${s}\x1b[0m`, m: s => `\x1b[95m${s}\x1b[0m` }
  : new Proxy({}, { get: () => (s => s) });

function open() { fs.mkdirSync(HOME, { recursive: true }); return new Store(DB); }

/**
 * Which provider quirk shims should this model run with? (D3)
 *
 * The shims themselves live in agent/model/shims and are deliberately opt-in — the core must
 * not grow provider special-cases. But leaving the CLI with NO shims meant a real, documented
 * provider quirk silently ended runs: vLLM serving Gemma without `--enable-auto-tool-choice`
 * returns tool calls as raw text in `content` with `tool_calls: []`, so the loop saw
 * "no tool calls, finish_reason=stop" and reported the run complete having done nothing.
 *
 * `ORION_SHIMS` is the explicit control (comma-separated, `none` disables auto-detect).
 * Otherwise we auto-detect on the model name, because a user pointing at `gemma...` on a
 * self-hosted endpoint has no way to know this flag exists until it has already cost them a run.
 * Whenever a shim actually rewrites a response the worker appends `degraded`, so the fact that
 * a shim fired is never invisible in the trajectory.
 */
export function selectShims(modelName, env = process.env) {
  const requested = String(env.ORION_SHIMS ?? '').trim();
  if (requested) {
    if (/^(none|off|0)$/i.test(requested)) return [];
    return requested.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      .map(name => {
        if (name === 'gemma' || name === 'gemma-tool-calls') return applyGemmaToolCallShim;
        console.error(C.y(`unknown shim: ${name} (known: gemma)`));
        return null;
      }).filter(Boolean);
  }
  // Auto-detect: the quirk is a property of how Gemma is commonly served, not of one endpoint.
  return /gemma/i.test(String(modelName ?? '')) ? [applyGemmaToolCallShim] : [];
}

/**
 * Should this run stream? (F5)
 *
 * `ORION_STREAM` is the explicit control. Default is ON, because streaming is what makes
 * `ttft_ms` observable and leaves a durable partial when a call dies part-way — both strictly
 * better than a single opaque response. A provider that cannot stream is NOT silently
 * downgraded: the worker records a `degraded` event and falls back, so the choice is always
 * visible in the trajectory.
 */
export function streamEnabled(env = process.env) {
  const v = String(env.ORION_STREAM ?? '').trim().toLowerCase();
  if (['0', 'off', 'false', 'no'].includes(v)) return false;
  return true;
}

/**
 * Build the model from configuration (F5).
 *
 * Wave 4 added a provider seam and a second provider, and the CLI then hardcoded
 * `createOpenAICompatModel` — so the capability existed in the library and was UNREACHABLE from
 * the product. That is the same class of defect as Waves 1-3 (a mechanism built, tested, and
 * never wired), which is why tests/shipped/ now exercises this path rather than the module.
 */
export function buildModel(env = process.env) {
  const kind = String(env.ORION_PROVIDER ?? 'openai-compat').trim().toLowerCase();
  const apiKey = env.ORION_API_KEY ?? env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? null;
  const model = env.ORION_MODEL ?? (kind === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4o-mini');
  // Anthropic has a real default endpoint; an OpenAI-compatible one could be anything, so it
  // must be stated.
  const baseUrl = env.ORION_BASE_URL ?? (kind === 'anthropic' ? 'https://api.anthropic.com' : null);

  if (!baseUrl) {
    console.error(C.r('No model configured.'));
    console.error('  Set ORION_BASE_URL (an OpenAI-compatible endpoint) and ORION_API_KEY.');
    console.error('  e.g. ORION_BASE_URL=https://api.openai.com/v1 ORION_MODEL=gpt-4o-mini');
    console.error('  Or:  ORION_PROVIDER=anthropic ORION_API_KEY=sk-ant-...');
    process.exit(2);
  }
  try {
    return createProvider({ kind, baseUrl, apiKey, model, shims: selectShims(model, env) });
  } catch (e) {
    // An unknown provider is a configuration mistake; say so plainly rather than failing later.
    console.error(C.r(e.message));
    process.exit(2);
  }
}

/**
 * The default completion contract for `orionctl run` (D2).
 *
 * ADR-013 exists because STOPPING IS NOT COMPLETING, and the mechanism in the worker has been
 * tested since. But the CLI never supplied a contract, so `completionContract` stayed `null`
 * and the gate was inert. Measured on the published 0.1.2: a run whose model emitted an
 * unparsed tool call did nothing at all to the workspace and the CLI reported
 * `✓ model_finished`. The file was untouched and the failing test still failed. The runtime's
 * own record was wrong — the one outcome this project must never produce.
 *
 * What counts as "the world changed": at least one MUTATING tool call succeeded. That is read
 * from the durable event log, not from a filesystem scan and not from anything held in memory:
 *
 *   - it is replay-equivalent — replay and fork reconstruct the same decision from the same
 *     events, which a `statSync` sweep of the workspace could never do;
 *   - it does not depend on the task text, so it makes no guess about intent;
 *   - it cannot be satisfied by the model merely *claiming* it edited something.
 *
 * The predicate has to satisfy two opposing requirements at once. It must catch the measured
 * failure — where the model produced NO usable tool calls at all and the run still reported
 * success — without fabricating failure on a legitimate read-only task ("explain this file"),
 * which would be dishonest in the opposite direction. So:
 *
 *   - a mutating tool succeeded                        -> satisfied (the world changed)
 *   - only read-only tools ran, and no mutation was
 *     ever attempted                                   -> satisfied (analysis really was the job)
 *   - a mutation was attempted but none succeeded      -> NOT satisfied
 *   - nothing ran at all                               -> NOT satisfied  <- the §1.4 case
 *
 * An unsatisfied run gets exactly one bounded continuation (the worker counts it from the
 * durable log, so a crash cannot buy a second) and then fails as FINISHED_WITHOUT_CHANGE.
 */
const MUTATING_TOOLS = new Set(['write', 'edit', 'bash']);

export function defaultCompletionContract(store, runId) {
  const inspect = () => {
    const events = store.events(runId);
    const names = new Map();          // tool_call_id -> tool name, from the request event
    for (const e of events) {
      if (e.type === 'tool.requested') names.set(e.payload?.tool_call_id, e.payload?.name);
    }
    let anySucceeded = false, mutationSucceeded = false, mutationAttempted = false;
    let verifyPassed = false;
    for (const e of events) {
      if (e.type === 'tool.requested' && MUTATING_TOOLS.has(e.payload?.name)) mutationAttempted = true;
      if (e.type === 'tool.succeeded') {
        anySucceeded = true;
        const tool = names.get(e.payload?.tool_call_id);
        if (MUTATING_TOOLS.has(tool)) mutationSucceeded = true;
        // A `verify` result's first line is its verdict. A PASS is the strongest evidence the
        // trajectory can hold that the work actually holds up — stronger than any bookkeeping.
        if (tool === 'verify' && /^PASS/.test(String(e.payload?.result ?? ''))) verifyPassed = true;
      }
    }
    return { anySucceeded, mutationSucceeded, mutationAttempted, verifyPassed };
  };

  return {
    requires_world_change: true,
    objectiveSatisfied: () => {
      // WAVE 2: when the run declared a plan, the plan is the objective.
      //
      // A declared plan is a stronger, self-supplied statement of what "done" means than any
      // inference the runtime could make from tool activity — so it takes precedence. An
      // unfinished plan is an unfinished run even if some file was written along the way,
      // which is the case the Wave-1 predicate alone would have waved through.
      const { anySucceeded, mutationSucceeded, mutationAttempted, verifyPassed } = inspect();
      const plan = projectPlan(store.events(runId));

      if (plan) {
        // A satisfied plan is the clearest possible statement that the work is done.
        if (planSatisfied(plan)) return true;

        // F4 — but the plan is BOOKKEEPING, and bookkeeping is not the work.
        //
        // Wave 2 made `planSatisfied` the only objective once a plan existed. Measured
        // consequence: a run that edited the file AND got a verify PASS was recorded FAILED
        // because the model never called `plan_step`. That swung Wave 1's truthfulness the other
        // way — under-claiming success is as untruthful as over-claiming it, and it is worse for
        // a user, who now cannot tell a real failure from an unticked box.
        //
        // Direct evidence outranks bookkeeping: a mutation that SUCCEEDED and a `verify` that
        // PASSED are the two things a plan step is meant to attest to. When both are in the log,
        // the objective is met however the steps were marked.
        //
        // One exception, deliberately kept strict: a step explicitly marked FAILED and never
        // resolved is a positive statement that something is wrong. That still blocks, because
        // it is the model's own report of incompleteness, not merely a missing tick.
        const hasUnresolvedFailure = plan.steps.some(st => st.state === 'failed');
        if (!hasUnresolvedFailure && mutationSucceeded && verifyPassed) return true;

        return false;                         // an unfinished plan is still an unfinished run
      }

      if (mutationSucceeded) return true;
      if (mutationAttempted) return false;    // tried to change the world and did not
      return anySucceeded;                    // read-only work is real work; doing nothing is not
    },
  };
}

function makeWorker(store, workspace) {
  const sandbox = attachCheckpoints(new LocalSandbox(workspace), path.join(HOME, 'workspaces',
    Buffer.from(workspace).toString('hex').slice(0, 16) + '.git'));
  return { sandbox, worker: (extra = {}) => new Worker(store, {
    sandbox, model: buildModel(), tools: makeTools(sandbox),
    authorize: createAuthorizer({ posture: process.env.ORION_POSTURE ?? 'auto' }),
    // F5: streaming reaches the product surface. Default ON; a provider that cannot stream
    // falls back with a recorded `degraded` event rather than silently.
    stream: streamEnabled(),
    ...extra }) };
}

const short = (id) => id.replace(/^run_/, '#');

// ─────────────────────────────────────────────────────────────── commands
const cmds = {
  async run([task]) {
    if (!task) die('usage: orionctl run "<task>"');
    const store = open();
    const runId = uid('run');
    store.createRun(runId, { task });
    console.log(C.b(`Run ${short(runId)}`) + C.dim(`  ${WORK}`));
    console.log('─'.repeat(48));
    const { worker } = makeWorker(store, WORK);
    const c = store.claim('cli', { runId });
    // D2: a run is only reported complete when it demonstrably did something (ADR-013).
    const res = await worker({ completionContract: defaultCompletionContract(store, runId) })
      .run(runId, c.leaseToken, { input: task });
    printLive(store, runId);
    console.log('');
    console.log(res.status === 'completed' ? C.g(`✓ ${res.reason}`) : C.y(`${res.status} — ${res.reason}`));
    if (res.status === 'paused') console.log(C.dim(`  resume with:  orionctl resume ${short(runId)}`));
    console.log(C.dim(`  history:      orionctl explain ${short(runId)}`));
    store.close();
  },

  // Interactive session. Deliberately a thin shell: every turn goes through the same
  // createRun → claim → worker path as `run`, so a task typed here is durable and resumable
  // from any other shell. See src/cli/repl.mjs for why the session holds no state of its own.
  async chat() {
    const store = open();
    // Deliberately do NOT fail here on missing config. A first-time user's first command is
    // `orionctl`, and exiting with a red error before showing anything is a hostile welcome.
    // The session opens, says what is missing, and refuses only the turns that need a model —
    // /help, /runs, /exit and the banner all work unconfigured.
    reap(store); expireHumanRequests(store);
    const configured = !!process.env.ORION_BASE_URL;
    const { worker } = makeWorker(store, WORK);

    const runTask = async (input) => {
      // Executing a turn is the one thing that genuinely needs a model. Refuse it with the
      // fix rather than letting the model layer throw a connection error.
      if (!configured) {
        const e = new Error('No model configured — set ORION_BASE_URL and ORION_API_KEY, then try again.');
        e.hint = 'e.g.  set ORION_BASE_URL=https://api.openai.com/v1';
        throw e;
      }
      // `/resume <id>` arrives as an object; plain text starts a new run.
      const resuming = typeof input === 'object' && input.resume;
      const runId = resuming ? resolve(store, input.resume) : uid('run');
      if (!resuming) store.createRun(runId, { task: input });

      const c = store.claim('cli', { runId });
      if (!c) throw new Error('could not claim the run (another worker holds it)');
      console.log(C.dim(`  ${short(runId)}`));
      const res = await worker({ completionContract: defaultCompletionContract(store, runId) })
        .run(runId, c.leaseToken, resuming ? {} : { input });
      printLive(store, runId);
      if (res.status === 'completed') console.log(C.g(`  ✓ ${res.reason}`));
      const pending = store.humanRequests(runId, 'pending');
      return { runId, status: res.status, reason: res.reason, question: pending[0]?.prompt };
    };

    const answerAndResume = async (runId, reply) => {
      const pending = store.humanRequests(runId, 'pending');
      if (!pending.length) { console.log(C.y('  no question is pending on that run')); return; }
      store.answerHumanRequest(pending[0].id, reply);
      await runTask({ resume: runId });
    };

    try {
      await repl({
        store, C, version: packageVersion(), workspace: WORK,
        model: process.env.ORION_MODEL ?? 'gpt-4o-mini',
        posture: process.env.ORION_POSTURE ?? 'auto',
        configured,
        runTask, answerAndResume,
        listRuns: () => store.listRuns({ limit: 10 }),
      });
    } finally { store.close(); }
  },

  list(rest = []) {
    const store = open();
    const runs = store.listRuns({ limit: 30 });
    if (has(rest, '--json')) {
      emitJson(runs.map(r => {
        const st = project(store, r.id);
        return {
          run_id: r.id, status: r.status, events: st.seq,
          created_at: new Date(r.created_at).toISOString(),
          task: r.task ?? null,
          parent_run_id: r.parent_run_id ?? null, forked_from_seq: r.forked_from_seq ?? null,
        };
      }));
      return void store.close();
    }
    if (!runs.length) return console.log(C.dim('no runs yet — try: orionctl run "…"'));
    console.log(C.dim('ID          STATUS      EVENTS  WHEN                 TASK'));
    for (const r of runs) {
      const st = project(store, r.id);
      const badge = { completed: C.g('completed'), failed: C.r('failed   '), paused: C.y('paused   '),
                      parked: C.y('parked   '), running: C.c('running  '), pending: C.dim('pending  ') }[r.status] ?? r.status;
      console.log(`${short(r.id).padEnd(11)} ${badge}  ${String(st.seq).padStart(6)}  ` +
        `${new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')}  ` +
        `${(r.task ?? '').slice(0, 40)}${r.parent_run_id ? C.dim(`  ⑂${short(r.parent_run_id)}@${r.forked_from_seq}`) : ''}`);
    }
    store.close();
  },

  status([id, ...rest]) {
    const store = open(); const runId = resolve(store, id);
    const state = project(store, runId);
    if (has(rest, '--json')) {
      const run = store.run(runId);
      emitJson({
        run_id: runId, status: state.status, exit_reason: state.exit_reason ?? null,
        events: state.seq, task: run.task ?? null,
        parent_run_id: run.parent_run_id ?? null, forked_from_seq: run.forked_from_seq ?? null,
        turns: state.budget.turns, model_calls: state.budget.model_calls,
        tool_calls: state.budget.tool_calls,
        tokens: { input: state.budget.input_tokens, output: state.budget.output_tokens },
        cost_usd: state.budget.cost_usd ?? null,
        awaiting_human: (store.humanRequests(runId, 'pending') ?? [])
          .map(h => ({ id: h.id, prompt: h.prompt })),
        // The plan is derived, so it costs a fold rather than a column — and it is null for a
        // run that never declared one, which is an honest answer rather than an empty shape.
        plan: (() => {
          const pl = projectPlan(store.events(runId));
          return pl && { goal: pl.goal, revision: pl.revision, satisfied: planSatisfied(pl),
            steps: pl.steps.map(x => ({ id: x.id, title: x.title, state: x.state,
              depends_on: x.depends_on, evidence: x.evidence, retry: x.retry })),
            superseded_revisions: pl.history.length };
        })(),
      });
      return void store.close();
    }
    console.log(summarise(store, runId, state));
    const pl = projectPlan(store.events(runId));
    if (pl) {
      console.log('');
      console.log('  ' + C.b(summarisePlan(pl)));
      for (const st of pl.steps) {
        const mark = st.state === 'done' ? C.g('✓') : st.state === 'failed' ? C.r('✕')
                   : st.state === 'active' ? C.y('▸') : C.dim('·');
        console.log(`   ${mark} ${st.id}  ${st.title}${st.evidence ? C.dim('  — ' + String(st.evidence).slice(0, 44)) : ''}`);
      }
      if (pl.history.length) console.log(C.dim(`   (${pl.history.length} superseded revision(s) kept in the log)`));
    }
    store.close();
  },

  async resume([id]) {
    const store = open(); const runId = resolve(store, id);
    reap(store); expireHumanRequests(store);
    const run = store.run(runId);
    if (['completed', 'failed', 'parked'].includes(run.status) && run.status !== 'parked')
      return void console.log(C.y(`run is already ${run.status}`)), store.close();
    const pending = store.humanRequests(runId, 'pending');
    if (pending.length) {
      console.log(C.y('This run is waiting on you:'));
      for (const p of pending) console.log(`  ${p.id}  ${p.prompt}`);
      console.log(C.dim(`  answer with:  orionctl answer ${short(runId)} <approve|deny>`));
      return void store.close();
    }
    const c = store.claim('cli', { runId });
    if (!c) { console.log(C.r('could not claim the run (another worker holds it)')); return void store.close(); }
    console.log(C.dim(`resuming from event ${store.lastSeq(runId)}…`));
    const { worker } = makeWorker(store, WORK);
    // The completion gate applies to a resumed run exactly as it does to a fresh one.
    const res = await worker({ completionContract: defaultCompletionContract(store, runId) })
      .run(runId, c.leaseToken, {});
    printLive(store, runId);
    console.log(res.status === 'completed' ? C.g(`✓ ${res.reason}`) : C.y(`${res.status} — ${res.reason}`));
    store.close();
  },

  answer([id, response]) {
    const store = open(); const runId = resolve(store, id);
    const pending = store.humanRequests(runId, 'pending');
    if (!pending.length) return void console.log(C.dim('nothing pending')), store.close();
    store.answerHumanRequest(pending[0].id, response ?? 'approve');
    console.log(C.g(`answered "${response ?? 'approve'}"`) + C.dim(`  now: orionctl resume ${short(runId)}`));
    store.close();
  },

  replay([id, ...rest]) {
    const store = open(); const runId = resolve(store, id);
    const at = flag(rest, '--at');
    const r = replay(store, runId, { at: at ? Number(at) : null });
    if (has(rest, '--json')) {
      emitJson({
        run_id: runId, replayed_at: at ? Number(at) : null,
        model_calls_made: 0,          // replay is reconstruction: it never calls a model
        status: r.state.status, exit_reason: r.state.exit_reason ?? null,
        events: r.state.seq,
        turns: r.state.budget.turns, model_calls: r.state.budget.model_calls,
        tool_calls: r.state.budget.tool_calls,
        tokens: { input: r.state.budget.input_tokens, output: r.state.budget.output_tokens },
      });
      return void store.close();
    }
    console.log(C.b(`Replay of ${short(runId)}${at ? ` at event ${at}` : ''}`));
    console.log(C.dim(`reconstructed from the event log — no model calls, no cost`));
    console.log('');
    console.log(summarise(store, runId, r.state));
    store.close();
  },

  fork([id, ...rest]) {
    const store = open(); const runId = resolve(store, id);
    const at = Number(flag(rest, '--at'));
    if (!Number.isInteger(at)) die('usage: orionctl fork <run> --at <seq>');
    const f = fork(store, runId, at);
    console.log(C.g(`forked ${short(runId)} @${at} -> ${C.b(short(f.run_id))}`));
    if (!f.at_turn_boundary) {
      const better = nearestTurnBoundary(store, runId, at);
      console.log(C.y(`  warning: event ${at} is MID-TURN — ${f.open_tool_calls.length} tool call(s) were`));
      console.log(C.y(`           requested but never resolved: ${f.open_tool_calls.join(', ')}`));
      console.log(C.dim(`           the resumed model sees "[no result recorded]" for these and may`));
      console.log(C.dim(`           treat them as already done. For a clean split try --at ${better}.`));
    }
    console.log(C.dim('  history up to that point is inherited; the future is new'));
    console.log(C.y('  note: the WORKSPACE is not rewound automatically.'));
    console.log(C.dim(`        run the fork in a fresh workspace, or restore a checkpoint first.`));
    console.log(C.dim(`  continue with:  orionctl resume ${short(f.run_id)}`));
    store.close();
  },

  rerun([id]) {
    const store = open(); const runId = resolve(store, id);
    const r = rerun(store, runId);
    console.log(C.g(`new run ${short(r.run_id)} from the same task`) + C.dim(' (no history inherited)'));
    console.log(C.dim(`  start with:  orionctl resume ${short(r.run_id)}`));
    store.close();
  },

  explain([id, ...rest]) {
    const store = open(); const runId = resolve(store, id);
    console.log(explain(store, runId, { verbose: rest.includes('--verbose'), full: rest.includes('--full') }));
    store.close();
  },

  doctor() {
    const store = open();
    const runs = store.listRuns({ limit: 1000 });
    const stale = runs.filter(r => r.status === 'running' && (r.lease_expires_at ?? 0) < Date.now());
    const waiting = runs.filter(r => r.status === 'paused');
    console.log(C.b('orionctl doctor'));
    console.log(`  home              ${HOME}`);
    console.log(`  database          ${DB} ${fs.existsSync(DB) ? C.g('ok') : C.r('missing')}`);
    console.log(`  runs              ${runs.length}`);
    console.log(`  model endpoint    ${process.env.ORION_BASE_URL ?? C.r('NOT SET (ORION_BASE_URL)')}`);
    console.log(`  api key           ${process.env.ORION_API_KEY || process.env.OPENAI_API_KEY ? C.g('present') : C.y('absent')}`);
    console.log(`  posture           ${process.env.ORION_POSTURE ?? 'auto'}`);
    console.log(`  ${stale.length ? C.y(`stale leases      ${stale.length} (run 'orionctl reap')`) : C.g('stale leases      none')}`);
    console.log(`  ${waiting.length ? C.y(`awaiting human    ${waiting.length}`) : C.g('awaiting human    none')}`);
    let sqliteOk = true;
    try { store.db.exec('PRAGMA integrity_check'); } catch { sqliteOk = false; }
    console.log(`  db integrity      ${sqliteOk ? C.g('ok') : C.r('FAILED')}`);
    store.close();
  },

  reap() {
    const store = open();
    const r = reap(store); const h = expireHumanRequests(store);
    console.log(`requeued ${r.requeued}, parked ${r.parked}, expired human requests ${h.expired}`);
    for (const a of r.actions) console.log(C.dim(`  ${short(a.run_id)} ${a.action} (attempt ${a.attempts})`));
    store.close();
  },

  help() { usage(); },
};

// ───────────────────────────────────────────────────────────────── helpers
function printLive(store, runId) {
  const evs = store.events(runId);
  for (const e of evs) {
    const p = e.payload || {};
    if (e.type === 'tool.succeeded') console.log(C.g('  ✓ ') + `${p.name} ${C.dim(oneline(p.result))}`);
    else if (e.type === 'tool.failed') console.log(C.r('  ✕ ') + `${p.name} ${C.dim(oneline(p.error))}`);
    else if (e.type === 'tool.denied') console.log(C.r('  ⛔ ') + `${p.name} ${C.dim(oneline(p.reason))}`);
    else if (e.type === 'degraded') console.log(C.y('  ⚠ ') + C.dim(`[${p.subsystem}] ${oneline(p.reason)}`));
    else if (e.type === 'human.requested') console.log(C.y('  🙋 ') + oneline(p.prompt));
    else if (e.type === 'run.lease_lost') console.log(C.y('  ✕ Process terminated'));
    else if (e.type === 'tool.recovery_decided')
      console.log(C.c(`  ♻ Recovered from event #${e.seq}`) + C.dim(` — ${p.name}: ${p.decision}`));
  }
}
const oneline = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 60);
function flag(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const has = (args, name) => args.includes(name);
/**
 * Machine-readable output.
 *
 * JSON goes to stdout ALONE — no banner, no colour, no human framing — so `orionctl status X --json`
 * can be piped straight into jq. Commands that emit JSON return early rather than rendering both
 * forms, because mixing the two on one stream is what makes --json useless in practice.
 */
const emitJson = (obj) => console.log(JSON.stringify(obj, null, 2));
function die(m) { console.error(C.r(m)); process.exit(2); }
function resolve(store, id) {
  if (!id) die('missing run id');
  const want = id.replace(/^#/, '');
  const all = store.listRuns({ limit: 1000 });
  const hit = all.find(r => r.id === id || r.id === `run_${want}` || r.id.endsWith(want));
  if (!hit) die(`no such run: ${id}`);
  return hit.id;
}
function usage() {
  console.log(`${banner(C, packageVersion())}
  orionctl                        interactive session
  orionctl run "<task>"           start a run in the current directory
  orionctl list                   all runs                        [--json]
  orionctl status <run>           where a run got to              [--json]
  orionctl resume <run>           continue a run (after a crash, or a human answer)
  orionctl answer <run> <reply>   answer a question the run is waiting on
  orionctl explain <run>          what the run actually did      [--verbose] [--full]
  orionctl replay <run>           reconstruct history   [--at <seq>] [--json]
  orionctl fork <run> --at <seq>  branch from a point in history
  orionctl rerun <run>            fresh run of the same task
  orionctl reap                   reclaim runs whose worker died
  orionctl doctor                 environment check

${C.dim('config:')}  ORION_BASE_URL  ORION_API_KEY  ORION_MODEL  ORION_HOME  ORION_POSTURE`);
}

/**
 * Package version, read from the manifest rather than duplicated in source — a hardcoded string
 * silently drifts from what npm actually published.
 */
function packageVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8'));
    return pkg.version ?? 'unknown';
  } catch { return 'unknown'; }
}

/**
 * Dispatch, but only when this file IS the program.
 *
 * The CLI also exports the policy it applies — `defaultCompletionContract`, `selectShims` —
 * so tests can assert on the wiring the CLI actually uses rather than on a hand-built
 * reconstruction of it. Without this guard, importing the module printed the banner and exited
 * the importing process, which made that impossible.
 */
async function cli() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === '-v' || cmd === '--version' || cmd === 'version') {
    console.log(packageVersion());
    process.exit(0);
  }
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') { usage(); process.exit(0); }
  // Bare `orionctl` opens the interactive session — but only on a terminal. Piped or redirected
  // (CI, scripts, `orionctl | head`) there is nobody to prompt, so print usage and exit cleanly
  // rather than blocking forever on a stdin that will never arrive.
  if (!cmd) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      try { await cmds.chat(); process.exit(0); }
      catch (e) { console.error(C.r(e.message)); process.exit(1); }
    }
    usage(); process.exit(0);
  }
  if (!cmds[cmd]) { console.error(C.r(`unknown command: ${cmd}`)); usage(); process.exit(2); }
  try { await cmds[cmd](args); } catch (e) { console.error(C.r(e.message)); process.exit(1); }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url))) await cli();
