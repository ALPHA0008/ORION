# FINDINGS — Reverse-Engineering Three Agent Harnesses

**Research date:** 2026-08-26 · **Method:** source reading, git forensics, test execution, live installs
**Author environment:** Windows 11 26100 · Node v24.18.0 · Python 3.13.15 · Docker 29.5.3 · Postgres 16

### Pinned repository state — every finding below refers to these commits

| Repo | HEAD | Branch | Latest tag | Commits | First → Last commit |
|---|---|---|---|---|---|
| QM | `c7caba56cf0e6c7bd4fa7c0236ae1250b0f631f5` | main | v0.1.5 | 176 | 2026-07-29 → 2026-08-25 |
| Hermes Agent | `d62a05e94c7478cc8043465b4345ff69f8fcb97f` | main | v2026.8.19 | 25,451 | 2025-07-22 → 2026-08-26 |
| Ruflo | `e21aa352fdc80fd2d3cc4e83404a76a18d118b96` | main | v3.38.20 | 7,396 | 2025-06-02 → 2026-08-24 |

**Evidence tags:** `VERIFIED` (confirmed in source or execution) · `REFUTED` (claim contradicted) ·
`PARTIAL` (real but narrower than claimed) · `UNVERIFIABLE` (could not check — reason always given).
Untagged factual claims would be a research error; there are none intended.

---

# Executive Summary

Three projects that are routinely mentioned in the same sentence turn out to be three **different
kinds of thing**, built by three different kinds of team, with radically different relationships
between what they say and what they do.

**QM** is not a harness. It is a governance and durability shell that *rents* its agent loop from
Pi, Claude Agent SDK, Codex or OpenCode through a genuine 4-transport adapter interface. What it
owns is everything a company needs around a loop: tenancy, policy, audit, approvals, durable runs.
Its command-policy shell parser and its lease+reaper crash recovery are the best code in this audit.
Every substantive claim I tested held. It under-claims relative to what it has built.

**Hermes** is a real harness with the most engineering hours behind it — 2.5M lines, 3,048
contributors, sustained 3,000–6,000 commits/month since Feb 2026. Its distinguishing feature is a
genuine self-improvement loop: after every turn it forks a second agent with a restricted toolset to
decide what should be written to the skill library. That loop is real and automatic. What it cannot
do is tell you whether any of it *worked* — the system measures skill *usage*, never skill
*effectiveness*. Its dominant risk is structural: a 21,665-line CLI file and a 6,550-line loop body.

**Ruflo** is where claims and code diverge sharply. Its flagship "SONA self-optimizing neural
architecture" is **provably a no-op** — I reproduced its LoRA transform and it returns its input
bit-for-bit, because the `B` matrix is allocated as zeros and never written again. Its CLI reports
that inert path as *"Neural Network Status (Real) — SONA Coordinator: Active."* Yet the same
repository contains a correct Raft/PBFT/Gossip implementation (untested, never instantiated), a
correct DQN with real backpropagation (zero callers), and a genuinely working semantic memory layer
that I verified end-to-end. Ruflo is not fake; it is **misrouted** — the good implementations are
unreachable and the defaults land on stubs.

### The single most useful conclusion for building something new

The three projects fail and succeed along **orthogonal axes**, which means a next-generation harness
does not need to out-build any of them. It needs QM's *durability and authorization seam*, Hermes'
*provider-quirk battle damage and file checkpointing*, and Ruflo's *warning*: that impressive
subsystems which nothing calls are worse than absent, because they consume the maintenance budget
and mislead the operator.

---

# What We Verified

