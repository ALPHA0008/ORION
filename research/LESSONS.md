# LESSONS — Transferable Patterns for Building a Harness

Every lesson below is anchored to code I read or executed. Each carries a classification, the
failure mode it addresses, what the simpler version looks like, and a verdict on whether to copy it.

Classifications: `CORE PRIMITIVE` · `ARCHITECTURE` · `DEVELOPER EXPERIENCE` · `RELIABILITY` ·
`MEMORY` · `CONTEXT` · `SCHEDULING` · `SECURITY` · `OBSERVABILITY` · `EVALUATION` · `MULTI-AGENT` ·
`EXTENSIBILITY` · `DEPLOYMENT`

---

## L-01 · The lease/reaper quartet — `CORE PRIMITIVE` · `RELIABILITY`
**Source:** QM — `runs/reaper.ts:40-53`, `runs/postgres-run-store.ts:295-327`,
`persistence/leader-lease.ts:69`

**What it does.** Durable execution is not one thing; it is four, and QM is the only project with
all four:
1. **Ownership with expiry** — `runs.lease_expires_at`. A dead process releases its claim without
   cooperating.
2. **A sweeper with authority** — a reaper gated by `pg_try_advisory_lock`, so exactly one node
   reclaims.
3. **Compare-and-set on reclaim** — `retire(run, reason, requeue, { ifExpiredAt: now })`, so two
   sweepers cannot double-retire.
4. **A poison bound** — `maxAgeMs` exceeded → **park**, not retry forever.

**Why it works.** Each piece defends against a failure the others create. Leases without a sweeper
leak; a sweeper without CAS double-executes; CAS without a poison bound loops forever on a bad task.

**Failure mode solved.** "The process died at step 17." The only credible answer found in this audit.

**Simpler version.** ~150 lines against SQLite: a `runs` table with `lease_expires_at` and
`attempts`, a periodic `UPDATE ... WHERE lease_expires_at < now()` guarded by `BEGIN IMMEDIATE`.
Single-node loses only the leader election.

**Copy?** **Yes — into the core, day one.** Verified: 25/25 tests pass against a live Postgres.
Retrofitting the *state model* this requires is expensive; the mechanism itself is cheap.

---

## L-02 · Adapters that declare their capability gaps — `ARCHITECTURE` · `EXTENSIBILITY`
**Source:** QM — `harness/harness.ts:159-167`, and the four `defineHarness(...)` call sites

**What it does.** Each harness adapter publishes a machine-readable profile:
```ts
{ id: "codex", controlTransport: "json-rpc", toolTransport: "dynamic",
  transcriptFormat: "responses-api",
  capabilities: new Set(["abort","steer","images","provider-sessions"]) }
```
Pi declares all six capabilities; Claude lacks `provider-sessions`; Codex and OpenCode lack
`thinking-level` and `fast-mode`.

**Why it works.** The usual failure of an abstraction over N vendors is pretending they are
identical, which forces either lowest-common-denominator features or runtime surprises. Declaring
the gaps lets callers branch honestly and lets tests assert per-adapter behaviour.

**Failure mode solved.** "The abstraction says this works, but not on this backend."

**Simpler version.** A capability set is already the simple version. Do not replace it with feature
flags scattered through the code.

**Copy?** **Yes.** This is the single most transferable idea in QM, and it costs a type and a Set.

---

## L-03 · Git as the file-checkpoint store — `CORE PRIMITIVE` · `RELIABILITY`
**Source:** Hermes — `tools/checkpoint_manager.py:755` (+ `:205,216,728`); verified live via
`hermes checkpoints --help`

**What it does.** Before every `write_file` / `patch` / `terminal` call, Hermes snapshots the working
directory into a **bare shadow git repo**, keyed by a hash of the working directory path, with a JSON
ledger alongside. Per-turn dedup (`new_turn()`), `prune`, GC and a legacy-migration path.

