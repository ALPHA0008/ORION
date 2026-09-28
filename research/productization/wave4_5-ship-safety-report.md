# Wave 4.5 — Ship Safety + Wiring Integrity: report

Executed 2026-09-05, driven by `ORION-PRODUCTION-COMPETITIVE-AUDIT.md`. Not a feature wave: every
change traces to a confirmed audit finding. **Nothing published.**

---

## Summary

| | before | after |
|---|---|---|
| Test suite | 904 passed / 30 suites | **950 passed, 0 failed / 31 suites** |
| `verify` vs deployer policy | **bypassed entirely** | denied at every posture |
| Completion verdict | verified work reported FAILED | verdict correct in all six cases |
| Wave 4 from the CLI | unreachable | provider + streaming wired, **confirmed live** |
| Capability sets | **inverted** | match the implementation |
| Package version | `0.1.2` (4 waves behind) | **`0.2.0` staged, not published** |
| Event contract | v4 / 39 | **unchanged** — no fix required one |

---

## F1 — `verify` bypassed the authorizer's denyCommandPatterns  *(SECURITY, CRITICAL)*

### Root cause, confirmed at source

Two halves of the same hole:

- `worker.mjs:443` — `command: tc.name === 'bash' ? tc.args?.cmd : undefined`
- `auth/default/index.mjs:69` — `if (action.name === 'bash' && typeof action.command === 'string')`

`verify` also runs shell commands. It received neither the command nor the check.

### Proven before fixing

```
bash    -> deny     command matches a hard-deny pattern
verify  -> allow
```

A deployer's `denyCommandPatterns: [/\bgit\s+push\b/]` stopped `bash git push --force` and
**allowed `verify git push --force`**.

### Fix — at the right layer, keyed on the argument not the name

The worker now declares the command for **any command-bearing tool**
(`typeof tc.args?.cmd === 'string'`), and the authorizer gates on **the action carrying a command**
rather than on a hardcoded tool name. Keying on the argument means the next command-bearing tool is
covered the day it is added, instead of silently reopening the hole.

`verify`'s own narrower static denylist (`isKnownDangerous`, in `agent/tools`) is untouched — that
is the tool refusing side-effecting commands by construction. This is the **deployer's** policy,
which the tool cannot know about. `core/recovery` was not grown; the
`isKnownDangerous`/`classifyShell` distinction stands.

### Verification

Unit, all three postures:

```
bash    git push -f  -> deny        verify  git push -f  -> deny
verify  npm test     -> allow       read    (no command) -> allow
```

End-to-end on the **installed 0.2.0 build**:

```
tool.denied recorded : true (verify: command matches a hard-deny pattern)
verify ever STARTED  : false
```

Regression tests: `shipped/F1-deny-patterns-apply-to-every-command-bearing-tool` (deny at
permissive/auto/strict for both tools; three legitimate commands still allowed) and
`shipped/F1c-the-command-actually-REACHES-the-authorizer` — which asserts the worker hands the
policy the command, because the authorizer can only enforce what it is given.

---

## F4 — completion-contract false negative  *(CORRECTNESS)*

### Root cause

`cli/index.mjs`: `if (plan) return planSatisfied(plan);` — once a plan existed it was the **only**
objective. A run that edited the file **and got a verify PASS** was recorded
`finished_without_change` because the model never called `plan_step`.

Wave 1 stopped the runtime over-claiming success. Wave 2 made it **under-claim**. Under-claiming is
equally untruthful and worse for a user: they cannot tell a real failure from an unticked box.

### Fix — direct evidence outranks bookkeeping

A plan step is *meant to attest to* a successful mutation and a passing check. When both are in the
log, the objective is met however the steps were marked:

```
planSatisfied(plan)                                        -> satisfied
!hasUnresolvedFailure && mutationSucceeded && verifyPassed  -> satisfied
otherwise (plan exists)                                     -> NOT satisfied
```

One exception kept deliberately strict: a step explicitly marked **failed** still blocks. That is
the model's own report of incompleteness, not a missing tick.

### Verdict table — `shipped/F4-completion-verdict-at-DEFAULT-wiring`

