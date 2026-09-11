// W8 — search: glob, regex grep, and the bounded walk (X6).
//
// The measured problem this closes: file-visibility failures dominate run failures. An agent that
// can only `String.includes` a path it already knows cannot find a symbol in a repository it did
// not write, so it pages through files and dies on no_progress.
//
// Two properties are load-bearing throughout and are asserted rather than assumed:
//
//   1. BACKWARD COMPATIBILITY. `grep` has a call shape models have learned. Regex is opt-in, and
//      the literal default must behave exactly as it did — a literal search for `a.b` must not
//      quietly become a regex that also matches `axb`.
//   2. THE HONESTY CONTRACT. `[INCOMPLETE RESULT]` is the difference between "there is nothing
//      here" and "I stopped looking". Every cap, timeout and unreadable path must say so.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalSandbox, globToRegExp, GREP_MAX_HITS, GLOB_MAX_RESULTS,
         SEARCH_TIME_MS, SEARCH_DIR_MS, SEARCH_MAX_FILES, SEARCH_MAX_ENTRIES,
         SEARCH_MAX_DEPTH } from '../../src/sandbox/local/index.mjs';
import { makeTools, mutatingTools } from '../../src/agent/tools/index.mjs';
import { describe, check, eq, summary } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `w8s-${tag}-`));
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

/** A small tree that looks like a project rather than a fixture. */
function tree(tag) {
  const d = mk(tag);
  write(path.join(d, 'src', 'index.mjs'), 'export const VERSION = 3;\nexport function main() {}\n');
  write(path.join(d, 'src', 'util', 'helpers.mjs'), 'export function helper() { return 1; }\n');
  write(path.join(d, 'src', 'util', 'deep', 'nested.mjs'), 'const VERSION = 4;\n');
  write(path.join(d, 'test', 'index.test.mjs'), 'import { main } from "../src/index.mjs";\n');
  write(path.join(d, 'README.md'), '# Project\n\nVERSION is 3.\n');
  write(path.join(d, 'notes.txt'), 'a.b matches literally\naxb should not\n');
  // Excluded by name at any depth — the runtime's own state and dependency trees.
  write(path.join(d, 'node_modules', 'dep', 'index.mjs'), 'const VERSION = 999;\n');
  write(path.join(d, '.orion', 'orion.db'), 'VERSION binary junk\n');
  return d;
}

// ═══════════════════════════════════════════ glob patterns
describe('w8/glob: the pattern language is a path expression, not a regex');
{
  const m = (pat, p) => globToRegExp(pat).test(p);
  eq('* does not cross a separator', m('src/*.mjs', 'src/util/a.mjs'), false);
  eq('...but matches within one segment', m('src/*.mjs', 'src/a.mjs'), true);
  eq('** crosses separators', m('src/**/*.mjs', 'src/util/deep/a.mjs'), true);
  eq('**/ also matches zero directories', m('src/**/*.mjs', 'src/a.mjs'), true);
  eq('a leading **/ matches at the root', m('**/*.mjs', 'a.mjs'), true);
  eq('? is exactly one non-separator', m('a?c.txt', 'abc.txt'), true);
  eq('...and not a separator', m('a?c.txt', 'a/c.txt'), false);
  eq('[] classes work', m('v[0-9].mjs', 'v3.mjs'), true);
  eq('{} alternation works', m('*.{mjs,js}', 'x.js'), true);
  eq('...both branches', m('*.{mjs,js}', 'x.mjs'), true);

  // The trap a naive implementation falls into: a dot in a PATH is a literal dot. Treating it as
  // a regex metacharacter would make `*.mjs` match `xxmjs`, which is silent over-matching.
  eq('a dot is literal, not "any character"', m('*.mjs', 'axmjs'), false);
  eq('a plus is literal', m('a+b.txt', 'a+b.txt'), true);
  eq('...and not a quantifier', m('a+b.txt', 'aab.txt'), false);
  eq('parentheses are literal', m('f(x).mjs', 'f(x).mjs'), true);
  eq('windows separators are normalised', m('src/*.mjs', 'src\\a.mjs'), true);
}

