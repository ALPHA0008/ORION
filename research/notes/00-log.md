# Research Log

All timestamps UTC. Every action recorded, including dead ends.

---

## 2026-08-26T11:15Z — Phase 0: Setup

- Created `research/{repos,notes,evidence,runs}` + evidence subdirs.
- Cloned all three repos with `--filter=blob:none` (treeless: full history, blobs on demand).

**Checkout sizes (files written by git):** qm 1,366 · ruflo 5,607 · hermes-agent 10,371.

## 2026-08-26T11:18Z — Pinned state

| Repo | HEAD | Branch | First commit | Last commit | Commits | Tags | Latest tag |
|---|---|---|---|---|---|---|---|
| qm | `c7caba56` | main | 2026-07-29 | 2026-08-25 | 176 | 4 | v0.1.5 |
| hermes-agent | `d62a05e9` | main | 2025-07-22 | 2026-08-26 | 25,451 | 35 | v2026.8.19 |
| ruflo | `e21aa352` | main | 2025-06-02 | 2026-08-24 | 7,396 | 1,635 | v3.38.20 |

Evidence: `evidence/commands/phase0-pinned-state.txt`

**Immediate observations (not yet conclusions):**
1. QM's first commit is literally titled "Fresh repo history" (Regan Bell, 2026-07-29). History is squashed/rewritten — pre-July-2026 development is NOT observable. Any velocity claim about QM's real age is UNVERIFIABLE.
2. Ruflo has 1,635 tags against 7,396 commits ≈ 1 release per 4.5 commits. Suggests automated version bumping. Last commit is literally `chore(release): 3.38.19 -> 3.38.20`.
3. Hermes has 25,451 commits in ~13 months. That is ~64/day sustained. Needs checking for bot/squash-merge inflation before drawing team-size conclusions.
4. All three are active *this week* (Aug 24/25/26 2026). None are abandoned.

## 2026-08-26T11:18Z — Toolchain

OS Windows 11 Pro 10.0.26100 (MINGW64 shell). git 2.54.0 · node v24.18.0 · npm 11.16.0 ·
pip 26.1.2 (Python 3.14) · Docker 29.5.3.

**Absent:** `uv`, `go`, `rustc`/`cargo`, `bun`, `pnpm`, `cloc`, and `python` on PATH
(Windows Store alias shim intercepts it; pip works, so a real 3.14 exists — need to find its exe).

Implications recorded up-front:
- Rust toolchain absent → if any repo has Rust core, cannot compile it. Will note as env limit, not a repo defect.
- `cloc` absent → will hand-roll LOC counting via git + awk so counts are reproducible.
- No model API credentials in this environment → Phases 6/8/10 (live runs, failure injection, cost) are
  substantially blocked. Will execute everything up to the first model call and tag the rest
  UNVERIFIABLE with the reason.

Evidence: `evidence/commands/phase0-toolchain.txt`

## 2026-08-26T11:20–11:35Z — Phase 1 git forensics
Completed. 9 findings (GIT-001..009) in `01-git-forensics.md`.
Headlines: QM history squashed ("Fresh repo history", 1,263 files); Ruflo 93.7% single-author with
42% AI-coauthored commits and 1,635 tags (1,092 in one month); Hermes step-change Feb 2026.
Dead end: `git log --shortstat` over a treeless clone timed out (blobs fetch on demand) —
switched to `--name-only` tree-level counting.

## 2026-08-26T11:40–12:20Z — Phase 2/3 Ruflo
`02-architecture-ruflo.md`. 10 findings. Headline RUFLO-SONA-001: LoRA B matrix never written →
transform is provably identity. Verified by independent grep AND by executing a faithful
reproduction (`evidence/benchmarks/sona_identity_proof.mjs` → max|out-in| = 0).
Surprise: the *best* code in the repo (Raft/PBFT/Gossip) has zero tests and is never instantiated
by the CLI that advertises it.

## 2026-08-26T11:40–12:35Z — Phase 2/3 Hermes
`02-architecture-hermes.md`. 8 findings. Headline HERMES-LEARN-002: the learning loop is genuine
(a forked agent with a restricted toolset, auto-spawned at end of turn) but improvement is never
measured — `skill_usage.py` tracks activity, not outcome.

## 2026-08-26T11:40–12:50Z — Phase 2/3 QM
`02-architecture-qm.md`. 8 findings. Headline QM-ARCH-001: QM does not own an agent loop; it rents
one via a 4-transport adapter interface and owns governance/durability around it.
QM-SEC-005: the command policy is a real recursive shell parser (depth 8) defeating heredoc,
ANSI-C, pipe-to-shell and SQL-client evasion — best single piece of code in the audit.

## 2026-08-26T12:50–13:40Z — Phase 8 hands-on
`07-hands-on.md`. Installed all three. 15 findings (HANDS-001..015).
- QM full suite: 4,195 tests / 3,783 pass / 247 fail / 165 skip (90.2%); failures shown to be
  environmental (Fly `sprites` absent). With live Postgres (Docker): 79/79 on DB suites.
- Ruflo `neural status` prints "Neural Network Status (Real) | SONA Coordinator Active |
  Adaptation: 1.14μs" — the measured latency of a proven no-op.
- Ruflo `hive-mind init --consensus byzantine` persists `"consensusStrategy":"byzantine"` as a
  bare string; no PBFT state created. Confirms the static finding end-to-end.
- **Ruflo memory is genuinely good**: cross-process store/get works, and a lexically-disjoint
  semantic test ("cat sitting on a rug" vs "The feline rested upon the woven floor covering")
  scored 0.73 — real MiniLM embeddings, not a hash.
- Hermes live SQLite: 22 tables, `schema_version=26`, matching source exactly.
- `hermes doctor` detected a specific upstream SQLite WAL-reset bug by version + source id.

