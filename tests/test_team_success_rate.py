"""Team rush / pass success rate and EPA split rates on the Advanced tab's offense and defense
tables: the whole team's rushes and dropbacks (nflverse `success`), ranked with the league —
higher is better on offense, lower (allowed) on defense — from the one builder the frozen
seasons and the in-season sidecar share."""
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


rows = []


def play(off, de, pt, succ, wk=1, yds=5, epa=0.1):
    rows.append({"posteam": off, "defteam": de, "play_type": pt, "success": succ, "week": wk, "yards_gained": yds,
                 "epa": epa, "game_id": f"g{wk}{off}", "fixed_drive": 1, "fixed_drive_result": "Touchdown", "series_result": "First down"})


# HOT runs well (3 of 4 successful) and throws badly (1 of 4); COLD the reverse. Each defends the other.
for i in range(4):
    play("HOT", "COLD", "run", 1 if i < 3 else 0)
    play("HOT", "COLD", "pass", 1 if i < 1 else 0)
    play("COLD", "HOT", "run", 1 if i < 1 else 0)
    play("COLD", "HOT", "pass", 1 if i < 3 else 0)
d = pd.DataFrame(rows)
off = N._side_table(d, "posteam", [1])
dfn = N._side_table(d, "defteam", [1], defense=True)

print("=== the columns ===")
chk("Rush Success Rate" in off.columns and "Pass Success Rate" in off.columns, "offense table carries rush and pass success rate")
chk(off.loc["HOT", "Rush Success Rate"] == 75.0 and off.loc["HOT", "Pass Success Rate"] == 25.0
    and off.loc["COLD", "Rush Success Rate"] == 25.0 and off.loc["COLD", "Pass Success Rate"] == 75.0, "the rates are the team's own: HOT 75% rush / 25% pass, COLD the reverse")
chk(dfn.loc["COLD", "Rush Success Rate"] == 75.0 and dfn.loc["HOT", "Pass Success Rate"] == 75.0, "the defense table holds the rates ALLOWED (COLD allowed HOT's 75% rush)")
chk(len(off.columns) == 10, "the six Sharp-shaped columns, two success rates, and two EPA split rates")

print("=== the ranks ===")
so = N._shape_team(off)
sd = N._shape_team(dfn, lower_better=N._DEF_LOWER_BETTER)
chk(so["teams"]["HOT"]["ranks"]["Rush Success Rate"] == 1 and so["teams"]["COLD"]["ranks"]["Pass Success Rate"] == 1, "offense: the higher rate ranks first")
chk(sd["teams"]["HOT"]["ranks"]["Rush Success Rate"] == 1 and sd["teams"]["COLD"]["ranks"]["Rush Success Rate"] == 2, "defense: the lower rate allowed ranks first")

print("=== no success column ===")
bare = N._side_table(d.drop(columns=["success"]), "posteam", [1])
chk("Rush Success Rate" in bare.columns and bare["Rush Success Rate"].isna().all(), "a frame without `success` gives empty rates, not a crash")

print(f"\nRESULT: {P}/{P + F} {'ALL PASS' if F == 0 else 'SOME FAILED'}")
sys.exit(0 if F == 0 else 1)
