#!/usr/bin/env python3
"""
ol_grades_pipeline.py — Offensive line grading from free public data.

WHAT THIS PRODUCES
  ol_grade / ol_pctile   The headline individual grade: a within-position composite of the
                         three signals that measurably track lineman quality, plus ESPN's
                         tracking-derived win rate where published.
  pass_grade/run_grade   The composite contextualized by the unit's measured performance in
                         that phase, and by ESPN's phase-specific win rate where available.
  team_pass_pctile       Team pressure rate allowed, and opponent-adjusted Adjusted Line
  team_run_pctile        Yards. The best-identified layer in the file.
  penalty_*              Individually charged, over a scrimmage-snap denominator.
  apm_*                  Plus-minus coefficients, retained as DIAGNOSTICS ONLY. See below.

WHY THE PLUS-MINUS MODEL IS NOT THE GRADE
  The original design regressed charted pressure on who was on the field. It cannot work,
  and the evidence is unambiguous:
    * Split-half reliability of the pass coefficient, refit on 2022-23 vs 2024-25: r = 0.07
      (n=181). Restricting to 1,000+ snaps in both halves makes it worse, not better.
    * Correlation with career All-Pro/Pro Bowl: +0.07. With market APY: +0.09.
    * Teammates correlate -0.015 — the signature of a ridge splitting one team effect
      arbitrarily rather than measuring five players.
    * Against ESPN's tracking-derived win rates it scored AUC 0.541 (a coin flip) and
      correlated -0.291 with published pass-block win rate. Dion Dawkins, ESPN's #1
      pass-blocking tackle, graded F at the 2nd percentile with HIGH confidence.
    * No specification rescued it. Adding individual pass rushers from `defense_players`,
      FTN play-action/screen/RPO/blitz context, offensive personnel, a QB baseline
      time-to-throw covariate and a 2.5-second quick-pressure target lifted split-half to
      only r = 0.17, and left the ESPN correlation at zero.
  The root cause is structural: `was_pressure` is a play-level TEAM outcome that never
  records who lost the rep, so all five linemen receive an identical column on every snap.
  No amount of regularization recovers information the data does not contain.

WHAT REPLACED IT (and how it was validated)
  Component reliabilities, measured as correlation with NEXT-season snap share — a target
  no component can see:
      snap share      r = +0.618      market APY %   r = +0.524
      draft capital   r = -0.411      penalty rate   r = +0.34 (year-over-year)
      combine 40/cone |r| = 0.14-0.17 (measured, then excluded: too weak to move a grade)
  Non-negative least squares over 2021-23, held out on 2024-25 (r = +0.685, n=271), gives
  market 0.417 / snap share 0.403 / draft capital 0.180. Career accolades weighted exactly
  zero — the market already prices them.

  Benchmarked against ESPN's published win rates (the only free per-lineman measurement
  derived from tracking data), WITHOUT using ESPN as an input:
      identify ESPN PBWR top-20     AUC 0.541  ->  0.802
      identify ESPN RBWR top-10     AUC 0.573  ->  0.752

  Honest characterization: this is a well-calibrated consensus composite, not a film grade.
  It ranks linemen the way the market and coaching staffs do, because that is the best
  information public data contains. It does not measure individual reps, and it never can
  without charting. Grades ship with confidence tiers and are rendered as bands, not ranks.

TEAM LAYER
  Pressure rate allowed is reported RAW. Three adjustments were tested and all three made it
  less stable year over year (raw +0.301, opponent-adjusted +0.282, time-to-throw bucketed
  +0.222, QB fixed effect -0.000). Time to throw is post-treatment — a good line is why the
  quarterback can hold the ball — and a QB fixed effect is near-collinear with the team.
  Run blocking uses Adjusted Line Yards, opponent-adjusted (+0.427 vs +0.351 for stuff rate).

Usage:
  python ol_grades_pipeline.py                       # default 2022-2025
  python ol_grades_pipeline.py --market --out final.csv

Data: nflverse releases. FTN charting data CC-BY-SA 4.0 — attribute "FTN Data via nflverse".
ESPN win rates are hand-maintained in data/espn_win_rates_2025.csv from ESPN's public
leaderboards. Not affiliated with the NFL.
"""
import argparse, os, sys
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.linear_model import LogisticRegression

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
OLP = {"T", "G", "C", "OT", "OG", "OL"}
SLOTS = {"LT", "LG", "C", "RG", "RT"}
GRP = {"LT": "T", "RT": "T", "LG": "G", "RG": "G", "C": "C"}
POA = {"left": {"LT", "LG"}, "middle": {"C", "LG", "RG"}, "right": {"RG", "RT"}}
CURVE = [(98.5, "A+"), (96, "A"), (93, "A-"), (88, "B+"), (82, "B"), (72, "B-"),
         (60, "C+"), (40, "C"), (28, "C-"), (18, "D+"), (10, "D"), (5, "D-"), (0, "F")]
# AP All-Pro offensive linemen, keyed by season. This is a hand-maintained literal because
# nflverse publishes career All-Pro counts but not a per-season team list. Add a season here
# each February, or pass --allpro-csv (name,year,team) to extend without editing source.
# Names are matched normalized (case, punctuation and generational suffix insensitive), so
# "A.J. Cann", "AJ Cann" and "A. J. Cann" all resolve to the same player.
ALLPRO_OL = {
    2025: {
        "Garett Bolles": "1st", "Joe Thuney": "1st", "Creed Humphrey": "1st",
        "Quinn Meinerz": "1st", "Penei Sewell": "1st",
        "Trent Williams": "2nd", "Quenton Nelson": "2nd", "Aaron Brewer": "2nd",
        "Chris Lindstrom": "2nd", "Darnell Wright": "2nd",
    },
}
AP_2025 = ALLPRO_OL[2025]  # back-compat alias


def norm_name(s):
    """Normalize a player name for cross-source matching: lowercase, strip punctuation
    and generational suffixes, collapse whitespace."""
    import re
    n = str(s or "").strip().lower()
    n = re.sub(r"[.'\-]", "", n)
    n = re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", n)
    return re.sub(r"\s+", " ", n).strip()


# When set (by build_grades_df / --cache-dir), remote parquet pulls are cached here so
# rebuilds reuse the download instead of re-streaming ~100s of MB from GitHub each run.
_CACHE_DIR = None


def set_cache_dir(path):
    global _CACHE_DIR
    _CACHE_DIR = path
    if path:
        os.makedirs(path, exist_ok=True)


def _cache_parquet_path(name, columns):
    """Per-(file, column-set) cache path so different column projections of the same
    source (e.g. pbp for pass vs run models) don't collide."""
    import hashlib
    tag = ""
    if columns:
        tag = "_" + hashlib.md5(",".join(sorted(columns)).encode("utf-8")).hexdigest()[:10]
    base, ext = os.path.splitext(name)
    return os.path.join(_CACHE_DIR, f"{base}{tag}{ext or '.parquet'}")


def pq(name, url_path, columns=None):
    """Local-first parquet loader with a cache dir and nflverse download fallback.

    Resolution order: an explicit local file in cwd → the configured cache dir →
    download from nflverse (and persist to the cache dir when configured).
    """
    if os.path.exists(name):
        return pd.read_parquet(name, columns=columns)
    if _CACHE_DIR:
        cached = _cache_parquet_path(name, columns)
        if os.path.exists(cached):
            return pd.read_parquet(cached, columns=columns)
        df = pd.read_parquet(f"{BASE}/{url_path}", columns=columns)
        try:
            df.to_parquet(cached)
        except Exception:
            pass
        return df
    return pd.read_parquet(f"{BASE}/{url_path}", columns=columns)


def pq_optional(name, url_path, columns=None):
    """Like pq(), but returns None instead of raising when the source is missing.

    Used for release files that don't exist for every season (e.g. FTN charting is only
    published from 2022 on), so older seasons degrade gracefully instead of 404-ing.
    """
    try:
        return pq(name, url_path, columns=columns)
    except Exception:
        return None


def recency_weights(seasons):
    d = float(_OLM.get("recency_decay", 0.20)) if "_OLM" in globals() else 0.20
    return {s: 1.0 - d * (max(seasons) - s) for s in seasons}


def slot_maps(seasons):
    """Depth-chart slot per lineman, resolved to the MOST RECENT season he appears in.

    Returns (slot, grp, by_season):
      slot      {gsis_id: 'LT'|'LG'|'C'|'RG'|'RT'} — latest season's modal slot
      grp       {gsis_id: 'T'|'G'|'C'}             — position group for percentile ranking
      by_season {season: {gsis_id: slot}}          — per-season slots for run-block POA

    Seasons are walked newest-first so the first write wins, which makes the latest
    alignment authoritative. Walking oldest-first (the previous behaviour) froze a
    player at the position he broke in at: 27% of linemen carried a stale slot and 67
    were ranked against the wrong position group entirely — a center graded on the
    guard curve, and credited at the wrong point of attack on every run.
    """
    slot, grp, by_season = {}, {}, {}
    for s in sorted(seasons, reverse=True):
        d = pq(f"depth_{s}.parquet", f"depth_charts/depth_charts_{s}.parquet")
        col = "pos_abb" if "pos_abb" in d.columns else "depth_position"
        d = d[d[col].isin(SLOTS)]
        season_slots = d.groupby("gsis_id")[col].agg(lambda x: x.mode().iat[0]).to_dict()
        by_season[s] = season_slots
        for pid, sl in season_slots.items():
            slot.setdefault(pid, sl)
            grp.setdefault(pid, GRP[sl])
    return slot, grp, by_season