### QM
| ID | Finding | Evidence |
|---|---|---|
| QM-ARCH-001 | QM **does not own an agent loop**. Its core interface is `runTurn(input) → result`; the loop lives in the vendored harness. | `src/harness/harness.ts:140,173-178` |
| QM-HARNESS-002 | Harness swapping is **real**: 4 production adapters over 4 genuinely different transports (`in-process`, `sdk`, `json-rpc`, `http`), with capability parity gaps declared machine-readably. | `pi-harness.ts:1477`, `claude-harness.ts:870`, `codex-harness.ts:900`, `opencode-harness.ts:1141` |
| QM-SEC-003 | Three security postures are real and **compose with a floor** — a narrower scope can only raise, never lower, the org setting. | `security/security-posture.ts:3-18,36-39` |
| QM-SEC-005 | The predeclared command policy is **real enforcement**: a recursive shell parser (depth 8) defeating heredoc smuggling, ANSI-C encoding, pipe-to-shell, variable indirection and SQL-client smuggling. Allowlist mode fails closed. | `policy/command-policy.ts:66-115,864-911` |
| QM-DUR-007 | **Genuine durable execution**: lease expiry + leader-elected reaper + compare-and-set reclaim + poison bound. Uses correct Postgres idioms (`pg_try_advisory_lock`, `FOR UPDATE SKIP LOCKED`). | `runs/reaper.ts:40-53`, `postgres-run-store.ts:295-327,180`, `persistence/leader-lease.ts:69` |
| HANDS-004 | Test suite: **4,195 tests, 3,783 pass** (90.2%). The 247 failures are **infrastructure absence**, not logic — with a live Postgres, DB suites pass **79/79**. | `evidence/commands/qm-test-runs.txt` |

### Hermes
| ID | Finding | Evidence |
|---|---|---|
| HERMES-LOOP-001 | The agent loop is real and locatable: `run_conversation`, loop body `:2017→:8573`. | `agent/conversation_loop.py:1822,2017` |
| HERMES-MODEL-004 | Genuine three-tier model abstraction (transports → adapters → provider profiles), **37 provider packages**. Not hardcoded to one SDK. | `agent/transports/`, `providers/base.py:39`, `plugins/model-providers/` |
| HERMES-TOOLS-005 | 86 distinct tools, **AST-based discovery** (parses modules rather than importing them), plus a plugin-override policy preventing a pip package from hijacking a first-party tool. | `tools/registry.py:111,236,645,763,1128` |
| HERMES-STATE-006 | SQLite session store with a diff-based migration engine, **plus a separate git-shadow-repo checkpoint store** snapshotting files before every write. | `hermes_state_common.py:329,359`; `tools/checkpoint_manager.py:755` |
| HERMES-SUB-007 | Subagents get **real git-worktree isolation**; async delegations are **durable in SQLite** with delivery attempts and owner PID. | `tools/subagent_worktree.py`; `hermes_state_common.py:511` |
| HANDS-010 | Live verification: the created `state.db` has all 11 declared tables, `schema_version = 26` exactly as source declares, with FTS5 + trigram indexes materialised. | executed against the installed system |
| HANDS-011 | `hermes doctor` detects a **specific upstream SQLite WAL-reset bug by version and source id**, names the fixed versions, links the advisory, and screens MCP stdio commands. Best operational tooling of the three. | executed |

### Ruflo
| ID | Finding | Evidence |
|---|---|---|
| RUFLO-CONSENSUS-005 | Raft, PBFT and Gossip are **genuinely implemented and correct** — Raft §5.4.1 log-completeness, PBFT `2f+1` with `f=⌊(n−1)/3⌋`, gossip with version vectors and bounded dedup. **The best code in the repository.** | `swarm/src/consensus/raft.ts:110-123,303-333`; `byzantine.ts:337-341`; `gossip.ts:32,325-331,483-487` |
| RUFLO-HNSW-006 | The HNSW index is a **real graph index**, not a linear scan — correct `levelMult = 1/ln(M)`, layer descent, ef-beam at layer 0, correct bidirectional deletion. | `memory/src/hnsw-index.ts:245,352-372,415-445` |
| HANDS-008 | **Ruflo's memory layer genuinely works.** Cross-process store/retrieve succeeds, and semantic search is *real*: "cat sitting on a rug" matched "The feline rested upon the woven floor covering" at **0.73 with zero shared words** — only a true embedding does that. | executed; `Xenova/all-MiniLM-L6-v2` confirmed loaded |
| GIT-002 | 93.7% single-author; **42.0% of commits carry a Claude co-authorship trailer**; placeholder identities (`you@example.com` ×35) present. | `git log` analysis |

