import importlib.util, os, sys
test_dir=os.path.dirname(os.path.abspath(__file__))
bp=os.path.join(test_dir,"..","build_seed.py")
if not os.path.exists(bp):
    print("SKIP: build_seed.py not found"); sys.exit(0)
spec=importlib.util.spec_from_file_location("build_seed",bp)
bs=importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

# A trimmed SumerSports-shaped WR table: rank-prefixed names, empty Team cell (logo), a %
# column, and a decimal column. Mirrors the real page's structure without the network.
html="""<table><thead><tr>
<th>Player Name</th><th>Season</th><th>Team</th><th>Routes Run</th>
<th>Target Share</th><th>Total EPA</th><th>YPRR</th>
</tr></thead><tbody>
<tr><td>1. Jaxon Smith-Njigba</td><td>2025</td><td></td><td>497</td><td>35.82%</td><td>141.85</td><td>3.61</td></tr>
<tr><td>2. Puka Nacua</td><td>2025</td><td></td><td>463</td><td>30.29%</td><td>161.29</td><td>3.70</td></tr>
</tbody></table>"""

p=bs._SumerTableParser(); p.feed(html)
stat_cols=[h for h in p.headers if h not in bs.SUMER_META_COLS]
name_i=p.headers.index("Player Name")

import re
players={}; pct=set()
for cells in p.rows:
    name=re.sub(r"^\s*\d+\.\s*","",cells[name_i]).strip()
    key=bs._norm_name(name)
    vals=[]
    for col in stat_cols:
        raw=cells[p.headers.index(col)]
        if "%" in raw: pct.add(col)
        vals.append(bs._sumer_num(raw))
    players[key]={"values":vals,"team":"","rank":None}

ok=True
# 1) meta columns dropped, stat columns in page order
ok &= stat_cols==["Routes Run","Target Share","Total EPA","YPRR"]
# 2) rank prefix stripped + name normalized to match ecrNormName ("smith-njigba" -> "smithnjigba")
ok &= "jaxon smithnjigba" in players
# 3) values parsed: int, percent-as-magnitude, decimal
jsn=players["jaxon smithnjigba"]["values"]
ok &= jsn==[497, 35.82, 141.85, 3.61]
# 4) percent column detected
ok &= "Target Share" in pct and "YPRR" not in pct
# 5) _sumer_num handles blanks/dashes -> None
ok &= bs._sumer_num("")   is None
ok &= bs._sumer_num("-")  is None
ok &= bs._sumer_num("1,793")==1793

print("stat_cols:", stat_cols)
print("Jaxon values:", jsn)
print("pct cols:", sorted(pct))
print("RESULT:","PASS" if ok else "FAIL")
