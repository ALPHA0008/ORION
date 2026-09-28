# Wave 1 Decision Gate

## Decision: **`OSS_ARCHITECTURE_PACKAGEABLE`**

The current runtime **can** be packaged as a coherent open-source developer product **without a
major architectural rewrite**.

## The evidence this rests on

**Structural**

| finding | measurement |
|---|---|
| source size | **2,701 lines, 14 modules** |
| **zero** third-party production dependencies | every import is a `node:` builtin or relative |
| **zero** circular imports | verified across all 15 files |
| **9 of 14 modules are leaves** | coupling concentrated in CLI (10) and worker (7) — correct places |
| build step | **none** — plain ESM, publish the source |
| CLI portability | verified runnable by absolute path from an unrelated cwd |

**Behavioural — all executed in this audit, not inferred**

| claim | verification |
|---|---|
| tests green | **608 passed, 0 failed, 23 suites** |
| a run works end to end | 35 s, local model, fresh directory |
| escalation is durable | run paused `awaiting_human`, claimable |
| `explain` renders a real trajectory | 17 sequenced events with token accounting |
| `replay` costs nothing | *"reconstructed from the event log — no model calls, no cost"* |
| `fork` branches history | new run with `⑂#95044d62bb@9` lineage, **and it warned about a mid-turn split** |
| `doctor` is a real diagnostic | home, db integrity, runs, endpoint, posture, leases |

**Architectural**

- Event log is a **frozen closed set of 31 types** with rejection of unknowns — a contract, not
  opportunistic logging.
- Provider quirks are confined to conditional shims on the normalised result; the Qwen quarantine
  required **zero** `v0/src` changes.
- The Kernlbase seam already exists: `authorize(action, context) → allow | deny | escalate`,
  plus `scope` on runs and a consumable event stream. The commercial split needs a different
  authorizer, **not a refactor**.
- `eval/` is a **working second consumer** of the runtime across 9 modules — the API has been
  exercised outside its own tests.

## Why not `OSS_NEEDS_REFACTOR`

Every gap found is a **missing artifact or a localised behavioural defect**, not a structural
problem:

| gap | nature |
|---|---|
| no `package.json` | missing file (hours) |
| no `LICENSE` | a decision, unconstrained by dependencies |
| `grep` file-path defect | ~5-line fix in `sandbox.grep` |
| `grep` searches `.harness/` | one exclusion |
| `run` exits 0 unconfigured | one exit code |
| no `examples/` | new content |

None requires moving a module, breaking an import, redesigning an interface, or changing a
guarantee. Judged against all eight brief criteria: **six need nothing, two need minor cleanup.**

## Why not `OSS_PACKAGEABILITY_BLOCKED`

Nothing is unknown or unresolvable. There is no dependency to untangle, no build to configure, no
license conflict (zero dependencies), no unsupported platform, no missing information. The single
blocking artifact — `package.json` — is short precisely *because* the project is dependency-free.

## The honest caveats carried forward

1. **`grep` defect 1 is severe for first impressions.** In the very first realistic task in a clean
   directory, a present file was reported missing and the agent escalated — a correct response to
   bad information. Fix before release.
2. **`bash` is not pre-state witnessed.** Observable, conservatively authorized, crash-safe — but
   the asymmetry with `write`/`edit` must be *documented*, never implied away.
3. **`fork` rewinds history, not the workspace.** The CLI says so; the docs do not.
4. **README examples show a binary that does not exist.** True the moment the manifest lands.
5. **This is not a capability claim.** Stage 1 measured 2–3/17 and 2/18. The product is the
   *runtime*, not the agent's problem-solving.

## Verdict in one sentence

The hard part — durable, recoverable, replayable, forkable execution with a closed event contract
and 608 tests — is **built and verified**; what remains is conventional packaging work.