---

# What We Refuted

### RUFLO-SONA-001 — "SONA self-optimizing neural architecture" is a mathematical no-op
**Status: REFUTED · Confidence: very high (executable proof)**

This is the most significant finding in the audit.

SONA implements LoRA — `output = input + B·(A·input)`. The forward math at
`v3/@claude-flow/neural/src/modes/base.ts:111-143` is correctly written.

But at `sona-manager.ts:526-540`, `B` is allocated and never assigned:
```ts
const A = new Float32Array(hiddenDim * config.rank);
const B = new Float32Array(config.rank * hiddenDim);   // zero-filled by JS
for (let i = 0; i < A.length; i++) A[i] = (Math.random() - 0.5) * 0.02;
weights.A.set(module, A);
weights.B.set(module, B);        // B is never written again, anywhere
```
An exhaustive search for writes to `weights.A`/`weights.B` across the package returns **only these
lines**; every other reference in all five "modes" is a `.get()`.

Because `B` is all zeros, `Σ_r B[r·dim+d]·intermediate[r]` is always 0, so `output[d] += 0`.
**I reproduced the function verbatim and executed it** (`evidence/benchmarks/sona_identity_proof.mjs`):
```
B matrix sum(|B|)          : 0
max |output - input|       : 0
output identical to input? : true
```

The "learning" path computes `gradient[i] = state[i] * reward` — an element-wise scale, not a
derivative of any loss — and accumulates it into a `Map` keyed by the strings `'positive'` and
`'negative'` that **nothing ever reads**. The reported "improvement" is
`mean(quality) − 0.5`, where `0.5` is a hardcoded constant (`balanced.ts:160-172`). EWC++
consolidation iterates a Fisher map that is never populated, so its loop body never executes.

**Answering the brief's precise question** — does "neural"/"self-learning" mean gradients and
weights, or heuristics with ML-flavored naming? It means the latter, and not marginally: the
adaptation path is inert. Nothing changes as a result of experience along this code path.

**Confirmed at runtime.** `npx ruflo neural status` prints a table headed
**"Neural Network Status (Real)"** with `SONA Coordinator | Active | Adaptation: 1.14μs avg`.
That 1.14μs is the measured cost of an identity function.

### RUFLO-SEC-008 — mTLS does not exist, and TLS verification is disabled in shipped code
**Status: REFUTED · Confidence: high**

Only three files contain the string "mTLS", all documentation or config generators. The single
code occurrence is a STRIDE threat-model table *printing the word as advice*:
```ts
// v3/@claude-flow/cli/src/commands/security.ts:658
{ category: 'Spoofing', ..., example: 'Strong authentication, mTLS' }
```
There is no `tls.createSecureContext`, no client-certificate configuration, no certificate
validation anywhere.

**Worse than absent.** Searching for real TLS options found `rejectUnauthorized: false` — which
disables certificate validation entirely — in **10+ shipped locations** (`ruvector/backup.ts:184,584`,
`benchmark.ts:238`, `init.ts:226`, `migrate.ts:306`, `optimize.ts:166,517`, `status.ts:161`,
`ruvector-bridge.ts:279`). A project advertising zero-trust mTLS ships database connections that
accept any certificate. This is a genuine defect, not merely an unimplemented feature.

"Zero-trust" appears in 4 files, all metadata. **REFUTED as implementation.**

### Terminal backends are sandboxes, not multiplexers (Hermes)
**Status: REFUTED as commonly read · PARTIAL as intended**
A repo-wide search found **no tmux, no screen, no pty backend**. What exists is 8–9 real *execution
environment* backends (local, docker, ssh, modal, managed-modal, vercel-sandbox, daytona,
singularity) totalling 8,785 LOC. If "terminal backends" is read as multiplexing: refuted. If read
as "places a shell command can execute": verified. `daytona` and `managed_modal` are thin wrappers.

