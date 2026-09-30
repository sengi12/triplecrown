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


def main():
    for fn in (test_format_axes, test_trade_sides, test_pick_round_and_priors,
               test_relative_imbalance, test_solver_lets_trades_override_a_wrong_prior,
               test_solver_fixes_rare_assets_at_prior):
        fn()
    n = sum(RESULTS)
    print(f"\nRESULT: {n}/{len(RESULTS)}", "ALL PASS" if n == len(RESULTS) else "SOME FAILED")
    sys.exit(0 if n == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
