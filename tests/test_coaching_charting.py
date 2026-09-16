"""The Playbook for the season in progress: with no participation file, the coaching-scheme
builder falls back (opt-in) to charted sets — FTN's QB alignment × backfield count, an assumed
TE/WR split flagged as such, real run lanes, no routes — in the same payload shape the sheet,
Red Zone and Scheme tabs already read; a frozen season never takes the fallback."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pandas as pd  # noqa: E402
from src.nflverse import nflverse as N  # noqa: E402

P = F = 0


def chk(c, label):
    global P, F
    if c:
        P += 1
        print("  PASS:", label)
    else:
        F += 1
        print("  FAIL:", label)


pbp_rows, ftn_rows = [], []


def play(pid, team, is_pass, loc, backs, down=1, ytg=10, y100=50, pa=False, motion=False, lane=None, rec=None, rusher=None, td=0):
    pbp_rows.append({"game_id": "G1", "play_id": pid, "posteam": team, "play_type": "pass" if is_pass else "run",
                     "pass": int(is_pass), "rush_attempt": int(not is_pass), "qb_scramble": 0, "epa": 0.1 if is_pass else -0.05,
                     "success": 1 if is_pass else 0, "down": down, "ydstogo": ytg, "yardline_100": y100, "season_type": "REG",
                     "shotgun": 1 if loc == "shotgun" else 0, "run_location": (lane or ["middle"])[0] if not is_pass else None,
                     "run_gap": (lane or [None, None])[1] if not is_pass else None,
                     "receiver_player_id": rec if is_pass else None, "rusher_player_id": rusher if not is_pass else None,
                     "yards_gained": 8 if is_pass else 3, "pass_touchdown": td if is_pass else 0, "rush_touchdown": td if not is_pass else 0})
    ftn_rows.append({"nflverse_game_id": "G1", "nflverse_play_id": pid, "is_motion": motion, "is_play_action": pa,
                     "is_no_huddle": False, "qb_location": loc, "n_offense_backfield": backs})


pid = 0
for i in range(12):   # DET: shotgun, one back, throws; a few under-center two-back runs; a red-zone pass
    pid += 1; play(pid, "DET", True, "shotgun", 1, rec="W1" if i % 2 == 0 else "T1", pa=(i % 4 == 0), motion=(i % 3 == 0))
for i in range(6):
    pid += 1; play(pid, "DET", False, "under center", 2, lane=["right", "guard"], rusher="R1")
pid += 1; play(pid, "DET", True, "shotgun", 1, down=3, ytg=2, y100=12, rec="W1", td=1)
pid += 1; play(pid, "DET", True, None, None, rec="W1")   # not charted yet by FTN: left out
for i in range(8):
    pid += 1; play(pid, "SEA", False, "pistol", 1, lane=["left", "end"], rusher="R2")
pbp = pd.DataFrame(pbp_rows)
ftn = pd.DataFrame(ftn_rows)
roster = pd.DataFrame([{"gsis_id": "W1", "full_name": "Amon-Ra St. Brown", "position": "WR", "team": "DET", "jersey_number": 14},
                       {"gsis_id": "T1", "full_name": "Sam LaPorta", "position": "TE", "team": "DET", "jersey_number": 87},
                       {"gsis_id": "R1", "full_name": "Jahmyr Gibbs", "position": "RB", "team": "DET", "jersey_number": 26},
                       {"gsis_id": "R2", "full_name": "Kenneth Walker", "position": "RB", "team": "SEA", "jersey_number": 9}])
part = pd.DataFrame([{"nflverse_game_id": "G1", "play_id": r["play_id"], "offense_personnel": "1 RB, 1 TE, 3 WR",
                      "offense_formation": "SHOTGUN", "route": "GO" if r["pass"] else None} for r in pbp_rows])

state = {"part": None}


def fake_aux(url, **kw):
    if "pbp_participation" in url:
        if state["part"] is None:
            raise RuntimeError("404: participation publishes after the season")
        return state["part"]
    if "ftn_charting" in url:
        return ftn
    if "roster" in url:
        return roster
    raise RuntimeError("unexpected " + url)


N._load_pbp = lambda season, cols=None: pbp
N._aux_csv = fake_aux

print("=== a frozen season never takes the fallback ===")
chk(N.coaching_scheme(2026) == {}, "no participation and no opt-in → empty, as before")

print("=== the season in progress: charted sets ===")
out = N.coaching_scheme(2026, allow_charting_only=True)
det = out.get("DET")
chk(det is not None and det.get("charting_only") is True and out["SEA"].get("charting_only") is True, "teams come back marked charting_only")
forms = det["formations"]
names = {f["name"] for f in forms.values()}
chk(names == {"SHOTGUN", "I-FORM"} and all(f.get("pers_assumed") for f in forms.values()), f"sets are named by alignment × backfield ({sorted(names)}), each flagged pers_assumed")
gun = next(f for f in forms.values() if f["name"] == "SHOTGUN")
chk(gun["p"] == "1B" and gun["backs"] == 1 and (gun["te"], gun["wr"]) == (1, 3) and gun["ol"] == 5, "a one-back shotgun set carries the 1B code and the assumed 1 TE / 3 WR split")
chk(all(a["routes"] == [] for f in forms.values() for a in f["assigns"]) and any(a["name"] == "Brown" for a in gun["assigns"]), "assigns place players by target rank with no routes")
node = det["views"]["all"]["all"]["all"]
chk(node["total"] == 19 and sum(g["n"] for g in node["groups"]) == 19, "the uncharted play is left out; the rest are counted")
iform = next(g for g in node["groups"] if forms[g["sig"]]["name"] == "I-FORM")
chk(iform["lanes"] and iform["lanes"][0][0] == "RG" and iform["lanes"][0][1] == 6, "run lanes are the real pbp gaps")
chk("redzone" in det["views"]["3"]["short"] and det["views"]["3"]["short"]["redzone"]["groups"][0]["ptd"] == 1, "the red-zone view (3rd & short) holds the touchdown")
chk("pa" in det["views"]["all"]["all"] and det["views"]["all"]["all"]["pa"]["total"] == 3, "the play-action view comes from FTN")
chk(out["SEA"]["formations"] and next(iter(out["SEA"]["formations"].values()))["name"] == "PISTOL", "a pistol team charts as PISTOL")

print("=== the participation file arrives: the real payload, unflagged ===")
state["part"] = part
full = N.coaching_scheme(2026, allow_charting_only=True)
f2 = full["DET"]["formations"]
chk("charting_only" not in full["DET"] and all(not f.get("pers_assumed") for f in f2.values()) and all(f["p"] == "11" for f in f2.values()), "with participation the payload is the usual 11-personnel one, no flags")

print(f"\nRESULT: {P}/{P + F} {'ALL PASS' if F == 0 else 'SOME FAILED'}")
sys.exit(0 if F == 0 else 1)
