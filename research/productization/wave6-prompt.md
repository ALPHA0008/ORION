# Session prompt — WAVE 6 "EXECUTION ENVIRONMENT + RESOURCE IDENTITY + RECOVERY 2.0"

Hand this to the executing agent (Claude). Hard scope, taken verbatim from the rebaselined
`MASTER-HARNESS-DEVELOPMENT-PLAN.md` (2026-09-07 edition), §10.2 W6, §9, §13, §11. W6 is the
merged wave: prior "resource identity + Recovery 2.0" + prior "sandbox maturity", because a sandbox
**is** the resource that must survive resume, and posture can only be *derived* where a boundary
exists. This wave gates W9 (MCP) and W10 (subagents). Then STOP — no W7.

---

```
Role: Executing agent for ORION (@kernlbase/orion, repo v0/). State entering this wave:
  package 0.2.1 PUBLISHED and verified on npm (0.1.2's false-success retired; the pre-W5 0.2.0
  was already on the registry, so the hardened build went out as 0.2.1). Commit c180f3e (W5),
  5528535 (release 0.2.1), 551885e (snapshot refresh). Suite 1024/0/31, contract v4/39.
  Working tree: nothing modified except untracked research/ + archify-out/ (stay untracked).
  This wave adds a REAL backend-pluggable sandbox boundary + per-run resource identity expressed
  as EVENTS (not columns), Recovery 2.0, capability-derived posture, network default-deny, and
  live execution output.

Read FIRST (source of truth, in order — all paths from repo root):
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md
     §9  (resource-identity rationale; §9.3 = the required EVENT vocabulary: resource.acquired /
         resource.reattached / resource.released / resource.lost, derived by a fold EXACTLY like
         plan.* — never a mutable snapshot column, state beside the log violates Invariant 1)
     §9.4 (Q4 gate, still blocking, verbatim)
     §10.2 W6 (the authoritative scope table A–L and internal milestone gating)
     §11   (testing policy, incl. 11.2 manual gate — permanent)
     §13   (security roadmap: "Path containment is not OS isolation"; autonomy is enabled by
         W6-G, NEVER by weakening authorization)
     §7    (what 10/10 means — the Security row's hostile-repo escape suite)
  research/productization/wave5-foundation-harding-report.md — what "shipped configuration" and
     the current boundaries now are (Store-only writes, async exec, migration runner, eval in CI).
  v0/src/core/recovery/index.mjs    — RecoveryClass, classifyShell, isKnownDangerous (preserve).
  v0/src/sandbox/local/index.mjs    — LocalSandbox: containment (NOT isolation), attachCheckpoints
      (shells to HOST git — this is exactly the filesystem-identity change Q4 worries about),
      scrubEnv, clamp, exec timeout, output bounds.
  v0/src/core/run/store.mjs         — the ONLY mutation path (W5 S1/S2). New resource events
      MUST flow through Store.append, not any new private path.
  v0/src/core/event/index.mjs       — contract v4/39, adaptive per §7/additive rules.
  v0/src/agent/loop/worker.mjs      — the tool-execution + fence seams; W5 made exec async and
      gave the tool path the lease heartbeat; this wave puts the boundary under it.
  v0/src/auth/default/index.mjs     — the posture seam (F1 command-keyed deny; W5 hardened).
  v0/src/cli/index.mjs              — composition root; a second impl must be selectable here,
      and every mechanism must be wired to the SHIPPED configuration, not a test-only branch.
  v0/tests/crash/matrix.test.mjs    — the 16-point crash matrix; W6 runs it UNDER the boundary.
  v0/tests/leaseheartbeat/leaseheartbeat.test.mjs — x2/x3/x4/x5 suites (async exec, heartbeat,
      awaited resume, timed-out routing, cancellation) — all must stay green under the boundary.

THE PROBLEM (why this wave exists — plan §9, §13, and the Q4 gate):
  The trajectory model is right; it has no isolation, no resource identity, and recovery reasons
  only about EFFECTS, not the resources those effects live on. Today: no isolation ⇒ no honest
  auto-allow ⇒ autonomy escalates every ordinary command; the sandbox is containment, documented
  as such; and if a run is killed and resumed, the sandbox is RECONSTRUCTED, silently — the world
  the recovery contract reasoned about may have changed. MCP (W9) and subagents (W10) are gated
  on fixing this. The plan's proof of the wave is one uninterrupted chain (its acceptance):

      real developer task
        → isolated resource
        → autonomous tool execution
        → resource identity recorded (as events)
        → SIGKILL
        → recovery
        → resource reattachment
        → continuation
        → correct result
        → replay at zero model calls

SCOPE — parts A–M from the plan, internally gated, NOT all at once. The plan's order:
  First milestone: A + C + D (contract + durable per-run identity + lifecycle events, additive
  contract) — builds on LocalSandbox with NO behaviour change.
  Second: B (the one real isolation backend) + E (per-run workspace boundary) + F (network
  default-deny) + D's container binding.
  Third: G + M + K (capability-derived posture ⇒ grant store ⇒ autonomous execution) + H + I + J
  (Recovery 2.0) + L (live output).
  << DO NOT ship G or K before B is real. M lands WITH G (remember an approval only once a
     posture exists to attach it to), and K never ships without M — autonomy whose approvals
     reset every turn is not autonomy (plan §10.2 W6, verbatim). Autonomy is enabled by the
     boundary + remembered approvals, never by relaxing authorization (plan §13). >>

  A  Extract a SandboxBackend contract from LocalSandbox WITHOUT breaking it. LocalSandbox stays
     impl #1, still honestly documented as containment. The contract must cover what both impls
     share: read/write/exists/list/grep/exec, path containment via _abs, bounded output, env
     scrubbing, exec timeout (async since W5), shell selection, checkpoint attach.
  B  ONE real isolation backend (container): --network none by default, cpu/memory limits.
     Linux via docker or podman only. If no container runtime is present, the LIVE container
     matrix is SKIPPED with an explicit "SKIPPED — no container runtime" marker, and a
     non-live structural test still asserts the interface contract + posture derivation, so the
     wave stays provable in this environment. This is a REAL boundary when it runs — not cosmetic.
  C  Per-run resource identity: a durable, stable id for the sandbox/workspace, recorded as
     events (not a column).
  D  Resource lifecycle AS EVENTS (plan §9.3, verbatim): resource.acquired / resource.reattached /
     resource.released / resource.lost, current binding derived by a fold over the log, exactly
     as plan.* works. Reuse existing where semantics fit (e.g. run.parked stays the terminal
     "stopped, not finished" state); only add what this wave genuinely needs. Additive contract
     only; document each new type and why.
  E  Per-run workspace boundary (the workspace IS the resource; hostile-repo suite proves the
     workspace cannot reach the host filesystem or network).
  F  Network policy: default-deny egress; at minimum block link-local and cloud-metadata
     (QM's BlockList shape). No ambient network.
  G  Capability-derived posture: isolated ⇒ auto-allow; not isolated ⇒ escalate. Posture is a
     CONSEQUENCE of the backend's declared capability, driven by the backend → posture
     dependency, not a guess. Operator override stays possible.
  H  Resource persistence + fencing interaction: a resource binding survives restart and a
     reclaimed run is fenced (no resurrection, extending W5 X2's proving).
  I  Recovery 2.0: resume REATTACHES by identity; recreate-with-notice when identity is lost
     (and the log SAYS "reconstructed", never silently pretending); escalate on unknown. Keep
     the ADR-011 witness branch intact. Do NOT grow recovery beyond what the matrix proves.
  J  Crash/restart survival of resource bindings: the crash matrix under the boundary is the
     acceptance test of this wave.
K  Autonomous execution ENABLED by G — enabled by the boundary, never by relaxing
      authorization. Ships WITH M; see below.
   L  Live execution output: committed, incremental deltas the CLI can show — reuse the W4
     stream transport if it fits; do not fake a terminal render. No contract change if avoidable.
   M  GRANT STORE — approval memory (plan §10.2 W6-M, REQUIRED not optional). A durable,
      attributable record of approvals remembered per SESSION, PROJECT, COMMAND-PATTERN, and
      RESOURCE: "npm test" approved once, not once per turn. Persisted THROUGH the Store
      (the only mutation path — W5 S1/S2), scoped by project/pattern, resource-scoped where the
      grant concerns a resource. Every grant is an EVENT in the trajectory (additive contract).
      Maps to the posture model: G says whether an action CAN be auto-allowed; M is what makes
      auto-allow SURVIVABLE across turns and runs. This is what makes the isolated backend's
      auto-allow a usable default instead of a footgun, and it is the "approvals remembered"
      half of the W6 autonomy story the rebaselined plan's "approval semantics" (§13) names.
      Wired to the SHIPPED configuration at the real CLI — a grant store that grants nothing
      or is unreachable from the shipped posture path is the failure class this project has
      repeated six times in four waves.

THE Q4 GATE (plan §9.4 — still blocking, unchanged, do not weaken it):
  "Does a container backend actually enable auto-allow WITHOUT breaking the recovery contract?"
  The pre-state witness, attachCheckpoints (which shells to HOST git), and the crash matrix are
  all computed against the current filesystem identity. A container changes that identity. If it
  cannot be reconciled, W6 STOPS AND REPORTS rather than shipping a boundary that silently
  invalidates recovery. When attachCheckpoints shells to host git, the container must make the
  git shadow the worker sees resolve under the CONTAINER-visible path — fix at the right layer;
  never fake the checkpoints.

CONTRACT RULES:
  - Additive ONLY. Contract is v4/39; resource lifecycle events are NEW types. Bump the version
    per the existing scheme (§7/additive), document each new type and why. Never rename/delete/
    retype existing types. Old logs replay (per-wave invariant §11.3).
  - The event log and closed additive vocabulary · recovery contract + ADR-011 witness · zero
    production dependencies beyond the container CLI (docker/podman) · honest sandbox docs ·
    replay structural zero-model-call property · `explain` · the runtime ≠ evaluation boundary —
    ALL explicitly preserved.
  - Every NEW event write goes through Store.append (W5 S1/S2) — there is no second path.
  - LocalSandbox impl #1 is unchanged in behaviour; extraction is structural, proven by the same
    suite green (1024/0/31 baseline before, higher after).
  - Product name ORION. research/ + archify-out/ stay untracked / out of package commits.

BOUNDARIES (hard stops):
  - NO MCP (W9), NO skills or project instructions (W7), NO subagents (W10), NO memory (W11),
    NO search/glob/git/config/rule-file (W8), NO orchestration/team (W14).
  - Container backend is minimal and Linux/docker-or-podman only. No full isolation platform.
    On this device (Windows), the live container matrix will almost certainly SKIP; the
    structural + posture-derivation + hostile-repo LOCAL tests still must land and the report
    must state what was and was not exercised (§11.4).
  - Network policy: per-domain, default deny, no ambient network. The grant store (M) decides
    which per-domain/per-command approvals are remembered — it is NOT a tool that grants nothing.
  - Do NOT run npm publish in this session (0.2.1 is live; any release decision is separate).
  - No feature beyond parts A–M. Wire EVERY mechanism to the shipped configuration — a mechanism
    that grants/is no-ops/unwired in the real CLI is the exact failure class this project has
    repeated six times in four waves.

QUALITY / TEST RULES:
  - Full suite green with Git Bash first on PATH: node v0/tests/run-all.mjs → record before
    (1024/0/31) and after. Suite count WILL rise (resource-lifecycle events, posture derivation,
    container-interface structural, hostile-repo escape).
  - New tests in the right class: mechanism tests where a mechanism is proven; tests/shipped/
    where the WIRING is proven. Add shipped-config tests for: default posture follows backend
    capability at the real CLI entry; a killed run's resume REATTACHES by id — or says
    "reconstructed" — in the event log; resource bindings survive a restart; hostile repo cannot
    reach host FS/network from the real CLI under the isolated backend; live output appears
    incrementally; **an approved-but-not-yet-granted command re-prompts exactly once and a
    GRANTED command does not re-prompt across turns — proven at the real CLI against the shipped
    posture, not a test-only branch**.
  - Crash matrix UNDER the boundary = the wave's acceptance test. Summarize per-case in the
    report with an "identical decisions?" column vs LocalSandbox baseline.
  - Respect the standing §11.2 manual gate: a real installed build, real model, real task,
    SIGKILL + reap + resume, assert no duplicated effect, verify the FILE and TEST result on
    disk. Never self-report. If the container backend cannot run here, run the manual gate on
    LocalSandbox and say so.
  - Stray 0x08 scan: byte-scan every changed/untracked file for 0x08 before declaring done;
    report the count per file. (It has hidden a redaction bug and a wiring gap before.)

REPORT:
  Write research/productization/wave6-execution-environment-report.md: per part (A–M) what was
  implemented, the root choices (contract shape, identity model, grant-store scoping, recovery
  change), the container crash-matrix table (16 rows × [Local | Container | identical?] + SKIP
  markers), the posture-derivation, network-policy and grant-store wiring table, the new event
  types (name + why), suite before/after, contract version v4 → v?, replay equivalence re-proven,
  what was NOT exercised (§11.4), and the Q4 verdict (PASS / STOP-AND-REPORT). Then STOP. No W7.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **This is the same merged wave you approved before the rebaseline; it is now W6.** The
  rebaselined plan absorbed the old "resource identity + recovery 2.0" wave and the old "sandbox
  maturity" wave into W6 because §9 proves they are one thing: a sandbox *is* the resource that
  must survive resume, and posture can only be derived where a boundary exists.
- **Two things changed in the rebaseline were corrected by the 2026-09-08 amendment**
  1. **The grant store is REINSTATED (W6-M, required — plan §10.2, §8, §13, §19 amended).** The
     rebaselined plan had silently dropped it (only "approval semantics" survived, unassigned);
     the amendment restores it as a first-class security/autonomy subsystem and the prompt now
     carries it as Part M with an explicit shipped-wiring test, because the old draft's Part C
     grant store was real capability and "nothing was stripped" had to be literally true again.
  2. **Resource lifecycle is events, not a table.** The plan explicitly rejects TrueForge's
     mutable `TurnRecord.snapshot` shape (it violates Invariant 1 / replay determinism) and
     demands `resource.acquired/reattached/released/lost` derived by a fold. That's more work and
     it is the correct call — it's what keeps replay honest. The prompt enforces it.
- **Milestone gating written in, not optional:** the plan is explicit — "do not ship G/K before
  B is real", "M lands with G", and "K never ships without M". Without that, an agent might ship
  "posture derived from a backend that doesn't exist", or autonomy whose approvals reset every
  turn — exactly the un-wired-mechanism failure class the project keeps hitting. First milestone
  should be contract + identity + lifecycle events on LocalSandbox — that alone is testable and
  additive.
- **The container reality on THIS device:** Windows, likely no docker/podman. That's why the
  prompt keeps the honest SKIP path (structural + posture + hostile-repo LOCAL tests still land;
  report states what wasn't exercised; Q4 says SKIPPED-not-PASSED). Do not let anyone fabricate a
  Q4 PASS without a runtime.
- After this returns I verify against the tree the same way (measure, don't trust): suite count,
  shipped-wiring tests, hostile-repo escape, resource events in the log, replay equivalence,
  contract version bump documented, 0x08 scan. Then the next user-visible decision point: W7
  (skills — parallel-safe, low risk) vs W9-MCP ordering as the plan intends (W6 → W9).