"""Time machine: truncate_inseason keeps only completed weeks (schedule stays whole)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.nflverse.inseason import truncate_inseason

blk = {
    "v": 1, "season": 2025, "weeks": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    "adv_weekly": {"2025": {"weeks": [1, 2, 3, 10, 11], "cols": ["a"],
                            "teams": {"KC": [[1], [2], [3], [10], [11]], "MIN": [[1], [2], [3], [10], [11]]}}},
    "player_weekly": {"cols": ["tgt"], "players": {
        "p1": {"n": "A", "p": "WR", "t": "KC", "w": {"1": [5], "9": [6], "10": [7]}},
        "p2": {"n": "B", "p": "WR", "t": "KC", "w": {"11": [7]}}}},
    "def_vs_pos": {"cols": ["tgt"], "teams": {"KC": {"WR": {"1": [1], "10": [2]}}}},
    "schedule": {"KC": {"1": "LAC", "10": "BYE?", "11": "DEN", "17": "LV"}},
}
out = truncate_inseason(blk, 9)
fails = 0
def chk(c, l):
    global fails
    print(("  PASS: " if c else "  FAIL: ") + l); fails += (0 if c else 1)
chk(out["weeks"] == list(range(1, 10)), "weeks list stops at 9")
chk(out["adv_weekly"]["2025"]["weeks"] == [1, 2, 3], "adv_weekly weeks trimmed")
chk(out["adv_weekly"]["2025"]["teams"]["KC"] == [[1], [2], [3]], "adv_weekly rows trimmed in step with weeks")
chk(out["player_weekly"]["players"]["p1"]["w"] == {"1": [5], "9": [6]}, "player weeks > 9 dropped")
chk("p2" not in out["player_weekly"]["players"], "a player with only future weeks is dropped")
chk(out["def_vs_pos"]["teams"]["KC"]["WR"] == {"1": [1]}, "def_vs_pos trimmed")
chk(out["schedule"]["KC"]["17"] == "LV", "schedule keeps future weeks")
chk(truncate_inseason({}, 9) == {} and truncate_inseason(None, 9) is None, "empty/None pass through")
print(f"\nRESULT: {8-fails}/8 {'ALL PASS' if not fails else 'SOME FAILED'}")
sys.exit(1 if fails else 0)
