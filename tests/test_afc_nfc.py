import importlib.util
spec = importlib.util.spec_from_file_location("build_seed", __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)),"..","build_seed.py"))
bs = importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

# Two wikitables: AFC (Ravens, Bengals) then NFC (Bears, 49ers) — each with its own header row.
html = """
<div class="mw-parser-output">
<table class="hatnote"><tr><td>hatnote junk</td></tr></table>
<h3>AFC</h3>
<table class="wikitable sortable">
<tbody>
<tr><th>Team</th><th>Coordinator</th><th>Since</th><th>Previous coaching position</th></tr>
<tr><th scope="row">Baltimore Ravens</th><td>Declan Doyle</td><td>2026</td><td>Chicago Bears offensive coordinator (2025)</td></tr>
<tr><th scope="row">Cincinnati Bengals</th><td>Dan Pitcher</td><td>2024</td><td>Bengals quarterbacks coach (2020–2023)</td></tr>
</tbody></table>
<h3>NFC</h3>
<table class="wikitable sortable">
<tbody>
<tr><th>Team</th><th>Coordinator</th><th>Since</th><th>Previous coaching position</th></tr>
<tr><th scope="row">Chicago Bears</th><td>Declan Doyle Replacement</td><td>2026</td><td>Detroit Lions passing game coordinator (2024–2025)</td></tr>
<tr><th scope="row">San Francisco 49ers</th><td>Klay Kubiak</td><td>2025</td><td>49ers offensive assistant (2023–2024)</td></tr>
<tr><th scope="row">Green Bay Packers</th><td>Adam Stenavich</td><td>2022</td><td>Packers offensive line coach (2019–2021)</td></tr>
</tbody></table>
<table class="navbox"><tr><td>navbox junk</td></tr></table>
</div>"""

headers, rows = bs._parse_wikitable(html)
print("Headers:", headers)
print("Data rows:", len(rows), "(expect 5: 2 AFC + 3 NFC)")

oc = bs._parse_coordinator_page(html, "offense", 2026)
print("Teams parsed:", sorted(oc.keys()))
ok = True
ok &= len(rows) == 5                       # header rows from both tables NOT counted as data
ok &= set(oc.keys()) == {'BAL','CIN','CHI','SF','GB'}
ok &= oc['CHI']['name'] == 'Declan Doyle Replacement'   # NFC team parsed
ok &= oc['SF']['name'] == 'Klay Kubiak'                 # NFC team parsed
ok &= oc['BAL']['prev_code'] == 'CHI'                   # AFC still works
print("RESULT:", "PASS" if ok else "FAIL")
