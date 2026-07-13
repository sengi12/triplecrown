#!/usr/bin/env python3
"""
ol_grades_pipeline.py — End-to-end offensive line grading from nflverse data.

One command reproduces the full validated stack:
  1. Pass-pro plus-minus (ridge logistic on charted pressure; opponent, QB,
     rusher-count, down controls; recency-weighted seasons).
  2. Run-block plus-minus (point-of-attack by depth-chart side; ball-carrier,
     opponent, box, down controls; QB sneaks excluded; recency-weighted).
  3. Strict within-position percentile letter grades (C = median at position).
  4. Shared-credit daggers (latest-season >=98% snap overlap with a linemate:
     grades are split credit, not individual measurements).
  5. Consensus conflict badges (career first-team All-Pro / Pro Bowl counts
     from nflverse draft data, plus a per-season All-Pro list — 2025 AP teams
     embedded; supply --allpro-csv name,year,team to extend).
  6. Latest-season penalty rate (the one validated stable individual trait).
  7. Optional --market lens: OverTheCap APY-as-cap-% percentile at position —
     the market's independent judgment, reported in its own column, never
     blended into the model grade.

Known, documented limits (see conversation validation history):
  * Grades are team-outcome attributions, not film grades. Players on stable
    elite units compress toward C; the conflict badge exists for this reason.
  * Single-season coefficients are noise; this pipeline only reports pooled
    multi-season grades.

Usage:
  python ol_grades_pipeline.py                       # default 2022-2025
  python ol_grades_pipeline.py --market --out final.csv

Data: downloads nflverse releases unless a local copy (pbp_{Y}.parquet etc.)
exists in the working directory. FTN charting data CC-BY-SA 4.0 — attribute
"FTN Data via nflverse". Not affiliated with the NFL.
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
AP_2025 = {  # AP All-Pro OL, 2025 season (1st/2nd team)
    "Garett Bolles": "1st", "Joe Thuney": "1st", "Creed Humphrey": "1st",
    "Quinn Meinerz": "1st", "Penei Sewell": "1st",
    "Trent Williams": "2nd", "Quenton Nelson": "2nd", "Aaron Brewer": "2nd",
    "Chris Lindstrom": "2nd", "Darnell Wright": "2nd"}


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
    return {s: 1.0 - 0.2 * (max(seasons) - s) for s in seasons}


def slot_maps(seasons):
    slot, grp = {}, {}
    for s in seasons:
        d = pq(f"depth_{s}.parquet", f"depth_charts/depth_charts_{s}.parquet")
        col = "pos_abb" if "pos_abb" in d.columns else "depth_position"
        d = d[d[col].isin(SLOTS)]
        for pid, sl in d.groupby("gsis_id")[col].agg(lambda x: x.mode().iat[0]).items():
            slot.setdefault(pid, sl)
            grp.setdefault(pid, GRP[sl])
    return slot, grp


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


def fit_run(seasons, min_poa, slot_map):
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
        df["slots"] = [{p: slot_map.get(p) for p in pl.split(";") if p in ids}
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


def percentile_grades(df, coef_col, sign, grp_map, prefix):
    df = df.copy()
    df["pos"] = df.index.map(grp_map)
    df[f"{prefix}_pctile"] = np.nan
    for p, g in df.groupby("pos"):
        ranked = (sign * g[coef_col]).rank(pct=True) * 100
        df.loc[g.index, f"{prefix}_pctile"] = ranked
    df[f"{prefix}_grade"] = df[f"{prefix}_pctile"].apply(
        lambda x: next(g for c, g in CURVE if x >= c) if pd.notna(x) else None)
    return df


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


def penalties(season):
    pbp = pq(f"pbp_{season}.parquet", f"pbp/play_by_play_{season}.parquet",
             ["penalty", "penalty_player_id"])
    part = pq(f"part_{season}.parquet", f"pbp_participation/pbp_participation_{season}.parquet",
              ["offense_players"]).dropna()
    snaps = part.offense_players.str.split(";").explode().value_counts()
    pc = pbp[pbp.penalty == 1].penalty_player_id.value_counts()
    return pd.Series({p: 100 * pc.get(p, 0) / n for p, n in snaps.items() if n >= 200})


def market_lens(out, grp_map):
    try:
        c = pq("contracts.parquet", "contracts/historical_contracts.parquet",
               ["player", "position", "apy_cap_pct", "year_signed", "is_active"])
    except Exception as e:
        print(f"market lens unavailable ({e}); skipping", file=sys.stderr)
        return out
    c = c[c.position.isin(["LT", "RT", "T", "G", "LG", "RG", "C"]) & c.apy_cap_pct.notna()]
    c = c.sort_values("year_signed").drop_duplicates("player", keep="last")
    c["grp"] = c.position.map({"LT": "T", "RT": "T", "T": "T",
                               "G": "G", "LG": "G", "RG": "G", "C": "C"})
    c["mkt_pctile"] = np.nan
    for p, g in c.groupby("grp"):
        c.loc[g.index, "mkt_pctile"] = 100 * g.apy_cap_pct.rank(pct=True)
    mk = c.set_index("player").mkt_pctile
    out["market_pctile"] = out.name.map(mk).round(0)
    return out


def build_grades_df(seasons=(2022, 2023, 2024, 2025), min_snaps=300, min_poa=100,
                    market=False, allpro_csv=None, cache_dir=None, verbose=False):
    """Compute the full OL grades table and return it as an ordered DataFrame.

    This is the reusable, in-process entry point (used by nflverse_stats.py). It performs
    no file writes of its own; the CLI wrapper (main) or callers persist the result. Pass
    a `cache_dir` to persist the downloaded nflverse parquet files between runs.
    """
    if cache_dir:
        set_cache_dir(cache_dir)
    seasons = sorted(int(s) for s in seasons)
    latest = max(seasons)

    def _log(msg):
        if verbose:
            print(msg)

    slot_map, grp_map = slot_maps(seasons)
    _log("fitting pass-pro model...")
    pas = fit_pass(seasons, min_snaps)
    _log("fitting run-block model...")
    run = fit_run(seasons, min_poa, slot_map)

    pas = percentile_grades(pas, "pass_coef", -1, grp_map, "pass")
    run = percentile_grades(run, "run_coef", +1, grp_map, "run")
    out = pas.drop(columns=["pos"]).join(run.drop(columns=["pos"]), how="outer")
    out["pos"] = out.index.map(grp_map)
    out["slot"] = out.index.map(slot_map)

    roster = pq(f"roster_{latest}.parquet", f"weekly_rosters/roster_weekly_{latest}.parquet",
                ["gsis_id", "full_name", "team"]).drop_duplicates("gsis_id").set_index("gsis_id")
    out["name"] = out.index.map(roster.full_name)
    out["team"] = out.index.map(roster.team)

    out["pass_conf"] = out.pass_snaps.apply(
        lambda n: "HIGH" if n >= 1500 else ("MED" if n >= 600 else "LOW") if pd.notna(n) else None)
    out["run_conf"] = out.poa_carries.apply(
        lambda n: "HIGH" if n >= 500 else ("MED" if n >= 250 else "LOW") if pd.notna(n) else None)
    flags = daggers(latest, set(out.index))
    out["shared_credit"] = out.index.map(flags).fillna("")
    out["penalty_rate"] = out.index.map(penalties(latest)).round(2)

    draft = pq("draft_picks.parquet", "draft_picks/draft_picks.parquet").dropna(
        subset=["gsis_id"]).drop_duplicates("gsis_id").set_index("gsis_id")
    out["career_ap1"] = out.index.map(draft.allpro).fillna(0).astype(int)
    out["career_pb"] = out.index.map(draft.probowls).fillna(0).astype(int)
    ap_season = dict(AP_2025)
    if allpro_csv:
        extra = pd.read_csv(allpro_csv)
        for _, r in extra.iterrows():
            ap_season[r["name"]] = str(r.get("year", ""))
    out["allpro_recent"] = out.name.map(lambda n: ap_season.get(n, ""))

    bad = {"C-", "D+", "D", "D-", "F"}
    def badge(r):
        acclaimed = r.allpro_recent != "" or r.career_ap1 >= 1
        conflicts = []
        if acclaimed and r.pass_grade in bad: conflicts.append("pass")
        if acclaimed and r.run_grade in bad: conflicts.append("run")
        return "CONFLICT(" + "+".join(conflicts) + ")" if conflicts else ""
    out["consensus_flag"] = out.apply(badge, axis=1)

    if market:
        out = market_lens(out, grp_map)

    cols = ["name", "team", "slot", "pos",
            "pass_grade", "pass_pctile", "pass_conf", "pass_snaps",
            "run_grade", "run_pctile", "run_conf", "poa_carries",
            "shared_credit", "penalty_rate",
            "allpro_recent", "career_ap1", "career_pb", "consensus_flag"] + \
           (["market_pctile"] if market else [])
    out = out.reset_index(names="gsis_id")[["gsis_id"] + cols]
    out = out.sort_values(["pos", "pass_pctile"], ascending=[True, False])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=[2022, 2023, 2024, 2025])
    ap.add_argument("--min-snaps", type=int, default=300)
    ap.add_argument("--min-poa", type=int, default=100)
    ap.add_argument("--market", action="store_true", help="add OverTheCap market lens column")
    ap.add_argument("--allpro-csv", help="optional csv: name,year,team of per-season All-Pros")
    ap.add_argument("--cache-dir", help="persist downloaded nflverse parquet files here")
    ap.add_argument("--out", default="ol_grades_final.csv")
    a = ap.parse_args()

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