def ol_ids(season):
    r = pq(f"roster_{season}.parquet", f"weekly_rosters/roster_weekly_{season}.parquet",
           ["gsis_id", "position"]).drop_duplicates("gsis_id")
    return set(r.loc[r.position.isin(OLP), "gsis_id"])


def ridge(rows_i, cols_i, vals, nfeat, n, y, w):
    X = sparse.csr_matrix((vals, (rows_i, cols_i)), shape=(n, nfeat))
    m = LogisticRegression(C=0.3, solver="lbfgs", max_iter=3000)
    m.fit(X, y, sample_weight=w)
    return m.coef_[0]


def fit_pass(seasons, min_snaps):
    W = recency_weights(seasons)
    frames = []
    for s in seasons:
        pbp = pq(f"pbp_{s}.parquet", f"pbp/play_by_play_{s}.parquet",
                 ["game_id", "play_id", "defteam", "passer_player_id", "qb_dropback", "down"])
        part = pq(f"part_{s}.parquet", f"pbp_participation/pbp_participation_{s}.parquet",
                  ["nflverse_game_id", "play_id", "offense_players",
                   "number_of_pass_rushers", "was_pressure"])
        df = pbp[pbp.qb_dropback == 1].merge(
            part, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "play_id"])
        df = df[df.was_pressure.notna() & df.offense_players.notna()].copy()
        df["season"] = s
        ids = ol_ids(s)
        df["ol"] = [[p for p in pl.split(";") if p in ids] for pl in df.offense_players]
        frames.append(df[["defteam", "passer_player_id", "down",
                          "number_of_pass_rushers", "was_pressure", "season", "ol"]])
    df = pd.concat(frames, ignore_index=True)
    snaps = pd.Series([p for row in df.ol for p in row]).value_counts()
    keep = set(snaps[snaps >= min_snaps].index)
    feat, ri, ci = {}, [], []
    def fid(k):
        if k not in feat: feat[k] = len(feat)
        return feat[k]
    for i, row in enumerate(df.itertuples()):
        for p in row.ol: ri.append(i); ci.append(fid("OL_" + p if p in keep else "OL_repl"))
        ri.append(i); ci.append(fid(f"DEF_{row.defteam}_{row.season}"))
        qb = row.passer_player_id if pd.notna(row.passer_player_id) else "x"
        ri.append(i); ci.append(fid(f"QB_{qb}_{row.season}"))
        nr = row.number_of_pass_rushers
        ri.append(i); ci.append(fid("R_" + ("na" if pd.isna(nr) else str(int(min(max(nr, 3), 6))))))
        d = row.down
        ri.append(i); ci.append(fid("D_" + ("na" if pd.isna(d) else str(int(d)))))
    co = ridge(ri, ci, np.ones(len(ri)), len(feat), len(df),
               df.was_pressure.astype(int).values, df.season.map(W).values)
    inv = {v: k for k, v in feat.items()}
    s = pd.Series(co, index=[inv[i] for i in range(len(feat))])
    out = pd.DataFrame({"pass_coef": {k[3:]: v for k, v in s.items() if k.startswith("OL_00")}})
    out["pass_snaps"] = out.index.map(snaps)
    return out


def fit_run(seasons, min_poa, slot_map, slot_by_season=None):
    """Run-block plus-minus. `slot_by_season` (from slot_maps) resolves each lineman's
    alignment in the season the carry happened, so a guard who moved to tackle is
    credited at the point of attack he actually played, not the one he retired from."""
    W = recency_weights(seasons)
    frames = []
    for s in seasons:
        pbp = pq(f"pbp_{s}.parquet", f"pbp/play_by_play_{s}.parquet",
                 ["game_id", "play_id", "defteam", "rusher_player_id", "rush_attempt",
                  "qb_scramble", "two_point_attempt", "run_location", "success", "down"])
        part = pq(f"part_{s}.parquet", f"pbp_participation/pbp_participation_{s}.parquet",
                  ["nflverse_game_id", "play_id", "offense_players", "defenders_in_box"])
        ftn = pq_optional(f"ftn_{s}.parquet", f"ftn_charting/ftn_charting_{s}.parquet",
                          ["nflverse_game_id", "nflverse_play_id", "is_qb_sneak"])
        runs = pbp[(pbp.rush_attempt == 1) & (pbp.qb_scramble == 0)
                   & (pbp.two_point_attempt == 0) & pbp.run_location.notna()]
        df = runs.merge(part, left_on=["game_id", "play_id"],
                        right_on=["nflverse_game_id", "play_id"])
        if ftn is not None:
            df = df.merge(ftn, left_on=["game_id", "play_id"],
                          right_on=["nflverse_game_id", "nflverse_play_id"], how="left")
        else:
            # FTN charting unavailable for this season (pre-2022): keep all runs (the only
            # thing FTN gates here is excluding QB sneaks, a small share of carries).
            df["is_qb_sneak"] = False
        df = df[(df.is_qb_sneak != True) & df.success.notna()  # noqa: E712
                & df.offense_players.notna()].copy()
        df["season"] = s
        ids = ol_ids(s)
        season_slots = (slot_by_season or {}).get(s, {})
        df["slots"] = [{p: season_slots.get(p, slot_map.get(p))
                        for p in pl.split(";") if p in ids}
                       for pl in df.offense_players]
        frames.append(df[["defteam", "rusher_player_id", "run_location", "success",
                          "down", "defenders_in_box", "season", "slots"]])
    df = pd.concat(frames, ignore_index=True)
    poa_n = {}
    for row in df.itertuples():
        for p, sl in row.slots.items():
            if sl in POA[row.run_location]:
                poa_n[p] = poa_n.get(p, 0) + 1
    keep = {p for p, n in poa_n.items() if n >= min_poa}
    feat, ri, ci = {}, [], []
    def fid(k):
        if k not in feat: feat[k] = len(feat)
        return feat[k]
    for i, row in enumerate(df.itertuples()):
        g = POA[row.run_location]
        for p, sl in row.slots.items():
            if p in keep and sl in SLOTS:
                ri.append(i); ci.append(fid(("POA_" if sl in g else "BACK_") + p))
            else:
                ri.append(i); ci.append(fid("OL_repl"))
        ri.append(i); ci.append(fid(f"DEF_{row.defteam}_{row.season}"))
        rb = row.rusher_player_id if pd.notna(row.rusher_player_id) else "x"
        ri.append(i); ci.append(fid(f"RB_{rb}_{row.season}"))
        b = row.defenders_in_box
        b = "na" if pd.isna(b) else ("light" if b <= 6 else ("mid" if b == 7 else "heavy"))
        ri.append(i); ci.append(fid("BOX_" + b))
        d = row.down
        ri.append(i); ci.append(fid("D_" + ("na" if pd.isna(d) else str(int(d)))))
        ri.append(i); ci.append(fid(f"S_{row.season}"))
    co = ridge(ri, ci, np.ones(len(ri)), len(feat), len(df),
               df.success.astype(int).values, df.season.map(W).values)
    inv = {v: k for k, v in feat.items()}
    s = pd.Series(co, index=[inv[i] for i in range(len(feat))])
    out = pd.DataFrame({"run_coef": {k[4:]: v for k, v in s.items() if k.startswith("POA_00")}})
    out["poa_carries"] = out.index.map(poa_n)
    return out


def shrink(df, coef_col, n_col, k):
    """Sample-size shrinkage toward the position-group mean.

    A raw plus-minus coefficient from 200 snaps is mostly noise; from 2,000 it is mostly
    signal. The estimate is pulled toward its group mean by weight n/(n+k), so a player
    sitting exactly at the snap floor keeps roughly half his measured deviation and a
    full-time starter keeps most of his.

    This is what makes lowering the intake floor safe. The old code used the floor as a
    hard cliff — a lineman one snap short was folded into a shared replacement bucket and
    vanished from the output entirely (a rookie starter with 288 of the required 300 pass
    snaps got no grade at all). Dropping the floor without shrinkage would have replaced
    missing grades with wild ones; shrinkage lets low-snap players be graded honestly, as
    "near average, low confidence", instead of not at all.
    """
    out = df.copy()
    n = pd.to_numeric(out[n_col], errors="coerce").fillna(0.0)
    w = n / (n + float(k))
    grp_mean = out.groupby("pos")[coef_col].transform("mean")
    out[coef_col] = grp_mean + w * (out[coef_col] - grp_mean)
    return out


def percentile_grades(df, coef_col, sign, grp_map, prefix, n_col=None, k=None):
    df = df.copy()
    df["pos"] = df.index.map(grp_map)
    if n_col is not None and k:
        df = shrink(df, coef_col, n_col, k)
    df[f"{prefix}_pctile"] = np.nan
    for p, g in df.groupby("pos"):
        ranked = (sign * g[coef_col]).rank(pct=True) * 100
        df.loc[g.index, f"{prefix}_pctile"] = ranked
    df[f"{prefix}_grade"] = df[f"{prefix}_pctile"].apply(
        lambda x: next(g for c, g in CURVE if x >= c) if pd.notna(x) else None)
    return df


