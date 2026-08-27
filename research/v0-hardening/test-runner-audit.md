# Test-Runner Trust Audit

## Initial defect

`v0/tests/run-all.mjs` extracted a summary with:

```js
const m = out.match(/:\s+(\d+) passed,\s+(\d+) failed/);
const pass = m ? Number(m[1]) : 0;
const fail = m ? Number(m[2]) : -1;
```

When a required suite crashed before printing its summary, `m` was null. The runner then recorded
`0 passed, -1 failed`. Later, this line erased the failure:

```js
totalFail += Math.max(0, fail);
```

So a crashed suite contributed zero failures. A suite that timed out or exited abnormally could be
reported the same way if no summary was present. This violates the project's trust requirement:
the aggregate must be red unless every required suite completed and emitted a valid summary.

## Required behavior

The runner must fail a suite when any of these is true:

- the child exits with a non-zero status;
- the child is signaled;
- the child times out or cannot be spawned;
- no parseable summary is present;
- the summary reports one or more failed assertions.

The fix and a synthetic regression suite are recorded after the implementation phase below.

## Fixed behavior and evidence

`v0/tests/run-all.mjs` now centralizes validation in `assessSuiteResult()`. A required suite is
green only when it exits normally, emits a parseable `N passed, M failed` summary, and reports zero
failed assertions. A missing summary, timeout/spawn error, signal, or non-zero exit contributes at
least one aggregate failure; it can no longer be clamped away.

`tests/runner/runner.test.mjs` passes **7/7** cases covering healthy output, assertion failure,
missing summary, abnormal exit, timeout, signal termination, and a real crashing child process.

The full aggregate was intentionally rerun against the current Windows environment. It reported:

```text
FAIL security/security  0 passed, 0 failed
      suite exited with status 1
TOTAL: 263 passed, 1 failed across 9 suites
```

That red result is correct: the existing security suite invokes the Windows `bash.exe` launcher
with a POSIX loop, which exits before its own summary. The runner now exposes the crash instead of
reporting a false green. The fencing and runner regression suites both complete normally.
