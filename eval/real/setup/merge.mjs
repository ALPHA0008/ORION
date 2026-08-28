// Merge per-repository result files into one baseline report.
// Used because the full 22-task run exceeds a single command window; the merged file is
// byte-equivalent to what a single `run` over all tasks would have produced.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate } from '../../metrics/index.mjs';
import { REPOSITORIES } from '../repositories/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.join(HERE, '..', 'reports');

const [, , outName, label, ...inputs] = process.argv;
if (!outName || !label || !inputs.length) {
  console.error('usage: merge.mjs <out.json> <label> <in1.json> [in2.json ...]');
  process.exit(2);
}

const results = [];
let model = null, compaction = null, node = null;
for (const f of inputs) {
  const d = JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8'));
  model ??= d.model; compaction ??= d.compaction; node ??= d.node;
  results.push(...d.results);
}

const merged = {
  label, runner: 'harness-v0', model,
  endpoint_kind: 'openai-compatible', compaction,
  at: new Date().toISOString(), node,
  merged_from: inputs,
  repositories: Object.fromEntries(Object.entries(REPOSITORIES)
    .map(([k, v]) => [k, { url: v.url, commit: v.commit, test_command: v.test_command }])),
  aggregate: aggregate(results),
  results,
};
fs.writeFileSync(path.join(REPORTS, outName), JSON.stringify(merged, null, 2));
console.log(`merged ${results.length} results -> ${outName}`);