---

# What Was Partial

| ID | Claim | Reality |
|---|---|---|
| **HERMES-LEARN-002** | Closed learning loop | **The loop closes; the outcome is unmeasured.** A forked agent with a memory/skill-only tool whitelist is auto-spawned at end of every turn (`turn_finalizer.py:795-810`), costs a disclosed ~30K tokens, and writes atomically with rollback and provenance checks. But `skill_usage.py` tracks only *activity counts and timestamps* (used for pruning). There is no success rate, no task-outcome delta, no with/without A-B. The system cannot tell whether a written skill helped. |
| **QM-SCOPE-006** | Scope isolation | **Enforced at the query layer, not the type layer.** Every persistence call carries `WHERE scope_id = $1` (`postgres-memory-service.ts:22,45,58`) and scope threads through the harness boundary and every audit record; 147 files reference it and dedicated tests pass. But `src/types.ts:15` is `export type ScopeId = string` — a bare alias, so the compiler cannot distinguish an org scope from a personal one. Correct today by discipline, not by construction. |
| **QM-SEC-004** | Content screening | **Real classifier; deliberately fails open.** Unparseable or timed-out verdicts return the *permissive* `auto` (`security-posture.ts:86-91`). QM makes this legible rather than hiding it: the audit action is literally `security_posture.tool_result_failed_open`, and content is prefixed *"[NOT security-screened…]"*. The `strict` path is a genuine quarantine with human release. A defensible tradeoff — and a real weakness if an attacker can stall the classifier. |
| **RUFLO-NEURAL-003** | RL / neural training | **Real implementations, zero callers.** `dqn.ts` has correct chain-rule backprop through ReLU, momentum SGD that actually mutates weights, Double-DQN and a target network. It is genuinely good. Every importer outside the package is the barrel export and its own test file. No CLI, hook, or router calls it. Meanwhile `sona-manager.ts:773-806` hardcodes `algorithm: 'ppo'` into reported stats on a path that never touches PPO. |
| **RUFLO-ROUTER-004** | "89% routing accuracy", learned router | **Real trained artifact; absent inference engine; unverifiable metric.** The 4.5MB `seed-router.krr*.json` files are genuine kernel-ridge regression in dual form (`refEmbeddings` 40×384 + `alpha` 40 per candidate) with honest provenance. But the KRR arithmetic lives entirely in `@metaharness/router`, an *optional peer dependency that is not installed*, and the feature is additionally gated behind `CLAUDE_FLOW_ROUTER_NEURAL=1` (off by default). **The 89% figure is UNVERIFIABLE** — no held-out set, split, or reproducible script found. With **40 training rows** for a 7-way regression over 384 dimensions, any accuracy figure carries very wide error bars. |
| **RUFLO-CONSENSUS-005** | Byzantine/Raft/Gossip consensus | **Correct implementations; never instantiated; zero tests.** `hive-mind.ts` accepts `--consensus byzantine` and stores it as a string tag (`:1031`), with its own comment admitting the value is kept *"so a future hive-mind worker / consensus tool can pick them up."* Confirmed at runtime: `hive-mind init --consensus byzantine` writes `"consensusStrategy":"byzantine"` into JSON with **no PBFT state at all** — no view number, no replica set, no `f`. Of 571 test files, none targets `swarm/src/consensus/`. |
| **RUFLO-HNSW-006** | HNSW benchmarks | Real index, but the in-tree benchmark runs at **N=1,000, 128-dim** — below the crossover where ANN beats brute force. The repo's own docs retract a prior "150x–12,500x" claim as unreproduced (~1.9x at N=20k), yet the stale claim survives in a source comment (`hooks/src/reasoningbank/index.ts:8`). |
| **RUFLO-RB-007** | ReasoningBank | Loop genuinely closes — retrieved patterns reach the prompt via `guidance-provider.ts:111-140`. But the fallback embedder **silently** degrades to a string hash when `npx agentic-flow` fails, at which point cosine similarity approximates exact-string matching; and some "guidance" is hardcoded text, not retrieved. |
| **RUFLO-COUNT-010** | Agent/plugin/tool counts | Inflated by duplication. 370 agent `.md` files but **171 unique basenames** (~2.2× duplication); the 423 MCP `name:` literals **over-count badly** because schemas nest `name:` inside `inputSchema.properties`. "60+ agent types" is defensible against 108 canonical files; "370 agents" would not be. |
| **RUFLO-GOAP-009** | GOAP A* planner | Correct A* semantics over **8 fixed booleans** (a 256-state linear research pipeline), no priority queue (array re-sorted each iteration), `JSON.stringify` as state key, living in a React demo UI to drive cards. Untested. |

