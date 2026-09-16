"""The Playbook for the season in progress: with no participation file, the coaching-scheme
builder falls back (opt-in) to charted sets — FTN's QB alignment × backfield count, the TE/WR
split the team used most from that set last season (a real personnel code, flagged), real run
lanes, and routes ESTIMATED from this season's target zones read through last season's
route-by-zone habits — in the payload shape the sheet, Red Zone and Scheme tabs already read.
A frozen season never takes the fallback."""
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


def play(pid, team, is_pass, loc, backs, down=1, ytg=10, y100=50, pa=False, motion=False, lane=None, rec=None, rusher=None, td=0, air=None, side=None):
    pbp_rows.append({"game_id": "G1", "play_id": pid, "posteam": team, "play_type": "pass" if is_pass else "run",
                     "pass": int(is_pass), "rush_attempt": int(not is_pass), "qb_scramble": 0, "epa": 0.1 if is_pass else -0.05,
                     "success": 1 if is_pass else 0, "down": down, "ydstogo": ytg, "yardline_100": y100, "season_type": "REG",
                     "shotgun": 1 if loc == "shotgun" else 0, "run_location": (lane or ["middle"])[0] if not is_pass else None,
                     "run_gap": (lane or [None, None])[1] if not is_pass else None,
                     "receiver_player_id": rec if is_pass else None, "rusher_player_id": rusher if not is_pass else None,
                     "yards_gained": 8 if is_pass else 3, "pass_touchdown": td if is_pass else 0, "rush_touchdown": td if not is_pass else 0,
                     "air_yards": air if is_pass else None, "pass_location": side if is_pass else None})
    ftn_rows.append({"nflverse_game_id": "G1", "nflverse_play_id": pid, "is_motion": motion, "is_play_action": pa,
                     "is_no_huddle": False, "qb_location": loc, "n_offense_backfield": backs})


pid = 0
# DET 2026: shotgun one-back throws — W1 targeted deep right, the rookie W2 deep right too; a few
# under-center two-back runs; a red-zone pass; an uncharted play. SEA: pistol runs.
for i in range(12):
    pid += 1
    play(pid, "DET", True, "S", 1, rec=("W1" if i % 2 == 0 else "W2"), pa=(i % 4 == 0), motion=(i % 3 == 0), air=25, side="right")
for i in range(6):
    pid += 1
    play(pid, "DET", False, "U", 2, lane=["right", "guard"], rusher="R1")
pid += 1
play(pid, "DET", True, "S", 1, down=3, ytg=2, y100=12, rec="W1", td=1, air=8, side="left")
pid += 1
play(pid, "DET", True, None, None, rec="W1", air=5, side="middle")   # not charted yet by FTN: left out
for i in range(8):
    pid += 1
    play(pid, "SEA", False, "P", 1, lane=["left", "end"], rusher="R2")
pbp = pd.DataFrame(pbp_rows)
ftn = pd.DataFrame(ftn_rows)
roster = pd.DataFrame([{"gsis_id": "W1", "full_name": "Amon-Ra St. Brown", "position": "WR", "team": "DET", "jersey_number": 14},
                       {"gsis_id": "W2", "full_name": "Isaac TeSlaa", "position": "WR", "team": "DET", "jersey_number": 18},
                       {"gsis_id": "T1", "full_name": "Sam LaPorta", "position": "TE", "team": "DET", "jersey_number": 87},
                       {"gsis_id": "R1", "full_name": "Jahmyr Gibbs", "position": "RB", "team": "DET", "jersey_number": 26},
                       {"gsis_id": "R2", "full_name": "Kenneth Walker", "position": "RB", "team": "SEA", "jersey_number": 9}])
part = pd.DataFrame([{"nflverse_game_id": "G1", "play_id": r["play_id"], "offense_personnel": "1 RB, 1 TE, 3 WR",
                      "offense_formation": "SHOTGUN", "route": "GO" if r["pass"] else None} for r in pbp_rows])

