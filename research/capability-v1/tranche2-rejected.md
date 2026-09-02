# Tranche 2 — Rejections and Rescues

**Corpus label: Stage-1 filtered SWE-bench-lite slice + Verified tranche, locally reproduced.**

## The first probe: 0 / 3 — and two of the three were OUR defects

| task | recorded | actual cause |
|---|---|---|
| `django__django-11532` | `BASELINE_NOT_REPRODUCIBLE` | **ours** — wrong test runner |
| `django__django-11138` | `BASELINE_NOT_REPRODUCIBLE` | **ours** — wrong test runner |
| `pylint-dev__pylint-4551` | `DEPENDENCY_UNRESOLVABLE` | genuine (astroid pin conflict) |

Stage 1 established that an `oracle-negative` verdict is a hypothesis, not a result: five of its
rejections wore that label and none was a real task defect. The same discipline applied here caught
the same class of error again.

## Defect 1 — Django does not use pytest node ids

The bracketer fed pytest a **Django** test id:

```
test_non_ascii_dns_non_unicode_email (mail.tests.MailTests)
```

pytest correctly replied `file or directory not found`. Django's suite runs through
`tests/runtests.py --settings=test_sqlite`, with dotted ids
(`mail.tests.MailTests.test_non_ascii_dns_non_unicode_email`).

Every Django task would have been rejected as "the maintainer's own fix does not work", when the
real cause was that we never ran their tests at all.

## Defect 2 — the date pin fights Django's own version metadata

`--exclude-newer <created_at>` — which was essential for flask/pylint — makes Django unresolvable:
`asgiref` has a yank-hole (the same class as `atomicwrites`), and pinning further produces
`only django==4.1.dev... is available and you require django`.

Django installs cleanly **unpinned** (`pip install -e .`), because it is pure Python with a
near-empty runtime dependency set. The era pin exists to stop dependency drift breaking old code;
for a project with essentially no dependencies it buys nothing and costs reproducibility.

## Defect 3 — the F2P test cannot run standalone

Even with the right runner and a clean install, the target test failed **with the gold patch
applied**:

```
File "tests/mail/tests.py", line 371, in test_non_ascii_dns_non_unicode_email
    delattr(DNS_NAME, '_fqdn')
AttributeError: _fqdn
```

The test depends on `DNS_NAME._fqdn` having been cached by an earlier test in its class. Run at
class granularity it behaves correctly:

| tree | invocation | result |
|---|---|---|
| clean | `mail.tests.MailTests` (45 tests) | **FAILED (errors=1)** |
| + gold patch (5 files) | `mail.tests.MailTests` (45 tests) | **OK** |

So `django__django-11532` is a **sound, fully reproducible, genuinely multi-file task**. It was
three separate defects in our harness away from being admitted, and each one independently produced
a confident, wrong `BASELINE_NOT_REPRODUCIBLE`.

## Defect 4 — Django test ids are parenthesised, not dotted

SWE-bench stores Django ids exactly as unittest prints them:

```
test_non_ascii_dns_non_unicode_email (mail.tests.MailTests)
```

The class is in **parentheses**. A `classOf` helper that split on `.` produced
`test_non_ascii_dns_non_unicode_email (mail`, which `runtests.py` then tried to import as a module:

```
ModuleNotFoundError: No module named 'test_non_ascii_dns_non_unicode_email (mail'
```

Fixed to accept both shapes (parenthesised and plain dotted), verified against four id forms.

## Defect 5 — Django writes its verdict to stderr

Even with the right runner, the right commit and the right id, every Django task still failed the
oracle check. The strategy's `passed()` predicate searched the captured output for `OK` / `FAILED` —
but Django's runner writes the verdict to **stderr**, while **stdout** carries only:

```
Testing against Django installed in '...\django'
System check identified no issues (0 silenced).
```

The retained tail was therefore all banner and no verdict. Measured directly:

| tree | exit code | stderr |
|---|---|---|
| clean | **1** | `FAILED (errors=1)` |
| + gold patch | **0** | `OK` (45 tests) |

The exit code is unambiguous and is what unittest guarantees, so the verdict now comes from it. The
retained evidence is also concatenated **stderr-first**, so the verdict survives truncation.

## The pattern in these five defects

| # | defect | what it looked like |
|---|---|---|
| 1 | pytest given a Django id | `BASELINE_NOT_REPRODUCIBLE` |
| 2 | date pin breaks Django's own metadata | `DEPENDENCY_UNRESOLVABLE` |
| 3 | F2P test cannot run standalone | `BASELINE_NOT_REPRODUCIBLE` |
| 4 | id class in parentheses, not dotted | `BASELINE_NOT_REPRODUCIBLE` |
| 5 | verdict on stderr, evidence truncated to the banner | `BASELINE_NOT_REPRODUCIBLE` |

**Five consecutive defects, and every one of them presented as "the maintainer's own fix does not
work."** Only the manual bracket — clean tree FAILED, gold patch OK across 45 tests — established
that the task was sound and kept the investigation going.

This is the same lesson Stage 1 produced, now with a much higher count: **adopting a new repository
family costs a new test-invocation contract**, and until that contract is right, every rejection
from that family is uninformative about the tasks.

## Genuine rejection

`pylint-dev__pylint-4551` — `pylint==2.9.0.dev1` requires an astroid newer than the era index
offers (`only astroid<=2.5.7 is available`). A real dependency conflict, not an artifact of our
invocation. Recorded as `DEPENDENCY_UNRESOLVABLE`.

## What this changes for the tranche

The bracketer needs a **per-repository test-invocation strategy**, not a single pytest assumption.
That is a change to `eval/` benchmark code, not to `v0/src`, and it is required before any Django
admission verdict can be trusted.

Until it lands, no Django rejection in this tranche should be read as evidence about the task.
