# Wave 4 — Provider abstraction + streaming + provenance: IMPLEMENTATION PLAN

**PLAN ONLY. No product code written. `v0/src` unmodified in the session that produced this.**

Written 2026-09-05, after Wave 3 (`0baf4b4`). Preceding waves: Wave 1 `00b68a6`, Wave 2 `9de5324`.
State at time of writing: **797 passing / 0 failed / 28 suites**, event contract **v3 / 36 types**,
CI **4/4 green** plus package validation.

---

## 1. Goal

`MASTER-HARNESS-DEVELOPMENT-PLAN.md` §5 states Wave 4 verbatim:

> ### WAVE 4 — Provider abstraction + streaming + provenance
>
> Generalise the single client to a provider interface; record the normalized request digest so
> model-vs-provider-vs-harness attribution becomes possible; add streaming (persist to trajectory,
> independent of terminal rendering); populate `ttft_ms`.
> Effort **L/M/M** · risk **MEDIUM**. Split: abstraction, then streaming.

### Restated scope for this wave

Three deliverables, in dependency order:

1. **Provider abstraction** — one pluggable seam, two working implementations, quirks still in shims.
2. **Provenance** — record enough about each model call to attribute a failure to *model vs provider
   vs harness vs tool*, which §9 says capability claims depend on.
3. **Streaming** — as **durable partial execution**, not a cosmetic HTTP stream. Partial yields land
   in the trajectory; replay reconstructs them with zero model calls.

The plan's own split guidance is followed: **abstraction first, then streaming.** They are separable
and should land as separate commits.

---

## 2. Current state (verified against source, not assumed)

| | evidence |
|---|---|
| One client only | `agent/model/index.mjs` — `createOpenAICompatModel`, header says "ONE provider, per Phase H — not a multi-provider layer" |
| The interface already exists as a *comment* | `interface Model { name, capabilities, invoke(ctx) }` |
| Endpoint hard-coded | `baseUrl + '/chat/completions'` |
| One shim | `shims/gemma-tool-calls.mjs`; slot is `shims = []`, wired by the CLI's `selectShims` (Wave 1) |
| Shim firing is recorded | worker appends `degraded` on `resp.ext.shimmed` |
| Provenance today | `ext: { model, finish_reason, system_fingerprint, attempts }`, plus tokens/cost/duration |
| **Not** recorded | baseUrl, temperature, maxTokens, the request itself, provider identity |
| `model.requested` records | `{ model: name, messages: <count> }` — a count, not a digest |
| `ttft_ms` | **declared** in `modelRespondedPayload` and in the ModelResult contract, **set by nothing** |
| Streaming | absent — `await res.json()` on the whole body; no SSE, no `stream: true` |

Two facts shape the design:

- **The `Model` interface is already the seam.** The worker calls `this.model.invoke({messages, tools})`
  and knows nothing vendor-specific. Wave 4 is therefore mostly *making the existing seam real* —
  adding a second implementation and a factory — not inventing an abstraction.
- **`ttft_ms` cannot be populated without streaming.** Time-to-first-token is only observable if you
  read the response incrementally. That is why §5 lists them together, and why the ordering is
  abstraction → streaming → `ttft_ms`.

---

## 3. Design — provider abstraction

### 3.1 The seam

Keep `invoke(ctx) → ModelResult` exactly as it is. Wave 4 adds:

```
createProvider({ kind, ... })        // factory: 'openai-compat' | 'anthropic'
  ├─ createOpenAICompatModel(...)    // existing, unchanged behaviour
  └─ createAnthropicModel(...)       // new: /v1/messages wire format
          ↓
   normalise() → ModelResult          // ONE shape reaches the worker
          ↓
   shims applied to the NORMALISED result, in order
          ↓
   worker (knows nothing vendor-specific)
```

**Rules carried forward, non-negotiable:**

- **Quirks stay in named shims.** The core must not grow provider special-cases. This rule already
  paid for itself twice: the Gemma tool-call shim (Wave 1) and its array-argument gap (Wave 2) were
  both fixed at the provider layer without touching the loop.
- **Normalisation is where providers converge**, and shims apply *after* it — so a shim written
  against `ModelResult` works regardless of which provider produced it.
- **Never a silent fallback.** Any degradation — a retry, a shim rewrite, a capability the provider
  does not support — appends `degraded`. This is existing behaviour and must survive the refactor.

### 3.2 Why Anthropic as the second provider

