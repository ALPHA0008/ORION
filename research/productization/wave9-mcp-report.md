# Wave 9 — MCP + EXTERNAL RESOURCES

**Contract:** v6 / 49 event types — **unchanged**. W9 writes no new event types.
**Suite:** 1777 → **2017 passed, 0 failed, 46 suites**.
**Dependency:** first justified one — `@modelcontextprotocol/sdk@1.30.0`, **optional, exact-pinned,
lazily imported**. Required `dependencies` remain **{}**.

---

## THE PROBLEM

An MCP server is third-party code, with network access, invoked by a model. The naive integration —
spawn it, list its tools, hand them to the model — gives that code the developer's whole
environment, the host network, no identity, no lifecycle, no attribution, and no way to deny it.
The plan scheduled MCP four waves before any isolation existed and then **moved it behind W6**
precisely so that this wave would have a boundary to put servers inside.

So the question was never "can the harness speak MCP". It was: **what has to be true before a model
is allowed to invoke code nobody in this project has read?** The plan's answer is eight properties
— identity, provenance, ownership, lifecycle, resume, authorization, isolation, failure handling —
and one constraint that shapes the whole design:

> "MCP must not introduce a second state system. Session state lives as resource events, never in
> memory only." (§10.2 W9)

That constraint is why there is no session table and no registry in this wave. An MCP session **is**
a W6 resource, with the same four lifecycle events a container sandbox already used.

---

## CHANGES BY FILE

### `src/mcp/servers.mjs` — NEW: what a config file may say

Pure: parses and validates the `mcpServers` block, derives session identity. No I/O, so the
validation tests run without Docker and without the SDK.

`mcpResourceId` follows W6's discipline exactly — **derived, never random** — hashing the project
plus the declaration. Editing a server's command therefore yields a *different* id, which is the
correct behaviour: reattaching a session whose command changed would run the old binary while the
operator reads the new declaration.

`env` is a list of variable **NAMES**, never values. Other MCP clients accept `{"TOKEN": "value"}`,
so someone copying a working config will write exactly that — it gets a refusal that explains *why*
rather than a generic type error, because a config file is meant to be committed.

### `src/mcp/client.mjs` — NEW: the connection, and where the server runs

The SDK is loaded by **dynamic import inside a try/catch**, cached including the failure. Absent, it
returns a typed failure and MCP degrades; the package still installs with zero required deps.

`transportArgv` is the security core of the wave, and is pure so it can be asserted without a
daemon. On an isolated backend the server is spawned as
`docker exec -i --workdir /workspace <container> <command> …`, so it inherits the container's
`--network none`, cgroup limits and filesystem view. **The isolation is W6's, not a new one.** On
`LocalSandbox` the server is a plain child process and the code reports `isolated: false` rather
than implying a boundary that does not exist.

`serverEnv` was **rewritten after a live probe found a real defect** (below): it is now an
allowlist, not a denylist.

### `src/mcp/session.mjs` — NEW: sessions as W6 resources

