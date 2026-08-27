import { assessSuiteResult } from '../run-all.mjs';
import { spawnSync } from 'node:child_process';
import { check, summary } from '../harness.mjs';

const ok = { status: 0, signal: null, error: null };
check('normal suite with zero failures is accepted', assessSuiteResult(ok, 'suite: 3 passed, 0 failed').ok);
check('suite-reported assertion failure is rejected', !assessSuiteResult(ok, 'suite: 3 passed, 1 failed').ok);
check('zero-exit suite with no summary is rejected', !assessSuiteResult(ok, 'partial output before crash').ok);
check('abnormal suite exit is rejected even with a green-looking summary',
  !assessSuiteResult({ status: 1, signal: null, error: null }, 'suite: 3 passed, 0 failed').ok);
check('timeout/process error is rejected',
  !assessSuiteResult({ status: null, signal: 'SIGTERM', error: { message: 'ETIMEDOUT' } }, '').ok);
check('signal termination is rejected',
  !assessSuiteResult({ status: null, signal: 'SIGKILL', error: null }, 'suite: 3 passed, 0 failed').ok);
const crashed = spawnSync(process.execPath, ['-e', 'process.exit(1)'], { encoding: 'utf8' });
check('a real crashing child with no summary is rejected',
  !assessSuiteResult(crashed, `${crashed.stdout || ''}${crashed.stderr || ''}`).ok,
  `status=${crashed.status}`);

process.exit(summary('runner trust regression') ? 1 : 0);
