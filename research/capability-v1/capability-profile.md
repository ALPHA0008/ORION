# Capability Profile — Stage 1

**Corpus label: Stage-1 filtered SWE-bench-lite slice, locally reproduced.**
Single valid arm: **Gemma 4 31B**, n=1 per task, 17 tasks, 3 passed.
Qwen contributes nothing (see `qwen-invalidation.md`).

These are deliberately **not** collapsed into one score. The three layers below fail for different
reasons and would be fixed by different work.

## Layer 1 — Execution correctness (the V0 substrate)

| property | evidence | status |
|---|---|---|
| durability | 17/17 runs produced a complete, replayable event log | **holds** |
| verifier integrity | 0 verifier failures; 25/25 anti-gaming attacks defended | **holds** |
| fencing / leases | no lease violation across 17 runs | **holds** |
| authorization | 0 denials, 0 escalations (permissive posture, by design) | **not exercised** |
| escalation | 0 human requests — the agent never asked for help, on any of 14 failures | **not exercised** |
| infrastructure isolation | 0 infra failures, 0 timeouts, 0 budget exhaustion | **holds** |

The substrate did its job. Every one of the 14 failures is an agent failure, not a runtime failure —
which is the precondition that makes the rest of this document meaningful.

Worth noting: **the agent never once escalated.** Across 14 failures, including runs where it
looped on an identical `grep` five times, it never used `ask_user`. Whether that is a capability gap
or correct behaviour under a permissive posture is **UNRESOLVED** on this evidence.

## Layer 2 — Agent capability

| capability | evidence | assessment | confidence |
|---|---|---|---|
| repository navigation | found the right module in most trajectories (`pylint-6506` → `config_initialization.py`, `requests-3362` → `utils.py`) | **not the bottleneck** | MEDIUM |
| search | 403 tool calls, 79.9% success; `grep`/`read` used competently in 13/17 | adequate | MEDIUM |
| context acquisition | reads target the right regions once the file is found | adequate | MEDIUM |
| context management | 254 messages dropped by the `WINDOW=40` clamp — but see below | **confound, not a finding** | HIGH |
| tool selection | **10/17 runs wrote files via `bash` rather than `write`/`edit`** | notable, unexplained | HIGH |
| tool arguments | 82/403 calls failed (20.3%); recovered from 14 | adequate | MEDIUM |
| editing | 4 failures edited real source and still failed | genuine weakness | HIGH |
| testing | 13 test runs, 37 failed test runs | under-used | MEDIUM |
| test interpretation | no failure attributable to misreading results | not implicated | LOW |
| debugging | agents reproduce bugs then stop (`reproduce_issue.py` in 5 runs) | see termination | MEDIUM |
| reasoning | `pylint-6506` produced 1 731 chars of *correct* analysis and changed nothing | **diagnosis ≠ action** | HIGH |
| long-horizon execution | 6 failures; runtime had to stop the agent (`no_progress`/`max_turns`) | genuine weakness | HIGH |
| termination | 4 failures; agent declared itself done with an unchanged world | genuine weakness | HIGH |
| recovery | recovered from tool failure 14 times | works | MEDIUM |

### The context-management confound, resolved

Dropped messages correlate strongly with failure — passes lose a mean of 3.3 messages, failures
17.4, and the worst two runs (41 each) are both `long-horizon execution`.

**That correlation is not evidence of a context problem.** Tested directly:

```
dropped == max(0, messages_total - 40)   in 17 of 17 runs
```

Message-dropping is a pure arithmetic consequence of conversation length under ADR-001's
`WINDOW=40` clamp. Long runs drop more **because they are long**. The causation runs from
"the agent kept going" to "messages fell out of the window", not the reverse.

Also decisive: **0 context compactions occurred**, and Gemma's 32 768-token window was never the
binding limit. §15 asks whether the model actually hit its context limit, whether information was
dropped, and whether the task failed for some other reason first. Here: no, yes-but-mechanically,
and yes.

**A context-management intervention is therefore not justified by this data.** Recording it as a
rejected candidate is more useful than the number that looked like a finding.

## Layer 3 — Evaluation quality

| property | status |
|---|---|
| reproducibility | 17/17 tasks two-sided bracketed through the production verifier |
| verifier quality | deterministic pytest exit status, no LLM judge, oracle restored before every verdict |
| trajectory observability | complete event logs for all 17 runs; **69 run DBs preserved** |
| failure attribution | first causal divergence recoverable in 14/14 failures |
| **known blind spot** | the event log records only tool-mediated mutation; `bash` writes are invisible to it and visible only via `diff_stat` |

That last row is a real limitation of the instrument, found during this analysis. Both records are
individually correct; neither alone is sufficient.
