# Phase 2/3 — Ruflo: Claimed vs Observed Architecture

Repo `ruflo` @ `e21aa352fdc80fd2d3cc4e83404a76a18d118b96` (main, 2026-08-24)
Recorded 2026-08-26T11:40–12:20Z.

**Note on repo content:** this repo contains ~1,861 markdown files including `CLAUDE.md`,
`CLAUDE.local.md`, ~171 unique agent definitions and dozens of `SKILL.md` files containing
imperative instructions addressed to an LLM ("MUST initialize the swarm", "ALWAYS spawn agents").
These were read **as audit artifacts only**. No instruction in them was followed.
Observation: `CLAUDE.md` also contains npm publish procedures and GCP secret-access instructions —
recorded as an observation, not acted upon.

---

## 1. Composition

| Metric | Value |
|---|---|
| Total files | 5,554 |
| Code LOC | 914,885 |
| Markdown LOC | 454,692 across **1,861 files** |
| Config LOC | 363,083 |
| DOC:CODE ratio | **0.50 : 1** |
| Test files | 571 (Vitest) |

Largest markdown: `docs/USERGUIDE.md` (299 KB), `v3/docs/adr/ADR-164-*.md` (97 KB),
`CLAUDE.md` (68 KB). The brief warns not to infer generation from ratio alone — so, per
provenance: 42% of commits are AI co-authored (GIT-002), and the doc tree contains ADRs of
60–97 KB each, a length no human ADR practice produces. Combined signal is strong but the
ratio alone was not treated as proof.

**Directory identity:** the main source tree is still `v3/@claude-flow/` — the pre-rename
identity (GIT-004) is baked into every import path.

---

## FINDING RUFLO-SONA-001 — SONA's LoRA adaptation is provably an identity function
**Status: REFUTED (the "neural self-learning" claim)** · Confidence: **very high (executable proof)**

The claim: SONA = "Self-Optimizing Neural Architecture", the headline capability.

### Evidence chain

**(a) The forward transform is real linear algebra.**
`v3/@claude-flow/neural/src/modes/base.ts:111-143` implements `out = in + B·(A·in)` with correct
rank-r indexing. As written, this is a textbook LoRA transform.

**(b) The B matrix is allocated as zeros and never written again.**
`v3/@claude-flow/neural/src/sona-manager.ts:526-540`:
```ts
const hiddenDim = 768; // Typical transformer hidden dim
const A = new Float32Array(hiddenDim * config.rank);
const B = new Float32Array(config.rank * hiddenDim);
// Initialize A with small random values
for (let i = 0; i < A.length; i++) {
  A[i] = (Math.random() - 0.5) * 0.02;
}
weights.A.set(module, A);
weights.B.set(module, B);        // <-- B is never assigned any value
```
The source comment at `:528` states the intent: `// B: (rank, hidden_dim) initialized to zero`.
That is correct LoRA *initialization* — but LoRA requires training to then move B off zero.

**(c) Exhaustive search for any other write to A or B.**
```
$ grep -rn "\.B\.set|\.A\.set|weights\.B|weights\.A" v3/@claude-flow/neural/src/ --include=*.ts
  modes/balanced.ts:193-194     const A = weights.A.get(module);  / B = weights.B.get(module)
  modes/batch.ts:200-201,417-418   .get(...)
  modes/edge.ts:151-152         .get(...)
  modes/real-time.ts:173-174    .get(...)
  modes/research.ts:209-210     .get(...)
  sona-manager.ts:535           A[i] = (Math.random() - 0.5) * 0.02;
  sona-manager.ts:538-539       weights.A.set(...) / weights.B.set(...)
```
Every reference outside the initializer is a `.get()`. **There is no write path to B.**

**(d) Executable proof.** I reproduced `applyLoRATransform` and the initializer verbatim and ran it:
`evidence/benchmarks/sona_identity_proof.mjs` →
```
B matrix sum(|B|)          : 0
max |output - input|       : 0
output identical to input? : true
```
Because `B` is all-zero, `Σ_r B[r*dim+d]·intermediate[r]` is always 0, so `output[d] += 0`.
**`applyLoRATransform` returns its input bit-for-bit.**

