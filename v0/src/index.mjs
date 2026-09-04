// Public API for @kernlbase/orion.
//
// This barrel is a DELIBERATE re-export surface, not a convenience dump. What it exposes is the
// API that already has a second consumer: `eval/` drives this runtime as a library across nine
// modules, so these boundaries have been exercised outside their own tests rather than designed
// speculatively.
//
// Deliberately NOT exported (reachable only via a subpath, or not at all):
//   core/projection  — bounded-window mechanics (ADR-001). Tuning, not contract.
//   core/lease       — operational; reached through the CLI (`orionctl reap`).
//   core/projection/compact — implemented and tested, but OFF BY DEFAULT. Experimental.
//   agent/model/shims/*     — model-specific implementations. The shim *slot* is public
//                             (`shims: []` on createOpenAICompatModel); a given shim is not.
//   cli/             — a composition root, not a library.
//
// Anything not listed here is internal and may change without a major version bump.

// ── Run: durable execution state ────────────────────────────────────────────
// The event log itself. Store is append-only; a run is a first-class object you can re-open.
export { Store, uid, LeaseLostError } from './core/run/store.mjs';

// ── Event: the closed contract ──────────────────────────────────────────────
// EVENT_TYPES is frozen. isKnownType() rejects anything outside it, which is what makes the log
// a contract rather than opportunistic logging.
export {
  EVENT_TYPES, EVENT_CONTRACT_VERSION, isKnownType, TERMINAL, modelRespondedPayload, UnknownEventType,
} from './core/event/index.mjs';

// ── Trajectory: inspect, replay, fork ───────────────────────────────────────
// replay() reconstructs run state from the log with no model calls and no cost.
// fork() branches HISTORY — it does not rewind the workspace. See docs/FORKING.md.
export {
  replay, verifyProjectionEquivalence, fork, nearestTurnBoundary, rerun,
} from './core/replay/index.mjs';
export { explain, summarise, redact } from './core/run/explain.mjs';

// ── Planning (event contract v2) ────────────────────────────────────────────
// A plan is DERIVED: `projectPlan` folds plan.* events into the current plan. Nothing about a
// plan is stored, so it survives a crash and reconstructs identically under resume and replay.
export {
  projectPlan, readySteps, planSatisfied, summarisePlan,
} from './core/projection/plan.mjs';

// ── Provider: one OpenAI-compatible adapter ─────────────────────────────────
// Provider quirks belong in a shim applied to the NORMALISED result, never inside the runtime.
export { createOpenAICompatModel, ModelError } from './agent/model/index.mjs';

// ── Tools ───────────────────────────────────────────────────────────────────
// toolDefinitions() strips runtime-injected fields, so values the runtime owns (e.g. write's
// pre-state witness) are never exposed to — or supplied by — the model.
export { makeTools, toolDefinitions, validateArgs, ABSENT } from './agent/tools/index.mjs';

// ── Workspace ───────────────────────────────────────────────────────────────
// Path containment (including symlink escape) and bounded output. NOT OS-level isolation.
export {
  LocalSandbox, attachCheckpoints, scrubEnv,
  MAX_OUTPUT_BYTES, MAX_ERROR_BYTES, GREP_MAX_HITS,
} from './sandbox/local/index.mjs';

// ── Authorization: the substitution seam ────────────────────────────────────
// authorize(action, context) -> allow | deny | escalate.
// A different authorizer plugs in here without a runtime change.
export { createAuthorizer, Decision, digestArgs } from './auth/default/index.mjs';

// ── Recovery ────────────────────────────────────────────────────────────────
// RecoveryClass is contract (tools declare one). classifyShell is an internal heuristic and is
// exported for inspection only — treat its exact verdicts as unstable.
export { RecoveryClass, decideRecovery, classifyShell } from './core/recovery/index.mjs';

// ── Worker: the run loop ────────────────────────────────────────────────────
export {
  Worker, ExitReason, repairOrphans,
  DEFAULT_SYSTEM, ESCALATION_POLICY, SYSTEM_WITH_ESCALATION_POLICY,
} from './agent/loop/worker.mjs';