// ═══════════════════════════════════════════ glob, live
describe('w8/glob: finds files across a tree without reading them');
{
  const d = tree('glob');
  const sb = new LocalSandbox(d);

  const all = sb.glob('**/*.mjs').split('\n');
  check('finds nested files at any depth', all.includes('src/util/deep/nested.mjs'), all.join(','));
  check('...and shallow ones', all.includes('src/index.mjs'));
  check('...and test files', all.includes('test/index.test.mjs'));

  // The exclusions that already governed grep must govern glob, or the agent gets handed its own
  // event log and a dependency tree as if they were source.
  check('node_modules is excluded', !all.some(p => p.startsWith('node_modules')), all.join(','));
  check('.orion (the runtime\'s own state) is excluded', !all.some(p => p.includes('.orion')));

  eq('a scoped pattern only matches its scope',
    sb.glob('src/util/*.mjs').trim(), 'src/util/helpers.mjs');
  check('a pattern with no matches says so', sb.glob('**/*.nothing').startsWith('(no matches)'));

  // Results are sorted, so two identical searches produce identical bytes — a prerequisite for
  // the request digest being stable across a replay.
  eq('results are deterministically ordered', sb.glob('**/*.mjs'), sb.glob('**/*.mjs'));

  // Searching under a subdirectory matches RELATIVE to that root, or a scoped search silently
  // finds nothing.
  const scoped = sb.glob('**/*.mjs', { path: 'src' }).split('\n');
  check('a scoped search matches relative to its root', scoped.includes('src/util/helpers.mjs'),
    scoped.join(','));
  check('...and excludes what is outside it', !scoped.some(p => p.startsWith('test/')));

  check('directories are excluded by default', !sb.glob('**/util').includes('src/util/'));
  check('...but available on request',
    sb.glob('**/util', { filesOnly: false }).includes('src/util/'));

  let threw = null;
  try { sb.glob(''); } catch (e) { threw = e; }
  eq('an empty pattern is a clear failure', threw?.kind, 'bad_pattern');
}

// ═══════════════════════════════════════════ grep: backward compatibility
describe('w8/grep: the literal default is unchanged');
{
  const d = tree('literal');
  const sb = new LocalSandbox(d);

  const out = sb.grep('VERSION');
  check('finds matches in the old call shape', out.includes('src/index.mjs:1:'), out);
  check('...with the path:line: format preserved', /^[^\n]*\.mjs:\d+: /m.test(out));
  check('node_modules is still excluded', !out.includes('node_modules'));

  // THE regression that matters. A literal `a.b` must not match `axb`; if regex were on by
  // default, or auto-detected, it would — and every existing caller would silently over-match.
  const lit = sb.grep('a.b', 'notes.txt');
  check('a literal dot matches only a dot', lit.includes('a.b matches literally'), lit);
  check('...and NOT any character', !lit.includes('axb should not'), lit);

  eq('a search with no matches says so', sb.grep('zzz-not-present').trim(), '(no matches)');

  // A file path (not a directory) is searched directly — the W1 regression that reported a file
  // as an unreadable *directory*.
  check('a file path is searched directly', sb.grep('helper', 'src/util/helpers.mjs').includes('helpers.mjs:1:'));
}