# 2025 (the prior): DET's one-back shotgun was 12 personnel most of the time; W1 ran GO on deep-right
# targets and SLANT on short-left ones; LaPorta (no 2026 targets) has a season tree; the league's
# WRs ran POST deep right. The rookie W2 has no 2025 at all.
prev_rows, prev_part = [], []


def prev(pid, team, personnel, formation, rec=None, route=None, air=None, side=None):
    is_pass = rec is not None
    prev_rows.append({"game_id": "P1", "play_id": pid, "posteam": team, "play_type": "pass" if is_pass else "run", "pass": int(is_pass),
                      "season_type": "REG", "shotgun": 1 if formation == "SHOTGUN" else 0, "air_yards": air, "pass_location": side,
                      "receiver_player_id": rec})
    prev_part.append({"nflverse_game_id": "P1", "play_id": pid, "offense_personnel": personnel, "offense_formation": formation, "route": route})


q = 0
for i in range(7):
    q += 1; prev(q, "DET", "1 RB, 2 TE, 2 WR", "SHOTGUN", rec="W1", route="GO", air=22, side="right")
for i in range(3):
    q += 1; prev(q, "DET", "1 RB, 1 TE, 3 WR", "SHOTGUN", rec="W1", route="SLANT", air=4, side="left")
for i in range(4):
    q += 1; prev(q, "DET", "2 RB, 1 TE, 2 WR", "UNDER CENTER")
for i in range(5):
    q += 1; prev(q, "DET", "1 RB, 2 TE, 2 WR", "SHOTGUN", rec="T1", route="SEAM", air=12, side="middle")
for i in range(9):
    q += 1; prev(q, "SEA", "1 RB, 1 TE, 3 WR", "SHOTGUN", rec="X9", route="POST", air=24, side="right")
for i in range(5):
    q += 1; prev(q, "DET", "2 RB, 1 TE, 2 WR", "UNDER CENTER", rec="R1", route="SWING", air=-2, side="left")
prev_pbp = pd.DataFrame(prev_rows)
prev_part = pd.DataFrame(prev_part)
prev_roster = pd.DataFrame([{"gsis_id": "W1", "position": "WR"}, {"gsis_id": "T1", "position": "TE"}, {"gsis_id": "X9", "position": "WR"}, {"gsis_id": "R1", "position": "RB"}])

state = {"part": None}


def fake_aux(url, **kw):
    if "pbp_participation" in url:
        if "2025" in url:
            return prev_part
        if state["part"] is None:
            raise RuntimeError("404: participation publishes after the season")
        return state["part"]
    if "ftn_charting" in url:
        return ftn
    if "roster" in url:
        return prev_roster if "2025" in url else roster
    raise RuntimeError("unexpected " + url)


N._load_pbp = lambda season, cols=None: prev_pbp if int(season) == 2025 else pbp
N._aux_csv = fake_aux

print("=== a frozen season never takes the fallback ===")
chk(N.coaching_scheme(2026) == {}, "no participation and no opt-in → empty, as before")

print("=== the season in progress: charted sets with last season's personnel ===")
out = N.coaching_scheme(2026, allow_charting_only=True)
det = out.get("DET")
chk(det is not None and det.get("charting_only") is True and out["SEA"].get("charting_only") is True, "teams come back marked charting_only")
forms = det["formations"]
names = {f["name"] for f in forms.values()}
chk(names == {"SHOTGUN", "I-FORM"} and all(f.get("pers_assumed") for f in forms.values()), f"sets are named by alignment × backfield ({sorted(names)}), each flagged pers_assumed")
gun = next(f for f in forms.values() if f["name"] == "SHOTGUN")
iform_f = next(f for f in forms.values() if f["name"] == "I-FORM")
chk(gun["p"] == "12" and (gun["te"], gun["wr"]) == (2, 2) and gun["backs"] == 1, "DET's one-back shotgun reads 12 personnel — the split it used most last season")
chk(iform_f["p"] == "21" and (iform_f["te"], iform_f["wr"]) == (1, 2), "its two-back under-center set reads 21")
sea = next(iter(out["SEA"]["formations"].values()))
chk(sea["name"] == "PISTOL" and sea["p"] == "11", "a set the team never showed last season takes the common split for that backfield (11)")

