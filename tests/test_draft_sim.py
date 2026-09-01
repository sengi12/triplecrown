#!/usr/bin/env python3
"""Unit tests for tools/draft_sim.py — pure logic only (no network, no seed).

Covers: 3rd-round-reversal pick math, league shape parsing, bonus-EV scoring,
survival-probability math, replacement-level lineup values, and the roster
minimums that keep the simulated agent from finishing WR- or RB-starved.
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import draft_sim as ds  # noqa: E402

import json
import tempfile

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}: {name}{'' if ok else ' — ' + str(detail)}")


LEAGUE_JSON = {
    "name": "t", "total_rosters": 12,
    "scoring_settings": {
        "pass_yd": 0.04, "pass_td": 4.0, "pass_int": -2.0,
        "rush_yd": 0.1, "rush_td": 6.0, "rec": 1.0, "rec_yd": 0.1, "rec_td": 6.0,
        "bonus_rush_yd_100": 3.0, "bonus_rec_yd_100": 3.0, "bonus_pass_yd_300": 3.0,
    },
    "roster_positions": ["QB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF",
                         "BN", "BN", "BN", "BN", "BN"],
}
DRAFT_JSON = {"settings": {"teams": 12, "rounds": 14, "reversal_round": 3,
                           "position_limit_qb": 3}}


def test_3rr_pick_order():
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    picks = ds.my_pick_numbers(10, league)
    # 3RR from slot 10 of 12: R2/R3 both run 12->1, then normal alternation.
    check("3RR slot-10 pick numbers",
          picks == [10, 15, 27, 46, 51, 70, 75, 94, 99, 118, 123, 142, 147, 166], picks)
    check("3RR round1 fwd", ds.slot_on_clock(1, 12, 3) == 1)
    check("3RR round2 rev", ds.slot_on_clock(13, 12, 3) == 12)
    check("3RR round3 rev again", ds.slot_on_clock(25, 12, 3) == 12)
    check("3RR round4 fwd", ds.slot_on_clock(37, 12, 3) == 1)
    plain = ds.slot_on_clock(25, 12, 0)
    check("no-reversal round3 fwd", plain == 1, plain)


def test_league_shape():
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    check("lineup parse", league.lineup["WR"] == 2 and league.lineup["FLEX"] == 2
          and league.lineup["K"] == 1 and league.bench == 5, league.lineup)
    check("skill picks", league.skill_picks == 12, league.skill_picks)
    base, flex_n, sf_n = league.starters_skill()
    check("starters split", base == {"QB": 1, "RB": 1, "WR": 2, "TE": 1}
          and flex_n == 2 and sf_n == 0, (base, flex_n, sf_n))
    check("1QB room needs one starting QB", league.qb_starters() == 1)
    check("1QB room caps QB at two", league.qb_cap() == 2, league.qb_cap())


def test_scoring_bonus_ev():
    sc = LEAGUE_JSON["scoring_settings"]
    # 17 games x 100 rec yds/g: 1700*0.1 = 170 base rec-yd points, plus ~.45/g
    # probability of the 100-yd bonus -> meaningful extra.
    row = {"receiving_yards": 1700.0, "receptions": 100.0}
    pts = ds.league_points(row, sc, 17)
    check("bonus EV adds points", pts > 170 + 100 + 15, pts)
    low = ds.league_points({"receiving_yards": 300.0}, sc, 17)
    check("low-volume bonus ~0", low < 31.0, low)
    # Monotone: more per-game yards => higher bonus probability.
    c = ds.BONUS_CURVES["rec100"]
    check("bonus curve monotone", all(b[1] >= a[1] for a, b in zip(c, c[1:])))


def test_survival_math():
    check("norm_cdf(0)=.5", abs(ds.norm_cdf(0.0) - 0.5) < 1e-9)
    check("adp sigma clamps", ds.adp_sigma(1) == 3.5 and ds.adp_sigma(200) == 24.0)


def _mk(pid, pos, vpg, adp, bye=None):
    p = ds.Player()
    p.pid = pid
    p.name = pid
    p.pos = pos
    p.team = ""
    p.adp = p.adp_eff = adp
    p.sigma = ds.adp_sigma(adp)
    p.val = vpg * 17.0
    p.vpg = p.vpg_active = vpg
    p.sd_week = 5.0
    p.vor = 0.0
    p.bye = bye
    p.tc_mult = 1.0
    return p


def test_lineup_value_and_guards():
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    league.repl_vpg = {"QB": 16.0, "RB": 10.0, "WR": 10.5, "TE": 9.0}
    league.flex_repl_vpg = 9.0
    st = ds.TeamState(league.kd_slots)
    empty = ds.lineup_value(st.roster, league)
    # Empty roster = all replacement: 16 + 10 + 2*10.5 + 9 + 2*9 = 74
    check("empty lineup at replacement", abs(empty - 74.0) < 1e-9, empty)
    gain = ds.candidate_score(st, "WR", 15.0, league)
    check("WR starter gain", abs(gain - 4.5) < 1e-9, gain)
    # With WR2 filled, a third WR falls to flex value.
    st.roster = [_mk("a", "WR", 15.0, 5), _mk("b", "WR", 14.0, 10)]
    st.counts["WR"] = 2
    gain3 = ds.candidate_score(st, "WR", 12.0, league)
    check("WR3 is flex gain", abs(gain3 - 3.0) < 1e-9, gain3)
    # Roster minimums: with picks running out, agent must take unmet positions.
    st2 = ds.TeamState(league.kd_slots)
    st2.roster = [_mk(f"r{i}", "RB", 12.0, 20) for i in range(8)]
    st2.counts["RB"] = 8
    avail = {"QB": [_mk("q", "QB", 18.0, 60)], "RB": [_mk("r9", "RB", 11.0, 30)],
             "WR": [_mk(f"w{i}", "WR", 11.0, 40) for i in range(4)],
             "TE": [_mk("t", "TE", 10.0, 50)]}
    pick = ds.my_pick(st2, avail, 120, league)
    check("must-fill skips surplus RB", pick is not None and pick.pos != "RB",
          pick and pick.pos)


def test_app_advisory_guards():
    """app_pick_v3 — the decision core ported to the webapp — honors the same
    budget guards as my_pick: last-call starters, must-fill, position caps."""
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    league.repl_vpg = {"QB": 16.0, "RB": 10.0, "WR": 10.5, "TE": 9.0}
    league.flex_repl_vpg = 9.0
    avail = {"QB": [_mk("q", "QB", 18.0, 60)], "RB": [_mk("r", "RB", 14.0, 30)],
             "WR": [_mk(f"w{i}", "WR", 12.0, 40) for i in range(5)],
             "TE": [_mk("t", "TE", 16.0, 50)]}
    for pos, lst in avail.items():
        for p in lst:
            p.vor = 40.0
    # Last call: 9 skill picks spent, no QB yet -> the QB guard fires whatever the values.
    st = ds.TeamState(league.kd_slots)
    st.roster = [_mk(f"x{i}", "RB", 12.0, 20) for i in range(4)] \
        + [_mk(f"y{i}", "WR", 12.0, 25) for i in range(4)] + [_mk("tt", "TE", 10.0, 50)]
    st.counts = {"QB": 0, "RB": 4, "WR": 4, "TE": 1}
    pick = ds.app_pick_v3(st, avail, 120, league, {})
    check("app3 last-call QB", pick is not None and pick.pos == "QB", pick and pick.pos)
    # Must-fill: RB-heavy roster with the budget exhausted must not add another RB.
    st2 = ds.TeamState(league.kd_slots)
    st2.roster = [_mk(f"r{i}", "RB", 12.0, 20) for i in range(8)]
    st2.counts = {"QB": 0, "RB": 8, "WR": 0, "TE": 0}
    pick2 = ds.app_pick_v3(st2, avail, 120, league, {})
    check("app3 must-fill skips surplus RB", pick2 is not None and pick2.pos != "RB",
          pick2 and pick2.pos)
    # Cap: two TEs on the roster -> a monster TE VOR still can't headline a third.
    st3 = ds.TeamState(league.kd_slots)
    st3.roster = [_mk("t1", "TE", 14.0, 30), _mk("t2", "TE", 12.0, 40)]
    st3.counts = {"QB": 0, "RB": 0, "WR": 0, "TE": 2}
    avail["TE"][0].vor = 200.0
    pick3 = ds.app_pick_v3(st3, avail, 120, league, {})
    check("app3 caps a 3rd TE", pick3 is not None and pick3.pos != "TE", pick3 and pick3.pos)


def test_full_draft_app3_roster_shape():
    """A full mock drafted purely on the ported advisory finishes hole-free:
    starters covered, RB/WR depth met, no 3rd QB/TE."""
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    rng = random.Random(11)
    pool = []
    specs = [("QB", 22.0, 40), ("RB", 34.0, 44), ("WR", 30.0, 56), ("TE", 28.0, 30)]
    for pos, top, n in specs:
        for i in range(n):
            pool.append(_mk(f"{pos}{i}", pos, top - i * 0.45, 999))
    pool.sort(key=lambda p: -p.vpg)
    for i, p in enumerate(pool):
        p.adp = p.adp_eff = i + 1.0
        p.sigma = ds.adp_sigma(p.adp_eff)
        p.idx = i
    ds.compute_vor(pool, league)
    chooser = lambda st, av, nxt, lg, sts: ds.app_pick_v3(st, av, nxt, lg, sts)  # noqa: E731
    for trial in range(10):
        roster, states, _log = ds.run_draft(pool, league, 5, rng, chooser=chooser)
        c = states[5].counts
        ok = (len(roster) == league.skill_picks and c["RB"] >= 3 and c["WR"] >= 4
              and 1 <= c["QB"] <= 2 and 1 <= c["TE"] <= 2)
        if not ok:
            check("app3 full-draft roster shape", False, (trial, c))
            return
    check("app3 full-draft roster shape", True)


def test_full_draft_roster_shape():
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    rng = random.Random(7)
    pool = []
    # (pos, top per-week value, pool depth) — deep enough that 12 teams x 12
    # skill picks (144) never exhaust the 170-player pool.
    specs = [("QB", 22.0, 40), ("RB", 34.0, 44), ("WR", 30.0, 56), ("TE", 28.0, 30)]
    for pos, top, n in specs:
        for i in range(n):
            pool.append(_mk(f"{pos}{i}", pos, top - i * 0.45, 999))
    pool.sort(key=lambda p: -p.vpg)
    for i, p in enumerate(pool):
        p.adp = p.adp_eff = i + 1.0
        p.sigma = ds.adp_sigma(p.adp_eff)
        p.idx = i
    ds.compute_vor(pool, league)
    for trial in range(10):
        roster, states, _log = ds.run_draft(pool, league, 10, rng)
        c = states[10].counts
        ok = (len(roster) == league.skill_picks and c["RB"] >= 3 and c["WR"] >= 4
              and c["QB"] >= 1 and c["TE"] >= 1)
        if not ok:
            check("simulated roster minimums", False, (trial, c))
            return
        for s in range(1, 13):
            if states[s].kd_open != 0:
                check("all K/DEF slots consumed", False, (trial, s))
                return
    check("simulated roster minimums", True)
    check("all K/DEF slots consumed", True)
    m = ds.eval_league(states, 10, league, rng, draws=5)
    check("eval metrics sane", 0.0 <= m["p_bottom3"] <= 1.0 and m["mean"] > 0
          and m["steal_mean"] < m["mean"], m)


# ── Analyst projections as the value baseline ───────────────────────────────

PRO_ROWS = {"projections": [
    # Two analysts on the same player: the consensus is their mean.
    {"player_id": "1", "analyst_name": "Andy", "fantasy_position": "RB", "name": "A Back",
     "team": "KC", "rushing_yards": 1000.0, "rushing_touchdowns": 8.0, "receptions": 40.0,
     "receiving_yards": 300.0, "receiving_touchdowns": 2.0, "risk": 4.0, "upside": 6.0,
     "sleeper": {"player_id": "1"}},
    {"player_id": "1", "analyst_name": "Mike", "fantasy_position": "RB", "name": "A Back",
     "team": "KC", "rushing_yards": 1400.0, "rushing_touchdowns": 12.0, "receptions": 60.0,
     "receiving_yards": 500.0, "receiving_touchdowns": 4.0, "risk": 6.0, "upside": 8.0,
     "sleeper": {"player_id": "1"}},
    {"player_id": "2", "analyst_name": "Andy", "fantasy_position": "WR", "name": "B Wide",
     "team": "KC", "receptions": 100.0, "receiving_yards": 1300.0,
     "receiving_touchdowns": 9.0, "sleeper": {"player_id": "2"}},
]}


def _pro_file(payload=None):
    fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload or PRO_ROWS, fh)
    fh.close()
    return fh.name


def _seed_for(rows):
    return {"season": 2026,
            "seed": {"KC": {pos: [r for r in rows if r["pos"] == pos]
                            for pos in ("QB", "RB", "WR", "TE")}},
            "ecr": {}}


def test_pro_projection_load():
    path = _pro_file()
    con = ds.load_pro_projections(path)
    check("consensus covers each player once", sorted(con) == ["1", "2"], sorted(con))
    rb = con["1"]
    check("consensus averages the analysts",
          rb["rushing_yards"] == 1200.0 and rb["rushing_tds"] == 10.0
          and rb["receptions"] == 50.0, rb)
    check("consensus maps touchdown field names",
          "rushing_tds" in rb and rb["receiving_tds"] == 3.0, rb)
    check("consensus counts its analysts", rb["_n"] == 2, rb["_n"])
    check("consensus averages risk/upside", rb["_risk"] == 5.0 and rb["_upside"] == 7.0, rb)
    check("disagreement is positive when analysts differ", rb["_spread"] > 0, rb["_spread"])
    check("no disagreement from a lone analyst", con["2"]["_spread"] == 0.0, con["2"]["_spread"])
    check("season is treated as full-length", rb["games"] == ds.PRO_GAMES, rb["games"])

    solo = ds.load_pro_projections(path, "Andy")
    check("single analyst is not averaged", solo["1"]["rushing_yards"] == 1000.0,
          solo["1"]["rushing_yards"])
    check("analyst name match is case-insensitive",
          ds.load_pro_projections(path, "mike")["1"]["rushing_yards"] == 1400.0)
    check("an unknown analyst yields nothing", ds.load_pro_projections(path, "nobody") == {})
    os.unlink(path)

    # The app averages the analysts who carry a field, not all of them
    # (averageGroup in src/js/85-import-export.js). A blank must not halve it.
    gappy = _pro_file({"projections": [
        {"player_id": "7", "analyst_name": "Andy", "fantasy_position": "WR", "name": "Gap",
         "team": "KC", "receiving_yards": 1000.0, "receptions": 80.0,
         "sleeper": {"player_id": "7"}},
        {"player_id": "7", "analyst_name": "Mike", "fantasy_position": "WR", "name": "Gap",
         "team": "KC", "receiving_yards": None, "receptions": 100.0,
         "sleeper": {"player_id": "7"}},
    ]})
    g = ds.load_pro_projections(gappy)["7"]
    check("a blank field is skipped, not counted as zero",
          g["receiving_yards"] == 1000.0, g["receiving_yards"])
    check("a field both analysts carry is still averaged",
          g["receptions"] == 90.0, g["receptions"])
    check("a field nobody carries is zero", g["rushing_yards"] == 0.0, g["rushing_yards"])
    os.unlink(gappy)


def test_pro_pool_override():
    path = _pro_file()
    pro = ds.load_pro_projections(path)
    sc = LEAGUE_JSON["scoring_settings"]
    # Seed values deliberately unlike the analysts', so an override is visible.
    rows = [
        {"player_id": "1", "name": "A Back", "pos": "RB", "team": "KC", "adp_ppr": 5.0,
         "rushing_yards": 500.0, "rushing_tds": 2.0, "receptions": 10.0,
         "receiving_yards": 80.0, "receiving_tds": 0.0, "games_played": 17},
        {"player_id": "2", "name": "B Wide", "pos": "WR", "team": "KC", "adp_ppr": 9.0,
         "receptions": 50.0, "receiving_yards": 600.0, "receiving_tds": 3.0,
         "games_played": 17},
        # Not covered by the analysts: must survive, rescaled onto their scale.
        {"player_id": "3", "name": "C Back", "pos": "RB", "team": "KC", "adp_ppr": 40.0,
         "rushing_yards": 500.0, "rushing_tds": 2.0, "receptions": 10.0,
         "receiving_yards": 80.0, "receiving_tds": 0.0, "games_played": 17},
    ]
    seed = _seed_for(rows)
    plain = {p.pid: p for p in ds.build_pool(seed, sc, {}, 0.0, 0.0)}
    withpro = {p.pid: p for p in ds.build_pool(seed, sc, {}, 0.0, 0.0, pro=pro)}
    check("every player survives the override", sorted(withpro) == ["1", "2", "3"],
          sorted(withpro))
    check("covered players are tagged pro",
          withpro["1"].src == "pro" and withpro["2"].src == "pro",
          [withpro[k].src for k in ("1", "2")])
    check("uncovered players are tagged rescaled", withpro["3"].src == "seed*", withpro["3"].src)
    check("the analysts' view replaces the seed's",
          withpro["1"].val > plain["1"].val * 1.5, (withpro["1"].val, plain["1"].val))
    check("analyst risk rides along", withpro["1"].risk == 5.0, withpro["1"].risk)
    check("an uncovered player keeps no analyst spread", withpro["3"].spread is None)
    # Only one RB overlaps, below the 5-player floor, so the fallback factor of
    # 1.0 leaves the uncovered seed value exactly where it was.
    check("too few overlaps leaves the scale alone",
          abs(withpro["3"].val - plain["3"].val) < 1e-6,
          (withpro["3"].val, plain["3"].val))
    check("without --proj nothing is tagged", plain["1"].src == "seed", plain["1"].src)
    os.unlink(path)


def test_pro_pool_rescales_uncovered():
    """With enough overlap the uncovered tail is pulled onto the analysts' scale."""
    sc = LEAGUE_JSON["scoring_settings"]
    rows, pro_rows = [], []
    for i in range(1, 8):                       # 7 covered RBs; analysts see twice the seed
        rows.append({"player_id": str(i), "name": f"RB{i}", "pos": "RB", "team": "KC",
                     "adp_ppr": float(i), "rushing_yards": 800.0, "rushing_tds": 5.0,
                     "receptions": 20.0, "receiving_yards": 150.0, "receiving_tds": 1.0,
                     "games_played": 17})
        pro_rows.append({"player_id": str(i), "analyst_name": "Andy", "name": f"RB{i}",
                         "fantasy_position": "RB", "team": "KC", "rushing_yards": 1600.0,
                         "rushing_touchdowns": 10.0, "receptions": 40.0,
                         "receiving_yards": 300.0, "receiving_touchdowns": 2.0,
                         "sleeper": {"player_id": str(i)}})
    rows.append({"player_id": "99", "name": "RB tail", "pos": "RB", "team": "KC",
                 "adp_ppr": 80.0, "rushing_yards": 800.0, "rushing_tds": 5.0,
                 "receptions": 20.0, "receiving_yards": 150.0, "receiving_tds": 1.0,
                 "games_played": 17})
    path = _pro_file({"projections": pro_rows})
    pool = {p.pid: p for p in ds.build_pool(_seed_for(rows), sc, {}, 0.0, 0.0,
                                            pro=ds.load_pro_projections(path))}
    check("uncovered tail is rescaled to the analysts' level",
          abs(pool["99"].val - pool["1"].val) < 1.0, (pool["99"].val, pool["1"].val))
    os.unlink(path)


