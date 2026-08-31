#!/usr/bin/env python3
"""Unit tests for tools/draft_playbook.py — pure logic only (no network, no seed).

Covers: the market-vs-board disagreement ranking, the ordinal helper the header
uses for reversal rounds, and the rule generator — including that its verdicts
actually follow the numbers it was handed (a wide spread between openings must
produce "plan around it", a narrow one "take the best player"), since those
sentences are the playbook's conclusions.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import draft_sim as ds        # noqa: E402
import draft_playbook as pb   # noqa: E402

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}: {name}{'' if ok else ' — ' + str(detail)}")


LEAGUE_JSON = {
    "name": "t", "total_rosters": 12,
    "scoring_settings": {"rec": 1.0, "rec_yd": 0.1, "rec_td": 6.0, "rush_yd": 0.1,
                         "rush_td": 6.0, "pass_yd": 0.04, "pass_td": 4.0},
    "roster_positions": ["QB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF",
                         "BN", "BN", "BN", "BN", "BN"],
}
DRAFT_JSON = {"settings": {"teams": 12, "rounds": 14, "reversal_round": 3}}


def _player(pid, name, pos, adp, vor):
    p = ds.Player()
    p.pid, p.name, p.pos = pid, name, pos
    p.adp = p.adp_eff = adp
    p.vor, p.val, p.vpg = vor, 200.0 + vor, 12.0
    p.bye, p.team, p.src = 9, "KC", "pro"
    p.risk = p.upside = p.spread = None
    p.ecr = p.tier = None
    p.sigma, p.idx = 5.0, 0
    return p


def test_ordinal():
    got = [pb.ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111)]
    want = ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd",
            "23rd", "101st", "111th"]
    check("ordinals for reversal rounds", got == want, got)


def test_market_gaps():
    # A tops the board but goes last in the room; D is the reverse.
    pool = [_player("a", "Board Favourite", "WR", 80.0, 120.0),
            _player("b", "Middle One", "RB", 30.0, 90.0),
            _player("c", "Middle Two", "WR", 20.0, 60.0),
            _player("d", "Market Darling", "RB", 5.0, 10.0)]
    pool += [_player(str(i), f"Filler{i}", "WR", 50.0 + i, 50.0 - i) for i in range(20)]
    values, fades, vr, ar = pb.market_gaps(pool, None)
    check("a player worth more than his pick's par is a value",
          any(p.pid == "a" for _g, p in values), [p.name for _g, p in values])
    check("a player worth less than his pick's par is a fade",
          any(p.pid == "d" for _g, p in fades), [p.name for _g, p in fades])
    check("a value is never also a fade",
          not ({p.pid for _g, p in values} & {p.pid for _g, p in fades}))
    check("board rank is by VOR", vr["a"] == 1, vr["a"])
    check("market rank is by ADP", ar["d"] == 1, ar["d"])
    check("values are sorted by the biggest surplus first",
          [g for g, _p in values] == sorted((g for g, _p in values), reverse=True),
          [g for g, _p in values])
    check("the surplus is measured in points, not places",
          all(isinstance(g, float) for g, _p in values + fades))
    check("undrafted players are left out of the comparison",
          all(p.adp < 999 for _g, p in values + fades))
    # The flat tail must not manufacture edges out of rounding.
    flat = [_player(f"f{i}", f"Flat{i}", "WR", 100.0 + i, 10.0 - i * 0.01)
            for i in range(30)]
    v2, f2, _vr, _ar = pb.market_gaps(flat, None)
    check("a flat board produces no edges either way", not v2 and not f2, (v2, f2))
    check("depth limits the comparison to contested picks",
          len(pb.market_gaps(pool, None, depth=3)[0]) <= 3)


def _grid(spread, free=100.0):
    """A pattern grid whose best-to-worst spread is exactly `spread`."""
    shape = {"QB": 2.0, "RB": 4.0, "WR": 5.0, "TE": 1.5}
    pats = {"free": {"obj": free, "shape": shape}}
    for i, name in enumerate(("rb-rb-wr", "wr-wr-rb", "rb-wr-qb")):
        pats[name] = {"obj": free + spread * (1 - i / 2.0), "shape": shape}
    return {"patterns": pats,
            "agents": {"advisory (app3)": {"obj": free + spread, "shape": shape},
                       "sim agent (smart)": {"obj": free, "shape": shape}}}


def _board(qb_round=8, te_round=5):
    mix = []
    for r in range(1, 13):
        if r == qb_round:
            mix.append({"QB": 80, "WR": 20})
        elif r == te_round:
            mix.append({"TE": 70, "RB": 30})
        elif r in (3, 6):
            mix.append({"RB": 40, "WR": 40, "TE": 20})     # a genuine fork
        else:
            mix.append({"WR": 90, "RB": 10})
    return {"pos_mix": mix, "picks": list(range(1, 15)), "survival": [], "pids": []}


def test_rules_follow_the_numbers():
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    wide = pb.build_rules({"grid": _grid(9.0), "board": _board(), "history": None,
                           "league_obj": league})
    narrow = pb.build_rules({"grid": _grid(0.4), "board": _board(), "history": None,
                             "league_obj": league})
    check("a wide spread says plan around the opening",
          any("plan around" in r for r in wide), wide[0])
    check("a narrow spread says take the best player",
          any("best player your board" in r for r in narrow), narrow[0])
    check("the narrow verdict is not also the wide one",
          not any("plan around" in r for r in narrow))
    check("rules name the round QB lands in",
          any("QB lands in round 8" in r for r in wide), [r for r in wide if "QB" in r])
    check("rules name the round TE lands in",
          any("TE lands in round 5" in r for r in wide), [r for r in wide if "TE" in r])
    check("rules call out the genuine forks",
          any("R3" in r and "R6" in r and "forks" in r for r in wide),
          [r for r in wide if "fork" in r])
    check("rules always end on the survival point",
          "VONA" in wide[-1], wide[-1])
    check("no history means no champion rule",
          not any("champions drafted" in r for r in wide))


def test_rules_use_history():
    league = ds.League(LEAGUE_JSON, DRAFT_JSON)
    hist = {"champ_haul_pct": 0.74, "field_haul_pct": 0.48}
    rules = pb.build_rules({"grid": _grid(1.0), "board": _board(), "history": hist,
                            "league_obj": league})
    check("history produces a champion rule",
          any("champions drafted at the 74%" in r for r in rules),
          [r for r in rules if "champion" in r])
    check("the champion rule quotes the field too",
          any("48%" in r for r in rules), rules)


def test_pct():
    check("pct formats a fraction", pb.pct(0.742) == "74%", pb.pct(0.742))
    check("pct handles nothing", pb.pct(None) == "—")
    check("pct handles the ends", pb.pct(0.0) == "0%" and pb.pct(1.0) == "100%")


for fn in (test_ordinal, test_market_gaps, test_rules_follow_the_numbers,
           test_rules_use_history, test_pct):
    fn()
ok = sum(1 for r in RESULTS if r)
print(f"\nRESULT: {'PASS' if ok == len(RESULTS) else 'FAIL'} ({ok}/{len(RESULTS)})")
sys.exit(0 if ok == len(RESULTS) else 1)
