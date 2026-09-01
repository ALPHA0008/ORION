# Frozen Corpus — CAPABILITY_V1_STAGE1

**Label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Not "SWE-bench Lite performance" — the official per-instance Docker images were not used.

| field | value |
|---|---|
| corpus version | `CAPABILITY_V1_STAGE1` |
| corpus sha256 | `0a9a279d48a491dacdadfd714c2c588bfb8a79adb4d536680241f1ebcf8300bb` |
| frozen at | 2026-09-01T08:44:51.840Z |
| runtime commit | `6e4d5325d788acbf2453af143b732e22c7e3ec25` |
| source | `princeton-nlp/SWE-bench_Lite` |
| tasks | **17** |
| bracket | preflight-negative AND oracle-positive, re-verified through the production verifier |
| verifier | pytest exit status; FAIL_TO_PASS must pass AND PASS_TO_PASS must not regress; no LLM judge |

## What the hash covers

The corpus hash is taken over each task's **semantic definition** only — id, repository, base
commit, problem statement, gold patch, test patch, both oracle lists, the verified test and the
interpreter. It deliberately excludes absolute venv and worktree paths, which are properties of this
machine rather than of the corpus. A corpus copied to another host must hash identically, or the
version would be meaningless.

Every task also carries its own `task_sha256`, so a single changed task is identifiable rather than
just invalidating the whole set.

## Freeze gate

`freeze-corpus.mjs` **refuses to run** unless every task appears in `reports/repro-sweep.json` with
`reproducible: true`. That is not decorative — the first freeze attempt was correctly rejected
because the sweep record covered only one task. A corpus cannot be frozen on the strength of a
bracket taken during admission; it has to re-prove itself through the same verifier the baseline
will use.

## Tasks

| # | task | repo | py | base commit | verified test |
|---|---|---|---|---|---|
| 1 | `pallets__flask-4045` | pallets/flask | 3.9 | `d8c37f4372` | `tests/test_blueprints.py::test_dotted_name_not_allowed` |
| 2 | `pallets__flask-5063` | pallets/flask | 3.9 | `182ce3dd15` | `tests/test_cli.py::TestRoutes::test_subdomain` |
| 3 | `psf__requests-3362` | psf/requests | 3.9 | `36453b95b1` | `tests/test_requests.py::TestRequests::test_response_decode_unicode` |
| 4 | `pylint-dev__pylint-5859` | pylint-dev/pylint | 3.9 | `182cc539b8` | `tests/checkers/unittest_misc.py::TestFixme::test_non_alphanumeric_codetag` |
| 5 | `pylint-dev__pylint-6506` | pylint-dev/pylint | 3.9 | `0a4204fd75` | `tests/config/test_config.py::test_unknown_option_name` |
| 6 | `pylint-dev__pylint-7228` | pylint-dev/pylint | 3.9 | `d597f25291` | `tests/config/test_config.py::test_regex_error` |
| 7 | `pylint-dev__pylint-7993` | pylint-dev/pylint | 3.9 | `e90702074e` | `tests/reporters/unittest_reporting.py::test_template_option_with_header` |
| 8 | `pytest-dev__pytest-11143` | pytest-dev/pytest | 3.9 | `6995257cf4` | `testing/test_assertrewrite.py::TestIssue11140::test_constant_not_picked_as_module_docstring` |
| 9 | `pytest-dev__pytest-11148` | pytest-dev/pytest | 3.9 | `2f7415cfbc` | `testing/test_pathlib.py::TestImportPath::test_remembers_previous_imports` |
| 10 | `pytest-dev__pytest-6116` | pytest-dev/pytest | 3.9 | `e670ff76cb` | `testing/test_collection.py::TestCustomConftests::test_pytest_fs_collect_hooks_are_seen` |
| 11 | `pytest-dev__pytest-7220` | pytest-dev/pytest | 3.9 | `56bf819c2f` | `testing/test_nodes.py::test_failure_with_changed_cwd` |
| 12 | `pytest-dev__pytest-7373` | pytest-dev/pytest | 3.9 | `7b77fc086a` | `testing/test_mark.py::TestFunctional::test_reevaluate_dynamic_expr` |
| 13 | `pytest-dev__pytest-7432` | pytest-dev/pytest | 3.9 | `e6e300e729` | `testing/test_skipping.py::TestXFail::test_xfail_run_with_skip_mark[test_input1-expected1]` |
| 14 | `pytest-dev__pytest-7490` | pytest-dev/pytest | 3.9 | `7f7a36478a` | `testing/test_skipping.py::TestXFail::test_dynamic_xfail_set_during_runtest_failed` |
| 15 | `pytest-dev__pytest-8365` | pytest-dev/pytest | 3.9 | `4964b468c8` | `testing/test_tmpdir.py::test_tmp_path_factory_handles_invalid_dir_characters` |
| 16 | `pytest-dev__pytest-8906` | pytest-dev/pytest | 3.8 | `69356d20cf` | `testing/test_skipping.py::test_module_level_skip_error` |
| 17 | `pytest-dev__pytest-9359` | pytest-dev/pytest | 3.9 | `e2ee3144ed` | `testing/code/test_source.py::test_decorator` |

## Immutability

No baseline run may mutate any field above. The runner resets each worktree to `base_commit` before
and after every task and restores the oracle from git before judging, so a run cannot leave state
that changes what the next run measures.

If a task ever needs to change, the corpus version and hash change with it, and any result quoted
against the old hash stays attached to the old corpus.
