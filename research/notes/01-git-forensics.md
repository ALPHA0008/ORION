# Phase 1 — Git Forensics

Recorded 2026-08-26T11:20–11:35Z. Performed **before** reading any README, by design.

Evidence: `evidence/commands/phase0-pinned-state.txt`, `phase1-authors.txt`, `phase1-velocity.txt`

Pinned state: qm `c7caba56` · hermes-agent `d62a05e9` · ruflo `e21aa352`

---

## 1. Summary table

| Metric | QM | Hermes Agent | Ruflo |
|---|---|---|---|
| Total commits | 176 | 25,451 | 7,396 |
| First commit | 2026-07-29 | 2025-07-22 | 2025-06-02 |
| Last commit | 2026-08-25 | 2026-08-26 | 2026-08-24 |
| Lifetime (public) | **28 days** | 13 months | 15 months |
| Distinct author emails | 7 | 3,048 | 42 |
| Top author share | 66.5% (Regan Bell) | 34.9% (teknium1, merged ids) | **93.7% (ruv)** |
| Top-2 share | **97.2%** | 47.6% | 97.6% |
| Tags | 4 | 35 | **1,635** |
| PR-shaped commits | **90.9%** | 21.2% | **8.2%** |
| Merge commits | 9 | 1,981 | 211 |
| AI co-authored commits | 25 (14.2%) | 617 (2.4%) | **3,103 (42.0%)** |
| Commits last 30d | 176 | 7,078 | 146 |

---

## FINDING GIT-001 — QM's history is squashed; pre-2026-07-29 development is not observable
**Status: VERIFIED**

QM's first commit is titled literally `Fresh repo history`:

```
FIRST: 57b51916f479fd642b4c0c89fb07961fd3f862b4 2026-07-29T11:13:20-07:00
       Regan Bell <reganbell@gmail.com> Fresh repo history
```

It introduces **1,263 files in one commit** (via `git log --name-only` tree scan).

**Interpretation:** QM did not begin on 2026-07-29. The repo was re-initialised, discarding prior
history — commonly done when open-sourcing an internal codebase. Consequences for this research:
- QM's true age, original authorship, and early architectural evolution are **UNVERIFIABLE**.
- Velocity figures for QM describe *only the public repo*, not the project.
- Any statement like "QM is a 28-day-old project" would be an error. It is a project with 28 days
  of *public* history and an unknown amount of private history.

Supporting evidence: the most recent commit references **PR #676** against a repo with only 176
commits. PR numbering carried over from the pre-squash repository.

Confidence: high.

---

## FINDING GIT-002 — Ruflo is ~94% single-author, and 42% of its commits are AI-generated
**Status: VERIFIED**

```
6927 ruv@ruv.net           (93.7%)
 292 cohen@ruv-mac-mini.local
  50 noreply@anthropic.com
  35 you@example.com        <-- placeholder identity
```

Commits carrying `Co-Authored-By: Claude`: **3,103 / 7,396 = 42.0%**.
Commits carrying `Generated with [Claude Code]`: 2,882.

