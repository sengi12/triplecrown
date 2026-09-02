#!/usr/bin/env python3
"""Unit tests for tools/draft_corpus.py — the pure parts only (no network)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import draft_corpus as dc  # noqa: E402

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}: {name}{'' if ok else ' — ' + str(detail)}")


def test_format_bucket():
    check("superflex slot puts a league on the 2QB market",
          dc.fmt_of({"roster_positions": ["QB", "SUPER_FLEX", "RB"],
                     "scoring_settings": {"rec": 1.0}}) == "superflex")
    check("two dedicated QB slots do too",
          dc.fmt_of({"roster_positions": ["QB", "QB", "RB"],
                     "scoring_settings": {"rec": 1.0}}) == "superflex")
    check("full point per reception is ppr",
          dc.fmt_of({"roster_positions": ["QB", "RB"], "scoring_settings": {"rec": 1.0}}) == "ppr")
    check("half a point is its own market",
          dc.fmt_of({"roster_positions": ["QB", "RB"], "scoring_settings": {"rec": 0.5}}) == "half")
    check("no reception points is standard",
          dc.fmt_of({"roster_positions": ["QB", "RB"], "scoring_settings": {}}) == "std")


def test_sigma_current_matches_the_app():
    # clamp(0.18*adp, 3.5, 24) — the exact curve adpSigma ships (keep in sync).
    check("floor at 3.5", dc.sigma_current(1) == 3.5)
    check("linear in the middle", abs(dc.sigma_current(100) - 18.0) < 1e-9)
    check("cap at 24", dc.sigma_current(200) == 24.0)


def test_sigma_fit_interpolates():
    # Two tight clusters: early players spread ~2, late players spread ~10.
    rows = []
    for m, sd, lo in ((6, 2.0, 1), (60, 10.0, 49)):
        for i in range(40):
            v = [m - sd, m, m + sd]
            rows.append((m, v))
    rows.sort(key=lambda r: r[0])
    f, pts = dc.sigma_fit_factory(rows)
    check("knots found for both regions", len(pts) == 2, pts)
    check("early sigma near the early spread", abs(f(6) - pts[0][1]) < 1e-9)
    check("late sigma near the late spread", abs(f(60) - pts[1][1]) < 1e-9)
    mid = f((pts[0][0] + pts[1][0]) / 2)
    check("between knots it interpolates",
          min(pts[0][1], pts[1][1]) < mid < max(pts[0][1], pts[1][1]), mid)
    check("beyond the last knot it holds flat", f(400) == pts[-1][1])
    check("empty fit falls back to the shipped curve",
          dc.sigma_fit_factory([])[0](50) == dc.sigma_current(50))


def test_norm_cdf():
    check("norm_cdf(0)=.5", abs(dc.norm_cdf(0.0) - 0.5) < 1e-12)
    check("symmetric", abs(dc.norm_cdf(1.5) + dc.norm_cdf(-1.5) - 1.0) < 1e-12)


def _synth_corpus(n_drafts=24, teams=12, rounds=8, eps=0.25, tau=100.0, seed=7):
    """Drafts drawn from the very model the fitter looks for: mostly ADP+noise,
    a slice of anchor-is-wrong players who go whenever."""
    import random
    rng = random.Random(seed)
    n_players = teams * rounds + 40
    poss = ["RB", "WR", "QB", "TE"]
    drafts = []
    for _ in range(n_drafts):
        order = []
        for i in range(n_players):
            adp = i + 1.0
            if rng.random() < eps:
                pos_draw = rng.expovariate(1.0 / tau)
            else:
                pos_draw = adp + rng.gauss(0.0, dc.sigma_current(adp))
            order.append((pos_draw, i))
        order.sort()
        picks = [{"no": k + 1, "pid": str(i), "pos": poss[i % 4]}
                 for k, (_, i) in enumerate(order[:teams * rounds])]
        drafts.append({"teams": teams, "rounds": rounds, "format": "ppr", "picks": picks})
    return {"season": "2026", "drafts": drafts, "seeds": ["x"]}


def test_fit_params_recovers_contamination():
    corpus = _synth_corpus()
    blob = dc.fit_params(corpus)
    check("a healthy corpus produces a blob", blob is not None)
    if blob:
        check("eps lands inside the consumer bounds", 0.0 <= blob["eps"] <= 0.5, blob["eps"])
        check("tau lands inside the consumer bounds", 20 <= blob["tau"] <= 300, blob["tau"])
        check("eps is in the neighbourhood of the truth (0.25)",
              0.1 <= blob["eps"] <= 0.4, blob["eps"])
        check("the mixture beats doing nothing, out of sample",
              blob["brier"]["mix"] < blob["brier"]["uncond"], blob["brier"])
        check("the blob records how much data it stands on", blob["drafts"] == 24)


def test_fit_params_guardrails():
    corpus = _synth_corpus(n_drafts=6)
    check("a thin corpus emits nothing rather than a shaky fit",
          dc.fit_params(corpus) is None)
    # A clean, uncontaminated world: the mixture can still help a little via the
    # conditional term, but eps must stay small — parsimony holds it down.
    clean = _synth_corpus(eps=0.0)
    blob = dc.fit_params(clean)
    if blob is not None:
        check("a clean world fits little contamination", blob["eps"] <= 0.2, blob["eps"])
    else:
        check("a clean world may also fit nothing at all", True)


def test_current_season_fallback():
    """Offline, the season guess must follow the NFL year (March rollover), so
    the automated loop degrades sanely rather than crashing or going stale."""
    import urllib.request as _ur
    import datetime
    real = _ur.urlopen
    def _down(*a, **k):
        raise OSError("offline")
    _ur.urlopen = _down
    try:
        got = dc.current_season()
        now = datetime.date.today()
        want = str(now.year if now.month >= 3 else now.year - 1)
        check("offline fallback tracks the NFL year", got == want, (got, want))
    finally:
        _ur.urlopen = real


if __name__ == "__main__":
    test_current_season_fallback()
    test_format_bucket()
    test_sigma_current_matches_the_app()
    test_sigma_fit_interpolates()
    test_norm_cdf()
    test_fit_params_recovers_contamination()
    test_fit_params_guardrails()
    ok = all(RESULTS)
    print(f"RESULT: {'PASS' if ok else 'SOME FAILED'} ({sum(RESULTS)}/{len(RESULTS)})")
    sys.exit(0 if ok else 1)
