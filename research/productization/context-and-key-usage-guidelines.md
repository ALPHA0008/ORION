# Key Vault, Rotation Strategy, and Live-Gate Testing Context for Executing Agents

**Purpose:** This document gives any executing agent (Claude, etc.) the full context needed to use
the hosted-model Hive keys correctly when running W1-W9 live gates or W10's §11.2 manual gate. It
is supplementary to the per-wave session prompts — read it alongside
`wave10-subagents-parallel-prompt.md` when doing real-model work.

**Date of last update:** 2026-09-16

---

## 1. Where the keys live

Vault: `C:\Users\abhijith.p\.orion-keys\keys.json` (OUTSIDE the repo, never commit, never echo
into a transcript, never paste a key value into a report).

The vault is a plain JSON with `rotation` policy metadata + a `keys` array. Each key has:
`id`, `provider`, `label`, `key` (the secret), `baseUrl`, `lastUsed` (YYYY-MM-DD), `quotaExhausted`,
`dead`.

- Read vault: `Get-Content "C:\Users\abhijith.p\.orion-keys\keys.json" -Raw`
- Update `lastUsed` after a run uses the key, `quotaExhausted` when a 429/insufficient-quota shows
  up, `dead: true` when the key provably stops working.

## 2. Key rotation strategy