**Why it works.** You get diffing, history, compression, and rollback for free from a battle-tested
tool, instead of inventing a snapshot format. It also keeps file history *out* of the session
database, so the two can be pruned on different schedules.

**Failure mode solved.** The agent makes a bad edit and the user needs `/rollback` — without
polluting the user's own git history.

**Simpler version.** `git init --bare` in a cache dir + `git --work-tree=… add -A && commit` before
each write. Perhaps 80 lines.

**Copy?** **Yes.** Cleverest single idea in the audit. Operational commands (`prune`, `clear-legacy`)
signal it survived real disk pressure.

---

## L-04 · Repair the transcript instead of crashing — `RELIABILITY`
**Source:** Hermes — `conversation_loop.py:8511-8532` (orphan repair), `:8151-8168` (dropped tool
calls), `:1360`/`:2504` (tool-arg canonicalisation)

**What it does.** When a provider returns `finish_reason="tool_calls"` with an empty array, or leaves
a `tool_call_id` unanswered, Hermes **synthesises the missing `role:"tool"` stub messages** so the
message array stays valid for the next API call.

**Why it works.** Providers violate their own contracts. An invalid message array poisons every
subsequent turn in the session — a single glitch becomes a permanently broken conversation.

**Failure mode solved.** Unrecoverable session corruption from one malformed provider response.

**Simpler version.** A validation pass before each API call: every `tool_call_id` in the last
assistant message must have a matching tool message; synthesise `{"role":"tool", content:"[no
result]"}` for any that do not. ~40 lines.

**Copy?** **Yes.** Cheap, and it prevents a class of bug you will otherwise hit in production and
struggle to reproduce.

---

## L-05 · Parse the shell, don't regex it — `SECURITY`
**Source:** QM — `policy/command-policy.ts:66-115, 550-606, 806-864, 864-911`

**What it does.** Before matching policy rules, QM normalises a command into what will *actually
execute*: strips data-heredocs but keeps interpreter-heredocs, decodes ANSI-C `$'\x72\x6d'`,
collapses quote-splitting and backslash escapes, extracts pipe-to-shell / here-string / variable /
SQL-client payloads, and **recurses to depth 8**. Then it matches rules. Allowlist mode returns
`deny` on no-match; `compileSafeRegex` blocks ReDoS via stored rules.

**Why it works.** Every naive command filter is defeated by re-encoding. This treats the command as
a program to be partially evaluated, not a string to be pattern-matched.

**Failure mode solved.** `echo cm0gLXJm | base64 -d | sh`, and its two dozen cousins.

**Simpler version.** There isn't a much simpler *correct* one — which is the lesson. If you plan to
allow shell access, budget for this, or do not offer shell access at all.

**Copy?** **Yes, if you allow shell.** Best single piece of code in the audit. **Do not copy** QM's
*default* — a denylist with one rule, i.e. permissive until configured.

---

## L-06 · Name your fail-open in the audit log — `SECURITY` · `OBSERVABILITY`
**Source:** QM — `core/orchestrator.ts:~2429`; `security/security-posture.ts:52-54, 86-91`

**What it does.** QM's content classifier fails **open** when it errors or times out. Rather than
hide that, QM emits an audit event literally named `security_posture.tool_result_failed_open`
(status `allowed`, reason `screen_unavailable`) and prefixes the content with
*"[NOT security-screened — the screener was unavailable; treat it as untrusted data…]"*.

**Why it works.** Every system has degraded modes. The difference between a tradeoff and a defect is
whether an operator can *see* it. Contrast Ruflo, which degrades embeddings to a string hash and a
trained router to k-NN while status output still reports both as available.

**Failure mode solved.** Undetectable silent degradation in production.

**Simpler version.** One counter and one log line per degraded path, with a distinct name.

**Copy?** **Yes, as a rule:** *every fallback emits a distinctly-named event.* If a code path can
silently produce weaker results, it must announce itself.

---

