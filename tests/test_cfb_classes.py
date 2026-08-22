#!/usr/bin/env python3
"""Offline tests for bucketing the projected player pool by rookie year (src/cfb/link.py),
which is what extends college profiles from the rookie class to every projected veteran."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from src.cfb import link

passed = failed = 0
def chk(c, label):
    global passed, failed
    if c: passed += 1; print("  PASS:", label)
    else: failed += 1; print("  FAIL:", label)

print("=== draft_class_of ===")
chk(link.draft_class_of({"years_exp": 0}, 2026) == 2026, "a rookie is the current class")
chk(link.draft_class_of({"years_exp": 3}, 2026) == 2023, "years_exp counts back from the season")
chk(link.draft_class_of({"years_exp": 3, "metadata": {"rookie_year": "2022"}}, 2026) == 2022,
    "rookie_year wins over years_exp when present")
chk(link.draft_class_of({"years_exp": 3, "metadata": {"rookie_year": "0"}}, 2026) == 2023,
    "a zero rookie_year is ignored")
chk(link.draft_class_of({}, 2026) is None, "no signal → no class")
chk(link.draft_class_of({"years_exp": None}, 2026) is None, "null years_exp → no class")

print("\n=== class_pools ===")
players = {
    "1": {"position": "WR", "active": True, "years_exp": 0},
    "2": {"position": "WR", "active": True, "years_exp": 3},
    "3": {"position": "RB", "active": True, "years_exp": 12},          # 2014: before college pbp
    "4": {"position": "K",  "active": True, "years_exp": 2},           # not a skill position
    "5": {"position": "QB", "active": False, "years_exp": 2},          # retired
    "6": {"position": "TE", "active": True, "years_exp": 2},           # not in the projected pool
}
pools = link.class_pools(players, 2026, only_pids={"1", "2", "3", "4", "5"})
chk(sorted(pools) == [2023, 2026], f"buckets by rookie year ({sorted(pools)})")
chk([p["player_id"] for p in pools[2026]] == ["1"], "rookie lands in the current class")
chk([p["player_id"] for p in pools[2023]] == ["2"], "veteran lands in his own class")
chk(all("3" != p["player_id"] for ps in pools.values() for p in ps),
    "pre-2015 draftees are skipped (no college play-by-play exists)")
chk(all("6" != p["player_id"] for ps in pools.values() for p in ps),
    "players outside the projected pool are not linked")
chk(link.EARLIEST_LINKABLE_CLASS == 2015, "earliest class pinned to the first pbp season + 1")

print(f"\nRESULT: {passed}/{passed + failed} " + ("ALL PASS" if not failed else "SOME FAILED"))
sys.exit(0 if not failed else 1)
