# Wave 7 — SKILLS + PROJECT CONTEXT

**Date:** 2026-09-10 · **Scope:** plan §10.2 W7 parts A–D, §1.2, §7, §11 · **Product:** ORION
(`@kernlbase/orion` 0.2.1) · **Entering commit:** `c8c91ee`

The runtime becomes **instructable** — by the project it is working in and by the operator — with
the ORION-specific requirement that every such influence is recorded in the trajectory.

**Suite: 1,351 → 1,499 passed / 0 failed, 37 → 39 suites.**
**Contract: v5/46 → v6/49 (additive only).**
**`tsc --checkJs`: 0 errors. Lint: clean. No new trust boundary.**

---

## The organising principle, and what it forced

Plan §1.2, verbatim: *"A skill activation is provenance on the turn it influenced."* That single
sentence is what separates this from every other harness's skills feature. Instruction text that
changes a model's output without appearing in the log is a hallucination source with no audit
trail — the trajectory would show an agent doing something inexplicable and the explanation would
be sitting in a file nobody recorded.

So the design question was never "how do we load a `SKILL.md`" — that part is trivial. It was:
**what makes the influence checkable afterwards?** Three answers, and they shaped everything else:

1. The **request digest** is the ground truth. `model.requested` already records
   `request_digest` over the actual outbound messages, tools and params, after compaction. So
   "progressive disclosure works" is not a claim about a helper function — it is a claim about
   what is and is not inside that digest, and the tests assert it there.
2. Activation is a **tool call**, so it inherits provenance rather than inventing it.
3. The prompt must be a **pure function of the files on disk**, or Invariant 2 (deterministic
   replay at zero model cost) stops being true the moment a run is briefed.

---

## A — `SKILL.md` discovery and parsing

`src/context/skills.mjs` (258 ln). `SKILL.md` with YAML frontmatter; `name` and `description` are
what the runtime needs, and **everything else is carried and ignored rather than rejected**. That
tolerance is the compatibility requirement in practice: a skill authored elsewhere carries
`allowed-tools`, `license`, `model` and other keys this runtime has no opinion about, and refusing
the document over them would defeat the whole point.

The frontmatter reader is deliberately small — the runtime ships zero production dependencies, and
frontmatter in this convention is a flat map of scalars. It handles the shapes that appear in real
files (quoted/unquoted scalars, `|` and `>` block strings, inline and block lists, a UTF-8 BOM) and
falls back to the containing directory for a missing `name`.

**Progressive disclosure is a budget decision, not a UX one.** Wave 3 established that outbound
context is budgeted (`contextBudgetBytes`, default 24 000, measured on the real outbound array).
A dozen skills inlined in full would consume that before the conversation started. Measured:

| | inlined (the naive design) | disclosed (shipped) |
|---|---|---|
| 12 skills × 20 KB bodies | **241 754 B** system prompt | **1 249 B** system prompt |
| vs the 24 KB W3 budget | **10× over** | ~5% of it |

The left column is not hypothetical — it is what the falsification run produced when disclosure
was deliberately broken (see *Falsification* below).

## B — activation, and why it is a tool call

**Decision: activation is a `skill` tool call.** The alternatives were a magic marker the model
emits in prose, or automatic keyword matching against the task.

- A **prose marker** means parsing model text for control signals — the class of defect the Gemma
  shim already exists to paper over — and would be invisible to the authorizer.
- **Auto-matching** removes the model's judgement, which is the thing progressive disclosure
  exists to use, and makes *"why did this skill fire?"* unanswerable.

A tool call is already model-visible (it is in the schema the provider receives), already recorded,
already authorized, already replayable, already compaction-aware. It also puts the body in the
right place: it arrives as a **tool result**, so it lands in the bounded projection and is subject
to the same budget as any other content — rather than being spliced into the system prompt, where
it would be re-sent uncompactably on every subsequent turn.

Classified `effects: ReadOnly`, `recovery: READ_ONLY`. Reading instruction text changes nothing in
the world, so an activation never needs a human at any posture, and is safely re-runnable after a
crash.

The tool **only exists when there is something to activate**. A project with no skills sees the
identical nine-tool set it saw before this wave — asserted.

## C — project instructions