def test_pro_board_reorders_vor():
    """The analysts' board, not the seed's, is what VOR ends up ranking."""
    sc = LEAGUE_JSON["scoring_settings"]
    rows = [
        {"player_id": "1", "name": "Seed Favourite", "pos": "RB", "team": "KC", "adp_ppr": 1.0,
         "rushing_yards": 1600.0, "rushing_tds": 14.0, "receptions": 50.0,
         "receiving_yards": 400.0, "receiving_tds": 2.0, "games_played": 17},
        {"player_id": "2", "name": "Analyst Favourite", "pos": "RB", "team": "KC", "adp_ppr": 2.0,
         "rushing_yards": 700.0, "rushing_tds": 3.0, "receptions": 20.0,
         "receiving_yards": 150.0, "receiving_tds": 1.0, "games_played": 17},
    ]
    pro_rows = [
        {"player_id": "1", "analyst_name": "Andy", "name": "Seed Favourite",
         "fantasy_position": "RB", "team": "KC", "rushing_yards": 700.0,
         "rushing_touchdowns": 3.0, "receptions": 20.0, "receiving_yards": 150.0,
         "receiving_touchdowns": 1.0, "sleeper": {"player_id": "1"}},
        {"player_id": "2", "analyst_name": "Andy", "name": "Analyst Favourite",
         "fantasy_position": "RB", "team": "KC", "rushing_yards": 1600.0,
         "rushing_touchdowns": 14.0, "receptions": 50.0, "receiving_yards": 400.0,
         "receiving_touchdowns": 2.0, "sleeper": {"player_id": "2"}},
    ]
    path = _pro_file({"projections": pro_rows})
    seed = _seed_for(rows)
    plain = sorted(ds.build_pool(seed, sc, {}, 0.0, 0.0), key=lambda p: -p.val)
    withpro = sorted(ds.build_pool(seed, sc, {}, 0.0, 0.0,
                                   pro=ds.load_pro_projections(path)), key=lambda p: -p.val)
    check("seed board ranks the seed's man first", plain[0].pid == "1", plain[0].name)
    check("analyst board flips the order", withpro[0].pid == "2", withpro[0].name)
    os.unlink(path)