| case | verdict | why |
|---|---|---|
| plan declared + satisfied | **completed** | the clearest statement the work is done |
| **verified work, no `plan_step`** | **completed** | the regression — mutation + verify PASS |
| mutation, no verify, no `plan_step` | not completed | unfinished plan, no direct evidence |
| **nothing done at all** | **not completed** | Wave 1's D2 guarantee, intact |
| verified work + a step marked `failed` | not completed | an explicit failure still blocks |
| no plan + mutation succeeded | completed | the Wave 1 path, untouched |

---

## F5 — Wave 4 unreachable from the CLI  *(PRODUCT)*

### Root cause

`cli/index.mjs:77` hardcoded `createOpenAICompatModel`. The provider seam and streaming were fully
built and tested as modules and **could not be used from `orionctl`**.

Compounding it, the capability sets were **inverted** — confirmed at source:

```
openai-compat  declares streaming: false | implements invokeStream: true
anthropic      declares streaming: true  | implements invokeStream: false
```

Capability negotiation was meaningless in both directions: the capable provider was never asked to
stream, and the incapable one would have been.

### Fix

- `buildModel(env)` uses `createProvider({kind})`; **`ORION_PROVIDER`** selects
  `openai-compat` (default) or `anthropic`, which gets a real default endpoint so a key alone
  suffices. An unknown kind exits 2 with the known kinds named.
- **`ORION_STREAM`** controls streaming, **default ON** — it is what makes `ttft_ms` observable and
  leaves a durable partial when a call dies. A provider that cannot stream is **not** silently
  downgraded: the worker records `degraded` and falls back.
- Capability sets corrected to match the implementations. Anthropic will declare `streaming` the day
  it has `invokeStream`, and not before.

### Wiring table — `shipped/F5-*`

| surface | result |
|---|---|
| default provider | `openai-compat` |
| `ORION_PROVIDER=anthropic` | `anthropic:claude-sonnet-5`, endpoint `api.anthropic.com` |
| stream default | ON |
| `ORION_STREAM=off` / `0` | OFF |
| gemma shim auto-select | still reachable (Wave 1 D3 preserved) |
| capability vs implementation | **consistent for both providers** |

### Confirmed live on the installed 0.2.0 build

```
stream.started : 17     <- streaming reached the CLI path
stream.delta   : 43
ttft_ms        : 378 | bytes: 391
provider       : openai-compat | host: 172.20.7.22:8000
run status     : completed      <- F4: verified work is COMPLETED
```

---

## F3 — the suite validated mechanisms, never the shipped configuration  *(STRUCTURAL — the top finding)*

The audit's central observation, and the one that explains the rest. Six occurrences of one class:

| wave | defect | passed its own tests? |
|---|---|---|
| 1 | D2 — the completion contract existed; the CLI passed none | yes |
| 1 | D3 — the shim existed; the CLI wired none | yes |
| 2 | the shim could not express an array argument | yes |
| 3 | compaction never fired on a real run | yes |
| 4 | F1 — `verify` bypassed the deployer's policy | yes |
| 4 | F5 — the provider seam was unreachable | yes |

Every one was found by manual testing or an audit, never by the suite — because the suite tested the
**modules** and the defect was in the **composition**.

### `tests/shipped/` — 44 assertions

Asserts the wiring `orionctl run` actually composes: the shipped contract, the shipped authorizer,
the shipped `buildModel`, the shipped prompt.

- **F1**: deny patterns apply to every command-bearing tool, at all three postures; legitimate
  verify commands still allowed.
- **F1c**: the command **reaches** the authorizer — the fix is inert otherwise.
- **F4**: the six-case verdict table above, through the default contract.
- **F5 / F5b**: provider selection, streaming toggle, capability↔implementation consistency.
- **F3d**: prompt-vs-toolset drift — every tool named in the shipped prompt exists, and every
  quoted term names a real tool or argument. (This caught my own over-broad first assertion, which
  flagged the argument name `'evidence'` as a missing tool.)

**The operating rule this encodes: if a mechanism is not reachable from here, it is not shipped —
whatever its own suite says.**

---

## F2 — the published package is four waves behind  *(PRODUCT, CRITICAL)*

`@kernlbase/orion@0.1.2` was published 2026-09-03. Wave 1 landed 2026-09-04. **Anyone installing
today gets the build that reports `✓ model_finished` on unperformed work** — the exact defect Wave 1
exists to fix, plus the F1 security hole.

### Version: `0.1.2 → 0.2.0` — justification

A **minor** bump, not a patch and not a major:

