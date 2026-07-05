import importlib.util
spec = importlib.util.spec_from_file_location("build_seed", "/tmp/build_seed_edit.py")
bs = importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

# Rendered wikitable HTML as the MediaWiki API returns it — names ARE in the Coordinator cell
html = """<div class="mw-parser-output"><table class="wikitable sortable">
<thead><tr><th>Team</th><th>Coordinator</th><th>Since</th><th>Previous coaching position</th></tr></thead>
<tbody>
<tr><td><a href="/wiki/Baltimore_Ravens">Baltimore Ravens</a></td><td><a href="/wiki/Declan_Doyle">Declan Doyle</a></td><td>2026</td><td><a href="/wiki/Chicago_Bears">Chicago Bears</a> offensive coordinator (2025)</td></tr>
<tr><td><a href="/wiki/Cincinnati_Bengals">Cincinnati Bengals</a></td><td><a href="/wiki/Dan_Pitcher">Dan Pitcher</a></td><td>2024</td><td>Bengals quarterbacks coach (2020–2023)</td></tr>
<tr><td><a href="/wiki/Los_Angeles_Chargers">Los Angeles Chargers</a></td><td><a href="/wiki/Mike_McDaniel">Mike McDaniel</a></td><td>2026</td><td><a href="/wiki/Miami_Dolphins">Miami Dolphins</a> head coach (2022–2025)</td></tr>
<tr><td><a href="/wiki/Green_Bay_Packers">Green Bay Packers</a></td><td><a href="/wiki/Adam_Stenavich">Adam Stenavich</a></td><td>2022</td><td>Packers offensive line coach (2019–2021)</td></tr>
</tbody></table></div>"""
oc = bs._parse_coordinator_page(html, "offense", 2026)
import json
for c in ['BAL','CIN','LAC','GB']:
    d=oc.get(c,{})
    print(c, d.get('name'), '| since', d.get('since'), '| new', d.get('is_new'), '| carry-over?', not d.get('carryover'), '| from', d.get('prev_code'), d.get('prev_role'))
ok=True
ok &= oc['BAL']['name']=='Declan Doyle' and oc['BAL']['is_new'] and not oc['BAL']['carryover'] and oc['BAL']['prev_code']=='CHI' and oc['BAL']['prev_role']=='offensive coordinator'
ok &= oc['CIN']['name']=='Dan Pitcher' and oc['CIN']['carryover'] and oc['CIN']['since']==2024
ok &= oc['LAC']['name']=='Mike McDaniel' and oc['LAC']['prev_code']=='MIA' and oc['LAC']['prev_role']=='head coach'
ok &= oc['GB']['name']=='Adam Stenavich' and oc['GB']['carryover'] and oc['GB']['internal']
print("\nRESULT:", "PASS" if ok else "FAIL")