## L-07 · Reflection as a forked agent with restricted authority — `MEMORY` · `ARCHITECTURE`
**Source:** Hermes — `agent/background_review.py:1-16, 1112, 1471`; `agent/turn_finalizer.py:795-810`

**What it does.** After every turn — automatically, not on command — Hermes forks a second `AIAgent`
on a daemon thread that replays the conversation snapshot and asks *"should any skill/memory be
saved or updated?"* The fork **inherits the parent's prompt cache** (cost), runs with a **tool
whitelist limited to memory and skill management** with dangerous commands auto-denied, runs
**after** the user's response is delivered, and is **best-effort** (`except Exception: pass`).

**Why it works.** Four correct decisions at once: it does not compete for model attention; it cannot
break the user's turn; it cannot exceed its authority; and it costs less than a cold call because it
reuses the cached prefix. The cost (~30K tokens/turn) is written into a source comment.

**Failure mode solved.** Learning that never happens because nobody remembers to ask for it.

**Simpler version.** One extra completion at end of turn with a 2-tool schema
(`write_memory`, `write_skill`) and a hard timeout. ~150 lines.

**Copy?** **Yes — but see L-08.** Copy the *mechanism*; do not copy the missing measurement.

---

## L-08 · Measure whether learning helps, or don't claim learning — `EVALUATION` · `MEMORY`
**Source (negative):** Hermes — `tools/skill_usage.py:146,166,250,393`; `evals/` (3 areas only).
**Source (negative):** Ruflo — `sona-optimizer.ts:343-357`; `balanced.ts:160-172`.

**What is missing.** Hermes tracks skill **activity counts and timestamps**, and prunes on *disuse*.
It never measures whether a written skill made later tasks succeed more often. Ruflo's "improvement"
is `mean(quality) − 0.5` where 0.5 is hardcoded and `quality` is caller-supplied.

**Why it matters.** Without an outcome signal you cannot detect skill-library rot, you prune by
popularity rather than value, and "self-improving" is an unfalsifiable claim. **This is the largest
gap common to all three projects** and therefore the clearest opportunity for genuine
differentiation.

**Simpler version.** Log `(task_id, skills_injected[], outcome)` per run, where outcome is any cheap
proxy (tests passed / user accepted / no retry). Then periodically compare success rates with and
without each skill. A table and a query — perhaps 200 lines.

**Copy?** **Build what nobody built.** Learning without measurement is filing, not learning.

---

## L-09 · Discover tools by parsing, not importing — `EXTENSIBILITY` · `DEVELOPER EXPERIENCE`
**Source:** Hermes — `tools/registry.py:111, 74, 87, 165-190`

**What it does.** `discover_builtin_tools()` walks the tools directory and **parses each module's
AST** looking for `registry.register(...)` calls, rather than importing every module to see what it
registers. Results are disk-cached (`tool_discovery_cache.json`, verified created live).

**Why it works.** Importing to discover means paying every module's import cost and side effects at
startup — and one broken optional dependency breaks discovery entirely.

**Failure mode solved.** Slow cold start; a missing optional dep taking down the whole tool registry.

**Simpler version.** A static manifest file. Loses auto-discovery, keeps the speed.

**Copy?** **Yes**, if you have >30 tools with optional dependencies. Below that, a manifest is fine.

---

## L-10 · Stop plugins from hijacking first-party tools — `SECURITY` · `EXTENSIBILITY`
**Source:** Hermes — `tools/registry.py:236, 645, 655`

**What it does.** `_PluginOverridePolicy` / `_plugin_override_allowed` / `_plugin_owner_of` prevent a
pip-installed package from silently replacing a built-in tool such as `write_file`.

**Why it works.** In any plugin system with a shared namespace, last-registration-wins is a
supply-chain vulnerability: a typosquatted dependency can redefine your file-write tool.

**Failure mode solved.** Dependency-confusion attack against the tool namespace.

**Simpler version.** Namespace plugin tools (`plugin_name.tool_name`) and refuse collisions with
built-ins. ~20 lines.

