#!/usr/bin/env python3
"""
ol_rookie_prior_fit.py — where a rookie lineman's grade comes from, and why it is draft capital
────────────────────────────────────────────────────────────────────────────────────────────────
The OL composite (src/nflverse/ol_grades_pipeline.py) needs a snap on record; the incoming
class has none. rookie_prior_rows() grades them on a prior instead: the composite percentile
that a lineman of that draft slot has EARNED in his first season, fitted here.

    rookie-year ol_pctile  ~  a + b · ln(1 + pick)        (undrafted counts as pick 270)

Data: every drafted lineman in the pipeline's grade-history cache whose first graded season
was his draft year (2019-2023 classes, n = 146 the first time this ran). Result then:

    R² = 0.61, r = -0.78, intercept 142.8, slope -19.95, residual sd ≈ 15
    observed first-season composite by pick: 1-32 → 85, 33-64 → 71, 65-100 → 61,
    101-150 → 45, 151-200 → 34, 201+ → 31

The college line context (src/cfb/ol_unit.py — the unit's percentile in his final college
season) was tested as a second predictor and added nothing: partial r = -0.01 (unit mean),
+0.21 for the unit's sack rate alone (R² +0.015 on n = 46, not robust). So it is shown on the
card as context and carries no weight in the grade; ol_model.json's rookie_college_w stays 0
until a bigger sample says otherwise.

Usage:
    python tools/ol_rookie_prior_fit.py            # refit from the current grade cache
    python tools/ol_rookie_prior_fit.py --college  # also test the college signal (needs the
                                                   # class builds from src/cfb/ol_unit.py)
Then copy the intercept / slope into src/nflverse/ol_model.json → rookie_prior.
"""
import argparse
import glob
import json
import os
import re
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFT_URL = "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.parquet"


def _nn(s):
    s = str(s or "").lower()
    s = re.sub(r"\s+(jr|sr|ii|iii|iv)\.?$", "", s)
    return re.sub(r"[^a-z]", "", s)


def rookie_seasons():
    """One row per drafted lineman whose first graded season was his draft year."""
    files = glob.glob(os.path.join(ROOT, "cache", "nflverse", "derived", "ol_grades", "*.csv"))
    if not files:
        sys.exit("no OL grades cache — run the seed build first (build_seed.py)")
    g = pd.read_csv(max(files, key=os.path.getmtime))
    rows = []
    for _, r in g.iterrows():
        hs, hp = str(r.get("hist_seasons") or ""), str(r.get("ol_pctile_hist") or "")
        seasons = [int(x) for x in hs.split(",") if x.strip().isdigit()]
        pcts = [float(x) for x in hp.split(",") if x.strip().replace(".", "", 1).isdigit()]
        if seasons and pcts:
            rows.append({"gsis_id": r["gsis_id"], "name": r["name"], "pos": r["pos"],
                         "first_season": seasons[0], "rookie_pct": pcts[0]})
    h = pd.DataFrame(rows)
    draft = pd.read_parquet(DRAFT_URL, columns=["season", "pick", "gsis_id"]).dropna(subset=["gsis_id"])
    draft = draft.drop_duplicates("gsis_id").set_index("gsis_id")
    h["pick"] = h.gsis_id.map(draft.pick)
    h["draft_year"] = h.gsis_id.map(draft.season)
    h = h[h.pick.notna() & (h.draft_year == h.first_season)].copy()
    h["log_pick"] = np.log1p(h.pick)
    return h


def ols(x, y):
    X = np.column_stack([np.ones(len(x)), x])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    pred = X @ b
    return b, 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum(), np.std(y - pred)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--college", action="store_true", help="also test the college unit context")
    a = ap.parse_args()
    h = rookie_seasons()
    y = h.rookie_pct.values
    b, r2, sd = ols(h[["log_pick"]].values, y)
    print(f"rookie seasons: n={len(h)} classes {int(h.draft_year.min())}-{int(h.draft_year.max())}")
    print(f"rookie_pct ~ {b[0]:.2f} + {b[1]:.2f} · ln(1+pick)   R²={r2:.3f}  r={np.corrcoef(h.log_pick, y)[0,1]:.3f}  resid sd={sd:.1f}")
    bins = h.assign(rd=pd.cut(h.pick, [0, 32, 64, 100, 150, 200, 270])).groupby("rd", observed=True).rookie_pct.agg(["mean", "count"]).round(1)
    print(bins.to_string())
    print(json.dumps({"rookie_prior": {"a": round(float(b[0]), 2), "b": round(float(b[1]), 2), "n": int(len(h)), "r2": round(float(r2), 3)}}))
    if a.college:
        sys.path.insert(0, ROOT)
        from src.cfb import ol_unit, link
        players = json.load(open(os.path.join(ROOT, "cache", "players.json")))
        link.DB_SEASON = int(h.draft_year.max()) + 1
        ctx = {}
        for cls in sorted(h.draft_year.unique()):
            for pid, p in ol_unit.build(players, int(cls), verbose=False).items():
                last = max(p["ol_unit"]["seasons"], key=lambda r: r["season"])
                vals = [v for v in last["pct"].values() if v is not None]
                ctx["nm:" + _nn(p["name"])] = {"u_mean": float(np.mean(vals)), "u_sack": last["pct"].get("sack")}
        c = pd.DataFrame.from_dict(ctx, orient="index")
        h["key"] = "nm:" + h.name.map(_nn)
        d = h.join(c, on="key").dropna(subset=["u_mean"])
        yd = d.rookie_pct.values
        for col in ("u_mean", "u_sack"):
            b2, r22, _ = ols(d[["log_pick", col]].values, yd)
            resid = yd - (b[0] + b[1] * d.log_pick)
            print(f"pick + {col}: n={len(d)} R²={r22:.3f} coef={b2[2]:+.3f} partial r={np.corrcoef(resid, d[col])[0,1]:+.3f}")


if __name__ == "__main__":
    main()
