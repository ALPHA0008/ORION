# Trajectory Analysis — Stage 1

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**

§12 requires the *first causal divergence*, not the final error. What follows is read from
the durable event log, one turn at a time.

## `pytest-dev__pytest-6116` — `long-horizon execution` (exit `no_progress`)

```
T 1 grep  {"pattern":"collect-only"}
T 2 grep  {"pattern":"--collect-only"}
T 3 grep  {"pattern":"--collect-only"}
T 4 grep  {"pattern":"--collect-only"}
T 5 grep  {"pattern":"--collect-only"}
```

**First causal divergence:** 5 tool calls, 5 read/grep, ZERO source edits; stopped with reason=no_progress

## `pylint-dev__pylint-6506` — `termination` (exit `model_finished`)

```
T 1 bash  {"cmd":"pylint -Q"}
T 2 bash  {"cmd":"python3 -m pylint -Q"}
T 3 bash  {"cmd":"export PYTHONPATH=$PYTHONPATH:$(pwd) && python3 -m pylint -Q"}
T 4 bash  {"cmd":"pip install -e ."}
T 5 bash  {"cmd":"pylint -Q"}
T 6 bash  {"cmd":"python3 -m pylint -Q"}
T 7 bash  {"cmd":"python3 -m pylint --version"}
T 8 bash  {"cmd":"python3 -c \"import pylint; print(pylint.__file__)\""}
T 9 bash  {"cmd":"python3 -m pylint -Q"}
T10 bash  {"cmd":"python3 -c \"import sys; import os; sys.path.insert(0, os.getcwd()); from pylint…
T11 bash  {"cmd":"grep -r \"PylintRun\" pylint/lint/run.py"}
T12 bash  {"cmd":"grep -r \"PylintRun\" pylint/"}
T13 bash  {"cmd":"python3 -c \"import sys; import os; sys.path.insert(0, os.getcwd()); from pylint…
T14 read  {"path":"pylint/config/config_initialization.py"}
T15 read  {"offset":39,"path":"pylint/config/config_initialization.py"}
T16 read  {"offset":73,"path":"pylint/config/config_initialization.py"}
T17 read  {"path":"pylint/lint/run.py"}
T18 read  {"offset":130,"path":"pylint/lint/run.py"}
T19 read  {"offset":130,"path":"pylint/lint/run.py"}
T20 read  {"offset":1,"path":"pylint/lint/run.py"}
T21 bash  {"cmd":"grep -n \"class Run\" pylint/lint/run.py"}
T22 read  {"offset":80,"path":"pylint/lint/run.py"}
T23 read  {"offset":122,"path":"pylint/lint/run.py"}
T24 bash  {"cmd":"grep -r \"c-extension-no-member\" pylint/"}
T25 read  {"path":"pylint/checkers/typecheck.py"}
T26 bash  {"cmd":"grep -n \"c-extension-no-member\" pylint/checkers/typecheck.py"}
T27 read  {"offset":220,"path":"pylint/checkers/typecheck.py"}
T28 bash  {"cmd":"python3 -c \"import sys; import os; sys.path.insert(0, os.getcwd()); from pylint…
T29 bash  {"cmd":"python3 -c \"import sys; import os; sys.path.insert(0, os.getcwd()); from pylint…
T30 bash  {"cmd":"python3 -c \"import sys; import os; sys.path.insert(0, os.getcwd()); from pylint…
T31 bash  {"cmd":"python3 -c \"import sys; import os; sys.path.insert(0, os.getcwd()); from pylint…
```

**First causal divergence:** 31 tool calls, 11 read/grep, ZERO source edits; stopped with reason=model_finished

## `pallets__flask-5063` — `editing` (exit `model_finished`)

```
T 1 bash  {"cmd":"ls -R"}
T 2 grep  {"pattern":"def routes","path":"src/flask/cli.py"}
T 3 bash  {"cmd":"find src -name \"*.py\" \| xargs grep -l \"routes\""}
T 4 read  {"path":"src/flask/cli.py"}
T 5 bash  {"cmd":"grep -n \"def routes\" src/flask/cli.py"}
T 6 read  {"path":"src/flask/cli.py","offset":1000}
T 7 bash  {"cmd":"cat <<EOF > reproduce_issue.py\nfrom flask import Flask, Blueprint\n\napp = Flas…
T 8 bash  {"cmd":"python3 -c \"from werkzeug.routing import Rule; help(Rule)\""}
T 9 bash  {"cmd":"python3 -c \"from werkzeug.routing import Rule; r = Rule('/'); print(f'Has host:…
T10 bash  {"cmd":"cat <<EOF > reproduce_issue.py\nfrom flask import Flask, Blueprint\n\napp = Flas…
T11 bash  {"cmd":"python3 -c \"from werkzeug.routing import Rule; r = Rule('/', subdomain='admin')…
T12 bash  {"cmd":"python3 -c \"from werkzeug.routing import Rule; r = Rule('/', subdomain='admin')…
T13 bash  {"cmd":"cat <<EOF > reproduce_issue.py\nfrom flask import Flask, Blueprint\n\napp = Flas…
T14 edit  {"new_string":" rules = list(current_app.url_map.iter_rules())\n if not rules:\n click.e…
T15 bash  {"cmd":"cat <<EOF > test_routes_cli.py\nimport click\nfrom flask import Flask, Blueprint…
T16 bash  {"cmd":"cat <<EOF > test_routes_cli.py\nimport click\nfrom flask import Flask, Blueprint…
T17 bash  {"cmd":"cat <<EOF > test_routes_cli.py\nimport click\nfrom flask import Flask, Blueprint…
T18 bash  {"cmd":"cat <<EOF > test_routes_cli.py\nimport click\nfrom flask import Flask, Blueprint…
T19 bash  {"cmd":"cat <<EOF > test_routes_cli.py\nimport click\nfrom flask import Flask, Blueprint…
T20 bash  {"cmd":"cat <<EOF > test_routes_cli.py\nimport click\nfrom flask import Flask, Blueprint…
```

**First causal divergence:** edited src/flask/cli.py; FAIL_TO_PASS still fails

## What the trajectories show that the score does not

- `pytest-6116`: five consecutive `grep` calls, four of them byte-identical and none
  carrying a `path`, then ADR-006 stops the run. The agent never read a single file. This is
  a degenerate repeat loop, not a considered decision to stop.
- `pylint-6506`: 31 calls of genuine, competent investigation — it located
  `config_initialization.py` and `run.py`, read the right regions, and reasoned correctly
  about `Run.__init__`. Then it wrote 1 731 characters of accurate analysis and stopped
  **without editing anything**. The diagnosis was right; the action never came.
- `flask-5063`: edited `src/flask/cli.py` and still failed — a genuine wrong edit, the
  only mechanism here that is unambiguously about *coding* rather than about control flow.

## The distinction that matters for the intervention

`pylint-6506` and `pytest-6116` both end with an unchanged repository, and a naive reading
files them together. They are not alike:

| | `pylint-6506` | `pytest-6116` |
|---|---|---|
| investigation | thorough, correct | none — 5 calls, 0 files read |
| final output | 1 731 chars of correct analysis | empty content + a tool call |
| stopped by | **itself** (`model_finished`) | **the runtime** (`no_progress`) |
| what was missing | the decision to act | the ability to escape a loop |

One needs a nudge from analysis to action. The other needs loop-breaking. A single
intervention aimed at "premature termination" would address neither properly.
