// Child process: commit one append then die abruptly.
import { Store } from '../../src/core/run/store.mjs';
const [, , dbPath, runId] = process.argv;
const s = new Store(dbPath);
s.append(runId, 'turn.started', { marker: 'pre-crash' });
process.kill(process.pid, 'SIGKILL');