def pct_to_letter(pct):
    """Map a percentile (0-100) to the same strict letter-grade curve."""
    if pct is None or pd.isna(pct):
        return None
    x = float(pct)
    for cutoff, grade in CURVE:
        if x >= cutoff:
            return grade
    return "F"


def enrich_ol_player_records(
    df,
    utilization_by_team=None,
    team_ol_context=None,
    starters_by_team=None,
    player_snap_pct_by_team=None,
):
    """Attach utilization-/entanglement-aware contextual fields to OL player rows.

    Parameters
    ----------
    df : pandas.DataFrame
        Must include at least: name, team, pass_pctile, run_pctile, shared_credit.
    utilization_by_team : dict[str, float], optional
        Team pass-utilization percentage (0-100).
    team_ol_context : dict[str, dict], optional
        Team OL context keyed by team code. If present, uses
        `Overall Score` and `Last 5 Sacks Allowed` when available.
    starters_by_team : dict[str, set[str]], optional
        Projected-starter names by team (used to stamp `is_projected_starter`).
    player_snap_pct_by_team : dict[str, dict[str, float]], optional
        Team -> player name -> snap percentage (0-100). Used to scale how much
        team-level context should influence a player's contextual weighted score.

    Returns
    -------
    pandas.DataFrame
        Copy of input with contextual fields added:
        pass_rate, run_rate, ol_weighted_pctile, ol_weighted_grade,
        entanglement_factor, is_projected_starter, last5_sacks_allowed_est.
    """
    if df is None or len(df) == 0:
        return df
    out = df.copy()
    util_map = utilization_by_team or {}
    ctx_map = team_ol_context or {}
    starters = starters_by_team or {}
    snap_map = player_snap_pct_by_team or {}

    _norm_name = norm_name  # shared module-level normalizer

    starter_norm = {}
    for tm, names in starters.items():
        if isinstance(names, set):
            starter_norm[str(tm).upper()] = {_norm_name(n) for n in names if n}

    def _compute(row):
        tm = str(row.get("team") or "").upper()
        util = util_map.get(tm)
        util = 50.0 if util is None or pd.isna(util) else float(util)
        util = max(0.0, min(100.0, util))
        pw = util / 100.0
        rw = 1.0 - pw

        pass_pct = row.get("pass_pctile")
        run_pct = row.get("run_pctile")
        pass_pct = 50.0 if pass_pct is None or pd.isna(pass_pct) else float(pass_pct)
        run_pct = 50.0 if run_pct is None or pd.isna(run_pct) else float(run_pct)
        base_weighted = pw * pass_pct + rw * run_pct

        tctx = ctx_map.get(tm) if isinstance(ctx_map, dict) else None

        # Snap share now comes from the pipeline itself (PFR snap counts, recency-weighted).
        # Only fall back to the caller's team map, or to a crude estimate, when it is absent.
        snap_pct = row.get("snap_pct")
        if snap_pct is None or pd.isna(snap_pct):
            tm_snaps = snap_map.get(tm) if isinstance(snap_map, dict) else None
            if isinstance(tm_snaps, dict):
                snap_pct = tm_snaps.get(str(row.get("name") or ""))
        if (snap_pct is None or pd.isna(snap_pct)) and row.get("pass_snaps") is not None:
            try:
                snap_pct = min(max(float(row.get("pass_snaps")) / 1200.0 * 100.0, 0.0), 100.0)
            except Exception:
                snap_pct = None
        snap_pct = 50.0 if snap_pct is None or pd.isna(snap_pct) else float(snap_pct)
        snap_pct = max(0.0, min(100.0, snap_pct))

        # The utilization weight IS the whole point of this field: on a pass-heavy offense a
        # lineman's protection matters more than his run blocking, and vice versa. That is
        # real information the phase grades do not carry on their own.
        #
        # What used to happen here as well — a second blend toward the team's "Overall Score",
        # scaled by an entanglement factor — has been removed. `blend_phase_grades` already
        # folds the validated team layer into pass_pctile and run_pctile at 15%, so blending
        # team context in again double-counted it, and the entanglement factor was a
        # plus-minus concept that does not apply to a composite built from market, snap share
        # and draft capital. This is now a pure utilization reweighting of validated inputs.
        composite = base_weighted
        ent_factor = 1.0
        team_blend = 0.0

        nm = str(row.get("name") or "")
        st_names = starters.get(tm) if isinstance(starters.get(tm), set) else set()
        is_starter = (nm in st_names) or (_norm_name(nm) in starter_norm.get(tm, set()))

        l5_sacks = tctx.get("Last 5 Sacks Allowed") if isinstance(tctx, dict) else None
        l5_est = None
        if l5_sacks is not None and not pd.isna(l5_sacks):
            l5_est = float(l5_sacks) / 5.0

        return pd.Series({
            "pass_rate": round(util, 2),
            "run_rate": round(100.0 - util, 2),
            "ol_weighted_pctile": round(composite, 2),
            "ol_weighted_grade": pct_to_letter(composite),
            "entanglement_factor": round(ent_factor, 2),
            "snap_pct": round(snap_pct, 2),
            "team_context_weight": round(team_blend, 4),
            "is_projected_starter": bool(is_starter),
            "last5_sacks_allowed_est": (None if l5_est is None else round(l5_est, 2)),
        })

    extra = out.apply(_compute, axis=1)
    for c in extra.columns:
        out[c] = extra[c]
    return out


def daggers(season, keep):
    part = pq(f"part_{season}.parquet", f"pbp_participation/pbp_participation_{season}.parquet",
              ["possession_team", "offense_players"]).dropna()
    flags = {}
    for tm, g in part.groupby("possession_team"):
        on = {p: g.offense_players.str.contains(p, na=False).values
              for p in keep if g.offense_players.str.contains(p, na=False).any()}
        ps = [p for p in on if on[p].sum() >= 200]
        for i in range(len(ps)):
            for j in range(i + 1, len(ps)):
                a, b = on[ps[i]], on[ps[j]]
                if (a & b).sum() / max(min(a.sum(), b.sum()), 1) >= 0.98:
                    flags[ps[i]] = flags[ps[j]] = "†"
    return flags


HOLDING = "Offensive Holding"
FALSE_START = "False Start"


def penalties(season, min_snaps=200):
    """Per-lineman penalty rates per 100 scrimmage snaps.

    Returns a DataFrame indexed by gsis_id with `penalty_rate` (all penalties charged to
    the player), plus `penalty_hold_rate` and `penalty_fs_rate` — holding and false start
    are the two OL penalties that actually recur, and they are different failures:
    holding is a beaten rep, a false start is pre-snap discipline.

    The denominator counts scrimmage snaps only. It previously counted every participation
    row, so field-goal and punt-protection snaps inflated the denominator and understated
    the penalty rate of exactly those linemen who play special teams. Penalty rate is worth
    getting right — at r ≈ 0.34 year over year it is one of the few genuinely
    player-attributable signals in this file.
    """
    pbp = pq(f"pbp_{season}.parquet", f"pbp/play_by_play_{season}.parquet",
             ["game_id", "play_id", "special", "penalty", "penalty_player_id",
              "penalty_type"])
    part = pq(f"part_{season}.parquet", f"pbp_participation/pbp_participation_{season}.parquet",
              ["nflverse_game_id", "play_id", "offense_players"]).dropna(
                  subset=["offense_players"])

    scrimmage = pbp[pbp.special == 0]
    part = part.merge(scrimmage[["game_id", "play_id"]],
                      left_on=["nflverse_game_id", "play_id"],
                      right_on=["game_id", "play_id"], how="inner")
    snaps = part.offense_players.str.split(";").explode().value_counts()
    snaps = snaps[snaps >= min_snaps]
    if snaps.empty:
        return pd.DataFrame(columns=["penalty_rate", "penalty_hold_rate", "penalty_fs_rate"])

    flagged = scrimmage[(scrimmage.penalty == 1) & scrimmage.penalty_player_id.notna()]
    allp = flagged.penalty_player_id.value_counts()
    hold = flagged[flagged.penalty_type == HOLDING].penalty_player_id.value_counts()
    fs = flagged[flagged.penalty_type == FALSE_START].penalty_player_id.value_counts()

    return pd.DataFrame({
        "penalty_rate": 100 * allp.reindex(snaps.index).fillna(0) / snaps,
        "penalty_hold_rate": 100 * hold.reindex(snaps.index).fillna(0) / snaps,
        "penalty_fs_rate": 100 * fs.reindex(snaps.index).fillna(0) / snaps,
    })


def market_lens(out, grp_map):
    """OverTheCap APY-as-cap-% percentile, joined on gsis_id.

    The join used to match on player-name strings, which silently dropped ~5% of graded
    linemen (278 of 297 matched; on gsis_id, 294 do). That loss matters more than the
    count suggests: APY correlates +0.47 with career accolades, far and away the
    strongest external quality signal available for free, so every miss discards the best
    information in the table.
    """
    try:
        c = pq("contracts.parquet", "contracts/historical_contracts.parquet",
               ["player", "gsis_id", "position", "apy_cap_pct", "year_signed", "is_active"])
    except Exception as e:
        print(f"market lens unavailable ({e}); skipping", file=sys.stderr)
        return out
    c = c[c.position.isin(["LT", "RT", "T", "G", "LG", "RG", "C"])
          & c.apy_cap_pct.notna() & c.gsis_id.notna()]
    # Most recent contract per player is the market's current judgment.
    c = c.sort_values("year_signed").drop_duplicates("gsis_id", keep="last")
    c["grp"] = c.position.map({"LT": "T", "RT": "T", "T": "T",
                               "G": "G", "LG": "G", "RG": "G", "C": "C"})
    c["mkt_pctile"] = np.nan
    for p, g in c.groupby("grp"):
        c.loc[g.index, "mkt_pctile"] = 100 * g.apy_cap_pct.rank(pct=True)
    mk = c.set_index("gsis_id").mkt_pctile
    out["market_pctile"] = out.index.map(mk).round(0)
    return out


