# Session prompt — WAVE 4 implementation (Provider abstraction + streaming + provenance)

Hand this to the executing agent (Claude). This is the master plan's WAVE 4, per the approved
wave4-plan.md. Split 4a then 4b as the plan requires. One disciplined session. HARD STOP at the end.
No WAVE 5, no republish.

---

```
Role: Executing agent for ORION (@kernlbase/orion runtime, repo v0/). Waves 1-3 are committed and
verified: Wave 1 = 00b68a6, Wave 2 = 9de5324, Wave 3 = 0baf4b4. Overall suite 797 passed / 0 failed /
28 suites, event contract v3 / 36 types, CI 4/4 green + package validation. This session implements
WAVE 4 — Provider abstraction + streaming + provenance — following the APPROVED plan at
research/productization/wave4-plan.md. Implement 4a then 4b as the plan requires, in separate commits.
HARD STOP at the end. No WAVE 5, no republish (version stays 0.1.2 unless separately approved).

Read FIRST, in this order (they are authoritative):
  research/productization/wave4-plan.md          (the approved implementation plan — follow it exactly)
  research/productization/MASTER-HARNESS-DEVELOPMENT-PLAN.md (§5 WAVE 4, §6 deps, §7, §8 manual protocol)
  research/productization/wave3-report.md
  research/productization/future-queue.md        (Qwen adherence is eval-adjacent, NOT a deliverable)

──────────────────────────────────────────────────────────────
SCOPE — exactly per wave4-plan.md

Deliver, in dependency order, as the plan sections define:

4a — Provider abstraction + provenance (NO event-contract change; stays v3):
  - provider factory createProvider({ kind, ... }): 'openai-compat' (existing behaviour unchanged)
    and 'anthropic' (/v1/messages wire format). Normalise both to ONE ModelResult shape; shims apply
    AFTER normalisation (a shim written against ModelResult works for any provider).
  - Quirks stay in named shims. NEVER a silent fallback: any degradation appends a 'degraded' event.
  - capability negotiation: a provider that cannot stream (or tool-call) must SAY so and the worker
    must fall back + record 'degraded', never silently.
  - Provenance on model.requested: provider, endpoint_host (host ONLY, never full URL, never
    credentials), request_digest (sha256 of normalised request), params {temperature, max_tokens},
    messages/tools counts, context_bytes. On model.responded: provider (+ ttft_ms in 4b).
  - Digest as a link + hash, reusing Wave 3's sha256 (core/projection/artifacts.mjs). Do NOT grow
    core/recovery; digest helpers live with the artifact/hash code.

4b — Streaming as DURABLE PARTIAL EXECUTION (contract v4):
  - New event types stream.started / stream.delta / stream.finished → EVENT_CONTRACT_VERSION = 4,
    type set 36 → 39, ADDITIVE ONLY, versioned explicitly; v1/v2/v3 logs replay unchanged.
  - Partial yields land in the trajectory. Deltas at a BOUNDED cadence (byte/time threshold, NEVER one
    event per token). Accumulation >= artifactMinBytes becomes an artifact; stream.delta carries
    artifact_id, not the blob.
  - stream.finished carries chunks, bytes, ttft_ms (>0 — the §5 deliverable), duration_ms, aborted?.
  - Populate ttft_ms (it is currently always null).
  - Replay must reconstruct a streamed turn from stream.* + model.responded with ZERO model calls,
    identical to a non-streamed turn.
  - PRESERVE the D1 lease heartbeat fencing: a long stream holds its lease; a killed process stops
    heartbeating and becomes reclaimable. Wave 4 must NOT weaken this (Wave 3 showed how easily the
    fencing suite breaks).

──────────────────────────────────────────────────────────────
BOUNDARIES — do NOT do (from plan §6):
  - NOT skills, MCP, memory, subagents, a broad provider catalog (TWO providers: openai-compat +
    anthropic, full stop), model benchmarking.
  - NOT terminal streaming UX (rendering is a consumer; the trajectory is the deliverable).
  - NOT growing core/recovery, NOT changing recovery classes or the authorize seam.
  - NOT republishing. Version stays 0.1.2.
  - eval/ stays out of v0/src product code.
  - Adherence numbers (Qwen) are NOT a Wave 4 acceptance criterion — Wave 4 ships the CAPABILITY to
    measure, not the measurements.

──────────────────────────────────────────────────────────────
ACCEPTANCE — demanding, per plan §8 (these are the gate):
  Provider abstraction:
    P1  same task completes through BOTH providers, driving real tools
    P2  both produce a structurally identical ModelResult (same fields, same types)
    P3  a tool call round-trips through Anthropic's content-block format and back
    P4  a provider that cannot stream falls back AND appends 'degraded', never silently
    P5  the Gemma shim still fires on the OpenAI-compat path, unchanged
    P6  an unknown provider kind fails loudly at construction, not at first call
  Provenance:
    V1  model.requested carries provider, endpoint host only, digest, params, counts, context_bytes
    V2  NO credential and NO full URL anywhere in the log — asserted by scanning it
    V3  identical requests → identical digests; one changed message changes it
    V4  digest reproducible under replay and fork (same events → same digest)
  Streaming (S5, S6, S8 are BLOCKING):
    S1  a streamed turn appends stream.started / stream.delta+ / stream.finished
    S2  ttft_ms populated and > 0 (currently always null)
    S3  deltas at a bounded cadence — assert event count << token count
    S4  a large accumulation becomes an artifact; stream.delta carries artifact_id, not the blob
    S5  replay of a streamed run makes ZERO model calls and reconstructs the same final state  [BLOCK]
    S6  a stream killed mid-flight leaves a durable partial; resume does not duplicate effects [BLOCK]
    S7  the lease survives a long stream (D1 holds); a killed process still becomes reclaimable
    S8  a streamed and a non-streamed run reach the SAME final projection  [BLOCK — if streaming
        produces a different projection it is a SECOND execution model, which is not allowed]

Add Wave-4 tests as new suite(s) registered in tests/run-all.mjs; keep the full suite green.

MANUAL TERMINAL PROTOCOL — the standing §8 rule, non-negotiable (cite it):
  Real installed package, real models (gemma4-31b / vLLM and qwen3:14b / Ollama as used in prior
  waves — a second, structurally different provider for the Anthropic path as available):
   1. install tarball in clean dir; --version/--help/doctor
   2. Provider A: real fix-the-bug task; verify the FILE on disk and the TEST result, never self-report
   3. Provider B: same task, swappable by configuration alone
   4. Streaming: long-response task; confirm stream.* events land, ttft_ms set, orionctl explain shows
      the stream, orionctl replay --json reports model_calls_made: 0
   5. Failure injection: SIGKILL mid-stream; confirm durable partial + clean resume
   6. Provenance: read the log from a separate process; confirm digest, provider, host-only endpoint,
      NO credentials
   7. Document every command + observed output in wave4-report.md

──────────────────────────────────────────────────────────────
TEST/QUALITY RULES
  - Full suite green: Git Bash first on PATH → node v0/tests/run-all.mjs → TOTAL: <n> passed,
    0 failed. Record before/after (Wave 3 ended at 797 / 28).
  - Respect the manual-testing gate: real terminal test with a real model for major features.
  - Boundaries: no changes to core/recovery unless Wave 4 genuinely needs them; provider quirks in
    shims; policy in the CLI contract.
  - If the abstraction cannot carry Anthropic without leaking vendor specifics into the core, STOP
    and report rather than special-casing the loop (plan §10 stop rule). That leak is the signal the
    design is wrong.

PRESERVATION / CONSTRAINTS
  - Product name ORION. No renames. Version stays 0.1.2. Do NOT republish on your own.
  - v0/src is product code; no benchmark/eval logic there.
  - Event-contract v4 is ADDITIVE ONLY; do not modify v1/v2/v3 members (replay must not break).
  - Commit 4a and 4b separately, in order, as clean units.
  - Keep the "Git for coding harnesses" north star: Wave 4's request_digest + provider attribution is
    exactly the data that makes future team-learning (per-member, attributable) physically reachable.
  - research/ stays untracked / out of package commits (never `git add -A`).

REPORT: 4a commit hash + 4b commit hash, before/after suite counts, which acceptance tests are
PASS/BLOCK/FAIL (S5, S6, S8 explicitly), manual terminal output, provenance leak-scan result (V2),
any deviation from the plan or stop-rule invocation, files changed. Then STOP. No WAVE 5.
```

---

## Planner notes (for the user — do NOT paste into the agent prompt)

- Verified before writing: Waves 1-3 committed (00b68a6/9de5324/0baf4b4), 797/28, contract v3/36;
  wave4-plan.md on disk and source claims (the seam, ttft_ms-never-set) confirmed against the tree.
- This prompt enforces the plan's split (4a/4b separate commits), the standing manual-testing gate,
  the blocking S5/S6/S8 tests, and the §10 stop-rule leak signal.
- After this runs: review its report against the tree (as with prior waves), confirm CI on push,
  freeze Wave 4, then Wave 5 (Resource identity + recovery 2.0 — which gates MCP).