Not for coverage. For **falsification**: the abstraction is unproven until something with a genuinely
different wire format passes through it. Anthropic's `/v1/messages` differs in the ways that matter —
system prompt is a top-level field rather than a message, tool results are content blocks rather than
a `tool` role, and stop reasons are named differently. If the seam survives that, it is real. A second
OpenAI-compatible endpoint would prove nothing.

Prior art (§6 of the master plan): **OpenHarness** already does Anthropic↔OpenAI normalization and
streaming fragment accumulation. Take the normalization shape; take *recording* the normalization,
which OpenHarness does not do and which is the differentiator here.

### 3.3 Capability negotiation

`capabilities: Set<string>` exists and is unused in anger. Wave 4 gives it one job: a provider that
cannot stream must say so, and the worker must fall back to a non-streaming call **and record a
`degraded` event** — never silently. Same for tools.

### 3.4 Event contract

**No new types needed for the abstraction.** Provider identity is payload on the existing
`model.requested` / `model.responded`. Payloads are extensible by design (ADR-004); the *type set* is
what is frozen. Contract version stays **v3** for this half.

---

## 4. Design — provenance

### 4.1 The problem it solves

§9 of the master plan: capability numbers stay provisional until failure can be attributed across
**model · provider transformation · runtime · tool**. Today a run records *which model name* was used
and nothing about what was actually sent. Two runs that behaved differently cannot be told apart.

This is not hypothetical. The project's most reproducible finding — 21 infrastructure defects, ~16
first presenting as agent failures — is exactly the failure to attribute. Wave 2 reproduced it again
(`qwen3:14b` ignoring `plan`, which is a *model* fact, not a runtime one).

### 4.2 What to record

On **`model.requested`**, add:

| field | why |
|---|---|
| `provider` | `'openai-compat'` / `'anthropic'` — the transformation layer |
| `endpoint_host` | host only. **Never** the full URL, never credentials |
| `request_digest` | sha256 of the normalised request (messages + tools + params) |
| `params` | `{ temperature, max_tokens }` — currently invisible and outcome-affecting |
| `messages`, `tools` | counts (messages already recorded; tools is new) |
| `context_bytes` | outbound size — ties this to Wave 3's compaction trigger |

On **`model.responded`**, add `provider`, `ttft_ms` (Wave 4b), and keep the existing `ext`.

### 4.3 A digest, not the request