- **Not a patch.** Four waves of behaviour change: a completion gate that changes verdicts, planning
  and artifacts, compaction on by default, a provider seam, streaming, and a security fix. The event
  contract went **v1 → v4** (31 → 39 types).
- **Not a major.** The package is `0.x`, where the documented policy in the shipped README is that
  the public API and CLI surface may change between minor versions. Under SemVer, `0.x` minor is the
  correct vehicle for exactly this. A `1.0.0` would assert a stability commitment this runtime has
  not earned: it still has no external users.
- **Contract compatibility holds.** Event types were only ever added; v1/v2/v3 logs replay unchanged
  under v4, and a test asserts it.

### Pack validation

```
kernlbase-orion-0.2.0.tgz   48 files   unpacked 340.5 kB
leak check: clean   (no research/, eval/, tests/, .env, .npmrc, no database)
ships: ADRs  CONTRIBUTING.md  LICENSE  README.md  docs  examples  package.json  src
```

Fresh install into a clean directory:

```
added 1 package, 0 vulnerabilities
orionctl --version          -> 0.2.0
orionctl doctor             -> home, db ok, endpoint, posture auto, integrity ok
library                     -> contract v4 | 39 types | 66 exports | providers: openai-compat, anthropic
```

**STAGED, NOT PUBLISHED.** The version bump and tarball are prepared; `npm publish` is a separately
gated action and was not run in this session.

---

## F6 — the missing Wave 4 report

`wave4-report.md` did not exist. Written retroactively from `1be187a`, `c8b106f`, the plan, and the
verified state.

Its manual-testing section states **explicitly what was not exercised**: no live Anthropic API call
was ever made — the provider was tested against a stub speaking `/v1/messages` plus unit-level
translation tests; the manual "Provider B" was a second *OpenAI-compatible endpoint*, not the second
provider implementation; and streaming was exercised only on the openai-compat path. Not fabricated.

That absence is itself the finding: writing "swap the provider from the product surface" would have
revealed there was no way to do it. **F5 was caused by the missing report.**

---

## Manual gate (standing rule, §8) — installed 0.2.0, real model

Baseline `1 failed`. `gemma4-31b` via vLLM:

```
✓ plan_step step 4 -> done
✓ verify PASS (exit 0) py -m pytest -q . [100%] 1 passed in 0.03s
✓ model_finished

$ cat calc.py   -> return a + b        $ py -m pytest -q -> 1 passed
```

Ground truth verified on disk and by the test runner, never the self-report. Streaming and the F4
verdict confirmed from the log by a separate process (table under F5).

---

## Deviations and honest findings

1. **A stray `0x08` byte, again.** A `\b` in a regex written through a text-processing step became a
   literal backspace — the same failure that hid the Wave 4a redactor. Caught here by scanning the
   changed files for the byte directly. Both instances are now removed; the pattern is worth
   remembering because it is invisible in source view and in `toString()`.
2. **One Wave 4 test asserted the inverted capability** (`anthropic` declares streaming). It was
   codifying the bug. Corrected to assert the real invariant — declaration matches implementation —
   which is stronger than either literal.
3. **Event contract unchanged at v4/39.** No fix required a new type.
4. **`core/recovery` untouched.** F1 was fixed in worker + authorizer, where command-bearing tools
   are gated.
5. **Nothing published.** Version `0.2.0` staged; publishing remains a separate, explicit action.

---

## Files changed

| File | Finding | Change |
|---|---|---|
| `src/auth/default/index.mjs` | F1 | gate hard denials on a command being present, not on the name `bash` |
| `src/agent/loop/worker.mjs` | F1 | declare `command` for any command-bearing tool |
| `src/cli/index.mjs` | F4, F5 | verified-work clause; `createProvider`; `ORION_PROVIDER`; `ORION_STREAM` |
| `src/agent/model/index.mjs` | F5 | openai-compat declares `streaming` (it implements it) |
| `src/agent/model/anthropic.mjs` | F5 | anthropic no longer declares `streaming` (it does not implement it) |
| `package.json` | F2 | `0.1.2` → `0.2.0` |
| `tests/shipped/` | F3 | **new** — 44 assertions over the shipped wiring |
| `tests/providers/providers.test.mjs` | F5 | corrected a test that codified the inverted capability |
| `tests/run-all.mjs` | F3 | register `shipped/shipped` |

---

## STOP — WAVE 4.5 COMPLETE. No Wave 5. Nothing published.