`src/context/instructions.mjs` (105 ln). `AGENTS.md` at the project root, with `CLAUDE.md`
recognised as an **equivalent at the same precedence step**. Exactly one wins; the loser is
recorded as shadowed, because *"why is my CLAUDE.md being ignored?"* is a question the trajectory
should answer rather than a support thread. `AGENTS.md` leads because it is the neutral
cross-harness convention and this runtime is not Claude Code.

These are **always loaded**, not progressive — they are the project's standing brief, and an agent
that has to *decide* to read the build command has already had the chance to guess it wrong.

**The one thing that needed a cap.** The system prompt is rebuilt fresh every turn
(`#buildMessages`) and is never compacted away, so an oversized `AGENTS.md` would cost its full
size on *every* model call for the life of the run — silently defeating the W3 budget. Capped at
8 KB, the truncation is **announced in the text the model sees** (a truncation the model cannot
see is one it will reason past), and the recorded digest is of the **whole file**, so an edit
beyond the cap still changes the recorded identity.

## D — ecosystem compatibility and the precedence ladder

Resolved ladder, weakest to strongest: **bundled → user → project → plugin**. A later scope
overrides an earlier one of the same name; every shadowing is recorded.

Directories searched, with the ecosystem conventions read first within each scope:

| scope | locations |
|---|---|
| bundled | shipped with the runtime |
| user | `$ORION_HOME/skills`, `~/.claude/skills`, `~/.agents/skills` |
| project | `<work>/.claude/skills`, `<work>/.agents/skills`, `<work>/.orion/skills` |
| plugin | `$ORION_SKILL_PATH` (path-list) |

ORION's own `.orion/skills` is **not privileged** over the conventions — it sits alongside them at
the same scope.

### Ecosystem evidence

The acceptance test is that a skill authored for another harness loads unchanged. Two pieces of
evidence, and the second is the stronger one:

1. A `SKILL.md` written in verbatim Claude Code shape — including `allowed-tools: [Read, Grep]`,
   a key this runtime ignores — is discovered from `.claude/skills`, disclosed, and activatable
   (`shipped/W7-A/D`).
2. **Unplanned, and better:** during development the loader picked up a *real, pre-existing*
   Claude Code skill installed on this machine at `~/.claude/skills/brand-alchemy/SKILL.md`
   (3 953 B) — authored for a different harness by someone else, never touched for this wave, read
   correctly at user scope. That is third-party compatibility observed rather than constructed.

*(The shipped tests then point `HOME`/`USERPROFILE` at an empty directory, so assertions about
counts do not depend on what the developer happens to have installed. The real code path is
exercised; only the environment is controlled.)*

---

## New event types (contract v5/46 → v6/49, additive only)

Verbatim from the version header:

| type | why |
|---|---|
| `instructions.loaded` | **WHICH** project file briefed this run, with its digest. Answers "why did the agent think the build command was X?" and, because the digest is of the file, makes an edited brief visible as a different run rather than an unexplained behaviour change. |
| `skill.disclosed` | **WHICH** skills were offered, at what byte cost. The catalogue is in every request, so adding a skill to a repo changes every subsequent request digest; without this the log could not explain why. It is also where progressive disclosure is auditable: the event carries the disclosure size, not the bodies. |
| `skill.activated` | **WHICH** skill's full body entered the prompt, from **WHICH** path, on which turn. This is the §1.2 sentence, made checkable. |

None of the three changes the projection: they are provenance *about* the prompt, not messages
*in* it. Adding them to the projection would double-count — once in the prompt the worker
prepends, once in the messages it derives. Listed explicitly in the reducer rather than left to
`default`, which is documented as unreachable.

**Reserved vocabulary untouched:** `child.spawned`, `child.finished`, `context.retrieved` belong
to later waves and were not touched. Additive-only is asserted by test, not assumed.

---

## The wired acceptance (plan §10.2 W7)

All four wired at `prepareRun` — the single function `orionctl run`, `resume` and every turn of the
interactive session funnel through. A loader reachable only from a test is the failure class this
project has repeated six times in five waves, and W7 adds two loaders at once.