**Dead end / self-correction:** an early probe appeared to show Ruflo exiting 0 on failures. That
was my own shell pipeline (`cmd | tail` returns tail's status). Re-tested without a pipe: exit
codes are correct in both Ruflo and Hermes. Recorded rather than quietly dropped.
Also corrected: Ruflo AI-coauthored commits are 3,103 (42.0%), not the 8,310 *mentions* first counted.

## 2026-08-26T12:55Z — Phase 9 baseline
Vercel course **reachable**; no substitution needed. `08-baseline-vs-real.md`.
38 lessons / 11 modules. Course was NOT built (no credentials) — used as a reference decomposition,
stated as such.

## 2026-08-26T13:00–13:50Z — Phase 5/6 failure & recovery
`04-failure-recovery.md`. QM is the only one of the three that treats process death as a
first-class recoverable event (lease + leader-elected reaper + CAS + poison bound), verified
against live Postgres. Ruflo's dominant failure mode is **silent degradation** in three separate
paths while status output still reports the capability as available.

## Environment limits carried through the whole audit
- No model API credentials → no live agent runs; Phase 10 cost/latency largely UNVERIFIABLE.
- No Rust toolchain → Ruflo `crates/` (39 files) UNVERIFIABLE.
- No pnpm → Ruflo repo not buildable; used the published npm package instead.
- Hermes test suite (3,311 files) not executed.

---

# PROOF PHASE — 2026-08-27

## Experiment 1 — Event log performance
Built minimal Event/EventStore/StateReducer/Snapshot (no agent). Benchmarked 10 → 1,000,000 events
on SQLite (`node:sqlite`) and Postgres 16 (Docker).
**Headline: found a real defect in the proposed architecture.** The `State` projection specified in
ARCHITECTURE.md contains `messages[]` and is therefore unbounded — 8 MB at 100k events, 80.7 MB at
1M. Snapshot interval barely affected load latency (13.97ms@100 vs 14.82ms@5000), which is the
signature of a cost that is not in the tail replay. On Postgres this **fails the 50ms p99 target
(measured 100.26ms)**. Bounded projection fixes it: 10.2KB state at 1M events, p99 flat at 0.07ms.
Dead end recorded: first CSV/plot run used a path with a space and `new URL().pathname`, producing
`D:\Abhijith%20P\...` ENOENT. Fixed with `fileURLToPath`. Same bug recurred in Exp 2.
Also: first db-size numbers were polluted by snapshot rows (SQLite does not shrink without VACUUM);
re-measured events-only before writing snapshots.

## Experiment 2 — Tool recovery
Extracted the real 86 registered Hermes tools by AST-ish parsing of `registry.register(...)`.
Classified 34; executed 12 failure simulations.
**Refuted `ARCHITECTURE.md` §2.6.** `bash("echo x >> f")` duplicates on re-issue;
`bash("mkdir -p a/b")` does not. Same tool, opposite safety → per-tool idempotency cannot work.
Pre-registered threshold from OPEN-QUESTIONS E-04 (one third) was crossed: 44%.
**Unexpected positive:** `patch` and `git commit` reject their own replays (content-addressed
precondition). Added `SELF_VERIFYING` to the taxonomy — stronger than an idempotency key.
Confirmed `ToolEntry.__slots__` in Hermes carries no effects/idempotency/read_only field at all.

## Experiment 4 — Time-travel prototype (run before Exp 3; Exp 3 reuses its store)
529 LOC durable core. 44/44 acceptance assertions pass, including all five V0 gates.
**Dead end worth recording:** my first two crash tests killed nothing. The child's own
`setTimeout(kill)` never fired because the slow-tool busy-wait blocked its event loop, so the run
completed (49 events) before the timer. Only became a real test when the PARENT issued SIGKILL.
A self-killing child is an easy way to write a crash test that silently tests nothing.
Real result: alive → SIGKILL at 23 events → left `running` → reaper requeued → fresh process
resumed → completed correctly, with the Exp-2 recovery contract firing
(`orphaned write (SAFE_RETRY) -> reissue`).
**New requirement found:** test D's fork livelocked to 305 events (vs 49) when `edit` was denied.
Only `max_turns` stopped it. No-progress detection is missing from the architecture.

## Experiment 3 — External adapter (Claude Agent SDK)
Used the REAL type definitions from qm/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts.
SDK exposes 100 `type:` discriminators; our vocabulary has 31.
Closed mode loses 33 field kinds incl. total_cost_usd, ttft_ms, cache tokens → **closed vocabulary
rejected**; extension mode preserves 54/56 with identical core event types.
**Key finding:** `tool.started=0` on adapted runs — the SDK never announces a tool has begun, so
in-flight tools are invisible and orphan recovery has nothing to act on. Recovery granularity for
rented loops is TURN-level, not TOOL-level. This retro-explains why QM's durability is run-level.
Dead end: appended section 6 after `process.exit()` so it never ran; moved it before the summary.

## Experiment 5 — Developer validation — **NOT RUN**
No access to human participants. Zero developers interviewed. No data fabricated, no personas
invented. Instrument written and ready (recruitment quota, demo script, non-leading interview
guide, instrumentation schema, pre-registered thresholds and decision rules).
This blocks H-01, H-02, H-03, H-09 product halves and H-10 entirely.

## Experiment 6 — Framework comparison — **LARGELY BLOCKED**
No model credentials → no latency/token/cost comparison. Structural capability comparison only,
with LangGraph/OpenHands rows explicitly marked NOT ASSESSED rather than guessed.

## Outcome
5 architecture revisions (2 breaking), 2 new one-way doors discovered.
Decision: **BUILD — MODIFIED**, as a validation release, gated on Experiment 5.
Postgres container removed after use.
