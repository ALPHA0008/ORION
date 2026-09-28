# B1 — Windows / Shell Platform Report

## Environment

| item | value |
|---|---|
| OS | Windows 11 build 26100 |
| shell env | `MINGW64_NT-10.0-26100` (Git Bash) |
| Node | v24.18.0 |
| npm | 11.16.0 |

## The reported failure

> "The security suite can abort when the runtime attempts to invoke `/bin/bash`."

Per the brief, this was **reproduced and classified before assuming a Wave-2 regression**.

## What was actually measured

### 1. The runtime does NOT hardcode `/bin/bash`

`v0/src/sandbox/local/index.mjs:19`

```js
this.shell = shell ?? (process.platform === 'win32' ? 'bash' : 'sh');
```

On Windows it resolves the **name** `bash` through `PATH` — it never references `/bin/bash`. The
shell is also injectable via the constructor's `shell` option. The premise of the report is
therefore not literally true of the code.

### 2. The security suite does not abort in this environment

```
$ node v0/tests/security/security.test.mjs
security: 41 passed, 0 failed  (41 assertions)

$ node v0/tests/run-all.mjs
TOTAL: 608 passed, 0 failed across 23 suites
```

The suite is already platform-aware — `security.test.mjs:155` branches on
`process.platform === 'win32'`.

### 3. Shells available here

| candidate | result |
|---|---|
| `bash` | `/usr/bin/bash` |
| `sh` | `/usr/bin/sh` |
| `/bin/bash` | present |
| `/bin/sh` | present |

### 4. A minimal exec through the runtime succeeds

```js
new LocalSandbox(cwd).exec('echo hello-from-sandbox')  // "hello-from-sandbox\n"
resolved shell: bash
```

### 5. The REAL defect, reproduced

Forcing an unavailable shell:

```js
new LocalSandbox(cwd, { shell: 'definitely-not-a-shell' }).exec('echo x')
```

produced, **before the fix**:

```
kind:    nonzero_exit
message: command failed (exit ?):
```

A spawn failure (`ENOENT`) has no exit status and no stderr, so it fell through to the generic
handler and surfaced as an **empty, mis-classified error**. A Windows user without Git Bash would
see `command failed (exit ?):` and have no indication that the shell was missing.

## Root cause: ENVIRONMENT, with a code-level diagnostic defect

| question | answer |
|---|---|
| Is it a Wave-2 regression? | **No.** Nothing in Wave 2 touched shell resolution. |
| Is it a hardcoded `/bin/bash`? | **No.** `bash` is resolved via `PATH`. |
| Is it an environment problem? | **Yes** — a Windows host without Git Bash (or any `bash` on `PATH`) cannot run shell tools. |
| Is there a code defect? | **Yes, but only in diagnostics** — the missing-shell case was misreported as `nonzero_exit` with an empty message. |

## Support contract decision: **B — Windows supported, with a documented shell prerequisite**

Evidence for this over the alternatives:

- **Not (A) "Windows fully supported, no prerequisite":** shell tools genuinely require a POSIX
  shell. `bash` is not present on a stock Windows install.
- **Not (C) "defer Windows":** the entire runtime — 608 tests including the security suite, plus
  live agent runs — was developed and verified **on Windows**. Deferring support would contradict
  the evidence.
- **(B) is what is true:** Windows works when a `bash` is on `PATH`. Git for Windows supplies one,
  and that is a normal developer prerequisite. The runtime already needs `git` for workspace
  checkpoints, so Git Bash is a prerequisite the project effectively had already.

## Fix applied — smallest possible

One branch in `LocalSandbox.exec`, before the generic error handler:

```js
if (err.code === 'ENOENT' || err.code === 'EACCES') {
  const hint = process.platform === 'win32'
    ? ' — install Git for Windows (Git Bash) or set the `shell` option to an available shell'
    : ' — set the `shell` option to an available shell';
  const e = new Error(`shell not found: ${this.shell} (${err.code})${hint}`);
  e.exitCode = null; e.kind = 'shell_missing'; throw e;
}
```

**What was NOT done**, per the brief: no shell-detection framework, no process abstraction, no
redesign of sandbox execution, no weakening of any security control. `scrubEnv`, path containment,
output bounds and timeout handling are untouched.

Verified after the change:

| case | result |
|---|---|
| missing shell | `kind: shell_missing`, message names the shell, the errno, and the remedy |
| normal exec | `"ok\n"` — unchanged |
| genuinely failing command (`exit 3`) | `kind: nonzero_exit`, `exitCode: 3` — unchanged |

## Supported platforms (claimable)

| platform | status | prerequisite |
|---|---|---|
| **Windows 10/11** | **supported — verified** | a `bash` on `PATH` (Git for Windows). 608 tests pass here. |
| **Linux** | **expected to work, NOT verified in this phase** | `sh` (default) |
| **macOS** | **expected to work, NOT verified in this phase** | `sh` (default) |

Per rule 19, Linux and macOS are **not claimed as verified**. B2's CI matrix is what would convert
"expected" into "verified", and until it runs, the README must not assert them.

## Full regression after the change

```
TOTAL: 608 passed, 0 failed across 23 suites
```

Baseline preserved exactly (608 / 0 / 23).

## B1 gate: **PASSED** — proceed to B2.
