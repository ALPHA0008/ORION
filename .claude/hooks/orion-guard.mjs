#!/usr/bin/env node
// ORION team guardrails — a Claude Code PreToolUse hook.
//
// The team's standing rules (.claude/orion/DOCTRINE.md §7) are enforced here rather than trusted
// to each agent's memory. Every rule below exists because the mistake it prevents was either made
// in this project or is one keystroke away:
//   - `git add -A` would stage the by-design churn in v0/tests/results-*.json and the transcripts
//     in conversations/ (which contain plaintext provider keys);
//   - commit / push / publish / destructive git are user decisions (PIPELINE §5), so they "ask";
//   - the event contract is additive-only and a change needs explicit approval, so it "asks";
//   - the team ledger is append-only, like the runtime's own event log.
//
// Decisions: "deny" blocks the call and tells the agent why; "ask" routes it to the user's
// permission prompt. Anything not matched passes through untouched.

import fs from 'node:fs';
import path from 'node:path';

const NEVER_COMMIT = [
  /(^|[\s/"'])v0\/tests\/results-[^\s"']*\.json/i,
  /(^|[\s/"'])results-[^\s/"']*\.json/i,
  /run\.db(-wal|-shm)?(\s|$|["'])/i,
  /(^|[\s/"'])conversations(\/|\s|$)/i,
  /wg-fixtures|wg-homes/i,
  /(^|[\s/"'])archify-out(\/|\s|$)/i,
  /v0\/eval\/results/i,
  /\.tgz(\s|$|["'])/i,
];

// Long-tailed patterns only, so docs that merely name a prefix (`sk-`, `gsk_`) do not trip them.
const SECRET_PATTERNS = [
  /sk-proj-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9]{32,}/,
  /\bgsk_[A-Za-z0-9]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/,
];

const PROTECTED_WRITE_PATHS = [
  { re: /(^|\/)conversations\//i, why: 'conversations/ holds raw transcripts (with secrets) and is read-only' },
  { re: /(^|\/)research\/repos\//i, why: 'research/repos/ holds pinned audit clones and is read-only' },
  { re: /(^|\/)\.orion-keys\//i, why: 'the key vault is managed by the user, never by an agent' },
  { re: /(^|\/)v0\/tests\/results-[^/]*\.json$/i, why: 'results-*.json is test-run churn, written only by the suite' },
];

const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `ORION guard: ${reason}` },
  }));
  process.exit(0);
};

const ask = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask',
      permissionDecisionReason: `ORION guard: ${reason}` },
  }));
  process.exit(0);
};

const findSecret = (text) => SECRET_PATTERNS.find((re) => re.test(String(text ?? '')));

function checkBash(command) {
  const cmd = String(command ?? '');

  if (findSecret(cmd)) deny('the command line contains what looks like an API key. Keys go in the vault or an env var, never in a command (commands are logged).');

  // Staging: explicit paths only.
  for (const m of cmd.matchAll(/\bgit(?:\s+-C\s+\S+)?\s+add\b([^;&|]*)/g)) {
    const args = m[1];
    if (/(^|\s)(-A|--all|-u|--update)(\s|$)/.test(args) || /(^|\s)\.(\s|$)|(^|\s)\*(\s|$)/.test(args))
      deny('stage explicit paths only — `git add -A`, `.`, `*`, `-u` are forbidden (DOCTRINE §7).');
    if (NEVER_COMMIT.some((re) => re.test(args)))
      deny('that path is on the never-commit list (results-*.json, run.db*, conversations/, wg-fixtures/, wg-homes/, archify-out/, v0/eval/results/, *.tgz).');
  }

  if (/--no-verify\b/.test(cmd)) deny('--no-verify is forbidden; fix the hook failure instead.');
  if (/\bgit(?:\s+-C\s+\S+)?\s+commit\b[^;&|]*\s-(a|am|-all)\b/.test(cmd)) deny('`git commit -a` stages everything; stage explicit paths instead.');
  if (/\bgit(?:\s+-C\s+\S+)?\s+push\b[^;&|]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/.test(cmd)) deny('force-push is forbidden.');

  if (/\bgit(?:\s+-C\s+\S+)?\s+commit\b/.test(cmd)) ask('git commit is a user decision (PIPELINE §5, A3).');
  if (/\bgit(?:\s+-C\s+\S+)?\s+push\b/.test(cmd)) ask('git push is a user decision (PIPELINE §5, A4).');
  if (/\bnpm\s+(publish|unpublish|deprecate|dist-tag)\b/.test(cmd)) ask('npm publish/registry changes are a user decision (PIPELINE §5, A5).');
  if (/\bgit(?:\s+-C\s+\S+)?\s+tag\b\s+\S/.test(cmd)) ask('creating tags is part of a release and needs approval.');
  if (/\bgit(?:\s+-C\s+\S+)?\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|restore\s|branch\s+-D|stash\s+(drop|clear))/.test(cmd))
    ask('this discards work — destructive git operations need approval.');
  if (/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|Remove-Item\b[^;|]*-Recurse/i.test(cmd))
    ask('recursive delete needs approval.');
}

function norm(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

function checkWrite(toolName, input) {
  const file = norm(input.file_path ?? input.notebook_path);
  const projectDir = norm(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()).replace(/\/+$/, '');
  const rel = file.toLowerCase().startsWith(projectDir.toLowerCase() + '/')
    ? file.slice(projectDir.length + 1) : file;

  for (const { re, why } of PROTECTED_WRITE_PATHS) if (re.test(rel) || re.test(file)) deny(why + '.');

  const content = [input.content, input.new_string, input.new_source,
    ...(Array.isArray(input.edits) ? input.edits.map((e) => e?.new_string) : [])].join('\n');
  if (findSecret(content)) deny('the content contains what looks like an API key. Refer to keys by alias; never write a value.');

  // The team ledger is append-only: new files only, never edits or overwrites.
  if (/^\.claude\/orion\/ledger\/(?!README\.md$)/i.test(rel)) {
    if (toolName !== 'Write') deny('the team ledger is append-only — write a new entry that references the old one.');
    if (fs.existsSync(path.resolve(projectDir, rel))) deny('the team ledger is append-only — this entry already exists.');
  }

  // The event contract is additive-only and changes need explicit approval (PIPELINE §5).
  if (/^v0\/src\/core\/event\/index\.mjs$/i.test(rel))
    ask('editing the event contract (additive-only; a new type needs a version bump and user approval).');

  // Plan Part C (invariants, entry gate) needs user approval; Part A is append-only.
  if (/^research\/productization\/MASTER-HARNESS-DEVELOPMENT-PLAN\.md$/i.test(rel))
    ask('editing the master plan — Part A is append-only and Part C needs explicit approval.');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(raw || '{}'); } catch (e) {
    // Never wedge the session on a malformed payload; say so on stderr and let the call through.
    process.stderr.write(`orion-guard: could not parse hook input (${e.message}); passing through\n`);
    process.exit(0);
  }
  const tool = payload.tool_name;
  const input = payload.tool_input ?? {};
  if (tool === 'Bash' || tool === 'PowerShell') checkBash(input.command);
  else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) checkWrite(tool, input);
  process.exit(0);
});
