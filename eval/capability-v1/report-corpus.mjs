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
const rej = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'rejections.json'), 'utf8'));

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
for (const r of rej.rejected) (byStage[r.stage] ??= []).push(r);

const MEANING = {
  'commit-unreachable': 'The base commit no longer exists in the public repository. The task cannot be reproduced by anyone, not just here.',
  'install': 'The tree could not be built in an era-correct environment.',
  'checkout': 'The working tree could not be created.',
  'venv': 'The interpreter could not be provisioned.',
  'test-patch': 'The oracle could not be installed onto the tree.',
  'preflight-positive': 'The FAIL_TO_PASS test ALREADY PASSES on the clean tree. The task is not unsatisfied, so solving it would prove nothing.',
  'oracle-negative': "The maintainer's own fix does not make the test pass here. Either the environment still differs from the original, or the recorded oracle does not hold. Excluded rather than guessed at.",
  'no-test': 'The instance declares no FAIL_TO_PASS test, so there is nothing deterministic to verify.',
  'mirror': 'The repository could not be cloned.',
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
r += `## What the rejections mean for the corpus

The dominant rejection stage is the honest measure of what limits this corpus. If it is
\`oracle-negative\`, the limit is **environment fidelity** — the tasks are real but this machine
cannot fully reproduce the world they were solved in. If it were \`preflight-positive\`, the limit
would be **task quality**. Those imply very different next steps, which is why the stage is recorded
rather than a bare count.
`;
fs.writeFileSync(path.join(OUT, 'rejected-tasks.md'), r);

console.log(`accepted-tasks.md  (${corpus.count} tasks)`);
console.log(`rejected-tasks.md  (${rej.count} rejections)`);
for (const [k, v] of Object.entries(byStage).sort((x, y) => y[1].length - x[1].length))
  console.log(`  ${k.padEnd(22)} ${v.length}`);
