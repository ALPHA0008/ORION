# Continuation — close Wave 10 (hosted end-to-end + wave closeout)

> Handoff to Claude from opencode (big-pickle), continuing the same session that delivered A1 and
> the partial A2. Read `w10-gaps-handoff-to-claude.md` first for the design rationale; this file
> only covers what changed since.
>
> **The user will hand over a NEW Groq key.** It is the last missing input for the closing gate
> (Hive is still down, so Groq carries the gate). Do not synthesize, guess, or reuse-key-hammer:
> if the key isn't in hand when you start, ask for it.

---

## Current position (facts to preserve — do not re-run W1-W9 closing verdicts, do not re-litigate)

### A1 — TRUE CONCURRENCY: DONE, verified
- `v0/src/agent/loop/worker.mjs` — dispatch loop batches a maximal run of consecutive
  `delegates: true` tool calls via `Promise.all`; all other tools keep the sequential path and its
  per-call X5 cancel checkpoint. Batching the whole array was rejected because X5 requires a
  turn's second tool to never start when the signal aborts during the first; delegates are safe to
  batch because a child can never escalate (`ask_user` is forbidden to children), so a batch
  cannot park mid-way.
- `v0/src/core/run/store.mjs` — `reserveChildSpawn`: quota verdict + child `runs` row +
  `run.created` + `child.spawned` commit in ONE IMMEDIATE transaction with the lease checked
  inside; a refusal writes nothing. Used to race: three racers could read "0 running" and all
  spawn past `MAX_LIVE_CHILDREN`.
- `v0/src/core/child/executor.mjs` — pre-flight `canSpawn` + two separate writes collapsed into
  one `reserveChildSpawn`; policy resolution and everything after the spawn untouched.
- Tests: `tests/subagent/parallel.test.mjs` (NEW), `tests/shipped/w10-shipped.test.mjs`
  (+7: batch path through the real composed toolset), `tests/run-all.mjs` (registers the suite).
- **Green:** `npm test` → TOTAL **2305 passed, 0 failed, 50 suites** (baseline 2253/49, +52);
  `npm run typecheck` → 0 errors; `npm run lint` → clean; `EVENT_TYPES = 49`, vocabulary diff
  empty. X5 (`leaseheartbeat`) and `escalationgate` pass unchanged — the batch is narrow enough
  not to touch them.
- Concurrency proof detail worth preserving: the naive "both arrived" assertion was falsified by
  disabling the batch (sequentially the first child times out at the barrier, fails, then the
  second arrives) — the final proof uses **peak simultaneous occupancy = 2 with batching, 1
  without**, failing loudly. A test that can't fail isn't evidence.

### A2 — HOSTED CHILD: PARTIALLY CLOSED, one honest residual gap
- DONE: a real hosted model's child reached `completed` — parent `run_#8bc82aa07f`, child
  `run_561ecd36d7`, `openai/gpt-oss-120b`, 5560 tokens, 4 tool calls, `runs.status = completed`,
  container sandbox, installed build; the parent folded the child's success into its window and
  narrowed the child to 3 tools / posture `auto` (stricter than its own permissive) unprompted.
- RESIDUAL (the WAVE IS NOT CLOSED until this is fixed): the **parent's own terminal completion
  after delegating**. Five attempts died on provider walls — Hive 500 (endpoint down all day),
  Groq per-minute token ceiling, Gemini free-tier 429 — plus ONE `gpt-oss` reasoning leak that the
  loop read as a final answer. Do NOT fake this; it stays an honest §11.4 ledger entry until a run
  exists where the PARENT also terminates `completed` with a genuine final answer.

### Repo state
- HEAD = `93703bd` "Wave 10: subagents as child trajectories, bounded by design".
- **Nothing committed, nothing staged.** A1 lives in the three modified source files above plus the
  three test files (`parallel.test.mjs` new; `w10-shipped.test.mjs`, `run-all.mjs` modified).
- `v0/tests/results-*.json` modified/untracked — **leave untouched** (churn by design).
- `research/productization/`, `research/corpus/`, `archify-out/`, `v0/tests/wg-fixtures/`,
  `v0/tests/wg-homes/` untracked by design. The gate fixture carries its own `package.json`
  because the repo's `"type": "module"` breaks CommonJS fixtures.
- Vault (`C:\Users\abhijith.p\.orion-keys\keys.json`): 17 keys. Hive 1..7 all healthy BUT
  endpoint-wide 500 (server fault — never de-count). Gemini a/b + 1..5 live 200 (a/b were cleared
  of a stale `quotaExhausted` after they probed 200). `groq-1` live (200, `openai/gpt-oss-120b`).
  `rotation.utcToday` = 2026-09-16. The file carries a **UTF-8 BOM** — strip it for reading, restore
  it on write (already documented in `context-and-key-usage-guidelines.md`).

---

## Milestone A3 — close the wave: a hosted run where BOTH parent and child reach `completed`

### A3.1 The new Groq key is ALREADY in the vault as `groq-2`
- It was provided by the user, probed the established way (bare `POST {baseUrl}/chat/completions`,
  model **`openai/gpt-oss-120b`** — the bare id `gpt-oss-120b` → HTTP `404 model_not_found`) and
  returned **200** with real `content` (`finish=stop`, separate `reasoning` field — note a 10-token
  budget gets eaten by reasoning and empties `content`). It is graduated healthy
  (`quotaExhausted: false`, `dead: false`, `lastUsed: "2026-09-16"`), BOM preserved.
- Do NOT re-add it. Run your normal before-gate auth probe as belt-and-braces, expect 200, then use
  **`groq-2` first** and alternate to `groq-1` on any retry (per-minute token ceiling mitigations
  in A3.2).
