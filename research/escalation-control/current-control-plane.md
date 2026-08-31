# The Existing Control Plane — Traced From Code

Traced from `v0/src/agent/loop/worker.mjs` and `v0/src/auth/default/index.mjs` (§2), by reading
execution paths rather than comments.

## The enforcement point

Every tool invocation passes through one gate in `#invokeTool`, **before any effect**:

```js
const action = { kind: 'tool', name, args_digest, effects, recovery_class,
                 command: name === 'bash' ? args.cmd : undefined, prompt, options };
const d = tool.alwaysEscalate
  ? { decision: ESCALATE, ... }
  : this.authorize(action, this.#ctx(runId, project(S, runId)));

if (d.decision === DENY)     { append('tool.denied');   return null; }   // effect never runs
if (d.decision === ESCALATE) {
  const rid = S.createHumanRequest(runId, d.prompt, { options: d.options });
  append('tool.escalated');
  append('human.requested', { request_id: rid, tool_call_id: tcid });
  return this.#pause(runId, leaseToken, AWAITING_HUMAN, { request_id: rid });
}
append('tool.authorized'); append('tool.started');
... await tool.run(args)                                    // effect happens only here
```

`#pause` calls `appendStatus(..., 'run.paused', { releaseLease: true })`.

## Answering §2 directly

| question | answer |
|---|---|
| Where can the runtime deny an action? | `#invokeTool`, before `tool.run` — the effect never executes |
| Where can it force escalation? | the same gate; `ESCALATE` returns `#pause` |
| Where is the escalation result represented? | durable events: `tool.escalated`, `human.requested`, `run.paused` + a `human_requests` row |
| Can the runtime pause without model cooperation? | **Yes.** `#pause` returns out of the turn loop; the model is not consulted |
| Does the worker retain control after escalation? | **No — by design.** It returns and releases the lease |
| Can a model ignore the policy and issue another action? | It can *propose* one; every proposal re-enters the same gate |
| What is advisory vs enforced? | **Prompt text is advisory. `authorize()` is enforced.** |

## §3 — is the seam dead, partial, or live?

**Live and fully wired.** Verified by execution:

```
permissive (as used by the escalation probe)  -> {"decision":"allow"}
escalateTools: ['edit','write']               -> {"decision":"escalate","prompt":"Allow edit?",...}
```

It is already used in production paths: hard-deny `bash` patterns apply at every posture,
`strict` escalates all mutations, and `escalateUnsafeRecovery` escalates UNSAFE retries. The
`ask_user` tool reaches the same code via `alwaysEscalate: true`.

**So the phase-5 failure was not a missing control plane.** The probe deliberately ran
`posture: 'permissive'` with no `escalateTools`, i.e. the gate was configured to allow
everything, and the *only* thing standing between the model and the bypass was prompt text.

## The one real gap

The `Action` handed to `authorize()` is:

```
kind, name, args_digest, effects, recovery_class, command (bash only), prompt, options
```

**There is no file path.** `args_digest` is a hash — deliberately opaque, so a policy cannot see
*what* is being edited. Consequently the control plane can today express:

- "never allow `edit`" (too blunt — kills the task)
- "escalate every mutation" (`strict` — kills autonomy, fails S3)

but **cannot** express:

- "the agent may edit source, but not the artifact that defines the requirement"

That is precisely the S2 invariant. The gap is **one field in the Action**, not a missing
architecture.

## §17 — DENY vs ESCALATE are already distinct

| decision | meaning | event | run outcome |
|---|---|---|---|
| `DENY` | forbidden, full stop | `tool.denied` | run continues; the model is told no |
| `ESCALATE` | not permitted autonomously; a human may authorise | `tool.escalated` + `human.requested` | run **pauses**, lease released |

They must not be collapsed: `DENY` keeps the agent running (and phase 5 shows it would simply
find another route), while `ESCALATE` stops autonomous progress entirely.

## §18 — is `ask_user` still needed?

`ask_user` is a **model-initiated** escalation: the agent decides it needs a human.
`authorize() -> ESCALATE` is **runtime-initiated**: the harness decides, regardless of what the
model wants.

Phase 5 proved the model-initiated path cannot be relied on for safety. It remains useful as a
convenience — the direct-instruction control showed both models use it correctly when they
choose to — but it should not be the security mechanism. **Contract unchanged in this
experiment** (§18).