def test_market_format_and_adp_board():
    """A superflex room drafts off the 2QB board; the app does this too (adpFor
    in src/js/60-rankings-data.js) and the sim has to agree or QBs fall wrongly."""
    one_qb = ds.League(LEAGUE_JSON, DRAFT_JSON)
    check("PPR 1QB uses the PPR board", ds.market_format(one_qb) == "ppr",
          ds.market_format(one_qb))
    sf_json = dict(LEAGUE_JSON, roster_positions=["QB", "RB", "WR", "SUPER_FLEX", "BN"])
    check("a superflex slot selects the 2QB board",
          ds.market_format(ds.League(sf_json, DRAFT_JSON)) == "superflex")
    two_qb = dict(LEAGUE_JSON, roster_positions=["QB", "QB", "RB", "WR", "BN"])
    check("two QB slots select the 2QB board",
          ds.market_format(ds.League(two_qb, DRAFT_JSON)) == "superflex")
    half = dict(LEAGUE_JSON, scoring_settings=dict(LEAGUE_JSON["scoring_settings"], rec=0.5))
    check("half-PPR uses the half board",
          ds.market_format(ds.League(half, DRAFT_JSON)) == "half_ppr")
    std = dict(LEAGUE_JSON, scoring_settings=dict(LEAGUE_JSON["scoring_settings"], rec=0))
    check("no reception value uses the standard board",
          ds.market_format(ds.League(std, DRAFT_JSON)) == "std")

    row = {"adp": 50.0, "adp_ppr": 40.0, "adp_half_ppr": 45.0, "adp_2qb": 12.0,
           "adp_std": 60.0}
    check("2QB board reads adp_2qb", ds.adp_for(row, "superflex") == 12.0)
    check("PPR board reads adp_ppr", ds.adp_for(row, "ppr") == 40.0)
    check("half board reads adp_half_ppr", ds.adp_for(row, "half_ppr") == 45.0)
    check("standard board prefers adp_std", ds.adp_for(row, "std") == 60.0)
    check("standard falls back to the generic adp",
          ds.adp_for({"adp": 50.0, "adp_ppr": 40.0}, "std") == 50.0)
    check("a missing column falls back to the PPR board",
          ds.adp_for({"adp_ppr": 40.0}, "superflex") == 40.0)
    check("an undrafted player stays undrafted", ds.adp_for({}, "ppr") == 999.0)
    check("a 999 column is treated as absent",
          ds.adp_for({"adp_2qb": 999, "adp_ppr": 33.0}, "superflex") == 33.0)

    # And it reaches the board: the same player, two formats, two market ranks.
    rows = [{"player_id": "1", "name": "A QB", "pos": "QB", "team": "KC",
             "adp_ppr": 90.0, "adp_2qb": 8.0, "passing_yards": 4500.0,
             "passing_touchdowns": 35.0, "interceptions_thrown": 10.0,
             "games_played": 17}]
    seed = _seed_for(rows)
    sc = LEAGUE_JSON["scoring_settings"]
    ppr = ds.build_pool(seed, sc, {}, 0.0, 0.0, fmt="ppr")[0]
    sf = ds.build_pool(seed, sc, {}, 0.0, 0.0, fmt="superflex")[0]
    check("the QB's market rank moves with the format",
          ppr.adp == 90.0 and sf.adp == 8.0, (ppr.adp, sf.adp))
    check("survival odds move with it too", sf.sigma < ppr.sigma, (sf.sigma, ppr.sigma))