- If the pre-gate probe is anything other than 200, report and do NOT hammer it — space out the
  gate on `groq-1` or report the gate BLOCKED.

### A3.2 The closing gate (hosted end-to-end)
Procedure per `research/productization/wave10-subagents-parallel-prompt.md` (§11.2 pattern) plus:

- **Build from the CURRENT WORKING TREE** (uncommitted A1 must be in the package — `npm pack`
  packs the working tree, so this happens naturally). Pack → install into a clean prefix, e.g.
  `C:\Users\abhijith.p\AppData\Local\Temp\opencode\w10-close-install`. After install, verify the
  A1 code is actually in it: grep the installed bundle for `reserveChildSpawn` and for the
  `'after delegation batch'` cancel checkpoint. If the existing `w10-install` predates A1, ignore
  it and use this fresh build.
- Fresh fixture + home: `wg-fixtures/w10c` (with its own `package.json`; CommonJS works then) and
  `wg-homes/w10c`. Keep the delegated task SMALL and bounded — the point is a parent that
  delegates once to a child (read a small file / trace a 1-hop call / verify a fact) and then
  closes with a real final answer containing the specifics.
- **Token-ceiling strategy (the thing that killed the 5 earlier attempts):** Groq enforces a
  per-minute TOKEN ceiling, not just per-call. Mitigations: (1) alternate keys per run — `groq-2`
  first, `groq-1` on any retry; (2) one run at a time, spaced out; (3) keep every call small
  (default `maxTokens` 2048 is fine — do not raise); (4) if a `429` appears, wait the indicated
  window or rotate, never blind-retry.
- **Reasoning-leak mitigation:** `gpt-oss` writes thinking to `reasoning`; the shim fires
  (`degraded`, `reasoning-as-content`) when thinking lands in `content`. If the PARENT's final
  answer is empty or reasoning junk, the run is a FAILED attempt (possibly `finished_without_change`),
  not a completed one — record it and retry with a task that forces real content ("final message
  must state the concrete finding with paths and numbers"). Never report a reasoning-only response
  as a completion.
- **Acceptance (verify three ways, all three required):** (1) `runs` rows: parent AND child
  `status = completed`; (2) event logs: parent has `run.completed`, plus exactly one
  `child.spawned` → one `child.finished` (`status: "completed"`), child log ends `run.completed`;
  (3) disk: the child's deliverable (file/answer) is present and correct, confirmed by replaying
  the parent log and by `orionctl explain`.
- Record: run ids, model, keys used (by id), event/model/tool/token counts, sandbox class, verdict.

**If the parent's terminal completion STILL cannot be achieved after rotating both Groq keys
(and only if it genuinely cannot):** stop, do not invent evidence, and leave the §11.4 entry as
BLOCKED with the exact probe/error sequence. Prefer a fully honest gap over a laundered pass — that
is this project's stated discipline (ADR-013).

### A3.3 Honest ledger + docs
- `research/productization/wave10-subagents-parallel-report.md` §11.4: close the **true-concurrency**
  entry (cite the parallel suite + the peak-occupancy proof, 45+7 assertions, X5/escalation
  untouched); update the **hosted child** entry with `#8bc82aa07f` / `run_561ecd36d7` and the new
  A3 run; mark the **hosted parent-terminal** entry as either CLOSED (with the new run cited) or
  BLOCKED (with the exact walls hit). Every §11.4 edit must stay truthful — no entry may be
  closed without a disk-verified run behind it.
- `research/productization/context-and-key-usage-guidelines.md`: add `groq-2` to the §3 table,
  refresh `lastUsed` for keys actually used, note the `openai/gpt-oss-120b` id requirement and the
  verified Groq behavior (424 model id, `{role, content, reasoning}` shape, reasoning leak, 10-token
  budget empties content) if not already captured. Keep the BOM note accurate.

### A3.4 Final green check
- Re-run the full suite + typechecks exactly as A1 did: `npm test` (expect ≥ 2305/0/50 — nothing in
  A3 should change source), `npm run typecheck` (0), `npm run lint` (clean), vocabulary diff empty.
- From `v0`, with the Git Bash PATH prefix
  (`$env:PATH = "C:\Users\abhijith.p\AppData\Local\Programs\Git\bin;C:\Users\abhijith.p\AppData\Local\Programs\Git\usr\bin;$env:PATH"`).
- Confirm `git status`: no source churn beyond the A1 file set; `results-*.json` untouched; nothing
  staged.

### A3.5 Close the wave — but ASK first
- Prepare the exact commit that closes W10: files =
  `v0/src/agent/loop/worker.mjs`, `v0/src/core/child/executor.mjs`, `v0/src/core/run/store.mjs`,
  `v0/tests/subagent/parallel.test.mjs` (new), `v0/tests/shipped/w10-shipped.test.mjs`,
  `v0/tests/run-all.mjs`. (Do NOT include `results-*.json`, `research/`, `archify-out/`,
  `wg-fixtures/`, `wg-homes/`.)
- Propose the commit message in the repo's existing style (see the `git log` convention: short
  imperative summary line, no body needed unless the change calls for it — e.g.
  "Wave 10 close: true child concurrency + hosted end-to-end completion").
- **Do not commit, amend, stage, or push without the user's explicit go-ahead.** Present the file
  list + message and ask.

## Standing rules (same session, unchanged)
Never echo key values; commit only when explicitly asked; never `git add -A`; never touch
`v0/tests/results-*.json`; `research/`, `archify-out/`, `research/corpus/`, `wg-fixtures/`,
`wg-homes/` stay untracked; event vocabulary is closed (v6/49 — no new types); a 500 on a bare
probe is a server fault, never a reason to mark a key exhausted/dead; provider walls end a run
honestly, they never become a laundered pass.