import importlib.util, json, os, re, sys
test_dir = os.path.dirname(os.path.abspath(__file__))
build_path = os.path.join(test_dir, "..", "build_seed.py")
if not os.path.exists(build_path):
    print("SKIP: build_seed.py not found"); sys.exit(0)
spec = importlib.util.spec_from_file_location("build_seed", build_path)
bs = importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

# Realistic OverTheCap rows: a linked name cell and a plain name cell, $-formatted APY,
# and a 4-digit free-agency year in the last column.
html = '''
<table><tbody>
<tr><td><a href="/player/x">Ja'Marr Chase</a></td><td>CIN</td><td>25</td><td>$161,000,000</td><td>$40,250,000</td><td>$112,000,000</td><td>$65,000,000</td><td>2030</td></tr>
<tr><td>Michael Pittman Jr.</td><td>IND</td><td>27</td><td>$70,000,000</td><td>$23,333,333</td><td>$40,000,000</td><td>$20,000,000</td><td>2027</td></tr>
<tr><th>Player</th><th>Team</th></tr>
</tbody></table>
'''
rows = bs._parse_otc_table(html)
out = {}
for cells in rows:
    if len(cells) < 8: continue
    key = bs._norm_name(cells[0])
    age = int(re.search(r'\d+', cells[2]).group())
    apy = int(re.search(r'[\d,]+', cells[4].replace('$','')).group().replace(',',''))
    fa = int(re.search(r'20\d{2}', cells[7]).group())
    out[key] = {'age':age,'apy':apy,'fa':fa}

print("Parsed:", {k: out[k] for k in out})
# Pittman Jr. must normalize to "michael pittman" (matching the app's ecrNormName)
ok = (out.get('jamarr chase',{}).get('fa')==2030 and
      out.get('michael pittman',{}).get('fa')==2027 and
      out.get('michael pittman',{}).get('apy')==23333333 and
      out.get('michael pittman',{}).get('age')==27 and
      len(out)==2)   # the <th>-only row must be ignored
print("RESULT:", "PASS" if ok else "FAIL")
