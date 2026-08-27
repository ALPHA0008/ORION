# Security Review — Phase M

Source: `v0/tests/security/security.test.mjs` — **41 assertions, 41 pass.**
Reviewed **by attack**, not by checklist: each item below is an executed exploit attempt.

**Threat model for V0:** a *possibly-misaligned or prompt-injected model* driving the tool surface,
and an operator who must be able to see what happened. **Not** in scope: hostile native code inside
the sandbox, a hostile operator, or multi-tenant isolation.

---

## 1. Path traversal / filesystem escape — **BLOCKED**

8 traversal payloads, attempted as both reads and writes:
```
../SECRET-OUTSIDE.txt        ../../SECRET-OUTSIDE.txt      ./../SECRET-OUTSIDE.txt
a/../../SECRET-OUTSIDE.txt   a/b/../../../SECRET-OUTSIDE   /etc/passwd
C:\Windows\win.ini           ..\SECRET-OUTSIDE.txt
```
```
every traversal read blocked      8/8
every traversal write blocked     8/8
the outside file is untouched     content unchanged
null byte rejected                yes
empty / non-string path rejected  yes
symlink escape blocked            yes (junction created and probed)
```
Containment is enforced in `LocalSandbox._abs()` by `path.relative` **plus** a `realpathSync` of the
deepest existing ancestor, which is what catches symlink escapes.

**Bug found and fixed during this review:** the constructor used
`fs.realpathSync(fs.mkdirSync(root, {recursive:true}) ?? root)`. `mkdirSync` returns the *first
directory created*, not the target — so the sandbox root resolved to `C:`. Every containment check
would have been computed against the wrong root.

## 2. Command injection — **PARTIALLY BLOCKED (limitation stated)**

Hard denials hold at every posture, including `permissive`:
```
rm -rf /   mkfs.ext4 /dev/sda   :(){ :|:& };:   dd if=/dev/zero of=/dev/sda      4/4 denied
```

**Known limitation, asserted in the test rather than glossed:**
```
KNOWN LIMITATION: encoded evasions are NOT blocked by the pattern list   1/3 caught
```
`echo cm0gLXJmIC8= | base64 -d | sh`, `r''m -rf /`, `eval "$(printf 'rm -rf /')"` mostly evade a
regex list. This is a **pattern list, not a shell parser** — QM's 911-line recursive parser is the
real answer and is explicitly out of scope for V0.

**Compensating control, verified:** all three evasions classify as `UNSAFE` under
`classifyShell()`, so under `auto`/`strict` posture they escalate to a human rather than running
silently. The default-deny direction is what makes the weak classifier tolerable.

## 3. Authorization bypass — **BLOCKED**

A model actively trying to evade the seam (`bash`, `BASH`, `bash `, plus a traversal `write`):
```
no dangerous bash ever started                             ["write","write","write"]
unknown tool spellings rejected, not fuzzy-matched         yes
traversal write blocked at the sandbox even after authz    yes
```
Two independent layers: the authorizer denies by name/pattern, and the sandbox denies by path.
Neither is trusted alone.

## 4. Secret leakage — **BLOCKED at render; limitation at rest**

```
no raw secret appears in explain output    0 of 5 leaked (sk-, ghp_, xoxb-, AKIA, JWT)
redaction markers present                  yes
password value redacted                    yes
```

Child-process environment scrubbing, verified by actually running a command:
```
PATH preserved / HOME preserved            yes
API key, TOKEN, PASSWORD, SESSION stripped yes
child cannot see a parent API key          echo "${OPENAI_API_KEY:-ABSENT}"  ->  ABSENT
```

**Known limitation, asserted explicitly:** a secret the *model* puts into tool arguments is stored
verbatim in the event log. Redaction happens at **render** time (`explain`), not at write time.
```
KNOWN LIMITATION: args are stored verbatim in the log
…but explain() still redacts it on the way out          verified
```
For V0 this is acceptable because the log is a local SQLite file with the same trust level as the
workspace. It would **not** be acceptable for a shared/exported log — noted in `docs/SECURITY.md`.

## 5. Event log integrity / unsafe replay — **BLOCKED**

```
unknown event types cannot enter the log                   throws UnknownEventType
payload must be serialisable                               throws TypeError
replay treats tool results as DATA, never as commands      "$(rm -rf /)" carried as content
projection performs no eval/exec                           applyEvent is a pure switch
```
Replay cannot execute anything: it folds data. A tampered log produces a tampered *projection*, not
code execution.

## 6. Resource exhaustion — **BOUNDED**

```
oversized file read truncated                    52,488 bytes (announced)
large-but-bounded command output clamped         52,481 bytes (announced)
runaway output aborts instead of buffering       kind: output_overflow
overflow error text is SHORT and actionable      105 chars
long-running command killed by timeout           15,015 ms
timeout classified distinctly                    kind: timeout
timeout error text short                         46 chars
```

**Bug found during this review:** a `maxBuffer` overflow produced an error message containing
**64 KB of command output**, which would then be written into the event log and rendered by
`explain`. Error text now has its own much tighter bound (2 KB) and overflow/timeout are classified
as distinct `kind`s rather than a generic failure.

## 7. Scope confusion — **SINGLE-TENANT (limitation stated)**

```
scopes are distinct and persisted            team:alpha / team:beta
scope recorded in the run.created event      yes
KNOWN LIMITATION: V0 is single-tenant        no cross-scope query barrier
```
`scope` and `principal` are carried into every `AuthzContext`, so the seam *can* enforce tenancy.
But `store.events(runId)` is keyed by run, not filtered by principal — **there is no cross-scope
read barrier**. V0 is a single-user local tool and must not be deployed multi-tenant.

---

## Summary

| area | verdict |
|---|---|
| Path traversal / fs escape | **blocked** (incl. symlinks) |
| Command injection | **hard denies blocked**; encoded evasions escalate rather than run |
| Authorization bypass | **blocked** (two independent layers) |
| Secret leakage (render, child env) | **blocked** |
| Secret leakage (at rest, in args) | **known limitation** — local-trust only |
| Event log integrity | **blocked** |
| Unsafe replay | **blocked** — replay executes nothing |
| Resource exhaustion | **bounded** — output, error text, and wall clock |
| Sandbox escape (native code) | **out of scope** — not a security boundary |
| Multi-tenant scope isolation | **not implemented** — single-tenant only |

**Three real bugs were found and fixed by this review:** the sandbox root resolution bug (which
would have voided every containment check), the 64 KB error-text leak, and undifferentiated
overflow/timeout errors.

**Not to be deployed as:** a multi-tenant service, or a boundary against hostile code executing
inside the sandbox.