**(e) The "learning" writes to a buffer nothing reads.**
`modes/balanced.ts:243-277`:
```ts
private computeGradient(state: Float32Array, reward: number): Float32Array {
  for (let i = 0; i < state.length; i++) gradient[i] = state[i] * reward;   // not a derivative
}
private accumulateGradient(key, gradient, lr) {
  momentum[i] = beta*momentum[i] + (1-beta)*gradient[i];
  accumulator[i] += lr * momentum[i];     // -> this.gradientAccumulator
}
```
`this.gradientAccumulator` is a `Map` keyed by the two literal strings `'positive'`/`'negative'`.
It is never read by the LoRA path and never copied into `weights.A`/`weights.B`.
There is no loss function, no chain rule, no backward pass. `state[i] * reward` is an
element-wise scale, not a gradient of anything.

**(f) The reported "improvement" is arithmetic on a magic constant.**
`modes/balanced.ts:160-172`:
```ts
const baselineQuality = 0.5;                       // hardcoded
const improvementDelta = avgGoodQuality - baselineQuality;
return Math.max(0, improvementDelta);
```
`qualityScore` is itself `0.8*mean(reward) + 0.2*min(1, 10/steps)` (`sona-manager.ts:719-729`),
where `reward` is supplied by the caller. So "improvement" = `mean(caller-supplied numbers) − 0.5`.

**(g) EWC++ operates on an empty map.** `sona-manager.ts:566-580` "consolidates" by multiplying
`ewcState.fisher` by 0.9; `fisher` is initialized empty (`:199-204`) and never populated, so the
loop body never executes. `computeEWCPenalty` (`balanced.ts:282-297`) returns `lambda*0*0.5 = 0`.

**(h) The published latency figure measures the no-op.** `CLAUDE.md` quotes "0.0043ms/adapt —
Measured". `applyAdaptations` (`sona-manager.ts:468-490`) times itself and warns above 0.05 ms.
It is measuring an identity function.

### Interpretation
The word "neural" here means: correctly-shaped matrices that are multiplied but never trained.
"Self-learning" means: an EMA counter and a subtraction from 0.5. The distinction the brief asked
for — gradients and weights vs. heuristics with ML-flavored naming — resolves decisively to the
latter. **This is not a matter of degree; the adaptation path is mathematically inert.**

### Second, unrelated thing also called SONA
`v3/@claude-flow/cli/src/memory/sona-optimizer.ts` (988 L) is what the CLI actually reaches. Its
entire learning step (`:343-357`) is an EMA confidence counter on success/failure, persisted to
`.swarm/sona-patterns.json`. Retrieval is keyword set-intersection (`:701-716`). Its "384-dim
embedding" (`:612-631`) is a hash scatter — `vec[hash(kw) % 384] += ±1` — i.e. a signed
bag-of-words, not a semantic embedding. It tries a native `@ruvector/sona` engine first (`:406-409`),
but `@ruvector/*` is **not installed** in this checkout, so that branch never fires.

---

## FINDING RUFLO-SONA-002 — SONA's tests cannot detect that learning does nothing
**Status: VERIFIED** · Confidence: high

`v3/@claude-flow/neural/__tests__/sona.test.ts` — every assertion on `learn()`:
```
:183   await expect(engine.learn(trajectory)).resolves.not.toThrow();
:226   await expect(engine.learn(emptyTrajectory)).resolves.not.toThrow();
:248   await expect(engine.learn(multiStepTrajectory)).resolves.not.toThrow();
```
Nothing asserts that a weight changed, that quality improved after learning, or that a second
identical input produces a different output. **A `learn()` body of `return 0;` would pass this
suite unchanged.**

Performance tests are also hollow: `:211` and `:279` assert `elapsed < 10` ms against a stated
target of `<0.05 ms` — a 200x slack, commented `// Allow overhead for mocking`.

This is the central lesson: 571 test files bought no protection against the flagship feature
being inert, because the tests assert *absence of exceptions* rather than *presence of effect*.

---

## FINDING RUFLO-NEURAL-003 — Real RL implementations exist but nothing calls them
**Status: PARTIAL** · Confidence: high

`v3/@claude-flow/neural/src/algorithms/` contains genuinely correct implementations:
`dqn.ts` (382 L), `ppo.ts` (429), `a2c.ts` (478), `sarsa.ts` (383), `q-learning.ts` (333),
`decision-transformer.ts` (521), `curiosity.ts` (509).

