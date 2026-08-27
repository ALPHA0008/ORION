// Tiny test harness (no dependencies).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

export const results = [];
let group = '';
let passCount = 0, failCount = 0;

export function describe(name) { group = name; console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`); }

export function check(name, cond, detail = '') {
  const ok = !!cond;
  ok ? passCount++ : failCount++;
  results.push({ group, test: name, pass: ok, detail: String(detail).slice(0, 400) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
}

export function eq(name, a, b, detail = '') {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  return check(name, ok, ok ? detail : `expected ${JSON.stringify(b)?.slice(0,120)}, got ${JSON.stringify(a)?.slice(0,120)}`);
}

export function throws(name, fn, matcher = null) {
  try { fn(); return check(name, false, 'did not throw'); }
  catch (e) {
    const ok = !matcher || (matcher instanceof RegExp ? matcher.test(e.message) : String(e.message).includes(matcher));
    return check(name, ok, ok ? e.constructor.name : `wrong error: ${e.message}`);
  }
}

export function summary(label, outFile = null) {
  console.log('\n' + '═'.repeat(66));
  console.log(`${label}: ${passCount} passed, ${failCount} failed  (${results.length} assertions)`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ label, pass: passCount, fail: failCount, results }, null, 2));
  return failCount;
}

export function tmpdir(tag) {
  const d = path.join(os.tmpdir(), `v0-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