Storing the full request would duplicate the entire context into the log on every turn — the exact
unbounded-blob problem Wave 3 exists to avoid. The digest answers the question that matters ("was
this the same request?") at 64 bytes.

**Consistency with Waves 2 and 3:** provenance is a *link plus a hash*, exactly like an artifact
(`source_seq` + `sha256`) and exactly like a plan (events, folded). Same shape, three times.

### 4.4 Reuse Wave 3, do not reinvent

`core/projection/artifacts.mjs` already exports `sha256`. Digesting belongs there or beside it — **not**
in `core/recovery`, which stays a recovery-classification module (the standing `isKnownDangerous` vs
`classifyShell` boundary note).

---

## 5. Design — streaming as durable partial execution

### 5.1 The framing that matters

Streaming here is **not** "render tokens as they arrive". Terminal rendering is a consumer of the
stream, never its purpose. The requirement is: **a partially-completed model call leaves durable,
attributable evidence**, so that

- a crash mid-stream is recoverable rather than a total loss of the turn;
- `ttft_ms` becomes observable, which is the §5 deliverable;
- replay reconstructs what was streamed **with zero model calls**, like everything else.

If streaming were only cosmetic it would be the first feature in this runtime that produces no
trajectory — which is precisely the "disconnected feature" failure the north star warns against.

### 5.2 Event types — contract v4

Three new types, so the contract goes **v3 → v4, 36 → 39**:

```
stream.started    { model, provider, request_digest }
stream.delta      { seq_in_stream, kind: 'text'|'tool_call', bytes, artifact_id? }
stream.finished   { chunks, bytes, ttft_ms, duration_ms, aborted? }
```

Versioned explicitly per §7. Members are only ever added; a v1/v2/v3 log replays unchanged.

### 5.3 Where partial content is stored — the connection to Wave 3

This is the design decision the brief asks for, and Wave 3 already answers it.

| situation | storage |
|---|---|
| Small delta | inline in `stream.delta.bytes` — no artifact, no overhead |
| Accumulated stream ≥ `artifactMinBytes` | **becomes an artifact**; `stream.delta` carries `artifact_id`, not the blob |
| Final assembled result | unchanged — `model.responded`, as today |

**Deltas must not be recorded verbatim, one event per token.** That would multiply the log by the
token count and reintroduce unbounded inline blobs from the other direction. The rule:

> Record deltas at a **bounded cadence** (byte-threshold or time-threshold, not per token), and
> promote to an artifact once the accumulation crosses the Wave 3 threshold.

Wave 3's measurement is directly relevant: a real run's whole outbound context was 6,354 B. Streamed
*output* is typically smaller still, so in practice most streams will stay inline — the artifact path
is for the large-output case, exactly as it is for `bash`/`verify`.

### 5.4 Replay

`replay` must reconstruct a streamed turn from `stream.*` + `model.responded` with **zero model
calls**, identical to a non-streamed turn. This is the acceptance bar, not a nice-to-have.

### 5.5 Interaction with the D1 lease heartbeat

Already handled and must be preserved: `#withLeaseHeartbeat` wraps the model call, and a stream is a
longer model call. The heartbeat keeps the lease alive while streaming; a killed process stops
heartbeating and the run becomes reclaimable. **Nothing in Wave 4 may weaken that fencing** — the
Wave 3 session already demonstrated how easily a lease change breaks the fencing suite.

---

## 6. Boundaries — what Wave 4 will NOT do

| Not in scope | Why |
|---|---|
| Skills, MCP | Wave 6, and MCP is gated behind Wave 5 resource identity |
| Memory | Wave 8 |
| Subagents | Wave 7 |
| A broad provider catalog | The plan's own rule: fix the seam before adding integrations. **Two** providers, not ten |
| Model benchmarking / leaderboards | `runtime ≠ evaluation` (§9). Belongs in `eval/`, never in `v0/src` |
| Terminal streaming UX | The trajectory is the deliverable; rendering is a consumer |
| Growing `core/recovery` | Standing boundary note. Digest helpers go with the artifact/hash code |
| Changing recovery classes or the authorize seam | Untouched by this wave |
| Republishing | Version stays `0.1.2` unless separately approved |

---

## 7. Dependencies

**Wave 4 builds on:**

- **Wave 1** — `degraded` on shim/retry; the D1 heartbeat that lets a long (streaming) call hold its
  lease; `selectShims` as the existing provider-config precedent.
- **Wave 2** — the plan fold, and the `emits()` seam showing how a component contributes events
  without the worker hardcoding it.
- **Wave 3** — artifacts (where large stream accumulations go), `sha256`, and the
  `context_bytes`/budget notion the request provenance reuses.

**Later waves build on Wave 4:**

- **Wave 5** (resource identity) — a provider session is a resource; the abstraction is where that
  attaches.
- **Wave 6** (MCP) — normalisation and capability negotiation generalise to MCP tool sources.
- **Wave 9** (trajectory UX) — `stream.*` events are what a live timeline renders.

**Eval-adjacent consequence, explicitly NOT a Wave 4 deliverable:** `future-queue.md` Q2 records that
`qwen3:14b` ignored `plan` while `gemma4-31b` planned five steps and chose `verify` unprompted. That is
a **model-behaviour** question. Wave 4's provider seam plus request provenance is what makes per-model
**plan adherence, verify adherence and replanning behaviour** measurable — but the measuring belongs in
`eval/`, and Wave 4 ships the *capability to measure*, not the measurements. **Do not let adherence
numbers become a Wave 4 acceptance criterion.**

---

## 8. Gate and manual protocol

The standing gate, `MASTER-HARNESS-DEVELOPMENT-PLAN.md` §8:

> **No major feature is considered proven until a real installed-build terminal test exercises it
> with a real model.**

Earned twice already — Wave 1's wiring gaps (654 assertions green) and Wave 2's Gemma array-parsing
defect (700+ green), both invisible to the suite. Wave 3 added a third: a real run showed compaction
never firing, which no unit test would have surfaced.

### 8.1 Preconditions

- CI **4/4 green** before Wave 4 code (it is, as of run `33958602579`).
- Full suite green locally with Git Bash first on PATH.

### 8.2 Acceptance tests — demanding, not "it streams"

**Provider abstraction**

| # | Assertion |
|---|---|
| P1 | The same task runs to completion through **both** providers, driving real tools |
| P2 | Both produce a **structurally identical `ModelResult`** — same fields, same types |
| P3 | A tool call round-trips through Anthropic's content-block format and back |
| P4 | A provider that cannot stream falls back **and appends `degraded`** — never silently |
| P5 | The Gemma shim still fires on the OpenAI-compat path, unchanged |
| P6 | An unknown provider kind fails loudly at construction, not at first call |

**Provenance**

| # | Assertion |
|---|---|
| V1 | `model.requested` carries provider, endpoint **host only**, digest, params, counts |
| V2 | **No credential and no full URL** appears anywhere in the log — asserted by scanning it |
| V3 | Identical requests produce **identical digests**; one changed message changes it |
| V4 | The digest is reproducible under **replay and fork** (same events → same digest) |

**Streaming**

| # | Assertion |
|---|---|
| S1 | A streamed turn appends `stream.started` / `stream.delta`+ / `stream.finished` |
| S2 | `ttft_ms` is **populated and > 0** — the §5 deliverable, currently always null |
| S3 | Deltas are recorded at a **bounded cadence**, not one event per token (assert event count ≪ token count) |
| S4 | A large accumulation becomes an **artifact**; `stream.delta` carries `artifact_id`, not the blob |
| S5 | **Replay of a streamed run makes ZERO model calls** and reconstructs the same final state |
| S6 | A stream **killed mid-flight** leaves a durable partial record; resume does not duplicate effects |
| S7 | The lease **survives** a long stream (D1 still holds); a killed process still becomes reclaimable |
| S8 | A streamed run and a non-streamed run of the same scripted responses reach the **same final projection** |

S5, S6 and S8 are the ones that matter. S8 in particular: if streaming produced a different projection
than non-streaming, streaming would be a second execution model — the thing Wave 2 refused for the REPL.

### 8.3 Manual terminal protocol

Real installed build, real models — `gemma4-31b` (vLLM) and `qwen3:14b` (Ollama) are both available
and were used in Waves 1–3.

1. Install the packed tarball into a clean directory; `--version`, `--help`, `doctor`.
2. **Provider A** — a real fix-the-bug task; verify the **file on disk** and the **test result**,
   never the run's self-report.
3. **Provider B** — the same task through the second provider; confirm swappability by configuration
   alone.
4. **Streaming** — a task with a long response; confirm `stream.*` events land, `ttft_ms` is set,
   `orionctl explain` shows the stream, and `orionctl replay --json` reports `model_calls_made: 0`.
5. **Failure injection** — `SIGKILL` mid-stream; confirm a durable partial record and a clean resume.
6. **Provenance** — read the log back from a separate process; confirm digest, provider, host-only
   endpoint, and **no credentials**.
7. Document every command and its observed output in `wave4-report.md`.

---

## 9. Risk and effort

§5 rates Wave 4 **Effort L/M/M · risk MEDIUM**. Refined:

| Risk | Severity | Mitigation |
|---|---|---|
| Streaming becomes a second execution model | **HIGH** | S8: streamed and non-streamed runs must reach the same projection |
| Log bloat from per-token deltas | **HIGH** | Bounded cadence + artifact promotion (S3, S4) |
| Replay divergence on streamed runs | **HIGH** | S5 is a blocking gate |
| Credential leakage into provenance | **HIGH** | Host only, never the URL; V2 scans the log |
| Contract churn (v3 → v4) | MEDIUM | Additive only; version bumped explicitly; old logs replay |
| Weakening D1 fencing | MEDIUM | S7; the Wave 3 session showed how easily this breaks |
| Provider abstraction over-fitted to two providers | MEDIUM | Anthropic chosen precisely because it is structurally different |
| Scope creep into a provider catalog | MEDIUM | Boundaries §6; two providers, full stop |

**Effort:** abstraction **M** (the seam exists; this makes it real) · streaming **L** (genuinely new:
SSE parsing, partial accumulation, crash semantics) · provenance **S** (payload additions and a
digest) · tests **L** · manual **M**.

**Splittable, and should be split:**
- **4a** — provider abstraction + provenance (no contract change).
- **4b** — streaming (contract v4).

4a is independently valuable and lower risk. If 4b slips, 4a still ships.

---

## 10. STOP rule

- Wave 4 implementation stops when 4a and 4b are complete, the suite is green, CI is 4/4, and the
  manual protocol is documented in `wave4-report.md`.
- **No Wave 5.** Resource identity is a separate wave and gates MCP.
- **No republish** without separate approval. Version stays `0.1.2`.
- **No provider catalog.** Two providers.
- If the abstraction cannot carry Anthropic without leaking vendor specifics into the core, **stop and
  report** rather than special-casing the loop. That leak is the signal the design is wrong.

---

## STOP — PLAN COMPLETE. No Wave 4 code written. Nothing republished.