**Copy?** **Yes.** Rarely considered; cheap to add; expensive to retrofit after an incident.

---

## L-11 · Record/replay makes a nondeterministic system testable — `EVALUATION` · `OBSERVABILITY`
**Source:** QM — `harness/replay.ts`, `harness/tape-fold.ts`; `HarnessTurnInput.tapeMode:
"shadow" | "serve"` (`harness.ts:84`)

**What it does.** Turns are recorded to a "tape". In `shadow` mode the system records while running
live; in `serve` mode it replays recorded responses deterministically.

**Why it works.** You cannot regression-test an LLM loop against a live model — it is expensive,
slow and nondeterministic. A tape converts it into an ordinary deterministic test.

**Failure mode solved.** "We changed the orchestrator and cannot tell what behaviour changed."

**Simpler version.** Hash the request; store the response as JSON; a `REPLAY=1` env var serves from
cache and fails loudly on a cache miss. ~120 lines.

**Copy?** **Yes — early.** Retrofitting a tape after the request path has grown is painful; QM
threads it through the harness input type from the start.

---

## L-12 · Scope as a mandatory query predicate — `SECURITY` · `ARCHITECTURE`
**Source (positive):** QM — `memory/postgres-memory-service.ts:7,13,15,22,45,58`
**Source (negative):** QM — `types.ts:15` (`export type ScopeId = string`)

**What it does.** Every persistence operation carries `WHERE scope_id = $1`; the column is
`NOT NULL`; uniqueness and indexes are `(scope_id, seq)`; per-scope advisory locks serialise writes.

**Why it works.** Tenancy enforced at the *data-access boundary* cannot be bypassed by a caller who
forgets — provided every store author adds the predicate.

**The flaw, and the fix.** `ScopeId = string` means the compiler cannot distinguish an org scope from
a personal one; correctness rests on discipline. A **branded type** —
`type ScopeId<K extends ScopeKind> = string & { __scope: K }` — makes whole classes of tenancy bug
unrepresentable for roughly zero runtime cost.

**Copy?** **Copy the predicate discipline; fix the type.** This is QM's one structural weakness and
the cheapest high-value improvement available to it.

---

## L-13 · Compose policy as a floor, never an override — `SECURITY`
**Source:** QM — `security/security-posture.ts:24-39`

```ts
export function composeSecurityPosture(orgFloor, scope) {
  if (!scope || POSTURE_RANK[orgFloor] >= POSTURE_RANK[scope]) return orgFloor;
  return scope;   // a narrower scope may only RAISE
}
```
**Why it works.** Multi-tenant policy fails when a sub-scope can weaken the parent. Ranking postures
and taking the max makes weakening structurally impossible rather than merely forbidden.

**Failure mode solved.** A team channel setting itself to `dangerous` under a `strict` org.

**Simpler version.** This is already minimal — an integer rank and a `max`.

**Copy?** **Yes**, for any multi-tenant setting, not just security.

---

## L-14 · Per-scope, per-model context budgets and an explicit cache boundary — `CONTEXT`
**Source:** QM — `harness.ts:71` (`systemCacheBoundary`), `:148`
(`contextTokenBudget(scopeLabel?, model?)`)

**What it does.** Token budget is a function of *scope and model*, not a global constant. The system
prompt's stable prefix length is passed explicitly so the provider's prompt cache can be hit
deliberately.

**Why it works.** Different models have different windows and different economics; different tenants
warrant different spend. And prompt caching only pays if the prefix is genuinely stable — which
requires the system to *know* where stability ends.

**Failure mode solved.** One global `MAX_TOKENS` that is wrong for every model; and cache misses
caused by a timestamp accidentally inside the "stable" prefix.

**Copy?** **Yes.** Both are small and both save real money.

---

## L-15 · Isolate parallel subagents with git worktrees — `MULTI-AGENT`
**Source:** Hermes — `tools/subagent_worktree.py` (352 L); per-turn delegate cap at
`conversation_loop.py:7245`