Single-flight per server (`#inflight` stores the *promise*, so four concurrent tool calls share one
connection — the plan's `getOrCreateToolSource` pattern). Prior bindings are read from the **log**,
not a field, which is what makes resume correct in a fresh process.

A tool error (`isError`) is distinguished from a transport death: the first is `tool.failed` and the
session stays up; the second is `resource.lost` and the handle is dropped. Conflating them would
tear down a live session every time a tool returned an error.

### `src/mcp/tools.mjs` — NEW: advertisements become ordinary tools

An MCP tool is `{description, schema, effects, recovery, run}` — the same shape as `read`. That is
the entire integration: the worker already appends `tool.requested`/`authorized`/`started`/
`succeeded`, already routes through the authorizer, already applies the recovery contract.

Every MCP tool is declared **`Mutating`** and **`UNSAFE`**, and a server cannot lower either. The
harness cannot know what third-party code does — a tool called `get_issue` may post a comment — and
`effects` is the input to the approval gate (W5-T1). One malformed advertisement excludes that
*tool*, not the server.

### `src/core/projection/resource.mjs` — `ResourceKind.MCP`, and a **regression fix**

`bindingToReattach` became kind-scoped. See *Defects found*, item 3 — this is the sharpest defect of
the wave.

### `src/core/projection/compact.mjs` — the OpenHarness heuristic

`mcp__` results supersede by tool **name** rather than name+arguments, making them always
compaction-eligible. A file read is authoritative world state and two reads of different paths are
both still true; an MCP result is a snapshot of something the harness does not own. "Eligible" is
not "discarded" — the elided result is replaced by a marker and preserved as an artifact.

### `src/agent/loop/worker.mjs` — provenance

`tool.succeeded`/`failed` carry `ext.mcp` when the tool declares `mcp` metadata. ADR-004 makes event
**payloads** extensible, so this needs no contract change, and the worker attributes an MCP result
without knowing what MCP is.

### `src/cli/index.mjs` — the composition root

Servers are connected inside `prepareRun`, so MCP tools reach `run`, `resume` **and** each turn of
the interactive session, and the `resource.acquired` events land before the first
`model.requested`. Sessions are released before the workspace resource, mirroring acquisition in
reverse. Also adds `withLeaseHeartbeat` around connection (see *Defects found*, item 1).

### Typecheck

`tsc --noEmit` was **not clean at HEAD** (18 errors, pre-existing). It is now **0**. Most shared one
root cause — `scrubEnv` inferring `{}` — plus a `retryAfterMs` field assigned but never declared,
and one Anthropic content-block union. All are annotations; **no behaviour changed**, and the
provider/streaming suites confirm the pre-approved shims still pass.

---

## TEST EVIDENCE

```
OK    mcp/mcp                  123 passed, 0 failed  (0.1s)
OK    mcp/live                  66 passed, 0 failed  (51.3s)
OK    shipped/w9-shipped        51 passed, 0 failed  (2.3s)
OK    resource/resource         96 passed, 0 failed  (0.3s)
OK    shipped/w6-shipped        77 passed, 0 failed  (4.7s)
OK    recovery/recovery         53 passed, 0 failed  (1.6s)

════════════════════════════════════════════════════════════
TOTAL: 2017 passed, 0 failed across 46 suites
```

`tsc --noEmit` → 0 errors. `node tests/lint.mjs` → `no problems`. No existing test was edited to
pass.

### Defects found — all four by running the real thing

**1. The run lost its lease before turn one.** The first gate run exited 1 with `lease lost`.
Measurement showed connection takes ~1.8 s, well inside the 30 s lease — so the timeout hypothesis
was **wrong**, and the heartbeat added for it was not the fix. It is still correct (W5-X2 established
that unbounded work must renew the lease, and `prepareRun` runs before the worker's own heartbeat
exists), but it was not this bug.

**2. The real cause: a throw during release, and a native crash behind it.** W6's `releaseResource`
catches `LeaseLostError` — a lost lease after a terminal run is *expected*. `McpSessionManager`
did not, so `releaseAll` threw, cleanup was skipped, and the still-open stdio transport then tripped
a **libuv assertion** (`!(handle->flags & UV_HANDLE_CLOSING)`) that killed the process. Tolerating
the lost lease fixed both symptoms.

**3. MCP sessions displaced the workspace binding — a silent break of W6 recovery.** Until W9 a run
bound exactly one resource, so `bindingToReattach` returned "the most recent binding" and was right
by construction. MCP sessions are acquired *after* the workspace, so that helper began returning the
MCP session. `resolveResource` would then have compared the workspace's derived id against an MCP id,
found a mismatch, and **declared the workspace LOST on every resumed run that used a server** —
breaking a shipped W6 guarantee, from a wave that never touched W6's code. Measured directly:

```
run_d69ea0559f
  bindings   : workspace:bound, mcp:bound
  current    : mcp res_mcp_ebdb3d06da18778b
  reattachTo : mcp res_mcp_ebdb3d06da18778b        <- before
  reattachTo : workspace res_workspace_c001cafbe…  <- after
```

Fixed by scoping `bindingToReattach` to a kind (default `workspace`). A pre-W9 log folds identically
(Invariant 9), asserted in `mcp/mcp`.

**4. The environment was a denylist where it needed to be an allowlist.** `scrubEnv` strips names
*matching* a secret pattern and passes everything else — right for the user's own commands, wrong
for third-party code, because it only protects against credentials whose names were anticipated. The
live server reported `saw_unrelated_secret: true` for a variable it was never granted. Now the base
environment is an allowlist plus exactly the declared names:

```
before: {"passed_names":["ORION_TEST_TOKEN","ORION_TEST_UNRELATED"],"saw_unrelated_secret":true}
after : {"passed_names":["ORION_TEST_TOKEN"],                       "saw_unrelated_secret":false}
```

The inherited half is scrubbed; the **declared** half deliberately is not, because `SECRET_RE`
matches `TOKEN` and scrubbing it would make `env: ["GITHUB_TOKEN"]` silently pass nothing — leaving
the operator debugging an auth failure inside someone else's server.

---

## MANUAL GATE (§11.2)

`npm pack` → clean `npm install` into an empty prefix → **1 package, 0 vulnerabilities**; `src/mcp/*`
verified present inside the tarball; `dependencies: {}` and
`optionalDependencies: {"@modelcontextprotocol/sdk":"1.30.0"}` as shipped.

Target: the workspace declares the echo server in `.orion.json`; the run uses
`ORION_SANDBOX=container ORION_IMAGE=node:20-slim`.

### The run, through the installed binary

```console
$ orionctl run "use the demo MCP server to echo a greeting"
Run #29d19827c6  …\work
────────────────────────────────────────────────
  sandbox: ContainerSandbox  posture: permissive (isolated)
  skills: 1 available (458 B disclosed)  brand-alchemy
  mcp: demo connected (in container, --network none)  4 tools
  ✓ mcp__demo__echo echo: hello from the gate

✓ model_finished
--- EXIT: 0 ---
```

### What the model was actually offered (captured at the endpoint)

```
TOOLS_OFFERED ["skill","read","grep","glob","git","write","edit","bash","verify","plan",
               "plan_step","ask_user",
               "mcp__demo__echo","mcp__demo__whoami","mcp__demo__reach_out","mcp__demo__explode"]
```

Built-in and MCP tools in one array, indistinguishable at the schema level — the runtime
distinguishes by prefix (scope §8).

### The trajectory

```console
$ orionctl explain #29d19827c6
   1  · run created (scope personal:local)
   3  · resource.acquired          <- workspace (container)
   5  · resource.acquired          <- MCP session
   6  ▸ task: use the demo MCP server to echo a greeting
   9  🧠 wants 1 tool call: mcp__demo__echo 10→5tok
  12  · mcp__demo__echo {"msg":"hello from the gate"}
  13  ✓ mcp__demo__echo → echo: hello from the gate
  17  🧠 "The MCP server answered. Task complete."
  18  ✓ completed — model_finished
```

### Provenance and isolation, read from the durable log

```
seq 5  resource.acquired
   {"resource_id":"res_mcp_ebdb3d06da18778b","server":"demo","isolated":true,
    "capabilities":{"isolated":true,"network":"none"},
    "command":"node","args":["echo-server.mjs"],"env_passed":[],
    "tools":["echo","whoami","reach_out","explode"]}
seq 10 tool.requested   mcp__demo__echo  args={"msg":"hello from the gate"}
seq 11 tool.authorized  mcp__demo__echo
seq 13 tool.succeeded   mcp__demo__echo
   result : "echo: hello from the gate"
   ext    : {"mcp":{"server":"demo","tool":"echo",
              "session_id":"res_mcp_ebdb3d06da18778b","isolated":true}}
```

### Authorization (acceptance 6)

With `.orion-rules.json` = `{"denyTools":["mcp__demo__echo"]}`:

```
  rules: project (1 denied, 0 escalated, 0 command patterns, 0 protected paths)
  ⛔ mcp__demo__echo tool 'mcp__demo__echo' denied by policy
```

### Isolation (acceptance 7), measured not asserted

From `mcp/live`, the server calling `fetch('http://example.com')` **from inside the container**:

```
PASS  outbound network from the server is BLOCKED  — BLOCKED example.com: fetch failed
PASS  a tool call round-trips through docker exec
PASS  ...and the session reports itself isolated
```

### Graceful degradation without the SDK

`npm install --omit=optional` → **1 package**, no SDK. A run with servers declared:

```
⚠ DEGRADED [mcp] MCP server `demo` is unavailable (sdk_missing): …
```

…and the run continues on built-in tools.

### Live-model gate — a REAL model choosing an MCP tool (added post-report: 2026-09-11, Hive `zai-org/glm-5.3-flash`)

The honest negative below is now retired. With a working provider key (thehive.ai Hive, OpenAI-compatible
streaming endpoint `https://api.thehive.ai/api/v3`, model `zai-org/glm-5.3-flash`), the same gate ran
with a **real hosted model** making its own tool choice — no stub:

```
$ orionctl run "use the demo MCP server to echo a greeting"
Run #952f3060c2  …\work-e2
────────────────────────────────────────────────
  sandbox: ContainerSandbox  posture: permissive (isolated)
  mcp: demo connected (in container, --network none)  4 tools
  ✓ plan  plan recorded — Echo a greeting via the demo MCP server
  ✓ mcp__demo__echo  echo: Hello from the coding agent! 👋 Greetings via the demo MCP server.
  ✓ plan_step step 1 -> done
✓ model_finished
```

The model autonomously planned, chose `mcp__demo__echo` from its own reasoning (turn 2), took the
tool result, marked the plan step done, and concluded. Durable log (`run_952f3060c2`,
`status: completed`, `exit_reason: model_finished`, 53 events, 4 model calls, 3 tool calls):

```
seq 3  resource.acquired  workspace (ContainerSandbox) — isolation: container, network: none
                           posture: permissive (operator override), limits cpus 1.0/mem 512m/pids 256
seq 6  resource.acquired  MCP session res_mcp_209c9bee0d84bab4 — server demo, command node
                           echo-server.mjs, env_passed [], isolated: true, capabilities network: none
                           tools [echo, whoami, reach_out, explode]
seq 12 model.responded    streamed tool call → mcp__demo__echo {"msg":"Hello from the coding agent!…"}
seq 25 tool.authorized    mcp__demo__echo
seq 27 tool.succeeded     echo: Hello from the coding agent! 👋
seq 37 plan.step_finished s1.1 done
seq 52 model.responded    "Done — the demo MCP server echoed the greeting…" (8 streamed text chunks)
seq 53 completed — model_finished
```

The MCP session is genuinely the in-container one (bind-mounted workspace at `/workspace`, server
spawned by docker exec inside `node:20-slim`, `--network none`), and the `resource.acquired` event is
identical in shape to the W9 stub gate — **what changed is that a real model made the choice.** The
run also exercised the streamed tool-call round-trip against GLM's wire (tool-call turns stream zero
text chunks; the final turn streams 8), with no shim firing and no `degraded` event.