# ── Superflex: a SUPER_FLEX slot starts a quarterback ───────────────────────
# The app has always modelled this (FLEX_ELIGIBLE.SUPER_FLEX in
# src/js/98-draft-follow.js, the superflex branch of computeVOR in
# src/js/60-rankings-data.js). These pin the sim to the same behaviour, since a
# replica that treats a superflex slot as an RB/WR/TE flex prices the whole QB
# position off the 1QB replacement level.

SF_LEAGUE_JSON = dict(LEAGUE_JSON, roster_positions=[
    "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "DEF",
    "BN", "BN", "BN", "BN", "BN", "BN"])
SF_DRAFT_JSON = {"settings": {"teams": 12, "rounds": 16, "position_limit_qb": 3}}


def test_superflex_shape():
    sf = ds.League(SF_LEAGUE_JSON, SF_DRAFT_JSON)
    base, flex_n, sf_n = sf.starters_skill()
    check("superflex is not folded into flex", flex_n == 1 and sf_n == 1, (flex_n, sf_n))
    check("superflex room is flagged", sf.superflex() is True)
    check("superflex needs two starting QBs", sf.qb_starters() == 2, sf.qb_starters())
    check("superflex raises the QB cap", sf.qb_cap() == 3, sf.qb_cap())
    one = ds.League(LEAGUE_JSON, DRAFT_JSON)
    check("1QB room keeps the old caps",
          one.qb_starters() == 1 and one.qb_cap() == 2)
    limited = ds.League(SF_LEAGUE_JSON, {"settings": {"teams": 12, "rounds": 16,
                                                      "position_limit_qb": 2}})
    check("a league's own QB limit still wins", limited.qb_cap() == 2, limited.qb_cap())
    # posCap in _vonaBudget keys off superflex SLOTS, so a 2QB lineup with no
    # superflex caps at two — matching the app rather than guessing past it.
    two = ds.League(dict(LEAGUE_JSON, roster_positions=["QB", "QB", "RB", "WR", "TE", "BN"]),
                    DRAFT_JSON)
    check("a 2QB room needs two starters", two.qb_starters() == 2, two.qb_starters())
    check("a 2QB room caps QB at two, as the app does", two.qb_cap() == 2, two.qb_cap())
    check("TE cap follows the dedicated TE slots",
          two.te_cap() == 2 and ds.League(
              dict(LEAGUE_JSON, roster_positions=["QB", "TE", "TE", "BN"]),
              DRAFT_JSON).te_cap() == 3)


