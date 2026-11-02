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
    apy = bs._otc_money(cells[4])
    total = bs._otc_money(cells[3])
    gtd = bs._otc_money(cells[5])
    fa = int(re.search(r'20\d{2}', cells[7]).group())
    out[key] = {'age':age,'apy':apy,'fa':fa,'total':total,'gtd':gtd}

print("Parsed:", {k: out[k] for k in out})
# Pittman Jr. must normalize to "michael pittman" (matching the app's ecrNormName)
ok = (out.get('jamarr chase',{}).get('fa')==2030 and
      out.get('jamarr chase',{}).get('total')==161000000 and
      out.get('jamarr chase',{}).get('gtd')==112000000 and
      out.get('michael pittman',{}).get('fa')==2027 and
      out.get('michael pittman',{}).get('apy')==23333333 and
      out.get('michael pittman',{}).get('total')==70000000 and
      out.get('michael pittman',{}).get('gtd')==40000000 and
      out.get('michael pittman',{}).get('age')==27 and
      len(out)==2)   # the <th>-only row must be ignored
# _otc_money edge cases
ok = ok and bs._otc_money('')  is None and bs._otc_money('$1,234')==1234
print("RESULT:", "PASS" if ok else "FAIL")

# ── the year-by-year table off a player page (fixture: Joe Burrow's OTC contract table) ──
fx = os.path.join(test_dir, "fixtures", "otc_contract_years.html")
yrs = bs.parse_otc_contract_years(open(fx).read(), 2026)
cols = bs.CONTRACT_YEAR_COLS
row = {y[0]: dict(zip(cols, y)) for y in yrs["years"]}
ok2 = (len(yrs["years"]) == 10 and row[2026]["base"] == 12250000 and row[2026]["cap"] == 37599784
       and row[2026]["pro"] == 10349784 and row[2026]["opt"] == 15000000 and row[2026]["roster"] == 0 and row[2026]["gtd"] == 12250000
       and row[2026]["dead"] == 110049568 and row[2026]["save"] == -72449784 and row[2026]["pct"] == 11.8
       and row[2028]["save"] == 27049784 and row[2030]["void"] == 1 and row[2030]["base"] is None
       and "Contract voids" in row[2030]["note"] and "Option due" in row[2026]["note"]
       and yrs["out"] == 2028)
print("Contract years:", "out", yrs["out"], "2026", row[2026])
ok = ok and ok2
# with_links keeps the row's player link
rows2 = bs._parse_otc_table('<table><tr><td><a href="/player/joe-burrow/8741/">Joe Burrow</a></td><td>CIN</td></tr><tr><td>No Link</td><td>X</td></tr></table>', with_links=True)
ok = ok and rows2[0][1] == "/player/joe-burrow/8741/" and rows2[1][1] is None
# savings turning positive later than the build season: the out is that later year; a void year never
ok = ok and bs._otc_money_signed("($72,449,784)") == -72449784 and bs._otc_money_signed("Void") is None and bs._otc_first_money("$1,000$2,000") == 1000
print("RESULT (years):", "PASS" if ok else "FAIL")
