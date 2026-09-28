# Session prompt — WAVE 4.5 "SHIP SAFETY + WIRING INTEGRITY" (address the production-audit findings)

Hand this to the executing agent (Claude). This is a focused correctness/security/ship-readiness session
driven by the just-completed audit `research/productization/ORION-PRODUCTION-COMPETITIVE-AUDIT.md`. It
fixes CONFIRMED findings BEFORE any further capability waves. Hard scope. Then STOP. No Wave 5.

---

```
Role: Executing agent for ORION (@kernlbase/orion, repo v0/). Waves 1-4 are committed and verified
(00b68a6, 9de5324, 0baf4b4, 1be187a, c8b106f; 904 passed / 0 failed / 30 suites; event contract v4/39;
package @kernlbase/orion@0.1.2). The production audit
research/productization/ORION-PRODUCTION-COMPETITIVE-AUDIT.md found real, CONFIRMED correctness and
security problems. This session fixes those specific findings ONLY. It is NOT a feature wave. Then
STOP. No Wave 5, no republish yet (a deliberate bundled release may be the NEXT step after this —
do not publish in this session unless separately instructed).

Read FIRST:
  research/productization/ORION-PRODUCTION-COMPETITIVE-AUDIT.md   (the audit — your source of truth
     for the confirmed findings; every fix below traces to a section of it)
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md (§8 manual test gate, §7 contract rules)

CONFIRMED FINDINGS TO FIX (verified by the planner against source — fix each, with a regression test):

1) [SECURITY, CRITICAL] `verify` bypasses the authorizer's denyCommandPatterns.  §10.2
   Root cause: worker.mjs:443 populates `action.command` ONLY when `tool.name === 'bash'`. So in
   auth/default/index.mjs:69 the hard-deny check (which fires only for `action.name==='bash' && typeof
   action.command==='string'`) NEVER runs for `verify`. A deployer's custom denyCommandPatterns (e.g.
   "no git push", "no npm publish") is enforced for bash but silently NOT for verify.
   Nuance to preserve: `verify` ALSO has a narrower static tool-level denylist via isKnownDangerous
   (tools/index.mjs "reuses the SAME explicitly-dangerous denylist that governs bash"). Keep that.
   The fix is to make the AUTHORIZER gate command-bearing tools generally, so a command-bearing tool
   (verify today, any future one) is subject to the deployed denyCommandPatterns — not only `bash`.
   This is the audit's "one-line fix I deliberately left." Do it at the right layer (worker sets
   action.command for command-bearing tools; authorizer checks command-bearing tools uniformly, not a
   hardcoded 'bash' switch). Add a regression test at STRICT posture proving a verify command matching
   a custom denyCommandPattern is denied (mkfs/fork-bomb/dd-style), and that legit verify still works.

2) [PRODUCT, CRITICAL] The published npm package is 4 waves behind the source.  audit §N
   @kernlbase/orion@0.1.2 was published 2026-09-03; Wave 1 (truthful completion) landed 2026-09-04.
   Users who `npm i @kernlbase/orion` get the OLD build that reports ✓ model_finished on unperformed
   work. Do NOT publish in this session, but PREPARE the release cleanly:
     a. Bump the version appropriately (this is a substantial, correctness/security-bearing change;
        choose a semver bump that reflects Waves 1-4 + these fixes — justify the choice in the report).
     b. Make `npm pack` + a fresh-install acceptance pass (install tarball in a clean dir; orionctl
        --version/--help/doctor; a real fix-the-bug run that now proves the file and test result).
     c. Confirm package.json `files` still ships ONLY what's intended; research/ and tests/ excluded.
     Do NOT push/npm-publish the package in this session — staging the version + pack validation is
     the deliverable; the actual publish is a separately-gated user action.

3) [STRUCTURAL, TOP FINDING] The suite validates mechanisms, never the shipped configuration.  audit
   §3.2 + executive. Four waves, four recurrences (D2, D3, shim array, compaction-never-fires) — now
   the verify bypass and the unwired stream. Add a NEW tests/shipped/ class that exercises the DEFAULT
   WIRING a developer actually runs, mirroring the real CLI path (buildModel default, default posture,
   default system prompt, default contract), not the modules in isolation. At minimum:
     a. the authorizer deny-pattern applies to verify at default & strict posture (§F1),
     b. the completion contract at DEFAULT wiring reports the correct verdict on
        [plan declared + plan satisfied] AND [work done WITHOUT plan_step] (see F4),
     c. a command-bearing tool's command actually reaches the authorizer (not just bash),
     d. the shipped system prompt includes verify + plan (no drift between prompt and tools).
   This class is what would have caught F1, F4 and the streaming-unwired problem.

4) [CORRECTNESS] Completion-contract false negative.  audit executive (truthfulness now fails the
   other way): a run that EDIT a file and got verify PASS is recorded FAILED (finished_without_change)
   because the model didn't call plan_step. In cli/index.mjs:134-148, when a PLAN EXISTS,
   planSatisfied(plan) is the ONLY objective — so a run that did real, verified work but never marked
   the step done is judged unsatisfied. This swings Wave 1's truthfulness to under-claiming success.
   Fix so a declared plan is the objective but real verified world-change is not falsely failed:
   the objective should be satisfied when the plan is satisfied OR (no plan steps remain blocking AND
   a mutation succeeded AND its verify was PASS-evidenced). Preserve the Wave-1 guarantee: doing
   NOTHING is still not success, and an UNFINISHED plan is still an unfinished run. Add tests for:
   [plan satisfied → complete], [work done w/o plan_step but verify PASS → complete], [plan unfinished
   → not complete], [no mutation at all → not complete]. Keep the Wave-1 D2 case (unperformed work not
   reported as success) intact.

5) [PRODUCT] The Wave 4 capability is unreachable from the CLI.  audit §3.2. The CLI (cli/index.mjs:67
   buildModel, line 77) hardcodes createOpenAICompatModel; there is no provider selection and no
   streaming toggle from the product surface — Wave 4's Anthropic provider and streaming are tested as
   mechanisms but a developer cannot use them. Also fix the inverted capabilities: openai-compat
   IMPLEMENTS invokeStream but advertises capabilities without 'streaming'; anthropic ADVERTISES
   'streaming' but has no invokeStream (verify and resolve — the capability set must match actual
   implementation). Wire the CLI so:
     a. ORION_PROVIDER=openai-compat|anthropic selects the provider (default openai-compat),
     b. streaming is reachable from the product surface (env/config flag; default ON for a provider
        that streams, OFF/fallback with a 'degraded' event for one that cannot — never silent),
     c. the capability set of each provider matches what it actually implements.
   Add tests in tests/shipped/ proving the CLI wiring reaches the provider seam (not just the module).

6) [DOC] Backfill the missing Wave 4 report.  research/productization/wave4-report.md does not exist
   (Wave 4 has a plan wave4-plan.md + two commit messages, but no report — which is exactly where the
   manual-testing section would have caught F5). Write wave4-report.md retroactively from the commits
   (1be187a, c8b106f), the plan, and the CURRENT verified state (904/30, contract v4/39), following the
   same evidence discipline as wave1/2/3 reports. Record the manual-testing section as accurately as
   the evidence allows; where a real live-Anthropic call was NOT made (only scripted/OpenAI-compat
   path), say so explicitly — do not fabricate.

OWNERSHIP / BOUNDARIES:
  - Do NOT grow core/recovery into a general command-policy module. The isKnownDangerous/classifyShell
    distinction stays. The F1 fix belongs in worker/authorizer where command-bearing tools are gated.
  - Do NOT change the event contract in this session (no new types unless a fix genuinely requires
    one — if so, version it additively per §7 and say why).
  - Do NOT add features beyond these fixes. This is not "improve Wave 4" beyond wiring it correctly.
  - Do NOT publish to npm (staging + pack validation only). Version bump is prepared, not shipped.
  - research/ stays untracked / out of package commits.
  - Product name ORION.

QUALITY / TEST RULES:
  - Full suite green with Git Bash first on PATH: node v0/tests/run-all.mjs → TOTAL: <n> passed,
    0 failed, <n> suites. Record before (904/30) and after.
  - New tests live in tests/shipped/ (registered in run-all.mjs) plus targeted regression tests.
  - Respect the standing §8 manual-testing gate for the two user-visible fixes (F4 completion verdict,
    F5 wired provider+streaming): a real installed package over real models, verify the FILE + TEST
    result, never self-report. Document in the report.

REPORT:
  Write to research/productization/wave4_5-ship-safety-report.md: for each of F1-F6, the root cause,
  the fix, the regression test, and the pre/post verification. Include the suite before/after, the
  pack + fresh-install acceptance output, the completion-verdict test table, the provider/streaming
  wiring test table, and the version-bump justification. State clearly what is staged vs published.
  Then STOP. No Wave 5. No npm publish in this session.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- **Verified the findings myself before writing this:** the `verify` authz bypass (worker.mjs:443 sets
  `action.command` only for bash; auth/default:69 hard-codes the check to `name==='bash'`), the npm
  publish-date gap (0.1.2 published 09-03 vs Wave 1 on 09-04), the CLI hardcoding
  createOpenAICompatModel (cli/index.mjs:77), and the completion-contract false-negative
  (cli/index.mjs:141-148 — plan existence makes planSatisfied the sole objective).
- **Nuance baked in:** `verify` still has its tool-level isKnownDangerous denylist — the fix is about
  the AUTHORIZER's deployed denyCommandPatterns, not removing the tool-level check. And the completion
  fix must NOT reintroduce the Wave-1 D2 lie (unperformed work reported as success).
- After this returns: review against the tree, then a SEPARATE gated session to actually publish
  (push + npm publish), then Wave 5 (resource identity + recovery 2.0).
