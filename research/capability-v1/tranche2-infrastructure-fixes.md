# Infrastructure Fix Ledger

Every infrastructure correction made across Stage 1 / Tranche 2, with the **apparent** problem
separated from the **actual** cause. The distinction is the point: in almost every row the apparent
problem was a task defect and the actual cause was ours.

Layers: `TASK` · `ENVIRONMENT` · `RUNNER` · `VERIFIER` · `PROVISIONING` · `INSTRUMENT`

## Stage 1 — corpus admission (Lite tranche)

| commit | task(s) | apparent problem | actual cause | fix | layer |
|---|---|---|---|---|---|
| `6e4d532` | 30 of 32 | tasks unusable | Python 3.14 removed `imp`/`cgi`/`ast.Str`; era code needs 3.9/3.8 | provision era interpreter via `uv` | PROVISIONING |
| `6e4d532` | flask, pylint | `ImportError: url_quote` | today's Werkzeug against 2021 flask | `--exclude-newer <created_at>` | PROVISIONING |
| `6e4d532` | flask, pylint, pytest | *"gold patch does not fix the bug"* | `atomicwrites` yank-hole → uv **silently** resolved pytest **3.5.1** for a 2021 project | lift the date pin for that one package | PROVISIONING |
| `6e4d532` | pytest | `No module named '_pytest._version'` | our build-requires regex stopped at the `]` inside `setuptools-scm[toml]`; pytest built as `0.0.0` | anchor the pattern to the list terminator | PROVISIONING |
| `6e4d532` | 9 pytest candidates | `unrecognized arguments` | **our** `--no-header` flag postdates pytest 6.0 | drop the flag | RUNNER |
| `6e4d532` | all | 63 files modified on a *fresh* clone | `core.autocrlf` set **after** checkout | configure before checkout | PROVISIONING |
| `6e4d532` | cross-task | `addini` assertion | shared venv leaked plugins between tasks | one venv per task | ENVIRONMENT |
| `6e4d532` | requests | `No module named 'wheel.wheelfile'` | fallback build tools installed without `--upgrade` | force upgrade | PROVISIONING |

## Stage 1C — measurement instrument

| commit | scope | apparent problem | actual cause | fix | layer |
|---|---|---|---|---|---|
| `ef30e0b` | all runs | agent "edited test files" | `diff_stat` captured **after** `verifyTask()`, so it reported the restored oracle | capture before verification; reset tree after | INSTRUMENT |
| `ef30e0b` | passing runs | passes labelled `tool argument construction` | classifier diagnosed **successes** | diagnose failures only | INSTRUMENT |
| `9fce68b` | **entire baseline** | agent incapable — 2/17 | **no interpreter on `PATH`**; the agent could not execute the code it was asked to fix | venv on `PATH` + `python3` alias | ENVIRONMENT |
| `eed0e9a` | 3 runs | "changed nothing" | agent wrote via `bash`; `git diff` cannot see created files | include untracked additions | INSTRUMENT |
| `6e46de4` | 10/17 runs | "ZERO mutations" | mutation paths live on `tool.started`, not `tool.succeeded` | join on `tool_call_id`; read both channels | INSTRUMENT |
| `6e46de4` | `pylint-7993` | classified `editing` | new scratch files scored as source edits | structural `(new file)` test | INSTRUMENT |

## Tranche 2 — Django adoption (the five)

**Every one presented as `BASELINE_NOT_REPRODUCIBLE`.** None was a task defect.

| # | commit | apparent problem | actual cause | fix | layer |
|---|---|---|---|---|---|
| 1 | `e6d4a41` | *"maintainer's fix does not work"* | pytest handed a **Django** id → `file or directory not found` | per-repository test strategy | RUNNER |
| 2 | `e6d4a41` | `DEPENDENCY_UNRESOLVABLE` | date pin breaks Django's own version metadata (`asgiref` yank-hole) | exempt Django from the pin | PROVISIONING |
| 3 | `e6d4a41` | gold patch fails | F2P test cannot run standalone (`AttributeError: _fqdn`) | run at **class** granularity | RUNNER |
| 4 | `6644764` | `ModuleNotFoundError: No module named 'test_x (mail'` | ids are **parenthesised**, not dotted | accept both id shapes | RUNNER |
| 5 | `6644764` | oracle never passes | verdict `OK`/`FAILED` on **stderr**; retained tail was all banner | take verdict from **exit code**; keep stderr first | VERIFIER |

**Outcome after all five:** `django__django-11532` (5 files), `-11138`, `-13121`, `-16263` all
bracket cleanly — preflight FAIL, oracle PASS.

## Genuine non-harness rejections

| task | category | cause |
|---|---|---|
| `pylint-dev__pylint-4551` | `DEPENDENCY_UNRESOLVABLE` | `pylint==2.9.0.dev1` needs an astroid newer than the era index offers |
| `django__django-15629` | `TASK_NOT_OBSERVABLE` | `FAIL_TO_PASS` contains **prose docstrings**, not test ids — see below |

## The pattern

**19 infrastructure defects. Task defects found: 2.**

Reading the ledger by apparent-vs-actual layer:

- Apparent `TASK` defects: **14**
- Actual `TASK` defects: **2**

Twelve times, the instrument was wrong and said the task was. The single most expensive was
"no interpreter on `PATH`", which invalidated an entire baseline and would have produced a
confident, well-evidenced, wrong capability finding (*"premature termination, generalises across all
four repositories"*).

The operational rule this justifies: **a rejection is a hypothesis, not a result** — and for a new
repository family, hand-bracket one task before trusting any automated verdict.