def _qb_heavy_pool():
    """A pool deep enough at every position to set real replacement levels."""
    rows = []
    for i in range(40):
        rows.append({"player_id": f"q{i}", "name": f"QB{i}", "pos": "QB", "team": "KC",
                     "adp_ppr": 20.0 + i, "adp_2qb": 3.0 + i,
                     "passing_yards": 4800.0 - 60 * i, "passing_touchdowns": 38.0 - 0.6 * i,
                     "interceptions_thrown": 10.0, "games_played": 17})
    for pos, n, yd in (("RB", 60, 1500.0), ("WR", 70, 1500.0), ("TE", 30, 900.0)):
        for i in range(n):
            rows.append({"player_id": f"{pos}{i}", "name": f"{pos}{i}", "pos": pos,
                         "team": "KC", "adp_ppr": 1.0 + i * 2, "adp_2qb": 1.0 + i * 2,
                         "rushing_yards": (yd - 20 * i) if pos == "RB" else 0.0,
                         "rushing_tds": 8.0 - 0.1 * i if pos == "RB" else 0.0,
                         "receptions": 90.0 - i, "receiving_yards": yd - 18 * i,
                         "receiving_tds": 8.0 - 0.1 * i, "games_played": 17})
    return _seed_for(rows)


def test_superflex_replacement_level():
    seed, sc = _qb_heavy_pool(), LEAGUE_JSON["scoring_settings"]
    one = ds.League(LEAGUE_JSON, DRAFT_JSON)
    sf = ds.League(SF_LEAGUE_JSON, SF_DRAFT_JSON)
    p1 = ds.build_pool(seed, sc, {}, 0.0, 0.0, fmt="ppr")
    p2 = ds.build_pool(seed, sc, {}, 0.0, 0.0, fmt="superflex")
    ds.compute_vor(p1, one)
    one_repl = dict(one.repl_vpg)
    ds.compute_vor(p2, sf)
    # More startable QBs means the last one is deeper in the pool and therefore
    # worth less — which is exactly what lifts every QB's VOR above it.
    check("superflex pushes the QB replacement deeper (so it is worth less)",
          sf.repl_vpg["QB"] < one_repl["QB"] * 0.95,
          (one_repl["QB"], sf.repl_vpg["QB"]))
    check("superflex leaves the RB replacement level alone-ish",
          abs(sf.repl_vpg["RB"] - one_repl["RB"]) < one_repl["RB"] * 0.6,
          (one_repl["RB"], sf.repl_vpg["RB"]))
    best_qb = max((p for p in p2 if p.pos == "QB"), key=lambda p: p.val)
    best_rb = max((p for p in p2 if p.pos == "RB"), key=lambda p: p.val)
    one_qb = max((p for p in p1 if p.pos == "QB"), key=lambda p: p.val)
    check("the QB1's VOR rises in superflex", best_qb.vor > one_qb.vor,
          (one_qb.vor, best_qb.vor))
    check("QB VOR is a real number in superflex", best_qb.vor > 0 and best_rb.vor > 0)
    # The floor is what stops a shallow-looking QB pool from pricing off QB12.
    check("the superflex QB floor is applied",
          sf.repl_vpg["QB"] <= sorted((p.val for p in p2 if p.pos == "QB"),
                                      reverse=True)[min(27, 39)] / 17.0 + 1e-6,
          sf.repl_vpg["QB"])


