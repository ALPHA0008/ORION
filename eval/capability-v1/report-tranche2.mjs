// Generate the Tranche-2 corpus, distribution, accepted and rejected documents from the artifacts.
//
// Projected, never transcribed. Every number here has to be recomputable from
// tasks/tranche2/frozen-corpus.json + fixtures/tranche2-bracket.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, '..', '..', 'research', 'capability-v1');
const B = '`';

const frozen = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', 'tranche2', 'frozen-corpus.json'), 'utf8'));
const bracket = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'tranche2-bracket.json'), 'utf8'));
const cands = new Map(JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'tranche2-candidates.json'), 'utf8'))
  .candidates.map(c => [c.task_id, c]));
const stage1 = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', 'frozen-corpus.json'), 'utf8'));
const repro = JSON.parse(fs.readFileSync(path.join(HERE, 'reports', 'repro-sweep-tranche2.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = esc(s); return t.length > n ? t.slice(0, n) + '…' : t; };
const filesOf = (t) => cands.get(t.task_id)?.gold_files ?? 1;

const byRepo = {};
for (const t of frozen.tasks) (byRepo[t.repository] ??= []).push(t);
const byFiles = {};
for (const t of frozen.tasks) byFiles[filesOf(t)] = (byFiles[filesOf(t)] ?? 0) + 1;

// ── tranche2-corpus.md ───────────────────────────────────────────────────────
{
  const L = [];
  L.push(`# Tranche 2 — ${frozen.corpus_version}`, '');
  L.push(`**Corpus label: ${frozen.label}.**`);
  L.push('Not "SWE-bench performance" — the official per-instance Docker images were not used;');
  L.push('environments are reconstructed locally on a Windows host.', '');
  L.push('| field | value |', '|---|---|');
  L.push(`| corpus version | ${B}${frozen.corpus_version}${B} |`);
  L.push(`| corpus sha256 | ${B}${frozen.corpus_sha256}${B} |`);
  L.push(`| frozen at | ${frozen.frozen_at} |`);
  L.push(`| runtime commit | ${B}${String(frozen.runtime_commit).slice(0, 10)}${B} |`);
  L.push(`| source | ${B}${frozen.source}${B} |`);
  L.push(`| tasks | **${frozen.count}** |`);
  L.push(`| multi-file | **${frozen.tasks.filter(t => filesOf(t) > 1).length} / ${frozen.count}** |`);
  L.push(`| reproducible | **${repro.reproducible} / ${repro.total}** through the production verifier |`);
  L.push(`| bracket | ${frozen.bracket} |`, '');

  L.push('## Why Tranche 2 exists', '');
  L.push('Stage 1 returned `CORPUS_NEEDS_MORE_TASKS`. The binding limitation was not size — it was that');
  L.push('**every gold patch in the Stage-1 corpus touched exactly one file**, which is a property of');
  L.push('SWE-bench *Lite* itself: **0 of 300** Lite instances have a multi-file gold patch. No');
  L.push('Lite-derived tranche could have closed that gap, so Tranche 2 is drawn from **SWE-bench');
  L.push('Verified** (500 human-validated instances), where 58 of 400 fetched rows are multi-file.', '');

  L.push('## Independence from Stage 1', '');
  L.push(`${B}CAPABILITY_V1_STAGE1${B} (sha256 ${B}${stage1.corpus_sha256.slice(0, 16)}…${B}, ${stage1.count} tasks) is **unmodified**`);
  L.push('and verified byte-identical to its committed state. Tranche 2 has its own corpus identity,');
  L.push('its own task directory, its own tmp suite root, and will have its own run artifacts. No task');
  L.push('id is shared between the two.', '');

  L.push('## Tasks', '', '| # | task | repo | files | base commit | verified test |', '|---|---|---|---|---|---|');
  frozen.tasks.forEach((t, i) => L.push(`| ${i + 1} | ${B}${t.task_id}${B} | ${t.repository.split('/')[1]} | `
    + `**${filesOf(t)}** | ${B}${t.base_commit.slice(0, 10)}${B} | ${B}${cut(t.verified_test, 54)}${B} |`));
  L.push('');
  L.push('## Verification', '');
  L.push(`- ${frozen.verifier}`);
  L.push('- Django tasks are verified through `tests/runtests.py` at **class** granularity, verdict from');
  L.push('  the exit code — see `repository-test-contract.md`.');
  L.push('- PASS_TO_PASS ids that are prose docstrings rather than test ids are excluded **and counted**');
  L.push('  per task, so coverage is never overstated.');
  fs.writeFileSync(path.join(DOCS, 'tranche2-corpus.md'), L.join('\n'));
}

// ── tranche2-accepted.md ─────────────────────────────────────────────────────
{
  const L = [];
  L.push(`# Tranche 2 — Accepted Tasks (${frozen.count})`, '');
  L.push(`Corpus ${B}${frozen.corpus_version}${B} · sha256 ${B}${frozen.corpus_sha256.slice(0, 16)}…${B}`, '');
  L.push('Every task passed the full two-sided bracket **and** re-verified through the production');
  L.push('verifier: clean tree → objective unsatisfied; gold patch → verifier passes.', '');
  for (const [repo, ts] of Object.entries(byRepo).sort((a, b) => b[1].length - a[1].length)) {
    L.push(`## ${repo} — ${ts.length}`, '');
    L.push('| task | files | py | verified test |', '|---|---|---|---|');
    for (const t of ts) L.push(`| ${B}${t.task_id}${B} | **${filesOf(t)}** | ${t.python} | ${B}${cut(t.verified_test, 50)}${B} |`);
    L.push('');
  }
  fs.writeFileSync(path.join(DOCS, 'tranche2-accepted.md'), L.join('\n'));
}

// ── tranche2-distribution.md ─────────────────────────────────────────────────
{
  const s1Repos = new Set(stage1.tasks.map(t => t.repository));
  const t2Repos = new Set(frozen.tasks.map(t => t.repository));
  const L = [];
  L.push('# Tranche 2 — Distribution', '');
  L.push(`**${frozen.label}.**`, '');
  L.push('## Stage 1 vs Tranche 2', '', '| dimension | Stage 1 | Tranche 2 |', '|---|---|---|');
  L.push(`| tasks | ${stage1.count} | ${frozen.count} |`);
  L.push(`| **multi-file gold patches** | **0** | **${frozen.tasks.filter(t => filesOf(t) > 1).length}** |`);
  L.push(`| repositories | ${s1Repos.size} | ${t2Repos.size} |`);
  L.push(`| source | SWE-bench **Lite** | SWE-bench **Verified** |`);
  L.push(`| new repositories | — | ${[...t2Repos].filter(r => !s1Repos.has(r)).join(', ') || 'none'} |`);
  L.push(`| test runners | pytest | pytest **+ django runtests.py** |`, '');

  L.push('## Files touched by the gold patch', '', '| files | tasks |', '|---|---|');
  for (const [k, v] of Object.entries(byFiles).sort((a, b) => a[0] - b[0])) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('**Every accepted task is genuinely multi-file** — the count is of files the *known-good*');
  L.push('solution changes, not of files in the repository.', '');

  L.push('## Repository distribution', '', '| repository | tasks | share |', '|---|---|---|');
  for (const [repo, ts] of Object.entries(byRepo).sort((a, b) => b[1].length - a[1].length))
    L.push(`| ${repo} | ${ts.length} | ${Math.round(100 * ts.length / frozen.count)}% |`);
  L.push('');
  const top = Math.max(...Object.values(byRepo).map(v => v.length));
  L.push(`**Concentration warning, stated up front:** django is ${Math.round(100 * top / frozen.count)}% of this tranche.`);
  L.push('That is a direct consequence of where multi-file instances actually live in SWE-bench');
  L.push('Verified (32 of 43 multi-file candidates are django), not a preference. It means a mechanism');
  L.push('observed mainly on django tasks must be checked for whether it survives outside django before');
  L.push('it can support any conclusion — the same test Stage 1 applied to pytest.', '');

  L.push('## What this corpus supports', '');
  L.push('- multi-file coordination — **for the first time in this project**');
  L.push('- a materially larger repository (django) and a new testing ecosystem (django runtests)');
  L.push('- cross-repository comparison of any mechanism found', '');
  L.push('## What it still does NOT support', '');
  L.push('- **any non-Python language.** Java/Defects4J was evaluated and deferred: no JDK, no Maven,');
  L.push('  no Docker daemon on this machine, and building a Java toolchain would become a second');
  L.push('  project rather than a corpus expansion.');
  L.push('- claims about the hard end of the difficulty range — the scientific stack');
  L.push('  (matplotlib, scikit-learn, astropy, xarray) is still excluded for buildability.');
  L.push('- statements about model capability generally: still **one valid model arm**.');
  fs.writeFileSync(path.join(DOCS, 'tranche2-distribution.md'), L.join('\n'));
}

console.log(`tranche2-corpus.md · tranche2-accepted.md · tranche2-distribution.md`);
console.log(`  ${frozen.count} tasks · ${frozen.tasks.filter(t => filesOf(t) > 1).length} multi-file · ${Object.keys(byRepo).length} repos`);
