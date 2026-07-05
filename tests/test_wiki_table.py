import importlib.util
spec = importlib.util.spec_from_file_location("build_seed", __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)),"..","build_seed.py"))
bs = importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

# Realistic Wikipedia rendered HTML: a hatnote table FIRST, then a navbox, THEN the wikitable.
# Team column is a <th scope="row"> (as Wikipedia commonly renders it), rest are <td>.
html = """
<div class="mw-parser-output">
<table class="hatnote"><tr><td>This article is about...</td></tr></table>
<table class="infobox"><tr><th>Some infobox</th></tr><tr><td>junk</td></tr></table>
<table class="wikitable sortable">
<tbody>
<tr><th>Team</th><th>Coordinator</th><th>Since</th><th>Previous coaching position</th></tr>
<tr><th scope="row"><a href="/wiki/Baltimore_Ravens">Baltimore Ravens</a></th><td><a href="/wiki/Declan_Doyle">Declan Doyle</a></td><td>2026</td><td><a href="/wiki/Chicago_Bears">Chicago Bears</a> offensive coordinator (2025)</td></tr>
<tr><th scope="row"><a href="/wiki/Cincinnati_Bengals">Cincinnati Bengals</a></th><td><a href="/wiki/Dan_Pitcher">Dan Pitcher</a></td><td>2024</td><td>Bengals quarterbacks coach (2020–2023)</td></tr>
<tr><th scope="row"><a href="/wiki/Los_Angeles_Chargers">Los Angeles Chargers</a></th><td><a href="/wiki/Mike_McDaniel">Mike McDaniel</a></td><td>2026</td><td><a href="/wiki/Miami_Dolphins">Miami Dolphins</a> head coach (2022–2025)</td></tr>
</tbody></table>
<table class="navbox"><tr><td>nav junk</td></tr></table>
</div>"""

# First check the table finder grabs the wikitable, not the hatnote/infobox
headers, rows = bs._parse_wikitable(html)
print("Headers:", headers)
print("Row count:", len(rows))
print("First row cells:", rows[0] if rows else "NONE")

oc = bs._parse_coordinator_page(html, "offense", 2026)
print("\nParsed teams:", list(oc.keys()))
ok = True
ok &= headers == ['Team','Coordinator','Since','Previous coaching position']
ok &= len(oc) == 3
ok &= oc.get('BAL',{}).get('name') == 'Declan Doyle'
ok &= oc.get('BAL',{}).get('prev_code') == 'CHI' and oc['BAL']['is_new'] and not oc['BAL']['carryover']
ok &= oc.get('CIN',{}).get('name') == 'Dan Pitcher' and oc['CIN']['carryover']
ok &= oc.get('LAC',{}).get('prev_role') == 'head coach'
print("RESULT:", "PASS" if ok else "FAIL")
