// Child process: append N events, print the seqs it was allocated.
import { Store } from '../../src/core/run/store.mjs';
const [, , dbPath, runId, n, tag] = process.argv;
const s = new Store(dbPath, { durability: 'normal' });
const got = [];
for (let i = 0; i < Number(n); i++) got.push(s.append(runId, 'turn.started', { tag, i }));
s.close();
process.stdout.write(JSON.stringify(got));
