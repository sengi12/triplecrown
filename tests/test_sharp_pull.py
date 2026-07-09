import importlib.util, os, sys
test_dir=os.path.dirname(os.path.abspath(__file__))
bp=os.path.join(test_dir,"..","build_seed.py")
if not os.path.exists(bp):
    print("SKIP: build_seed.py not found"); sys.exit(0)
spec=importlib.util.spec_from_file_location("build_seed",bp)
bs=importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

html="""<table id="table_1"><thead><tr>
<th>Team</th><th>EPA/Play</th><th>Yards Per Play</th><th>Sec/Play</th>
</tr></thead><tbody>
<tr><td>Rams</td><td>0.13</td><td>6.2</td><td>28.1</td></tr>
<tr><td>Bengals</td><td>0.00</td><td>5.3</td><td>26.5</td></tr>
<tr><td>Browns</td><td>-0.19</td><td>4.3</td><td>30.2</td></tr>
<tr><td>49ers</td><td>0.08</td><td>5.7</td><td>27.0</td></tr>
</tbody></table>"""
headers,rows=bs._parse_sharp_table(html)
stat_cols=headers[1:]
teams={}; raw={c:[] for c in stat_cols}
for cells in rows:
    code=bs.NICK_TO_CODE.get(cells[0].strip().lower())
    if not code: continue
    vals={}
    for ci,col in enumerate(stat_cols):
        v=bs._sharp_cell_num(cells[ci+1]); vals[col]=v
        if v is not None: raw[col].append((code,v))
    teams[code]={"values":vals,"ranks":{}}
for col,pairs in raw.items():
    lb=bs._sharp_off_col_lower_better(col)
    for rank,(code,_v) in enumerate(sorted(pairs,key=lambda cv:cv[1],reverse=not lb),1):
        teams[code]["ranks"][col]=rank

ok=True
ok &= bs.NICK_TO_CODE.get('49ers')=='SF'
ok &= teams['LAR']['ranks']['EPA/Play']==1                # highest EPA = rank 1
ok &= teams['CLE']['ranks']['EPA/Play']==4                # lowest = last
ok &= teams['CIN']['ranks']['Sec/Play']==1                # LOWER sec/play is better → CIN 26.5 = 1
ok &= teams['CLE']['ranks']['Sec/Play']==4                # 30.2 slowest = worst
ok &= teams['LAR']['values']['Yards Per Play']==6.2
print("Sec/Play lower-is-better:", bs._sharp_off_col_lower_better('Sec/Play'))
print("EPA/Play lower-is-better:", bs._sharp_off_col_lower_better('EPA/Play'))
print("RESULT:","PASS" if ok else "FAIL")
