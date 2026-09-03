# Security

## Threat model

**In scope:** a possibly-misaligned or prompt-injected model driving the tool surface; an operator
who must be able to see what happened afterwards.

**Out of scope for V0:** hostile native code inside the sandbox, a hostile operator, multi-tenant
isolation.

## The authorization seam

One function, consulted before every model call and every tool call:

```
authorize(action, context) -> allow | deny | escalate
```
```
Action  = { kind: 'model'|'tool'|'memory', name, args_digest, effects, recovery_class, command }
Context = { principal, scope, run_id, posture, budget_remaining, environment }
```

Three outcomes, not two — `escalate` is what makes human-in-the-loop a *policy result* rather than
a special case wired into the tool layer.

**The default implementation ships in-tree and requires no external service.** No vendor-specific
fields appear in `Action` or `Context`. Any provider — a rules file, an OPA sidecar, a commercial
governance product — implements the same three-valued function. The runtime must remain fully
useful with the built-in default; anything else makes it a disguised client for one vendor.

## Postures

`permissive` · `auto` (default) · `strict`, composed as a **floor**: a narrower scope may only
raise strictness, never lower it. Hard denials (`rm -rf /`, `mkfs`, fork bombs) apply at **every**
posture, including `permissive`.

## What is enforced

| control | mechanism | verified by |
|---|---|---|
| Workspace containment | `path.relative` + `realpath` of the deepest existing ancestor | 8 traversal payloads, reads and writes, plus a symlink junction |
| Hard command denials | pattern list, posture-independent | 4/4 blocked at `permissive` |
| Authorization bypass | two independent layers: authorizer by name, sandbox by path | model tried 4 evasions, 0 succeeded |
| Secrets in child processes | env scrubbed by key pattern before `exec` | `${OPENAI_API_KEY:-ABSENT}` → `ABSENT` |
| Secrets in output | redaction at render time in `explain` | 0 of 5 token formats leaked |
| Log integrity | closed event types; payload must be serialisable | `UnknownEventType` thrown |
| Unsafe replay | the reducer is a pure switch — no `eval`, no `exec` | `"$(rm -rf /)"` carried as data |
| Resource exhaustion | output clamp 64 KB, error text clamp 2 KB, exec timeout | overflow and timeout classified distinctly |

Full results: `research/v0-hardening/security-review.md` (41 assertions).

## Known limitations — stated, not hidden

1. **The command classifier is a pattern list, not a shell parser.**
   `echo <base64> | base64 -d | sh` evades it. **Compensating control:** such commands classify as
   `UNSAFE`, so under `auto`/`strict` they escalate to a human rather than running silently. A real
   parser (QM ships a 911-line recursive one) is the eventual answer.
2. **Tool arguments are stored verbatim in the event log.** Redaction happens at render time. If the
   model puts a secret into an argument, it is on disk in plaintext. Acceptable while the log is a
   local SQLite file at the same trust level as the workspace; **not** acceptable for a shared or
   exported log.
3. **The sandbox is a workspace scope, not a security boundary.** It contains paths. It does not
   contain a process that decides to do something else. `bash` runs real commands with your
   privileges.
4. **V0 is single-tenant.** `scope` and `principal` are carried into every authorization decision,
   but there is no cross-scope query barrier. Do not deploy multi-tenant.
5. **No network egress control.** A tool that can run `curl` can reach anything you can.

## Bugs this review found

Recorded because "the review found nothing" usually means the review was a checklist:

- **Sandbox root resolved to `C:`.** `fs.mkdirSync(root, {recursive:true})` returns the *first
  directory created*, not the target — so `realpathSync` of its return value was wrong, and every
  containment check would have been computed against the wrong root.
- **A `maxBuffer` overflow produced a 64 KB error message**, which would then be written into the
  event log and rendered by `explain`. Error text now has its own 2 KB bound.
- **Overflow and timeout were indistinguishable** to a caller. Both now carry a `kind`.

## Reporting

Security issues: open a private advisory rather than a public issue.
