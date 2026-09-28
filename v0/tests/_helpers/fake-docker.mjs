// A FAKE `docker` CLI placed first on PATH, so detection and the shipped CLI exercise their REAL
// code paths (execFileSync/execFile by bare name) against a daemon we control. No real daemon.
//
// Windows: execFile cannot launch .cmd shims without a shell, so the fake is a hard link (or copy)
// of node.exe named docker.exe, driven by a NODE_OPTIONS --require preload that only acts when
// the executable's basename is docker/podman. Linux/macOS: a /bin/sh script that execs node.
//
// Behaviour per `mode`: 'windows' / 'linux' -> daemon answers with that OSType; `run` fails with
// the exact CI error for windows. 'dead' -> every call exits 1 (daemon not answering).
// Every invocation is appended to <dir>/calls.log as one JSON line.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const PRELOAD = String.raw`
const fs = require('fs'), path = require('path');
const exe = path.basename(process.execPath).toLowerCase().replace(/\.exe$/, '');
const isShim = process.env.FAKE_RT_SHIM === '1';
if (exe === 'docker' || exe === 'podman' || isShim) {
  const dir = isShim ? process.env.FAKE_RT_DIR : path.dirname(process.execPath);
  const name = isShim ? process.env.FAKE_RT_NAME : exe;
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'fake.json'), 'utf8'));
  const mode = cfg[name] ?? 'dead';
  const args = process.argv.slice(1);
  // node resolves argv[1] (the would-be script) to an absolute path; the subcommand is its basename.
  if (!isShim && args.length) args[0] = path.basename(args[0]);
  fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify({ bin: name, args }) + '\n');
  const out = (s) => { process.stdout.write(s + '\n'); process.exit(0); };
  if (mode === 'dead') { process.stderr.write('Cannot connect to the Docker daemon\n'); process.exit(1); }
  const cmd = args[0], fmt = args.join(' ');
  if (cmd === 'version') {
    if (/Os\b|OSType/.test(fmt)) out(mode);
    if (fmt.includes('{{')) out('27.0.0');
    out(JSON.stringify({ Server: { Version: '27.0.0', Os: mode } }));
  }
  if (cmd === 'info') {
    if (/OSType/.test(fmt)) out(mode);
    if (/OperatingSystem/.test(fmt)) out(mode === 'windows' ? 'Microsoft Windows Server 2022' : 'Docker Desktop');
    if (fmt.includes('{{')) out(mode);
    out(JSON.stringify({ OSType: mode, OperatingSystem: mode === 'windows' ? 'Microsoft Windows Server 2022' : 'Linux' }));
  }
  if (cmd === 'run' && mode === 'windows') {
    process.stderr.write('docker: Error response from daemon: invalid option: Windows does not support PidsLimit.\n');
    process.exit(125);
  }
  if (cmd === 'ps' || cmd === 'rm') out('');
  process.stderr.write('fake runtime: unsupported: ' + fmt + '\n'); process.exit(1);
}
`;

/**
 * Install fake runtimes. `modes` e.g. { docker: 'windows', podman: 'dead' }.
 * Returns { dir, env(base), calls(), cleanup() }. `env(base)` returns a copy of base with PATH
 * (whatever its case) prefixed by the fake dir and NODE_OPTIONS carrying the preload.
 */
export function installFakeRuntimes(modes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-rt-'));
  const preload = path.join(dir, 'preload.cjs');
  fs.writeFileSync(preload, PRELOAD);
  fs.writeFileSync(path.join(dir, 'fake.json'), JSON.stringify(modes));
  fs.writeFileSync(path.join(dir, 'calls.log'), '');
  for (const name of ['docker', 'podman']) {
    if (process.platform === 'win32') {
      const target = path.join(dir, `${name}.exe`);
      try { fs.linkSync(process.execPath, target); } catch { fs.copyFileSync(process.execPath, target); }
    } else {
      const target = path.join(dir, name);
      fs.writeFileSync(target,
        `#!/bin/sh\nFAKE_RT_SHIM=1 FAKE_RT_DIR='${dir}' FAKE_RT_NAME=${name} exec '${process.execPath}' --require '${preload}' -e '' -- "$@"\n`);
      fs.chmodSync(target, 0o755);
    }
  }
  const env = (base = process.env) => {
    const out = {};
    let pathVal = '';
    for (const [k, v] of Object.entries(base)) {
      if (/^path$/i.test(k)) pathVal = v; else if (k !== 'NODE_OPTIONS') out[k] = v;
    }
    out[process.platform === 'win32' ? 'Path' : 'PATH'] = dir + path.delimiter + pathVal;
    const prior = base.NODE_OPTIONS ? base.NODE_OPTIONS + ' ' : '';
    if (process.platform === 'win32') out.NODE_OPTIONS = `${prior}--require "${preload.split(path.sep).join('/')}"`;
    else if (base.NODE_OPTIONS) out.NODE_OPTIONS = base.NODE_OPTIONS;
    return out;
  };
  const calls = () => fs.readFileSync(path.join(dir, 'calls.log'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked exe on Windows */ } };
  return { dir, env, calls, cleanup };
}

/** Temporarily apply a fake env to THIS process (for in-process detectRuntime), run fn, restore. */
export function withProcessEnv(envObj, fn) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, envObj);
  try { return fn(); } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}