`dqn.ts` is legitimate: real chain rule through ReLU, momentum SGD that **actually mutates
`qWeights`**, Double-DQN (online net selects, target net evaluates), target network, replay
batching, gradient clipping. This is the only correct trainer in the repository.

**But it is unreachable.** Every importer outside the package itself:
```
$ grep -rn "algorithms/|DQNAlgorithm|PPOAlgorithm" --include=*.ts v3/ plugins/ ruflo/
  v3/@claude-flow/neural/src/index.ts:215,220,252,258   <- barrel re-export
  v3/@claude-flow/neural/__tests__/algorithms.test.ts   <- its own tests
```
No CLI command, hook, MCP tool, or router calls them.

Compounding this: `SONAManager.createInitialStats()` (`sona-manager.ts:773-806`) hardcodes
`algorithm: 'ppo'` into the stats it reports — on a code path that never touches PPO.

**Interpretation:** the capability to do real RL exists in-tree and is well-built. It is wired to
nothing. Reporting `algorithm: 'ppo'` while running an EMA counter is the most misleading single
line found in this repo.

---

## FINDING RUFLO-ROUTER-004 — The KRR model is genuinely trained, but its inference code is absent
**Status: PARTIAL** · Confidence: high

`v3/@claude-flow/cli/assets/model-router/seed-router.krr*.json` (~4.5 MB) — inspected structure:
```
top keys: [ 'candidates', 'qualityBar' ]   qualityBar = 0.25
candidates: 7   keys: [ id, costPerMTok, refEmbeddings, alpha ]
  refEmbeddings  40 x 384      <- retained training set X
  alpha          40            <- dual coefficients
```
`refEmbeddings` + `alpha` is **kernel ridge regression in dual form** (`ŷ(x) = Σᵢ αᵢ k(x,xᵢ)`).
Kernel methods are non-parametric and must carry their training set — which explains the 4.5 MB.
This is a real trained artifact, not a hand-written lookup table. Training scripts exist:
`scripts/auto-retrain-router.mjs`, `scripts/train-bundled-krr.mjs`.

Provenance is honestly documented (`seed-rows.provenance.json`): 40 rows, 384-dim, embedder
`Xenova/all-MiniLM-L6-v2`, scores measured against 7 live models, and an explicit note that
*"Embeddings are real 384-dim semantic vectors from MiniLM, not synthetic deterministic
projections"* — which implies v1 was synthetic. Credit for that disclosure.

**Two independent gates mean it never runs here:**
1. `neural-router.ts:259` — `enabled: process.env.CLAUDE_FLOW_ROUTER_NEURAL === '1'`, off by default.
2. `@metaharness/router` is **not installed** (declared as an *optional peer* at
   `v3/@claude-flow/cli/package.json:144`). `neural-router.ts:330` returns
   `{ available: false, reason: '@metaharness/router not installed' }`.

**The KRR arithmetic itself lives entirely inside `@metaharness/router`, not in this repo.**
Ruflo ships trained weights and a 4-tier fallback loader; the inference math is a third-party
dependency that is absent. Default path falls through to tier 4: pure-TS k-NN over the seed corpus.

**On the "89% routing accuracy" claim:** the training corpus is **40 rows** for a 7-way regression
over 384 dimensions. The companion isotonic calibrator (`seed-router.calibrator.json`) has 13
buckets summing to ~275 samples, several with `count: 1`. I did not locate a held-out test set or
an evaluation script producing 89%. **Status of the 89% figure: UNVERIFIABLE** — no methodology,
dataset split, or reproducible script found. Given N=40 training rows, any accuracy figure would
carry very wide error bars.

---

## FINDING RUFLO-CONSENSUS-005 — Raft, PBFT and Gossip are real implementations
**Status: VERIFIED** · Confidence: high — **this is the best code in the repository**

`v3/@claude-flow/swarm/src/consensus/`: `raft.ts` (561), `byzantine.ts` (514), `gossip.ts` (599),
`index.ts` (296), `transport.ts` (284), `federation-transport.ts` (185).

**Raft is real.** Term numbers, `votedFor`, log, `commitIndex`, randomized election timeout
(150–300 ms, `:297-301`), heartbeats (`:378-380`), §5.1 step-down. The RequestVote handler
implements the log-completeness predicate of §5.4.1 correctly:
```ts
// raft.ts:110-123
const logOk = candLastTerm > my.term || (candLastTerm === my.term && candLastIndex >= my.index);
const granted = termOk && notVotedOrSame && logOk;
```
`startElection` (`:303-333`) computes `votesNeeded = floor((peers+1)/2)+1`.