def test_superflex_lineup_starts_two_qbs():
    sf = ds.League(SF_LEAGUE_JSON, SF_DRAFT_JSON)
    seed, sc = _qb_heavy_pool(), LEAGUE_JSON["scoring_settings"]
    pool = ds.build_pool(seed, sc, {}, 0.0, 0.0, fmt="superflex")
    ds.compute_vor(pool, sf)
    qbs = sorted((p for p in pool if p.pos == "QB"), key=lambda p: -p.val)[:2]
    rbs = sorted((p for p in pool if p.pos == "RB"), key=lambda p: -p.val)[:3]
    one_qb = ds.lineup_value(qbs[:1] + rbs, sf)
    two_qb = ds.lineup_value(qbs[:2] + rbs, sf)   # same roster, plus the QB2
    check("a second QB reaches the starting lineup in superflex",
          two_qb > one_qb, (one_qb, two_qb))
    one = ds.League(LEAGUE_JSON, DRAFT_JSON)
    ds.compute_vor(pool, one)
    check("a second QB does not start in a 1QB room",
          ds.lineup_value(qbs[:2], one) == ds.lineup_value(qbs[:1], one),
          (ds.lineup_value(qbs[:1], one), ds.lineup_value(qbs[:2], one)))


def test_superflex_optimal_lineup_vor():
    sf = ds.League(SF_LEAGUE_JSON, SF_DRAFT_JSON)
    qb1, qb2 = ds._Cand("QB", 100.0), ds._Cand("QB", 80.0)
    rb = ds._Cand("RB", 60.0)
    one_qb = ds._optimal_lineup_vor([qb1, rb], sf)
    two_qb = ds._optimal_lineup_vor([qb1, qb2, rb], sf)
    check("the advisory replica starts a superflex QB2",
          abs(two_qb - one_qb - 80.0) < 1e-6, (one_qb, two_qb))
    one = ds.League(LEAGUE_JSON, DRAFT_JSON)
    check("and does not in a 1QB room",
          ds._optimal_lineup_vor([qb1, qb2, rb], one)
          == ds._optimal_lineup_vor([qb1, rb], one))


def test_superflex_league_demand():
    sf = ds.League(SF_LEAGUE_JSON, SF_DRAFT_JSON)
    states = {s: ds.TeamState(sf.kd_slots) for s in range(1, 13)}
    dem = ds._league_demand(states, sf)
    check("an empty superflex room shows QB demand above its dedicated slots",
          dem["QB"] > 12, dem["QB"])
    one = ds.League(LEAGUE_JSON, DRAFT_JSON)
    st1 = {s: ds.TeamState(one.kd_slots) for s in range(1, 13)}
    check("a 1QB room shows exactly its dedicated QB demand",
          abs(ds._league_demand(st1, one)["QB"] - 12) < 1e-6,
          ds._league_demand(st1, one)["QB"])


def test_superflex_agent_takes_two_qbs():
    """End to end: the free agent must not finish a superflex draft one QB short."""
    sf = ds.League(SF_LEAGUE_JSON, SF_DRAFT_JSON)
    seed, sc = _qb_heavy_pool(), LEAGUE_JSON["scoring_settings"]
    pool = ds.build_pool(seed, sc, {}, 0.0, 0.0, fmt="superflex")
    ds.compute_vor(pool, sf)
    rng = random.Random(11)
    for name, chooser in (("app3", ds.app_pick_v3), ("smart", None)):
        short = 0
        for _ in range(6):
            roster, _states, _log = ds.run_draft(pool, sf, 5, rng, chooser=chooser)
            if sum(1 for p in roster if p.pos == "QB") < 2:
                short += 1
        check(f"{name} fills both superflex QB slots", short == 0, f"{short}/6 short")