| # | Acceptance | Evidence |
|---|---|---|
| 1 | A skill authored for another harness loads unchanged | `shipped/W7-A/D` + the real `brand-alchemy` skill above |
| 2 | The trajectory shows which skill and which instruction file influenced which turn | `instructions.loaded` / `skill.disclosed` / `skill.activated` in the log, with paths and digests; activation sequenced after `turn.started` and followed by a `model.requested` |
| 3 | Replay equivalence at zero model calls | replay appends **no events** and every `request_digest` is unchanged; the same files rebuild a **byte-identical** system prompt; an edited `AGENTS.md` changes both prompt and recorded digest |
| 4 | Wired at the composition root | the **real `orionctl` binary**, spawned, reports `instructions: AGENTS.md` and `skills: 1 available (N B disclosed)`, and the events are in the database it wrote |

### The disclosure/activation boundary, measured in the request

The assertion that matters, made against the real outbound array captured from a scripted
provider:

- **before** activation: the body marker is **absent** from the outbound request; the catalogue
  entry is present.
- **after** activation: the body marker **is** in the outbound request.
- the body is **not** in the system prompt — it arrived as a tool result, so it is in the bounded
  projection and subject to the same budget as any other content.

## Falsification

Both load-bearing claims were broken deliberately to confirm the tests catch them:

| broken | result |
|---|---|
| Progressive disclosure (bodies inlined into the prompt) | **5 failures**, including `the whole prompt stays far under the W3 context budget — 241754 B` |
| `skill.activated` provenance (the `emits` hook removed) | **1 failure**: `skill.activated is in the log` — the skill still worked, and left no trace, which is exactly the thing §1.2 forbids |

---

## §11.2 manual gate

Real installed tarball into a clean directory, real model (**qwen3:14b via Ollama**), a real
repository carrying a real `AGENTS.md` and a real `.claude/skills/*/SKILL.md`. The user scope was
pointed at an empty directory so the gate measured *this* project's brief.

**The gate is designed to be falsifiable.** The task is deliberately under-specified — *"Add a
version constant to this project. Follow the project conventions exactly."* Nothing in the task
says what to name it or where to put it. `AGENTS.md` does, and it says something a model would not
choose on its own. The skill is checked the same way: only its **body** (never its description)
asks for a banner comment, so following it is evidence the body arrived.

### Run 1 — unprompted (the honest result)

```
── phase 2: the trajectory ──
instructions.loaded : AGENTS.md  digest=2efbdd95462ac5ca
skill.disclosed     : file-banner (312 B)
skill.activated     : none

── phase 3: verification from disk ──
files now: AGENTS.md, package.json, version.js
version.js: "export const ORION_WAVE_SEVEN_MARKER = '1.0.0';"
```

| criterion | result |
|---|---|
| run status | `completed` |
| `instructions.loaded` in the log | **true** |
| `skill.disclosed` in the log | **true** (312 B for 1 skill) |
| `skill.activated` in the log | **false** |
| created `version.js` — *AGENTS.md said where* | **true** |
| used `ORION_WAVE_SEVEN_MARKER` — *AGENTS.md said what to call it* | **true** |
| followed the skill **body** | **false** |

**Project instructions: passed decisively.** Neither the filename nor the constant name appears
anywhere except `AGENTS.md`. The model produced both. The brief reached it and steered it.

**The skill was disclosed and not activated.** That is a real negative result and it needed
diagnosing rather than explaining away — *was the tool actually offered, or was this a wiring
defect?* Measured from the run's own log:

```
tools offered to the model: 10          <-- the `skill` tool WAS in the schema
context_bytes: 1945
tool.requested read    {"path":"version.js"}
tool.requested write   {"content":"export const ORION_WAVE_SEVEN_MARKER = '1.0.0';", ...}
tool.requested verify  {"cmd":"cat version.js", ...}
```

Ten tools, not nine: the `skill` tool was offered and the model simply did not reach for it. So
this is **model behaviour, not a wiring defect** — and it has direct precedent in this project's
own measurements. Phase 5 recorded `ask_user` called **0/6 by Gemma 4 31B and 0/6 by Qwen 3.6
35B**, including 0/4 where escalating was the correct action. A 14B local model under-using an
optional tool is the same finding, not a new one.

### Run 2 — the mechanism, end to end

To separate "the model did not choose it" from "it would not have worked", the same repository was
run again with the task naming the tool:

