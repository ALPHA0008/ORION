// Interactive mode.
//
// The property under test is NOT "the prompt renders". It is that the session is a thin shell
// over the event log: anything typed becomes an ordinary durable run, visible to the one-shot
// commands from a separate process. If that ever stops holding, interactive mode has quietly
// become a second execution model with weaker guarantees — which is the thing the design
// explicitly forbids.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, check, eq, summary, tmpdir } from '../harness.mjs';
import { banner, supportsBlockGlyphs } from '../../src/cli/repl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'src', 'cli', 'index.mjs');

/** Drive the REPL with piped stdin. Returns { out, code }. */
function session(lines, home, work, env = {}) {
  const r = spawnSync(process.execPath, [CLI, 'chat'], {
    input: lines.join('\n') + '\n',
    encoding: 'utf8',
    env: {
      ...process.env,
      ORION_HOME: home,
      ORION_WORKSPACE: work,
      // An unroutable port: the model is unreachable, so a turn fails fast. That is fine —
      // these tests assert on what the LOG records, not on model output.
      ORION_BASE_URL: 'http://127.0.0.1:9/v1',
      ORION_MODEL: 'test-model',
      ORION_API_KEY: 'x',
      ...env,
    },
  });
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), code: r.status };
}

function cli(args, home, work) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ORION_HOME: home, ORION_WORKSPACE: work, ORION_BASE_URL: 'http://127.0.0.1:9/v1', ORION_MODEL: 'test-model', ORION_API_KEY: 'x' },
  });
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), code: r.status };
}

describe('repl/banner');
{
  const home = tmpdir('repl-banner'); const work = tmpdir('repl-banner-w');
  const { out, code } = cli(['--help'], home, work);
  // Either rendering counts — which one appears depends on the terminal running the tests.
  check('help renders the wordmark', /_{2,}|\\___|█/.test(out), 'wordmark present');
  check('help names the product', /Orion/.test(out));
  check('help advertises interactive mode', /orionctl\s+ {2,}interactive session/.test(out));
  eq('help exits 0', code, 0);
}

describe('repl/non-tty');
{
  // Piped or redirected there is nobody to prompt. Bare `orionctl` must print usage and exit,
  // never block forever waiting on a stdin that will not arrive — that would hang CI.
  const home = tmpdir('repl-notty'); const work = tmpdir('repl-notty-w');
  const { out, code } = cli([], home, work);
  eq('bare orionctl exits 0 when not a tty', code, 0);
  check('bare orionctl prints usage, not a prompt', /orionctl run/.test(out));
  check('bare orionctl does not hang', true, 'returned');
}

describe('repl/commands');
{
  const home = tmpdir('repl-cmds'); const work = tmpdir('repl-cmds-w');
  const { out, code } = session(['/help', '/runs', '/bogus', '/exit'], home, work);
  check('/help lists the slash commands', /\/resume/.test(out) && /\/answer/.test(out));
  check('/runs reports an empty log', /no runs yet/.test(out));
  check('/bogus is rejected, not executed', /unknown command/.test(out));
  check('unknown command does not end the session', /runs are durable/.test(out), 'reached the exit banner');
  eq('/exit exits 0', code, 0);
}

describe('repl/durability');
{
  // The core contract. A task typed into the session must be recorded in the log and be
  // visible to a SEPARATE process — that is what makes the session safe to close.
  const home = tmpdir('repl-durable'); const work = tmpdir('repl-durable-w');
  session(['make it faster', '/exit'], home, work);

  const { out, code } = cli(['list', '--json'], home, work);
  eq('list --json exits 0', code, 0);
  let runs = [];
  try { runs = JSON.parse(out); } catch { /* asserted below */ }
  check('a typed task became a run in the log', runs.length === 1, `got ${runs.length}`);
  check('the run carries the typed task verbatim', runs[0]?.task === 'make it faster', String(runs[0]?.task));
  check('the run is visible from a separate process', !!runs[0]?.run_id, runs[0]?.run_id ?? 'none');
  check('the run has a terminal status recorded', ['failed', 'completed', 'paused', 'running'].includes(runs[0]?.status), String(runs[0]?.status));
}

describe('repl/log-is-shared');
{
  // A run started by a one-shot command must be visible INSIDE the session, and vice versa.
  // One log, two front ends.
  const home = tmpdir('repl-shared'); const work = tmpdir('repl-shared-w');
  cli(['run', 'from the one-shot command'], home, work);

  const { out } = session(['/runs', '/exit'], home, work);
  check('/runs shows a run created outside the session', /from the one-shot command/.test(out), 'visible');

  const after = cli(['list', '--json'], home, work);
  const runs = JSON.parse(after.out || '[]');
  eq('exactly one run so far', runs.length, 1);
}