**The rules (from the vault's own `rotation` field):**
- **One provider key per UTC calendar day for long tasks.** Do not hammer a single key.
- A key marked `quotaExhausted: true` is skipped until its `lastUsed` date changes (i.e. when the
  daily quota window resets the next UTC day).
- `dead: true` keys never rotate back in.
- On the same day, prefer the key with the OLDEST `lastUsed` (rotate across keys) to spread load.
- When several runs must run back-to-back, alternate keys per run rather than reusing the same one
  repeatedly — hammering one key fast in sequence has produced spurious 401s on the Hive endpoint
  (see §5).

**Practical rotation loop for a gate:**
1. Read the vault, pick a live key (`!dead && !quotaExhausted`) with the oldest `lastUsed`.
2. Use it for the run; afterwards update its `lastUsed` to today's date (UTC).
3. If a run errors `provider 401` or `429` and the key was just used, that is the daily-quota or
   rate signal — rotate to the next live key and retry (for genuine provider flakes see §5 rule 3).

## 3. The live key set (as of 2026-09-16)

| id | provider | baseUrl | status |
|---|---|---|---|
**Re-probed 2026-09-16 during the W10-A2 gate** (bare `POST /chat/completions`, one call per key):

| id | provider | baseUrl | status |
|---|---|---|---|
| `hive-1..6` | hive | `https://api.thehive.ai/api/v3` | **500 — ENDPOINT OUTAGE**, all six. Keys stay HEALTHY: a bare probe returning 500 is a server fault, and `hive-6` was never-used and 500'd on its first-ever request, which exhaustion (429/403) cannot explain. Do **not** de-count them. |
| `gemini-a` | gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | LIVE (200) — daily counter had reset, `quotaExhausted` cleared |
| `gemini-b` | gemini | same | LIVE (200) — as above |
| `gemini-1..3` | gemini | same | LIVE (200), reserve, never used |
| `gemini-4`, `gemini-5` | gemini | same | LIVE (200); used by the W10-A2 gate, `lastUsed` 2026-09-16. Free tier **429s on rapid successive calls** — a child making several back-to-back model calls will hit it. |
| `groq-1` | groq | `https://api.groq.com/openai/v1` | LIVE (200); used by W10-A2/A3, `lastUsed` 2026-09-16. See the Groq notes below. |
| `groq-2` | groq | `https://api.groq.com/openai/v1` | LIVE (200, real `content`); **carried the W10 closing gate** (`run_c2d5c197e4`), `lastUsed` 2026-09-16. |
| `openai-1` | openai | `https://api.openai.com/v1` | **DEAD** (no credits) |
| `openai-2` | openai | `https://api.openai.com/v1` | **DEAD** (no credits) |

**Gemini model id:** `models/gemini-3.6-flash`. `models/gemini-2.5-flash` now 404s for new users —
the provider's own error names 3.6-flash as the replacement.

**Groq, measured during the W10 gates — read before planning a delegating run:**

- **Model id must be `openai/gpt-oss-120b`.** The bare `gpt-oss-120b` returns `404 model_not_found`.
- **The binding limit is TOKENS PER MINUTE, not requests:**
  `Rate limit reached … service tier on_demand on tokens per minute (TPM): Limit 8000, Used 7344`.
  A delegating run that also edits and verifies needs ~11k and therefore **cannot fit in one
  window** — it will die partway with `model_unavailable` no matter how the keys are rotated.
  Plan hosted delegation gates as *small* runs (a parent that delegates once and answers is ~5k),
  space runs ≥90s apart, and alternate `groq-2` → `groq-1`.
- **Response shape is `{role, content, reasoning}`.** Thinking goes in `reasoning`; when it lands in
  `content` the `reasoning-as-content` shim fires and is recorded as `degraded`. A short
  `max_tokens` (e.g. 10) is consumed by reasoning and leaves `content` **empty** — probe with ≥200.
- **A reasoning-only reply is not a completion.** `gpt-oss` sometimes emits thinking as its final
  message ("We need to see repository structure. Let's list root.") and the loop reads it as a final
  answer. Treat such a run as a failed attempt, never as a pass.

**Gemini, measured the same day:** the free tier caps **requests**, so a child making several rapid
back-to-back calls hits `429` even with token headroom; a verbose child can also over-plan straight
into `max_turns`. Cap `subagents.maxTurns` low (3–6) for hosted gates.

**Vault encoding:** `keys.json` is written by PowerShell and carries a **UTF-8 BOM**.
`JSON.parse(fs.readFileSync(...))` throws on it; strip `﻿` before parsing and re-add it on
write, or the file's encoding changes under the PowerShell tooling.

**Model used by all Hive keys:** `zai-org/glm-5.3-flash`, served from the OpenAI-compatible Hive
endpoint. Supports streaming (SSE), tool_calls, and reasoning. The Hive auth header is a plain
opaque token; the direct `chat/completions` probe shape is the standard OpenAI one with
`"model": "zai-org/glm-5.3-flash"`.

**Auth verification pattern** (used for every new key before trusting it): a direct
`curl`/`Invoke-RestMethod` POST to `{baseUrl}/chat/completions` with a 1-token follow-up prompt;
expect `200` + usage fields. Run it BEFORE each gate and, if something odd happens mid-run, run it
AGAIN to prove/disprove key validity (this is how the W3b 401 was diagnosed as provider-side).

## 4. How a live gate is run (the pattern used for W1-W9)

1. **Build:** `npm pack` the current tree → install into a clean prefix (e.g.
   `C:\Users\abhijith.p\AppData\Local\Temp\opencode\w10-install`), same as `w9-install` =
   `@kernlbase/orion 0.2.1` from HEAD `682b345`.
2. **Fixture:** fresh project dir under
   `C:\Users\abhijith.p\AppData\Local\Temp\opencode\wg-fixtures\` (e.g. `wg-fixtures/w1` for the
   calc.py family). Baseline the files, then deliberately break the code the task asks the model
   to fix.
3. **ORION_HOME:** a per-gate fresh home under `C:\Users\abhijith.p\AppData\Local\Temp\opencode\wg-homes\`.
4. **Provider config** (`orionctl` config or env): model `zai-org/glm-5.3-flash`, baseUrl
   `https://api.thehive.ai/api/v3`, key from §3, provider `hive`.
5. **Run** the task through the installed CLI with the real model (LocalSandbox for python gates,
   ContainerSandbox/`--network none` for W6/W9-style gates).
6. **Verify** the outcome three ways: the run's own `verify` tool, replay of the run's event log,
   and on-disk inspection (the fixed file content, the created artifact, etc.).
7. **Record** the result in the wave-gates report (§6 below); update the vault `lastUsed`.

Full-suite prerequisite on this host (from Git Bash, not WSL): prepend the Git Bash bin so the
shell preflight resolves bash to Git Bash:
`PATH=C:\Users\abhijith.p\AppData\Local\Programs\Git\bin;C:\Users\abhijith.p\AppData\Local\Programs\Git\usr\bin;$PATH`

## 5. Known provider behaviour and flakiness — READ BEFORE RUNNING

- **The Hive endpoint is generally solid for clean runs.** W1/W2/W3a/W4/W6 all passed first try
  (~1 gate each, 8-14 tool calls, 6-12 model calls).
- **The reproducible W3b flake:** the model call *immediately after a failed (exit-1) bash tool
  result during a RESUME* errors `401 {"message":"Authorization REDACTED mismatch"}` (sometimes
  `Authorization header missing`), 5/5 attempts across 3 different keys. The key itself is
  provably valid before and after (direct probe returns 200). Classification: provider-space
  intermittency concentrated at that exact replay point. **Do not chase vault drift or key
  rotation when you hit this** — it is not the key. Report it and classify
  `retryable:false` on a spurious post-failure 401 as the actionable item. Full step-by-step
  trace of the flake, the exact task, the attempt/key breakdown, and what it IS and ISN'T: §6.3.
- **Rate hammering:** several runs hitting the endpoint in quick succession produce
  `409/429-looking` 401s on replay. Mitigation: rotate keys per §2 and space runs out.
- **Daily quota:** 403/429 `"insufficient_quota"`-style errors mean the day's quota for that key
  is spent → mark `quotaExhausted`, rotate to another key, or wait for the next UTC day.
- **Never re-run the closing verdict of W1-W9** — the evidence is recorded (§6). New gate work is
  W10's §11.2 manual gate only.

## 6. What the live gates already proved (do NOT re-run) — FULL RESULTS

All recorded in `wave-gates-hive-rerun.md` (2026-09-16), all on `zai-org/glm-5.3-flash` via Hive
(OpenAI-compatible streaming SSE endpoint). Harness build: `w9-install` = `@kernlbase/orion 0.2.1`
packed from HEAD `682b345` (incl. MCP SDK 1.30.0 + streaming shim). Sandbox: `LocalSandbox` for
python gates, `ContainerSandbox` (node:20-slim, `--network none`) for W6/W9.

### 6.1 Summary table (with counts)

| Gate | Run | Key | Status | Events | Model calls | Tool calls | Tokens (in/out) | Verdict |
|---|---|---|---|---|---|---|---|---|
| W1 pytest fix | `#12fa3b3b4b` | hive-1 | completed / model_finished | 109 | 6 | 8 | 13023/426 | **PASS** |
| W2 fix+prove | `#25da7711c5` | hive-1 | completed / model_finished | 91 | 7 | 9 | 14966/367 | **PASS** |
| W3a compact | `#1d4f916cfa` | hive-1 | completed / model_finished | 154 | 12 | 14 | 48456/774 | **PASS** |
| W3b artifact | (none) | hive-1, -2, -3 | failed — provider 401-on-resume | — | — | — | — | **BLOCKED (provider flake, 5/5)** |
| W4 pytest fix | `#d135515a2c` | hive-4 | completed / model_finished | 114 | 8 | 8 | 17476/424 | **PASS** |
| W6 node container | `#3a7e9fc6e2` | hive-5 | completed / model_finished | 92 | 8 | 8 | 17669/365 | **PASS** |
| W7 version-constant | `#2866b8f4c7` | hive-1 | completed / model_finished | — | 11 | 15 | 28203/2081 | **PASS** |
| W9 MCP gate | `#952f3060c2` | (vault) | completed / model_finished | 53 | — | — | — | **PASS** |

Goodpass budget for a single calc-fix gate: ~13-18k input tokens, 6-8 model calls, 8-9 tool
calls, one shot. ~$0.01-0.02 per gate. Ample headroom across 5 keys for W10's manual gate.

### 6.2 What each gate proved, in full

**W1 (`#12fa3b3b4b`) — truthful completion.** Read `calc.py` + `test_calc.py` (2 reads), planned 3
steps, edited the bug, `verify PASS (exit 0) py -m pytest -q . [100%] 1 passed`. Disk-verified:
`calc.py` now `return a + b`. **No gap — hosted model completes the W1 gate exactly as local
models did.**

**W2 (`#25da7711c5`) — planning + proof.** Planned ("Fix calc.py so add returns a + b, then prove
it"), globbed, grepped, read both files, edited, stepped plan to done, `verify PASS`. All 3 plan
steps closed with evidence. **No gap — planning tools work identically with a hosted model.**

**W3a (`#1d4f916cfa`) — context/artifacts (read-paging half).** Hosted model read `big_module.py`
**in 5 full slices** (lines 62-125, 126-180, 181-242, 243-300) — exactly the read-paging behaviour
the compact gate exercises — then fixed calc.py and `verify PASS` (2 passed: calc + big_module's
own `add`). No artifact created (correct — read-paging alone doesn't overflow). **No gap — the
paging path that needed a long-context model works.**

**W4 (`#d135515a2c`) — providers/provenance/streaming.** Same fixture family, streaming provider
(Hive SSE). 8 tool calls, all verified through replay. **No gap — second hosted streaming provider
besides Gemini confirmed on a real gate.**

**W6 (`#3a7e9fc6e2`) — execution environment (container).** `add() uses - instead of +` in
`math.js`; fix → `verify PASS (exit 0) node test.mjs ALL PASS`. Ran under **ContainerSandbox**
(node:20-slim, isolation container, `network: none`, limits cpus 1.0/mem 512m/pids 256) — the same
isolation class as the W9 MCP gate. Atomic steps, no approval hump, no resource-lost. **No gap —
W6 container gate passes cleanly with a hosted model on the first try.**

**W7 (`#2866b8f4c7`) — skills + version constant.** Hosted model read AGENTS.md, activated
`header-banner`, wrote `version.js` (176 B, `export const VERSION = "v9.2.0-copper"`), verified.
**No gap (prior session's E1).**

**W9 (`#952f3060c2`) — MCP real-model gate.** A real hosted model autonomously chose
`mcp__demo__echo` inside the container sandbox — self-directed tool choice, not scripted. 53
events, `completed / model_finished`. **No gap — MCP servers as W6 resources work end-to-end with
a live hosted model.**

### 6.3 W3b — the one gate that did NOT pass, honest record

Task (verbatim): *"Run 'py -m pytest -q -s noisy_test.py' to see the failure output, then fix add
in calc.py to return a + b, then run it again to prove it."*

Attempted **5 times** (homes `w3b`, `w3b2`, `w3b3`, `w3b4`, `w3b5` / keys hive-1, hive-1, hive-1,
hive-2, hive-3). **Every single attempt followed the SAME trace:**

1. model plans ("Fix the failing add()...") — ✓
2. model asks to run the noisy test; harness pauses with `bash cannot be safely retried after a
   crash` (the exit-1 noisy failure is classified as not-safely-retryable → human gate) — ✓
3. human approves; `bash` runs; output shows the noisy lines — ✓
4. **the NEXT model response errors:** `provider 401: {"status_code":401,"message":
   "Authorization REDACTED mismatch"}` (resume runs sometimes report `Authorization header missing`)
   → `model_failed`, `retryable: false` — ✕

The key itself is provably valid: direct `chat/completions` probes with the same key return `200`
with usage both before and after each failed run, on all 5 keys.

**What this is:** a Hive provider-space intermittency concentrated at exactly the model call
*after* a failed (exit-1) tool result during a **resume**. All four clean passes (W1/W2/W3a/W4) —
and W6, which never pauses — stream through fine. The failure has never appeared mid-run on a
smooth path; it only strikes the resumption call. Three different keys got the same 401, so it is
not vault drift.

**What it is NOT:** not a harness defect, not a vault/key problem, not a model-quality failure
(the model's *work* — plan, edit location, fix content — was correct before the provider died; the
file was left edited correctly on disk at every attempt).

**Actionable follow-up (already logged, belongs to W10-era classification work):** treat the
"resume immediately after an exit-1 tool result" case as a retryable provider class on Hive (or
add a small backoff on 401s during replay), so the gate can finish autonomously. Both the harness's
`retryable:false` classification of a spurious provider 401 and its threading through a human-
approval prompt are the actionable bits. **Do not re-litigate W3b's model behaviour — it is not in
doubt.**

## 7. Host/tooling environment facts

- OS win32, shell PowerShell 5.1 for the operator; inside the harness, `bash` resolves to
  **WSL** (`C:\Windows\System32\bash.exe`), NOT Git Bash. Full-suite runs must prepend Git Bash
  bin to PATH (see §4) so the sandbox's shell-preflight test sees Git Bash.
- WSL python 3.14.4 had pip + pytest 9.1.1 bootstrapped with `--break-system-packages`, plus a
  `/home/abhijithp/.local/bin/py` shim so the literal gate command `py -m pytest -q` works.
- `node` is NOT resolvable by bare name inside WSL (`node.exe` only) — irrelevant for container
  gates (node:20-slim) but a known quirk for local bash.
- Docker Desktop's WSL2 engine is alive for container gates.
- Gate fixture dirs: `C:\Users\abhijith.p\AppData\Local\Temp\opencode\wg-fixtures\` (w1..w7).
  Per-gate homes: `...\wg-homes\`.
- Builds: `w9-install` (HEAD `682b345`, has MCP SDK), `w8-install2` (W8 era) — both under
  `C:\Users\abhijith.p\AppData\Local\Temp\opencode\`. A W10 build should be `w10-install`.
- Standing repo rules: `research/`, `archify-out/`, `research/corpus/` stay untracked; do not
  stage `v0/tests/results-*.json` (suite output churn); commit only when explicitly asked;
  contract is additive-only (currently v6/49).

## 8. Standing security rules for keys

- Never paste a key value into a transcript, a report, a commit, or a chat message.
- Refer to keys by id (`hive-1`) in any written record.
- The vault is ACL-restricted to the user account; do not change its permissions.
- The Hive keys are paid org credits. Treat them as finite, shared budget: prefer the
  smallest-number-of-calls path for any gate (plan first, don't iterate on model feedback loops).