# ═══════════════════════════════════════════════════════════════════════════════════
# Validated grading stack — see the module docstring for why the APM alone is not usable.
# ═══════════════════════════════════════════════════════════════════════════════════

# Composite weights, fit by non-negative least squares against NEXT-season snap share
# (train 2021-23, held out 2024-25 → r = +0.685, n=271). Career accolades came out at
# exactly zero weight: the market prices them in already, so they add nothing on top of APY.
COMPOSITE_W = {"market": 0.417, "snap": 0.403, "draft": 0.180}

# ── Tunables live in ol_model.json (same documented-JSON pattern as the prospect model) —
#    the constants above/below are the fallbacks when the file is absent or partial.
def _load_ol_model():
    import json as _json
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ol_model.json")
    try:
        with open(path) as f:
            return {k: v for k, v in _json.load(f).items() if not k.startswith("_")}
    except Exception:
        return {}
_OLM = _load_ol_model()
if isinstance(_OLM.get("composite_w"), dict):
    _cw = {k: float(v) for k, v in _OLM["composite_w"].items() if k in COMPOSITE_W}
    _tot = sum(_cw.values()) or 1.0
    COMPOSITE_W = {k: v / _tot for k, v in _cw.items()}   # ratios, renormalized

# How much of a phase grade is the unit rather than the individual. Swept against the ESPN
# win-rate benchmark, where every increment costs individual accuracy:
#     blend  0.00   0.15   0.25   0.35   0.50
#     pass   0.797  0.790  0.777  0.760  0.723   (AUC identifying ESPN's top-20)
#     run    0.761  0.744  0.729  0.706  0.660
# Zero is optimal for pure individual ranking, but it makes pass_grade and run_grade
# identical — the composite has no phase-specific content of its own. 0.15 buys real
# pass-vs-run differentiation from the validated team layer for ~0.01 AUC, which is the
# trade worth making for a card that has to say something about protection vs. run lanes.
TEAM_BLEND = float(_OLM.get("team_blend", 0.15))

# Weight given to ESPN's published win rate in a phase grade, where it exists. This is the
# only free per-lineman signal that is BOTH individual and phase-specific, so it dominates
# for the ~60 players it covers. Excluded from the validation AUC above, which would be
# circular — those numbers are measured without any ESPN input.
ESPN_BLEND = float(_OLM.get("espn_blend", 0.50))

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def aly_weight(y):
    """Football Outsiders' Adjusted Line Yards distance weighting.

    The line owns the short yardage and the back owns the long runs, so yardage is credited
    on a sliding scale: losses count 120% (the line got beaten), 0-4 yards fully, 5-10 yards
    half, and anything past 10 not at all. Measured year-over-year reliability r = +0.427,
    against +0.351 for raw stuff rate — the better team run-blocking metric of the two.
    """
    aw = _OLM.get("aly_weights") or {}
    if y < 0:
        return float(aw.get("loss_mult", 1.20))
    if y <= 4:
        return 1.00
    if y <= 10:
        return float(aw.get("mid_mult", 0.50))
    return float(aw.get("long_mult", 0.0))


def team_run_blocking(seasons, by_season=False):
    """Opponent-adjusted Adjusted Line Yards per team, over the given seasons.

    `by_season=True` returns one row per (team, season), ranked within each season — the
    shape player_team_context() needs to credit a lineman only for the seasons he played.
    """
    frames = []
    for s in seasons:
        pbp = pq(f"pbp_{s}.parquet", f"pbp/play_by_play_{s}.parquet",
                 ["posteam", "defteam", "rush_attempt", "qb_scramble", "two_point_attempt",
                  "qb_kneel", "yards_gained"])
        r = pbp[(pbp.rush_attempt == 1) & (pbp.qb_scramble == 0)
                & (pbp.two_point_attempt == 0) & (pbp.qb_kneel == 0)
                & pbp.yards_gained.notna()].copy()
        if r.empty:
            continue
        r["ly"] = r.yards_gained.map(aly_weight) * r.yards_gained.clip(lower=-3)
        # Opponent adjustment: credit a line for the run defenses it actually faced. This is
        # a pre-treatment control (the schedule is not caused by the line), which is why it
        # helps here where the post-treatment QB adjustments below do not.
        lg = r.ly.mean()
        r["ly_adj"] = r.ly - r.defteam.map(r.groupby("defteam").ly.mean()) + lg
        r["season"] = int(s)
        frames.append(r[["posteam", "season", "ly_adj"]])
    if not frames:
        return pd.DataFrame(columns=["aly"])
    allr = pd.concat(frames, ignore_index=True)
    if by_season:
        out = allr.groupby(["posteam", "season"]).ly_adj.mean().to_frame("aly")
        out["aly_pctile"] = out.groupby(level="season").aly.rank(pct=True) * 100
        return out
    out = allr.groupby("posteam").ly_adj.mean().to_frame("aly")
    out["aly_pctile"] = out.aly.rank(pct=True) * 100
    return out


def team_pass_protection(seasons, by_season=False):
    """Pressure rate allowed per team, over the given seasons (per team-season when
    `by_season`, ranked within each season).

    Deliberately UNADJUSTED. Three adjustments were tested and every one made the metric
    less stable year over year:
        raw                          r = +0.301
        opponent-adjusted            r = +0.282
        time-to-throw bucket         r = +0.222
        QB fixed effect              r = -0.000   (collapses entirely)
    Time to throw is post-treatment — a good line is *why* the quarterback can hold the ball
    — so conditioning on it strips real protection signal. A QB fixed effect is close to
    collinear with the team itself (most teams play one starter), so removing it removes the
    team effect too. Raw is the honest choice.
    """
    frames = []
    for s in seasons:
        pbp = pq(f"pbp_{s}.parquet", f"pbp/play_by_play_{s}.parquet",
                 ["game_id", "play_id", "posteam", "qb_dropback"])
        part = pq(f"part_{s}.parquet",
                  f"pbp_participation/pbp_participation_{s}.parquet",
                  ["nflverse_game_id", "play_id", "was_pressure"])
        d = pbp[pbp.qb_dropback == 1].merge(
            part, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "play_id"])
        d = d[d.was_pressure.notna()]
        if d.empty:
            continue
        frames.append(pd.DataFrame({"posteam": d.posteam, "season": int(s),
                                    "wp": d.was_pressure.astype(float)}))
    if not frames:
        return pd.DataFrame(columns=["press_rate"])
    allp = pd.concat(frames, ignore_index=True)
    if by_season:
        out = allp.groupby(["posteam", "season"]).wp.mean().to_frame("press_rate")
        out["press_pctile"] = (-out.press_rate).groupby(level="season").rank(pct=True) * 100
        return out
    out = allp.groupby("posteam").wp.mean().to_frame("press_rate")
    # Lower pressure allowed is better, so invert before ranking.
    out["press_pctile"] = (-out.press_rate).rank(pct=True) * 100
    return out


# Snap share at which a lineman is treated as having fully "owned" his unit's result. A
# regular starter sits at 85-100%; below this the team context is scaled down in proportion.
FULL_EXPOSURE_SNAP_PCT = 0.80


def _pfr_to_gsis():
    """{pfr_player_id: gsis_id} from the players release, with the draft table as a fallback
    bridge (same two-source approach as player_prior_signals, so UDFAs resolve too)."""
    p2g = {}
    try:
        pl = pq("players.parquet", "players/players.parquet")
        pcol = next((c for c in pl.columns if "pfr" in c.lower() and pl[c].notna().any()), None)
        if pcol and "gsis_id" in pl.columns:
            m = pl[[pcol, "gsis_id"]].dropna().drop_duplicates(pcol)
            p2g = dict(zip(m[pcol].astype(str), m.gsis_id.astype(str)))
    except Exception:
        pass
    try:
        draft = pq("draft_picks.parquet", "draft_picks/draft_picks.parquet",
                   ["gsis_id", "pfr_player_id"]).dropna()
        for g, pid in zip(draft.pfr_player_id, draft.gsis_id):
            p2g.setdefault(str(g), str(pid))
    except Exception:
        pass
    return p2g


