// Interactive mode — a thin conversational shell over the SAME primitives the one-shot
// commands use.
//
// The design constraint that matters: a REPL session must not become a second, weaker
// execution model. Everything typed here becomes an ordinary run in the event log, claimed
// and executed by an ordinary worker. Close the terminal mid-task and the run is still there,
// resumable by `orionctl resume` from any other shell. The session is a convenience over the
// log, never a replacement for it.
//
// Consequences of that choice, all deliberate:
//   - one message = one run. Sessions are not runs; they hold no state the log does not.
//   - `ask_user` is answered inline, then the SAME run resumes — the terminal is simply a
//     faster path to `orionctl answer` + `orionctl resume`.
//   - Ctrl+C aborts the turn, not the run. The run is durable; it stays claimable.

import readline from 'node:readline';
import os from 'node:os';

// Wordmark. Two renderings of the same five rows:
//
//   - block glyphs (U+2588 FULL BLOCK) for terminals that can draw them, which is what gives
//     the solid, coloured look;
//   - a pure-ASCII fallback for anything that cannot, because a banner that renders as a field
//     of `?` or tofu boxes is worse than no banner at all.
//
// Detection favours the blocks and falls back only where they would genuinely break: pre-1903
// Windows consoles, or an explicit ORION_ASCII=1.
const GLYPHS = {
  O: ['█████', '█   █', '█   █', '█   █', '█████'],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
};

const ASCII_FALLBACK = [
  '  ___  ____  ___ ___  _   _',
  ' / _ \\|  _ \\|_ _/ _ \\| \\ | |',
  '| | | | |_) || | | | |  \\| |',
  '| |_| |  _ < | | |_| | |\\  |',
  ' \\___/|_| \\_\\___\\___/|_| \\_|',
];

/**
 * True when stdout can be trusted to render U+2588 rather than tofu.
 *
 * The honest test is the stream's own encoding, not the terminal's brand. Windows 10 1903+
 * consoles — including plain cmd.exe and conhost — negotiate UTF-8 and render block glyphs
 * correctly, so keying off WT_SESSION alone needlessly downgrades most modern Windows users.
 * A raw codepage of 437 is not disqualifying: what matters is what Node writes with.
 */
export function supportsBlockGlyphs(env = process.env, stream = process.stdout) {
  if (env.ORION_ASCII === '1') return false;               // explicit opt-out
  if (env.ORION_ASCII === '0') return true;                // explicit opt-in
  if (process.platform !== 'win32') return true;           // modern *nix terminals are UTF-8

  // Terminals that are known-good regardless of what the encoding probe reports.
  if (env.WT_SESSION || env.WT_PROFILE_ID || env.TERM_PROGRAM || env.ConEmuANSI) return true;

  // Otherwise trust the console's declared output encoding. Node reports UTF-8 here on
  // Windows 10 1903+ even when `chcp` still says 437, which is precisely the case that the
  // brand check above gets wrong.
  const declared = String(stream?.getDefaultEncoding?.() ?? env.ORION_ENCODING ?? '').toLowerCase();
  if (declared.includes('utf')) return true;

  // Windows 10 1903 (build 18362) is where console UTF-8 became dependable. Below that, or
  // when the version cannot be read, prefer ASCII over risking tofu.
  const build = Number(String(os.release()).split('.')[2] ?? 0);
  return build >= 18362;
}

/**
 * The wordmark, coloured. Kept to five rows — a banner should never push the prompt off-screen.
 */
export function banner(C, version, opts = {}) {
  const blocks = opts.blocks ?? supportsBlockGlyphs();
  const rows = blocks
    ? Array.from({ length: 5 }, (_, r) => '  ' + [...'ORION'].map(ch => GLYPHS[ch][r]).join(' '))
    : ASCII_FALLBACK;
  // `cb` (bright cyan) when the caller provides it; plain cyan otherwise, so the ASCII fallback
  // and any minimal colour table still work.
  const paint = C.cb ?? C.c;
  return `${paint(rows.join('\n'))}\n\n  ${C.c(C.b('Orion'))} ${C.dim('v' + version)}  ${C.dim('— durable, replayable agent runs')}\n`;
}

/**
 * Run the interactive session.
 *
 * Everything it needs is injected rather than imported, so this module stays free of process
 * state and the CLI keeps a single source of truth for how a run is created and claimed.
 */