---

# What Remains Unverifiable

Stated plainly, with reasons — these are environment limits, not project defects.

| Item | Why |
|---|---|
| **Any live agent behaviour** (brief Tasks A, E; most of B, C, D) | No model API credentials in this environment. I did not simulate or estimate. |
| **All Phase 10 cost/latency/token metrics** | Same. No numbers are reported rather than invented. |
| **Hermes test suite** (3,311 files, ~33,752 test functions) | Requires optional extras and provider credentials. I verified runtime artifacts instead (live DB schema, CLI behaviour), which is stronger than a count. |
| **Ruflo test suite** (571 Vitest files) | The repo **cannot be installed with npm** — `EUNSUPPORTEDPROTOCOL … "workspace:"` — and pnpm is unavailable here. Used the published npm package for runtime probes. |
| **Ruflo `crates/`** (39 Rust files, 8,460 LOC) | No Rust toolchain in this environment. |
| **Ruflo's "89% routing accuracy"** | No methodology, dataset split, or reproducible script located. Classified **UNREPRODUCIBLE**. |
| **QM's pre-2026-07-29 history** | Deliberately discarded — first commit is titled `Fresh repo history` (1,263 files). QM's true age and early evolution are unknowable from the public repo. |
| **QM full-suite pass rate with all infrastructure** | Fly.io `sprites` sandbox binary unavailable; 12 sandbox tests fail environmentally. |
| **GitHub API data** (PR counts, issues, review latency) | Not fetched. The PR-vs-direct ratios in `01-git-forensics.md` are *inferred from git metadata* and explicitly limited. |

---

# Major Architectural Findings

### 1. "Harness" is not one category — the taxonomy needs a fourth axis

The brief's hypothesis (Framework → Harness → Meta-harness → Org platform) largely survives, but the
code suggests the discriminator is not *layering*. It is **who owns the agent loop, and who owns the
durable state**:

| Project | Owns the loop? | Owns durable run state? | Actual category |
|---|---|---|---|
| QM | **No** — rents 4 of them | **Yes** — Postgres, leases, reaper | **Governance shell** |
| Hermes | **Yes** — `conversation_loop.py` | Partly — transcript + delegations, no run state machine | **Harness** |
| Ruflo | **No** — launches Claude Code (`spawn --claude`) | **No** | **Meta-harness / orchestrator** |

This matters because "loop ownership" and "state ownership" are separable, and the interesting
design space is the quadrant nobody occupies: **owns durable run state, rents the loop, and exposes
the loop boundary as a stable contract.** QM is closest but couples that to Slack and Postgres.

### 2. Every project independently converged on leases

QM (`runs.lease_expires_at`), Hermes (`session_turn_leases`, `compression_locks`), and even Ruflo's
unused Raft all use lease-with-expiry for ownership. When three independent teams reach the same
primitive, it belongs in the core, not a plugin.

### 3. The most valuable artifact in any of these repos is Hermes' battle damage

