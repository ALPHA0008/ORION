# Session prompt — WAVE 8 "SEARCH + GIT + CONFIGURATION"

Hand this to the executing agent (Claude). Hard scope, taken verbatim from the rebaselined
`MASTER-HARNESS-DEVELOPMENT-PLAN.md` (2026-09-07 edition, amended 2026-09-08), §10.2 W8, §1.2,
§7, §11, §13 (security roadmap). W8 is **promoted** in the rebaseline: `grep` is a literal
`String.includes` and there is no `glob`, `git` navigation, or config file at all — measured
evidence already shows file-visibility problems dominating run failures. This is the highest
developer-value-per-unit-work wave in the plan. Deliver it, then STOP — no W9, no W10.

---

```
Role: Executing agent for ORION (@kernlbase/orion, repo v0/). State entering this wave:
  package 0.2.1 PUBLISHED and verified on npm. Commit 82a5f5d (W7 evidence refresh) is HEAD;
  parent afde869 "Wave 7: skills + project context". Suite 1499/0/39, contract v6/49.
  The working tree ALSO carries two PRE-APPROVED, PRE-VERIFIED, UNCOMMITTED shims (added outside
  this wave, suite still 1499/0/39): v0/src/agent/model/shims/reasoning-as-content.mjs
  (gpt-oss-120b routes all output to the `reasoning` field; remaps ext.reasoning -> content) and
  vendor-extra preservation in v0/src/agent/model/index.mjs normalise() + outbound reconstruction
  in v0/src/agent/loop/worker.mjs #buildMessages (Gemini requires thought_signature round-trips;
  normalise now keeps tc.extra_content as tc.vendor_extras, buildMessages spreads them back).
  Do NOT revert, restyle, or re-scope those edits. They are not yours. If W8 touches either file,
  preserve its behaviour.
  Working tree: nothing else modified except untracked research/ + archify-out/ (stay untracked).
  This wave adds SEARCH (glob + regex grep + bounded recursive search), GIT navigation
  (read-only first), a CONFIGURATION FILE (schema'd, layered UNDER env vars), a PERMISSION RULE
  FILE (deployer-facing deny/escalate/protected-path without code), and the FIRST-RUN flow.

Read FIRST (source of truth, in order — all paths from repo root):
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md
     §1.2  (THE organising principle: every capability lands as attributable execution state.)
     §1.3  (Invariants 1-9, esp. 2 = deterministic replay at zero model cost, 6 = provenance,
          9 = additive contract. New tools and a config layer must not break any.)
     §10.2 W8 (the authoritative scope below: "a developer completes a real task on a repository
          they did not write, using search rather than paging").
     §7    (what 10/10 means; the additive-contract rule; context-budget discipline)
     §11   (testing policy, incl. 11.2 manual gate — permanent)
     §13   (security roadmap: path containment is not OS isolation; policy maintained, not weakened)
  research/productization/wave7-skills-project-context-report.md — the §11.4 ledger format this
     wave inherits (measure, don't trust; disclosed gaps stay disclosed).
  research/productization/current-product-surface.md — the Configuration row
     ("Env vars only ... no config file") and the measured grep bug
     ("grep without a path searched .harness/, leaking the event-log database into results").
  research/productization/fresh-run-audit.md — the measured first-run gaps (no init, no guided
     setup, `run` exits 0 when unconfigured, grep descending into ORION_HOME).
  v0/src/agent/tools/index.mjs
     grep (261)  ← literal search: sandbox.grep → local/index.mjs String.includes. NO regex, no
         glob. This is the wave's first target.
     write (270) edit (fn above) verify — read these to see how a tool declares effects,
         recovery class, and pathAddressed; new glob/git tools must declare the same way
         (T1: effects DERIVED from the toolset; never a second copy of the fact).
         Sample the plan/plan_step tools (451) for how a tool emits derived events into the
         trajectory — new tools needing provenance use the same seam (worker 663-672).
  v0/src/sandbox/local/index.mjs
     grep (93-156) — the [INCOMPLETE RESULT] honesty contract (unreadable paths, hit caps,
         SKIPPED notes, clamp). Regex grep must PRESERVE this exact honesty contract.
     read/write/list/exists — the containment layer new tools must respect (no PATH escape).
  v0/src/auth/default/index.mjs
     createAuthorizer (30) — today denyTools / escalateTools / denyCommandPatterns /
         protectedPaths / budgetLimits are CODE-CONFIGURED (see cli 399). The permission rule
         file must surface these WITHOUT code and keep the posture FLOOR (a narrower scope may
         only RAISE strictness, never lower it — line 26-28).
  v0/src/cli/index.mjs
     35  HOME = ORION_HOME ?? ~/.orion
     38  WORK = ORION_WORKSPACE ?? cwd
     109-131 buildModel — provider construction reads ORION_PROVIDER/ORION_BASE_URL/ORION_API_KEY/
         ORION_MODEL. The config file must layer UNDER these env vars (env wins).
     399  createAuthorizer({...}) wired here
     run (435), status/explain/replay (550ish) — the CLI command surface new config must flow into.
     903 help text lists the env config: ORION_BASE_URL ORION_API_KEY ORION_MODEL ORION_HOME
         ORION_POSTURE (plus ORION_WORKSPACE, ORION_SANDBOX, ORION_SHIMS, ORION_STREAM, ORION_ASCII
         elsewhere). The config FILE must be documented here too.
  v0/src/agent/loop/worker.mjs
     #buildMessages (815) — how tool results and assistant messages are reconstructed; new tools
         must round-trip here. repairOrphans (870) — every assistant tool_call needs a tool reply.
  v0/src/core/event/index.mjs   — contract v6/49, additive-only rules, EVENT_TYPES frozen list.
     New W8 event types get a v7 entry documented with why.
  v0/src/core/run/store.mjs     — the ONLY mutation path (W5 S1/S2). Every new event type MUST
     flow through Store.append; there is no second path.
  research/productization/wave6-execution-environment-report.md — how the workspace shadow repo
     already shells to host `git` (attachCheckpoints); the git tools you add must not conflict
     with the shadow-repo mechanism or the recovery contract.
  research/productization/future-queue.md — Q-numbered research items stay in the queue (do NOT
     pull them into this wave).

THE PROBLEM (why this wave exists — plan §10.2 W8):
  A coding agent that can only String.includes-search cannot see a repository it did not write.
  Measured: file-visibility problems dominate run failures. There is no way to find a symbol
  across a tree (glob), no way to search by regex pattern, no way to ask the repository itself
  what state it is in (git status/diff/branch), and no way to configure ORION except environment
  variables an operator must re-export per terminal. W8 makes search real, makes navigation
  git-aware (read-only first), and turns configuration into a schema'd file layered under env —
  with the authorizer's deny/escalate/protected-path surface exposed to deployers without code.
  Then the first-run flow stops treating a missing key as a bare exit-2.

HARD SCOPE (deliver exactly this, nothing more):

  1. GLOB.
     Add a `glob` tool: pattern-based file/entry discovery over the workspace
     (e.g. **/*.ts, src/**/*.mjs). Honest about what it did not read. Respect the workspace
     containment (no escaping WORK via .. / symlink — reuse the existing path guard). ReadOnly
     effects, READ_ONLY recovery class. Bounded result count with a [INCOMPLETE RESULT] suffix
     when the cap is hit — the same verbatim honesty marker grep uses, because truncation
     without saying so is how an agent confidently concludes the wrong thing.

  2. REGEX GREP.
     Upgrade the existing `grep` tool so `pattern` can be a regular expression while REMAINING
     BACKWARD COMPATIBLE with the today literal-string call shape (a regex that is also a plain
     substring must still match it). Preserve verbatim: the [INCOMPLETE RESULT] block, the
     SKIPPED / unreadable notes, the hit caps, the clamp, and the return format path:line:
     matches. Detect a malformed regex and return a clear tool failure, never a silent empty.

  3. BOUNDED RECURSIVE SEARCH (X6).
     Both glob and grep run with layered timeout budgets and caps at every level (per-directory
     time, total time, total hits). Hard ceilings, never unbounded walks: a runaway search must
     terminate and say it was truncated. The Deep-Agents pattern the plan cites (layered time
     budgets) is the model. Document the exact budget numbers in the report.

  4. GIT-AWARE NAVIGATION (read-only first).
     Add read-only git tools: `git status`, `git diff` (worktree; optionally --staged), `git
     branch` (local, with current-marked), and a blame-lite (file + optional path). All
     read-only, all safe to retry, all using host `git` through the LocalSandbox the same way
     the shadow repo already does. Do NOT add git write operations (commit/push/checkout) — that
     is explicitly out of scope in this wave. Each tool must handle "not a git repo" and "git
     not on PATH" as a clear honest failure, never a crash. Respect recovery classification
     (READ_ONLY). If a git command's output is large, clamp with the existing artifact/clamp
     discipline and say so.

  5. CONFIGURATION FILE.
     A schema'd config file (json by default; support `.orion.json` in ORION_WORKSPACE AND
     `~/.orion/config.json` global) whose directives are layered UNDER the existing env vars:
     env always wins (the current documented behaviour must not change). Schema covering at
     minimum: model/provider (baseUrl, apiKey ref NOT inline storage of plaintext — document how
     to keep the key in ORION_API_KEY and have the file reference it), ORION_POSTURE, budgets,
     and tool configuration (glob/grep caps). `orionctl test-config` (or equivalent named
     command) validates the file and prints what the effective configuration is after env
     layering — the operator must be able to answer "what will this run actually use?" without
     guessing. Invalid file = a clear error naming the field, exit non-zero.

  6. PERMISSION RULE FILE.
     Expose the authorizer's denyTools / escalateTools / denyCommandPatterns / protectedPaths
     (the exact knobs createAuthorizer takes today, cli 399) in a deployer-facing rule file
     (e.g. ~/.orion/rules.json or a documented file under the config layer). Rules layer under
     the posture FLOOR: a rule may only RAISE strictness, never lower it (QM direction, auth
     index.mjs 26-28). The authorizer construction in the CLI reads this file; missing file =
     today's code defaults. Rule validation failures are loud and exit non-zero. The §13
     security distinction ("path containment is not OS isolation", "policy maintained, not
     weakened") applies: this wave EXPOSES existing policy, it does not change the policy engine.

  7. FIRST-RUN FLOW.
     When no model is configured: a bounded, honest first-run message that names what is
     missing, shows the env vars to set (or the new config file), and exits non-zero — fixing
     the measured "run exits 0 when unconfigured" bug (fresh-run-audit.md:92) WITHOUT inventing
     an interactive wizard (not an IDE, no TUI). Do not print secrets.

  NON-GOALS (repeat this aloud before starting):
     No W9 (MCP), no W10. No git WRITE operations. No LSP / IDE integration (W14+).
     No new event types unless a search/git/provenance requirement actually demands one — and
     then ONLY additively (contract v6 → v7, never a mutation). No weakening of the posture
     lattice. No interactive first-run wizard. Do not touch the two pre-approved shims.

  ACCEPTANCE:
     A developer completes a real task on a repository they did not write, using glob/regex-
     grep/git navigation rather than paging through files. Demonstrate it in the report with the
     ACTUAL transcript: pick a real task on this repo's own tree (e.g. "find every place that
     touches the event contract version without reading the files one by one" or "show what
     changed in the working tree and who is on the current branch", or a real bug-hunt
     seeded/measured on a scratch copy) and show each tool call + its result. The demo and the
     report must be the tool-call transcript, not a paraphrase of it.

METHOD (the standing discipline; every numbered point is a hard requirement):

  1. Tests FIRST, in the existing runner. New suites live under v0/tests/ (e.g. search/, git/,
     config/). Additive-only: no existing test may be edited to pass. New tools get a
     shipped/w8-shipped suite proving the CLI composes them (the failure class this project has
     repeated seven times across six waves is composition-root wiring — prove it here).
     The suite target is 1499 + new > 0, 0 failures, 39 + new suites.
  2. Additive event contract. New event types only if required, only appended, version header
     updated (document why). Replay equivalence and old-log replay must hold.
  3. The §11.2 manual gate IN THIS WAVE SHAPE: install the current tree (npm pack + clean
     prefix, exactly as wave7 did), run a REAL task on a repository the author did not write
     (this repo itself qualifies for the git/glob parts), using the new tools live through the
     CLI with a real model. You have two live provider options now measured in
     eval-live-api-groq-gemini.md: Groq gpt-oss-120b (needs the reasoning-as-content shim —
     already selected automatically) or Gemini gemini-3.5-flash (needs the thought_signature
     round-trip fix — already in the tree). If neither completes, that is an honest negative
     result, reported in the §11.4 ledger — and the gate must at minimum demonstrate glob +
     regex grep + git status + config parsing via the installed build's own `test-config`.
     Never self-report; verify on disk and from the event log.
  4. Typecheck clean (tsc --noEmit), lint clean (node tests/lint.mjs). Suite runs on Windows
     via Git Bash — run `node tests/run-all.mjs` with Git Bash's bin/ FIRST on PATH so the shell
     preflight resolves `bash` to Git Bash, not WSL (this host: C:\Users\abhijith.p\AppData\Local
     \Programs\Git\bin).
  5. 0x08 scan: no calls to `process.exit` in libraries, no accidental prints to stdout from a
     lib path, no new dependency, no plaintext secret in source or tests, no event written with
     a secret visible to `explain`. Report the count explicitly.
  6. Update CLI help text (cli/index.mjs ~903) and README config sections to cover the new
     config file, rules file, glob/grep semantics and git tools. Update
     research/productization/current-product-surface.md rows for Configuration and Search.

OUTPUT (the deliverable, in order):
  - One or more commits on HEAD describing the wave (stage only intended files; keep research/
    and archify-out/ untracked; the two pre-approved shim edits are NOT yours to commit — leave
    them uncommitted).
  - A report at research/productization/wave8-search-git-config-report.md in the wave-report
    house format used by wave6.1/wave7 reports: THE PROBLEM → changes by file → test evidence
    (the ACTUAL `node tests/run-all.mjs` TOTAL line) → the manual-gate transcript → an
    explicit 0x08 count line → §11.4 (what was NOT exercised) → verdict. Include the budget
    numbers you chose for glob/grep and why.
  - STOP. No W9, no W10. The decision point after this wave is W9 (MCP) versus secondary-wave
    work, taken by the operator.
```