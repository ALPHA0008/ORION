# OSS Product Boundary — What Ships, What Stays Out

Documented, not implemented. No commercial boundary code is written in this wave.

## In the OSS harness

| Area | Module(s) | Status |
|---|---|---|
| **Execution** — the agent loop | `agent/loop/worker.mjs` | ships |
| **Providers** — OpenAI-compatible adapter + shims | `agent/model/` | ships |
| **Tools** — read, grep, write, edit, bash, ask_user | `agent/tools/` | ships |
| **Workspace** — local sandbox, output caps, env scrubbing | `sandbox/local/` | ships |
| **Durability** — append-only SQLite event log | `core/run/store.mjs`, `core/event/` | ships |
| **Event log** — frozen 31-type contract | `core/event/index.mjs` | ships |
| **Recovery** — classes, decisions, fencing, orphan repair | `core/recovery/`, `core/lease/` | ships |
| **Inspection** — status, list, explain | `core/run/explain.mjs`, `cli/` | ships |
| **Replay** — reconstruct without model calls | `core/replay/` | ships |
| **Fork** — branch history, rerun | `core/replay/` | ships |
| **Local safety/authorization** — postures, escalation | `auth/default/` | ships |
| **Projection** — bounded context window | `core/projection/` | ships |
| **CLI** | `cli/index.mjs` | ships |

**Principle:** the OSS harness owns everything needed to *run an agent and understand what it did* —
on one machine, for one developer.

## Outside the OSS harness — Kernlbase

| Area | Why it is not OSS |
|---|---|
| **Enterprise policy management** | OSS ships *mechanism* (`authorize(action, ctx) → allow/deny/escalate`). Policy *administration* — authoring, distribution, versioning across an org — is control-plane. |
| **Organization / fleet control** | The OSS runtime is single-workspace. Fleet scheduling and cross-machine orchestration are control-plane. |
| **Centralized audit** | OSS produces a local, complete, tamper-evident log. Aggregating logs across users/machines into a retained audit store is control-plane. |
| **Enterprise approvals** | OSS ships the escalation *primitive* (`ask_user` → `run.paused` → durable claim). Routing to approver groups, SLAs, delegation is control-plane. |
| **Compliance workflows** | Retention, legal hold, export, attestation. |
| **Multi-tenancy** | Runs carry a `scope` (observed: `personal:local`), but isolation, quotas and billing are control-plane. |

## The seam — already present, not invented

The boundary is not aspirational; the runtime already has the right shape:

1. **`authorize(action, context) → allow | deny | escalate`** — a pluggable authorizer. OSS ships a
   default posture-based one; Kernlbase supplies an organizational implementation. **No runtime
   change required.**
2. **`scope` on runs** — already recorded in `run.created`.
3. **The event log** — a complete, closed-set, append-only record. Any control plane is a
   *consumer* of it, not a modification to it.
4. **`human.requested` / `run.paused` / claimable runs (ADR-009)** — the escalation primitive an
   approval workflow builds on.

This matters for the Wave-1 verdict: **the commercial split does not require refactoring.** It
requires implementing a different `authorizer` and a consumer of the event stream.

## Anti-goals for the OSS project

- Do not add governance to the OSS runtime to make it look enterprise-ready.
- Do not add memory/planning/MCP/skills/subagents to compete on feature count.
- Do not let provider-specific behaviour leak into the durable log — the Qwen investigation is the
  standing evidence for why (see `provider-contract.md`).