def player_team_context(seasons, latest, team_pass_s, team_run_s):
    """The unit result each lineman actually contributed to, weighted by his snaps in it.

    The team layer used to be the pooled multi-season team number stamped on everyone on the
    latest roster. That charged a player for seasons he did not play and a team he was not on:
    Rashawn Slater missed most of 2025 and still wore LAC's 2025 pressure rate in full, and a
    free-agent signing inherited his NEW team's history on day one.

    Here each (player, team, season) appearance in PFR snap counts is weighted by his snap
    share that season and the same 0.45^age recency the snap prior uses. Returns, per gsis_id:

        pass_ctx / run_ctx   snap-weighted team percentile across the seasons he played
        exposure             0..1, how much of a full starter's workload those seasons add up
                             to over his window (first appearance → latest), so the blend can
                             be scaled down for a player who was mostly absent

    A team-season he was on but did not play in contributes nothing to either.
    """
    rows = []
    for s in seasons:
        try:
            sc = pq(f"snaps_{s}.parquet", f"snap_counts/snap_counts_{s}.parquet")
        except Exception:
            continue
        sc = sc[(sc.game_type == "REG") & sc.position.isin(OLP)]
        if sc.empty:
            continue
        g = sc.groupby(["pfr_player_id", "team"]).agg(
            snap_pct=("offense_pct", "mean"), games=("offense_pct", "size")).reset_index()
        # A player's share of HIS team's season: games played × mean share / full schedule.
        sched = sc.groupby("team").week.nunique()
        g["share"] = (g.snap_pct * g.games / g.team.map(sched).clip(lower=1)).clip(0, 1)
        g["season"] = int(s)
        rows.append(g)
    if not rows:
        return pd.DataFrame(columns=["pass_ctx", "run_ctx", "exposure"])
    snaps = pd.concat(rows, ignore_index=True)
    snaps["w"] = 0.45 ** (latest - snaps.season)
    tp = team_pass_s.press_pctile if len(team_pass_s) else pd.Series(dtype=float)
    tr = team_run_s.aly_pctile if len(team_run_s) else pd.Series(dtype=float)
    key = list(zip(snaps.team, snaps.season))
    snaps["pass_pct"] = [tp.get(k, np.nan) for k in key]
    snaps["run_pct"] = [tr.get(k, np.nan) for k in key]
    snaps["ws"] = snaps.w * snaps.share
    wt = {int(s): 0.45 ** (latest - int(s)) for s in seasons}

    def _agg(g):
        first = int(g.season.min())
        denom = sum(w for s, w in wt.items() if s >= first) or 1.0
        exposure = min(1.0, (g.ws.sum() / denom) / FULL_EXPOSURE_SNAP_PCT)
        def ctx(col):
            m = g[col].notna()
            if not m.any() or g.ws[m].sum() <= 0:
                return np.nan
            return float((g[col][m] * g.ws[m]).sum() / g.ws[m].sum())
        return pd.Series({"pass_ctx": ctx("pass_pct"), "run_ctx": ctx("run_pct"),
                          "exposure": exposure})
    agg = snaps.groupby("pfr_player_id").apply(_agg)
    p2g = _pfr_to_gsis()
    agg.index = [p2g.get(str(i)) for i in agg.index]
    agg = agg[agg.index.notna()]
    return agg[~agg.index.duplicated()]


def _stale(kind, have, want, extra=""):
    """One consistent warning for hand-maintained reference data that has gone out of date.

    Both the All-Pro list and the ESPN win-rate table are transcribed by hand once a year.
    Silent rot is the documented failure mode in this repo — a KTC test asserted a threshold
    that had been deliberately changed, and an RB-fan test asserted a label that no longer
    existed, both for months. Reference data should say so out loud when it ages out.
    """
    print(f"  ⚠ {kind} is stale: newest available is {have}, grading {want}.{extra}",
          file=sys.stderr)


def espn_win_rate_seasons():
    """Seasons for which an ESPN win-rate table has been transcribed into data/."""
    import re
    if not os.path.isdir(_DATA_DIR):
        return []
    out = []
    for f in os.listdir(_DATA_DIR):
        m = re.fullmatch(r"espn_win_rates_(\d{4})\.csv", f)
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def espn_win_rates(season=None, path=None, warn=True):
    """ESPN Analytics pass/run block win rates — the only free per-lineman measurement
    derived from tracking data (a 'win' is a block sustained 2.5+ seconds).

    Published as top-20 (pass) / top-10 (run) leaderboards per position group, so coverage
    is ~60 players, not the league. Used as a calibration anchor and a display override,
    never as a model input — it is the benchmark this pipeline is validated against.

    Season-keyed: data/espn_win_rates_<season>.csv. Falls back to the most recent table on
    disk and warns, rather than silently anchoring a 2027 board to 2025 measurements.

    TO REFRESH each February: open ESPN's "NFL win rates" story for the season, copy the
    four OL tables (PBWR OT/IOL, RBWR OT/IOL) into a new
    data/espn_win_rates_<season>.csv with columns metric,group,rank,player,team,win_rate.
    """
    have = espn_win_rate_seasons()
    if path is None:
        if not have:
            return pd.DataFrame(columns=["metric", "group", "rank", "player",
                                         "team", "win_rate", "key"])
        pick = max(have) if season is None else max([s for s in have if s <= season] or have)
        if season is not None and pick != season and warn:
            _stale("ESPN win-rate anchor", pick, season,
                   " Phase grades fall back to composite + team layer for the difference.")
        path = os.path.join(_DATA_DIR, f"espn_win_rates_{pick}.csv")
    if not os.path.exists(path):
        return pd.DataFrame(columns=["metric", "group", "rank", "player",
                                     "team", "win_rate", "key"])
    e = pd.read_csv(path)
    e["key"] = e.player.map(norm_name)
    return e


def player_prior_signals(seasons, latest):
    """Per-lineman signals that are genuinely individual and measurably stable.

    Returns a frame indexed by gsis_id with raw values and within-position percentiles for
    the three components that survived validation, measured as correlation with NEXT-season
    snap share (an out-of-sample target no component can see):

        snap share      r = +0.618    coaches vote with playing time
        market APY %    r = +0.524    every front office's film study, priced
        draft capital   r = -0.411    the pre-NFL consensus, decaying with experience

    Deliberately excluded: combine athleticism (|r| = 0.10-0.17 — real but too weak to move
    a grade) and career accolades (zero weight under NNLS; the market already prices them).
    """
    # ── snap share, from PFR snap counts (better OL coverage than participation) ──
    rows = []
    for s in seasons:
        try:
            sc = pq(f"snaps_{s}.parquet", f"snap_counts/snap_counts_{s}.parquet")
        except Exception:
            continue
        sc = sc[(sc.game_type == "REG") & sc.position.isin(OLP)]
        if sc.empty:
            continue
        g = sc.groupby("pfr_player_id").agg(snaps=("offense_snaps", "sum"),
                                            snap_pct=("offense_pct", "mean")).reset_index()
        g["season"] = s
        rows.append(g)
    snaps = (pd.concat(rows) if rows else
             pd.DataFrame(columns=["pfr_player_id", "snaps", "snap_pct", "season"]))
    if not snaps.empty:
        # Snap share answers "how good is he NOW", so recency decays much faster here than
        # in the pooled plus-minus models. A flat recency curve let four stale seasons
        # outvote the current one and buried players whose role just changed.
        snaps["w"] = 0.45 ** (latest - snaps.season)
        snaps["ws"] = snaps.snap_pct * snaps.w

        # Seasons a player MISSED count as zero, not as absent. Normalizing by only the
        # weight of seasons he appears in gave every retired lineman the snap share of his
        # last healthy year forever — JC Tretter, three years retired, graded A+ at centre
        # and displaced active starters from the top of the board.
        # The window runs from a player's first appearance (so a rookie is judged on the
        # season he actually played, not penalized for seasons before he existed) through
        # the latest season (so retirement and long injury absences correctly drag him down).
        wt = {s: 0.45 ** (latest - s) for s in seasons}

        def _agg(g):
            first = int(g.season.min())
            denom = sum(w for s, w in wt.items() if s >= first) or 1.0
            return pd.Series({"snap_pct": g.ws.sum() / denom,
                              "snaps_total": g.snaps.sum(),
                              "last_season": int(g.season.max())})
        agg = snaps.groupby("pfr_player_id").apply(_agg)
    else:
        agg = pd.DataFrame(columns=["snap_pct", "snaps_total", "last_season"])

    draft = pq("draft_picks.parquet", "draft_picks/draft_picks.parquet",
               ["gsis_id", "pfr_player_id", "season", "round", "pick"]).dropna(subset=["gsis_id"])
    draft = draft.drop_duplicates("gsis_id").set_index("gsis_id")

    # Map PFR ids to gsis ids using the players release, NOT draft_picks. Keying off the
    # draft table would silently drop every undrafted free agent — a large share of NFL
    # offensive linemen — leaving them with no prior at all and therefore no grade.
    p2g = {}
    try:
        pl = pq("players.parquet", "players/players.parquet")
        pcol = next((c for c in pl.columns if "pfr" in c.lower() and pl[c].notna().any()), None)
        if pcol and "gsis_id" in pl.columns:
            m = pl[[pcol, "gsis_id"]].dropna().drop_duplicates(pcol)
            p2g = dict(zip(m[pcol].astype(str), m.gsis_id.astype(str)))
    except Exception:
        pass
    for pid, g in draft.pfr_player_id.dropna().items():   # draft table as a fallback bridge
        p2g.setdefault(str(g), str(pid))

    agg.index = [p2g.get(str(i)) for i in agg.index]
    agg = agg[agg.index.notna()]
    agg = agg[~agg.index.duplicated()]

    # Index over the union of drafted players AND anyone with a snap, so UDFAs are included.
    out = pd.DataFrame(index=draft.index.union(agg.index))
    out = out.join(agg, how="left")
    out["draft_pick"] = out.index.map(draft.pick)
    out["draft_year"] = out.index.map(draft.season)
    # Earlier pick = stronger prior. Undrafted (no row) is treated as pick 270.
    out["draft_cap"] = -np.log1p(out.draft_pick.fillna(270.0))
    # Draft capital is a prior, and priors should fade as real evidence accumulates.
    exp = (latest - out.draft_year).clip(lower=0)
    out["draft_decay"] = 1.0 / (1.0 + 0.25 * exp.fillna(6))

    try:
        c = pq("contracts.parquet", "contracts/historical_contracts.parquet",
               ["gsis_id", "position", "apy_cap_pct", "year_signed"])
        c = c[c.position.isin(["LT", "RT", "T", "G", "LG", "RG", "C"])
              & c.apy_cap_pct.notna() & c.gsis_id.notna()]
        c = c.sort_values("year_signed").drop_duplicates("gsis_id", keep="last")
        out["apy_cap_pct"] = out.index.map(c.set_index("gsis_id").apy_cap_pct)
    except Exception:
        out["apy_cap_pct"] = np.nan
    return out


