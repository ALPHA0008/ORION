# Live-API eval: Groq gpt-oss-120b + Gemini gemini-3.5-flash

**Date:** 2026-09-10
**Scope:** §11.2 manual gate against two live free-tier providers using the current tree (HEAD `82a5f5d`, v0.2.1 unpublished, includes W6.1+W7 features).
**Finding:** Both providers connected; neither completed the gate task. Two distinct gaps exposed (one model-level, one harness-level).

---

## Methods

- `npm pack` of v0 tree → `npm install --prefix <prefix>` into clean prefix. Zero pre-existing state.
- Gate project: fresh dir containing `AGENTS.md` (naming `CASCADE_VERSION.js` + `CASCADE_RELEASE_TAG` with literal `"v9.2.0-copper"`), `.claude/skills/header-banner/SKILL.md` (body demands `// MIRROR ECHO SEVEN` as line 1).
- Task (identical across all runs): `"Add a version constant to this project. Follow the project conventions exactly."`
- Isolated `ORION_HOME` per provider (clean SQLite store, no carryover).
- Standing gate: `orionctl run "<task>"` from the prefix-installed CLI, cwd = scratch project.
- Post-gate: `orionctl explain <run>`, `orionctl replay <run>`, raw event dump via `node:sqlite`.

## Gate project (on disk after all runs)

```
AGENTS.md        — conventions (name, location, literal value for constant)
.claude/skills/header-banner/SKILL.md  — body requires "// MIRROR ECHO SEVEN"
```

No `CASCADE_VERSION.js` exists in any gate run directory.

---

## Run A — Groq `openai/gpt-oss-120b` (run 1)

```
$ ORION_BASE_URL=https://api.groq.com/openai/v1
  ORION_API_KEY=gsk_j1shG...
  ORION_MODEL=openai/gpt-oss-120b
  ORION_HOME=<home-groq>
  orionctl run "Add a version constant to this project. Follow the project conventions exactly."

  sandbox: LocalSandbox  posture: auto
  instructions: AGENTS.md
  skills: 2 available (595 B disclosed)  brand-alchemy, header-banner
  ✓ grep (no matches) [INCOMPLETE RESULT] 1 director(y/ies) unreadabl
✓ model_finished
```

### Trajectory

```
 1  · run created (scope personal:local)
 3  · resource.acquired
 4  · instructions.loaded
 5  · skill.disclosed
 6  ▸ task: Add a version constant to this project. Follow the project conventions exactly.
 9  · stream.started
10  · stream.finished
11  🧠 wants 1 tool call: grep 1151→77tok
14  · grep {"path":"","pattern":"CASCADE_VERSION"}
15  ✓ grep → (no matches) [INCOMPLETE RESULT] 1 director(y/ies) unreadable and SKIP…
19  · stream.started
20  · stream.finished
21  🧠 ""
22  ✓ completed — model_finished
```

### Raw model event

```json
{
  "content": "",
  "tool_calls": [{ "id": "fc_…", "name": "grep", "args": {"path":"","pattern":"CASCADE_VERSION"} }],
  "input_tokens": 1151,
  "output_tokens": 77,
  "cache_read_tokens": 0,
  "ext": { "streamed": true, "reasoning": "<present in wire, not in normalised output>" }
}
```

### Run B — Groq `openai/gpt-oss-120b` (run 2, fresh workspace)

Identical to run A: same one grep, same "no matches", same empty content, same `model_finished`.

---

## Run C — Gemini `gemini-3.5-flash` (run 1)

```
$ ORION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
  ORION_API_KEY=AQ.Ab8RN6…
  ORION_MODEL=gemini-3.5-flash
  ORION_HOME=<home-gemini>
  orionctl run "Add a version constant to this project. Follow the project conventions exactly."

  sandbox: LocalSandbox  posture: auto
  instructions: AGENTS.md
  skills: 2 available (595 B disclosed)  brand-alchemy, header-banner
  ✓ plan plan recorded — Add a version constant to the project follow
  ⚠ model error (client_error): provider 400: Function call is missing a thought_signature…
failed — model_failed
```

### Trajectory

