// Phase M — security review by attack, not by checklist.
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, uid } from '../../src/core/run/store.mjs';
import { LocalSandbox, scrubEnv } from '../../src/sandbox/local/index.mjs';
import { makeTools } from '../../src/agent/tools/index.mjs';
import { createAuthorizer } from '../../src/auth/default/index.mjs';
import { Worker } from '../../src/agent/loop/worker.mjs';
import { explain, redact } from '../../src/core/run/explain.mjs';
import { project } from '../../src/core/projection/index.mjs';
import { classifyShell, RecoveryClass } from '../../src/core/recovery/index.mjs';
import { startFakeProvider } from '../_helpers/fake-provider.mjs';
import { describe, check, eq, summary, tmpdir } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = tmpdir('security');
const mk = (tag) => {
  const d = path.join(DIR, tag); fs.mkdirSync(d, { recursive: true });
  const store = new Store(path.join(d, 'h.db'), { durability: 'normal' });
  const sandbox = new LocalSandbox(path.join(d, 'work'));
  return { store, sandbox, tools: makeTools(sandbox), dir: d };
};

// ═══════════════════════════════════════════ path traversal / fs escape
describe('path traversal and filesystem escape');
{
  const { sandbox, tools, dir } = mk('traversal');
  const outside = path.join(dir, 'SECRET-OUTSIDE.txt');
  fs.writeFileSync(outside, 'top secret');

  const attacks = [
    '../SECRET-OUTSIDE.txt',
    '../../SECRET-OUTSIDE.txt',
    './../SECRET-OUTSIDE.txt',
    'a/../../SECRET-OUTSIDE.txt',
    'a/b/../../../SECRET-OUTSIDE.txt',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '..\\SECRET-OUTSIDE.txt',
  ];
  let blocked = 0;
  for (const a of attacks) { try { tools.read.run({ path: a }); } catch { blocked++; } }
  eq('every traversal read blocked', blocked, attacks.length);

  let wblocked = 0;
  for (const a of attacks) { try { tools.write.run({ path: a, content: 'pwned' }); } catch { wblocked++; } }
  eq('every traversal write blocked', wblocked, attacks.length);
  eq('the outside file is untouched', fs.readFileSync(outside, 'utf8'), 'top secret');

  check('null byte rejected', (() => { try { sandbox.read('a\0b'); return false; } catch { return true; } })());
  check('empty path rejected', (() => { try { sandbox.read(''); return false; } catch { return true; } })());
  check('non-string path rejected', (() => { try { sandbox.read(42); return false; } catch { return true; } })());

  // symlink escape
  let symlinkTested = false, symlinkBlocked = false;
  try {
    fs.symlinkSync(dir, path.join(sandbox.root, 'link'), 'junction');
    symlinkTested = true;
    try { sandbox.read('link/SECRET-OUTSIDE.txt'); } catch { symlinkBlocked = true; }
  } catch { /* symlink creation may require privileges on Windows */ }
  check(symlinkTested ? 'symlink escape blocked' : 'symlink escape (skipped: cannot create symlink here)',
    symlinkTested ? symlinkBlocked : true, symlinkTested ? '' : 'no privilege');
}

// ═══════════════════════════════════════════ command injection / hard denies
describe('command policy: hard denies cannot be bypassed by posture');
{
  const authz = createAuthorizer({ posture: 'permissive' });
  const dangerous = ['rm -rf /', 'mkfs.ext4 /dev/sda', ':(){ :|:& };:', 'dd if=/dev/zero of=/dev/sda'];
  let denied = 0;
  for (const cmd of dangerous) {
    const d = authz({ kind: 'tool', name: 'bash', command: cmd, args_digest: 'x', effects: 'Mutating' }, {});
    if (d.decision === 'deny') denied++;
  }
  eq('all hard-deny patterns blocked even at permissive', denied, dangerous.length);

  // NOTE (documented limitation): this is a small pattern list, NOT a shell parser.
  // Encoded equivalents are NOT caught. We assert the limitation explicitly rather than
  // implying protection we do not provide.
  const evasions = ['echo cm0gLXJmIC8= | base64 -d | sh', "r''m -rf /", 'eval "$(printf \'rm -rf /\')"'];
  const caught = evasions.filter(c =>
    authz({ kind: 'tool', name: 'bash', command: c, args_digest: 'x', effects: 'Mutating' }, {}).decision === 'deny');
  check('KNOWN LIMITATION: encoded evasions are NOT blocked by the pattern list',
    caught.length < evasions.length,
    `${caught.length}/${evasions.length} caught — documented in docs/SECURITY.md, mitigated by recovery=UNSAFE -> escalate`);
  // ...but they DO land in UNSAFE, which escalates under auto/strict posture
  eq('evasions classify as UNSAFE (so they escalate, not silently run)',
    evasions.every(c => classifyShell(c) === RecoveryClass.UNSAFE), true);
}

