# Session prompt — WAVE 9 "MCP + EXTERNAL RESOURCES"

Hand this to the executing agent (Claude). Hard scope, taken verbatim from the rebaselined
`MASTER-HARNESS-DEVELOPMENT-PLAN.md` (2026-09-07 edition, amended 2026-09-08), §10.2 W9, §1.2,
§7, §11, §13 (security roadmap). W9 is **promoted** in the rebaseline: MCP has moved behind W6
(sandbox isolation + resource identity) rather than in front of it. This is the first wave that
**justifies a dependency** (`@modelcontextprotocol/sdk`): a MCP server is third-party code with
network access invoked by a model, and every session must be attributable, resumable, and isolated.
Deliver it, then STOP — no W10, no W11.

---

```
Role: Executing agent for ORION (@kernlbase/orion, repo v0/). State entering this wave:
  package 0.2.1 PUBLISHED and verified on npm. Commit 0e42114 (config-search wiring) is HEAD;
  parent 1b55c0a "provider-shims: preserve vendor extras and reasoning on the STREAMED
  tool-call path". Suite 1777/0/43, contract v6/49.
  The working tree ALSO carries two PRE-APPROVED, PRE-VERIFIED, UNCOMMITTED shims (added outside
  this wave): v0/src/agent/model/shims/reasoning-as-content.mjs (gpt-oss-120b remaps
  ext.reasoning -> content) and vendor-extra preservation in v0/src/agent/model/index.mjs
  normalise() + outbound reconstruction in v0/src/agent/loop/worker.mjs #buildMessages (Gemini
  thought_signature round-trips). Do NOT revert, restyle, or re-scope those edits. They are not
  yours. If W9 touches either file, preserve its behaviour.
  Working tree: nothing else modified except untracked research/ + archify-out/ (stay untracked).

  Wave 6 shipped: ContainerSandbox (--network none, resource limits, resource identity via
  resourceId() hash, lifecycle events). Fail-closed when Docker/podman absent. Posture derived
  from isolation: isolated -> permissive, not isolated -> auto. Two safety asymmetries: a grant
  turns escalate into allow (never deny); protected-path escalation is not grant-overridable.
  Network policy: default-deny, --network none, hard-block on link-local/cloud-metadata/host
  loopback. Per-domain egress allowlist: NOT ENFORCED, now refused.

  Wave 8 shipped: search (glob + regex grep with layered budgets), git read-only navigation,
  config file (.orion.json layered under env), permission rules (.orion-rules.json), first-run
  flow, config search overrides now wired into composed tools.

  Wave 6.1 live proofs: resource limits BIND, network policy LIVE, container survive SIGKILL
  with reattach-by-identity, posture followed the boundary (not a flag) in a real gate.

  Docker Desktop WSL2 confirmed alive: `docker run --rm --network none node:20-slim echo hello`
  succeeds. Container isolation is now testable on this host.

Read FIRST (source of truth, in order — all paths from repo root):
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md
     §1.2  (THE organising principle: every capability lands as attributable execution state.)
     §1.3  (Invariants 1-9, esp. 2 = deterministic replay at zero model cost, 6 = provenance,
          9 = additive contract.)
     §10.2 W9 (the authoritative scope below: "an MCP server is third-party code with network
          access invoked by a model").
     §7    (what 10/10 means; the additive-contract rule; context-budget discipline)
     §11   (testing policy, incl. 11.2 manual gate — permanent)
     §13   (security roadmap: path containment is not OS isolation; policy maintained, not weakened)
  research/productization/wave6-execution-environment-report.md — the sandbox container mechanism,
     resource identity model (resourceId() is derived, not random), --network none, lifecycle
     events, posture derivation, and the ContainerSandbox vs LocalSandbox boundary.
  research/productization/wave6.1-live-proofs-report.md — the live proof that resource limits
     BIND (cgroup), network policy is LIVE (--network none blocks egress), and container survive
     SIGKILL with reattach-by-identity.
  research/productization/wave8-search-git-config-report.md — the §11.4 ledger format this wave
     inherits, the live-model gate evidence, and the config/rules layer.
  research/productization/tool-contract.md — the per-tool contract (effects, recovery, path-
     addressed). New MCP tools must declare the same.
  research/productization/event-log-contract.md — 31 types (v4), additive-only. W6 moved to
     v5/46 (resource.acquired, resource.reattached, resource.released, resource.lost, grant.*
     tool.output_delta). W9 adds MCP-specific types. Frozen set — additions must be justified.
  v0/src/agent/model/index.mjs — createOpenAICompatModel, the provider normalisation edge.
     Shims apply to normalised results, never raw wire data.
  v0/src/agent/loop/worker.mjs — #buildMessages (how tool results are reconstructed), repairOrphans
     (every assistant tool_call needs a tool reply).
  v0/src/auth/default/index.mjs — createAuthorizer (denyTools, escalateTools, denyCommandPatterns,
     protectedPaths, budgetLimits, grants). MCP calls must go through authorization.
  v0/src/sandbox/local/index.mjs — LocalSandbox path containment, search budgets, the honesty
     contract. ContainerSandbox is the sibling.
  v0/src/cli/index.mjs — run (435), buildModel (153), prepareRun (362), buildMessage loop,
     where MCP servers would be discovered and connected.
  research/productization/current-product-surface.md — the capability map and tool inventory.
  research/productization/future-queue.md — Q-numbered research items stay in the queue (do NOT
     pull them into this wave).
  research/productization/provider-contract.md — normalised response shape, shim discipline,
     ModelError classification. MCP results must normalise identically.

THE PROBLEM (why this wave exists — plan §10.2 W9):
  MCP servers are third-party code that the model invokes via tool calls. Without proper design,
  a model would call a function that reaches an uncontrolled network endpoint with no isolation,
  no attribution, no lifecycle tracking, and no resume safety. The plan demands: "every MCP
  session must have identity, provenance, ownership/scope, lifecycle, resume/reattach where the
  server supports it, authorization, isolation, failure handling." MCP servers run inside the W6
  sandbox (isolated containers with --network none). This wave delivers the mechanism, not the
  ecosystem.

HARD SCOPE (deliver exactly this, nothing more):

  1. MCP SERVER LIFECYCLE AS W6 RESOURCES.
     MCP servers are W6 resources with:
     - identity (resourceId() derived, not random — same pattern as container sandboxes)
     - ownership/scope (project-level, per-run)
     - lifecycle events: resource.acquired, resource.reattached, resource.released, resource.lost
     - the --network none isolation applies: MCP servers run inside the container sandbox,
       cannot reach the host or external network
     - resource limits: --cpus, --memory, --pids-limit applied to MCP server processes
     - failure handling: server crash -> resource.lost -> restart/re-reattach if recoverable

  2. MCP SESSION MANAGEMENT.
     - Single-flight connection creation per turn (TrueForge's getOrCreateToolSource pattern):
       the first tool call that needs an MCP server connects; subsequent calls in the same turn
       reuse the connection
     - Session state lives as resource events, never in memory only (plan constraint)
     - Resume/reattach via resource IDs: when the run resumes after a crash, the MCP session
       is either still running (reattach) or lost (recreate with notice)
     - Graceful shutdown: resource.released on normal run completion

  3. TOOL NAMESPACING.
     MCP tool names are prefixed: mcp__server__tool (e.g. mcp__github__get_issue).
     - The model sees MCP tools alongside built-in tools in its tool schema
     - Tool calls routed to MCP servers are attributed in the trajectory
     - The Open heuristic: mcp__ results are always compaction-eligible (plan §10.2)
     - Tool.requested / tool.authorized / tool.started / tool.succeeded / tool.failed events
       carry the mcp__ prefix so the trajectory is attributable
     - Authorization: MCP tool calls go through the authorizer (denyTools, escalateTools apply;
       MCP servers cannot bypass the permission lattice)

  4. TOOL DISCOVERY AND SCHEMA EXTENSION.
     - MCP servers advertise their tools via the MCP protocol (tools/list)
     - The runtime collects advertised tools and extends the model's available tool schema
     - Tool schema for MCP tools: name (mcp__server__tool), description, inputSchema (JSON
       Schema from the MCP server's tool advertisement)
     - A server that advertises no tools is still connected (it may provide resources/prompts)
     - A server that fails to advertise is recorded as degraded (server_error), not fatal

  5. MCP RESULT NORMALISATION.
     MCP tool results are normalised to match the existing tool.succeeded shape:
     - content: the MCP result (string or structured content)
     - the runtime stores the MCP result as-is in tool.succeeded, attributing it to the MCP server
     - MCP errors (tool execution failure) are normalised to tool.failed with the MCP error
       classification
     - MCP results are NEVER injected directly into the event log — they are wrapped in
       tool.succeeded/failed with provenance metadata (server, tool name, session ID)
     - The ext field carries mcp-specific metadata (server identity, session ID, tool name)

  6. FAILURE HANDLING.
     - Server crash during tool call: tool.failed with kind: server_error; resource.lost event
     - Server timeout: tool.timed_out; resource.released if recoverable
     - Server unreachable at connection time: tool.failed with kind: server_error; degraded event
     - Server advertises tools with invalid schema: degraded event, tool excluded from schema
     - Server network blocked (expected with --network none): connection attempt fails; degraded
       event; tool excluded; the run continues with built-in tools only

  7. AUTHORIZATION AND PROVENANCE.
     - Every MCP call is attributable: tool.requested carries server name + tool name
     - The authorizer may deny MCP tools (denyTools may include mcp__* patterns)
     - Protected-path escalation applies to MCP tool calls (a server cannot write to a protected
       path without explicit approval)
     - Grant matching: a grant for "mcp__github__get_issue" is a normalised exact match, never
       a glob
     - The trajectory records which MCP server produced each result (tool.succeeded.ext.mcp)

  8. COMPATIBILITY AND PROVENANCE.
     - The tool schema available to the model includes both built-in tools AND MCP-advertised
       tools in a single array
     - The model cannot distinguish between a built-in tool and an MCP tool at the schema level
     - The RUNTIME distinguishes via the mcp__ prefix in the tool name
     - Built-in tools take priority over MCP tools with the same name (no collision in practice
       because built-in tools lack the mcp__ prefix)

  9. ORION CONFIGURATION FOR MCP SERVERS.
     MCP servers are declared in the configuration layer (under env vars):
     - .orion.json gains an "mcpServers" field: { "name": { "command": "...", "args": [...],
       "env": { ... }, "cwd": "...", "timeoutMs": 120000 } }
     - The config file layer applies: env vars win, .orion.json is the default, ~/.orion/config.json
       is the global fallback
     - An "mcpServers" field in a user-level config is a user preference; in a project config it
       is a project requirement
     - Invalid mcpServers config: clear error, exit non-zero
     - Servers declared in the config are auto-connected on run start; servers declared at runtime
       (future) are opt-in

  10. SHIPPED TESTS AND MANUAL GATE.
      - New test suite: v0/tests/mcp/ covering lifecycle, isolation, tool namespacing, resume,
        authorization, failure modes
      - shipped/w9-shipped.test.mjs: proves the CLI composes MCP servers from config
      - The §11.2 manual gate: install the current tree (npm pack + clean prefix), run a REAL
        task using an MCP server through the CLI with a real model. The MCP server must be
        connected inside the container sandbox (--network none) and the tool call must succeed.
        Use a simple MCP server (e.g. the official @modelcontextprotocol/server-everything or
        a minimal custom server that echoes/provides a resource) for the gate, not a production
        service. Show the full transcript: server connected, tools discovered, tool called, result
        returned, resource released on completion.
      - The gate proves: MCP session lifecycle (acquire -> use -> release), tool namespacing
        (mcp__server__tool), authorization (denyTools may apply), container isolation
        (--network none), and provenance attribution in the trajectory.

  NON-GOALS (repeat this aloud before starting):
     No W10 (subagents). No W11 (memory). No W12 (UX). No MCP client library — the harness IS
     the MCP client. No MCP server (the harness invokes external servers, it does not host one).
     No LSP / IDE integration. No new event types unless a lifecycle/provenance requirement
     actually demands one — and then ONLY additively (contract v6 -> v7, never a mutation). No
     weakening of the posture lattice. No per-domain egress allowlist (W6.1 noted this is not
     enforced). No interactive wizards. Do not touch the two pre-approved shims.

  ACCEPTANCE:
     A developer configures an MCP server in .orion.json, runs a task through the CLI, and sees:
     (1) the MCP server connected inside the container sandbox (--network none),
     (2) tools advertised by the server appear in the model's tool schema,
     (3) a tool call to an MCP tool succeeds with attributed results,
     (4) the trajectory (explain --full) shows provenance (server name, tool name, session ID),
     (5) the MCP session lifecycle events are in the event log (resource.acquired, resource.released),
     (6) denying an MCP tool via denyTools prevents the call,
     (7) the MCP server process is isolated (cannot reach the host or external network),
     (8) on run completion or crash, the MCP session is properly released/recreated.

  METHOD (the standing discipline; every numbered point is a hard requirement):

   1. Tests FIRST, in the existing runner. New suites live under v0/tests/mcp/. Additive-only:
      no existing test may be edited to pass. New tools get a shipped/w9-shipped suite proving
      the CLI composes MCP servers (the failure class this project has repeated across seven
      waves is composition-root wiring — prove it here). The suite target is 1777 + new > 0,
      0 failures, 43 + new suites.

   2. Additive event contract. New event types only if required, only appended, version header
      updated (document why). Replay equivalence and old-log replay must hold.

   3. The §11.2 manual gate: install the current tree (npm pack + clean prefix), run a REAL
      task using an MCP server through the CLI with a real model. The MCP server must be
      connected inside the container sandbox (--network none) and the tool call must succeed.
      Use a simple MCP server for the gate. Show the full transcript.

   4. Typecheck clean (tsc --noEmit), lint clean (node tests/lint.mjs if exists). Suite runs on
      Windows via Git Bash — run node tests/run-all.mjs with Git Bash's bin/ FIRST on PATH so
      the shell preflight resolves bash to Git Bash, not WSL (this host:
      C:\Users\abhijith.p\AppData\Local\Programs\Git\bin).

   5. 0x08 scan: no calls to process.exit in libraries, no accidental prints to stdout from a
      lib path, no new dependency (except @modelcontextprotocol/sdk, documented as the first
      justified dependency), no plaintext secret in source or tests, no event written with a
      secret visible to explain. Report the count explicitly.

   6. Update CLI help text (cli/index.mjs ~903) and README config sections to cover MCP
      server configuration (the mcpServers field). Update
      research/productization/current-product-surface.md rows for MCP and the tool inventory.

  OUTPUT (the deliverable, in order):
     - One or more commits on HEAD describing the wave (stage only intended files; keep research/
       and archify-out/ untracked; the two pre-approved shim edits are NOT yours to commit).
     - A report at research/productization/wave9-mcp-report.md in the wave-report house format
       used by wave8: THE PROBLEM -> changes by file -> test evidence (the ACTUAL
       node tests/run-all.mjs TOTAL line) -> the manual-gate transcript -> an explicit 0x08
       count line -> §11.4 (what was NOT exercised) -> verdict.
     - STOP. No W10, no W11.
```