**Byzantine is real PBFT.** Phases `pre-prepare|prepare|commit|reply` (`:17`), separate
prepared/committed maps (`:35-36`), and the correct quorum test (`:337-341`):
```ts
const f = Math.floor((this.totalNodes - 1) / 3);
if (prepareCount >= 2 * f + 1) { ... }
```
`2f+1` with `f = ⌊(n−1)/3⌋` is exactly right.

**Gossip is real.** Configurable fanout (default 3), random neighbor selection (`:325-331`),
version vectors with LWW merge (`:483-487`), `BoundedSet` capped at 100k for dedup (`:32`).

**Honest self-documentation.** Unusually for this repo, the code states its own gaps:
`raft.ts:135-136` — *"Simplified log matching... Full prevLogIndex/prevLogTerm conflict resolution
is the next refinement."* And `:357-368` marks a *"Legacy in-process path — mutates the local fake
peer state"* used when no transport is injected, where `requestVote` returns `true` if the local
term is higher. So Raft is real **with a transport**; the default without one is a self-satisfying stub.

### Two serious caveats
1. **Zero tests.** Of 571 test files, **none** target `swarm/src/consensus/`. The best-implemented
   subsystem in the repo has no test coverage at all.
2. **The CLI never instantiates them.** `v3/@claude-flow/cli/src/commands/hive-mind.ts` (1,482 L)
   accepts `--consensus byzantine|raft|gossip|quorum`, but prints the choice (`:93,:223,:543,:876`)
   and stores it as a **string tag** (`:1031`: `consensusTag = \`consensus:${...}\``). Its own
   comment at `:1028-1029` admits the value is preserved *"so a future hive-mind worker / consensus
   tool can pick them up."*
   **The user-facing Byzantine consensus flag is decorative**, while a working BFT implementation
   sits unused in a sibling package.

---

## FINDING RUFLO-HNSW-006 — Real HNSW index; benchmark runs below the useful threshold
**Status: PARTIAL** · Confidence: high

`v3/@claude-flow/memory/src/hnsw-index.ts` (1,461 L) is a **competent, real HNSW graph index** —
not a linear scan. Per-layer connection sets (`:202`, `:290`), node levels (`:206`), entry point
(`:220`), and the correct level-assignment constant `this.levelMult = 1/Math.log(M)` (`:245`) — the
mL of Malkov & Yashunin. Search descends greedily from the top layer then runs an ef-width beam at
layer 0 (`:352-372`). Deletion (`:415-445`) correctly unlinks bidirectional edges across layers and
re-elects an entry point.

**The benchmark undercuts the claim:** `benchmarks/hnsw-search.bench.ts:23-26` runs at
**N = 1,000, 128-dim** — far below the crossover where ANN beats brute force. Consistent with the
repo's own admission (`CLAUDE.md`) that a prior "150x–12,500x" figure was measuring a brute-force
fallback, with the real figure ~1.9x at N=20k.

**Stale claim survives in source:** `v3/@claude-flow/hooks/src/reasoningbank/index.ts:8` still
asserts *"Real HNSW indexing (M=16, efConstruction=200) for 150x+ faster search"* — a number the
project's own docs have retracted.

Notable: `cli/__tests__/issue-2922-hnsw-status-honesty.test.ts` — a test whose name indicates a
prior incident where the system reported HNSW as active when it was not.

---

## FINDING RUFLO-RB-007 — ReasoningBank closes the loop, but retrieval quality is contingent
**Status: PARTIAL** · Confidence: medium-high

Two independent implementations:
- `v3/@claude-flow/neural/src/reasoning-bank.ts` (1,362 L) — real cosine + real **MMR** diversity
  re-ranking (`:302-320`). Backing store is an in-memory `Map`, optional AgentDB HNSW (`:271`),
  brute-force cosine fallback (`:284-290`).
- `v3/@claude-flow/hooks/src/reasoningbank/index.ts` (1,090 L) — the one wired to hooks.

**The loop does close.** `hooks/src/reasoningbank/guidance-provider.ts` (416 L) returns hook results
carrying `additionalContext` (`:21,:210,:268,:313,:324`), and `generatePromptContext(prompt)`
(`:111-140`) formats top-3 patterns into prompt text. Retrieved items genuinely re-enter the prompt.

