# Session prompt — WAVE 7 "SKILLS + PROJECT CONTEXT"

Hand this to the executing agent (Claude). Hard scope, taken verbatim from the rebaselined
`MASTER-HARNESS-DEVELOPMENT-PLAN.md` (2026-09-07 edition, amended 2026-09-08), §10.2 W7, §1.2,
§7, §11. W7 was **promoted ahead of MCP** in the rebaseline: cheap, low risk, introduces no trust
boundary, immediate user value. This wave gates nothing that runs foreign code; it gives the
runtime a way to be INSTRUCTED — by the operator and by the project — with the ORION-specific
requirement that every such influence is recorded in the trajectory (provenance, plan §1.2). Then
STOP — no W8, no W9.

---

```
Role: Executing agent for ORION (@kernlbase/orion, repo v0/). State entering this wave:
  package 0.2.1 PUBLISHED and verified on npm. Commit c8c91ee (W6.1 evidence refresh) is HEAD;
  parent bc9e2f6 "Wave 6.1: live proofs". Suite 1351/0/37, contract v5/46. Wave 6 delivered a REAL
  container boundary (Docker 29.5.3 / Windows-WSL2, live-verified), Resource Identity + Recovery 2.0,
  capability-derived posture, grant store, and fail-closed network policy (per-domain allowlisting
  is REFUSED, not faked — the enforcement mechanism is unbuilt and honestly disclosed).
  Working tree: nothing modified except untracked research/ + archify-out/ (stay untracked).
  This wave adds SKILLS (progressive-disclosure instruction packs) and PROJECT CONTEXT
  (AGENTS.md/CLAUDE.md), each influence recorded as a trajectory event.

Read FIRST (source of truth, in order — all paths from repo root):
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md
     §1.2  (THE organising principle: every capability lands as attributable execution state. "A
         skill activation is provenance on the turn it influenced" — verbatim, and not optional.)
     §1.3  (Invariants 1-9, esp. 2 = deterministic replay at zero model cost, 6 = provenance,
         9 = additive contract. Skills must not break any.)
     §10.2 W7 (the authoritative scope below)
     §7    (what 10/10 means; the additive-contract rule; context-budget discipline)
     §11   (testing policy, incl. 11.2 manual gate — permanent)
  research/productization/wave6.1-live-proofs-report.md — the discipline and the §11.4 ledger
     format this wave inherits (measure, don't trust; disclosed gaps stay disclosed).
  v0/src/agent/loop/worker.mjs
     line ~92  systemPrompt = DEFAULT_SYSTEM  ← the seam: the compose-time context default.
     #buildMessages (~816)   ← system prompt is PREPENDED fresh every turn (not stored in the
         projection), then model.requested digests the ACTUAL outbound array.
     ~280-300 model.requested records request_digest + context_bytes of what was really SENT,
         after compaction — the digest is the ground truth of "what influenced this turn".
     DEFAULT_SYSTEM / ESCALATION_POLICY / SYSTEM_WITH_ESCALATION_POLICY (~907-958).
  v0/src/cli/index.mjs
     prepareRun (307) — the SINGLE wiring function every turn-bearing command goes through.
         project instructions + skill disclosure MUST be wired here (composition root), not in a
         test-only branch — the failure class this project has repeated six times in five waves.
     WORK = ORION_WORKSPACE ?? cwd (34) — the project root, already a shape used for grants.
  v0/src/core/event/index.mjs   — contract v5/46, additive-only rules, EVENT_TYPES frozen list,
     version-header comment. New W7 types get a v6 entry documented with why.
  v0/src/core/run/store.mjs     — the ONLY mutation path (W5 S1/S2). Every new event type MUST
     flow through Store.append; there is no second path.
  research/productization/wave3-*.md — how context budgets + artifacts + compaction already work
     (rebuildable-report / context report); skills must respect the existing budget discipline
     (contextBudgetBytes default 24_000; outbound_bytes is the honest trigger — worker 254-270).

THE PROBLEM (why this wave exists — plan §10.2 W7):
  ORION today runs a coding agent that cannot be briefed. The system prompt is a fixed constant;
  a project's conventions (build, test, style, gotchas) exist in the repo but nothing reads them;
  and an operator has no supported way to give the agent reusable instructions beyond one task
  string. Every other harness in the ecosystem ships project-instruction files (`AGENTS.md`) and
  skills (`SKILL.md`); ORION — which proposes to be an execution-first agent runtime — ignores
  both. The rebaseline promoted this ahead of MCP because it is cheap, adds NO trust boundary
  (instructions are prompt text, not code execution), and has immediate user value. The ORION
  part is provenance: whoever the instructions came from and whichever turns they influenced must
  be readable from the log, or the feature is a hallucination source with no audit trail — the
  plan names the organising principle verbatim: "A skill activation is provenance on the turn it
  influenced."

SCOPE — from plan §10.2 W7, verbatim requirements plus the ORION wiring they imply. Four parts:

  A  SKILL.md discovery + parsing. `SKILL.md` with YAML frontmatter (name, description at
     minimum; keep the format that other harnesses use — do not invent one, see D).
     PROGRESSIVE DISCLOSURE is mandatory: at session/run start, only name + description of each
     available skill is visible (cheap, lets the model choose); the full body is loaded ONLY on
     activation. This is what keeps skills from inflating every request's context_bytes — the
     budget discipline is W3's and it must hold.
  B  Activation → provenance. When a skill is activated (however activation happens on this
     runtime — you decide the mechanism, but it must be MODEL-visible and MUST be recorded), the
     full body enters the prompt AND a trajectory event is appended naming the skill, its source
     path, and the turn. The trajectory must be able to answer: which skill, from which directory,
     influenced which turn.
  C  Project instructions. Read `AGENTS.md` at the project root (WORK). `CLAUDE.md` recognised as
     an equivalent (same precedence step; do not load both as distinct voices). Project
     instructions are ALWAYS loaded (not progressive - they are the project's standing brief) but
     MUST respect the same provenance rule: an event records which instruction file influenced a
     session. Deterministic replay must reconstruct the same prompt from the same files.
  D  Ecosystem compatibility + precedence ladder. Precedence: bundled → user → project → plugin.
     LOAD SKILLS FROM THE CONVENTIONS THAT ALREADY EXIST: read `.claude/skills` and `.agents/skills`
     (and ORION's own bundled/user/project/plugin locations). A skill authored for Claude Code
     must load unchanged — that is the acceptance test. Do not invent a format where a convention
     exists (plan verbatim).

THE ORION WIRING THAT SCOPE IMPLIES (acceptance, plan §10.2 W7):
  1. A skill authored for ANOTHER harness (write one in `.claude/skills/…/SKILL.md` for the test)
     loads unchanged into a run.
  2. The trajectory shows which skill AND which instruction file influenced which turn — via the
     new event types, readable with `explain` and in the log.
  3. Replay equivalence holds: replaying a run with the same files on disk reconstructs the same
     outbound context (the model.requested digest is identical), at zero model calls.
  4. All of it is wired at the COMPOSITION ROOT — `orionctl run`/`resume` on a real repo with a
     real `AGENTS.md` and a real `.claude/skills/*/SKILL.md` behaves as documented, not just the
     library consumers. This is the wave's §11.4-style fail: un-wired-at-the-CLI is the repeated
     failure class.

CONTRACT RULES:
  - Additive ONLY. Contract v5/46 → v6: add the provenance event type(s) this wave genuinely needs
    (likely one for instruction-file influence and one for skill activation/disclosure).
    Document each in the version-header comment with WHY. Never rename/delete/retype existing
    types. Old logs replay. Do NOT touch the reserved vocabulary (child.spawned/finished,
    context.retrieved) — those belong to later waves.
  - The log is the ONLY mutation path (Store.append). A skill activation is a LOG entry, not a
    setting.
  - Progressive disclosure must keep outbound context within the existing budget model; a run
    with many skills must NOT balloon past the W3 context-budget default as a side effect.
  - Replay equivalence re-proven (per-wave invariant §11.3) including the new instruction events.
  - Product name ORION. research/ + archify-out/ stay untracked / out of package commits.

BOUNDARIES (hard stops):
  - NO MCP (W9), NO search/glob/git/config-file/rule-file (W8), NO subagents (W10), NO memory/
    retrieval (W11), NO orchestration/team (W14).
  - Skills are INSTRUCTION TEXT, not code execution. No plugin engine, no sandboxed JS, no loading
    of skill code. If a `SKILL.md` has a code block, it stays text the model may follow — identical
    trust posture to the system prompt itself. This is exactly why the plan calls W7 "no new trust
    boundary": it must STAY that way.
  - Do NOT expand scope to fix the observed-but-unwired escalation policy (the CLI never passes
    SYSTEM_WITH_ESCALATION_POLICY today). Note it in the report as an observation; do not make it
    this wave's work.
  - Do NOT run npm publish in this session (0.2.1 is live; any release decision is separate).
  - No feature beyond parts A-D and their wired acceptance. Wire every mechanism to the shipped
    configuration.

QUALITY / TEST RULES:
  - Full suite green with Git Bash first on PATH: node v0/tests/run-all.mjs → record before
    (1351/0/37) and after. Suite count will rise.
  - New tests in the right class: mechanism tests in tests/ (parsing, precedence, progressive
    disclosure, activation event) AND tests/shipped/ for the WIRING (real AGENTS.md + real
    .claude/skills skill at the real CLI). The shipped test MUST assert: skill's name+description
    visible at session start; full body absent from the pre-activation digest and PRESENT after
    activation; the influence events in the log; replay digest identical at zero model calls.
  - Respect the standing §11.2 manual gate: a real installed build, real model (qwen3:14b via
    Ollama is the local norm), a real task on a repo WITH an AGENTS.md and a skill, assert the
    model was actually briefed (its output follows the skill/instructions — or the report says it
    did not) and the trajectory names the instruction source. Never self-report.
  - Stray 0x08 scan: byte-scan every changed/untracked file for 0x08 before declaring done;
    report the count per file.
  - Honest §11.4 in the report: what was exercised live vs not (e.g. no live Anthropic still;
    nothing on Linux-native).

REPORT:
  Write research/productization/wave7-skills-project-context-report.md: per part (A-D) what was
  implemented, the activation-mechanism decision and its rationale (measure it if you can — e.g.
  does the model activate by a tool call or by requesting a skill by name?), the precedence ladder
  as resolved, the new event type(s) (name + why, verbatim from the version header), the
  ecosystem-compat evidence (the other-harness skill that loaded unchanged), the wired acceptance
  results, suite before/after, contract version v5 → v6, replay equivalence re-proven, the
  escalation-policy observation, and §11.4 (what was NOT exercised). Then STOP. No W8, no W9.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **Why now:** W6/W6.1 built and MEASURED the boundary (container, limits, network, grants,
  recovery). W7 is the first wave the plan calls "no new trust boundary" — instructions are prompt
  text, nothing executes. It is the safest high-value wave left and the one a second engineer or a
  fast session can land cleanly. The plan's graph puts W7 on a side spur of W5, parallel-safe to
  the W6→W9 critical path.
- **The provenance rule is the whole point.** The plan is explicit (§1.2): "A skill activation is
  provenance on the turn it influenced", and "If a feature cannot be expressed as attributable
  execution state, that is evidence the design is wrong." The prompt makes the trajectory events
  and the additive contract non-negotiable, because that — not the parsing — is the ORION-specific
  deliverable. Replay must reconstruct the same prompt from the same files, proven by digest.
- **Ecosystem compatibility is an acceptance test, not a wish.** A `.claude/skills/*/SKILL.md`
  authored for Claude Code must load unchanged (frontmatter: name + description; body on
  activation). This is what makes ORION a *drop-in execution layer* rather than a fifth format.
- **Two things I found while writing this, checked at source:**
  1. The CLI (`prepareRun`) never passes `systemPrompt`, so `DEFAULT_SYSTEM` is used and the
     escalation policy is currently unwired at the product surface. That is NOT W7 scope; I told
     the agent to note it and move on. Decide separately whether it's a defect to schedule.
  2. `model.requested` already digests the real outbound array post-compaction (worker ~280-300),
     so the replay-equivalence claim is checkable for real: before/after digests must match, at
     zero model calls.
- **Progressive disclosure is load-bearing**, not cosmetic: names+descriptions at start, full body
  only on activation, all inside the W3 context-budget discipline. Otherwise a repo with ten skills
  silently blows every request's context_bytes and the "cheap" wave becomes a regression vector.
- **After this returns I verify the same way I've verified every wave** (measure, don't trust):
  suite count, the shipped wired-acceptance test, event types added (additive, documented), replay
  digest equality, 0x08 scan, and the manual gate's evidence. Then the decision point is **W8
  (search/git/config — highest DX-per-effort) vs W9 (MCP)** as the plan orders: W6→W7→W9.