**What it does.** Each subagent that may write files gets its own git worktree. A per-turn cap on
delegate calls prevents fork bombs.

**Why it works.** Parallel agents editing one working tree corrupt each other in ways that are
maddening to debug. Worktrees give real filesystem isolation with a shared object store — cheap,
and merges are ordinary git operations.

**Simpler version.** `git worktree add` per subagent, remove on completion. ~60 lines.

**Copy?** **Yes**, if subagents can write. If they are read-only, skip it.

---

## L-16 · A doctor command that encodes your incident history — `DEVELOPER EXPERIENCE` · `OBSERVABILITY`
**Source:** Hermes — `hermes_cli/subcommands/doctor.py`; executed live

**What it does.** Detected in this environment a **specific upstream SQLite WAL-reset bug by version
and source id**, named the fixed versions (3.51.3+/3.50.7/3.44.6), linked the advisory; also screens
MCP stdio commands for suspicious invocations and flags models retired on a known date.

**Why it works.** Every check is a scar. This is institutional memory as executable code, and it
deflects support load before a user files an issue.

**Failure mode solved.** Silent environment-specific data corruption; hours of user debugging.

**Copy?** **Yes.** Start it at v0 and add one check per incident, forever.

---

## L-17 · Filter machine-generated turns out of durable personal memory — `MEMORY`
**Source:** Hermes — `plugins/memory/honcho/__init__.py:33-45` (`_INTERNAL_GATEWAY_TURN_RE`)

**What it does.** Synthetic gateway turns (`[ASYNC DELEGATION COMPLETE]`, `[CONTEXT COMPACTION]`)
are excluded from anything written to the durable *user model*.

**Why it works.** Long-term memory is polluted by the harness's own bookkeeping unless it is
explicitly excluded — and once polluted, the user model degrades invisibly.

**Simpler version.** Tag every message with an `origin` at creation (`user` / `agent` / `system` /
`synthetic`) and filter on it. Better than regexing the text back out later.

**Copy?** **Yes** — as origin tagging, which is the cleaner form of the same idea.

---

## L-18 · Assert effects, not the absence of exceptions — `EVALUATION`
**Source (negative):** Ruflo — `neural/__tests__/sona.test.ts:183,226,248`

```ts
await expect(engine.learn(trajectory)).resolves.not.toThrow();
```
Every test of the flagship learning function asserts only that it did not throw. **A body of
`return 0;` passes this suite unchanged** — which is effectively what the code does, since the LoRA
`B` matrix is never written.

**The lesson.** 571 test files bought no protection because the assertions checked the wrong thing.
Meanwhile the *best* code in that repository (Raft/PBFT/Gossip) has **zero** tests.

**The rule.** For any function claiming to change state, assert **the state changed**:
```ts
const before = snapshotWeights(engine);
await engine.learn(trajectory);
expect(snapshotWeights(engine)).not.toEqual(before);   // this would have caught it
```

**Copy?** **Yes, as a review rule.** Never accept `not.toThrow()` as the test for a mutating
function.

---

## L-19 · Outsource durability; hand-roll only your differentiator — `ARCHITECTURE` · `DEPLOYMENT`
**Source (positive):** QM — `pg-boss@12`, `pg_try_advisory_lock`, `FOR UPDATE SKIP LOCKED`
**Source (negative):** Ruflo — a hand-written Raft that nothing instantiates

**What it does.** QM uses correct, boring Postgres idioms for queueing, leader election and
locking — and spends its own engineering on the shell parser and the harness abstraction, which are
genuinely its differentiators. Ruflo implemented distributed consensus from scratch and then never
called it.

**The lesson.** Every hand-rolled infrastructure primitive is a permanent maintenance liability that
must be justified by differentiation. `FOR UPDATE SKIP LOCKED` is thirty years of other people's
debugging, available for free.

