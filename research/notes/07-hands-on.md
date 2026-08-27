# Phase 8 — Hands-On Evaluation

Recorded 2026-08-26T12:50–13:40Z.
Environment: Windows 11 26100, Node v24.18.0, Python 3.13.15 (installed for this purpose),
Docker 29.5.3, Postgres 16-alpine (container `qm-audit-pg`, port 55432).

## Scope limitation — stated up front

**No model API credentials are available in this environment.** Tasks A/B/C/D/E as specified in the
brief require driving each agent through real LLM turns. I could not do that.

What I did instead, and what it is worth:
- Installed all three systems from their **published/user-facing** paths.
- Drove every subsystem that does **not** require a model call: memory, persistence, consensus init,
  skills, checkpoints, doctor, tools, exit codes.
- Ran the real test suites, including against a **live Postgres**.
- Verified statically-derived findings **empirically** where possible.

Anything requiring a live model turn is tagged **UNVERIFIABLE — no model credentials** and is not
guessed at. Token/cost/latency comparisons (Phase 10) are therefore largely unavailable; I have not
manufactured numbers.

---

## 1. Setup friction (measured)

| | QM | Hermes | Ruflo |
|---|---|---|---|
| Install path used | `npm install` from repo | `pip install -e .` from repo | `npm install ruflo` (published) |
| Packages pulled | 612 | ~65 | 397 |
| Install time | ~2 min | ~3 min | ~2 min |
| Blockers hit | none | **Python `>=3.11,<3.14`**; env had only 3.14.6 | **`workspace:*` protocol** — repo build needs pnpm (absent) |
| Workaround | — | `py install 3.13` → venv | used the published npm package instead |
| Runs without credentials? | tests yes | CLI yes | CLI yes |
| Native build required | no | no (pure-Python core) | yes (7 postinstall scripts: better-sqlite3, argon2, onnxruntime, sharp…) |

**Finding HANDS-001 (VERIFIED):** Ruflo's repo **cannot be built with npm** —
`npm error EUNSUPPORTEDPROTOCOL … Unsupported URL Type "workspace:"`. It requires pnpm.
The *published* package installs fine. So contributors face friction that users do not.

**Finding HANDS-002 (VERIFIED):** Hermes pins `requires-python = ">=3.11,<3.14"`
(`pyproject.toml`). On a Python-3.14-only machine it is uninstallable until an older interpreter is
added. Sound engineering (they pin because 3.14 is untested), but it is real friction on new
systems.

**Finding HANDS-003 (VERIFIED):** Ruflo runs **7 postinstall native-build scripts**
(`better-sqlite3`, `argon2`, `onnxruntime-node`, `sharp`, `protobufjs`, `agentdb`,
`@claude-flow/cli`). npm now warns about these by default. Largest supply-chain surface of the three.

---

## 2. Test suites — executed, not counted

### QM (no credentials needed; Postgres via Docker)

| Suite | Result |
|---|---|
| Security + policy + scope + ACL (5 files) | **63 / 63 pass** |
| Durability + harness + compaction (5 files) | **40 / 40 pass** |
| **With live Postgres** — leader-lease, advisory-lock, replay-dedupe, run-signal | **25 / 25 pass** |
| **With live Postgres** — postgres-store, cron-queue, memory-service, grant-store | **54 / 54 pass** |
| Sandbox suite | 15 / 27 pass — **12 environmental** (`sprites exec … bad envelope`, Fly.io binary absent) |
| **Full root suite, no DB** (25 min) | **4,195 tests · 3,783 pass · 247 fail · 165 skip** = 90.2% |

**Finding HANDS-004 (VERIFIED):** QM's 247 failures in the unconfigured run are **infrastructure
absence, not logic failures**. Evidence: (a) Postgres tests *skip cleanly* with the message
`# set DATABASE_URL (a Postgres) to run the Postgres store tests` — accounting for the 165 skips,
not the failures; (b) every sandbox failure traces to
`src/sandbox/sprites-sandbox.ts:149 execRaw → sprites exec … bad envelope (rc=2)`; (c) supplying a
real Postgres turned the DB-dependent suites to **79/79 pass**.

