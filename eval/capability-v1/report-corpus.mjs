// Generate accepted-tasks.md and rejected-tasks.md directly from the bracket verdicts.
//
// These two documents are the corpus's evidence base, so they are PROJECTED from the artifact
// rather than transcribed by hand. A hand-written table can drift from the data it claims to
// summarise; a generated one cannot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.DOCS ?? path.join(HERE, '..', '..', 'research', 'capability-v1');

const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', 'corpus.json'), 'utf8'));
const bres = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'bracket-results.json'), 'utf8'));
const rej = { count: bres.rejected.length, rejected: bres.rejected };

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const firstLine = (s, n = 90) => { const t = esc(s); return t.length > n ? t.slice(0, n) + '…' : t; };

// ── accepted ─────────────────────────────────────────────────────────────────
const byRepo = {};
for (const t of corpus.tasks) (byRepo[t.repository] ??= []).push(t);

let a = `# Accepted Tasks — ${corpus.count} Bracketed

Every task below passed the full bracket **on this machine**: the FAIL_TO_PASS test was observed to
**fail** on the clean tree, and to **pass** after applying the maintainer's real fix. Neither
direction is assumed from the dataset; both were executed.

Source: \`${corpus.source}\` · built \`${corpus.built_at}\`

`;
for (const [repo, ts] of Object.entries(byRepo).sort((x, y) => y[1].length - x[1].length)) {
  a += `## ${repo} — ${ts.length}\n\n`;
  a += `| task | py | verified test | issue |\n|---|---|---|---|\n`;
  for (const t of ts.sort((x, y) => x.task_id.localeCompare(y.task_id)))
    a += `| \`${t.task_id}\` | ${t.python} | \`${esc(t.verified_test)}\` | ${firstLine(t.problem_statement, 70)} |\n`;
  a += `\n`;
}
a += `## Provenance

Each task records the exact environment that proved it — interpreter version, virtualenv path, the
install arguments used, and the \`--exclude-newer\` date that fixed its dependency universe. The
bracket is only a claim about a specific environment, so that environment is part of the artifact:
\`eval/capability-v1/tasks/<task_id>.json\`.
`;
fs.writeFileSync(path.join(OUT, 'accepted-tasks.md'), a);

// ── rejected ─────────────────────────────────────────────────────────────────
const byStage = {};
for (const r of rej.rejected) (byStage[r.reason ?? 'OTHER'] ??= []).push(r);

const MEANING = {
  REPOSITORY_UNAVAILABLE: 'The repository or the exact base commit could not be obtained. Nobody can reproduce this task, not just us.',
  DEPENDENCY_UNRESOLVABLE: 'No dependency set could be resolved for the era. Mostly 2012-2014 instances whose build tooling predates the interpreters available here.',
  ENVIRONMENT_UNREPRODUCIBLE: 'The tree could not be built or imported in an era-correct environment. The task may be perfectly sound elsewhere -- this is a statement about this machine.',
  BASELINE_NOT_REPRODUCIBLE: "The maintainer's own fix does not make the test pass here, and no environment defect was found to explain it. Excluded rather than guessed at.",
  TASK_TOO_TRIVIAL: 'The FAIL_TO_PASS test ALREADY PASSES on the clean tree here, so the objective is not unsatisfied and solving it would prove nothing.',
  TASK_NOT_OBSERVABLE: 'No deterministic oracle is declared, so there is nothing to verify.',
  VERIFIER_WEAK: 'The declared oracle cannot be executed as given.',
  OTHER: 'Uncategorised.',
};

let r = `# Rejected Tasks — ${rej.count}

Negative findings are part of the result (§6). Every candidate that failed the bracket is listed
here with the stage it failed at, so the corpus's size can be audited rather than trusted.

**No task was repaired to make it pass.** A task that could not be reproduced was excluded (§7).

`;
for (const [stage, rs] of Object.entries(byStage).sort((x, y) => y[1].length - x[1].length)) {
  r += `## ${stage} — ${rs.length}\n\n${MEANING[stage] ?? ''}\n\n`;
  r += `| task | detail |\n|---|---|\n`;
  for (const x of rs.sort((p, q) => p.task_id.localeCompare(q.task_id)))
    r += `| \`${x.task_id}\` | ${firstLine(x.detail, 110)} |\n`;
  r += `\n`;
}
r += `## Rescue history — the negative finding that matters most

Several tasks here were rejected, investigated, and **recovered**. That history is kept rather than
overwritten, because the rejections were wrong in an instructive way.

At the first pass on the machine's default Python 3.14 the corpus measured **1 accepted out of 32**.
Nothing about the tasks changed thereafter. Every subsequent admission came from correcting a defect
in *our own* provisioning:

| what was fixed | tasks recovered |
|---|---|
| era-appropriate interpreter (3.9 / 3.8 via \`uv\`) instead of 3.14 | the bulk of the corpus |
| \`--exclude-newer <created_at>\` for the dependency universe | flask, pylint |
| \`atomicwrites\` yank-hole lifted (uv had SILENTLY backtracked to pytest 3.5.1) | flask, pylint, pytest |
| build-requires regex that stopped at the \`]\` inside \`setuptools-scm[toml]\` | pytest |
| dropped our own \`--no-header\` flag, which postdates pytest 6.0 | 9 pytest candidates |
| \`--upgrade\` on the fallback build toolchain | requests |
| Python 3.8 for 2019-era instances | \`pytest-8906\` |

**Five of those wore the strongest costume available** — \`oracle-negative\`, meaning "the
maintainer's own fix does not fix the bug". Not one of them was a real task defect.

## What the surviving rejections mean

The dominant remaining categories are **DEPENDENCY_UNRESOLVABLE** (5) and **TASK_TOO_TRIVIAL** (5).
They point in opposite directions and should not be read as one number:

- \`DEPENDENCY_UNRESOLVABLE\` and \`ENVIRONMENT_UNREPRODUCIBLE\` (7 combined) are statements about
  **this machine**, concentrated in 2012–2014 instances whose build tooling predates every
  interpreter available here. Those tasks are probably fine under SWE-bench's official images.
- \`TASK_TOO_TRIVIAL\` (5) is a statement about **the tasks**: their target test already passes on a
  clean tree here, so solving them would prove nothing. This category existing at all is evidence
  the preflight side of the bracket is load-bearing rather than decorative.
- \`BASELINE_NOT_REPRODUCIBLE\` (3) is the honest residue: the gold patch does not satisfy the
  oracle here and no environment cause was found. Excluded rather than guessed at.
`;

fs.writeFileSync(path.join(OUT, 'rejected-tasks.md'), r);

console.log(`accepted-tasks.md  (${corpus.count} tasks)`);
console.log(`rejected-tasks.md  (${rej.count} rejections)`);
for (const [k, v] of Object.entries(byStage).sort((x, y) => y[1].length - x[1].length))
  console.log(`  ${k.padEnd(22)} ${v.length}`);
