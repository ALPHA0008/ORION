# Rejected Tasks — 16

Negative findings are part of the result (§6). Every candidate that failed the bracket is listed
here with the stage it failed at, so the corpus's size can be audited rather than trusted.

**No task was repaired to make it pass.** A task that could not be reproduced was excluded (§7).

## oracle-negative — 7

The maintainer's own fix does not make the test pass here. Either the environment still differs from the original, or the recorded oracle does not hold. Excluded rather than guessed at.

| task | detail |
|---|---|
| `pylint-dev__pylint-7080` | RunTC::test_ignore_path_recursive_current_dir (no name 'C:\\Users\\abhijith.p\\AppData\\Local\\Temp\\capabilit… |
| `pytest-dev__pytest-5103` | ne 22, in add_ini_option parser.addini( File "C:\Users\abhijith.p\AppData\Local\Temp\capability-v1\work\pytest… |
| `pytest-dev__pytest-5221` | ne 22, in add_ini_option parser.addini( File "C:\Users\abhijith.p\AppData\Local\Temp\capability-v1\work\pytest… |
| `pytest-dev__pytest-5227` | ne 22, in add_ini_option parser.addini( File "C:\Users\abhijith.p\AppData\Local\Temp\capability-v1\work\pytest… |
| `pytest-dev__pytest-5413` | ibutions File "C:\Users\abhijith.p\AppData\Roaming\uv\python\cpython-3.9-windows-x86_64-none\lib\importlib\met… |
| `pytest-dev__pytest-5692` | ibutions File "C:\Users\abhijith.p\AppData\Roaming\uv\python\cpython-3.9-windows-x86_64-none\lib\importlib\met… |
| `pytest-dev__pytest-8906` | sertion import rewrite File "C:\Users\abhijith.p\AppData\Local\Temp\capability-v1\work\pytest-dev__pytest-8906… |

## preflight-positive — 5

The FAIL_TO_PASS test ALREADY PASSES on the clean tree. The task is not unsatisfied, so solving it would prove nothing.

| task | detail |
|---|---|
| `pallets__flask-4992` | test passes WITHOUT the fix |
| `psf__requests-2148` | test passes WITHOUT the fix |
| `psf__requests-2317` | test passes WITHOUT the fix |
| `psf__requests-2674` | test passes WITHOUT the fix |
| `pytest-dev__pytest-7168` | test passes WITHOUT the fix |

## install — 4

The tree could not be built in an era-correct environment.

| task | detail |
|---|---|
| `psf__requests-1963` | Command failed: uv pip install --python "C:\Users\abhijith.p\AppData\Local\Temp\capability-v1\_venvs\psf__requ… |
| `psf__requests-863` | Command failed: uv pip install --python "C:\Users\abhijith.p\AppData\Local\Temp\capability-v1\_venvs\psf__requ… |
| `pylint-dev__pylint-7114` | Command failed: uv pip install --python "C:\Users\abhijith.p\AppData\Local\Temp\capability-v1\_venvs\pylint-de… |
| `pytest-dev__pytest-5495` | Command failed: uv pip install --python "C:\Users\abhijith.p\AppData\Local\Temp\capability-v1\_venvs\pytest-de… |

## What the rejections mean for the corpus

The dominant rejection stage is the honest measure of what limits this corpus. If it is
`oracle-negative`, the limit is **environment fidelity** — the tasks are real but this machine
cannot fully reproduce the world they were solved in. If it were `preflight-positive`, the limit
would be **task quality**. Those imply very different next steps, which is why the stage is recorded
rather than a bare count.
