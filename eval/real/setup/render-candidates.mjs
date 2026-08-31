// Candidate rendering comparison (§5–§6). Offline; touches no production code.
//
// The question is not "which looks nicest" but: can the model unambiguously reconstruct what was
// actually in the file, cheaply, without being told a convention?

const SRC = 'function f() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n';
const lines = SRC.split('\n').slice(0, -1);

const CANDIDATES = {
  // A0 — the current format. Separator is a TAB, which merges with source indentation.
  'A0 current (TAB sep)': (l, n, w) => `${String(n).padStart(w)}\t${l}`,

  // A — same shape, but a delimiter that cannot occur as leading whitespace.
  'A  pipe delimiter': (l, n, w) => `${String(n).padStart(w)}|${l}`,

  // B — escape whitespace so every byte is explicit.
  'B  escaped whitespace': (l, n, w) =>
    `${String(n).padStart(w)}|${l.replace(/\t/g, '\\t')}`,

  // C — structured line records (JSON).
  'C  JSON records': (l, n) => JSON.stringify({ line: n, content: l }),

  // D — explicit markers.
  'D  [TAB] markers': (l, n, w) =>
    `${String(n).padStart(w)}|${l.replace(/\t/g, '[TAB]')}`,
};

const width = String(lines.length).length;

console.log('source line 3 is', JSON.stringify(lines[2]), `(${(lines[2].match(/\t/g) ?? []).length} tabs)`);
console.log('─'.repeat(94));
console.log('candidate                 bytes  amb?  reconstructable  line-3 rendering');
console.log('─'.repeat(94));

for (const [name, fn] of Object.entries(CANDIDATES)) {
  const rendered = lines.map((l, i) => fn(l, i + 1, width)).join('\n');
  const bytes = Buffer.byteLength(rendered);

  // Ambiguity probe: does the rendering of line 3 present a tab-run that includes the separator?
  const l3 = rendered.split('\n')[2];
  const leadingTabRun = /^[^\t]*\t+/.exec(l3);
  const tabsShown = leadingTabRun ? (leadingTabRun[0].match(/\t/g) ?? []).length : 0;
  const actualTabs = (lines[2].match(/\t/g) ?? []).length;
  const ambiguous = tabsShown !== 0 && tabsShown !== actualTabs;

  // Reconstructability: can content be recovered mechanically from the rendering?
  let recon = 'no';
  try {
    const back = rendered.split('\n').map((r) => {
      if (name.startsWith('C')) return JSON.parse(r).content;
      const body = r.slice(r.indexOf('|') + 1);
      if (name.startsWith('B')) return body.replace(/\\t/g, '\t');
      if (name.startsWith('D')) return body.replace(/\[TAB\]/g, '\t');
      return body;
    }).join('\n');
    recon = back === lines.join('\n') ? 'EXACT' : 'lossy';
  } catch { recon = 'error'; }

  console.log(`${name.padEnd(24)} ${String(bytes).padStart(5)}  ${ambiguous ? 'YES ' : 'no  '}  ${recon.padEnd(15)}  ${JSON.stringify(l3)}`);
}

console.log('─'.repeat(94));
console.log('\nNote: A0 shows a 3-tab run where the source has 2 — the separator is indistinguishable');
console.log('from indentation. Every other candidate keeps the separator outside the tab alphabet.');
