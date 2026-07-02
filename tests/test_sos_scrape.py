import importlib.util, os, sys
test_dir=os.path.dirname(os.path.abspath(__file__))
bp=os.path.join(test_dir,"..","build_seed.py")
if not os.path.exists(bp):
    print("SKIP: build_seed.py not found"); sys.exit(0)
spec=importlib.util.spec_from_file_location("build_seed",bp)
bs=importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)
ok=True

# SOS full-name scrape
html="""<table><thead><tr><th>2026 SOS Ranking</th><th>Team</th><th>2026 Vegas Win Total</th></tr></thead><tbody>
<tr><td>1</td><td>Detroit Lions</td><td>10.5</td></tr>
<tr><td>3</td><td>Cincinnati Bengals</td><td>9.5</td></tr>
<tr><td>27</td><td>Chicago Bears</td><td>9.5</td></tr>
<tr><td>8</td><td>San Francisco 49ers</td><td>10.5</td></tr>
</tbody></table>"""
h,rows=bs._parse_sharp_table(html)
sos={}
for c in rows:
    if len(c)<3: continue
    rank=bs._sharp_cell_num(c[0]); code=bs._sharp_row_code(c[1]); wt=bs._sharp_cell_num(c[2])
    if code and rank is not None: sos[code]={"rank":int(rank),"win_total":wt,"name":bs.CODE_TO_FULLNAME.get(code)}
ok &= sos['DET']['rank']==1 and sos['CIN']['name']=='Cincinnati Bengals'
ok &= sos['CHI']['rank']==27 and sos['SF']['name']=='San Francisco 49ers'
print("SOS scrape:", "ok" if ok else "FAIL")

# Percent-column detection
ok &= bs._sharp_col_is_rate('Pressure Rate')==True
ok &= bs._sharp_col_is_rate('Explosive Play Rate')==True
ok &= bs._sharp_col_is_rate('Sacks')==False
ok &= bs._sharp_col_is_rate('EPA/Play')==False
print("Rate-column detection:", "ok" if bs._sharp_col_is_rate('Pressure Rate') and not bs._sharp_col_is_rate('Sacks') else "FAIL")

# Category mapping: defensive pages tagged 'defense'
ok &= bs.SHARP_CATEGORY.get('defensive_line')=='defense'
ok &= bs.SHARP_CATEGORY.get('coverage_schemes')=='defense'
ok &= bs.SHARP_CATEGORY.get('offense')=='offense'
ok &= len(bs.CODE_TO_FULLNAME)==32
print("Categories + full names:", "ok" if ok else "FAIL")

# Defensive table full-name matching (some Sharp pages may use full names)
html2="""<table><thead><tr><th>Team</th><th>Pressure Rate</th></tr></thead><tbody>
<tr><td>Cincinnati Bengals</td><td>22.5</td></tr><tr><td>Bears</td><td>25.0</td></tr></tbody></table>"""
h2,r2=bs._parse_sharp_table(html2)
codes=[bs._sharp_row_code(row[0]) for row in r2]
ok &= codes==['CIN','CHI']   # full name AND nickname both resolve
print("Dual name matching:", "ok" if codes==['CIN','CHI'] else "FAIL", codes)

print("RESULT:", "PASS" if ok else "FAIL")
