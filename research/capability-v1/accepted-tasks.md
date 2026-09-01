# Accepted Tasks — 17 Bracketed

Every task below passed the full bracket **on this machine**: the FAIL_TO_PASS test was observed to
**fail** on the clean tree, and to **pass** after applying the maintainer's real fix. Neither
direction is assumed from the dataset; both were executed.

Source: `princeton-nlp/SWE-bench_Lite` · built `2026-09-01T08:38:22.416Z`

## pytest-dev/pytest — 10

| task | py | verified test | issue |
|---|---|---|---|
| `pytest-dev__pytest-11143` | 3.9 | `testing/test_assertrewrite.py::TestIssue11140::test_constant_not_picked_as_module_docstring` | Rewrite fails when first expression of file is a number and mistaken a… |
| `pytest-dev__pytest-11148` | 3.9 | `testing/test_pathlib.py::TestImportPath::test_remembers_previous_imports` | Module imported twice under import-mode=importlib In pmxbot/pmxbot@7f1… |
| `pytest-dev__pytest-6116` | 3.9 | `testing/test_collection.py::TestCustomConftests::test_pytest_fs_collect_hooks_are_seen` | pytest --collect-only needs a one char shortcut command I find myself … |
| `pytest-dev__pytest-7220` | 3.9 | `testing/test_nodes.py::test_failure_with_changed_cwd` | Wrong path to test file when directory changed in fixture Files are sh… |
| `pytest-dev__pytest-7373` | 3.9 | `testing/test_mark.py::TestFunctional::test_reevaluate_dynamic_expr` | Incorrect caching of skipif/xfail string condition evaluation Version:… |
| `pytest-dev__pytest-7432` | 3.9 | `testing/test_skipping.py::TestXFail::test_xfail_run_with_skip_mark[test_input1-expected1]` | skipping: --runxfail breaks pytest.mark.skip location reporting pytest… |
| `pytest-dev__pytest-7490` | 3.9 | `testing/test_skipping.py::TestXFail::test_dynamic_xfail_set_during_runtest_failed` | Pytest 6: Dynamically adding xfail marker in test no longer ignores fa… |
| `pytest-dev__pytest-8365` | 3.9 | `testing/test_tmpdir.py::test_tmp_path_factory_handles_invalid_dir_characters` | tmpdir creation fails when the username contains illegal characters fo… |
| `pytest-dev__pytest-8906` | 3.8 | `testing/test_skipping.py::test_module_level_skip_error` | Improve handling of skip for module level This is potentially about up… |
| `pytest-dev__pytest-9359` | 3.9 | `testing/code/test_source.py::test_decorator` | Error message prints extra code line when using assert in python3.9 <!… |

## pylint-dev/pylint — 4

| task | py | verified test | issue |
|---|---|---|---|
| `pylint-dev__pylint-5859` | 3.9 | `tests/checkers/unittest_misc.py::TestFixme::test_non_alphanumeric_codetag` | "--notes" option ignores note tags that are entirely punctuation ### B… |
| `pylint-dev__pylint-6506` | 3.9 | `tests/config/test_config.py::test_unknown_option_name` | Traceback printed for unrecognized option ### Bug description A traceb… |
| `pylint-dev__pylint-7228` | 3.9 | `tests/config/test_config.py::test_regex_error` | rxg include '\p{Han}' will throw error ### Bug description config rxg … |
| `pylint-dev__pylint-7993` | 3.9 | `tests/reporters/unittest_reporting.py::test_template_option_with_header` | Using custom braces in message template does not work ### Bug descript… |

## pallets/flask — 2

| task | py | verified test | issue |
|---|---|---|---|
| `pallets__flask-4045` | 3.9 | `tests/test_blueprints.py::test_dotted_name_not_allowed` | Raise error when blueprint name contains a dot This is required since … |
| `pallets__flask-5063` | 3.9 | `tests/test_cli.py::TestRoutes::test_subdomain` | Flask routes to return domain/sub-domains information Currently when c… |

## psf/requests — 1

| task | py | verified test | issue |
|---|---|---|---|
| `psf__requests-3362` | 3.9 | `tests/test_requests.py::TestRequests::test_response_decode_unicode` | Uncertain about content/text vs iter_content(decode_unicode=True/False… |

## Provenance

Each task records the exact environment that proved it — interpreter version, virtualenv path, the
install arguments used, and the `--exclude-newer` date that fixed its dependency universe. The
bracket is only a claim about a specific environment, so that environment is part of the artifact:
`eval/capability-v1/tasks/<task_id>.json`.
