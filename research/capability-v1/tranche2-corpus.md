# Tranche 2 — CAPABILITY_V1_TRANCHE2

**Corpus label: Tranche-2 multi-file SWE-bench-Verified slice, locally reproduced.**
Not "SWE-bench performance" — the official per-instance Docker images were not used;
environments are reconstructed locally on a Windows host.

| field | value |
|---|---|
| corpus version | `CAPABILITY_V1_TRANCHE2` |
| corpus sha256 | `bd3e3eab7399cee13a40fa3d6890745a72cf9e73cce074c83639087150207958` |
| frozen at | 2026-09-02T08:01:21.377Z |
| runtime commit | `70894e0319` |
| source | `princeton-nlp/SWE-bench_Verified` |
| tasks | **18** |
| multi-file | **18 / 18** |
| reproducible | **18 / 18** through the production verifier |
| bracket | preflight-negative AND oracle-positive, re-verified through the production verifier |

## Why Tranche 2 exists

Stage 1 returned `CORPUS_NEEDS_MORE_TASKS`. The binding limitation was not size — it was that
**every gold patch in the Stage-1 corpus touched exactly one file**, which is a property of
SWE-bench *Lite* itself: **0 of 300** Lite instances have a multi-file gold patch. No
Lite-derived tranche could have closed that gap, so Tranche 2 is drawn from **SWE-bench
Verified** (500 human-validated instances), where 58 of 400 fetched rows are multi-file.

## Independence from Stage 1

`CAPABILITY_V1_STAGE1` (sha256 `0a9a279d48a491da…`, 17 tasks) is **unmodified**
and verified byte-identical to its committed state. Tranche 2 has its own corpus identity,
its own task directory, its own tmp suite root, and will have its own run artifacts. No task
id is shared between the two.

## Tasks

| # | task | repo | files | base commit | verified test |
|---|---|---|---|---|---|
| 1 | `django__django-10554` | django | **2** | `14d026cccb` | `test_union_with_values_list_and_order (queries.test_qs…` |
| 2 | `django__django-11138` | django | **4** | `c84b91b760` | `test_query_convert_timezones (timezones.tests.NewDatab…` |
| 3 | `django__django-11333` | django | **2** | `55b68de643` | `test_resolver_cache_default__root_urlconf (urlpatterns…` |
| 4 | `django__django-11400` | django | **3** | `1f8382d34d` | `test_get_choices_default_ordering (model_fields.tests.…` |
| 5 | `django__django-11532` | django | **5** | `a5308514fb` | `test_non_ascii_dns_non_unicode_email (mail.tests.MailT…` |
| 6 | `django__django-11734` | django | **3** | `999891bd80` | `test_subquery_exclude_outerref (queries.tests.ExcludeT…` |
| 7 | `django__django-11885` | django | **2** | `04ac9b45a3` | `test_fast_delete_combined_relationships (delete.tests.…` |
| 8 | `django__django-12325` | django | **2** | `29c126bb34` | `test_clash_parent_link (invalid_models_tests.test_rela…` |
| 9 | `django__django-13121` | django | **4** | `ec5aa2161d` | `test_duration_expressions (expressions.tests.FTimeDelt…` |
| 10 | `django__django-13195` | django | **3** | `156a2138db` | `test_delete_cookie_samesite (responses.test_cookie.Del…` |
| 11 | `django__django-13344` | django | **3** | `e39e727ded` | `test_coroutine (deprecation.test_middleware_mixin.Midd…` |
| 12 | `django__django-16263` | django | **4** | `321ecb40f4` | `test_non_aggregate_annotation_pruned (aggregation.test…` |
| 13 | `pylint-dev__pylint-4604` | pylint | **2** | `1e55ae6462` | `tests/checkers/unittest_variables.py::TestVariablesChe…` |
| 14 | `pylint-dev__pylint-6386` | pylint | **4** | `754b487f4d` | `tests/config/test_config.py::test_short_verbose` |
| 15 | `pylint-dev__pylint-8898` | pylint | **3** | `1f8c4d9eb1` | `tests/config/test_config.py::test_csv_regex_error` |
| 16 | `pytest-dev__pytest-5840` | pytest | **2** | `73c5b7f4b1` | `testing/test_conftest.py::test_setinitial_conftest_sub…` |
| 17 | `pytest-dev__pytest-8399` | pytest | **2** | `6e7dc8bac8` | `testing/test_unittest.py::test_fixtures_setup_setUpCla…` |
| 18 | `sphinx-doc__sphinx-10673` | sphinx | **3** | `f35d2a6cc7` | `tests/test_environment_toctree.py::test_toctree_index` |

## Verification

- pytest exit status; FAIL_TO_PASS must pass AND PASS_TO_PASS must not regress; no LLM judge
- Django tasks are verified through `tests/runtests.py` at **class** granularity, verdict from
  the exit code — see `repository-test-contract.md`.
- PASS_TO_PASS ids that are prose docstrings rather than test ids are excluded **and counted**
  per task, so coverage is never overstated.