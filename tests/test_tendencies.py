"""Play-calling tendencies from a synthetic play-by-play: situations beside the league,
guessability beyond the situation, sequencing, the play-action setup test, motion, the
defence's blitz habits and box counts."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pandas as pd  # noqa: E402
from src.nflverse import tendencies as T  # noqa: E402

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


def play(game, pid, off, de, down, ytg, y100, diff, qtr, is_pass, epa, drive, pa=False, motion=False, blitz=False, box=7, loc="shotgun", hit=0, sack=0):
    rows.append({"game_id": game, "play_id": pid, "posteam": off, "defteam": de, "week": 1, "season_type": "REG",
                 "play_type": "pass" if is_pass else "run", "pass": int(is_pass), "rush": int(not is_pass),
                 "down": down, "ydstogo": ytg, "yardline_100": y100, "score_differential": diff, "qtr": qtr,
                 "epa": epa, "success": int(epa > 0), "qb_kneel": 0, "qb_spike": 0, "qb_hit": hit, "sack": sack, "shotgun": 1,
                 "fixed_drive": drive, "is_motion": motion, "is_play_action": pa, "is_no_huddle": False,
                 "qb_location": loc, "n_blitzers": 2 if blitz else 0, "n_defense_box": box})


# ROB (robotic): always passes on 3rd & long, always runs on 1st down. MIX: a coin flip everywhere.
pid = 0
for g in range(6):
    game = f"G{g}"
    for i in range(20):
        pid += 1
        play(game, pid, "ROB", "DEF", 1, 10, 50, 0, 1, False, 0.1, i, blitz=(i % 3 == 0), box=8, loc="under_center")
        pid += 1
        play(game, pid, "ROB", "DEF", 3, 9, 50, 0, 1, True, 0.2, i, pa=(i % 2 == 0), motion=(i % 2 == 0), blitz=(i % 3 == 0), loc="shotgun", hit=1 if i % 3 == 0 else 0)
    for i in range(20):
        pid += 1
        play(game, pid, "MIX", "DEF", 1, 10, 50, 0, 1, i % 2 == 0, 0.0, i, blitz=False, box=6, loc="shotgun")
        pid += 1
        play(game, pid, "MIX", "DEF", 3, 9, 50, 0, 1, i % 4 < 2, 0.0, i, pa=(i % 4 == 0), motion=False, blitz=False, loc="shotgun")
d = pd.DataFrame(rows)
out = T.tendencies_from_frame(d)
rob, mix, lg = out["teams"]["ROB"]["offense"], out["teams"]["MIX"]["offense"], out["league"]["offense"]

print("=== situations beside the league ===")
chk(out["schema"] == T.SCHEMA and out["n_teams"] >= 2 and out["has_ftn"], "the block names its schema, counts teams, and saw FTN charting")
chk(rob["situations"]["3rd & long"]["pass"] == 100.0 and rob["situations"]["1st"]["pass"] == 0.0, "ROB: 100% pass on 3rd & long, 0% on first down")
chk(rob["situations"]["3rd & long"]["lg"] == lg["situations"]["3rd & long"]["pass"] and 70 <= lg["situations"]["3rd & long"]["pass"] <= 80, "the league rate rides beside the team's (ROB's 100% + MIX's 50% → ~75%)")
chk(rob["situations"]["Red zone"]["pass"] is None and rob["situations"]["Red zone"]["n"] == 0, "a situation that never occurred prints no rate")
chk(rob["situations"]["3rd & long"]["epa"] == 0.2, "EPA per play in the situation")

print("=== guessability beyond the situation ===")
chk(rob["guess"]["team"] > mix["guess"]["team"] and rob["guess"]["team"] >= 90, f"a robotic caller is guessable ({rob['guess']['team']}) where a coin flip is not ({mix['guess']['team']})")
chk(rob["guess"]["beyond"] > 0 and mix["guess"]["beyond"] < 0, "beyond the situation: ROB adds guessability over the league's situation rates, MIX takes it away")
chk(rob["guess"]["situation"] == mix["guess"]["situation"] == lg["guess"]["team"], "the situation baseline is the league's own guess rate, the same for every team")

print("=== sequencing, play action, motion ===")
chk(rob["sequencing"]["pass_after_run"] == 100.0 and rob["sequencing"]["n_after_pass"] == 0, "ROB passes after every run (3rd & long follows 1st down in the same drive) and never has a play after a pass in a drive")
chk(rob["sequencing"]["formation_hold"] == 0.0 and mix["sequencing"]["formation_hold"] == 100.0, "formation hold: ROB switches under centre → shotgun every snap; MIX holds shotgun")
chk(rob["play_action"]["n"] == 60 and rob["play_action"]["epa"] == 0.2 and rob["play_action"]["n_after_run"] == 60 and rob["play_action"]["n_cold"] == 0, "play action counted, with the after-a-run vs cold split")
chk(rob["play_action"]["rate_early"] is None or rob["play_action"]["n_early"] == 0, "ROB throws no early-down passes, so the early-down PA rate is empty rather than invented")
chk(rob["motion"]["rate"] == 25.0 and rob["motion"]["epa"] == 0.2 and rob["motion"]["epa_without"] is not None, "motion: rate over charted plays, EPA with and without")

print("=== the defence ===")
de = out["teams"]["DEF"]["defense"]
chk(de["blitz"]["n"] == 240 and 15 <= de["blitz"]["rate"] <= 20, "blitz rate over the dropbacks it faced (ROB's every third drive, MIX never)")
chk(de["blitz"]["3rd & long"]["rate"] > de["blitz"]["rate"] and de["blitz"]["1st down"]["rate"] == 0.0 and de["blitz"]["Red zone"]["rate"] is None, "blitz by situation: only 3rd & long draws blitzes, first down never; an unseen situation prints nothing")
chk(de["blitz"]["pressure_with"] == 100.0 and de["blitz"]["pressure_without"] == 0.0, "what a blitz bought: pressure with vs without")
chk(de["blitz"]["after_blitz"] is not None and de["blitz"]["after_none"] is not None and de["blitz"]["streak_lift"] is not None, "the blitz streak: after a blitz vs after none")
chk(de["box"]["heavy"] == 50.0 and de["box"]["light"] == 25.0 and de["box"]["epa_heavy"] == 0.1, "box counts against the run: ROB's 120 runs saw 8 in the box, half of MIX's saw 6")

print("=== no charting at all ===")
bare = T.tendencies_from_frame(d.drop(columns=["is_motion", "is_play_action", "is_no_huddle", "qb_location", "n_blitzers", "n_defense_box"]))
chk(not bare["has_ftn"] and bare["teams"]["ROB"]["offense"]["motion"]["rate"] is None and bare["teams"]["DEF"]["defense"]["blitz"]["rate"] is None and bare["teams"]["ROB"]["offense"]["guess"]["team"] == rob["guess"]["team"], "without FTN the pbp-only tendencies stand and the charted ones are empty")
chk(T.tendencies_from_frame(d.iloc[:0])["n_teams"] == 0, "an empty frame is an empty block")

print(f"\nRESULT: {P}/{P + F} {'ALL PASS' if F == 0 else 'SOME FAILED'}")
sys.exit(0 if F == 0 else 1)