Also present, exactly as the brief predicted as red flags:
- `you@example.com` — 35 commits (placeholder git identity, never configured)
- `noreply@anthropic.com` — 50 commits (committed under the AI tool's own identity)
- 293 commits from `*.local` hostnames (unconfigured local machines)

**Correction note:** an earlier grep counted 8,310 *mentions* of AI trailers across commit bodies.
The correct per-commit figure is 3,103 (42.0%); trailers appear multiple times per body.

**Interpretation:** Ruflo is a solo project in which a large fraction of code was written by an AI
coding tool with the author supervising. This is not automatically bad — but it predicts a specific
failure signature later phases must test: **high-volume, plausible-looking, internally inconsistent
code with impressive naming and thin real implementation.** Flagged for Phase 7.

Confidence: high.

---

## FINDING GIT-003 — Ruflo's 1,635 tags are automated version churn, not releases
**Status: VERIFIED**

Tags per month, top months:
```
1092  2025-08     <-- ~35 tags/day
 242  2025-09
 100  2025-07
```
Release-bump commits (`chore(release):`, `🔖`, `🚀 Release`): **2,314 = 31.3% of all commits.**
The HEAD commit is itself `chore(release): 3.38.19 -> 3.38.20`.

**Interpretation:** Version number (3.38.20) and tag count convey no maturity information here. A
project that publishes ~35 versions a day is running an automated publish loop. Do not treat Ruflo's
high semver as evidence of a long stabilisation history.

Confidence: high.

---

## FINDING GIT-004 — Ruflo was previously "claude-code-flow"; it is a renamed/rewritten project
**Status: VERIFIED**

A 2025-09-26 commit records its own workspace path:
```
1037 files  bb5b908c... 2025-09-26 rUv  🔖 Checkpoint: Edit /workspaces/claude-code-flow/package.json
```
And a 2025-07-18 commit: `🚀 Release: Claude Flow v2.0.0-alpha.62`.
The v2 codebase was archived then deleted:
```
6442 files  003ce127 2026-05-05 Reuven  chore(repo): archive legacy v2/ codebase under archive/v2/
6446 files  5f0c8455 2026-05-10 rUv     chore: remove archive/ to shrink marketplace clone footprint
```

**Interpretation:** Ruflo is at least the third identity of this codebase (claude-code-flow →
claude-flow v2 → ruflo v3). A whole prior generation was archived and deleted in May 2026. Relevant
because docs and issues may describe v2 behaviour that no longer exists — Phase 7 must check
claim-vs-version drift.

Confidence: high.

---

## FINDING GIT-005 — Ruflo contains ~4,833 auto-generated "checkpoint" commits
**Status: VERIFIED**

`git log --format='%s' | grep -ci checkpoint` → **4,833** commit subjects mention checkpoint; 589 use
the literal `checkpoint:` conventional prefix. Samples are machine-written:
```
🔖 Checkpoint: Edit /workspaces/claude-code-flow/package.json
🏁 Session end checkpoint: session-20250906-204445
checkpoint: File edit:
```

**Caveat:** the 4,833 figure is a substring match and includes legitimate commits about the
*checkpoint feature* (e.g. `feat(neural): training flywheel ... checkpoint auto-load`). The
unambiguous machine-generated subset (`🔖 Checkpoint:`, `🏁 Session end checkpoint:`,
`checkpoint: File edit:`) is smaller. Treat 589 as the firm floor and 4,833 as the loose ceiling.

**Interpretation:** Ruflo's own agent tooling commits to Ruflo's repo. Commit count is therefore
**not** a measure of human engineering effort here. Effective human commit volume is far below 7,396.

Confidence: high that automated checkpointing exists; medium on its exact volume.

---

## FINDING GIT-006 — Ruflo's velocity has collapsed ~96% from peak
**Status: VERIFIED**

```
2025-08  2326  <-- peak
2026-01  2100  <-- second peak
2026-05   550
2026-06   424
2026-07   210
2026-08    95  <-- current
```

**Interpretation:** Two large bursts followed by sustained decline. Current activity is ~4% of peak.
The project is still *alive* (commits within 2 days of research date) but decelerating sharply.
Combined with 94% single-author concentration: **bus factor = 1**, and the bus is slowing.

Confidence: high for the trend. The cause is UNVERIFIABLE from git alone.

---

## FINDING GIT-007 — Hermes went from hobby project to funded team effort in Feb 2026
**Status: VERIFIED**

```
2025-07     9
2025-08    10
2025-09     7
2025-10    11
2025-11    23
2025-12     0   <-- gap
2026-01    32
2026-02   480   <-- 15x jump
2026-03  2522
2026-04  4086
2026-05  3342
2026-06  4021
2026-07  5924   <-- peak
2026-08  4984
```

Sustained 3,000–6,000 commits/month for seven months.

**Interpretation:** The Jan→Feb 2026 discontinuity (32 → 480 → 2,522) is not organic growth; it is a
step change in resourcing. Hermes is the only one of the three with both a genuine multi-contributor
community and sustained institutional velocity. Bus factor is meaningfully >1: excluding teknium1,
four contributors exceed 400 commits each (brooklyn 3,239; kshitijk4poor 1,598; arilotter 456;
ben@nousresearch.com 436).

**Caveat:** 3,048 author emails does **not** mean 3,048 engineers. It includes bots (247 commits),
one-commit drive-bys, and 125 `*.local` identities. The load-bearing core looks like ~6–10 people.

Confidence: high.

---

## FINDING GIT-008 — Hermes has a 4:1 fix-to-feature commit ratio
**Status: VERIFIED (ratio) / OPEN (interpretation)**

```
13220 fix:
 3307 feat:
 1726 chore:
 1600 test:
```

**Interpretation:** Two readings, and git alone cannot separate them:
(a) the codebase is unstable and requires constant repair, or
(b) the team ships fast and repairs in the open, using `fix:` loosely for any adjustment.
1,600 `test:` commits argues partly for (b). **Flagged as an open question for Phase 2** —
resolvable by checking whether fixes cluster in a few hot files (instability) or spread evenly
(normal iteration). Not concluding either way here.

Confidence: the ratio is certain; the interpretation is genuinely open.

---

## FINDING GIT-009 — The three development models are categorically different
**Status: VERIFIED**

| | QM | Hermes | Ruflo |
|---|---|---|---|
| Committed by GitHub (PR merge) | **90.9%** | 21.2% | **8.2%** |
| Merge commits | 9 | 1,981 | 211 |
| Squashed PR titles `(#N)` | 85.8% | 18.5% | 5.4% |

QM: near-total PR discipline — 160 of 176 commits landed through GitHub's merge machinery. Reviewed
work, small team, deliberate process. Contributors include a `@ycombinator.com` address and
`garrytan@gmail.com`.

Hermes: 21% GitHub-committed but 1,981 merge commits — a mixed model with real code review at scale.

Ruflo: 8.2%. Overwhelmingly direct-to-main pushes by one person.

**Limitation (required by brief):** this metric is inferred from committer identity and subject
suffixes, **not** GitHub API data. Squash-merges with rewritten committers, local merges of reviewed
branches, and rebase workflows all distort it. Treat as directional evidence of *process*, not an
exact PR count.

Confidence: medium-high directionally; low on exact ratios.

---

## 2. What each history implies

**QM** — A small, disciplined, professional team (2 principals contributing 97% of commits, plus
drive-by contributors). Strong review culture. Public history deliberately reset. The codebase is
almost certainly older and more mature than 176 commits suggests; it must not be judged as a
month-old project. *Alive and accelerating.*

**Hermes** — The only project with a real engineering organisation and a real external contributor
community behind it. Went from side project to funded effort in Feb 2026 and has sustained heavy
velocity for seven months. *Alive; the most institutionally robust of the three.*

**Ruflo** — One person plus an AI coding tool, 15 months, two bursts, now at ~4% of peak velocity.
31% of commits are automated release bumps; 42% are AI co-authored. Version 3.38.20 and 1,635 tags
are noise, not maturity signals. The project has been renamed and rewritten at least twice, deleting
a prior generation. *Alive but decelerating, bus factor 1.*

---

## 3. What was NOT inspected in this phase
- **GitHub API data** (PRs, issues, review comments, stars) — not fetched. The PR ratio above is
  inferred from git metadata only.
- **Commit content** — deliberately deferred to Phase 2/7. Nothing in this phase claims anything
  about code quality.
- **Ruflo's deleted `archive/v2/` tree** — recoverable from history if a later phase needs it.
- **Hermes's hot-file distribution** — needed to resolve GIT-008; deferred to Phase 2.
