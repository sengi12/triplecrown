#!/usr/bin/env python3
"""Offline tests for the TC veteran projection model (src/nflverse/tc_projections.py).

Scoring is pure math over the frozen tc_proj_model.json, so it runs without pandas;
the data-touching builder lazy-imports pandas and is exercised by the seed build."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from src.nflverse import tc_projections as tcp

passed = failed = 0
def chk(c, label):
    global passed, failed
    if c: passed += 1; print("  PASS:", label)
    else: failed += 1; print("  FAIL:", label)

print("=== frozen artifacts ===")
m = tcp._model()
for pos in ("QB", "RB", "WR", "TE"):
    a = m.get(pos) or {}
    chk(set(a.get("features") or []) == set(a.get("coef") or {}), f"{pos} features and coefs line up")
    chk(all(k in a for k in ("median", "mean", "sd", "intercept")), f"{pos} carries the full scoring recipe")
    chk(all((a["sd"][f] or 0) > 0 for f in a["features"]), f"{pos} sds are positive (no divide-by-zero)")
chk("_doc" not in m, "documentation keys are stripped from the runtime model")

print("=== scoring behaviour ===")
rb_base = {"fpg": 12.0, "fpg_2yr": 12.0, "car_g": 14, "tgt_g": 3, "tgt_sh": 0.08, "opps_g": 17,
           "xfpg": 12.0, "fpoe_g": 0.0, "td_oe": 0.0, "age": 24, "team_changed": 0,
           "dest_vacated": 0.1, "g": 16}
s0 = tcp.score_features("RB", rb_base)
chk(s0 is not None and 0 < s0 < 30, f"plausible RB line scores in range ({s0:.1f})")
s_xfp = tcp.score_features("RB", dict(rb_base, xfpg=16.0))
chk(s_xfp > s0, "more expected points (XFP) -> higher RB projection")
s_old = tcp.score_features("RB", dict(rb_base, age=31))
chk(s_old < s0, "age works against an RB")
wr = {"fpg": 14.0, "fpg_2yr": 14.0, "tgt_sh": 0.24, "wopr": 0.55, "tgt_g": 8.5, "opps_g": 9,
      "xfpg": 13.5, "fpoe_g": 0.5, "td_oe": 0.0, "age": 25, "team_changed": 0,
      "dest_vacated": 0.1, "g": 17}
s_wr = tcp.score_features("WR", wr)
s_lucky = tcp.score_features("WR", dict(wr, td_oe=5.0))
chk(s_lucky < s_wr, "TD luck (td_oe) regresses a WR downward")
chk(tcp.score_features("K", wr) is None, "unmodeled position returns None")
s_missing = tcp.score_features("WR", {"fpg": 14.0})
chk(s_missing is not None and 0 < s_missing < 30, "missing features impute to medians and still score")
qb_med = dict(m["QB"]["median"])
chk(tcp.score_features("QB", dict(qb_med, fpg_2yr=1e6)) == 30.0, "absurd upside clamps at 30")
s_wild = tcp.score_features("QB", {f: 1e9 for f in m["QB"]["features"]})
chk(0.0 <= s_wild <= 30.0, "wild inputs on every feature stay inside the clamp")

print("=== baseline PPR FPG from a seed stat line ===")
row = {"passing_yards": 0, "passing_touchdowns": 0, "interceptions_thrown": 0,
       "rushing_yards": 850, "rushing_tds": 7, "receptions": 50, "receiving_yards": 400,
       "receiving_tds": 2, "games_played": 17}
# 85 + 42 + 50 + 40 + 12 = 229 pts / 17 g
chk(abs(tcp.baseline_ppr_fpg(row) - 13.5) < 0.05, f"stat line -> PPR FPG ({tcp.baseline_ppr_fpg(row)})")
chk(tcp.baseline_ppr_fpg({"games_played": 18, "rushing_yards": 1800}) == 10.6, "games cap at 17 for the per-game basis")
chk(tcp.baseline_ppr_fpg({"receptions": 0}) is None, "empty projection -> None, not 0.0")

print("=== name matching (Sleeper vs nflverse) ===")
chk(tcp._norm_name("Luther Burden III") == tcp._norm_name("Luther Burden"), "suffixes are ignored")
chk(tcp._fuzz_name("Joshua Palmer") == tcp._fuzz_name("Josh Palmer"), "Josh/Joshua collide on the fuzzy key")
chk(tcp._norm_name("Ja'Marr Chase") == "jamarrchase", "punctuation stripped")
chk(tcp._fuzz_name("Cam") == "cam", "single-token names don't crash the fuzzy key")

print("=== rookie block (drafted, no NFL tape) ===")
r_top = tcp.score_rookie("RB", 5, 21.5, 0.6)
r_mid = tcp.score_rookie("RB", 90, 22.5, 0.15)
r_late = tcp.score_rookie("RB", 240, 23.5, 0.03)
chk(r_top is not None and r_top > r_mid > r_late, f"rookie RB projection falls with draft capital ({r_top:.1f}>{r_mid:.1f}>{r_late:.1f})")
chk(0 < r_late < r_top < 30, "rookie scores stay in range")
chk(tcp.score_rookie("QB", 3, 22) is not None, "QB rookies score without a prospect prob")
chk(tcp.score_rookie("K", 30, 22) is None, "unmodeled rookie position returns None")
chk(tcp.score_rookie("WR", None) is None, "no pick -> no projection")
chk(tcp.score_rookie("TE", 40, None, None) is not None, "missing age/prob impute to medians")

print("=== guard rails ===")
chk(tcp.MIN_SCORED >= 100, "coverage floor exists so a broken pull can't ship a gutted block")

print(f"\nRESULT: {passed}/{passed+failed} {'ALL PASS' if failed == 0 else 'SOME FAILED'}")
sys.exit(0 if failed == 0 else 1)