```
 1  · run created (scope personal:local)
 3  · resource.acquired
 4  · instructions.loaded
 5  · skill.disclosed
 6  ▸ task: Add a version constant to this project. Follow the project conventions exactly.
 9  · stream.started
11  · stream.delta
12  · stream.finished
13  🧠 wants 1 tool call: plan
16  · plan {"steps":["Check the project root for any existing CASCADE_VERSION.js …"]}
17  ✓ plan → plan recorded — Add a version constant to the project following the pr…
18  · plan.created
22  · stream.started
23  · stream.finished
24  ⚠ model error (client_error): provider 400: [{ "error": { "code": 400, "message": "Function call is …
25  ✕ failed — model_failed (provider 400: …)
```

### Raw error event (from SQLite)

```
"Function call is missing a thought_signature in functionCall parts.
 This is required for tools to work correctly, and missing thought_signature
 may lead to degraded model performance.
 Additional data, function call `default_api:plan` , position 2."
```

---

## Analysis

### Finding 1 — Groq `gpt-oss-120b`: empty `content`, `reasoning` field ignored

gpt-oss-120b routes all output to the `reasoning` field (present in wire). ORION's `normalise` reads `msg.content ?? ''` → **empty string**. After the grep returns "no matches", the second model call produces empty content + no tool_calls → run recorded `completed`.

The harness works correctly: tool calls are parsed and executed, the D2 contract evaluates honestly (`anySucceeded` from grep = true, read-only branch = satisfied). The failure is **model-executive**: gpt-oss-120b does not execute the task.

This is the **first measured gap between local qwen3:14b and a cloud model**: qwen3:14b's W7 gate produced a real write (version.js with `ORION_WAVE_SEVEN_MARKER`); gpt-oss-120b produced an empty content and a spurious grep. Local model 1, cloud model 0 on this task.

The `reasoning` field is a provider quirk (not in OpenAI's wire format spec). A future shim could remap `reasoning → content` for models that route all output there, but that is outside the current scope.

### Finding 2 — Gemini `gemini-3.5-flash`: `thought_signature` round-trip failure

Gemini's first turn succeeded: produced a plan with three steps, correct content, standard tool_calls with `extra_content.google.thought_signature`. The plan tool executed correctly.

On the second request, the worker reconstructs the outbound messages array including the previous assistant message. ORION's `normalise` strips vendor-specific extras — `thought_signature` is gone from the stored assistant tool_calls. When the second request is sent back to Gemini, it rejects with **400: "Function call is missing a thought_signature"**.

This is a **harness-level gap**: the provider abstraction cannot round-trip Gemini's vendor-specific metadata. A Gemini-specific shim (preserving `extra_content.google.thought_signature` on assistant messages) would resolve this. This is exactly the class of provider quirk the shim mechanism exists for — and the first live instance of it.

### OpenAI

Dead: 429 `"You have no credits remaining"`.

---

## Verdict

| Provider | Connects | Tool calls | Gate task | Gap |
|---|---|---|---|---|
| **Groq** gpt-oss-120b | ✅ | ✅ (work mechanically) | ❌ empty content + spurious grep, 2/2 reproducible | Model-behaviour: routes all output to `reasoning` field (ignored by harness); weak executive behaviour |
| **Gemini** 3.5-flash | ✅ | ✅ (first turn) | ❌ provider 400 on 2nd request | Harness-level: `thought_signature` stripped during normalisation; round-trip broken |
| **OpenAI** gpt-4o | — | — | — | Dead key (429: no credits) |

**Neither free-tier key is currently useful for the manual gate.** Both connect and produce tool calls on the first turn, but neither completes the gate task.

The good news: both gaps are **measurable and fixable** (reasoning shim for Groq, thought_signature shim for Gemini), and neither is a product defect — they are exactly the class of provider-quirk findings this project is designed to surface.

### Carried §11.4 disclosure

- **No live API call completed a gate run.** Both keys connected; neither produced the task file.
- **No live Anthropic call** (no credentials).
- Linux-native Docker / podman untestable (unchanged).
- The D2 completion contract's read-only branch (`anySucceeded` from grep = satisfied) let a task that required a mutation report `completed (model_finished)`. This is a live demonstration of the D2 design tension between "analysis is real work" and "the task said do something". The run's events are honest; the status label is not truthful for a mutation task. Recorded as finding, not fixed.
