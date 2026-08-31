# Real-Repository Reproduction (§11)

Suite: `v0/tests/worldstate/real-repo-race.test.mjs` — **14 assertions** (was 10), against
`p-limit@df476048/index.js` (3,315 bytes) read from the pinned mirror.

## The three metrics, reported separately (§11, §22)

| dimension | before (unwitnessed) | **after (witnessed)** |
|---|---|---|
| `task_success` | PASS | PASS |
| `recovery_correctness` | **FAIL** | **PASS** ✅ |
| `world_state_correctness` | **FAIL** | **PASS** ✅ |

```
real-repo write race      -> verify()='not-applied' decision='reissue'   (unwitnessed, unchanged)
  the concurrent change is DESTROYED on real repository bytes            ok

real-repo witnessed write -> verify()='unknown' decision='escalate'
  verify() is UNKNOWN on real repository bytes                           ok
  decision is ESCALATE                                                   ok
  world_state_correctness = PASS (concurrent change survives)            ok
```

## Why a passing task verifier was never sufficient

In the unwitnessed case the file ends up holding the semantically **correct** fix — the
repository's own test suite would be green — while a legitimate concurrent change has been
destroyed. `task_success` and `recovery_correctness` disagree, which is exactly why they are
reported separately and why this defect was invisible to the 22-task benchmark (91 real runs
produced 20 `write` calls and **zero** recovery decisions).