**Finding HANDS-005 (VERIFIED):** `test/security-posture.test.ts` passed **35/36 before
`npm install`** — the single failure was a missing package import. QM's security logic has almost no
infrastructure coupling. That is unusually good test isolation.

### Hermes
Not run. 3,311 test files / ~33,752 test functions; the suite requires optional extras and, for
meaningful coverage, provider credentials. **Status: UNVERIFIABLE in this environment.**
I did verify the **runtime** artifacts instead (below), which is stronger evidence than a test count.

### Ruflo
Not run. The repo cannot be installed with npm (HANDS-001) and pnpm is unavailable.
**Status: UNVERIFIABLE in this environment.** 571 Vitest files exist.

---

## 3. Ruflo — live probes

Installed published `ruflo@3.38.20`. CLI works: `ruflo --version` → `ruflo v3.38.20`.
(Note: repo-local `node bin/cli.js --help` crashes with `ERR_MODULE_NOT_FOUND … dist/src/index.js`
— the checkout has no build output.)

### HANDS-006 — "Neural Network Status (Real)" reports an inert path as Active
**Status: VERIFIED** — this is the hands-on confirmation of RUFLO-SONA-001.

`npx ruflo neural status` prints a table headed **"Neural Network Status (Real)"**:
```
| SONA Coordinator    | Active     | Adaptation: 1.14μs avg           |
| RuVector Training   | Not loaded | Call neural train to initialize  |
| SONA Engine         | Not loaded | Optional, enable with --sona     |
| ReasoningBank       | Empty      | 0 patterns stored                |
| HNSW Index          | Available  | @ruvector/core installed (loa... |
| Embedding Model     | Loaded     | Xenova/all-MiniLM-L6-v2 (384-... |
| ruvllm Coordinator  | Active     | SonaCoordinator | 0 trajectories |
```
The `1.14μs avg` is the measured latency of the transform I proved returns its input unchanged
(`evidence/benchmarks/sona_identity_proof.mjs`). The word "(Real)" in the header, next to "Active",
communicates the opposite of the code's behaviour. "SONA Engine: Not loaded" is the honest row —
the native path is absent, as static analysis predicted.

**Credit:** `ruflo neural distill --help` states plainly *"Does NOT train a model or reduce
escalation."* Someone is trying to correct the record from inside the CLI.

### HANDS-007 — Byzantine consensus persists as a string; no BFT state is created
**Status: VERIFIED** — hands-on confirmation of RUFLO-CONSENSUS-005.

```
$ npx ruflo hive-mind init -t mesh --consensus byzantine
| Consensus: byzantine |   ... Hive Mind initialized
```
The only artifact written (`.claude-flow/hive-mind/state.json`,
saved to `evidence/excerpts/ruflo-hive-mind-state.json`):
```json
{
  "initialized": true, "topology": "mesh", "workers": [],
  "consensus": { "pending": [], "history": [] },
  "consensusStrategy": "byzantine",
  "queen": { "agentId": "queen-...", "electedAt": "...", "term": 1 }
}
```
There is **no PBFT state** — no view number, no replica set, no `f`, no prepared/committed logs.
`"term": 1` borrows Raft vocabulary with no `votedFor`, no log, no peers. The working
`byzantine.ts` (with correct `2f+1` quorum) was never instantiated. Exactly as the source predicted.

### HANDS-008 — Ruflo's memory layer genuinely works, including real semantic search
**Status: VERIFIED — a genuine strength, and the strongest positive finding for Ruflo**