**Three material caveats:**
1. The vector is often meaningless. `computeAggregateEmbedding` mean-pools
   `trajectory.steps[].stateAfter` — whatever `Float32Array` the caller passed. With no embedder,
   it pools noise. `retrieveByContent` (`:359-388`) abandons vectors entirely for lowercased
   string similarity.
2. `FallbackEmbeddingService.embed` (`:969-994`) shells out to
   `npx agentic-flow@alpha embeddings generate` via `execFileSync` (10 s timeout) and on any
   failure **silently** degrades to `hashEmbed` — a per-dimension string hash. Cosine over a hash
   embedding has no semantic structure; it approximates exact-string matching with collisions.
   Also: this can spawn an `npx` subprocess per embedding on a hot path.
3. Some injected "guidance" is hardcoded, not retrieved: `:313`
   *"Running tests. If failures occur, fix them before proceeding."* and `:324`
   *"Building project. Watch for type errors."* are static strings emitted on command
   pattern-match, presented alongside genuinely retrieved patterns.

---

## FINDING RUFLO-SEC-008 — Ed25519 real; mTLS refuted; TLS verification disabled in shipped code
**Status: mixed — see below** · Confidence: high

**Ed25519: VERIFIED.** Uses `@noble/ed25519` v2 (a legitimate, audited library).
`plugins/ruflo-agntcy/src/receipts/casa-receipt.ts` does real signing and verification, with
genuine tests (`__tests__/casa-receipt.test.ts:122-126` asserts cross-key verification fails).
The module docs are unusually candid about the trust model: `:105` notes the signer key is
**self-asserted**, so signatures prove integrity, not identity; `:174` notes an ephemeral key is
*"Still real Ed25519 crypto, just not durable"*. Also real: `signed-artifact.ts`,
`scripts/sign-helpers.mjs`.

**mTLS: REFUTED.** Only 3 files contain the string, all documentation/config generators. The single
code occurrence is a STRIDE threat-model table *printing the word as advice*:
```ts
// v3/@claude-flow/cli/src/commands/security.ts:658
{ category: 'Spoofing', ..., example: 'Strong authentication, mTLS' }
```
There is no `tls.createSecureContext`, no client-certificate configuration, no certificate
validation anywhere in the repo.

**Worse than absent — TLS verification is explicitly disabled.** Searching for real TLS options
returned `rejectUnauthorized: false` in **10+ shipped locations**:
```
cli/src/commands/ruvector/backup.ts:184,584
cli/src/commands/ruvector/benchmark.ts:238
cli/src/commands/ruvector/init.ts:226
cli/src/commands/ruvector/migrate.ts:306
cli/src/commands/ruvector/optimize.ts:166,517
cli/src/commands/ruvector/status.ts:161
plugins/src/integrations/ruvector/ruvector-bridge.ts:279
```
A project advertising zero-trust mTLS ships database connections with certificate validation
turned off. This is a genuine security defect, not merely an unimplemented claim.

**Zero-trust: REFUTED as implementation.** 4 files, all metadata/labels.

**Federation: VERIFIED (partial).** Substantially real —
`plugin-agent-federation/` has `federation-coordinator.ts`, `federation-breaker-service.ts`
(circuit breaker), `federation-envelope.ts` with a claims test;
`swarm/src/consensus/federation-transport.ts` (185 L) is a real transport with correlation IDs and
reply routing; `plugins/ruflo-graph-intelligence/` has client+server+protocol and
`phase8-federation.test.ts`; plus a `.github/workflows/federation-peer-rust.yml`. Not vapor.

---

## FINDING RUFLO-GOAP-009 — Real A*, but a 256-state toy driving a demo UI
**Status: PARTIAL** · Confidence: high

`v3/goal_ui/src/lib/goapPlanner.ts` (180 L). Correct A* semantics — `f = g + h`, closed set,
expansion loop (`:110-137`).

- **State = 8 fixed booleans** (`:26-35`): `goalDefined, goalParsed, stateAssessed,
  informationGathered, documentsAnalyzed, knowledgeSynthesized, insightsGenerated, verified`.
  That is a 256-state space describing a **linear research pipeline**, not a planning problem.