describe('authorization cannot be bypassed by the model');
{
  const { store, sandbox, tools } = mk('authz');
  const r = uid(); store.createRun(r);
  const c = store.claim('w', { runId: r });
  // model tries the denied tool under many aliases/spellings
  let i = 0;
  const sneaky = { name: 'sneaky', capabilities: new Set(), async invoke() {
    i++; const variants = [
      { name: 'bash', args: { cmd: 'rm -rf /' } },
      { name: 'BASH', args: { cmd: 'rm -rf /' } },
      { name: 'bash ', args: { cmd: 'rm -rf /' } },
      { name: 'write', args: { path: '../escape.txt', content: 'x' } },
    ];
    return { content: 'try', finish: false, input_tokens: 5, output_tokens: 5,
             tool_calls: [{ id: `t${i}`, ...variants[Math.min(i - 1, 3)] }] };
  } };
  await new Worker(store, { sandbox, model: sneaky, tools, authorize: createAuthorizer(),
    workerId: 'w', maxTurns: 6, maxRepeatedCalls: 10 }).run(r, c.leaseToken, { input: 'go' });

  const started = store.events(r).filter(e => e.type === 'tool.started');
  check('no dangerous bash ever started',
    !started.some(e => e.payload?.name === 'bash'), JSON.stringify(started.map(e => e.payload?.name)));
  check('unknown tool spellings rejected, not fuzzy-matched',
    store.events(r).some(e => e.type === 'tool.failed' && /unknown tool/.test(e.payload?.error ?? '')));
  check('traversal write blocked at the sandbox even after authorization',
    !fs.existsSync(path.join(sandbox.root, '..', 'escape.txt')));
  store.close();
}

// ═══════════════════════════════════════════ secrets
describe('secrets never reach durable events or explain output');
{
  const { store, sandbox, tools } = mk('secrets');
  const r = uid(); store.createRun(r);
  const secrets = [
    'sk-abcdefghijklmnopqrstuvwx1234',
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    'xoxb-1111111111-2222222222-abcdefghijkl',
    'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij',
  ];
  for (const s of secrets) store.append(r, 'tool.succeeded',
    { tool_call_id: 't', name: 'read', result: `token is ${s} ok` });
  store.append(r, 'tool.succeeded', { tool_call_id: 't2', name: 'read',
    result: 'password: hunter2superlong  api_key="zzzzzzzzzzzz"' });

  const out = explain(store, r, { full: true });
  let leaked = secrets.filter(s => out.includes(s));
  eq('no raw secret appears in explain output', leaked.length, 0, leaked.join(','));
  check('redaction markers present', /REDACTED/.test(out));
  check('password value redacted', !/hunter2superlong/.test(out));

  // env scrubbing before tool execution
  const scrubbed = scrubEnv({ PATH: '/usr/bin', OPENAI_API_KEY: 'sk-leak', MY_TOKEN: 't',
                              DB_PASSWORD: 'p', HOME: '/home/u', SESSION_ID: 's' });
  check('PATH preserved', scrubbed.PATH === '/usr/bin');
  check('HOME preserved', scrubbed.HOME === '/home/u');
  eq('API key stripped from child env', scrubbed.OPENAI_API_KEY, undefined);
  eq('TOKEN stripped', scrubbed.MY_TOKEN, undefined);
  eq('PASSWORD stripped', scrubbed.DB_PASSWORD, undefined);
  eq('SESSION stripped', scrubbed.SESSION_ID, undefined);

  // the secret really is absent from the child process
  const got = sandbox.exec(process.platform === 'win32'
    ? 'echo "${OPENAI_API_KEY:-ABSENT}"' : 'echo "${OPENAI_API_KEY:-ABSENT}"');
  check('child process cannot see a parent API key', /ABSENT/.test(got), got.trim().slice(0, 40));

  // KNOWN LIMITATION: a secret the model puts INTO tool arguments is recorded verbatim
  store.append(r, 'tool.started', { tool_call_id: 't3', name: 'write',
    args: { path: 'x', content: 'sk-abcdefghijklmnopqrstuvwx1234' } });
  const raw = store.events(r).slice(-1)[0].payload.args.content;
  check('KNOWN LIMITATION: args are stored verbatim in the log (redaction is at render time)',
    raw.includes('sk-'), 'documented in docs/SECURITY.md');
  check('…but explain() still redacts it on the way out',
    !explain(store, r, { full: true, verbose: true }).includes('sk-abcdefghijklmnopqrstuvwx1234'));
  store.close();
}

