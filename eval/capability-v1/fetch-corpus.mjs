// Fetch SWE-bench Lite task metadata and triage it for LOCAL reproducibility.
//
// ADOPT-BEFORE-BUILD (Rule 1): SWE-bench Lite supplies everything the schema needs — repo, base
// commit, problem statement, test_patch, gold patch, and FAIL_TO_PASS / PASS_TO_PASS oracles.
// Nothing about the task content needs authoring.
//
// What DOES need work is the environment. The official harness runs each task in a per-task Docker
// image pinned to a period-correct interpreter and dependency set. Docker is not serving on this
// machine (500 on _ping) and the two available interpreters are 3.13 / 3.14, which have removed
// stdlib modules that older tasks import (`cgi`). So this triages for the subset that is
// reproducible here, and records the rest as rejected-for-environment.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fixtures');
const DS = 'princeton-nlp%2FSWE-bench_Lite';

async function page(offset, length = 100) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${DS}&config=default&split=test&offset=${offset}&length=${length}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HF ${r.status} at offset ${offset}`);
  const j = await r.json();
  return (j.rows ?? []).map(x => x.row);
}

/**
 * Repos whose modern-interpreter viability is plausible: pure-Python, small dependency surface,
 * recent enough that 3.13/3.14 stdlib removals do not bite. Heavy scientific stacks
 * (numpy/scipy/matplotlib/astropy/sympy/xarray/seaborn/scikit-learn) need compiled wheels pinned
 * to old versions and are excluded up front rather than failed one by one.
 */
const PLAUSIBLE = new Set(['pallets/flask', 'psf/requests', 'pytest-dev/pytest', 'pylint-dev/pylint']);

const all = [];
for (const off of [0, 100, 200, 300]) {
  try { all.push(...await page(off)); } catch (e) { console.error(`page ${off}: ${e.message}`); }
}

console.log(`fetched ${all.length} SWE-bench Lite instances`);

const byRepo = {};
for (const r of all) byRepo[r.repo] = (byRepo[r.repo] ?? 0) + 1;
console.log('\nrepo distribution:');
for (const [k, v] of Object.entries(byRepo).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(30)} ${String(v).padStart(3)}${PLAUSIBLE.has(k) ? '   <- candidate' : ''}`);

const candidates = all.filter(r => PLAUSIBLE.has(r.repo)).map(r => ({
  task_id: r.instance_id,
  repository: r.repo,
  base_commit: r.base_commit,
  environment_setup_commit: r.environment_setup_commit,
  problem_statement: r.problem_statement,
  test_patch: r.test_patch,
  gold_patch: r.patch,
  fail_to_pass: JSON.parse(r.FAIL_TO_PASS),
  pass_to_pass: JSON.parse(r.PASS_TO_PASS),
  version: r.version,
  created_at: r.created_at,
  language: 'python',
}));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'swebench-lite-candidates.json'),
  JSON.stringify({ source: 'princeton-nlp/SWE-bench_Lite', fetched_at: new Date().toISOString(),
                   total_instances: all.length, repo_distribution: byRepo,
                   candidate_repos: [...PLAUSIBLE], candidates }, null, 2));

console.log(`\ncandidates in plausible repos: ${candidates.length}`);
const cRepo = {};
for (const c of candidates) cRepo[c.repository] = (cRepo[c.repository] ?? 0) + 1;
for (const [k, v] of Object.entries(cRepo)) console.log(`  ${k.padEnd(30)} ${v}`);
console.log(`\nwrote ${path.join(OUT, 'swebench-lite-candidates.json')}`);