- Heuristic = unmet-goal count (`:59-66`) — admissible only if each action satisfies ≤1 condition.
- Cost = hand-assigned scalar (`:39`).
- **No priority queue** — the open list is an array re-sorted every iteration (`:111`), and the
  state key is `JSON.stringify(newState)`. O(n log n) per expansion. At 256 states, irrelevant.

It lives in `goal_ui`, a React/Supabase demo; `stepGenerator` (`:42`) returns a `Step` carrying a
`LucideIcon` — the planner exists to drive UI cards. `goapPlanner.ts` has **no test**.

---

## FINDING RUFLO-COUNT-010 — Advertised counts are inflated by duplication and mis-counting
**Status: PARTIAL** · Confidence: medium-high

| Thing | Reported/found | Method | Caveat |
|---|---|---|---|
| Agent `.md` files | **370** total, **171 unique** basenames | `find */agents/*.md` excl. node_modules | **~2.2x duplication** |
| — root `.claude/agents/` | 108 | scoped | the canonical set |
| Plugin dirs `plugins/` | 39 | `ls` | all `ruflo-*` |
| Plugin dirs `v3/plugins/` | 15 | `ls` | a second, separate tree |
| MCP tool modules | 48 `.ts` | `ls src/mcp-tools/*.ts` | |
| MCP `name:` literals | 423 | grep | **over-counts badly** |

The **423 is not a tool count** — MCP schemas nest `name:` inside `inputSchema.properties`, so
parameters are counted as tools. True count is materially lower; a precise figure requires parsing
each exported array, which I did not do. **Status: UNVERIFIABLE at stated precision.**

Duplication example: `sona-learning-optimizer.md` exists at 3 paths (`.claude/agents/sona/`,
`v3/@claude-flow/cli/.claude/agents/sona/`, `v3/@claude-flow/mcp/.claude/agents/sona/`), and
`.agents/skills/` mirrors `.claude/skills/` wholesale.

`CLAUDE.md`'s "60+ agent types" is **defensible** against 108 canonical files. A "370 agents" claim
would not be. Separately `CLAUDE.md` says "20 Available" plugins while 54 directories exist — the
registry and filesystem disagree in *both* directions.

---

## 2. OBSERVED vs CLAIMED architecture

**Claimed** (from `CLAUDE.md` / docs): a self-optimizing neural agent swarm with Byzantine
consensus, HNSW vector memory, learned model routing, and zero-trust mTLS federation.

**Observed:** a large TypeScript monorepo wrapping Claude Code / Codex CLIs, in which:
- the neural adaptation path is an identity function (RUFLO-SONA-001);
- the real RL library is unreachable (RUFLO-NEURAL-003);
- the real consensus library is untested and not instantiated by the CLI that advertises it
  (RUFLO-CONSENSUS-005);
- the trained router's inference engine is an uninstalled optional dependency (RUFLO-ROUTER-004);
- mTLS does not exist and TLS verification is disabled in shipped DB connections (RUFLO-SEC-008).

### The recurring structural pattern
> A competent implementation exists in one package; a fallback stub exists in another;
> **the default configuration reaches the fallback.**

This holds for the router (4-tier fallback → tier 4), ReasoningBank embeddings (native → npx →
hash), SONA (native `@ruvector` → keyword matching), and Raft (injected transport → "legacy
in-process fake peer"). In each case the impressive implementation is real and the shipped
behaviour is the degraded one.

### Credit where due
`CLAUDE.md` has clearly been through an honesty pass — Flash Attention figures retracted
("inherited from upstream marketing, never reproduced in-tree"), HNSW speedups corrected,
"150x–12,500x NOT reproduced" stated plainly. That is more self-correction than most projects
attempt. But stale claims survive in source comments
(`hooks/src/reasoningbank/index.ts:8`) and in hardcoded telemetry (`sona-manager.ts:803`
reporting `algorithm: 'ppo'`), so a reader of the code still gets the marketing version.

---

## 3. What was NOT inspected
- The Rust `crates/` tree (39 `.rs` files, 8,460 LOC) — **no Rust toolchain in this environment**;
  could not compile or test. Status of anything there: UNVERIFIABLE.
- `docs/USERGUIDE.md` (299 KB) read only in part.
- The deleted `archive/v2/` tree.
- Whether the 571 Vitest files pass — **not yet run** (deferred to hands-on phase).
- Precise MCP tool count (requires per-array parsing).