🚫 **Negated 2026-09-11 — see the live-model gate above.** The original text is kept for the record:

> **No provider credentials exist in this environment** (`GROQ_API_KEY`, `ORION_API_KEY`,
> `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` all unset). The gate above
> drove the **real** CLI, worker, authorizer, sandbox, MCP path and event log through a local
> OpenAI-compatible stub that requests `mcp__demo__echo` on turn 1 and concludes on turn 2.
>
> Everything downstream of the HTTP response is the shipped product. What is **not** shown is a real
> model *choosing* to call an MCP tool from its own reasoning. That half of §11.2 is unproven here and
> is not claimed.

Since then a **real hosted model** (Hive `zai-org/glm-5.3-flash`) autonomously chose `mcp__demo__echo`
from its own reasoning in `#952f3060c2` — that half of §11.2 is now proven. The stub itself remains a
useful offline path; it is no longer the only evidence.

(One embarrassment worth recording: the first stub kept its turn counter in a module variable, so a
second run got the "finished" reply on its first turn and never called a tool. That looked exactly
like the product ignoring MCP. The stub is now stateless, deriving the turn from the conversation.)

---

## 0x08 SCAN — EXPLICIT COUNTS

| Check | Count | Status |
|---|---:|---|
| `process.exit` in W9 library paths (`src/mcp/*`) | **0** | clean |
| stdout writes (`console.log`/`process.stdout`) from `src/mcp/*` | **0** | clean |
| **Required** dependencies | **0** | `"dependencies": {}` |
| New optional dependency | **1** | `@modelcontextprotocol/sdk@1.30.0` — exact pin, no range |
| Static (non-lazy) imports of the SDK | **0** | dynamic `import()` inside try/catch only |
| Non-`node:`/non-relative static imports in `src/mcp/*` | **0** | clean |
| Stray control bytes `0x00–0x08` in W9 source **and** tests | **0** | clean |
| Plaintext secrets in W9 source or tests | **0** | see note |
| **New event types** | **0** | contract stays **v6 / 49**, vocabulary diff empty |