`conversation_loop.py` contains named workarounds with issue numbers for: GitHub Copilot stale
credentials (`:489`), providers returning `finish_reason="tool_calls"` with an empty array
(`:8151-8168`), Ollama context limits (`:548`), image max-dimension errors (`:519`), plus **orphan
repair** that synthesises `role:"tool"` stubs for unanswered tool-call IDs so the transcript stays
API-valid (`:8511-8532`). This is a catalogue of real-world provider failure modes that cannot be
derived from first principles — only from running at scale. Anyone building a harness should read
this file before writing their own loop.

### 4. Tests can be numerous and still buy nothing

Ruflo has 571 test files. `neural/__tests__/sona.test.ts` asserts `learn()` only via
`.resolves.not.toThrow()` — a body of `return 0;` would pass unchanged. Nothing asserts a weight
changed or quality improved. Meanwhile the *best* subsystem in the repo (consensus) has **zero**
tests. Test count is not coverage, and coverage of the wrong assertion is not protection.

### 5. Silent degradation is the worst failure mode observed

Ruflo has three independent paths that fall back to a weaker implementation **without signalling**:
embeddings (real model → `npx` subprocess → string hash), the router (native → user KRR → bundled
KRR → k-NN), and SONA (native engine → keyword counters). In each case status output continues
reporting the capability as available. QM's contrasting choice — naming its fail-open path
`security_posture.tool_result_failed_open` in the audit log — is the correct pattern.

---

# Major Surprises

1. **The best code in Ruflo is the code nobody runs.** A correct PBFT with `2f+1` quorum and a
   correct Double-DQN with real backprop both sit in the tree, untested and uncalled, while the
   advertised features route to counters.
2. **Ruflo's memory actually works well.** After finding SONA inert, I expected the same of memory.
   Instead a lexically-disjoint semantic query scored 0.73. Credit where due — and a reminder that
   "this project overclaims" is not a licence to assume everything is hollow.
3. **QM under-claims.** Its README says less than its code delivers. The 911-line shell parser and
   the lease/reaper machinery are barely advertised. This is the inverse of the usual pattern.
4. **QM's security tests pass with no dependencies installed** (35/36 before `npm install`).
   That level of test isolation in a security layer is rare.
5. **Hermes writes its own token cost into a source comment** (~30K per background review). Very
   few projects document their own overhead where maintainers will see it.
6. **Ruflo's CLI is partly self-correcting.** `ruflo neural distill --help` states *"Does NOT train
   a model or reduce escalation"*, and `CLAUDE.md` retracts previous Flash Attention and HNSW
   numbers as unreproduced. Someone inside the project is trying to fix the record — but stale
   claims survive in source comments and telemetry.

---

# Project-by-Project Findings