export async function repl({ store, C, version, workspace, model, posture, configured = true, runTask, answerAndResume, listRuns }) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: C.c('> '),
    historySize: 200,
  });

  let busy = false;      // a turn is executing; input is ignored until it settles
  let lastRunId = null;  // for `/resume` and for reporting where a paused run went
  let closing = false;

  const say = (s = '') => console.log(s);

  say(banner(C, version));
  say(`  ${C.c('/help')} ${C.dim('commands')}  ${C.dim('│')}  ${C.c('/runs')} ${C.dim('history')}  ${C.dim('│')}  ${C.c('/exit')} ${C.dim('quit')}`);
  say(`  ${C.dim('─'.repeat(46))}`);
  say('');
  say(`  ${C.dim('model:')} ${configured ? C.c(model) : C.y('not configured')}   ${C.dim('posture:')} ${C.c(posture)}`);
  say(`  ${C.dim('workspace:')} ${C.dim(workspace)}`);
  say('');
  if (!configured) {
    // A first run with no endpoint is the common case, not an error. Show the two lines that
    // fix it rather than exiting — the session is still useful for /runs, /help and inspection.
    say(`  ${C.y('No model endpoint set.')} ${C.dim('Tasks need one; everything else works.')}`);
    say(`    ${C.dim('set')} ${C.c('ORION_BASE_URL')} ${C.dim('=')} https://api.openai.com/v1   ${C.dim('(or your local provider)')}`);
    say(`    ${C.dim('set')} ${C.c('ORION_API_KEY')}  ${C.dim('=')} sk-...`);
    say('');
  }
  say(`  ${C.dim('enter')} ${C.dim('send')}   ${C.dim('/')} ${C.dim('commands')}   ${C.dim('ctrl+c')} ${C.dim('exit')}`);
  say('');

  // Ctrl+C aborts the current turn if one is running, otherwise exits. It never kills the run:
  // the run lives in the log and remains claimable, which is the whole point of the runtime.
  rl.on('SIGINT', () => {
    if (busy) {
      say('');
      say(C.y('  interrupted — the run is durable and stays claimable'));
      if (lastRunId) say(C.dim(`  resume with:  orionctl resume ${lastRunId.replace(/^run_/, '#')}`));
      say('');
      return; // the in-flight turn settles on its own; we simply stop waiting on it
    }
    closing = true;
    rl.close();
  });

  const help = () => {
    say('');
    say(`  ${C.b('commands')}`);
    say(`    ${C.c('/help')}              this list`);
    say(`    ${C.c('/runs')}              recent runs in this workspace`);
    say(`    ${C.c('/resume')} [<run>]    continue the last run, or a named one`);
    say(`    ${C.c('/answer')} <text>     answer a run that is waiting on you`);
    say(`    ${C.c('/clear')}             clear the screen`);
    say(`    ${C.c('/exit')}              quit (runs survive)`);
    say('');
    say(`  ${C.dim('Anything else is treated as a task. Each task becomes a durable run:')}`);
    say(`  ${C.dim('close this terminal and `orionctl resume` picks it up from another shell.')}`);
    say('');
  };

  // A turn: hand the text to the caller's runTask, report where it landed. All durability
  // guarantees come from runTask itself — this only renders the outcome.
  const turn = async (text) => {
    busy = true;
    try {
      const res = await runTask(text);
      lastRunId = res.runId ?? lastRunId;
      if (res.status === 'awaiting_human' || res.status === 'paused') {
        say(C.y(`  paused — ${res.reason ?? 'waiting on you'}`));
        if (res.question) say(`  ${C.y('🙋')} ${res.question}`);
        say(C.dim(`  answer inline:  /answer <your reply>`));
      }
    } catch (err) {
      // A failed turn must not end the session — the log already recorded whatever happened.
      say(C.r(`  ${err?.message ?? err}`));
      if (err?.hint) say(C.dim(`  ${err.hint}`));
      else if (lastRunId) say(C.dim(`  inspect with:  orionctl explain ${lastRunId.replace(/^run_/, '#')}`));
    } finally {
      busy = false;
    }
  };

  const prompt = () => { if (!closing) { try { rl.prompt(); } catch { /* stream gone */ } } };

  prompt();

  for await (const line of rl) {
    const text = line.trim();
    if (!text) { prompt(); continue; }

    if (text === '/exit' || text === '/quit') { closing = true; break; }
    if (text === '/help' || text === '/?') { help(); prompt(); continue; }
    if (text === '/clear') { console.clear(); say(banner(C, version)); prompt(); continue; }

    if (text === '/runs') {
      const runs = listRuns();
      if (!runs.length) say(C.dim('  no runs yet'));
      for (const r of runs) {
        // `store.listRuns` returns `id`; only the CLI's --json projection renames it to
        // `run_id`. Accept either so this survives a change on that seam.
        const id = String(r.id ?? r.run_id ?? '');
        say(`  ${C.b(id.replace(/^run_/, '#'))}  ${String(r.status).padEnd(15)} ${C.dim(String(r.task ?? '').slice(0, 46))}`);
      }
      say('');
      prompt(); continue;
    }

    if (text.startsWith('/resume')) {
      const id = text.slice('/resume'.length).trim() || lastRunId;
      if (!id) { say(C.y('  nothing to resume')); prompt(); continue; }
      await turn({ resume: id });
      prompt(); continue;
    }

    if (text.startsWith('/answer')) {
      const reply = text.slice('/answer'.length).trim();
      if (!reply) { say(C.y('  usage: /answer <your reply>')); prompt(); continue; }
      if (!lastRunId) { say(C.y('  no run is waiting on you')); prompt(); continue; }
      busy = true;
      try { await answerAndResume(lastRunId, reply); }
      catch (err) { say(C.r(`  ${err?.message ?? err}`)); }
      finally { busy = false; }
      prompt(); continue;
    }

    if (text.startsWith('/')) {
      say(C.y(`  unknown command: ${text.split(' ')[0]}   try /help`));
      prompt(); continue;
    }

    await turn(text);
    prompt();
  }

  try { rl.close(); } catch { /* already closed by SIGINT or EOF */ }
  if (closing) {
    say('');
    say(C.dim('  runs are durable — `orionctl list` shows them, `orionctl resume` continues them'));
  }
}
