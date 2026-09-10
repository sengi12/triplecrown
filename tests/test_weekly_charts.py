#!/usr/bin/env python3
"""Per-game chart builders (qb_passing_weekly / rb_fan_weekly / routes_weekly):
synthetic pbp in, per-game shapes out. No network — every loader monkeypatched."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "nflverse"))
import nflverse as nv  # noqa: E402
import pandas as pd  # noqa: E402

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}: {name}{'' if ok else ' — ' + str(detail)}")


def _pbp_pass():
    rows = []
    # QB q1: wk1 vs KC 9 attempts (one deep-left TD), wk2 vs BAL 10 attempts.
    for wk, opp, n in ((1, "KC", 9), (2, "BAL", 10)):
        for i in range(n):
            rows.append(dict(season_type="REG", week=wk, posteam="CIN", defteam=opp,
                             pass_attempt=1, sack=0, two_point_attempt=0,
                             complete_pass=1 if i % 2 == 0 else 0,
                             yards_gained=8, pass_touchdown=1 if (wk == 1 and i == 0) else 0,
                             interception=0, air_yards=25 if i == 0 else 5,
                             pass_location="left" if i == 0 else "middle",
                             passer_player_id="q1",
                             game_id=f"2026_{wk:02d}_X_CIN", play_id=i))
    # A 3-attempt relief appearance must fall under the per-game floor.
    for i in range(3):
        rows.append(dict(season_type="REG", week=1, posteam="CIN", defteam="KC",
                         pass_attempt=1, sack=0, two_point_attempt=0, complete_pass=1,
                         yards_gained=5, pass_touchdown=0, interception=0, air_yards=3,
                         pass_location="right", passer_player_id="q2",
                         game_id="2026_01_X_CIN", play_id=100 + i))
    return pd.DataFrame(rows)


def _pbp_rush():
    rows = []
    for wk, opp, n in ((1, "KC", 6), (2, "BAL", 7)):
        for i in range(n):
            rows.append(dict(season_type="REG", week=wk, posteam="CIN", defteam=opp,
                             rush_attempt=1, qb_scramble=0, two_point_attempt=0,
                             run_location="left" if i % 2 == 0 else "middle", run_gap="end",
                             yards_gained=4 + (i % 3), success=1 if i % 2 == 0 else 0,
                             rusher_player_id="r1",
                             game_id=f"2026_{wk:02d}_X_CIN", play_id=i))
    return pd.DataFrame(rows)


def main():
    nv._name_map = lambda season: {"q1": "test quarterback", "q2": "backup guy", "r1": "test back", "w1": "test receiver"}
    nv._pos_map = lambda season: {"w1": "WR"}

    print("=== qb_passing_weekly ===")
    nv._load_pbp = lambda season, cols=None: _pbp_pass()
    qw = nv.qb_passing_weekly(2026)
    check("per-game floor drops the 3-attempt relief appearance", "backup guy" not in qw)
    q = qw.get("test quarterback")
    check("both real games present, in week order",
          q is not None and [g["wk"] for g in q["games"]] == [1, 2])
    g1 = q["games"][0]
    check("opponent rides each game", g1["opp"] == "KC" and q["games"][1]["opp"] == "BAL")
    check("totals per game", g1["totals"]["attempts"] == 9 and g1["totals"]["td"] == 1)
    check("zones are sparse (only thrown-to cells ship)",
          "deep" in g1["zones"] and "left" in g1["zones"]["deep"]
          and g1["zones"]["deep"]["left"]["td"] == 1
          and "right" not in g1["zones"].get("short", {}))

    print("=== rb_fan_weekly ===")
    nv._load_pbp = lambda season, cols=None: _pbp_rush()
    rw = nv.rb_fan_weekly(2026)
    r = rw.get("test back")
    check("games in order with opponents",
          r is not None and [(g["wk"], g["opp"]) for g in r["games"]] == [(1, "KC"), (2, "BAL")])
    g = r["games"][0]
    check("game totals + per-lane splits",
          g["attempts"] == 6 and set(g["lanes"]) and
          sum(l["attempts"] for l in g["lanes"].values()) == 6)

    print("=== routes_weekly (participation missing = fail-soft empty) ===")
    def _boom(url, **kw):
        raise RuntimeError("no participation file yet")
    nv._aux_csv = _boom
    nv._load_pbp = lambda season, cols=None: _pbp_pass().assign(receiver_player_id="w1", receiving_yards=8.0)
    try:
        tw = nv.routes_weekly(2026)
        check("no participation upstream → builder raises/empty, sidecar omits (fail-soft)", tw == {})
    except Exception:
        check("no participation upstream → builder raises/empty, sidecar omits (fail-soft)", True)

    total, passed = len(RESULTS), sum(RESULTS)
    print(f"\nRESULT: {passed}/{total} {'ALL PASS' if passed == total else 'SOME FAILED'}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