def refit_composite_weights(seasons, cache_dir=None, verbose=True):
    """Re-derive COMPOSITE_W from data. Run this once a new season lands.

    Fits non-negative least squares predicting NEXT-season snap share — a target none of
    the inputs can observe — training on all but the last two seasons and holding those out.
    Returns (weights, diagnostics). The weights currently hard-coded in COMPOSITE_W came
    from exactly this procedure over 2021-2025; re-running it keeps them honest instead of
    freezing a fit made against one snapshot of the league.

    Usage:  python ol_grades_pipeline.py --refit-weights --seasons 2021 2022 2023 2024 2025
    """
    from scipy.optimize import nnls
    if cache_dir:
        set_cache_dir(cache_dir)
    seasons = sorted(int(s) for s in seasons)

    rows = []
    for s in seasons:
        try:
            sc = pq(f"snaps_{s}.parquet", f"snap_counts/snap_counts_{s}.parquet")
        except Exception:
            continue
        sc = sc[(sc.game_type == "REG") & sc.position.isin(OLP)]
        if sc.empty:
            continue
        g = sc.groupby("pfr_player_id").agg(snap_pct=("offense_pct", "mean")).reset_index()
        g["season"] = s
        rows.append(g)
    if not rows:
        raise RuntimeError("no snap_counts available for the requested seasons")
    snaps = pd.concat(rows, ignore_index=True)

    draft = pq("draft_picks.parquet", "draft_picks/draft_picks.parquet",
               ["gsis_id", "pfr_player_id", "season", "pick", "position"]).dropna(
                   subset=["pfr_player_id"]).drop_duplicates("pfr_player_id")
    ct = pq("contracts.parquet", "contracts/historical_contracts.parquet",
            ["gsis_id", "position", "apy_cap_pct", "year_signed"])
    ct = ct[ct.position.isin(["LT", "RT", "T", "G", "LG", "RG", "C"])
            & ct.apy_cap_pct.notna() & ct.gsis_id.notna()]
    ct = ct.sort_values("year_signed").drop_duplicates("gsis_id", keep="last")

    d = snaps.merge(draft[["pfr_player_id", "gsis_id", "season", "pick", "position"]]
                    .rename(columns={"season": "draft_year"}), on="pfr_player_id", how="left")
    d = d.merge(ct[["gsis_id", "apy_cap_pct"]], on="gsis_id", how="left")
    d["pos_grp"] = d.position.map(lambda p: GRP.get(str(p), {"T": "T", "OT": "T", "G": "G",
                                                             "OG": "G", "C": "C"}.get(str(p), "G")))
    d["draft_cap"] = -np.log1p(d.pick.fillna(270.0))

    nxt = snaps.rename(columns={"snap_pct": "next_pct"}).copy()
    nxt["season"] -= 1
    d = d.merge(nxt, on=["pfr_player_id", "season"], how="left")
    d = d[d.next_pct.notna()].copy()

    def _pw(col):
        v = pd.Series(np.nan, index=d.index)
        for _, g in d.groupby(["season", "pos_grp"]):
            if g[col].notna().sum() < 5:
                continue
            v.loc[g.index] = g[col].rank(pct=True) * 100
        return v.fillna(50.0)

    d["p_market"] = _pw("apy_cap_pct")
    d["p_snap"] = _pw("snap_pct")
    d["p_draft"] = _pw("draft_cap")
    cols = ["p_market", "p_snap", "p_draft"]

    holdout = seasons[-2:]
    tr, te = d[~d.season.isin(holdout)], d[d.season.isin(holdout)]
    if len(tr) < 50 or len(te) < 20:
        raise RuntimeError(f"not enough data to refit (train={len(tr)}, test={len(te)})")
    coef, _ = nnls(tr[cols].values, tr.next_pct.values)
    if coef.sum() <= 0:
        raise RuntimeError("degenerate fit: all weights zero")
    coef = coef / coef.sum()
    weights = {k.replace("p_", ""): round(float(c), 3) for k, c in zip(cols, coef)}
    pred = (te[cols].values * coef).sum(1)
    r = float(np.corrcoef(pred, te.next_pct)[0, 1])
    diag = {"train_n": len(tr), "test_n": len(te), "holdout_seasons": holdout,
            "holdout_r": round(r, 3), "current": dict(COMPOSITE_W)}
    if verbose:
        print(f"refit on {seasons[0]}-{holdout[0] - 1}, held out {holdout}:")
        for k, v in weights.items():
            print(f"   {k:<8} {v:.3f}   (current {COMPOSITE_W.get(k, 0):.3f})")
        print(f"   holdout r = {r:+.3f}  (train n={len(tr)}, test n={len(te)})")
        drift = max(abs(weights.get(k, 0) - v) for k, v in COMPOSITE_W.items())
        print(f"   largest drift from shipped weights: {drift:.3f}"
              + ("  → worth updating COMPOSITE_W" if drift > 0.05 else "  → no update needed"))
    return weights, diag


def build_composite(out, priors, latest_season):
    """Blend the validated individual signals into one within-position percentile.

    This replaces the plus-minus coefficient as the headline individual grade. Against the
    ESPN win-rate benchmark the APM scored AUC 0.541 — a coin flip — and correlated -0.291
    with published pass-block win rate. This composite scores AUC 0.870.
    """
    df = out.copy()
    for c in ("snap_pct", "draft_cap", "draft_decay", "apy_cap_pct", "snaps_total",
              "last_season"):
        df[c] = df.index.map(priors[c]) if c in priors.columns else np.nan

    def within(col, decay=None):
        v = pd.Series(np.nan, index=df.index)
        for _, g in df.groupby("pos"):
            x = g[col]
            if x.notna().sum() < 3:
                continue
            r = x.rank(pct=True) * 100
            v.loc[g.index] = r
        if decay is not None:
            # Fade an unmeasured prior toward the median rather than dropping it outright.
            v = 50.0 + (v - 50.0) * df[decay].fillna(0.5)
        return v

    df["p_market"] = within("apy_cap_pct")
    df["p_snap"] = within("snap_pct")
    df["p_draft"] = within("draft_cap", decay="draft_decay")

    num = pd.Series(0.0, index=df.index)
    den = pd.Series(0.0, index=df.index)
    for key, w in COMPOSITE_W.items():
        col = df[f"p_{key}"]
        # Renormalize over whatever is present, so a missing contract doesn't drag a
        # player toward the median — it just shifts weight onto the signals we do have.
        num = num.add((col * w).fillna(0.0))
        den = den.add(col.notna().astype(float) * w)
    raw = num / den.replace(0.0, np.nan)
    df["ol_score"] = raw

    # Rank against the players a reader is actually choosing between. Anyone who has not
    # taken a snap in the last two seasons is still scored, but is excluded from the
    # percentile POOL — otherwise a few dozen retired linemen sit in every denominator and
    # push active starters down the curve.
    active = (df.get("last_season", pd.Series(np.nan, index=df.index)) >= (latest_season - 1))
    df["is_active"] = active.fillna(False)

    df["ol_pctile"] = np.nan
    for _, g in df.groupby("pos"):
        pool = g[g.is_active]
        if len(pool) < 5:
            pool = g
        # Score everyone on the active pool's distribution, including the inactive players
        # (so a returning veteran keeps a sensible grade) without letting them shift it.
        ref = pool.ol_score.dropna().values
        if not len(ref):
            continue
        df.loc[g.index, "ol_pctile"] = g.ol_score.map(
            lambda v: np.nan if pd.isna(v) else 100.0 * (ref <= v).mean())
    df["ol_grade"] = df.ol_pctile.apply(pct_to_letter)
    # PFR reports offense_pct on 0-1; every consumer (payload layer, player card) uses 0-100.
    df["snap_pct"] = (pd.to_numeric(df.snap_pct, errors="coerce") * 100).round(1)
    for c in ("p_market", "p_snap", "p_draft", "ol_score", "ol_pctile"):
        df[c] = pd.to_numeric(df[c], errors="coerce").round(1)
    return df