def test_flex_open_ignores_a_spare_qb_in_one_qb_rooms():
    one = ds.League(LEAGUE_JSON, DRAFT_JSON)
    st = ds.TeamState(one.kd_slots)
    st.counts["QB"] = 2                      # a backup QB, benched by definition
    check("a 1QB backup does not consume a flex", ds._flex_open(st, one) == 2,
          ds._flex_open(st, one))
    st.counts["RB"] = 2                      # one starter + one flex body
    check("an extra RB does consume a flex", ds._flex_open(st, one) == 1,
          ds._flex_open(st, one))
    sf = ds.League(SF_LEAGUE_JSON, SF_DRAFT_JSON)
    st2 = ds.TeamState(sf.kd_slots)
    check("an empty superflex roster has both slots open", ds._flex_open(st2, sf) == 2,
          ds._flex_open(st2, sf))
    st2.counts["QB"] = 2
    check("a superflex QB2 does consume the superflex slot",
          ds._flex_open(st2, sf) == 1, ds._flex_open(st2, sf))



# ── Reading the room ────────────────────────────────────────────────────────
# market_drift() is the Python half of vonaMarketDrift() in
# src/js/98-draft-follow.js. Both answer "how far ahead of the ADP board is this
# room running at each position", and they must answer it the same way.

def _sched(step, n=30, start=None):
    return [(start if start is not None else step) + i * step for i in range(n)]


def test_reach_guard_picks_the_man_who_will_not_be_back():
    """The whole point: when your board's #1 will still be there next round and
    your #2 will not, take #2 now and let #1 come back to you."""
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    league.repl_vpg = {"QB": 16.0, "RB": 10.0, "WR": 10.5, "TE": 9.0}
    league.flex_repl_vpg = 9.0
    st = ds.TeamState(league.kd_slots)
    # Board leader is slightly better but the market has him going 40 picks later;
    # the runner-up is due to go immediately.
    faller = _mk("faller", "WR", 15.0, 70)
    faller.vor = 60.0
    goes_now = _mk("goes_now", "WR", 14.0, 28)
    goes_now.vor = 55.0
    cands = [faller, goes_now]
    got = ds._best_in_pos(st, cands, 46, league)
    check("takes the man who won't survive, not the board leader",
          got is goes_now, got.pid)

    # Flip the market: now the leader is the one about to go.
    faller.adp = faller.adp_eff = 28
    faller.sigma = ds.adp_sigma(28)
    goes_now.adp = goes_now.adp_eff = 70
    goes_now.sigma = ds.adp_sigma(70)
    got2 = ds._best_in_pos(st, cands, 46, league)
    check("and takes the board leader when HE is the one going",
          got2 is faller, got2.pid)


def test_reach_guard_is_inert_without_a_next_pick():
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    league.repl_vpg = {"QB": 16.0, "RB": 10.0, "WR": 10.5, "TE": 9.0}
    league.flex_repl_vpg = 9.0
    st = ds.TeamState(league.kd_slots)
    a = _mk("a", "WR", 15.0, 70); a.vor = 60.0
    b = _mk("b", "WR", 14.0, 28); b.vor = 55.0
    check("last pick of the draft just takes the best player",
          ds._best_in_pos(st, [a, b], None, league) is a)
    check("a single candidate is returned unchanged",
          ds._best_in_pos(st, [a], 46, league) is a)


def test_v3_default_is_unchanged_by_the_guard():
    """app_pick_v3 must still behave exactly as it did before pick_in_pos existed
    — it is the baseline every A/B is measured against."""
    check("v3's default within-position choice is the top of the board",
          ds._take_top(None, ["top", "second"], 46, None) == "top")


def test_v5_keeps_the_position_guards():
    """The reach guard changes WHICH player, never whether a cap or a last call
    is respected."""
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    league.repl_vpg = {"QB": 16.0, "RB": 10.0, "WR": 10.5, "TE": 9.0}
    league.flex_repl_vpg = 9.0
    st = ds.TeamState(league.kd_slots)
    # Roster is one pick from the end with no QB: last call must fire.
    for i in range(league.skill_picks - 1):
        pk = _mk(f"rb{i}", "RB", 11.0, 30 + i)
        pk.vor = 20.0
        st.roster.append(pk)
        st.counts["RB"] += 1
    avail = {"QB": [_mk("qb1", "QB", 20.0, 200)], "RB": [_mk("rb9", "RB", 12.0, 40)],
             "WR": [_mk("wr9", "WR", 12.0, 41)], "TE": [_mk("te9", "TE", 11.0, 42)]}
    for k in avail:
        for q in avail[k]:
            q.vor = 25.0
    got = ds.app_pick_v5(st, avail, 200, league, {})
    check("last call still forces the empty QB slot", got.pos == "QB", got.pos)