**Secrets note:** the only key-shaped strings are self-describing fixtures
(`sk-inline-secret`, `ghp-must-not-appear`, `sk-secret`), each asserted **absent** from output. The
log records `env_passed` — variable **names** only; `mcp/live` asserts no value reaches the log.

**Why no new event types:** MCP lifecycle is expressed entirely in W6's existing
`resource.acquired` / `reattached` / `released` / `lost` with `kind: 'mcp'`, attribution in the
existing `tool.*` events, and absence in `degraded`. ADR-004 makes payloads extensible, so `ext.mcp`
and the MCP-specific resource fields are additive by design. Inventing `mcp.*` types would have been
the "second state system" the plan forbids.

---

## §11.4 — WHAT IS NOT PROVEN

1. ~~**No hosted model.** As above: real CLI, real MCP, stubbed endpoint.~~ → **RESOLVED (2026-09-11):**
   a real hosted model (Hive `zai-org/glm-5.3-flash`) autonomously chose `mcp__demo__echo` in
   `#952f3060c2` — planned, called the MCP tool from its own reasoning, took the result, and
   completed `model_finished` inside the container sandbox. A model choosing an MCP tool is now proven.
2. **`resource.released` is not recorded on a normally-completed run.** `appendStatus` clears the
   lease at terminal status (Invariant 4: a worker that lost its lease cannot write), so any release
   after `run.completed` cannot append. This is **pre-existing and shared with W6** — the workspace's
   own `resource.released` is missing from the same runs — and fixing it means changing terminal/lease
   semantics, which this wave will not do unilaterally. **There is no leak:** the sessions are really
   closed (verified — zero server processes inside every container afterwards), and release *is*
   recorded whenever the lease still holds (asserted in `mcp/live`). It is a logging gap, not a
   resource one. **Recommend W13 address it for both kinds.**
