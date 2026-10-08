#!/usr/bin/env python3
"""Unit tests for tools/trade_corpus.py — the pure parts only (no network)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import trade_corpus as tc  # noqa: E402

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}: {name}{'' if ok else ' — ' + str(detail)}")


def test_format_axes():
    check("SUPER_FLEX slot is a superflex market",
          tc.is_superflex({"roster_positions": ["QB", "SUPER_FLEX"]}))
    check("two QB slots too", tc.is_superflex({"roster_positions": ["QB", "QB"]}))
    check("one QB is not", not tc.is_superflex({"roster_positions": ["QB", "RB"]}))
    check("full ppr", tc.ppr_tier({"scoring_settings": {"rec": 1.0}}) == "ppr")
    check("half ppr", tc.ppr_tier({"scoring_settings": {"rec": 0.5}}) == "half")
    check("te premium reads the bonus", tc.is_tep({"scoring_settings": {"bonus_rec_te": 0.5}}))
    check("dynasty is settings.type 2", tc.is_dynasty({"settings": {"type": 2}}))
    check("redraft is not", not tc.is_dynasty({"settings": {"type": 0}}))
    check("keeper only with the flag", not tc.is_dynasty({"settings": {"type": 1}})
          and tc.is_dynasty({"settings": {"type": 1}}, keepers=True))


def test_trade_sides():
    tx = {"roster_ids": [1, 2], "adds": {"111": 1, "222": 2},
          "draft_picks": [{"season": "2027", "round": 1, "owner_id": 2}]}
    sides = tc._trade_sides(tx, "2026")
    check("two-team trade splits by receiving roster",
          sides == {1: ["p111"], 2: ["p222", "k1_1"]}, sides)
    one = tc._trade_sides({"roster_ids": [1, 2], "adds": {"111": 1}, "draft_picks": []}, "2026")
    check("a one-sided move is dropped (no equality)", one is None)
    three = tc._trade_sides({"roster_ids": [1, 2, 3], "adds": {"1": 1, "2": 2, "3": 3}}, "2026")
    check("three-team trade is skipped", three is None)
    far = tc._trade_sides({"roster_ids": [1, 2], "adds": {"1": 1},
                           "draft_picks": [{"season": "2031", "round": 9, "owner_id": 2}]}, "2026")
    check("years-out clamps to 2 and round to 5", far == {1: ["p1"], 2: ["k2_5"]}, far)


def test_pick_round_and_priors():
    check("dotted label -> round", tc._pick_round("1.01") == 1 and tc._pick_round("2.10") == 2)
    check("ordinal label -> round", tc._pick_round("Early 1st") == 1 and tc._pick_round("3rd") == 3)
    fp_picks = {"2026": [["1.01", 100, 120], ["1.12", 60, 70], ["2.05", 40, 45]],
                "2027": [["1st", 80, 95]]}
    pr = tc.build_pick_priors(fp_picks, 2026, col=2)   # superflex column
    check("this-year 1st = mean of the round's SF values", abs(pr(0, 1) - 95.0) < 1e-9, pr(0, 1))
    check("this-year 2nd", abs(pr(0, 2) - 45.0) < 1e-9, pr(0, 2))
    check("next-year 1st from 2027 block", abs(pr(1, 1) - 95.0) < 1e-9, pr(1, 1))
    check("beyond the horizon decays 0.8x", abs(pr(2, 1) - 95.0 * 0.8) < 1e-9, pr(2, 1))


def test_relative_imbalance():
    val = {"pA": 100.0, "pB": 60.0, "pC": 40.0}
    trade = {"A": ["pA"], "B": ["pB", "pC"]}
    check("a fair trade has ~zero imbalance",
          abs(tc.relative_imbalance(trade, lambda t: val[t])) < 1e-9)
    lop = {"A": ["pA"], "B": ["pC"]}
    check("a lopsided trade is imbalanced",
          abs(tc.relative_imbalance(lop, lambda t: val[t]) - (60 / 140)) < 1e-9)


def test_solver_lets_trades_override_a_wrong_prior():
    # True market: A is worth B+C. The chart is WRONG about A (says 50, well under
    # B+C=100). Twenty A <-> B+C trades should (a) satisfy that equality and (b) drag
    # A up off its wrong prior toward the market — ridge splits the gap across the free
    # assets, so we check the equality holds and A moved meaningfully, not an exact value.
    fp = {"A": 50.0, "B": 60.0, "C": 40.0}
    trades = [{"A": ["pA"], "B": ["pB", "pC"], "at": None} for _ in range(20)]
    # This 3-asset slice is underdetermined (one equation, three unknowns), so the descent
    # drifts slowly along the weakly-penalized direction; give it enough sweeps to actually
    # reach the ridge optimum (A ~= 66.7) instead of a mid-flight point.
    vals = tc.solve_values(trades, fp, lambda rel, rnd: None,
                           min_obs=1, lam=0.05, half_life_days=None, sweeps=5000)
    check("the trade equality A ~= B+C is satisfied after the fit",
          abs(vals["pA"] - (vals["pB"] + vals["pC"])) < 3, (vals["pA"], vals["pB"] + vals["pC"]))
    check("A is dragged up off its wrong (50) prior toward the market",
          vals["pA"] > 65, vals.get("pA"))
    check("the B+C side comes down off 100 to meet it",
          vals["pB"] + vals["pC"] < 95, vals["pB"] + vals["pC"])


def test_solver_fixes_rare_assets_at_prior():
    # A player seen once, below min_obs, is not an unknown — he stays at his prior
    # and just contributes to the other side's balance.
    fp = {"A": 90.0, "B": 45.0, "C": 45.0}
    trades = [{"A": ["pA"], "B": ["pB", "pC"], "at": None} for _ in range(5)]
    vals = tc.solve_values(trades, fp, lambda rel, rnd: None,
                           min_obs=99, lam=0.25, half_life_days=None, sweeps=50)
    check("nothing is solved when everyone is below min_obs", vals == {}, vals)


def test_slot_tiers_and_tokens():
    rosters = [{"roster_id": r, "settings": {"wins": w, "losses": 6 - w, "fpts": 900 + r}}
               for r, w in ((1, 0), (2, 1), (3, 2), (4, 3), (5, 4), (6, 5))]
    tiers = tc.slot_tiers(rosters)
    check("worst third of the standings owns the early picks", tiers[1] == "e" and tiers[2] == "e", tiers)
    check("best third the late ones", tiers[5] == "l" and tiers[6] == "l", tiers)
    check("the middle is mid", tiers[3] == "m" and tiers[4] == "m", tiers)
    check("no games yet → no tiers", tc.slot_tiers([{"roster_id": 1, "settings": {}}] * 6) == {})
    tx = {"roster_ids": [1, 2], "adds": {"111": 1},
          "draft_picks": [{"season": "2027", "round": 1, "owner_id": 2, "roster_id": 1},
                          {"season": "2027", "round": 2, "owner_id": 2, "roster_id": 1},
                          {"season": "2028", "round": 1, "owner_id": 2, "roster_id": 6}]}
    sides = tc._trade_sides(tx, "2026", tiers)
    check("a near first carries the original roster's tier; a second and a far first do not",
          sides == {1: ["p111"], 2: ["k1_1_e", "k1_2", "k2_1"]}, sides)
    check("without standings the token is the old plain one",
          tc._trade_sides(tx, "2026")[2] == ["k1_1", "k1_2", "k2_1"])
    check("pick tokens parse", tc._parse_pick_token("k1_1_e") == (1, 1, "e") and tc._parse_pick_token("k0_2") == (0, 2, None)
          and tc._parse_pick_token("p99") is None)


def test_tiered_pick_priors():
    fp = {"2026": [["1.01", 100, 120], ["1.02", 95, 110], ["1.03", 90, 100],
                   ["1.04", 80, 90], ["1.05", 75, 85], ["1.06", 70, 80],
                   ["1.07", 65, 75], ["1.08", 60, 70], ["1.09", 55, 65],
                   ["2.01", 40, 45]],
          "2027": [["1st", 80, 95], ["2nd", 30, 34]]}
    pr = tc.build_pick_priors(fp, 2026, col=1)
    check("listed slots: early > mid > late this year", pr(0, 1, "e") > pr(0, 1, "m") > pr(0, 1, "l"),
          (pr(0, 1, "e"), pr(0, 1, "m"), pr(0, 1, "l")))
    check("early = the first third of the slots", abs(pr(0, 1, "e") - (100 + 95 + 90) / 3) < 1e-9, pr(0, 1, "e"))
    check("untiered is still the round mean", abs(pr(0, 1) - sum((100, 95, 90, 80, 75, 70, 65, 60, 55)) / 9) < 1e-9)
    check("a round listed as one row fans out by the spread",
          abs(pr(1, 1, "e") - 80 * tc.PICK_TIER_SPREAD["e"]) < 1e-9 and abs(pr(1, 1, "l") - 80 * tc.PICK_TIER_SPREAD["l"]) < 1e-9)
    check("later rounds ignore the tier", abs(pr(1, 2, "e") - 30) < 1e-9)


def test_joint_tokens():
    pmap = {"1": ("josh allen", "QB"), "2": ("justin jefferson", "WR")}
    check("a receiver is one asset in both markets",
          tc.joint_token("p2", "sf", pmap) == "p2" and tc.joint_token("p2", "1qb", pmap) == "p2")
    check("a quarterback is a different asset per market",
          tc.joint_token("p1", "sf", pmap) == "p1|sf" and tc.joint_token("p1", "1qb", pmap) == "p1|1qb")
    check("so is a pick", tc.joint_token("k0_1_e", "1qb", pmap) == "k0_1_e|1qb")
    check("and the suffix splits back off", tc.split_token("p1|sf") == ("p1", "sf") and tc.split_token("p2") == ("p2", None))


def test_consolidation_calibration():
    # Build x-for-1 trades that satisfy s + stud·(s − m1) = m1 + w2·m2 exactly for a known
    # (stud, w2), then ask the calibration to find them.
    # Three-piece sides: with a third asset in the mix the gap and the second piece move
    # independently (two-piece sides alone are collinear by construction, and the fit says so).
    stud, w2 = 0.5, 0.7
    vals = {}
    trades = []
    for i in range(60):
        m1, m2, m3 = 60.0 + (i % 7) * 3, 30.0 + (i % 5) * 4, 5.0 + (i % 4) * 6
        rhs = m1 + w2 * m2 + tc.TAIL_W[2] * m3
        s = (rhs + stud * m1) / (1 + stud)             # solves s + stud(s − m1) = rhs
        vals[f"pS{i}"], vals[f"pM{i}a"], vals[f"pM{i}b"], vals[f"pM{i}c"] = s, m1, m2, m3
        trades.append({"A": [f"pS{i}"], "B": [f"pM{i}a", f"pM{i}b", f"pM{i}c"], "at": None})
    cal = tc.calibrate_consolidation(trades, lambda t: vals.get(t), half_life_days=None)
    check("the calibration recovers the stud premium the trades were built with",
          cal and abs(cal["stud"] - stud) < 0.02, cal)
    check("and the second-asset weight", cal and abs(cal["w2"] - w2) < 0.02, cal)
    check("too few x-for-1 trades → no calibration",
          tc.calibrate_consolidation(trades[:10], lambda t: vals.get(t), half_life_days=None) is None)
    flat = [{"A": [f"pS{i}"], "B": [f"pM{i}a", f"pM{i}b"], "at": None} for i in range(60)]
    fv = {}
    for i in range(60):
        m1, m2 = 60.0 + (i % 7) * 3, 30.0 + (i % 5) * 4
        fv[f"pS{i}"], fv[f"pM{i}a"], fv[f"pM{i}b"] = (m1 + w2 * m2 + stud * m1) / (1 + stud), m1, m2
    check("two-piece sides alone are collinear → it says nothing rather than guess",
          tc.calibrate_consolidation(flat, lambda t: fv.get(t), half_life_days=None) is None)
    check("a two-for-one where the one is NOT the best piece does not count",
          tc.calibrate_consolidation([{"A": ["pX"], "B": ["pY", "pZ"], "at": None}] * 40,
                                     lambda t: {"pX": 50.0, "pY": 70.0, "pZ": 10.0}[t], half_life_days=None) is None)


def test_market_share_gate():
    from collections import Counter
    c = Counter({"sf": 290, "1qb": 5})
    check("below the floor nothing is skipped", not tc._over_share(c, "sf", 0.7))
    c["sf"] = 400
    check("past the floor the swollen market is skipped", tc._over_share(c, "sf", 0.7))
    check("the short one never is", not tc._over_share(c, "1qb", 0.7))
    check("a share of 1 disables the gate", not tc._over_share(c, "sf", 1.0))


def main():
    for fn in (test_format_axes, test_trade_sides, test_pick_round_and_priors,
               test_relative_imbalance, test_solver_lets_trades_override_a_wrong_prior,
               test_solver_fixes_rare_assets_at_prior, test_slot_tiers_and_tokens,
               test_tiered_pick_priors, test_joint_tokens, test_consolidation_calibration,
               test_market_share_gate):
        fn()
    n = sum(RESULTS)
    print(f"\nRESULT: {n}/{len(RESULTS)}", "ALL PASS" if n == len(RESULTS) else "SOME FAILED")
    sys.exit(0 if n == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