Cross-session test (the brief's Task C), **separate processes**:
```
session 1:  npx ruflo memory store --key research/test-key --value "phase8-crosssession-probe-value"
            → stored, "Vector: Yes (384-dim)"
session 2:  npx ruflo memory get --key research/test-key
            → returned the exact value, Access Count: 1
session 2:  npx ruflo memory search --query "crosssession probe"
            → research/test-key, score 0.84, 382 ms
```

**Is the search actually semantic?** I designed a lexically-disjoint test:
```
stored:  "The feline rested upon the woven floor covering"
query:   "cat sitting on a rug"          <- zero shared words
result:  score 0.73
```
A hash/bag-of-words embedding scores ~0 on that pair. **Only a real semantic embedding
(`Xenova/all-MiniLM-L6-v2`, confirmed loaded) produces 0.73.**

This matters for calibration: the ReasoningBank *fallback* embedding path is a hash
(RUFLO-RB-007), but the **shipped `memory` subsystem uses the real MiniLM model and works well.**
Ruflo's memory layer is a legitimately good, working component.

One quirk: the DB must be initialised first (`ruflo memory init`), and the error text refers to the
old brand — `Run: claude-flow memory init`.

### HANDS-009 — Exit codes are correct
**Status: VERIFIED — and a correction to my own earlier reading.**

An initial probe appeared to show `exit=0` on failures. That was an artifact of my shell pipeline:
`cmd | tail` returns `tail`'s status. Re-tested without a pipe:
```
memory get --key research/test-key   -> exit 0   (exists)
memory get --key nope/nope           -> exit 1   (missing)
--version                            -> exit 0
nonsensecommand                      -> exit 1   (with "Did you mean…?" suggestions)
```
**Ruflo's exit codes are correct.** No defect. Recording the false start per the brief's
requirement to log dead ends.

---

## 4. Hermes — live probes

Installed from repo into a Python 3.13.15 venv. `hermes --help` lists **~80 subcommands**.

### HANDS-010 — The SQLite schema matches the source exactly
**Status: VERIFIED** — live confirmation of HERMES-STATE-006.

Opening the created `state.db` directly:
```
TABLES(22): async_delegations, compression_locks, gateway_hygiene_state, gateway_routing,
            messages, messages_fts, messages_fts_config, messages_fts_data, messages_fts_docsize,
            messages_fts_idx, messages_fts_trigram, messages_fts_trigram_*,
            schema_version, session_model_usage, session_turn_leases, sessions,
            sqlite_sequence, state_meta, system_prompts
schema_version: [(26,)]
```
All 11 declared tables materialise, `SCHEMA_VERSION = 26` matches `hermes_state_common.py:329`
exactly, and FTS5 indexes (including a **trigram** variant) are built. Critically,
`async_delegations` and `session_turn_leases` exist as real tables — the durable-delegation and
lease claims are implemented, not aspirational.

`HERMES_HOME` layout confirms the architecture: separate `sessions/`, `memories/`, `skills/`,
`logs/curator/`, plus `cache/tool_discovery_cache.json` (the AST tool-discovery cache from
HERMES-TOOLS-005) and `cache/schema_columns.json` (the migration reconciler's cache).

### HANDS-011 — `hermes doctor` is exceptional operational tooling
**Status: VERIFIED — best-in-class among the three**

```
◆ Python Environment
  ✓ Python 3.13.15
  ⚠ SQLite 3.50.4 (WAL-reset bug) (run `hermes update`; fixed versions: 3.51.3+ / 3.50.7 / 3.44.6
    — see https://sqlite.org/wal.html#walresetbug)
    → SQLite source id: 2025-07-30 19:33:53 4d8adfb30e03f9cf27f800a2c1ba…
◆ Security Advisories        ✓ No active security advisories
◆ MCP Server Security        ✓ No suspicious MCP stdio commands
◆ SSL / CA Certificates      ✓ SSL CA certificate bundle is valid
◆ xAI Model Retirement (May 15, 2026)  ✓ No retired xAI models in config
```
It detected a **specific upstream SQLite WAL-reset bug by version and source id**, named the exact
fixed versions, and linked the advisory. It also screens MCP stdio commands for suspicious
invocations and checks for retired models by date. This is knowledge that only exists after
production incidents. **Neither QM nor Ruflo has anything comparable.**

### HANDS-012 — Checkpoints are live and operationally managed
**Status: VERIFIED** — confirms the git-shadow-repo design.

`hermes checkpoints --help`:
> "Manage the filesystem checkpoint store — the shadow git repo hermes uses to snapshot working
> directories before `write_file`/`patch`/`terminal` calls. Lets you see how much space checkpoints
> occupy, force a prune, or wipe the base."
Subcommands: `status`, `prune`, `clear`, `clear-legacy`.

The presence of `prune`, a GC, and a `clear-legacy` migration path shows this ran into real disk
pressure in production and was hardened.

### HANDS-013 — Toolsets are real and user-gateable
**Status: VERIFIED.** `hermes tools list` shows toolsets with per-set enable/disable state
(terminal, file, code_execution, vision, image_gen, tts, skills, todo, memory, session_search,
clarify, delegation, cronjob, computer_use enabled; video, video_gen, x_search, stt,
context_engine, homeassistant, spotify, yuanbao, a2a disabled). Matches `toolsets.py` gating.

### HANDS-014 — Skills store starts empty, with a Trust column
**Status: VERIFIED.** `hermes skills list` → `0 hub-installed, 0 builtin, 0 local — 0 enabled, 0
disabled`, with columns `Name | Category | Source | Trust | Status`. The **Trust** and **Source**
columns are the surface of `skill_provenance.py` — provenance is a first-class user-visible concept,
which matters when the agent writes its own skills.

### HANDS-015 — Clean failure at the credential boundary
**Status: VERIFIED.**
```
$ hermes -z "say hello"
hermes -z: agent failed: No inference provider configured. Run 'hermes model' to choose a provider
and model, or set an API key (OPENROUTER_API_KEY, OPENAI_API_KEY, etc.) in ~/.hermes/.env.
$ echo $?   -> 1
```
Names the problem, names the fix, names the env vars, exits non-zero. Correct.

---

## 5. QM — live probes
Tests only (above). QM's runtime surface is a Slack app + HTTP API requiring Postgres, Slack
credentials and model credentials; I ran its logic through the test suite rather than the surface.
**Live agent behaviour: UNVERIFIABLE — no model credentials, no Slack workspace.**

---

## 6. Brief tasks A–E: status

| Task | Status | Note |
|---|---|---|
| **A** Multi-step file editing | **UNVERIFIABLE** | needs model credentials |
| **B** Tool failure / recovery | **PARTIAL** | verified *credential-boundary* and *bad-input* failure handling in Hermes + Ruflo (clean messages, correct exit codes). In-loop tool-failure recovery not exercised. |
| **C** Two-session task | **PARTIAL → VERIFIED for Ruflo memory** | Ruflo cross-session store/get/search across separate processes works (HANDS-008). Full two-session *agent task* not run. |
| **D** Crash recovery | **PARTIAL** | QM's mechanism verified by test against live Postgres (25/25 lease + advisory-lock + replay-dedupe). Not exercised by killing a live agent mid-run. |
| **E** Context pressure | **UNVERIFIABLE** | needs long model-driven runs |

## 7. Phase 10 (performance/cost): not attempted
Every metric in that phase (LLM invocations, input/output tokens, cost per successful task,
retries) requires live model runs. **No numbers are reported rather than estimated.**
The one measured performance figure: Ruflo semantic search **382 ms** over a 2-entry store —
too small to generalise from, reported only for completeness.

## 8. What was NOT done
- No live agent task on any of the three systems.
- Hermes and Ruflo test suites not executed (reasons above).
- QM's Slack surface, deploy paths, and AWS/Fly sandboxes not exercised.
- No crash-injection against a running agent process.
- Docker container `qm-audit-pg` left running; remove with `docker rm -f qm-audit-pg`.