3. **Containers are left running after a run.** Also pre-existing and visible in this wave's gate
   (`orion-work-* Up`). `orionctl reap` exists for this; not investigated here.
4. **"Survives SIGKILL and reattaches" is honoured in a narrower sense than it sounds.** A stdio
   pipe cannot outlive its owning process. What survives is the *container* (W6) and the *derived
   identity*, so a resumed run reconnects into the same container — recorded as `resource.lost`
   (`action: recreated`) + `resource.reattached`, never as a reattach that did not happen. Tested by
   simulating the kill in-process, **not** by SIGKILLing a real CLI mid-run.
5. **Only one MCP transport.** stdio only. HTTP/SSE servers are not supported and not stubbed.
6. **The gate's server is first-party.** `@modelcontextprotocol/server-everything` was not used —
   under `--network none` a server that fetches itself (`npx -y …`) cannot start, which is the
   isolation working as designed. A genuinely third-party server was therefore never exercised.
7. **`mcp__` compaction is asserted at the projection level**, not observed shrinking a real
   over-budget window.
8. **No concurrency test across processes.** Single-flight is proven within one manager; two
   concurrent runs against the same project-scoped session id are untested.
9. **Timeout classification is partly untested.** `MCP_TIMEOUT_MS` is asserted as a declared budget;
   a genuinely hung server was not exercised.

---

## VERDICT

**Ship.** All ten scope items are implemented and reached through the composition root; acceptance
1–8 are demonstrated through the installed binary, with the isolation claim measured rather than
asserted.

The wave's method earned its keep four times. Two defects were mine and would have shipped
(a denylist environment that leaked a variable to third-party code; a throw during release that
crashed the process). One was a **silent break of another wave's guarantee** — MCP resources
displacing the workspace binding W6's recovery depends on — which no test in `tests/mcp` would ever
have caught, because it lives in W6's fold. And one was my own instrumentation lying to me.

The most important thing this wave did *not* do is invent state. MCP sessions are W6 resources,
MCP tools are ordinary tools, MCP failures are `degraded` events, and the contract is untouched at
v6/49. Where the plan's language outruns what a stdio pipe can actually do (§11.4 item 4), the log
says what really happened rather than what the acceptance criterion hoped for.

**Not started, per the stated boundary: no W10, no W11.**