describe('w8/grep: regex is opt-in and reports its own failures');
{
  const d = tree('regex');
  const sb = new LocalSandbox(d);

  const rx = sb.grep('VERSION\\s*=\\s*\\d+', '.', { regex: true });
  check('a regex matches what a literal could not', rx.includes('src/index.mjs:1:'), rx);
  check('...across files', rx.includes('src/util/deep/nested.mjs:1:'), rx);

  const anchored = sb.grep('^export const', '.', { regex: true });
  check('anchors work', anchored.includes('src/index.mjs:1:'), anchored);
  check('...and exclude non-matching lines', !anchored.includes('index.test.mjs'), anchored);

  eq('a literal dot as a REGEX matches any character',
    sb.grep('a.b', 'notes.txt', { regex: true }).includes('axb should not'), true);

  // A malformed pattern is a CALLER error and must say so. "(no matches)" would be
  // indistinguishable from a correct search that found nothing — the worst possible failure for a
  // tool an agent uses to decide what exists.
  let threw = null;
  try { sb.grep('([unclosed', '.', { regex: true }); } catch (e) { threw = e; }
  check('a malformed regex throws rather than returning empty', threw !== null);
  eq('...with a named kind', threw?.kind, 'bad_pattern');
  check('...naming the problem', /invalid regular expression/i.test(String(threw?.message)));

  eq('case-insensitive literal', sb.grep('version', '.', { ignoreCase: true }).includes('src/index.mjs:1:'), true);
  eq('case-sensitive by default', sb.grep('version').trim(), '(no matches)');

  // Restricting by glob is what makes "find this symbol in the source but not the tests" one call.
  const scoped = sb.grep('main', '.', { glob: 'src/**/*.mjs' });
  check('a glob filter restricts which files are searched', scoped.includes('src/index.mjs'), scoped);
  check('...and excludes the rest', !scoped.includes('test/'), scoped);
}

// ═══════════════════════════════════════════ X6 — bounded walks
describe('w8/X6: every walk is bounded, and says when it stopped');
{
  // The budgets are the contract, so they are asserted rather than left implicit.
  eq('total time budget', SEARCH_TIME_MS, 5_000);
  eq('per-directory budget', SEARCH_DIR_MS, 750);
  eq('file ceiling', SEARCH_MAX_FILES, 20_000);
  eq('entry ceiling', SEARCH_MAX_ENTRIES, 100_000);
  eq('depth ceiling', SEARCH_MAX_DEPTH, 24);
  eq('grep hit cap', GREP_MAX_HITS, 500);
  eq('glob result cap', GLOB_MAX_RESULTS, 1_000);

  const d = mk('bounded');
  // 60 files, each with 40 matching lines: 2,400 potential hits against a cap of 500.
  for (let i = 0; i < 60; i++) {
    write(path.join(d, `f${i}.txt`),
      Array.from({ length: 40 }, (_, j) => `NEEDLE line ${j}`).join('\n'));
  }
  const sb = new LocalSandbox(d);

  const capped = sb.grep('NEEDLE');
  const lines = capped.split('\n').filter(l => /^f\d+\.txt:/.test(l));
  check('the hit cap holds', lines.length <= GREP_MAX_HITS, `${lines.length} hits`);
  check('and TRUNCATION IS ANNOUNCED', capped.includes('[INCOMPLETE RESULT]'), capped.slice(-160));
  check('...naming the cap', /TRUNCATED at 500 matches/.test(capped), capped.slice(-160));
  check('...and suggesting what to do', /narrow the pattern or path/.test(capped));

  const globCapped = sb.glob('*.txt', { maxResults: 10 });
  eq('the glob cap holds', globCapped.split('\n').filter(l => /^f\d+\.txt$/.test(l)).length, 10);
  check('and glob truncation is announced too', globCapped.includes('[INCOMPLETE RESULT]'));

  // A zero time budget must terminate rather than run to completion — the property that makes a
  // runaway search survivable.
  const noTime = sb.grep('NEEDLE', '.', { timeMs: 0 });
  check('a spent time budget stops the walk', noTime.includes('[INCOMPLETE RESULT]'), noTime.slice(-140));
  check('...and says it was time', /search STOPPED after 0ms/.test(noTime), noTime.slice(-140));
  const noTimeGlob = sb.glob('*.txt', { timeMs: 0 });
  check('glob honours the same budget', noTimeGlob.includes('[INCOMPLETE RESULT]'));
}

