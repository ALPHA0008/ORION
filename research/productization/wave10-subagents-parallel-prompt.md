# Session prompt — WAVE 10 "SUBAGENTS + PARALLEL EXECUTION"

Hand this to the executing agent (Claude). Hard scope, taken verbatim from the rebaselined
`MASTER-HARNESS-DEVELOPMENT-PLAN.md` (2026-09-07 edition, amended 2026-09-08), §10.2 W10, §1.2,
§1.3, §7, §11, §13. W10 is the **critical-path next wave** (dependency graph W5 → W6 → W9 → W10 →
W11): it consumes the two event types already frozen in the contract since Wave 1 — `child.spawned`
and `child.finished` — and it is the answer to the biggest honest gap in the W9-era capability
comparison (no delegation/parallelism). **Parallelism designed, not assumed:** "Just start more
processes" is rejected — event-store write contention and resource contention are part of the design
(plan §10.2 W10). Deliver it, then STOP — no W11, no W12.

---

```
Role: Executing agent for ORION (@kernlbase/orion, repo v0/). State entering this wave:
  package 0.2.1 PUBLISHED and verified on npm. Commit 682b345 "Wave 9: MCP servers as W6
  resources, isolated and attributable" is HEAD; parent 0e42114 (config-search wiring).
  Suite 2017/0/46, contract v6/49 unchanged through W8 and W9 (0 new types in either wave).
  Working tree: nothing modified except untracked research/ + archify-out/ + research/corpus/
  (stay untracked) and the pre-existing test-snapshot JSON churn in v0/tests/results-*.json
  (do not commit; see METHOD 6).

  Hosted-model evidence already on the board (do NOT re-run it):
    - W1/W2/W3a/W4/W6 wave gates PASS on Hive zai-org/glm-5.3-flash (runs #12fa3b3b4b,
      #25da7711c5, #1d4f916cfa, #d135515a2c, #3a7e9fc6e2) — five hosted cloud-model gate
      completions through the INSTALLED cli. W7 passed earlier (#2866b8f4c7).
    - W9 MCP real-model gate: #952f3060c2 — a real hosted model autonomously chose mcp__demo__echo
      inside the container sandbox.
    - Recorded in research/productization/wave-gates-hive-rerun.md. Five Hive keys are in the
      local vault (~/.orion-keys); keys are NOT in the repo.
  Build infrostructure: w9-install dir holds a clean npm-packed install with MCP SDK; w8-install2
  is the W8-era build. Both under C:\Users\abhijith.p\AppData\Local\Temp\opencode\.

  Wave 9 shipped: MCP servers as W6 resources (resource identity, lifecycle events, single-flight
  connection per turn, session state as events not memory, --network none isolation, tool
  namespacing mcp__server__tool, result normalisation, denyTools applies to mcp__*, config
  "mcpServers" field, shipped tests + manual gate). Contract untouched at v6/49.

  Wave 6 shipped: ContainerSandbox (--network none, resource limits cpu/mem/pids, resource
  identity via resourceId() hash, lifecycle events, fail-closed, posture derived from isolation).
  LocalSandbox: path containment + symlink rejection + output bounds (NOT OS isolation).
  Posture: permissive/auto/strict as a floor; rules are union-only (can't widen); grants turn
  escalate into allow (never deny); protected-path escalation is not grant-overridable.

  Wave 2 shipped: planning as a fold over the log (plan.created/plan.revised/plan.step_started/
  plan.step_finished) — a plan survives SIGKILL and reconstructs identically under replay and
  fork, because nothing about it is held in worker memory. W10's child delegation must reuse this:
  a child is itself a plan-bearing run.

Read FIRST (source of truth, in order — all paths from repo root):
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md
     §1.2  (THE organising principle: every capability lands as attributable execution state.)
     §1.3  (Invariants 1-9, esp. 2 = deterministic replay at zero model cost, 6 = provenance,
           9 = additive contract.)
     §10.2 W10 (the authoritative scope below — the ONLY scope authority for this wave).
     §7    (what 10/10 means; the additive-contract rule; context-budget discipline)
     §11   (testing policy, incl. 11.2 manual gate — permanent; §11.4 honest-negative ledger)
     §13   (security roadmap: posture derived from capability only; NO autonomy by weakening
           policy; a child inherits a posture, it never widens it).
  research/productization/wave9-mcp-report.md — the MCP-as-W6-resources pattern this wave extends
     to children: identity, ownership/scope, lifecycle, resume/reattach, isolation, failure
     handling, and the §11.4 ledger format to inherit.
  research/productization/wave6-execution-environment-report.md — resource identity model
     (resourceId() derived, not random), container lifecycle, posture derivation.
  research/productization/wave2-planning-*-report.md (whichever exists) — the plan is a fold,
     delegation needs planning (W10 depends on W2 per the plan).
  research/productization/event-log-contract.md — v6/49 frozen set; child.spawned/child.finished
     are ALREADY MEMBERS (reserved since W1, never emitted). This wave emits them.
  research/productization/tool-contract.md — per-tool effect/recovery/path-addressed contract the
     new subagent tool must declare identically.
  research/productization/recovery-contract.md — recovery classes, SELF_VERIFYING/escalate
     discipline, fencing, leases. A killed child must recover (W10 acceptance #3).
  research/productization/current-product-surface.md — capability map and tool inventory to update.
  v0/src/core/event/index.mjs — the frozen vocabulary (lines ~93-101 hold the reserved child.*
     members' intent comment: subagents as child trajectories).
  v0/src/agent/loop/worker.mjs — the single worker loop, #buildMessages, repairOrphans, the
     lease/heartbeat path; the file a subagent executor plugs into.
  v0/src/agent/tools/index.mjs — composed tool list and authorization seam (denyTools patterns).
  v0/src/cli/index.mjs — run/resume/replay/fork verbs; where a subagent tool is surfaced.
  v0/tests/run-all.mjs + v0/tests/shipped/* — the runner and the shipped gate convention
     ("if a mechanism is not reachable from tests/shipped, it is not shipped").

THE PROBLEM (why this wave exists — plan §10.2 W10):
  The harness is single-worker: one model loop per run. Real tasks need delegation — a parent
  run hands a bounded sub-task to a child trajectory that has its own context window, its own
  plan, its own tool scope, and returns an attributable result. Naively "just starting more
  processes" would race the append-only event store (two workers writing one log), fight over
  the same container/scope resources, and produce parents whose verified work no one can attribute
  to a trajectory. The plan demands children be FIRST-CLASS TRAJECTORIES, parent/child lineage be
  provable, and parallelism be designed against store-wall and resource contention — not assumed.

  The commercial comparison this wave is answering: opencode/Google QM have subagents + parallel
  tasks; ORION currently has none. This is the single biggest functional hole between ORION and a
  full-fledged daily-use coding agent, and it is the one the reserved contract vocabulary already
  points at.

HARD SCOPE (deliver exactly this, nothing more):

  1. SUBAGENT TOOL (delegation entry point).
     - A new tool, `subagent` (name TBD at implementation; do NOT collide with plan.*/mcp__*),
       declared under the tool-contract discipline (idempotent where possible, recovery class,
       attribution).
     - Usage: parent model passes a bounded task string + optional context/scope hints + an
       explicit tool-scope allowlist for the child (default = read-only + verify; mutating tools
       must be explicitly granted by the parent).
     - The tool returns the child's terminal result + its run id + lineage summary, so the parent
       can fold the answer into its own message window (child turns are NOT auto-injected into the
       parent's log — they stay in the child's trajectory, referenced by id).

  2. CHILD TRAJECTORY LIFECYCLE.
     - `child.spawned` (parent_run, child_run, reason, scopes) emitted when the child is created.
     - The child is a REAL RUN in the same event store: its own run id, its own project/workspace
       scope, its own plan (W2 pattern), its own tool calls, its own token budget.
     - `child.finished` (child_run, status, result_ref, tokens) emitted when the child reaches a
       terminal state (completed/model_finished, completed/verify, or failed).
     - Cancellation: a parent can cancel a live child (map to the same lease/termination path W6
       uses for SIGKILL reaping); child emits resource.lost + child.finished(failed, cancelled).
     - NO new event types. child.spawned and child.finished already exist in the frozen v6 set.
       If the design truly needs another type, that is a v6 -> v7 additive contract change — justify
       it in the report as explicitly as W9 demanded of MCP types, and prefer NOT to do it.
     - The child's completion verdict (honest "did it actually do the thing" rule from W1/W4.5)
       applies inside the child exactly as in a top-level run.

  3. LINEAGE, IDENTITY, PROVENANCE.
     - Lineage is DERIVED from events (child.spawned's parent_run + child_run) — never a separate
       side-table. A `lineage` projection (core/projection/lineage.mjs) folds child.spawned +
       child.finished into parent/child graphs, mirroring how plan.mjs folds plan events.
     - Every child event carries: child id, parent run id, which POSTURE + sandbox capability the
       child ran under, which model + provider served it (model provenance — children may use a
       different model than the parent, explicitly recorded).
     - explain/replay/fork must handle children: replaying a parent replays the fold (children are
       referenced, not re-run); forking a parent re-spawns, does not mutate the historical child.

  4. RESOURCE SCOPE AND CONTENTION.
     - A child inherits the parent's resource scope (workspace, sandbox/container) but holds its
       own lease; two children or a child + parent CONCURRENTLY writing the SAME store is
       prevented by design — the event store's existing single-writer lease is the concurrency
       control (plan: "event-store write contention and resource contention are part of the
       design"). Children are serialised per-store or run through explicit quota slots.
     - Concurrency controls and quotas: at most N live children per run (config, default small),
       a per-child and per-parent aggregate token budget enforced at spawn and during the child's
       run, and a hard cap so parallel children cannot starve the parent or the store.
     - A child does NOT inherit the parent's grant/heartbeat; it starts cold in the parent's
       inherited posture floor, and can only ADD nothing — a child's rules are a subset (union-only
       rule discipline preserved: child rules cannot widen parent rules).

  5. RECOVERY — A KILLED CHILD RECOVERS (W10 acceptance #3).
     - Kill/takeover scenarios from the 8-point crash matrix apply to children: killed before
       significant work (restart cleanly), killed mid-effect (recover via the same tool-level
       recovery classes the parent uses: write has a sha256 witness, verify is atomic, etc.).
     - child.finished(failed) carries the honest reason; the parent sees a degraded-style notice
       and may re-spawn or fold the failure into its answer.
     - Resuming a parent with live children: either lease-reacquire of the child (if its run
       survived) or explicit child.finished(failed, lost) + re-spawn decision on the parent.

  6. TOOL SCOPE FOR CHILDREN.
     - subagent tool's scope allowlist is enforced by the EXISTING authorizer (denyTools /
       escalateTools / grants) — a child's tools are checked against the child's posture + the
       parent-granted subset. Advocating a YAML-only "child policy file" is rejected; the
       authorizer is the policy.
     - A child may itself spawn a grandchild (bounded by the same quotas), keeping the 
       derived-lineage projection compositional.

  7. SHIPPED TESTS AND MANUAL GATE.
     - New suites under v0/tests/subagent/ covering: spawn -> finish lifecycle, lineage fold,
       scope enforcement (child can't widen), cancellation, killed-child recovery, quota timeout/
       starvation, replay/fork behavior with children, POSTURE inheritance isolation.
     - shipped/w10-shipped.test.mjs: proves the CLI can drive a subagent through the composed
       tools (composition-root wiring — the failure class that has bitten six waves before this).
     - §11.2 manual gate: install the current tree (npm pack + clean prefix), run a REAL task
       that REQUIRES delegation through the CLI with a real hosted model (Hive key from the local
       vault; the wave-gates report shows the installed-build run pattern). The transcript must
       show: parent spawns child, child runs its own plan + tool calls, child finishes, parent
       folds the result and completes. Live-model, installed-build, attributable.
     - The gate proves: lineage attribution (parent can name its child), honest completion
       (parent's verdict reflects the child actually finishing its step), and recovery (kill the
       child process mid-run — child recovers or parent re-spawns with a clean ledger).

  NON-GOALS (repeat this aloud before starting):
     No W11 (memory/retrieval). No W12 (UX/SDK/API). No vector/store infrastructure. No autonomous
     model-selection policy — a child may use a different model, but only as explicitly supplied by
     the parent/config, recorded as provenance, never self-directed by the runtime. No new event
     types UNLESS a hard provenance requirement demands one (prefer the two reserved members).
     No weakening of the posture lattice; no rule-widening; no grant inheritance beyond the parent's
     floor. No "just more processes" parallelism without store/lease/contention controls. No LSP /
     IDE integration. Do not revert, restyle, or re-scope anything committed in W9 or W6.

  ACCEPTANCE:
     A developer configures nothing new, runs a task through the CLI that needs delegation, and:
     (1) the parent run emits child.spawned and the child's trajectory exists in the event store,
     (2) lineage (explain/parent run status) shows each child with its own run id, status, model,
         posture, and tokens,
     (3) a child under the default scope cannot invoke mutating tools without explicit grant,
     (4) two parallel children do not corrupt or block-write the store (leases/quota hold),
     (5) a child killed mid-run recovers or the parent re-spawns with a clean ledger and an honest
         reason in the log,
     (6) replay of the parent is zero-model-cost and references (does not re-execute) children,
     (7) forking a parent re-spawns children rather than mutating the historical log,
     (8) the §11.2 manual gate passes with a real hosted model through the installed binary.

  METHOD (the standing discipline; every numbered point is a hard requirement):

   1. Tests FIRST, in the existing runner. New suites live under v0/tests/subagent/. Additive-only:
      no existing test may be edited to pass (except: the results-*.json snapshot churn in
      v0/tests/ is suite OUTPUT, not source — do not stage it). New tools get a shipped/w10-shipped
      suite proving the CLI composes the subagent tool. Target: 2017 + new > 0, 0 failures,
      46 + new suites.

   2. Additive event contract. Prefer emitting child.spawned/child.finished (already in v6). If a
      change is genuinely required, it is v6 -> v7 additive-only; document the reason in the
      report with W9-grade justification. Replay equivalence and old-log replay must hold.

   3. The §11.2 manual gate: install the current tree (npm pack + clean prefix), run a REAL
      task requiring delegation through the CLI with a REAL hosted model (Hive vault key). Show
      the full transcript: parent spawns child, child's own plan + tools, child's terminal result,
      parent folding it, final completion; plus a kill-the-child recovery trace.

   4. Typecheck clean (tsc --noEmit), lint clean (node tests/lint.mjs if it runs). Suite runs on
      Windows via Git Bash — run node tests/run-all.mjs with the Git Bash bin FIRST on PATH so the
      shell preflight resolves bash to Git Bash, not WSL (this host:
      C:\Users\abhijith.p\AppData\Local\Programs\Git\bin). The container gate needs Docker
      Desktop's WSL2 engine (confirmed alive earlier this month).

   5. 0x08 scan: no process.exit in libraries, no accidental stdout from a lib path, no new
      dependency (this wave should need ZERO — subagents are the run store's own machinery), no
      plaintext secret in source/tests, no event exposing a secret to explain. Report the count.

   6. Update CLI help text and README where the subagent tool / child lifecycle is user-visible,
      and research/productization/current-product-surface.md rows (subagents, tools, capability
      map). Do not stage v0/tests/results-*.json.

  OUTPUT (the deliverable, in order):
     - One or more commits on HEAD describing the wave (stage only intended files; keep research/,
       archify-out/, research/corpus/, and the results-*.json snapshots untracked).
     - A report at research/productization/wave10-subagents-parallel-report.md in the wave-report
       house format: THE PROBLEM -> changes by file -> test evidence (the ACTUAL node
       tests/run-all.mjs TOTAL line) -> the manual-gate transcript (live-model, installed build,
       incl. the killed-child recovery) -> the 0x08 count line -> §11.4 (what was NOT exercised)
       -> verdict.
     - STOP. No W11, no W12.
```