**Copy?** **Yes, as a rule.** Ask of each subsystem: *is this why anyone would choose us?* If not,
use the boring dependency.

---

## L-20 · A "(Real)" label is not a substitute for being real — `OBSERVABILITY`
**Source (negative):** Ruflo — `ruflo neural status` prints
`Neural Network Status (Real) | SONA Coordinator | Active | Adaptation: 1.14μs avg`
against a transform proven to be the identity function.

**The lesson.** Status output is an API. When it reports "Active" for a path that does nothing,
operators make decisions on false information — and the falsehood is *harder* to detect than a
crash. Reporting a measured latency (`1.14μs`) for a no-op is worse still: it looks like evidence.

**The rule.** Status should report **observed effect**, not configuration. "SONA: enabled,
0 weight updates in last 1,000 adaptations" would have told the truth automatically.

**Copy?** **Invert it.** Make status derive from counters of *work actually done*, so an inert path
cannot report itself healthy.

---

# 10 ideas worth stealing

1. **L-01** Lease + leader-elected sweeper + CAS reclaim + poison bound *(QM)*
2. **L-02** Adapters that declare capability gaps in a machine-readable set *(QM)*
3. **L-03** Git shadow repo as the file-checkpoint store *(Hermes)*
4. **L-04** Transcript repair for malformed provider responses *(Hermes)*
5. **L-11** Record/replay tape, threaded through from day one *(QM)*
6. **L-06** Every fallback emits a distinctly-named audit event *(QM)*
7. **L-07** Reflection as a restricted-authority forked agent, auto-run after the response *(Hermes)*
8. **L-13** Policy composed as a floor that can only be raised *(QM)*
9. **L-16** A `doctor` command that accumulates one check per incident *(Hermes)*
10. **L-05** Parse the shell rather than regexing it, if you allow shell at all *(QM)*

# 10 ideas worth avoiding

1. **Consensus protocols inside a harness** — Ruflo's Raft/PBFT/Gossip are correct, untested, and
   never instantiated. Not a harness concern.
2. **Custom RL** — Ruflo's DQN has real backprop and zero callers. Route with a heuristic first.
3. **Learned model routing before you have data** — a KRR model trained on **40 rows**, whose
   inference engine is an uninstalled optional dependency.
4. **Symbolic planners for LLM tasks** — a GOAP A* over 8 booleans (256 states) driving UI cards.
5. **Silent fallbacks** — Ruflo degrades embeddings, routing and adaptation without signalling.
6. **`ScopeId = string`** — tenancy that the compiler cannot check *(QM's one structural flaw)*.
7. **Multi-thousand-line loop bodies with god-object state** — Hermes' 6,550-line `while` and a
   13,220-vs-3,307 fix:feat ratio.
8. **Eight backends for one abstraction** — Hermes' 8 memory providers; two would prove the seam.
9. **`.resolves.not.toThrow()` as the test for a mutating function** — the assertion that let a
   flagship no-op ship.
10. **Permissive-by-default policy** — QM's excellent command policy defaults to a denylist with a
    single rule.

---

# The meta-lesson

The three projects fail along **orthogonal axes**, and each failure is instructive in a different way:

- **QM** shows what it costs to be *correct*: mandatory Postgres, external sandboxes, a bus factor
  of 2 — the price of durability and tenancy done properly.
- **Hermes** shows what it costs to be *real*: 13,220 fix commits, a 21,665-line CLI file, and
  hard-won provider workarounds that no amount of design foresight would have produced.
- **Ruflo** shows what it costs to build for the *claim* rather than the failure: correct consensus
  nobody calls, real RL nobody calls, and a flagship feature that returns its input unchanged while
  the status screen reports it "Active".

The strongest single filter for a new harness is the Vercel course's own principle:
**"Each step exists because the previous one broke something."** Every capability that cannot name
the failure it fixes is a candidate for deletion — and, on this evidence, most of what separates a
good harness from an impressive-sounding one is obeying that rule.
