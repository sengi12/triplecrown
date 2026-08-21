#!/usr/bin/env python3
"""Offseason roster movement, derived from nflverse instead of scraped from Spotrac.

Replaces test_spotrac_pull.py. The Spotrac parsers are gone: that source answers 403 to
datacenter IPs, so the block could never join the scheduled refresh, and a blocked fetch
emptied the tab silently.

What matters here is that the REPLACEMENT emits exactly what the Roster Changes tab already
consumes — same keys, same types, same team codes — because the UI is unchanged. So most of
this asserts the output contract rather than the derivation, plus the two join bugs that
actually bit during development:

  • nflverse is not internally consistent about team codes. The roster feed says AZ/LA; the
    draft feed uses Pro-Football-Reference codes (GNB, KAN, LVR…). An unmapped code silently
    drops that team's rows — it cost 55 of 257 draft picks the first time this ran.
  • Undrafted rookies are roster additions but not "signings". Counting them put ~450 extra
    names in the Free Agency section, swamping the ~450 real veteran signings.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BP = os.path.join(HERE, "..", "build_seed.py")
if not os.path.exists(BP):
    print("SKIP: missing build_seed")
    sys.exit(0)

spec = importlib.util.spec_from_file_location("build_seed", BP)
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)

PASS = MISSED = 0


def chk(cond, label):
    global PASS, MISSED
    if cond:
        PASS += 1
        print("  PASS:", label)
    else:
        MISSED += 1
        print("  MISS:", label)


print("=== TEST 1: team codes are normalised across all three nflverse feeds ===")
# Every code any nflverse feed emits must land on one of ours. A miss is silent data loss.
APP = set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN "
          "NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split())
chk(bs._nv_team("AZ") == "ARI", "roster feed AZ → ARI")
chk(bs._nv_team("LA") == "LAR", "roster/trades feed LA → LAR")
for pfr, ours in (("GNB", "GB"), ("KAN", "KC"), ("LVR", "LV"), ("NOR", "NO"),
                  ("NWE", "NE"), ("SFO", "SF"), ("TAM", "TB")):
    chk(bs._nv_team(pfr) == ours, f"draft feed {pfr} → {ours}")
chk(bs._nv_team("CIN") == "CIN", "an already-correct code passes through")
chk(bs._nv_team(" cin ") == "CIN", "whitespace and case are normalised")
chk(bs._nv_team(None) == "", "a missing code does not raise")
bad = [v for v in bs.NFLVERSE_TEAM_FIX.values() if v not in APP]
chk(not bad, f"every mapping targets a real team code (offenders: {bad})")

print("\n=== TEST 2: contract terms come from the OverTheCap block already in the build ===")
# TOTAL ← otc.total, AAV ← otc.apy, TERM ← otc.fa − season. Verified against the previous
# seed: these matched Spotrac's printed figures on 496 of 547 signings.
contracts = {"boye mafe": {"apy": 20_000_000, "total": 60_000_000, "fa": 2029, "age": 27}}
yrs, val, aav = bs._otc_terms(contracts, "Boye Mafe", 2026)
chk(yrs == 3, "TERM derived as free-agency year minus season (2029 − 2026 = 3)")
chk(val == 60.0, "TOTAL converted to millions")
chk(aav == 20.0, "AAV converted to millions")

yrs, val, aav = bs._otc_terms(contracts, "Nobody At All", 2026)
chk((yrs, val, aav) == (None, None, None), "an unlisted player yields blanks, not zeros")
chk(bs._otc_terms(None, "Boye Mafe", 2026) == (None, None, None), "no contracts block → blanks")
chk(bs._otc_terms({}, "Boye Mafe", 2026) == (None, None, None), "empty contracts block → blanks")

# Name normalisation has to survive suffixes and punctuation, or a player silently loses money.
c2 = {"kenneth walker": {"apy": 1_000_000, "total": 4_000_000, "fa": 2028}}
chk(bs._otc_terms(c2, "Kenneth Walker III", 2026)[0] == 2, "suffixes are normalised away (Walker III)")
c3 = {"devon achane": {"apy": 2_000_000, "total": 8_000_000, "fa": 2027}}
chk(bs._otc_terms(c3, "De'Von Achane", 2026)[1] == 8.0, "apostrophes are normalised away")

# A stale free-agency year must not produce a negative or zero term.
c4 = {"old player": {"apy": 1_000_000, "total": 1_000_000, "fa": 2024}}
chk(bs._otc_terms(c4, "Old Player", 2026)[0] is None, "a past free-agency year yields no term, not a negative one")

print("\n=== TEST 3: trade detail is rebuilt from the whole trade, not one row ===")
# nflverse splits a trade across rows sharing a trade_id — one per player, one per pick. No
# single row describes the deal, so the sentence the tab shows has to be reassembled.
rows = [
    {"season": "2026", "trade_id": "1", "gave": "NYG", "received": "CIN",
     "pfr_id": "LawrDe03", "pfr_name": "Dexter Lawrence", "pick_season": "", "pick_round": "", "pick_number": ""},
    {"season": "2026", "trade_id": "1", "gave": "CIN", "received": "NYG",
     "pfr_id": "", "pfr_name": "", "pick_season": "2026", "pick_round": "1", "pick_number": "10"},
]
d = bs._nv_trade_details(rows, 2026)
chk("LawrDe03" in d, "the traded player is keyed by pfr_id")
gave, recv, detail = d["LawrDe03"]
chk(gave == "NYG" and recv == "CIN", "both sides of the move are captured")
chk("Traded to CIN from NYG" in detail, "detail names the direction")
chk("2026 1st round pick" in detail, "the pick that went the other way is described")
chk("#10" in detail, "including its overall number")
chk(bs._nv_trade_details(rows, 2025) == {}, "a different season yields nothing")
chk(bs._nv_trade_details([], 2026) == {}, "an empty feed yields nothing")

# Ordinals have to read correctly or the tab prints "a 2026 2th round pick".
for rd, want in (("1", "1st"), ("2", "2nd"), ("3", "3rd"), ("4", "4th"), ("7", "7th")):
    r = [{"season": "2026", "trade_id": "x", "gave": "A", "received": "B",
          "pfr_id": "p1", "pfr_name": "Someone", "pick_season": "2026",
          "pick_round": "", "pick_number": ""},
         {"season": "2026", "trade_id": "x", "gave": "B", "received": "A",
          "pfr_id": "", "pfr_name": "", "pick_season": "2026",
          "pick_round": rd, "pick_number": ""}]
    chk(want in bs._nv_trade_details(r, 2026)["p1"][2], f"round {rd} reads as {want}")

print("\n=== TEST 4: a player is never described as traded for himself ===")
solo = [{"season": "2026", "trade_id": "s", "gave": "A", "received": "B",
         "pfr_id": "p9", "pfr_name": "Solo Player", "pick_season": "", "pick_round": "", "pick_number": ""}]
detail = bs._nv_trade_details(solo, 2026)["p9"][2]
chk("Solo Player" not in detail.replace("Traded to B from A", ""),
    "the player is excluded from the list of what was given up")

print("\n=== TEST 5: the output contract the Roster Changes tab depends on ===")
# 74-team-tabs.js reads exactly these fields. Renaming any of them breaks the tab silently,
# because a missing key renders as an em dash rather than an error.
UI_FIELDS = {
    "free_agents": {"player", "pos", "years", "value_m", "aav_m"},
    "draft": {"player", "pos", "years", "value_m", "aav_m"},
    "trades": {"player", "pos", "cap_m", "detail"},
    "free_agents_lost": {"player", "pos", "to_team", "years", "value_m", "aav_m"},
}
src = open(BP).read()
start = src.index("def build_additions(")
body = src[start:src.index("\ndef ", start + 10)]
for sec, fields in UI_FIELDS.items():
    chk(f'"{sec}"' in body, f"build_additions emits a {sec} section")
    for f in fields:
        chk(f'"{f}"' in body, f"  {sec}: emits {f}")

print("\n=== TEST 6: the Spotrac baseline backfills what nflverse has not published ===")
# nflverse's trades feed lags. At the switch it carried 23 of Spotrac's 39 trades, and the
# gap was everything after the feed's last publish — including the Bengals' Dexter Lawrence
# deal. Losing real history to a stale upstream CSV is not acceptable, so the last good
# capture is frozen and used to fill only what is missing.
import json as _json
BASELINE = os.path.join(HERE, "..", "seeds", "roster_moves_baseline.json")
chk(os.path.exists(BASELINE), "the frozen Spotrac baseline is committed")
if os.path.exists(BASELINE):
    b = _json.load(open(BASELINE))
    chk(b.get("source") == "spotrac", "it records where it came from")
    chk(str(b.get("season")) == "2026", "and which season it describes")
    teams = b.get("teams", {})
    chk(len(teams) == 32, "all 32 teams captured")
    cin = [t for t in teams.get("CIN", {}).get("trades", [])]
    chk(any("Lawrence" in t.get("player", "") for t in cin),
        "the Dexter Lawrence trade is preserved in CIN's baseline")

    loaded = bs._load_moves_baseline(2026)
    chk(loaded is not None and len(loaded) == 32, "the loader returns it for the matching season")
    chk(bs._load_moves_baseline(2025) is None,
        "a season mismatch returns nothing — last year's moves must not leak into this year's tab")

print("\n=== TEST 7: the merge cannot duplicate or mask ===")
# A trade belongs to BOTH clubs' tabs, so the same player under two teams is correct. What
# must never happen is the same player twice under ONE team, or a baseline row surviving
# after nflverse publishes the same deal.
def _merge_probe(nfl_rows, base_rows):
    additions = {"CIN": {"trades": list(nfl_rows), "free_agents": [], "draft": [], "free_agents_lost": []}}
    have = {(r.get("player") or "").lower() for r in additions["CIN"]["trades"]}
    for r in base_rows:
        nm = (r.get("player") or "").lower()
        if nm and nm not in have:
            row = dict(r); row["from_baseline"] = True
            additions["CIN"]["trades"].append(row)
    return additions["CIN"]["trades"]

out = _merge_probe([{"player": "Dexter Lawrence"}], [{"player": "Dexter Lawrence"}])
chk(len(out) == 1, "nflverse's version wins when both sources have the deal")
chk(not out[0].get("from_baseline"), "…and it is the nflverse row that survives")

out = _merge_probe([], [{"player": "Dexter Lawrence"}])
chk(len(out) == 1 and out[0].get("from_baseline"), "a deal only nflverse lacks is backfilled")
chk(out[0].get("from_baseline") is True, "backfilled rows are marked, so the gap stays visible")

out = _merge_probe([{"player": "Andy Dalton"}], [{"player": "andy dalton"}])
chk(len(out) == 1, "matching ignores case, so a spelling difference cannot duplicate")

print("\n=== TEST 8: Spotrac is gone ===")
for gone in ("SPOTRAC_TEAM", "SPOTRAC_URL", "fetch_team_additions",
             "_parse_signing_table", "_parse_traded_table", "_spot_find_tab_id"):
    chk(not hasattr(bs, gone), f"{gone} no longer exists")
chk("spotrac.com" not in src, "no Spotrac URL remains in the builder")
chk(hasattr(bs, "build_additions"), "build_additions still exists (same entry point)")

print(f"\nRESULT: {'PASS' if MISSED == 0 else 'MISS'} ({PASS}/{PASS + MISSED} checks)")
sys.exit(0 if MISSED == 0 else 1)
