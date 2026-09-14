#!/usr/bin/env python3
"""College line context (src/cfb/ol_unit.py): the unit table from synthetic play-by-play —
line yards, stuff / TFL rate, power success, sack rate, FBS percentiles — and a rookie
lineman's profile assembled from his roster seasons. No network: every loader monkeypatched."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pandas as pd  # noqa: E402
from src.cfb import ol_unit as OU, link, cfbfastr  # noqa: E402

PASS = FAILED = 0


def chk(cond, label):
    global PASS, FAILED
    if cond:
        PASS += 1
        print("  PASS:", label)
    else:
        FAILED += 1
        print("  MISS:", label)


def play(team, rush, pas, sack, yg, down, dist, elo, garbage=False, conf="SEC"):
    # ("pass" is a keyword, so the rows are built as literals.)
    return {"pos_team": team, "rush": rush, "pass": pas, "sack": sack, "yards_gained": yg, "down": down,
            "distance": dist, "touchdown": 0, "conference": conf, "opp_elo": elo, "garbage": garbage}


def pbp(team, carries, sacks, dropbacks, garbage_tail=0):
    """One team's slate: `carries` rushes cycling through a yardage pattern, then dropbacks."""
    rows = []
    pattern = {"Good U": [6, 4, 8, 2, 12, 5, 3, 7], "Bad U": [-2, 0, 1, 3, -1, 2, 0, 4], "Mid U": [3, 4, 2, 5, 0, 6, 1, 4]}[team]
    elo = 1500 + (100 if team == "Good U" else 0)
    for i in range(carries):
        yg = pattern[i % len(pattern)]
        down, dist = (3, 1) if i % 10 == 0 else (1, 10)     # every tenth carry is a power down
        rows.append(play(team, 1, 0, 0, yg, down, dist, elo))
    for i in range(dropbacks):
        rows.append(play(team, 0, 1, 1 if i < sacks else 0, 0, 1, 10, elo))
    for i in range(garbage_tail):   # blowout snaps: ignored entirely
        rows.append(play(team, 1, 0, 0, -5, 1, 10, elo, garbage=True))
    return rows


print("=== the unit table ===")
df = pd.DataFrame(pbp("Good U", 200, 4, 200, garbage_tail=40) + pbp("Bad U", 200, 20, 200) + pbp("Mid U", 200, 10, 200)
                  + [play("Tiny U", 1, 0, 0, 3, 1, 10, 1200, conf="FCS")] * 20)
t = OU.unit_table(df)
chk(set(t) == {"Good U", "Bad U", "Mid U"}, "units under the carry floor (Tiny U, 20 carries) are dropped")
g, b = t["Good U"], t["Bad U"]
chk(g["rushes"] == 200 and g["dropbacks"] == 200, "carries and dropbacks counted; garbage-time snaps are not")
chk(g["ly"] > t["Mid U"]["ly"] > b["ly"], "line yards per carry orders the three lines")
chk(b["stuff"] == 50.0 and b["tfl"] == 25.0 and g["stuff"] == 0.0, "stuff % (≤0: 4 of 8 in the pattern) and TFL % (<0: 2 of 8)")
chk(g["power"] == 100.0 and b["power"] < 100.0, "power success on 3rd/4th-and-≤2 carries")
chk(g["sack"] == 2.0 and b["sack"] == 10.0, "sack rate per dropback")
chk(g["pct"]["ly"] == 100 and g["pct"]["sack"] == 100 and b["pct"]["ly"] < g["pct"]["ly"] and b["pct"]["sack"] < t["Mid U"]["pct"]["sack"],
    "percentiles: 100 is best for the line on every metric, the rate ones inverted")
chk(g["opp_elo"] == 1600 and g["conf"] == "SEC" and g["pool"] == "FBS", "opponent Elo, conference and the ranking pool (FBS) ride along")
# An FCS unit is ranked among FCS units, not against the FBS field.
fcs = pd.DataFrame(pbp("Good U", 200, 4, 200) + [dict(p, pos_team="Small U", conference="Big Sky") for p in pbp("Bad U", 200, 20, 200)]
                   + [dict(p, pos_team="Smaller U", conference="Big Sky") for p in pbp("Mid U", 200, 10, 200)])
tf = OU.unit_table(fcs)
chk(tf["Small U"]["pool"] == "FCS" and tf["Smaller U"]["pct"]["ly"] == 100 and tf["Good U"]["pct"]["ly"] == 100,
    "an FCS line is ranked among FCS lines (the better of the two Big Sky units is 100th there, as the lone FBS unit is in its pool)")

print("=== a rookie lineman's profile from his roster seasons ===")
players = {"7": {"player_id": "7", "full_name": "Test Tackle", "position": "OT", "active": True, "years_exp": 0, "college": "Good U"},
           "8": {"player_id": "8", "full_name": "Skill Guy", "position": "WR", "active": True, "years_exp": 0, "college": "Good U"}}
link.DB_SEASON = 2026
entry = {"teams": {"Good U"}, "seasons": {2023, 2024, 2025}, "positions": {"OL"}, "firsts": {"test"},
         "by_season": {2023: "Mid U", 2024: "Good U", 2025: "Good U"}}
link.roster_index = lambda seasons: {"full": {"testtackle": {"111": entry}}, "last": {"tackle": {"111": entry}}}
guards_seen = []
_orig_link_pool = link._link_pool
def _fake_link_pool(pool, draft_class, cache_path, refresh=False, espn_seasons=None):
    guards_seen.append(set(link.POS_GUARD))
    return {str(p["player_id"]): {"athlete_id": "111", "method": "name", "college": "Good U", "name": p["full_name"], "pos": p["position"]} for p in pool}
link._link_pool = _fake_link_pool
OU._UNITS.clear()
cfbfastr.load_pbp = lambda season: df.assign(garbage=df["garbage"])
OU.MIN_RUSHES = 150
prof = OU.build(players, 2026, verbose=False)
chk(list(prof) == ["7"], "only the lineman is linked (the receiver belongs to the skill pipeline)")
chk(guards_seen and "OL" in guards_seen[0] and "WR" not in guards_seen[0] and link.POS_GUARD == link._POS_SKILL,
    "the roster guard is swapped to the line positions for the link and restored after")
p = prof["7"]
chk(p["pos"] == "OT" and p["college"] == "Good U" and p["ol_unit"]["schema"] == OU.SCHEMA, "the profile carries name, position, school, schema")
rows = p["ol_unit"]["seasons"]
chk([r["season"] for r in rows] == [2023, 2024, 2025] and rows[0]["team"] == "Mid U" and rows[1]["team"] == "Good U",
    "one unit row per roster season, at the school he was on that year (a transfer keeps both)")
chk(rows[2]["pct"]["ly"] == 100 and rows[0]["pct"]["ly"] < 100, "each row carries that season's unit metrics and percentiles")
link._link_pool = _orig_link_pool

print(f"\nRESULT: {'PASS' if FAILED == 0 else 'MISS'} ({PASS}/{PASS + FAILED} checks)")
sys.exit(0 if FAILED == 0 else 1)
