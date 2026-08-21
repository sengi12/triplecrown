#!/usr/bin/env python3
"""The pipeline's NFL-state block: month-aware season fallback (Jan/Feb belong to the PRIOR
league year — the old calendar-year fallback was wrong for two months of every year) and the
shape of the `state` block the seed carries so the app can gate in-season features offline."""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build_seed as BS  # noqa: E402

PASS = FAILED = 0


def chk(cond, label):
    global PASS, FAILED
    if cond:
        PASS += 1
        print("  PASS:", label)
    else:
        FAILED += 1
        print("  MISS:", label)


print("=== month-aware league year ===")
jan = time.gmtime(time.mktime((2028, 1, 15, 12, 0, 0, 0, 0, 0)))
feb = time.gmtime(time.mktime((2028, 2, 28, 12, 0, 0, 0, 0, 0)))
mar = time.gmtime(time.mktime((2028, 3, 2, 12, 0, 0, 0, 0, 0)))
sep = time.gmtime(time.mktime((2028, 9, 10, 12, 0, 0, 0, 0, 0)))
chk(BS._nfl_season_for(jan) == 2027, "Jan 2028 → league year 2027")
chk(BS._nfl_season_for(feb) == 2027, "Feb 2028 → league year 2027")
chk(BS._nfl_season_for(mar) == 2028, "Mar 2028 → league year 2028")
chk(BS._nfl_season_for(sep) == 2028, "Sep 2028 → league year 2028")

print("\n=== _sleeper_state fallback when the probe errors out ===")
real_urlopen = BS.request.urlopen


def _boom(*a, **k):
    raise OSError("offline")


BS.request.urlopen = _boom
try:
    st = BS._sleeper_state()
finally:
    BS.request.urlopen = real_urlopen
chk(set(st) == {"season", "season_type", "week"}, "fallback state has the full shape")
chk(st["season_type"] == "off" and st["week"] == 0, "fallback is a quiet offseason")
chk(2000 <= st["season"] <= 2100, "fallback season is sane")

print("\n=== module state ===")
chk(set(BS.TC_STATE) == {"season", "season_type", "week"}, "TC_STATE carries season/season_type/week")
chk(BS.TC_STATE["season_type"] in ("pre", "regular", "post", "off"), "season_type is one of the four phases")
chk(BS.DEFAULT_PROJ_SEASON == BS.TC_STATE["season"], "DEFAULT_PROJ_SEASON derives from TC_STATE")
chk(0 <= BS.TC_STATE["week"] <= 23, "week bounded")

print(f"\nRESULT: {'PASS' if FAILED == 0 else 'MISS'} ({PASS}/{PASS + FAILED} checks)")
sys.exit(0 if FAILED == 0 else 1)
