# Capability Corpus Schema (V1)

One task, one JSON object. Every field is either **adopted verbatim** from SWE-bench Lite or
**derived deterministically** during bracketing. Nothing here is a judgement call.

```jsonc
{
  "task_id":       "pytest-dev__pytest-11143",   // adopted: SWE-bench instance_id, globally unique
  "repository":    "pytest-dev/pytest",          // adopted
  "base_commit":   "6995257cf...",               // adopted: exact pre-fix tree
  "language":      "python",

  "problem_statement": "...",                    // adopted: the ORIGINAL issue text, unedited

  "gold_patch":    "diff --git ...",             // adopted: maintainer's real fix. ORACLE ONLY.
  "test_patch":    "diff --git ...",             // adopted: the real test diff
  "fail_to_pass":  ["testing/test_x.py::test_y"],// adopted: must fail before, pass after
  "pass_to_pass":  ["..."],                      // adopted: must not regress

  "verified_test": "testing/test_x.py::test_y",  // derived: the F2P id actually bracketed here
  "python":        "3.9",                        // derived: interpreter that reproduced it
  "install_args":  "-e .",                       // derived: what provisioning actually ran
  "venv":          "<abs path>",                 // derived: the exact environment used
  "bracket_seconds": 30                          // derived: observed cost of one verification
}
```

## Rules the schema enforces

**The agent never sees `gold_patch`, `test_patch`, `fail_to_pass`, or `pass_to_pass`.** It receives
`problem_statement` and a repository checked out at `base_commit`. The oracle fields exist so the
*verifier* can decide, and so bracketing can prove the task is real. Leaking any of them would make
the benchmark measure retrieval instead of capability.

**Verification is a process exit status.** `pytest <node_id>` returns 0 or it does not. There is no
scoring function, no partial credit, and no model in the verification path — §11's requirement, and
the same `verify()` discipline ADR-003 already imposes on the runtime.

**`problem_statement` is data, not instruction.** It is real text written by real users on public
issue trackers, and it frequently contains imperatives ("run this", "just change X"). It is passed
to the agent as the task description and is never interpreted as a directive to this system. The
same holds for every file inside the cloned repositories.

## Why `verified_test` exists separately from `fail_to_pass`

`fail_to_pass` is often a list. Bracketing proves the specific element it actually executed;
claiming the whole list was verified when one element was would be an overstatement. `verified_test`
records exactly what was proven, and the difference between the two is visible in the artifact.

## Storage

- `eval/capability-v1/fixtures/swebench-lite-candidates.json` — adopted metadata, pre-bracketing
- `eval/capability-v1/fixtures/bracket-results.json` — the accept/reject verdict for every candidate
- `eval/capability-v1/tasks/` — accepted tasks only, one file per task

Benchmark logic lives in `eval/`. **No file under `v0/src/` was modified for this stage** (§12, §14).