describe('w8/X6: a deep tree cannot recurse forever');
{
  const d = mk('deep');
  // 40 levels — well past the depth ceiling of 24.
  let p = d;
  for (let i = 0; i < 40; i++) { p = path.join(p, `l${i}`); }
  write(path.join(p, 'buried.txt'), 'NEEDLE at the bottom\n');
  const sb = new LocalSandbox(d);

  const out = sb.grep('NEEDLE');
  check('the depth ceiling stopped the walk', out.includes('[INCOMPLETE RESULT]'), out.slice(-140));
  check('...and said so', /STOPPED at depth 24/.test(out), out.slice(-140));
  check('the file past the ceiling was NOT silently reported as absent',
    out.includes('[INCOMPLETE RESULT]'),
    'the point is that "(no matches)" alone would be a lie');
}

// ═══════════════════════════════════════════ containment
describe('w8/search: the workspace boundary still holds');
{
  const root = mk('contain');
  const outside = path.join(root, 'SECRET.txt');
  fs.writeFileSync(outside, 'host-secret\n');
  const sb = new LocalSandbox(path.join(root, 'work'));
  write(path.join(root, 'work', 'inside.txt'), 'ordinary\n');

  // Glob and grep both route every path through `_abs`, so traversal is refused the same way it
  // is for read/write — a search that could escape would be a containment hole with a new name.
  //
  // The assertion is about CONTENT, not about the path name. An earlier version of this test
  // checked that the string "SECRET" was absent from the output and failed — because the refusal
  // NAMES the path it declined to read, which is the honesty contract working, not a leak.
  for (const p of ['../SECRET.txt', '../../SECRET.txt']) {
    const g = sb.glob('*.txt', { path: p });
    check(`glob refuses to escape via ${p}`, !g.includes('host-secret'), g.slice(0, 90));
    check(`...and says it refused, rather than returning a clean empty`,
      g.includes('[INCOMPLETE RESULT]'), g.slice(0, 120));
  }
  const escaped = sb.grep('host-secret', '../SECRET.txt');
  check('grep cannot read outside the workspace', !escaped.includes('host-secret'), escaped.slice(0, 120));
  check('...and reports the path as unreadable rather than pretending it is empty',
    escaped.includes('[INCOMPLETE RESULT]'), escaped.slice(0, 160));
}

// ═══════════════════════════════════════════ the tools
describe('w8/tools: glob and grep are declared like every other tool');
{
  const sb = new LocalSandbox(tree('tools'));
  const t = makeTools(sb);

  check('glob is offered', 'glob' in t);
  eq('...ReadOnly', t.glob.effects, 'ReadOnly');
  eq('...and safely re-runnable', t.glob.recovery().class, 'READ_ONLY');
  check('...with a model-visible schema', !!t.glob.schema?.properties?.pattern);

  // W5 T1/T2: capability metadata is declared once, on the tool, and derived everywhere.
  // Adding tools must not reintroduce a hand-maintained list.
  eq('the mutating set is still derived and unchanged',
    [...mutatingTools(t)].sort().join(','), 'bash,edit,write');

  check('grep advertises regex', /regex/i.test(t.grep.description));
  check('...and the schema accepts it', !!t.grep.schema.properties.regex);
  check('...and a glob filter', !!t.grep.schema.properties.glob);

  eq('the grep tool still defaults to literal',
    t.grep.run({ pattern: 'a.b', path: 'notes.txt' }).includes('axb'), false);
  eq('...and honours regex:true',
    t.grep.run({ pattern: 'a.b', path: 'notes.txt', regex: true }).includes('axb'), true);
  check('the glob tool returns paths',
    t.glob.run({ pattern: '**/*.mjs' }).includes('src/index.mjs'));
}

process.exit(summary('w8 search', path.join(HERE, '..', 'results-w8-search.json')) ? 1 : 0);
