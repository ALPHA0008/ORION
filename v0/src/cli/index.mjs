#!/usr/bin/env node
// Phase K — the time-travel CLI. The user should never need to know what "event sourcing" is.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../core/run/store.mjs';
import { TERMINAL } from '../core/event/index.mjs';
import { LocalSandbox, attachCheckpoints } from '../sandbox/local/index.mjs';
// W6: the backend contract, the second (isolated) backend, and default-deny egress.
import { assertBackendContract } from '../sandbox/backend.mjs';
import { ContainerSandbox, detectRuntime, pruneOrionContainers } from '../sandbox/container/index.mjs';
import { createNetworkPolicy } from '../sandbox/network.mjs';
// W6 C/D/H/I/J: resource identity and Recovery 2.0.
import { resolveResource, releaseResource, Resolution } from '../core/resource/index.mjs';
import { projectResources, summariseResources } from '../core/projection/resource.mjs';
// W6 M: approval memory.
import { describeGrant, projectGrants, summariseGrants, projectKey, GrantScope }
  from '../core/projection/grant.mjs';
import { makeTools, mutatingTools } from '../agent/tools/index.mjs';
import { createAuthorizer } from '../auth/default/index.mjs';
import { Worker, DEFAULT_SYSTEM } from '../agent/loop/worker.mjs';
// W7: skills + project instructions — the runtime becomes instructable, with provenance.
import { discoverSkills, renderDisclosure, disclosureBytes } from '../context/skills.mjs';
import { loadProjectInstructions, renderInstructions } from '../context/instructions.mjs';
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
//
// The annotation is what makes this checkable (W5 Q1): the Proxy branch is structurally `{}`, so
// without it the union narrows to nothing and every single use of `C.dim` / `C.r` / … is
// reported as a missing property — 81 of this file's findings were that one inference.
/** @type {Record<'dim'|'b'|'g'|'r'|'y'|'c'|'cb'|'m', (s: any) => string>} */
const C = process.stdout.isTTY
  ? { dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
      r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m`,
      // bright cyan for the wordmark, magenta for accents — the banner should read as a logo,
      // not as more output.
      cb: s => `\x1b[96m${s}\x1b[0m`, m: s => `\x1b[95m${s}\x1b[0m` }
  : /** @type {any} */ (new Proxy({}, { get: () => (s => s) }));

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
// W5 T1: which tools change the world is DERIVED from the toolset's own `effects`
// declarations, never restated here. This was `new Set(['write','edit','bash'])` — a second
// copy of a fact each tool already declares, and the copy is what decided whether a run had
// really done its work. A tenth tool with `effects: 'Mutating'` is now counted automatically;
// under the old list it would have been silently treated as read-only.
//
// `tools` is a parameter so a caller running a restricted toolset gets a contract that matches
// what it actually wired. It defaults to the shipped toolset for the common case.
// Built once, with a null sandbox: `makeTools` only closes over the sandbox, it never touches
// it at construction, so this yields the real shipped descriptors — including their `effects` —
// without needing a workspace. Anything that would make that untrue is caught by the T2 test.
const SHIPPED_TOOL_EFFECTS = makeTools(null);

export function defaultCompletionContract(store, runId, { tools = null } = {}) {
  const MUTATING = mutatingTools(tools ?? SHIPPED_TOOL_EFFECTS);
  const inspect = () => {
    const events = store.events(runId);
    const names = new Map();          // tool_call_id -> tool name, from the request event
    for (const e of events) {
      if (e.type === 'tool.requested') names.set(e.payload?.tool_call_id, e.payload?.name);
    }
    let anySucceeded = false, mutationSucceeded = false, mutationAttempted = false;
    let verifyPassed = false;
    for (const e of events) {
      if (e.type === 'tool.requested' && MUTATING.has(e.payload?.name)) mutationAttempted = true;
      if (e.type === 'tool.succeeded') {
        anySucceeded = true;
        const tool = names.get(e.payload?.tool_call_id);
        if (MUTATING.has(tool)) mutationSucceeded = true;
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

/**
 * W6 A/B — choose the execution backend.
 *
 * `ORION_SANDBOX=container` opts into real isolation; `local` (the default) keeps the documented
 * containment-only behaviour. Both satisfy the same contract, asserted here at wiring time rather
 * than discovered on the first tool call.
 *
 * A REQUESTED CONTAINER THAT CANNOT BE PROVIDED IS A HARD FAILURE, never a fallback. Falling back
 * to local would leave the operator believing commands are isolated when they are running on
 * their own machine — and since W6-G derives posture from the backend, the quieter failure would
 * also silently change the authorization floor. Refusing is the only honest option.
 */
export function makeSandbox(workspace, env = process.env) {
  const want = String(env.ORION_SANDBOX ?? 'local').trim().toLowerCase();
  const shadow = path.join(HOME, 'workspaces',
    Buffer.from(workspace).toString('hex').slice(0, 16) + '.git');

  if (want === 'container' || want === 'docker' || want === 'podman') {
    const runtime = detectRuntime(want === 'container' ? {} : { candidates: [want] });
    if (!runtime) {
      console.error(C.r('ORION_SANDBOX=container was requested but no container runtime is available.'));
      console.error('  Looked for: docker, podman (the CLI must exist AND its daemon must answer).');
      console.error(C.dim('  Refusing to fall back to the local sandbox: that would run commands on this'));
      console.error(C.dim('  machine while you believed they were isolated. Start the runtime, or unset'));
      console.error(C.dim('  ORION_SANDBOX to use the local (containment-only) backend deliberately.'));
      process.exit(2);
    }
    // W6.1: the image is selectable. `ContainerSandbox` has always accepted one and the CLI never
    // passed it — the same unwired-at-the-composition-root defect as `reap`'s container prune, and
    // it had a sharp consequence. The default `alpine:3` has no Node, so the W6.1 §11.2 gate
    // watched a real model auto-allow its own verification command and then get
    // `sh: node: not found`. Auto-allow worked exactly as designed and was useless, because the
    // sandbox could not run the project's own toolchain.
    //
    // The default stays `alpine:3` — small, dependency-free, and right for shell work. A project
    // whose tests need a runtime names an image that has it.
    const image = String(env.ORION_IMAGE ?? '').trim() || undefined;
    const sandbox = new ContainerSandbox(workspace, {
      runtime,
      ...(image ? { image } : {}),
      network: createNetworkPolicy({ mode: 'none' }),   // W6-F: default-deny, and here that is
    });                                                 // literally no network stack
    // Checkpoints still shell to HOST git against the host side of the bind mount — the Q4
    // reconciliation. See src/sandbox/container/index.mjs for why this is correct rather than
    // convenient.
    attachCheckpoints(sandbox, shadow);
    assertBackendContract(sandbox, 'ContainerSandbox');
    return { sandbox, backendName: 'ContainerSandbox' };
  }

  const sandbox = attachCheckpoints(new LocalSandbox(workspace), shadow);
  assertBackendContract(sandbox, 'LocalSandbox');
  return { sandbox, backendName: 'LocalSandbox' };
}

/**
 * Bind a run to its resource and build a worker whose posture was DERIVED from that resource.
 *
 * The ordering here is the whole of W6's wiring, and it only works in this direction: the
 * resource must be resolved BEFORE the authorizer exists, because the authorizer's posture is a
 * consequence of the backend's declared capability (W6-G) rather than a setting. Every command
 * that runs a turn goes through this one function, so there is no path on which a mechanism is
 * reachable in a test and absent in the product.
 */
export async function prepareRun(store, runId, leaseToken, workspace) {
  const { sandbox, backendName } = makeSandbox(workspace);

  // W6 C/D/H/I/J — acquire or reattach, and record which it was.
  const resource = await resolveResource({
    store, runId, backend: sandbox, leaseToken, backendName,
    postureOverride: process.env.ORION_POSTURE ?? null,
  });

  if (resource.resolution === Resolution.ESCALATED) {
    console.log(C.y(`⚠ resource escalation: ${resource.escalate}`));
    console.log(C.dim('  the run was bound to a resource whose state cannot be established;'));
    console.log(C.dim('  it is recorded in the log as `resource.lost` and no work was resumed.'));
    return { sandbox, resource, worker: null };
  }
  if (resource.resolution === Resolution.RECREATED) {
    // Never silent (W6-I): the run continues, but not on the world it started on.
    console.log(C.y('⚠ the resource this run was bound to is gone; a new one was created.'));
    console.log(C.dim('  state held only inside the old resource did not survive'
                    + ' (recorded as `resource.lost`).'));
  } else if (resource.resolution === Resolution.REATTACHED) {
    console.log(C.dim(`  reattached to ${resource.resource_id}`));
  }

  console.log(C.dim(`  sandbox: ${backendName}  posture: ${resource.posture}`
    + `${sandbox.capabilities.isolated ? ' (isolated)' : ''}`));

  // ── W7 — the runtime becomes instructable ────────────────────────────────
  //
  // Both influences are resolved HERE, at the composition root, because every turn-bearing
  // command (`run`, `resume`, and each turn of the interactive session) funnels through this
  // function. A skills loader reachable only from a test is the failure class this project has
  // repeated six times in five waves.
  //
  // Both are recorded BEFORE the worker exists, so the log explains the prompt of the very first
  // turn rather than of the second onwards.
  const instructions = loadProjectInstructions(workspace);
  if (instructions.found) {
    store.append(runId, 'instructions.loaded', {
      name: instructions.name,
      path: instructions.path,
      // The digest is of the FILE, not of the truncated view, so an edited brief is visible as a
      // different digest even when the change fell past the cap.
      digest: instructions.digest,
      bytes: instructions.bytes,
      truncated: instructions.truncated,
      // "Why is my CLAUDE.md being ignored?" is answerable from the log rather than from a
      // support thread.
      shadowed: instructions.shadowed.map(s => s.name),
    }, { leaseToken });
    console.log(C.dim(`  instructions: ${instructions.name}`
      + (instructions.truncated ? ' (truncated)' : '')
      + (instructions.shadowed.length ? `  [${instructions.shadowed.map(s => s.name).join(', ')} shadowed]` : '')));
  }

  const { skills, shadowed: skillShadowed, searched } = discoverSkills({ workspace, home: HOME });
  const disclosure = renderDisclosure(skills);
  if (skills.length) {
    store.append(runId, 'skill.disclosed', {
      // Names and descriptions only — the same thing the model sees. Recording the BODIES here
      // would defeat progressive disclosure in the log while preserving it in the prompt, which
      // is the wrong way round: the log should be able to show that disclosure stayed cheap.
      skills: skills.map(s => ({ name: s.name, scope: s.scope, path: s.path,
                                 digest: s.digest, bytes: s.bytes })),
      disclosure_bytes: disclosureBytes(skills),
      shadowed: skillShadowed,
      searched: searched.filter(s => s.found > 0),
    }, { leaseToken });
    console.log(C.dim(`  skills: ${skills.length} available (${disclosureBytes(skills)} B disclosed)`
      + `  ${skills.map(s => s.name).join(', ')}`));
  }

  // The system prompt is assembled from: the runtime's own instructions, the project's standing
  // brief, and the skill catalogue. `#buildMessages` prepends it fresh every turn, so this is
  // rebuilt identically on replay from the same files — which is what keeps Invariant 2 true for
  // a briefed run.
  const systemPrompt = [
    DEFAULT_SYSTEM,
    renderInstructions(instructions),
    disclosure,
  ].filter(Boolean).join('\n\n');

  const project = projectKey(workspace);
  const authorize = createAuthorizer({
    // DERIVED, not read from a flag. `resolveResource` already folded in any operator override
    // and refused to let it lower the floor the backend earns.
    posture: resource.posture,
    // W6 M — approval memory, read at DECISION time so an approval given earlier this run (or in
    // an earlier run against this project) is visible to the check happening now.
    grants: () => store.grantEvents({ project }),
  });

  return {
    sandbox, resource,
    worker: (extra = {}) => new Worker(store, {
      sandbox, model: buildModel(), authorize,
      // W7: the `skill` tool exists only when there is something to activate, so a project with
      // no skills sees the identical toolset it saw before this wave.
      tools: makeTools(sandbox, { skills }),
      systemPrompt,
      // F5: streaming reaches the product surface. Default ON; a provider that cannot stream
      // falls back with a recorded `degraded` event rather than silently.
      stream: streamEnabled(),
      // W6 L: render committed output deltas as they land. This is a CONSUMER of the durable
      // record, not a substitute for it — the events are appended whether or not anything is
      // watching, so piping the CLI or killing the terminal changes what you see and never what
      // was recorded.
      hooks: { beforeAppend: (marker, ctx) => {
        if (marker !== 'after:tool.output_delta' || !ctx.text) return;
        for (const line of String(ctx.text).split(String.fromCharCode(10))) {
          if (line.trim()) console.log(C.dim('  │ ') + line.slice(0, 120));
        }
      } },
      // W6 K: the authorization context carries what grants are scoped BY. Without these the
      // grant store would be wired but could never match anything — the exact "mechanism that
      // grants nothing" failure the plan names.
      authContext: { project, resource_id: resource.resource_id },
      ...extra }),
  };
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
    const c = store.claim('cli', { runId });
    // W6: resource resolution happens BEFORE the worker exists, because posture is derived from
    // the backend rather than configured (W6-G).
    const { worker, sandbox, resource } = await prepareRun(store, runId, c.leaseToken, WORK);
    if (!worker) { store.close(); process.exitCode = 1; return; }
    // D2: a run is only reported complete when it demonstrably did something (ADR-013).
    const res = await worker({ completionContract: defaultCompletionContract(store, runId) })
      .run(runId, c.leaseToken, { input: task });
    await releaseResource({ store, runId, backend: sandbox, leaseToken: c.leaseToken,
                            reason: `run ${res.status}` });
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

    const runTask = async (input) => {
      // Executing a turn is the one thing that genuinely needs a model. Refuse it with the
      // fix rather than letting the model layer throw a connection error.
      if (!configured) {
        throw Object.assign(
          new Error('No model configured — set ORION_BASE_URL and ORION_API_KEY, then try again.'),
          { hint: 'e.g.  set ORION_BASE_URL=https://api.openai.com/v1' });
      }
      // `/resume <id>` arrives as an object; plain text starts a new run.
      const resuming = typeof input === 'object' && input.resume;
      const runId = resuming ? resolve(store, input.resume) : uid('run');
      if (!resuming) store.createRun(runId, { task: input });

      const c = store.claim('cli', { runId });
      if (!c) throw new Error('could not claim the run (another worker holds it)');
      console.log(C.dim(`  ${short(runId)}`));
      // Per TURN, not per session: an interactive session resumes and rebinds exactly like
      // `orionctl resume`, so a container that died between turns is reattached or reported.
      const { worker, sandbox } = await prepareRun(store, runId, c.leaseToken, WORK);
      if (!worker) return { runId, status: 'parked', reason: 'resource unavailable' };
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
    // W6-I: this is where Recovery 2.0 happens — reattach by identity, or say what was lost.
    const { worker, sandbox, resource } = await prepareRun(store, runId, c.leaseToken, WORK);
    if (!worker) { store.close(); process.exitCode = 1; return; }
    // The completion gate applies to a resumed run exactly as it does to a fresh one.
    const res = await worker({ completionContract: defaultCompletionContract(store, runId) })
      .run(runId, c.leaseToken, {});
    await releaseResource({ store, runId, backend: sandbox, leaseToken: c.leaseToken,
                            reason: `run ${res.status}` });
    printLive(store, runId);
    console.log(res.status === 'completed' ? C.g(`✓ ${res.reason}`) : C.y(`${res.status} — ${res.reason}`));
    store.close();
  },

  /**
   * Answer a pending escalation — and optionally REMEMBER the answer (W6-M).
   *
   *   orionctl answer <run> approve                     answer once
   *   orionctl answer <run> approve --remember          remember for this run
   *   orionctl answer <run> approve --remember project  remember for this project, across runs
   *
   * Remembering is opt-in and explicit. Making it the default would be the footgun M exists to
   * avoid: an operator approving one command would silently create standing consent, which is
   * exactly the "approved without reading" dynamic that repeated prompting produces.
   */
  answer([id, response, ...rest]) {
    const store = open(); const runId = resolve(store, id);
    const pending = store.humanRequests(runId, 'pending');
    if (!pending.length) return void console.log(C.dim('nothing pending')), store.close();
    const answer = response ?? 'approve';
    const req = pending[0];
    store.answerHumanRequest(req.id, answer);
    console.log(C.g(`answered "${answer}"`) + C.dim(`  now: orionctl resume ${short(runId)}`));

    const remember = flag(rest, '--remember', has(rest, '--remember') ? 'session' : null);
    if (remember && answer === 'approve') {
      // The command being approved is recovered from the trajectory, not from the prompt text:
      // the prompt is prose for a human, and a grant must key off exactly the command that will
      // be re-run. `tool.started`/`tool.requested` carries the real args.
      const events = store.events(runId);
      const esc = [...events].reverse().find(e => e.type === 'tool.escalated');
      const cmd = esc?.payload?.args?.cmd ?? null;
      const tool = esc?.payload?.name ?? null;
      if (!cmd && !tool) {
        console.log(C.y('  could not identify what to remember (no tool.escalated in this run)'));
      } else {
        /** @type {string} */
        const scope = remember === 'project' ? GrantScope.PROJECT
                    : remember === 'resource' ? GrantScope.RESOURCE
                    : GrantScope.SESSION;
        const binding = projectResources(events).current;
        try {
          const g = describeGrant({
            scope, tool: cmd ? null : tool, command: cmd,
            project: scope === GrantScope.PROJECT ? WORK : null,
            resourceId: scope === GrantScope.RESOURCE ? binding?.resource_id : null,
            runId: scope === GrantScope.SESSION ? runId : null,
            decidedBy: `human:${process.env.USERNAME ?? process.env.USER ?? 'cli'}`,
            reason: `approved at ${new Date().toISOString()}`,
          });
          // Through Store.append, like every other event — there is no second path (W5 S1/S2).
          //
          // Deliberately UNFENCED (no lease token). A grant is an additive FACT, not a lifecycle
          // transition: it changes no run status and takes no lease, and `append` allocates its
          // seq inside a transaction, so a concurrent worker cannot collide with it. Claiming the
          // run to write it would be worse than pointless — the operator is answering a run that
          // a worker may legitimately be resuming, and stealing its lease to record an approval
          // would fence out the very run the approval is for.
          store.append(runId, 'grant.created', g);
          console.log(C.g(`  remembered (${scope}): ${g.command ?? `tool:${g.tool}`}`)
            + C.dim(`  ${g.grant_id}`));
        } catch (e) {
          console.log(C.y(`  could not record the grant: ${e.message}`));
        }
      }
    }
    store.close();
  },

  /** W6 M — what is currently remembered, and where it came from. */
  grants(rest = []) {
    const store = open();
    const all = has(rest, '--all');
    const events = store.grantEvents(all ? {} : { project: projectKey(WORK) });
    const { active, grants } = projectGrants(events);
    if (has(rest, '--json')) {
      emitJson({ project: all ? null : projectKey(WORK), active, total: Object.keys(grants).length });
      return void store.close();
    }
    console.log(C.b('remembered approvals') + C.dim(all ? '  (all projects)' : `  ${projectKey(WORK)}`));
    const text = summariseGrants(events);
    console.log(text ? text : C.dim('  none — every escalation will be asked'));
    const revoked = Object.values(grants).filter(g => g.revoked).length;
    if (revoked) console.log(C.dim(`  (${revoked} revoked)`));
    store.close();
  },

  /** W6 M — withdraw a remembered approval. Recorded, never deleted. */
  revoke([grantId, ...rest]) {
    if (!grantId) die('usage: orionctl revoke <grant_id> [--reason "..."]');
    const store = open();
    const events = store.grantEvents({});
    const { grants } = projectGrants(events);
    const g = grants[grantId];
    if (!g) { console.log(C.r(`no such grant: ${grantId}`)); return void store.close(); }
    if (g.revoked) { console.log(C.dim('already revoked')); return void store.close(); }
    // A revocation is an event on the run that created the grant, so the withdrawal sits in the
    // same trajectory as the approval — deleting the row would erase the fact that it ever held.
    const runId = g.created_in_run;
    if (!runId) { console.log(C.r('this grant has no originating run recorded')); return void store.close(); }
    // Unfenced, for the same reason as the grant itself — and revocation especially must not be
    // blocked by whoever happens to hold the lease. An approval you cannot withdraw while a run
    // is using it is not a revocation.
    store.append(runId, 'grant.revoked',
      { grant_id: grantId, reason: flag(rest, '--reason', 'revoked by operator') });
    console.log(C.g(`revoked ${grantId}`));
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
    // W5 (S1): the last `store.db` reach outside the Store. Integrity is the Store's question.
    sqliteOk = store.integrityOk();
    console.log(`  db integrity      ${sqliteOk ? C.g('ok') : C.r('FAILED')}`);
    store.close();
  },

  /**
   * Reclaim what dead workers left behind — runs AND, since W6, their containers.
   *
   * W6.1: `pruneOrionContainers` was imported here in W6 and never called. That is the
   * "mechanism unwired at the composition root" failure class this project keeps repeating, and
   * it had a visible symptom: eight `orion-*` containers were found still running two hours after
   * the runs that created them had ended. `reap`'s entire job is reclaiming what a dead worker
   * left, and once the sandbox became a long-lived container, a leaked container is exactly that.
   *
   * Only containers whose run is TERMINAL are removed. A container belonging to a run that is
   * still resumable must survive — reattaching to it is the whole of Recovery 2.0 (W6-I), and
   * pruning it would turn every reattach into a recreate-with-notice.
   */
  async reap(rest = []) {
    const store = open();
    const r = reap(store); const h = expireHumanRequests(store);
    console.log(`requeued ${r.requeued}, parked ${r.parked}, expired human requests ${h.expired}`);
    for (const a of r.actions) console.log(C.dim(`  ${short(a.run_id)} ${a.action} (attempt ${a.attempts})`));

    const runtime = detectRuntime();
    if (runtime) {
      // Which container names is a still-resumable run bound to? Those must survive.
      const keep = new Set();
      for (const run of store.listRuns({ limit: 500 })) {
        if (TERMINAL.has(run.status)) continue;
        const b = projectResources(store.events(run.id)).current;
        if (b?.handle_name) keep.add(b.handle_name);
      }
      const { pruned, kept } = await pruneOrionContainers({ runtime, keep });
      if (pruned || kept) {
        console.log(`containers: removed ${pruned} orphaned`
          + (kept ? `, kept ${kept} still reattachable` : ''));
      }
    } else if (has(rest, '--verbose')) {
      console.log(C.dim('containers: no runtime available — nothing to prune'));
    }
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
function flag(args, name, fallback = null) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  // A flag present with no value, or immediately followed by another flag, takes the fallback.
  // Without this, `--remember` alone returned undefined and the caller silently did nothing.
  if (v === undefined || String(v).startsWith('--')) return fallback;
  return v;
}
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
  orionctl grants                 approvals this project remembers   [--all] [--json]
  orionctl revoke <grant>         withdraw a remembered approval     [--reason "..."]

${C.dim('config:')}  ORION_BASE_URL  ORION_API_KEY  ORION_MODEL  ORION_HOME  ORION_POSTURE
${C.dim('sandbox:')} ORION_SANDBOX=local|container   ORION_IMAGE=<image>  (container ⇒ isolated, --network none,
          and commands are auto-allowed because the blast radius is the sandbox, not your machine)
${C.dim('answer:')}  orionctl answer <run> approve --remember [session|project|resource]`);
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
