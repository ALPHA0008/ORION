import os, sys, collections
root = sys.argv[1]
SKIP_DIR = {'.git','node_modules','dist','build','.next','target','vendor','__pycache__',
            '.venv','venv','coverage','.turbo','out','.cache','site-packages','.pytest_cache'}
ext_files = collections.Counter(); ext_lines = collections.Counter(); ext_bytes = collections.Counter()
CODE = {'.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.rs','.go','.java','.c','.h','.cpp','.hpp','.rb','.sh','.zsh','.ps1','.sql','.wasm','.swift','.kt'}
DOC  = {'.md','.mdx','.rst','.txt','.adoc'}
CFG  = {'.json','.yaml','.yml','.toml','.ini','.cfg','.xml','.lock','.env','.properties'}
for dp, dn, fn in os.walk(root):
    dn[:] = [d for d in dn if d not in SKIP_DIR and not d.startswith('.git')]
    for f in fn:
        p = os.path.join(dp,f)
        e = os.path.splitext(f)[1].lower() or '(noext)'
        try:
            sz = os.path.getsize(p)
            if sz > 8_000_000: 
                ext_files[e]+=1; ext_bytes[e]+=sz; continue
            with open(p,'rb') as fh: n = fh.read().count(b'\n')+1
        except Exception: continue
        ext_files[e]+=1; ext_lines[e]+=n; ext_bytes[e]+=sz
tot_f = sum(ext_files.values()); tot_l = sum(ext_lines.values())
print(f"=== {root} ===")
print(f"TOTAL files={tot_f}  lines={tot_l}")
print(f"{'ext':12} {'files':>7} {'lines':>10} {'MB':>8}")
for e,_ in ext_lines.most_common(22):
    print(f"{e:12} {ext_files[e]:>7} {ext_lines[e]:>10} {ext_bytes[e]/1e6:>8.1f}")
def agg(S): return (sum(ext_files[e] for e in S), sum(ext_lines[e] for e in S))
for name,S in (('CODE',CODE),('DOCS',DOC),('CONFIG',CFG)):
    f_,l_ = agg(S); print(f"{name:8} files={f_:>6} lines={l_:>9}")
cf,cl = agg(CODE); df,dl = agg(DOC)
print(f"DOC:CODE line ratio = {dl/cl:.2f} : 1" if cl else "n/a")