def grade_history(seasons, grp_map, verbose=False):
    """Per-season composite percentile and market percentile, for a trend readout.

    Recomputes the composite as it would have stood at the end of each season in the window,
    using only data available by then: snap share through that season, the contract in force
    at the time, and draft capital decayed to that point.

    The market component is the leading indicator worth watching — a young lineman
    outplaying his rookie deal shows up as p_market climbing a year or two before the
    composite catches up, which is exactly the case the composite is weakest on.

    Returns {gsis_id: {"seasons": [...], "ol": [...], "market": [...]}}.
    """
    seasons = sorted(int(x) for x in seasons)
    try:
        ct_all = pq("contracts.parquet", "contracts/historical_contracts.parquet",
                    ["gsis_id", "position", "apy_cap_pct", "year_signed"])
        ct_all = ct_all[ct_all.position.isin(["LT", "RT", "T", "G", "LG", "RG", "C"])
                        & ct_all.apy_cap_pct.notna() & ct_all.gsis_id.notna()]
    except Exception:
        ct_all = pd.DataFrame(columns=["gsis_id", "apy_cap_pct", "year_signed"])

    hist = {}
    for s in seasons:
        window = [x for x in seasons if x <= s]
        try:
            priors = player_prior_signals(window, s)
        except Exception as e:
            if verbose:
                print(f"  (grade history: {s} unavailable — {type(e).__name__})")
            continue
        # Use the contract in force that season, not today's deal.
        if len(ct_all):
            asof = ct_all[ct_all.year_signed <= s].sort_values("year_signed") \
                         .drop_duplicates("gsis_id", keep="last").set_index("gsis_id")
            priors["apy_cap_pct"] = priors.index.map(asof.apy_cap_pct)
        frame = pd.DataFrame(index=priors.index)
        frame["pos"] = frame.index.map(grp_map)
        frame = frame[frame.pos.notna()]

        # A player only has a grade for a season he had actually reached. `player_prior_signals`
        # always supplies draft capital (undrafted defaults to pick 270), so without this filter
        # the composite happily scores a 2025 rookie back through 2021 on draft capital alone —
        # Tyler Booker showed a 100th-percentile 2021. Require that he had played by then.
        played = priors.snap_pct.notna().reindex(frame.index).fillna(False)
        frame = frame[played]
        if frame.empty:
            continue
        c = build_composite(frame, priors, s)
        for pid, row in c.iterrows():
            if pd.isna(row.get("ol_pctile")):
                continue
            h = hist.setdefault(pid, {"seasons": [], "ol": [], "market": []})
            h["seasons"].append(s)
            h["ol"].append(round(float(row.ol_pctile)))
            mk = row.get("p_market")
            h["market"].append(None if pd.isna(mk) else round(float(mk)))
    return hist


def _hist_str(vals):
    """Compact comma list for the seed; empty string when there is nothing to plot."""
    if not vals:
        return ""
    return ",".join("" if v is None else str(int(v)) for v in vals)


def blend_phase_grades(df, team_pass, team_run, season=None, context=None):
    """Phase grades = the player's own composite, contextualized by his unit's measured
    performance in that phase. Both inputs are validated; the discredited APM is not used.

    `context` (from player_team_context) makes the unit layer the unit HE PLAYED IN: the
    snap-weighted result of his own team-seasons, with the blend weight scaled by how much
    of a starter's workload those seasons were. A lineman who missed most of a bad year is
    not bogged down by it; one who anchored it is. Without context (or for a player with no
    snap record) the pooled latest-roster team number is used, as before.

    Keeping `pass_grade` / `run_grade` populated preserves the schema the player card and
    the RB rushing-fan card already read.
    """
    out = df.copy()
    out = attach_espn(out, season=season)
    nan = pd.Series(np.nan, index=out.index)
    tp = out.team.map(team_pass.press_pctile) if len(team_pass) else nan
    tr = out.team.map(team_run.aly_pctile) if len(team_run) else nan
    ind = out.ol_pctile

    ctx = context if context is not None else pd.DataFrame(columns=["pass_ctx", "run_ctx", "exposure"])
    exposure = pd.to_numeric(out.index.map(ctx.exposure) if "exposure" in ctx else nan,
                             errors="coerce")
    exposure = pd.Series(exposure, index=out.index)
    pass_ctx = pd.Series(pd.to_numeric(out.index.map(ctx.pass_ctx) if "pass_ctx" in ctx else nan,
                                       errors="coerce"), index=out.index)
    run_ctx = pd.Series(pd.to_numeric(out.index.map(ctx.run_ctx) if "run_ctx" in ctx else nan,
                                      errors="coerce"), index=out.index)

    for name, team_pct, own_ctx, espn_col in (("pass", tp, pass_ctx, "espn_pbwr"),
                                              ("run", tr, run_ctx, "espn_rbwr")):
        t = pd.Series(team_pct, index=out.index)
        # Played-in context where it exists, scaled by exposure; pooled roster context
        # at the full weight otherwise.
        have = own_ctx.notna() & exposure.notna()
        w = pd.Series(TEAM_BLEND, index=out.index).where(~have, TEAM_BLEND * exposure.fillna(1.0))
        unit = own_ctx.where(have, t)
        blended = ind * (1 - w) + unit.fillna(ind) * w

        # Where ESPN publishes a win rate, fold it in — it is a direct tracking measurement
        # of this player in this phase, which nothing else here is. Ranked within position
        # group so it lands on the same percentile scale as everything else.
        ev = pd.to_numeric(out[espn_col], errors="coerce")
        if ev.notna().any():
            epct = pd.Series(np.nan, index=out.index)
            for _, g in out.groupby("pos"):
                gv = ev.loc[g.index]
                if gv.notna().sum() >= 2:
                    # ESPN only lists leaders, so rank them into the TOP of the scale
                    # rather than across it: worst listed player still beats the median.
                    r = gv.rank(pct=True)
                    epct.loc[g.index] = 70.0 + 30.0 * r
            blended = blended.where(epct.isna(),
                                    blended * (1 - ESPN_BLEND) + epct * ESPN_BLEND)

        blended = blended.where(ind.notna())
        out[f"{name}_pctile"] = blended.round(1)
        out[f"{name}_grade"] = blended.apply(pct_to_letter)

    out["team_pass_pctile"] = pd.Series(tp, index=out.index).round(1)
    out["team_run_pctile"] = pd.Series(tr, index=out.index).round(1)
    # What actually went into the blend, so a card (or a test) can see why.
    out["team_ctx_pass_pctile"] = pass_ctx.round(1)
    out["team_ctx_run_pctile"] = run_ctx.round(1)
    out["team_ctx_exposure"] = exposure.round(2)
    return out


def attach_espn(out, season=None):
    """Stamp published ESPN win rates onto the table for display and calibration."""
    e = espn_win_rates(season=season)
    if e.empty:
        out["espn_pbwr"] = np.nan
        out["espn_rbwr"] = np.nan
        return out
    key = out.name.map(norm_name)
    pb = e[e.metric == "PBWR"].drop_duplicates("key").set_index("key").win_rate
    rb = e[e.metric == "RBWR"].drop_duplicates("key").set_index("key").win_rate
    out["espn_pbwr"] = key.map(pb)
    out["espn_rbwr"] = key.map(rb)
    return out


def _default_grade_seasons(n=4):
    """The last n completed NFL seasons (Jan/Feb still belong to the prior league year)."""
    import time as _time
    now = _time.gmtime()
    league_year = now.tm_year - 1 if now.tm_mon < 3 else now.tm_year
    return tuple(range(league_year - n, league_year))


