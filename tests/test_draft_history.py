#!/usr/bin/env python3
"""Unit tests for tools/draft_history.py — pure logic only (no network).

Covers: roster-shape parsing (superflex detection, flex eligibility), the
best-legal-lineup fill and which picks it credits as starters, season scoring
under a league's settings (including bonus keys and the context stats that must
never be scored), and the within-season percentile that lets rooms of different
sizes and scoring pool together.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import draft_history as dh  # noqa: E402

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}: {name}{'' if ok else ' — ' + str(detail)}")


def test_shape_parse():
    s = dh.Shape(["QB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF",
                  "BN", "BN", "BN", "BN", "BN"])
    check("1QB shape base", s.base == {"QB": 1, "RB": 1, "WR": 2, "TE": 1}, s.base)
    check("1QB shape flex", len(s.flex) == 2 and s.flex[0] == ("RB", "WR", "TE"), s.flex)
    check("1QB shape k/def+bench", s.kd == 2 and s.bench == 5, (s.kd, s.bench))
    check("1QB not superflex", s.superflex is False)

    sf = dh.Shape(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "DEF", "BN"])
    check("superflex detected", sf.superflex is True)
    check("superflex flex slots", len(sf.flex) == 2, sf.flex)

    two_qb = dh.Shape(["QB", "QB", "RB", "RB", "WR", "WR", "TE", "K", "K", "BN"])
    check("2QB counts as superflex", two_qb.superflex is True)
    check("2QB two kickers", two_qb.kd == 2, two_qb.kd)


def test_fill_lineup():
    s = dh.Shape(["QB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF"])
    entries = [("QB", 300, 5), ("QB", 250, 12),
               ("RB", 200, 1), ("RB", 180, 3), ("RB", 90, 9),
               ("WR", 190, 2), ("WR", 150, 4), ("WR", 140, 7), ("WR", 60, 11),
               ("TE", 120, 6)]
    total, started = s.fill(entries)
    # QB300 + RB200 + WR190 + WR150 + TE120 = 960, then two flex: RB180 + WR140.
    check("fill picks the best legal lineup", round(total) == 1280, total)
    check("fill credits seven starters", len(started) == 7, len(started))
    check("fill leaves the QB2 on the bench",
          sorted(e[1] for e in started) == [120, 140, 150, 180, 190, 200, 300],
          sorted(e[1] for e in started))
    check("fill reports the rounds that started",
          sorted(e[2] for e in started) == [1, 2, 3, 4, 5, 6, 7],
          sorted(e[2] for e in started))

    # A superflex must be able to start the QB2 — and take it over a worse flex.
    sf = dh.Shape(["QB", "RB", "WR", "TE", "SUPER_FLEX"])
    tot2, st2 = sf.fill([("QB", 300, 1), ("QB", 250, 6), ("RB", 100, 2),
                         ("WR", 90, 3), ("TE", 80, 4), ("RB", 70, 8)])
    check("superflex starts the second QB", round(tot2) == 820, tot2)
    check("superflex beat the spare RB", any(e[1] == 250 for e in st2), st2)

    # Restricted flex: a WR/RB flex must not reach for a TE.
    rec = dh.Shape(["WR", "WRRB_FLEX"])
    tot3, _ = rec.fill([("WR", 100, 1), ("TE", 999, 2), ("RB", 50, 3)])
    check("restricted flex respects eligibility", round(tot3) == 150, tot3)

    check("fill of an empty roster is zero", dh.Shape(["QB"]).fill([]) == (0.0, []))


def test_score_season():
    scoring = {"pass_yd": 0.04, "pass_td": 4.0, "pass_int": -2.0, "rec": 1.0,
               "rec_yd": 0.1, "rec_td": 6.0, "bonus_rec_yd_100": 3.0, "gp": 99.0}
    stats = {"pass_yd": 5000, "pass_td": 40, "pass_int": 10, "gp": 17}
    # 200 + 160 - 20; gp is a context stat and must not score even though the
    # league (nonsensically) has a value for that key.
    check("season scoring under league settings",
          abs(dh.score_season(stats, scoring) - 340.0) < 1e-6, dh.score_season(stats, scoring))
    wr = {"rec": 100, "rec_yd": 1400, "rec_td": 10, "bonus_rec_yd_100": 6}
    check("bonus keys score as counts",
          abs(dh.score_season(wr, scoring) - (100 + 140 + 60 + 18)) < 1e-6,
          dh.score_season(wr, scoring))
    check("missing stats score zero", dh.score_season({}, scoring) == 0.0)
    check("no scoring settings score zero", dh.score_season(wr, {}) == 0.0)


def test_percentile():
    # collect_season's percentile step, exercised directly on its own shape.
    recs = [{"haul": v, "pts_for": None} for v in (100.0, 300.0, 200.0, 400.0)]
    vals = sorted(r["haul"] for r in recs)
    for r in recs:
        r["haul_pct"] = round(vals.index(r["haul"]) / (len(vals) - 1), 4)
    got = {r["haul"]: r["haul_pct"] for r in recs}
    check("percentile spans 0..1", got[100.0] == 0.0 and got[400.0] == 1.0, got)
    check("percentile is rank-based", got[200.0] == 0.3333, got)


def test_describe():
    lg = {"total_rosters": 12, "scoring_settings": {"rec": 1.0}}
    check("format label PPR/1QB",
          dh.describe(lg, dh.Shape(["QB", "RB", "WR", "FLEX"])) == "12tm/PPR/1QB",
          dh.describe(lg, dh.Shape(["QB", "RB", "WR", "FLEX"])))
    half = {"total_rosters": 10, "scoring_settings": {"rec": 0.5}}
    check("format label half/SF",
          dh.describe(half, dh.Shape(["QB", "SUPER_FLEX"])) == "10tm/half/SF",
          dh.describe(half, dh.Shape(["QB", "SUPER_FLEX"])))
    std = {"total_rosters": 10, "scoring_settings": {}}
    check("format label std", dh.describe(std, dh.Shape(["QB"])) == "10tm/std/1QB")


for fn in (test_shape_parse, test_fill_lineup, test_score_season, test_percentile,
           test_describe):
    fn()
ok = sum(1 for r in RESULTS if r)
print(f"\nRESULT: {'PASS' if ok == len(RESULTS) else 'FAIL'} ({ok}/{len(RESULTS)})")
sys.exit(0 if ok == len(RESULTS) else 1)