## QM — the governance shell
**What it is:** a headless multi-tenant core (self-described: *"Headless core for the shared org
agent (managed-agents architecture)"*) that wraps someone else's agent loop in tenancy, policy,
approvals, audit and durable execution. 267K LOC, 99% TypeScript, no build step.

**Does exceptionally well:** adversarial command policy (QM-SEC-005); durable execution with
correct Postgres idioms (QM-DUR-007); honest multi-harness abstraction with declared capability
gaps (QM-HARNESS-002); record/replay tape making a nondeterministic subsystem testable.

**Got wrong / risks:** `ScopeId = string` leaves tenancy uncheckable by the compiler — the highest-
value cheap fix available (QM-SCOPE-006). Default command policy is a denylist with one rule, so
the strong machinery is opt-in. Fail-open screening (QM-SEC-004). `orchestrator.ts` at 150KB is
trending toward a god file. Bus factor 2 (97% of commits from two authors). Public history is 28
days old, so architectural stability is unproven in the open. Postgres and Fly.io are mandatory —
not laptop-scale.

**Would I depend on it?** For a multi-user org agent behind Slack, yes — it is the only one of the
three with a credible answer to "what happens when a run dies mid-step" and "how do I prove what
happened." Not for a single-developer local tool.

## Hermes — the harness
**What it is:** a full agent harness — its own loop, 86 tools, 37 providers, 9 execution
environments, 8 memory backends, subagents with worktree isolation, git-based file checkpoints, and
an automatic self-improvement loop. 2.5M LOC.

**Does exceptionally well:** the background-review learning loop (HERMES-LEARN-002) — genuinely the
most advanced of the three, with a restricted-authority fork, atomic writes, rollback and
provenance. Provider-quirk resilience and transcript repair. `hermes doctor`. Git-shadow-repo
checkpointing — reusing git instead of inventing a snapshot format is the cleverest single idea in
the audit. Real supply-chain hygiene (33 exact-pinned core deps, 44 optional groups).

**Got wrong / risks:** file sizes — `cli.py` 21,665 lines, `conversation_loop.py` with a 6,550-line
`while` body, state carried on a mutated god-object across 50+ private attributes. This is the
plausible mechanism behind a **13,220 `fix:` vs 3,307 `feat:`** commit ratio. Skill effectiveness is
never measured. Eight memory backends is more surface than any user needs.

**Would I depend on it?** As a single-user or small-team agent, yes — it has the most real-world
mileage and the best failure handling at the provider boundary. I would be cautious about forking
or deeply modifying it, because the blast radius inside that loop is enormous.

## Ruflo — the meta-harness
**What it is:** a TypeScript monorepo (915K code / 455K markdown) that orchestrates Claude Code and
Codex CLIs, with 108 canonical agent definitions, 54 plugin directories, and a large surface of
advertised advanced capabilities. Formerly `claude-code-flow` → `claude-flow v2` → `ruflo v3`; the
`package.json` name is still literally `claude-flow`.

**Does exceptionally well:** the **memory subsystem** — real MiniLM embeddings, real cross-process
persistence, real semantic retrieval, verified by execution (HANDS-008). The **consensus
implementations** are textbook-correct. The **HNSW index** is competent. `CLAUDE.md` has been
through a genuine honesty pass, retracting prior unreproduced numbers.

**Got wrong:** the flagship feature is inert and reported as "Active / Real" (RUFLO-SONA-001).
mTLS is claimed and absent while TLS verification is *disabled* in 10+ places (RUFLO-SEC-008).
The good subsystems are unreachable from the CLI that advertises them. Silent degradation in three
paths. Counts inflated by duplication. 31% of commits are automated release bumps; velocity is at
~4% of peak; bus factor 1.

**Would I depend on it?** For its memory layer as a component, possibly. As an orchestration
platform, no — the gap between what the status output reports and what executes is too large to
operate against safely, and the maintenance signal is declining.

---

# Cross-Project Patterns

1. **Everyone converged on leases for ownership** — and only QM completed the pattern (lease +
   leader-elected sweeper + CAS reclaim + poison bound).
2. **Everyone separates "conversation" from "memory"** — but only Hermes further separates
   *procedural* memory (skills) from *episodic* (transcripts) and *semantic* (memory providers).
3. **Nobody measures whether memory or learning improves outcomes.** Hermes tracks skill *usage*;
   Ruflo tracks pattern *confidence* as an EMA of caller-supplied success flags; QM does not claim
   learning. **This is the single biggest open gap across all three.**
4. **Everyone hand-rolls context compaction** and nobody can prove it is lossless enough.
5. **Two of three are wrappers.** Only Hermes owns its loop. This suggests loop ownership is
   *becoming* commoditised, and that the durable value is accumulating at the layers above and
   below it.
6. **Markdown volume tracks AI authorship, not documentation quality.** Ruflo: 1,861 files, 455K
   lines, ADRs of 60–97KB each, 42% AI-coauthored commits.

---

# Implications for a New Harness

Derived from evidence, not preference. Detailed in `LESSONS.md`, `ARCHITECTURE.md`,
`DECISION-MATRIX.md` and `NEXT-HARNESS-SPEC.md`.

1. **Durability is a core primitive, not a Module-7 topic.** Lease + sweeper + CAS + poison bound is
   ~200 lines against Postgres or SQLite. Every real deployment hits process death.
2. **The authorization seam must exist from commit one.** QM shows retrofitting tenancy touches 147
   files. A single `authorize(action, context) → allow | deny | escalate` boundary is cheap upfront
   and near-impossible later.
3. **Make scope a branded type, not a string.** QM's one structural weakness costs nothing to avoid.
4. **Rent the loop, own the state.** Adapters over real transports with *declared capability sets*
   (QM's `capabilities: ReadonlySet`) — never pretend parity.
5. **Steal git-as-checkpoint-store from Hermes.** Free diffing, history and rollback.
6. **Record/replay from day one** (QM's tape). Without it, agent behaviour is untestable.
7. **Fail loudly, or fail open *loudly*.** Never degrade silently. If you must fail open, emit a
   distinctly-named audit event, as QM does.
8. **Assert effects, not absence of exceptions.** The SONA lesson: `.resolves.not.toThrow()` on a
   learning function protects nothing.
9. **Do not build:** consensus protocols, custom RL, learned routing, or symbolic planners inside a
   harness. All four appear in Ruflo; all four are unreachable; none solves a failure the system
   actually encountered.
10. **Measure whether learning works, or do not claim learning.** The gap nobody has closed — and
    therefore the clearest opportunity for genuine differentiation.

---

# Evidence Index

| Path | Contents |
|---|---|
| `evidence/commands/phase0-pinned-state.txt` | HEAD SHAs, branches, first/last commits, tag counts |
| `evidence/commands/phase0-toolchain.txt` | OS and toolchain versions at research time |
| `evidence/commands/phase1-authors.txt` | Author/committer distributions, all three repos |
| `evidence/commands/phase1-velocity.txt` | Commits per month over full project lifetimes |
| `evidence/commands/phase2-loc.txt` | File counts and LOC by extension, doc:code ratios |
| `evidence/commands/qm-test-runs.txt` | QM test executions (63/63, 40/40) |
| `evidence/commands/ruflo-exit-codes.txt` | Ruflo exit-code probe |
| `evidence/benchmarks/sona_identity_proof.mjs` | Runnable proof that SONA's LoRA transform is identity |
| `evidence/benchmarks/sona_identity_proof_output.txt` | Its output (`max|out-in| = 0`) |
| `evidence/excerpts/ruflo-hive-mind-state.json` | Persisted "byzantine consensus" state — a bare string |
| `notes/00-log.md` | Timestamped log, including dead ends and self-corrections |
| `notes/01-git-forensics.md` | GIT-001..009 |
| `notes/02-architecture-{qm,hermes,ruflo}.md` | Per-repo claimed vs observed architecture |
| `notes/04-failure-recovery.md` | Execution model + 13-class failure audit |
| `notes/07-hands-on.md` | HANDS-001..015, install friction, live probes |
| `notes/08-baseline-vs-real.md` | Vercel baseline and the complexity ledger |

### Coverage statement — what was inspected and what was not

**Inspected in depth:** QM `src/harness/`, `src/policy/`, `src/security/`, `src/runs/`,
`src/persistence/`, `src/memory/`; Hermes `agent/conversation_loop.py`, `background_review.py`,
`turn_finalizer.py`, `tools/registry.py`, `tools/environments/`, `hermes_state_*`,
`checkpoint_manager.py`; Ruflo `neural/src/`, `swarm/src/consensus/`, `memory/src/hnsw-index.ts`,
`hooks/src/reasoningbank/`, `cli/src/ruvector/neural-router.ts`.

**Mapped but not read line-by-line:** QM `src/api/` (68 files), `src/slack/` (34 files);
Hermes `cli.py` (1.0 MB), `gateway/` (67,894 LOC), desktop app; Ruflo `docs/USERGUIDE.md` (299 KB),
most of the 1,861 markdown files.

**Not inspected at all:** Ruflo `crates/` (no Rust toolchain); Ruflo's deleted `archive/v2/`;
QM deploy/AWS/Fly infrastructure; all three projects' web/desktop UIs.