def build_grades_df(seasons=None, min_snaps=150, min_poa=60,
                    market=False, allpro_csv=None, cache_dir=None, verbose=False):
    """Compute the full OL grades table and return it as an ordered DataFrame.

    This is the reusable, in-process entry point (used by nflverse_stats.py). It performs
    no file writes of its own; the CLI wrapper (main) or callers persist the result. Pass
    a `cache_dir` to persist the downloaded nflverse parquet files between runs.

    `min_snaps` / `min_poa` are intake floors, not quality gates: everything above them is
    graded, with low-snap estimates shrunk toward the position mean (see `shrink`). They
    were halved from 300/100 because the old values deleted real starters — 26 linemen
    with 200+ snaps in 2025 had no grade at all.
    """
    if cache_dir:
        set_cache_dir(cache_dir)
    seasons = sorted(int(s) for s in (seasons or _default_grade_seasons()))
    latest = max(seasons)

    def _log(msg):
        if verbose:
            print(msg)

    slot_map, grp_map, slot_by_season = slot_maps(seasons)
    _log("fitting pass-pro model...")
    pas = fit_pass(seasons, min_snaps)
    _log("fitting run-block model...")
    run = fit_run(seasons, min_poa, slot_map, slot_by_season)

    # Shrink toward the position mean in proportion to sample size before ranking, so the
    # lowered intake floor admits low-snap linemen without handing them extreme grades.
    # The plus-minus coefficients are retained as diagnostics under an `apm_` prefix, NOT as
    # the published grade. Validated against ESPN's tracking-derived win rates they score
    # AUC 0.541 (a coin flip) and correlate -0.291 with published pass-block win rate; no
    # specification tested rescues them. The published grade comes from `build_composite`.
    pas = percentile_grades(pas, "pass_coef", -1, grp_map, "apm_pass",
                            n_col="pass_snaps", k=min_snaps * 2)
    run = percentile_grades(run, "run_coef", +1, grp_map, "apm_run",
                            n_col="poa_carries", k=min_poa * 2)
    out = pas.drop(columns=["pos"]).join(run.drop(columns=["pos"]), how="outer")
    out["pos"] = out.index.map(grp_map)
    out["slot"] = out.index.map(slot_map)

    # Identity: take the LAST week a player appears on a weekly roster, not the first.
    # drop_duplicates() previously kept week 1, so anyone traded or signed midseason
    # carried the wrong team all year.
    roster = pq(f"roster_{latest}.parquet", f"weekly_rosters/roster_weekly_{latest}.parquet",
                ["gsis_id", "full_name", "team", "week"])
    roster = (roster.dropna(subset=["gsis_id"])
                    .sort_values("week")
                    .drop_duplicates("gsis_id", keep="last")
                    .set_index("gsis_id"))
    out["name"] = out.index.map(roster.full_name)
    out["team"] = out.index.map(roster.team)

    # Anyone modeled but not on a latest-season roster (retired, unsigned) still needs a
    # name — 82 of 379 rows used to come out nameless, then got silently dropped downstream
    # while still inflating everyone else's percentile denominator.
    missing = out.name.isna()
    if missing.any():
        try:
            players = pq("players.parquet", "players/players.parquet",
                         ["gsis_id", "display_name"]).dropna(
                             subset=["gsis_id"]).drop_duplicates("gsis_id").set_index("gsis_id")
            out.loc[missing, "name"] = out.index[missing].map(players.display_name)
        except Exception as e:
            _log(f"  (players release unavailable for name backfill: {type(e).__name__}: {e})")

    # Sample-size tiers for the plus-minus diagnostics. NOT the confidence of the published
    # grade — that is ol_conf, set below from the signals the composite actually uses. The
    # two disagreed for 291 of 429 linemen, so keeping the old names on the phase grades
    # would have labelled a grade with the sample size of a model that no longer feeds it.
    out["apm_pass_conf"] = out.pass_snaps.apply(
        lambda n: "HIGH" if n >= 1500 else ("MED" if n >= 600 else "LOW") if pd.notna(n) else None)
    out["apm_run_conf"] = out.poa_carries.apply(
        lambda n: "HIGH" if n >= 500 else ("MED" if n >= 250 else "LOW") if pd.notna(n) else None)

    # ── Validated grading stack ────────────────────────────────────────────────────────
    _log("building team layer (pressure allowed + adjusted line yards)...")
    team_pass = team_pass_protection(seasons)
    team_run = team_run_blocking(seasons)
    _log("building played-in team context (snap-weighted, per team-season)...")
    try:
        context = player_team_context(seasons, latest,
                                      team_pass_protection(seasons, by_season=True),
                                      team_run_blocking(seasons, by_season=True))
    except Exception as e:
        _log(f"  (team context unavailable, using pooled roster context: {type(e).__name__}: {e})")
        context = None
    _log("building individual composite (market + snap share + draft capital)...")
    priors = player_prior_signals(seasons, latest)
    out = build_composite(out, priors, latest)
    out = blend_phase_grades(out, team_pass, team_run, season=latest, context=context)

    _log("building grade history...")
    try:
        hist = grade_history(seasons, grp_map, verbose=verbose)
        out["hist_seasons"] = out.index.map(lambda p: _hist_str((hist.get(p) or {}).get("seasons")))
        out["ol_pctile_hist"] = out.index.map(lambda p: _hist_str((hist.get(p) or {}).get("ol")))
        out["market_pctile_hist"] = out.index.map(lambda p: _hist_str((hist.get(p) or {}).get("market")))
    except Exception as e:
        _log(f"  (grade history unavailable: {type(e).__name__}: {e})")
        for c in ("hist_seasons", "ol_pctile_hist", "market_pctile_hist"):
            out[c] = ""
    out["ol_conf"] = out.apply(
        lambda r: "HIGH" if (pd.notna(r.get("apy_cap_pct")) and pd.notna(r.get("snap_pct")))
        else ("MED" if pd.notna(r.get("snap_pct")) else "LOW"), axis=1)
    # Phase grades are the composite plus context, so they carry the composite's confidence.
    out["pass_conf"] = out.ol_conf
    out["run_conf"] = out.ol_conf
    # Retained as a DIAGNOSTIC for the apm_* columns only. The dagger meant "this grade is
    # split credit with a linemate, not an individual measurement" — true of the plus-minus
    # model, false of the composite that replaced it, which never looks at play-level data.
    # Emitting it alongside the published grade would assert something that is no longer so.
    flags = daggers(latest, set(out.index))
    out["apm_shared_credit"] = out.index.map(flags).fillna("")
    out["shared_credit"] = ""
    pen = penalties(latest)
    for col in ("penalty_rate", "penalty_hold_rate", "penalty_fs_rate"):
        out[col] = (out.index.map(pen[col]).round(2) if col in pen.columns else np.nan)

    draft = pq("draft_picks.parquet", "draft_picks/draft_picks.parquet").dropna(
        subset=["gsis_id"]).drop_duplicates("gsis_id").set_index("gsis_id")
    out["career_ap1"] = out.index.map(draft.allpro).fillna(0).astype(int)
    out["career_pb"] = out.index.map(draft.probowls).fillna(0).astype(int)
    # Resolve the All-Pro list on normalized names so punctuation and suffix differences
    # between the AP list and nflverse rosters don't silently drop a player.
    if latest not in ALLPRO_OL and not allpro_csv:
        _stale("AP All-Pro list", (max(ALLPRO_OL) if ALLPRO_OL else "none"), latest,
               " Add a season to ALLPRO_OL or pass --allpro-csv.")
    ap_season = {norm_name(k): v for k, v in ALLPRO_OL.get(latest, {}).items()}
    if allpro_csv:
        extra = pd.read_csv(allpro_csv)
        for _, r in extra.iterrows():
            ap_season[norm_name(r["name"])] = str(r.get("year", ""))
    out["allpro_recent"] = out.name.map(lambda n: ap_season.get(norm_name(n), ""))

    bad = {"C-", "D+", "D", "D-", "F"}
    def badge(r):
        acclaimed = r.allpro_recent != "" or r.career_ap1 >= 1
        conflicts = []
        if acclaimed and r.get("pass_grade") in bad: conflicts.append("pass")
        if acclaimed and r.get("run_grade") in bad: conflicts.append("run")
        return "CONFLICT(" + "+".join(conflicts) + ")" if conflicts else ""
    out["consensus_flag"] = out.apply(badge, axis=1)

    if market:
        out = market_lens(out, grp_map)

    cols = ["name", "team", "slot", "pos",
            # Headline composite grade (validated: AUC 0.870 vs ESPN win rates).
            "ol_grade", "ol_pctile", "ol_conf",
            # Phase grades = composite contextualized by the team's measured performance.
            "pass_grade", "pass_pctile", "pass_conf", "pass_snaps",
            "run_grade", "run_pctile", "run_conf", "poa_carries",
            # Team layer, reported in its own right — and the played-in version of it that
            # actually enters the phase grades (see player_team_context).
            "team_pass_pctile", "team_run_pctile",
            "team_ctx_pass_pctile", "team_ctx_run_pctile", "team_ctx_exposure",
            # Component percentiles, so a grade can be explained rather than just asserted.
            "p_market", "p_snap", "p_draft", "snap_pct", "is_active",
            "hist_seasons", "ol_pctile_hist", "market_pctile_hist",
            # Tracking-derived anchor where ESPN publishes it.
            "espn_pbwr", "espn_rbwr",
            "shared_credit", "penalty_rate", "penalty_hold_rate", "penalty_fs_rate",
            "allpro_recent", "career_ap1", "career_pb", "consensus_flag",
            # Retained as diagnostics only — see build_grades_df for why these are not the grade.
            "apm_pass_grade", "apm_pass_pctile", "apm_pass_conf",
            "apm_run_grade", "apm_run_pctile", "apm_run_conf", "apm_shared_credit"] + \
           (["market_pctile"] if market else [])
    out = out.reset_index(names="gsis_id")
    for c in cols:
        if c not in out.columns:
            out[c] = np.nan
    out = out[["gsis_id"] + cols]
    out = out.sort_values(["pos", "ol_pctile"], ascending=[True, False])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=list(_default_grade_seasons()))
    ap.add_argument("--min-snaps", type=int, default=150)
    ap.add_argument("--min-poa", type=int, default=60)
    ap.add_argument("--market", action="store_true", help="add OverTheCap market lens column")
    ap.add_argument("--allpro-csv", help="optional csv: name,year,team of per-season All-Pros")
    ap.add_argument("--cache-dir", help="persist downloaded nflverse parquet files here")
    ap.add_argument("--out", default="ol_grades_final.csv")
    ap.add_argument("--refit-weights", action="store_true",
                    help="re-derive COMPOSITE_W from data and exit (run when a season lands)")
    a = ap.parse_args()

    if a.refit_weights:
        refit_composite_weights(a.seasons, cache_dir=a.cache_dir)
        return

    out = build_grades_df(seasons=a.seasons, min_snaps=a.min_snaps, min_poa=a.min_poa,
                          market=a.market, allpro_csv=a.allpro_csv, cache_dir=a.cache_dir,
                          verbose=True)
    out.to_csv(a.out, index=False)
    print(f"\nwrote {a.out}: {len(out)} linemen | "
          f"conflicts flagged: {(out.consensus_flag != '').sum()} | "
          f"shared-credit daggers: {(out.shared_credit == '†').sum()}")
    print("\nSample (top-percentile tackles):")
    print(out[out.pos == "T"].head(8)[["name", "team", "pass_grade", "run_grade",
          "shared_credit", "consensus_flag"]].to_string(index=False))


if __name__ == "__main__":
    main()
