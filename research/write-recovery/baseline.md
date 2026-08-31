# Phase 7 — Frozen Baseline

| item | value |
|---|---|
| git revision | `0f8f3314b6f059f81d44793ad1fb33b58f6a36e3` |
| working tree | clean |
| OS / Node | Windows 11 Pro 10.0.26100 / v24.18.0 |
| regression | **501 passed, 0 failed across 19 suites** |

## Known defect being fixed (phase 4)

| metric | `edit` | `write` |
|---|---:|---:|
| verification misclassification | **0/6** | **1/6** |
| false `not-applied` | 0 | **1** |
| silent overwrite | 0 | **1** |

Reproduced four ways: deterministic world-state matrix, real `SIGKILL` with a concurrent third
actor, and on real pinned repository bytes (`p-limit@df476048/index.js`).

## The failing sequence

```
write effect lands → crash before durable success → third actor legitimately changes the file
→ recovery: verify() sees current != intended → 'not-applied' → SAFE_RETRY → REISSUE
→ the concurrent change is silently destroyed
```

## Confirmed still reproducing at this commit

`worldstate/worldstate` (19), `worldstate/concurrent-race` (13) and `worldstate/real-repo-race`
(10) all pass, and they assert the defect **as measured behaviour**:

```
write S2 (applied then changed) -> verify()='not-applied' decision='reissue'
  REISSUE silently destroys the concurrent change   ok   ← measured
```

`edit` on the identical world reports `applied` → SKIP and the concurrent change survives.

## Escalation-control tests confirmed passing

`escalationgate/escalationgate` (28), `escalation-lifecycle` (20), `bypass` (12) — all green at
this commit, and must remain so.

## Out of scope (§26)

Qwen `no_edits_made`, Gemma looping, Qwen absolute-path assumptions, the diagnosis→action gap,
and the `read` TAB-separator defect. This phase fixes exactly one runtime correctness problem.
