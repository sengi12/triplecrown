import importlib.util
spec = importlib.util.spec_from_file_location("build_seed", "/tmp/build_seed_edit.py")
bs = importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

# HC page: Team | Coach | Since | Previous position — AFC then NFC, with a repeated header.
html = """<div class="mw-parser-output">
<table class="wikitable"><tbody>
<tr><th>Team</th><th>Head coach</th><th>Since</th><th>Previous position</th></tr>
<tr><th scope="row">Cleveland Browns</th><td>Todd Monken</td><td>2026</td><td>Baltimore Ravens offensive coordinator (2023–2025)</td></tr>
<tr><th scope="row">Buffalo Bills</th><td>Joe Brady</td><td>2026</td><td>Bills offensive coordinator (2024–2025)</td></tr>
<tr><th scope="row">Cincinnati Bengals</th><td>Zac Taylor</td><td>2019</td><td>Los Angeles Rams quarterbacks coach (2018)</td></tr>
</tbody></table>
<table class="wikitable"><tbody>
<tr><th>Team</th><th>Head coach</th><th>Since</th><th>Previous position</th></tr>
<tr><th scope="row">Atlanta Falcons</th><td>Kevin Stefanski</td><td>2026</td><td>Cleveland Browns head coach (2020–2025)</td></tr>
<tr><th scope="row">Los Angeles Rams</th><td>Sean McVay</td><td>2017</td><td>Washington Commanders offensive coordinator (2014–2016)</td></tr>
</tbody></table></div>"""

hc = bs.build_head_coach_history.__wrapped__ if hasattr(bs.build_head_coach_history,'__wrapped__') else None
# call the parser path directly (no network)
parsed = bs._parse_coordinator_page(html, "head", 2026)
import json
for c in ['ATL','CLE','BUF','CIN','LAR']:
    d=parsed.get(c,{})
    print(c, d.get('name'),'| since',d.get('since'),'| new',d.get('is_new'),'| from',d.get('prev_code'),'('+str(d.get('prev_role'))+')')

ok=True
# The Falcons: Stefanski new in 2026, was Cleveland Browns HEAD COACH → prev_code CLE
ok &= parsed['ATL']['name']=='Kevin Stefanski' and parsed['ATL']['is_new'] and parsed['ATL']['prev_code']=='CLE' and parsed['ATL']['prev_role']=='head coach'
# Browns: Monken new, was Ravens OC
ok &= parsed['CLE']['prev_code']=='BAL' and parsed['CLE']['is_new']
# McVay: not new (2017)
ok &= parsed['LAR']['is_new']==False
print("\nRESULT:", "PASS" if ok else "FAIL")
