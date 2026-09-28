# Session prompt — ORION Production Readiness + Competitive Harness Audit

Hand this to the executing agent (Claude). This is an AUDIT / RESEARCH / DESIGN-ONLY task. It produces
`research/productization/ORION-PRODUCTION-COMPETITIVE-AUDIT.md`. NO product code changes. Wave 4 is
already implemented and committed (1be187a, c8b106f) — treat it as done and OUT OF SCOPE unless you
find a correctness/security blocker severe enough to escalate. Do NOT modify the runtime.

---

```
Role: Execute a comprehensive production-engineering + competitive audit of ORION
(@kernlbase/orion, repo at D:\Abhijith P\Desktop\harness). This is an AUDIT/RESEARCH/DESIGN task, NOT
implementation. Produce ONE serious engineering report at
research/productization/ORION-PRODUCTION-COMPETITIVE-AUDIT.md following the structure below. Do NOT
modify v0/src, do NOT change package versions, do NOT publish, do NOT rewrite the runtime, do NOT
migrate JS→TS, do NOT alter the event contract, do NOT create speculative features.

Wave 4 is DONE (commits 1be187a, c8b106f). Treat it as in scope only if you find a correctness/security
blocker; otherwise describe it as the current state. Do not disrupt or rewrite it.

CONTEXT (verified facts to start from, still verify everything yourself against source):
  - Waves 1-4 committed: 00b68a6 (W1 truthful completion), 9de5324 (W2 planning+verification),
    0baf4b4 (W3 context+artifacts), 1be187a + c8b106f (W4 providers+streaming+provenance).
  - Suite: 904 passed / 0 failed / 30 suites (verify). Event contract v4, 39 types, additive.
  - Package: @kernlbase/orion@0.1.2, zero dependencies, engines node >=22, bin orionctl.
  - v0/src is 22 .mjs modules, ~4,741 LOC. No CI in repo root memory is wrong — .github/workflows/ci.yml
    EXISTS and is tracked (4 cells green as of run 33958602579).
  - Read FIRST, in order: research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md,
    wave1-report.md, wave2-report.md (and wave2-final-report.md is old packaging history — ignore its
    numbering), wave3-report.md, wave4-report.md, wave4-plan.md, future-queue.md, and the corpus under
    research/corpus/ (the six-repo prior-art audit).

──────────────────────────────────────────────────────────────
THE REPORT — research/productization/ORION-PRODUCTION-COMPETITIVE-AUDIT.md

Structure (numbered sections exactly as below):

1. Executive verdict
2. Current maturity level (use the §10 maturity model: L0 prototype → L5 scalable hosted)
3. Production-readiness assessment
4. Competitive capability matrix (vs Claude Code, Codex/Codex CLI, OpenCode, TrueForge, Deep Agents,
   Hermes Agent, OpenHarness, Ruflo, and the existing six-repo corpus)
5. Developer usability assessment
6. Context maturity assessment
7. Artifact architecture assessment
8. Planning + verification assessment (separate RUNTIME guarantees from MODEL behavior)
9. Runtime reliability assessment (crash/partial-write/idempotency/fencing/lease/replay/fork/resume)
10. Security assessment (containment vs TRUE isolation; be explicit; the sandbox is path-containment
    + symlink-escape + bounded output, NOT OS isolation — verify this from
    v0/src/sandbox/local/index.mjs)
11. Concurrency / load assessment (use the §11 growth model; identify first bottlenecks)
12. JS/TS/Python architecture assessment (recommendation from the fixed five: stay JS / gradual TS /
    justified migration / justified Python subsystem; no aesthetic rewrite)
13. Testing maturity
14. Critical architectural risks
15. Standard capability gaps (rank: critical / important / useful / differentiator / nice-to-have /
    not-worth-it)
16. ORION differentiators (durable trajectories, append-only events, effect-aware recovery, fencing,
    deterministic zero-model-call replay, fork/lineage, durable pause, provenance, truthful completion,
    versioned event contract, trajectory-derived projections — assess EACH: genuinely valuable to a
    developer? give a concrete workflow where it matters, or say it is technically impressive but not
    developer-useful)
17. Recommended target architecture
18. Recommended capability sequence
19. Things we should explicitly NOT build
20. Evidence and references
21. Open questions requiring experiments

PROCESS REQUIREMENTS:

- RECONCILE roadmap vs implementation vs tests vs CLI vs package vs docs. For every important
  capability classify it as one of: IMPLEMENTED AND VERIFIED / IMPLEMENTED BUT WEAK / IMPLEMENTED BUT
  UNWIRED / PARTIAL / ARCHITECTURALLY SOUND BUT IMMATURE / MISSING / UNSAFE / UNKNOWN-NOT-YET-MEASURED.
  Do NOT mark anything production-ready merely because tests exist.

- VERIFY THE TREE YOURSELF. Reproduce the suite (Git Bash first on PATH → node v0/tests/run-all.mjs).
  Inspect v0/src for the concurrency model, sandbox posture, context/compaction, artifacts, plans,
  recovery, and the CLI. Run the CLI (orionctl --help, doctor, a real run if a model is reachable).
  Note the "model: not configured / No model endpoint set" onboarding path as a product question.

- COMPETITOR RESEARCH: use current official docs/repos for Claude Code, Codex/Codex CLI, OpenCode,
  TrueForge, Deep Agents (deepagents), Hermes Agent, OpenHarness, Ruflo, plus the six-repo corpus under
  research/corpus/. Compare CAPABILITIES, not feature names. For each major capability: does ORION have
  it? usable? production-quality? competitive? placeholder? better foundation? needed for adoption?
  Audit at minimum: agent loop, planning, replanning, verification, retries, termination, context mgmt,
  compaction, artifacts, memory, sessions, turns, subagents, skills, MCP, web access, filesystem tools,
  glob/search, git integration, LSP/code intelligence, approvals, permissions, sandboxing, provider
  support, streaming, model switching, structured tool calls, tool error recovery, background execution,
  parallel work, interactive TUI, non-interactive CLI, configuration, project instructions,
  extensibility, SDK, API/server mode, observability, logging, cost/token tracking, sharing/export,
  resumability.

- EXPERIMENTS (design + RUN where cheap): context degradation over long runs (20/50/100 turns),
  compaction firing, large tool output, event-log/artifact growth, concurrent workers / lease
  contention, replay determinism, a 6-month-old-log upgrade scenario (contract evolution). Where you
  cannot run something, design it and mark UNKNOWN/NOT-YET-MEASURED with an experiment recipe.

- CONTEXT ENGINEERING ≠ COMPACTION: audit token budgeting, truncation, trigger, strategy, long-horizon
  degradation, summarization, artifact offloading, retrieval, provenance preservation, continuation
  semantics, information loss, priority ordering, important-file retention, verification-evidence
  retention, replay equivalence, crash/resume/fork behavior, context determinism. Measure what degrades.

- EVERY important conclusion must cite evidence from ORION source/tests/runtime, competitor
  source/docs, or a measured experiment. LABEL INFERENCE clearly. Do not manufacture evidence.
  Where you rely on my provided verified facts, re-verify and cite the source line where possible.

- The "Git for coding harnesses" / team-learning idea (Wave 11) is the long-term north star. Assess
  whether current waves keep it physically reachable (per-member attributable provenance). Do NOT build
  it now.

- The audit staple question to answer explicitly: can an ORION run created 6 months ago still be
  resumed after several releases? (contract is additive v1→v4; assess upgrade/replay across versions.)

- SECTION 17 (target architecture): design for the correctness/security/scale concerns you find, NOT
  feature accretion. Use the §10 maturity model (define what production-ready MEANS per level:
  reliability, security, concurrency, observability, durability, deployment, testing, performance, API
  stability, ops). Classify ORION honestly (my strong prior: currently L1-2, substrate sound, standard
  capabilities largely Waves 6-10).

- END SECTION 1 and the report with the explicit final question answered plainly:
  "If we continue building ORION according to the current architecture, can this realistically become a
  serious developer-facing coding harness providing the standard functionality people expect from
  Claude Code/Codex/OpenCode while retaining genuinely differentiated durable execution infrastructure?"
  Answer: YES / YES,BUT / NO. Then explain exactly why. Do not be diplomatic.

──────────────────────────────────────────────────────────────
CONSTRAINTS
  - NO changes to v0/src, package.json, event contract, CI, or docs that describe shipped behavior
    EXCEPT the single new report file. Do not "fix" things found by the audit in this session.
  - research/ is untracked productization material — the report lives there and is never a package commit.
  - Use the standing §8 manual-testing gate philosophy in evidence-gathering, but you are auditing, not
    building new features.
  - Product name ORION.

OUTPUT: the single file research/productization/ORION-PRODUCTION-COMPETITIVE-AUDIT.md. Tell me the
file was written, its length, and a 10-line summary of the executive verdict + your blunt YES/YES,BUT/NO
answer. Then STOP. No code changes. No next wave started.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- The prompt codifies the audit brief you pasted, adds guardrails (no code changes, treat Wave 4 as done
  unless a blocker, verify-the-tree-yourself, competitor research, context-engineering≠compaction,
  evidence-citation, the 6-month-replay question), and hard-stops after producing the one report file.
- I pre-seeded verified facts (Wave commits, 904/30, contract v4/39, 22 modules / ~4,741 LOC, CI exists)
  so it doesn't re-derive ground truth from scratch — but the prompt still requires it to verify.
- The one thing I flagged for it to resolve honestly: whether "Provider B" in Wave 4's manual protocol
  was a live Anthropic call or OpenAI-compat (qwen/Ollama). The audit should note this evidence caveat.
- After it returns, read the report, then we (a) reconcile it against the tree if needed, and (b) decide
  whether to resume the wave sequence (Wave 5 = resource identity + recovery 2.0, the critical path to MCP)
  with the audit's findings folded in.
