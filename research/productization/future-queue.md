# ORION — future research queue

Parked ideas with enough substance to be worth designing later, and enough risk to be worth
*not* bolting on now. Nothing here is scheduled. Nothing here is a commitment.

Rule for this file: an entry earns its place by naming the **problem it solves** and the
**reason it is not being built yet**. An entry that is only a feature name does not belong.

---

## Q1 — Step evidence as model **+** runtime

**Status:** queued. Explicitly out of Wave 2 scope.

**Today.** `plan_step` evidence is **model-declared**. The agent writes `"fixed calc.py"` or
pastes verify output into the `evidence` field, and that string is what lands on the trajectory.
It is honest about its own provenance — a claim by the model, recorded as such — and it is
already a large improvement on prose in a summary. But it is still the model's word.

**The direction.** Fold model-declared evidence with **runtime-derived** evidence, so a step
carries both. A step that says *"fixed calc.py"* should also carry, from the trajectory itself:

- the mutating `tool.succeeded` event(s) that fall within the step's window;
- the `write` pre-state witness / edit precondition hash — what the file was, what it became;
- the `verify` PASS/FAIL verdict and the command that produced it.

Then step evidence becomes **model + runtime**, and the interesting case becomes checkable:
a step marked `done` whose window contains no mutating effect and no passing check is a step the
runtime can flag, without having to parse the model's prose.

**Why this deepens the differentiator.** It is the same move Wave 1 made for completion — replace
an assertion with a fold over the log — applied one level down, at the step. It is squarely on
the "everything an agent does becomes attributable execution state" thesis.

**Why not now.** It needs a designed answer to questions Wave 2 deliberately did not open:

- what defines a step's *window* in the event stream, when the model may mark steps out of order,
  late, or not at all;
- whether runtime evidence is advisory (shown alongside) or authoritative (can contradict and
  override the model's claim) — the second is a policy decision with real failure modes;
- how a revision (`plan.revised`) re-binds evidence that was gathered under the old step ids.

Getting this wrong would produce confident, wrong provenance, which is worse than the honest
model-declared evidence we have. **Design it; do not bolt it on.**

---

## Q2 — Per-model planning behaviour (see `wave2-report.md` §Deviations, finding 2)

**Status:** queued as an **evaluation** question, not a runtime change. Tracked under Track A.

`qwen3:14b` ignored the plan instruction entirely and edited directly; `gemma4-31b` planned five
steps and used `verify` unprompted. The runtime handles both correctly. Measuring the spread
belongs in `eval/`, never in a README claim. See the eval note in `wave2-report.md`.

---

## Q3 — Reserved event types awaiting their wave

`child.spawned`, `child.finished`, `context.retrieved` remain in the frozen vocabulary and are
emitted by nothing. Documented in `core/event/index.mjs` with the wave that will emit each. They
are kept rather than removed because removal would break replay of existing logs.

This is a record, not a plan: they land with subagents (Wave 7) and memory/retrieval (Wave 8) as
scheduled in `MASTER-HARNESS-DEVELOPMENT-PLAN.md` §5.