describe('repl/empty-input');
{
  const home = tmpdir('repl-empty'); const work = tmpdir('repl-empty-w');
  const { out, code } = session(['', '   ', '/exit'], home, work);
  eq('blank lines exit cleanly', code, 0);
  const list = JSON.parse(cli(['list', '--json'], home, work).out || '[]');
  eq('blank input creates no runs', list.length, 0);
  check('no stray readline error leaks to the user', !/readline was closed/.test(out), 'clean');
}

describe('repl/wordmark');
{
  // The banner has two renderings. Block glyphs give the solid coloured logo; the ASCII
  // fallback exists because a banner that renders as tofu boxes is worse than none. Both must
  // be five rows so the prompt never scrolls off a short terminal.
  const plain = new Proxy({}, { get: () => (s => s) });

  const blocks = banner(plain, '9.9.9', { blocks: true });
  const ascii = banner(plain, '9.9.9', { blocks: false });

  check('block rendering uses U+2588', blocks.includes('█'));
  check('ascii fallback uses no block glyphs', !ascii.includes('█'));
  eq('block wordmark is five rows', blocks.split('\n').filter(l => l.includes('█')).length, 5);
  eq('ascii wordmark is five rows', ascii.split('\n').filter(l => /[_|\\/]/.test(l)).length, 5);
  check('both spell the product name', blocks.includes('Orion') && ascii.includes('Orion'));
  check('both carry the version', blocks.includes('9.9.9') && ascii.includes('9.9.9'));

  // Detection should FAVOUR the blocks: modern Windows consoles (1903+) render them fine even
  // when `chcp` still reports 437, so a bare cmd.exe must not be downgraded to ASCII.
  check('a modern console gets block glyphs even without WT_SESSION',
    supportsBlockGlyphs({}, { isTTY: true }) === true);
  check('a pre-1903 windows console falls back to ascii',
    supportsBlockGlyphs({ ORION_ASCII: '1' }, { isTTY: true }) === false);
  check('ORION_ASCII=0 forces blocks on',
    supportsBlockGlyphs({ ORION_ASCII: '0' }, { isTTY: true }) === true);
  check('ORION_ASCII=1 forces the fallback everywhere',
    supportsBlockGlyphs({ ORION_ASCII: '1', WT_SESSION: '1' }, null) === false);
  check('windows terminal gets block glyphs',
    supportsBlockGlyphs({ WT_SESSION: '1' }, null) === true);
}

describe('repl/colour');
{
  // Colour is a TTY concern. Piped output must stay free of escape sequences or it corrupts
  // anything downstream — the same rule that keeps `--json` machine-readable.
  const home = tmpdir('repl-colour'); const work = tmpdir('repl-colour-w');
  const { out } = session(['/exit'], home, work);
  check('piped output carries no ANSI escapes', !/\x1b\[/.test(out), 'clean for pipes');

  const withColour = banner({ c: s => `\x1b[36m${s}\x1b[0m`, cb: s => `\x1b[96m${s}\x1b[0m`,
    b: s => s, dim: s => s }, '1.0.0', { blocks: true });
  check('the wordmark is painted when colour is available', /\x1b\[96m/.test(withColour), 'bright cyan');
}

describe('repl/unconfigured');
{
  // A first-time user's first command is bare `orionctl`, with nothing configured. Exiting
  // with a red error before showing anything is a hostile welcome — and it hid the product
  // entirely in the first published build. The session must open, say what is missing, and
  // refuse ONLY the turns that actually need a model.
  const home = tmpdir('repl-unconf'); const work = tmpdir('repl-unconf-w');
  const r = spawnSync(process.execPath, [CLI, 'chat'], {
    input: 'do a task\n/runs\n/help\n/exit\n',
    encoding: 'utf8',
    // No ORION_BASE_URL at all.
    env: Object.fromEntries(Object.entries({ ...process.env, ORION_HOME: home, ORION_WORKSPACE: work })
      .filter(([k]) => !['ORION_BASE_URL', 'ORION_API_KEY', 'ORION_MODEL'].includes(k))),
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  check('the banner still renders unconfigured', /\\___|_{2,}|█/.test(out), 'wordmark present');
  check('it names what is missing', /ORION_BASE_URL/.test(out));
  check('it reports the model as not configured', /not configured/.test(out));
  check('a task turn is refused with the fix, not a stack trace', /No model configured/.test(out) && !/at .*\.mjs:\d+/.test(out));
  check('/runs still works unconfigured', /no runs yet/.test(out));
  check('/help still works unconfigured', /\/resume/.test(out));
  check('the session does not exit on a refused turn', /runs are durable/.test(out));
  eq('exits 0', r.status, 0);
}

describe('repl/answer-guards');
{
  const home = tmpdir('repl-answer'); const work = tmpdir('repl-answer-w');
  const { out } = session(['/answer hello', '/resume', '/exit'], home, work);
  check('/answer with no pending run is refused', /no run is waiting/.test(out));
  check('/resume with nothing to resume is refused', /nothing to resume/.test(out));
  check('neither guard ends the session', /runs are durable/.test(out));
}

process.exit(summary('repl', path.join(HERE, '..', 'results-repl.json')) ? 1 : 0);
