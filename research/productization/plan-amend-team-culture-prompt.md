# Amendment prompt — record the founder's team-culture thesis in the master plan

Hand this to the same executing agent (or a fresh one) AFTER the Wave-1-close + WAVE-2 session, or in
parallel as a doc-only change. It amends ONLY research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md
— no product code, no package changes, nothing to publish. Small, surgical, then STOP.

---

```
Role: Doc-only amendment to research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md. Make the
founder's "harness that improves from the entirety of a team's usage" thesis explicit and correct the
§6 dependency that Wave 11 needs per-member attributable trajectories. No product code. No renames.
No new waves. Read the whole plan first; make ONLY the two edits below; then report the exact diff and
STOP.

1) §10 Self-evolving harness (Wave 11, research), currently ~7 lines at the "## 10." heading. Rewrite
it to make the CULTURE-ENCODING thesis explicit. Keep every existing principle (attributable,
inspectable, versioned, reviewable, reversible, measurable; learn from real trajectories; PROPOSE never
silently self-modify; requires real multi-user usage first; natural end-state of attributable execution
state). ADD the founder's precise distinction and mechanism:

   - The goal is not "the harness remembers that I like semicolons" (personal-memory framing, which
     reflects Primer-Agent-style personal self-evolution). It is: the harness learns the SOFTWARE-
     DEVELOPMENT CULTURE of the whole team — the coding conventions, expected tests, PR/validation
     norms, preferred tools/workflows, safety and approval policies, review habits, acceptable
     commands — culture that in most teams is defined by the team lead and currently lives in the
     CREW's unwritten norms, not in the harness.
   - The harness becomes the ENCODED, VERSIONED embodiment of that shared culture, learned from the
     ENTIRETY of the team's usage (member trajectories aggregated), not from any single developer.
   - Mechanism pipeline (proposed, never autonomous): TEAM USAGE → TRAAJECTORIES → PATTERNS →
     CANDIDATE HARNESS CHANGE → REVIEW → VERSION → MEASURE → ACCEPT / REJECT / ROLLBACK. Make clear
     this is "Git for coding harnesses": every harness change is a reviewable, reversible, versioned
     commit of the team's culture, not a floating memory.
   - Contrast it with plain "memory systems": this is a versioned, reviewable, reversible evolution
     of the harness ITSELF (its policies, tools, judges, defaults), distinctively enabled by ORION's
     trajectory-native evidence, which the six-repo audit found no competitor provides.

2) §6 Dependency graph — WAVE 11 row (line ~426) says only "(needs real usage data)". Expand that
dependency so the plan makes explicit WHAT earlier waves must produce to make Wave 11 physically
reachable: WAVE 11 depends on per-MEMBER attributable trajectories (i.e. the trajectory-provenance
built up by Waves 1-9, aggregated across a team), which is exactly the "entirity of usage" data the
thesis needs. Add a short note under the dependency block (or to the WAVE 11 row) stating: earlier
waves must record WHO (which team member / session owner) produced each trajectory so that team-level
aggregation and attribution remain possible. Ensure this does NOT force Wave 11 content into earlier
waves — it only records the data-precondition so nothing is built that forecloses it.

Constraints:
   - Do NOT touch the WAVE 1-10 rows, the frozen event contract, or any product code.
   - Do NOT renumber waves. Do NOT add a wave or change scope of the next WAVE 2.
   - Preserve the plan's existing style/formatting (headers, monospace blocks).
   - This is a research/planning record under research/productization/ — it is INTENTIONALLY untracked
     productization material and must never enter a package commit.

REPORT: the exact diff of §10 and §6 (before/after), confirming every original principle was preserved,
then STOP.
```

---

## Planner notes (for the user)

- This is a pure documentation amendment; it can be run before, after, or in parallel with the
  WAVE-2 session — it does not touch product code.
- It converts your idea from "it's mentioned in Wave 11" to "the culture-encoding thesis is explicit,
  and the earlier waves explicitly preserve the per-member attribution data Wave 11 needs." That's the
  part that was under-specified.