def test_market_drift():
    # QBs due every 4 picks, RBs every 3. At pick 12 the board expects 3 QBs gone.
    idx = {"QB": _sched(4), "RB": _sched(3), "WR": _sched(2), "TE": _sched(6)}
    none = ds.market_drift({"QB": 0, "RB": 0, "WR": 0, "TE": 0}, 1, idx, 12, 11)
    check("nothing has happened yet, so nothing is inferred",
          all(abs(v) < 1e-9 for v in none.values()), none)

    hungry = ds.market_drift({"QB": 8, "RB": 4, "WR": 0, "TE": 0}, 12, idx, 12, 11)
    check("a hoarded position reads as running early", hungry["QB"] > 6, hungry["QB"])
    check("a skipped position reads as falling", hungry["WR"] < 0, hungry["WR"])
    check("drift is clamped", all(abs(v) <= ds.DRIFT_CAP for v in hungry.values()), hungry)

    # Same imbalance, far less evidence.
    thin = ds.market_drift({"QB": 1, "RB": 0, "WR": 0, "TE": 0}, 2, idx, 12, 11)
    check("one pick of evidence moves the board less than twelve",
          thin["QB"] < hungry["QB"], (thin["QB"], hungry["QB"]))

    # A room drafting exactly to the board should barely move it.
    on_board = ds.market_drift({"QB": 3, "RB": 4, "WR": 6, "TE": 2}, 12, idx, 12, 12)
    check("a room that matches the board is left alone",
          all(abs(v) < 4 for v in on_board.values()), on_board)

    # Excluding our own seat means counts are scaled back up to the whole room.
    scaled = ds.market_drift({"QB": 8}, 12, {"QB": _sched(4)}, 12, 11)
    unscaled = ds.market_drift({"QB": 8}, 12, {"QB": _sched(4)}, 12, None)
    check("the other seats are scaled up to a whole-room estimate",
          scaled["QB"] > unscaled["QB"], (scaled["QB"], unscaled["QB"]))

    check("a position with no board at all is left at zero",
          ds.market_drift({"QB": 5}, 12, {"QB": []}, 12, 11)["QB"] == 0.0)


def test_market_drift_moves_survival():
    """The point of the correction: survival odds, which the user reads."""
    pool = []
    for i in range(20):
        p = ds.Player()
        p.pid, p.name, p.pos = f"q{i}", f"QB{i}", "QB"
        p.adp = p.adp_eff = 4.0 + i * 4
        p.sigma = ds.adp_sigma(p.adp_eff)
        p.vor = 100.0 - i * 3
        p.val, p.vpg, p.bye, p.team = 300.0, 18.0, 9, "KC"
        p.src = "pro"; p.risk = p.upside = p.spread = None
        p.ecr = p.tier = None; p.idx = i
        pool.append(p)
    plain = ds._expected_best_vor(pool, 40)
    shifted = ds._expected_best_vor(pool, 40, shift=16.0)
    check("a room running early lowers what you expect to be left",
          shifted < plain, (plain, shifted))
    check("a room running late raises it",
          ds._expected_best_vor(pool, 40, shift=-16.0) > plain)
    check("no drift changes nothing", ds._expected_best_vor(pool, 40, shift=0.0) == plain)

    idx = ds.position_adp_index(pool)
    check("the board's own schedule is read off the pool",
          idx["QB"][:3] == [4.0, 8.0, 12.0], idx["QB"][:3])


def test_drift_is_opt_in():
    """A league that isn't reading the room behaves exactly as it always did."""
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    check("drift is off by default", league.use_drift is False)
    check("and reads as no correction",
          all(v == 0.0 for v in league.drift.values()), league.drift)



def test_build_board_derives_the_format():
    """The entry point that makes the superflex-on-a-1QB-board mistake impossible."""
    rows = [{"player_id": "1", "name": "A QB", "pos": "QB", "team": "KC",
             "adp_ppr": 90.0, "adp_2qb": 8.0, "passing_yards": 4500.0,
             "passing_touchdowns": 35.0, "interceptions_thrown": 10.0, "games_played": 17},
            {"player_id": "2", "name": "A Back", "pos": "RB", "team": "KC",
             "adp_ppr": 10.0, "adp_2qb": 20.0, "rushing_yards": 1200.0,
             "rushing_tds": 9.0, "receptions": 40.0, "receiving_yards": 300.0,
             "receiving_tds": 2.0, "games_played": 17}]
    seed = _seed_for(rows)
    one = ds.League(LEAGUE_JSON, DRAFT_JSON)
    sf = ds.League(SF_LEAGUE_JSON, SF_DRAFT_JSON)
    qb_one = {p.pid: p for p in ds.build_board(seed, one, {})}["1"]
    qb_sf = {p.pid: p for p in ds.build_board(seed, sf, {})}["1"]
    check("build_board reads the 1QB board for a 1QB league", qb_one.adp == 90.0, qb_one.adp)
    check("build_board reads the 2QB board for a superflex league", qb_sf.adp == 8.0, qb_sf.adp)
    check("build_board also sets replacement levels", one.repl_vpg["RB"] > 0, one.repl_vpg)


if __name__ == "__main__":
    test_3rr_pick_order()
    test_league_shape()
    test_scoring_bonus_ev()
    test_survival_math()
    test_lineup_value_and_guards()
    test_app_advisory_guards()
    test_full_draft_app3_roster_shape()
    test_full_draft_roster_shape()
    test_pro_projection_load()
    test_pro_pool_override()
    test_pro_pool_rescales_uncovered()
    test_pro_board_reorders_vor()
    test_market_format_and_adp_board()
    test_superflex_shape()
    test_superflex_replacement_level()
    test_superflex_lineup_starts_two_qbs()
    test_superflex_optimal_lineup_vor()
    test_superflex_league_demand()
    test_superflex_agent_takes_two_qbs()
    test_flex_open_ignores_a_spare_qb_in_one_qb_rooms()
    test_reach_guard_picks_the_man_who_will_not_be_back()
    test_reach_guard_is_inert_without_a_next_pick()
    test_v3_default_is_unchanged_by_the_guard()
    test_v5_keeps_the_position_guards()
    test_market_drift()
    test_market_drift_moves_survival()
    test_drift_is_opt_in()
    test_build_board_derives_the_format()
    ok = all(RESULTS)
    print(f"RESULT: {'PASS' if ok else 'SOME FAILED'} ({sum(RESULTS)}/{len(RESULTS)})")
    sys.exit(0 if ok else 1)