```
  instructions: AGENTS.md
  skills: 1 available (312 B disclosed)  file-banner
  ✓ skill # Skill: file-banner # File banner convention Every source f
  ✓ write wrote version.js (79 bytes)
✓ model_finished
```

```js
// version.js, on disk
// GENERATED-UNDER-COMMIT-STYLE          <-- from the skill BODY
export const ORION_WAVE_SEVEN_MARKER = '1.0.0';   <-- from AGENTS.md
```

Both influences, from two different sources, in one file. And the provenance:

| | |
|---|---|
| `instructions.loaded` | `AGENTS.md`, digest `2efbdd95462ac5ca`, 299 B |
| `skill.disclosed` | `file-banner` @ project, with its path and digest |
| `skill.activated` | `file-banner` ← `…/proj2/.claude/skills/file-banner/SKILL.md`, digest `7a2b4653…` |
| the §1.2 question | activated at **seq 17**, with **2 model requests after it** — the turns it influenced |

**Verdict: the mechanism is PROVEN end to end with a real model. Spontaneous activation by
qwen3:14b was NOT demonstrated,** and that is recorded as a finding rather than smoothed over.
What W7 guarantees is that a skill *can* be activated, that activation works, and that the
influence is auditable. Whether a given model reaches for the catalogue unprompted is a model
property this wave does not control — and the disclosure text is the lever if it needs improving,
which is a measurable question for a later wave rather than something to assert now.

---

## Observation (out of scope, recorded not fixed)

`SYSTEM_WITH_ESCALATION_POLICY` is exported from `src/index.mjs` and **the CLI never passes it** —
`grep` count in `src/cli/index.mjs` is 0. The escalation policy measured across two model families
in Phase 5 is therefore not in the shipped system prompt. The session prompt explicitly scoped this
out of W7 and it was left alone; it is noted here because W7 touched the system-prompt assembly and
this is the obvious adjacent gap. It is the same unwired-at-the-composition-root shape as W6.1's
`pruneOrionContainers` and `ORION_IMAGE`.

## Suite

| | before | after |
|---|---|---|
| assertions | 1,351 | **1,499** |
| suites | 37 | **39** |
| failures | 0 | **0** |
| contract | v5 / 46 | **v6 / 49** |

New: `context/skills` (99 mechanism assertions), `shipped/w7-shipped` (49 wiring assertions).

One pre-existing test was adjusted: `resource/resource` pinned the contract at exactly v5/46 with
`eq`. Changed to `>=`, matching how every earlier wave's version assertion is written — a suite
whose job is proving W6's additions survive must not fail because a later wave added additively.
The additive-only property that actually protects W6 is unchanged and still asserted.

## §11.4 — what was NOT exercised

- **No live Anthropic API call.** Still no credentials in this environment (carried from W5/W6).
- **Nothing on Linux-native Docker or podman** — unchanged; this is a Windows/WSL2 host. W7 adds
  no container-dependent behaviour, so this wave does not widen that gap.
- **Bundled skills ship empty.** The `bundled` scope is implemented and tested (a bundled skill is
  correctly the weakest in the ladder) but the runtime ships none, so the scope has no production
  content behind it yet.
- **`.agents/skills` and `$ORION_SKILL_PATH` are covered by construction, not by a third-party
  artefact.** Only `.claude/skills` has a genuinely foreign skill behind it (`brand-alchemy`).
- **Skill activation was measured against a scripted provider for the assertions**, and against a
  real model only in the manual gate above. The scripted case proves the mechanism; the gate is
  what says a real model uses it.
- **SPONTANEOUS activation was not demonstrated.** qwen3:14b disclosed the skill and did not
  activate it unprompted (gate run 1); it activated correctly when the task named the tool (run 2).
  Only one model, one prompt shape and one task were tried, so this is a single observation, not a
  measurement — the honest statement is that ORION makes activation *possible and auditable*, and
  that whether models reach for it unprompted is untested beyond n=1. If it matters, the lever is
  the disclosure text, and the experiment is a proper A/B across model families of the kind this
  project ran for `ask_user` in Phase 5.
- **No skill-name collision across two *foreign* harnesses** was exercised live — shadowing is
  proven with constructed fixtures at all four scopes.
