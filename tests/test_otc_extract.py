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


# ── the crawl is bounded: a budget, a breaker, and no waiting on cache hits ──────────────
# What took the refresh down for four days: ~800 player pages fetched cold against a
# throttling OverTheCap, inside a job with ninety minutes for everything.
import itertools
def _todo(n):
    return [(f"p{i}", {"url": f"/player/p{i}/{i}/", "apy": 1, "total": 2, "fa": 2030}) for i in range(n)]
class Clock:
    def __init__(self): self.t = 0.0
    def __call__(self): return self.t
TABLE = {"years": [[2026, 25, 1, None, None, None, 1, 1, 1.0, None, None, 0, ""]], "out": 2027}

# every player cached → no live fetch and no sleep at all
calls, sleeps = [], []
def fetch_all_cached(url, season, summary, refresh, live=True):
    calls.append(live); return TABLE
got, live, stopped = bs.crawl_contract_years(_todo(300), "2026", False, fetch=fetch_all_cached, sleep=sleeps.append, clock=Clock())
ok3 = got == 300 and live == 0 and stopped is None and not sleeps and all(l is False for l in calls)
print("all cached:", got, live, stopped, "sleeps", len(sleeps))

# a cold crawl pauses between LIVE pages only, and stops at the budget — the rest get nothing now, not an error
clk = Clock(); sleeps = []
def fetch_slow(url, season, summary, refresh, live=True):
    if not live: return None
    clk.t += 100.0          # each live page costs 100 "seconds"
    return TABLE
todo = _todo(50)
got, live, stopped = bs.crawl_contract_years(todo, "2026", False, budget_s=450, fetch=fetch_slow, sleep=sleeps.append, clock=clk)
# budget 450: pages at t=100,200,300,400,500 — the check before the 6th sees 500 > 450 and stops
ok3 = ok3 and live == 5 and got == 5 and stopped and "time budget" in stopped and len(sleeps) == 4 and all(s == bs.OTC_YEARS_PAUSE_S for s in sleeps)
ok3 = ok3 and all("years" not in info for _, info in todo[5:]) and all("years" in info for _, info in todo[:5])
print("budget:", got, live, stopped, "sleeps", len(sleeps))

# the clock starts when the position pages did: a slow position step leaves less for the crawl
clk = Clock(); clk.t = 440.0
got, live, stopped = bs.crawl_contract_years(_todo(10), "2026", False, t0=0.0, budget_s=450, fetch=fetch_slow, sleep=lambda s: None, clock=clk)
ok3 = ok3 and live == 1 and "time budget" in (stopped or "")
print("t0 shared with the position pages:", live, stopped)

# pages that will not come trip the breaker; a page with no table (None) is not a refusal
clk = Clock()
answers = iter([False] * 8 + [TABLE] * 100)
def fetch_refused(url, season, summary, refresh, live=True):
    if not live: return None
    clk.t += 1.0; return next(answers)
got, live, stopped = bs.crawl_contract_years(_todo(40), "2026", False, fetch=fetch_refused, sleep=lambda s: None, clock=clk)
ok3 = ok3 and live == 8 and got == 0 and stopped and "8 pages in a row" in stopped
print("breaker:", got, live, stopped)
clk = Clock()
answers = iter(itertools.cycle([None, TABLE]))
got, live, stopped = bs.crawl_contract_years(_todo(40), "2026", False, fetch=fetch_refused, sleep=lambda s: None, clock=clk)
ok3 = ok3 and live == 40 and got == 20 and stopped is None
print("no-table pages are not refusals:", got, live, stopped)

# a cached hit after the budget is spent is still used — the budget bounds fetching, not reading
clk = Clock(); clk.t = 10_000.0
hits = iter([TABLE, None, TABLE])
def fetch_mixed(url, season, summary, refresh, live=True):
    return next(hits) if not live else TABLE
todo = _todo(3)
got, live, stopped = bs.crawl_contract_years(todo, "2026", False, t0=0.0, budget_s=1, fetch=fetch_mixed, sleep=lambda s: None, clock=clk)
ok3 = ok3 and got == 2 and live == 0 and "time budget" in stopped and "years" in todo[0][1] and "years" not in todo[1][1] and "years" in todo[2][1]
print("cache read past the budget:", got, live, stopped)

# fetch_otc_contract_years itself: live=False never touches the network, a refusal answers False
import tempfile
with tempfile.TemporaryDirectory() as td:
    _old = bs.CACHE_DIR; bs.CACHE_DIR = td
    summ = {"apy": 5, "total": 10, "fa": 2028}
    ok3 = ok3 and bs.fetch_otc_contract_years("/player/some-one/1/", "2026", summ, False, live=False) is None
    # plant a cached page under its summary key and it comes back without a request
    os.makedirs(os.path.join(td, "contracts", "players"), exist_ok=True)
    # the cache file is named from the whole path tail ("player-some-one-1"), as the fetch slugs it
    with open(os.path.join(td, "contracts", "players", "player-some-one-1.json"), "w") as f:
        json.dump({"sig": "5|10|2028|2026", "years": TABLE["years"], "out": 2027}, f)
    r = bs.fetch_otc_contract_years("/player/some-one/1/", "2026", summ, False, live=False)
    ok3 = ok3 and r and r["out"] == 2027
    # a moved deal misses the key — and with the network refusing, a live read answers False, not None
    _urlopen = bs.request.urlopen
    def _refuse(*a, **k): raise OSError("refused")
    bs.request.urlopen = _refuse
    _sleep = bs.time.sleep; bs.time.sleep = lambda s: None
    r2 = bs.fetch_otc_contract_years("/player/some-one/1/", "2026", {"apy": 6, "total": 10, "fa": 2028}, False)
    ok3 = ok3 and r2 is False
    bs.request.urlopen = _urlopen; bs.time.sleep = _sleep; bs.CACHE_DIR = _old
# build_contracts end to end, network stubbed: the clock starts with the position pages, the
# tables land on the entries, and the build-only url is dropped before the seed sees it
_fp, _fy, _sl = bs.fetch_otc_contracts, bs.fetch_otc_contract_years, bs.time.sleep
seen_t0 = {}
bs.fetch_otc_contracts = lambda pos, url, refresh: ({"a b": {"age": 1, "apy": 1, "fa": 2030, "total": 1, "gtd": 1, "url": "/player/a-b/1/"}} if pos == "QB" else {})
def _years(url, season, summary, refresh, live=True):
    seen_t0["live"] = live; return TABLE
bs.fetch_otc_contract_years = _years
bs.time.sleep = lambda s: None
built = bs.build_contracts(False)
bs.fetch_otc_contracts, bs.fetch_otc_contract_years, bs.time.sleep = _fp, _fy, _sl
ok3 = ok3 and built["a b"]["pos"] == "QB" and built["a b"]["years"] == TABLE["years"] and built["a b"]["out"] == 2027 and "url" not in built["a b"]
print("build_contracts end to end:", {k: sorted(v) for k, v in built.items()})
print("RESULT (budget):", "PASS" if ok3 else "FAIL")