print("=== estimated routes ===")
by_slot = {a["slot"]: a for a in gun["assigns"]}
w1 = next(a for a in gun["assigns"] if a["name"] == "Brown")
chk(w1["routes"] and w1["routes"][0][0] == "GO" and w1.get("src") == "inf", f"St. Brown, targeted deep right this season, is estimated on GO from his 2025 deep-right habit ({w1['routes'][:2]})")
w2 = next(a for a in gun["assigns"] if a["name"] == "TeSlaa")
chk(w2["routes"] and w2["routes"][0][0] == "POST" and w2.get("src") == "inf", f"the rookie with no 2025 takes the league's WR deep-right habit (POST over GO, 9 to 7) ({w2['routes'][:2]})")
rb = next((a for a in iform_f["assigns"] if a["name"] == "Gibbs"), None)
chk(rb is not None and rb["routes"] and rb["routes"][0][0] == "SWING" and rb.get("src") == "szn", "a back with carries but no targets yet keeps last season's tree, marked szn")
chk(all("src" not in a or a["src"] in ("inf", "szn") for f in forms.values() for a in f["assigns"]), "every assign's source is one of the two, or absent")
node = det["views"]["all"]["all"]["all"]
chk(node["total"] == 19 and sum(g["n"] for g in node["groups"]) == 19, "the uncharted play is left out; the rest are counted")
iform = next(g for g in node["groups"] if forms[g["sig"]]["name"] == "I-FORM")
chk(iform["lanes"] and iform["lanes"][0][0] == "RG" and iform["lanes"][0][1] == 6, "run lanes are the real pbp gaps")
chk("redzone" in det["views"]["3"]["short"] and det["views"]["3"]["short"]["redzone"]["groups"][0]["ptd"] == 1, "the red-zone view (3rd & short) holds the touchdown")
chk("pa" in det["views"]["all"]["all"] and det["views"]["all"]["all"]["pa"]["total"] == 3, "the play-action view comes from FTN")

print("=== the priors themselves ===")
pr = N._charted_priors(2025)
chk(pr["split"][("DET", "gun", 1)] == (2, 2) and pr["split"][("DET", "uc", 2)] == (1, 2), "the split table is per team × alignment × backs")
chk(N._tgt_zone(25, "right") == "dR" and N._tgt_zone(4, "left") == "sL" and N._tgt_zone(-2, "middle") == "bM" and N._tgt_zone(15, None) is None, "target zones: depth by air yards × direction; no direction, no zone")
est = N._infer_routes("W1", ["dR", "dR", "sL"], pr, "WR")
chk(est[0][0] == "GO" and any(r == "SLANT" for r, _ in est) and abs(sum(p for _, p in est) - 100) < 0.6, f"two deep-right targets and a short-left one → GO first, SLANT present, shares sum to 100 ({est})")
chk(N._infer_routes("W1", [], pr, "WR") == [] and N._infer_routes("W1", ["dR"], None, "WR") == [], "no targets or no prior → nothing invented")

print("=== the participation file arrives: the real payload, unflagged ===")
state["part"] = part
full = N.coaching_scheme(2026, allow_charting_only=True)
f2 = full["DET"]["formations"]
chk("charting_only" not in full["DET"] and all(not f.get("pers_assumed") for f in f2.values()) and all(f["p"] == "11" for f in f2.values())
    and all("src" not in a for f in f2.values() for a in f["assigns"]), "with participation the payload is the usual 11-personnel one, no flags, no sources")

print(f"\nRESULT: {P}/{P + F} {'ALL PASS' if F == 0 else 'SOME FAILED'}")
sys.exit(0 if F == 0 else 1)
