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
    # Two sacks of q1 in week 1 (dropbacks, not attempts) — under duress.
    for i in (200, 201):
        rows.append(dict(season_type="REG", week=1, posteam="CIN", defteam="KC",
                         pass_attempt=0, sack=1, two_point_attempt=0, complete_pass=0,
                         yards_gained=-7, pass_touchdown=0, interception=0, air_yards=None,
                         pass_location=None, passer_player_id="q1",
                         game_id="2026_01_X_CIN", play_id=i))
    df = pd.DataFrame(rows)
    df["qb_dropback"] = 1; df["qb_scramble"] = 0; df["rusher_player_id"] = None
    # the pass map's columns: after-catch yards on completions, field position, quarter, receiver
    df["yards_after_catch"] = df["complete_pass"].map(lambda c: 3.0 if c == 1 else None)
    df["yardline_100"] = 50; df["qtr"] = 1
    df["receiver_player_name"] = ["J.Chase" if i % 3 == 0 else "T.Higgins" for i in range(len(df))]
    return df


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
    nv._name_map = lambda season: {"q1": "test quarterback", "q2": "backup guy", "r1": "test back", "w1": "test receiver", "w2": "other wideout", "r9": "pass catching back"}
    nv._pos_map = lambda season: {"w1": "WR"}

    print("=== qb_passing_weekly ===")
    nv._load_pbp = lambda season, cols=None: _pbp_pass()
    # Play context for the duress splits: week-1 plays 0-2 pressured, play 0 blitzed (5 rushers).
    _ctx = pd.DataFrame({"game_id": ["2026_01_X_CIN"] * 3 + ["2026_02_X_CIN"],
                         "play_id": [0, 1, 2, 0], "was_pressure": [True, True, True, False],
                         "number_of_pass_rushers": [5, 4, 4, 4]}).set_index(["game_id", "play_id"])
    nv._play_context = lambda season: _ctx
    nv._aux_parquet = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no PFR in test"))
    nv._QB_PFR_WEEK.clear()
    nv._esb_map = lambda season: {"q1": "QBX000001"}
    qw = nv.qb_passing_weekly(2026)
    _q1 = qw.get("test quarterback") or {}
    _g1 = (_q1.get("games") or [{}])[0]
    check("pass map: every located attempt is a row [air, side, result, yac, yardline, qtr, receiver] in play order",
          len(_g1.get("plays", [])) == 9 and _g1["plays"][0] == [25, 0, 2, 3, 50, 1, 0] and _g1["plays"][1] == [5, 1, 0, 0, 50, 1, 1])
    check("pass map: the receiver legend is per passer, in first-seen order, and the ESB id rides the node",
          _q1.get("rcv") == ["J.Chase", "T.Higgins"] and _q1.get("esb") == "QBX000001")
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
    # Under duress: the context says plays 0-2 were pressured (and play 0 blitzed); the two
    # sacks are pressured by definition. PFR is unavailable in the test → pfr is None.
    d = g1.get("duress")
    check("a duress block rides each game", d is not None and d["pfr"] is None)
    check("pressured = hit-or-sacked dropbacks: 3 attempts + 2 sacks",
          d["pressured"]["db"] == 5 and d["pressured"]["att"] == 3 and d["pressured"]["sk"] == 2
          and d["pressured"]["td"] == 1 and d["pressured"]["rating"] is not None)
    check("clean = the other 6 attempts, no sacks", d["clean"]["db"] == 6 and d["clean"]["sk"] == 0)
    check("blitzed = the one 5-rusher play", d["blitzed"]["db"] == 1 and d["blitzed"]["td"] == 1)
    check("a game with no pressured dropbacks reads None, not zeros",
          q["games"][1]["duress"]["pressured"] is None and q["games"][1]["duress"]["clean"]["db"] == 10)

    print("=== one QB box line: the passing chart's tiles and the Adv Metrics table agree ===")
    # An unlocated attempt (no pass_location) is still an official attempt: the tiles used to
    # count only located ones and disagreed with the table by a point or two of Comp %.
    pbp = _pbp_pass()
    extra = pbp.iloc[[0]].copy(); extra["pass_location"] = None; extra["complete_pass"] = 0; extra["pass_touchdown"] = 0; extra["yards_gained"] = 0; extra["play_id"] = 99
    # A third passer with a full workload (q1's plays again) so there is a pool of two to rank.
    third = pbp[pbp["passer_player_id"] == "q1"].copy(); third["passer_player_id"] = "q3"; third["complete_pass"] = 1
    pbp2 = pd.concat([pbp, extra, third], ignore_index=True)
    pbp2["qb_dropback"] = 1; pbp2["qb_scramble"] = 0; pbp2["rusher_player_id"] = None
    nv._load_pbp = lambda season, cols=None: pbp2
    prev_scale, prev_names = nv.MIN_SCALE, nv._name_map
    nv.MIN_SCALE = 1 / 17.0     # week 1 in season: the rank floor scales to its 15-dropback minimum
    nv._name_map = lambda season: {"q1": "test quarterback", "q2": "backup guy", "q3": "third passer"}
    try:
        z = nv.qb_passing_zones(2026, min_attempts=1)
        t = z["test quarterback"]["totals"]
        line = nv.qb_box_line(nv.qb_attempts(pbp2[pbp2["passer_player_id"] == "q1"]))
        check("the tiles read the official attempts (located + the unlocated one)",
              t["all_attempts"] == line["attempts"] == 20 and t["attempts"] == 19)
        check("Comp % over ALL attempts, exactly the shared helper's number",
              t["comp_pct"] == line["comp_pct"] == 50.0)
        check("yards / TD / INT / rating from the same line",
              t["yards"] == line["yards"] and t["td"] == line["td"] == 1 and t["passer_rating"] == line["passer_rating"])
        check("scramble rate is per dropback, the helper's definition",
              t["dropbacks"] == 22 and t["scramble_rate"] == 0.0)
        check("ranks attach only to QBs above the table's dropback floor (150 a season, floor 15): the 3-dropback backup is unranked",
              "rk" in t and t["rk"]["comp_pct"] == [2, 2] and "rk" not in z["backup guy"]["totals"])
    finally:
        nv.MIN_SCALE, nv._name_map = prev_scale, prev_names

    print("=== rb_fan_weekly ===")
    nv._load_pbp = lambda season, cols=None: _pbp_rush()
    nv._esb_map = lambda season: {"r1": "RBX000001"}
    rw = nv.rb_fan_weekly(2026)
    r = rw.get("test back")
    check("games in order with opponents",
          r is not None and [(g["wk"], g["opp"]) for g in r["games"]] == [(1, "KC"), (2, "BAL")])
    _g1 = r["games"][0]
    check("carry map: every carry is a row [lane, yards, flags, yardline, qtr] in play order — a frame without the flag columns still builds",
          len(_g1.get("plays", [])) == 6 and _g1["plays"][0] == [0, 4, 0, None, None] and _g1["plays"][1] == [3, 5, 0, None, None])
    check("carry map: the rusher carries his ESB id", r.get("esb") == "RBX000001")
    _rich = _pbp_rush().assign(rush_touchdown=lambda d: (d.play_id == 2).astype(int), fumble_lost=lambda d: (d.play_id == 3).astype(int),
                               first_down=lambda d: (d.play_id <= 2).astype(int), tackled_for_loss=0, yardline_100=50, qtr=2)
    _rich.loc[_rich.play_id == 4, "yards_gained"] = -3; _rich.loc[_rich.play_id == 4, "tackled_for_loss"] = 1
    nv._load_pbp = lambda season, cols=None: _rich
    _g1 = nv.rb_fan_weekly(2026)["test back"]["games"][0]
    check("carry map: flags are bits — TD 1, fumble lost 2, first down 4, tackled for loss 8 — with field position and quarter",
          _g1["plays"][2] == [0, 6, 5, 50, 2] and _g1["plays"][3] == [3, 4, 2, 50, 2] and _g1["plays"][4] == [0, -3, 8, 50, 2] and _g1["plays"][0][2] == 4)
    nv._load_pbp = lambda season, cols=None: _pbp_rush()
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

    print("=== scheme_weekly: the live game-plan card ===")
    def _pbp_scheme():
        rows=[]
        for wk, opp, n in ((1,"KC",8),(2,"BAL",6)):
            for i in range(n):
                rows.append(dict(game_id=f"g{wk}", play_id=i, posteam="CIN", defteam=opp,
                                 week=wk, play_type="pass" if i%2==0 else "run",
                                 **{"pass":1 if i%2==0 else 0}, shotgun=1 if i<5 else 0,
                                 season_type="REG"))
        return pd.DataFrame(rows)
    def _ftn_scheme(url, **kw):
        rows=[]
        for wk in (1,2):
            n=8 if wk==1 else 6
            for i in range(n):
                rows.append(dict(nflverse_game_id=f"g{wk}", nflverse_play_id=i,
                                 qb_location="S" if i<5 else "U", n_offense_backfield=1,
                                 n_defense_box=6+(i%2), is_motion=1 if i%3==0 else 0,
                                 is_play_action=0, is_rpo=0, is_screen_pass=0))
        return pd.DataFrame(rows)
    nv._load_pbp = lambda season, cols=None: _pbp_scheme()
    nv._aux_csv = _ftn_scheme
    sw = nv.scheme_weekly(2026)
    g = sw["CIN"]["games"][0]
    check("per-game card: plays, opponent, pbp rates",
          g["wk"]==1 and g["opp"]=="KC" and g["plays"]==8 and g["pass_rate"]==50.0)
    check("FTN enrichment: formation proxy + motion + box",
          g["formations"].get("s-1")==5 and g["motion_rate"] is not None and g["box_avg"] is not None)
    def _no_ftn(url, **kw):
        raise RuntimeError("48h not up yet")
    nv._aux_csv = _no_ftn
    sw2 = nv.scheme_weekly(2026)
    g2 = sw2["CIN"]["games"][0]
    check("FTN not published yet: pbp rates still LIVE, charted fields None (the season-opener reality)",
          g2["pass_rate"]==50.0 and g2["shotgun_rate"] is not None
          and g2["motion_rate"] is None and g2["formations"]=={})

    # ── Next Gen Stats per game: season-to-date line + games, medians borrowed from
    #    last season while too few players qualify ─────────────────────────────
    def _ngs_rec():
        rows = []
        # last season: 14 qualified receivers → the medians come from here
        for i in range(14):
            rows.append(dict(season=2025, season_type="REG", week=0, player_display_name=f"Old Guy{i}",
                             player_position="WR", team_abbr="CIN", avg_cushion=6.0+i*0.1, avg_separation=2.5+i*0.1,
                             avg_intended_air_yards=9.0, percent_share_of_intended_air_yards=20.0,
                             receptions=50, targets=80, catch_percentage=62.5, yards=700, rec_touchdowns=5,
                             avg_yac=4.0, avg_expected_yac=3.8, avg_yac_above_expectation=0.2, player_gsis_id=f"o{i}"))
        # a second WR and a back in 2026: receiving ranks must be WR-vs-WR only
        for nm, gid, ps, sep in (("Other Wideout", "w2", "WR", 2.0), ("Pass Catching Back", "r9", "RB", 9.9)):
            rows.append(dict(season=2026, season_type="REG", week=0, player_display_name=nm,
                             player_position=ps, team_abbr="CIN", avg_cushion=5.0, avg_separation=sep,
                             avg_intended_air_yards=3.0, percent_share_of_intended_air_yards=5.0,
                             receptions=3, targets=4, catch_percentage=75.0, yards=20, rec_touchdowns=0,
                             avg_yac=5.0, avg_expected_yac=5.0, avg_yac_above_expectation=0.0, player_gsis_id=gid))
        for wk in (0, 1):
            rows.append(dict(season=2026, season_type="REG", week=wk, player_display_name="Test Receiver",
                             player_position="WR", team_abbr="CIN", avg_cushion=7.1, avg_separation=3.4,
                             avg_intended_air_yards=8.2, percent_share_of_intended_air_yards=41.0,
                             receptions=8, targets=11, catch_percentage=72.7, yards=122, rec_touchdowns=1,
                             avg_yac=6.0, avg_expected_yac=1.7, avg_yac_above_expectation=4.3, player_gsis_id="w1"))
        return pd.DataFrame(rows)
    nv._aux_csv = lambda url, **kw: _ngs_rec() if "ngs_receiving" in url else (_ for _ in ()).throw(Exception("404"))
    nv.MAX_WEEK = None
    ngs = nv.ngs_weekly(2026)
    r = (ngs.get("players") or {}).get("test receiver")
    check("ngs_weekly: the receiver has a season line and a week-1 game",
          r is not None and r["kind"]=="rec" and r["season"].get("sep")==3.4
          and len(r["games"])==1 and r["games"][0]["wk"]==1 and r["games"][0]["tgt"]==11)
    check("ngs_weekly: passing/rushing feeds missing → receiving still ships",
          "qb" not in (ngs.get("lg") or {}) and "rec" in (ngs.get("lg") or {}))
    rk = (r.get("season") or {}).get("rk") or {}
    check("ngs_weekly: receiving ranks are per POSITION — the WR is #1 of 2 WRs, the back's 9.9 separation never counts",
          rk.get("sep") == [1, 2])
    med = ngs["lg"]["rec"]["sep"]
    check("ngs_weekly: with one qualified 2026 receiver the median is LAST season's (not his own number)",
          abs(med - 3.15) < 0.06 and med != 3.4)

    # ── target_trees_weekly: the target MAP rows (every throw), ESB ids, charted routes ──
    def _pbp_targets():
        rows = []
        # w1: wk1 — a caught 6-yard slant with 10 YAC, a 4-yard catch that scores from the 45,
        # an incomplete deep ball, a pick; wk2 — one catch.
        spec = [(1, 6, "right", 1, 0, 10, 0, 63, 1), (1, 4, "left", 1, 1, 41, 0, 45, 4),
                (1, 26, "middle", 0, 0, None, 0, 97, 2), (1, 12, "left", 0, 0, None, 1, 12, 3),
                (2, 9, "middle", 1, 0, 3, 0, 50, 1)]
        for i, (wk, ay, loc, comp, td, yac, intc, yl, q) in enumerate(spec):
            rows.append(dict(season_type="REG", week=wk, posteam="SEA", defteam="NE" if wk == 1 else "PIT",
                             receiver_player_id="w1", pass_attempt=1, complete_pass=comp, air_yards=ay,
                             pass_location=loc, receiving_yards=(ay + (yac or 0)) if comp else 0,
                             pass_touchdown=td, two_point_attempt=0, yards_after_catch=yac,
                             epa=0.5, first_down=comp, interception=intc, yardline_100=yl, qtr=q,
                             game_id=f"2025_{wk:02d}_SEA_X", play_id=10 + i))
        return pd.DataFrame(rows)
    nv._load_pbp = lambda season, cols=None: _pbp_targets()
    nv._name_map = lambda season: {"w1": "test receiver"}
    nv._pos_map = lambda season: {"w1": "WR"}
    nv._esb_map = lambda season: {"w1": "TES123456"}
    nv._aux_csv = lambda url, **kw: (_ for _ in ()).throw(Exception("404"))   # no charting in season
    nv.MAX_WEEK = None
    tt = nv.target_trees_weekly(2026, min_targets_game=1, min_targets_season=1)
    w = (tt.get("players") or {}).get("test receiver")
    g1 = w["games"][0] if w else {}
    check("target_trees: every target is a row [air, side, result, yac, yardline, qtr] in play order",
          w is not None and g1.get("wk") == 1 and g1.get("plays") == [[6, 2, 1, 10, 63, 1], [4, 0, 2, 41, 45, 4],
                                                                        [26, 1, 0, 0, 97, 2], [12, 0, 3, 0, 12, 3]])
    check("target_trees: the TD is result 2 (with its YAC), the pick is 3, an incompletion carries no YAC",
          g1.get("plays", [[]])[1][2] == 2 and g1.get("plays", [[]])[3][2] == 3 and g1.get("plays", [[]])[2][3] == 0)
    check("target_trees: the receiver carries his ESB id and no routes legend ships without charting",
          w and w.get("esb") == "TES123456" and "routes" not in tt and len(w["games"]) == 2 and len(w["games"][1]["plays"]) == 1)

    def _part(url, **kw):
        if "participation" not in url:
            raise Exception("404")
        return pd.DataFrame([dict(nflverse_game_id="2025_01_SEA_X", play_id=10, route="SLANT"),
                             dict(nflverse_game_id="2025_01_SEA_X", play_id=11, route="SHALLOW CROSS/DRAG"),
                             dict(nflverse_game_id="2025_01_SEA_X", play_id=12, route="GO"),
                             dict(nflverse_game_id="2025_02_SEA_X", play_id=14, route="SLANT")])
    nv._aux_csv = _part
    tt2 = nv.target_trees_weekly(2025, min_targets_game=1, min_targets_season=1)
    w2 = tt2["players"]["test receiver"]; p2 = w2["games"][0]["plays"]
    check("target_trees: once the charting lands every row gains a 7th slot — an index into the routes legend",
          tt2.get("routes") == ["GO", "SHALLOW CROSS/DRAG", "SLANT"] and [r[6] for r in p2] == [2, 1, 0, None]
          and w2["games"][1]["plays"][0][6] == 2)
    check("target_trees: the unlabelled play keeps its row (route null), nothing else moves",
          p2[3][:6] == [12, 0, 3, 0, 12, 3] and len(p2) == 4)

    total, passed = len(RESULTS), sum(RESULTS)
    print(f"\nRESULT: {passed}/{total} {'ALL PASS' if passed == total else 'SOME FAILED'}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