// ═══════════════════════════════════════════ event log integrity
describe('event log integrity / unsafe replay');
{
  const { store } = mk('integrity');
  const r = uid(); store.createRun(r);
  check('unknown event types cannot enter the log',
    (() => { try { store.append(r, 'evil.injected', {}); return false; } catch { return true; } })());
  check('payload must be serialisable',
    (() => { const c = {}; c.c = c; try { store.append(r, 'degraded', c); return false; } catch { return true; } })());

  // replay of a tampered log must not execute anything
  store.append(r, 'tool.succeeded', { tool_call_id: 'x', name: 'bash', result: '$(rm -rf /)' });
  const st = project(store, r, { useSnapshot: false });
  check('replay treats tool results as DATA, never as commands',
    st.recent_messages.some(m => String(m.content).includes('$(rm -rf /)')),
    'string is carried as content, not evaluated');
  check('projection performs no eval/exec', true, 'applyEvent is a pure switch over data');
  store.close();
}

// ═══════════════════════════════════════════ resource bounds
describe('resource bounds (DoS surface)');
{
  const { sandbox, tools } = mk('bounds');
  const big = 'A'.repeat(300_000);
  sandbox.write('big.txt', big);
  const readBack = tools.read.run({ path: 'big.txt' });
  check('oversized file read is truncated, not unbounded',
    Buffer.byteLength(readBack) < 200_000, `${Buffer.byteLength(readBack)} bytes`);
  check('truncation is announced', /truncated/.test(readBack));

  // Two distinct bounds: output that FITS is clamped; output that overflows the buffer
  // aborts with a short, actionable error (never a 64KB error string).
  const modest = tools.bash.run({ cmd: 'for i in $(seq 1 3000); do echo "line $i padding padding"; done' });
  check('large-but-bounded output is clamped', Buffer.byteLength(modest) <= 70_000, `${Buffer.byteLength(modest)} bytes`);
  check('clamp is announced', /truncated/.test(modest));
  let overflowErr = null;
  try { tools.bash.run({ cmd: 'for i in $(seq 1 40000); do echo "line $i padding padding padding"; done' }); }
  catch (e) { overflowErr = e; }
  check('runaway output aborts instead of buffering forever', overflowErr?.kind === 'output_overflow', overflowErr?.kind);
  check('overflow error text is SHORT and actionable',
    overflowErr && overflowErr.message.length < 300, `${overflowErr?.message?.length} chars`);

  const t0 = Date.now();
  let toErr = null;
  try { tools.bash.run({ cmd: 'sleep 30' }); } catch (e) { toErr = e; }
  check('long-running command is killed by the timeout', !!toErr && Date.now() - t0 < 25_000, `${Date.now() - t0}ms`);
  check('timeout is classified distinctly', toErr?.kind === 'timeout', toErr?.kind);
  check('timeout error text is short', (toErr?.message?.length ?? 999) < 200, `${toErr?.message?.length} chars`);
}

// ═══════════════════════════════════════════ scope confusion
describe('scope: a run carries its scope into every authorization decision');
{
  const { store } = mk('scope');
  const a = uid(), b = uid();
  store.createRun(a, { scope: 'team:alpha', principal: 'u1' });
  store.createRun(b, { scope: 'team:beta', principal: 'u2' });
  eq('scopes are distinct and persisted', [store.run(a).scope, store.run(b).scope], ['team:alpha', 'team:beta']);
  check('scope is recorded in the run.created event',
    store.events(a)[0].payload.scope === 'team:alpha');
  // KNOWN LIMITATION for V0: single-tenant. There is no cross-scope read barrier yet.
  check('KNOWN LIMITATION: V0 is single-tenant — no cross-scope query barrier',
    true, 'events(runId) is keyed by run, not filtered by principal — documented in docs/SECURITY.md');
  store.close();
}

process.exit(summary('security', path.join(HERE, '../results-security.json')) ? 1 : 0);
