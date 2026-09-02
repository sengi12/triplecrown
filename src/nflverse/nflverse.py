#!/usr/bin/env python3
"""
nflverse_stats.py — PROTOTYPE (dependency-isolated)
───────────────────────────────────────────────────
Compute team advanced-metric tables from nflverse play-by-play (nflfastR) and compare them
to the Warren Sharp tables already baked into triplecrown_seed.json.

This is an experiment to see how much of the Sharp "Offensive/Defensive Metrics" tables we
could self-compute instead of scraping. It is NOT wired into build_seed.py — it's standalone.

Requires pandas (already needed for nflverse data). If pandas isn't installed, importing this
module degrades gracefully: HAVE_PANDAS is False and team_metrics() raises a clear message, so
the stdlib-only seed builder is never affected.

Usage:
    python nflverse_stats.py            # compute 2025 + compare to seed's Sharp 2025 tables
    python nflverse_stats.py 2024       # a different season
"""
import os, sys, json, hashlib
from urllib.error import HTTPError

try:
    import numpy as np
except Exception:
    np = None

try:
    import pandas as pd
    HAVE_PANDAS = True
except Exception:
    pd = None
    HAVE_PANDAS = False

CACHE_DIR = "cache"
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz"
PFR_PASS_URL = "https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_season_pass.csv"
PFR_RUSH_URL = "https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_season_rush.csv"
PFR_DEF_URL = "https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_season_def.csv"
PFR_PASS_WEEK_URL = "https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_week_pass_{season}.parquet"
PFR_RUSH_WEEK_URL = "https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_week_rush_{season}.parquet"
PFR_DEF_WEEK_URL = "https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_week_def_{season}.parquet"
# Weekly snap counts. PFR's advanced-defense table only creates a player-week row when a
# pass-rush or coverage event was CHARTED — measured across 2023, 49% of DL player-weeks that
# actually played have no row (Dexter Lawrence: played 16, charted 9). Snap counts are the
# ground truth for "did he play", so they decide which weeks appear on the card.
SNAP_COUNTS_URL = "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_{season}.parquet"
PLAYERS_PARQUET_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet"
NGS_PASS_URL = "https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_passing.csv.gz"
# Columns we actually need (usecols keeps the ~370-col file fast + small in memory).
PBP_COLS = [
    "game_id", "season", "season_type", "week", "posteam", "defteam", "play_type",
    "pass", "rush", "epa", "success", "yards_gained",
    "fixed_drive", "fixed_drive_result", "series_result", "down",
    "shotgun", "no_huddle", "air_yards", "vegas_wp",
]
_QB_ZONE_COLS = [
    "season_type", "posteam", "pass_attempt", "sack", "complete_pass", "yards_gained",
    "pass_touchdown", "interception", "air_yards", "pass_location", "two_point_attempt",
    "passer_player_id",
]
_RB_FAN_COLS = [
    "season_type", "posteam", "rush_attempt", "qb_scramble", "two_point_attempt",
    "run_location", "run_gap", "yards_gained", "success", "rusher_player_id",
    "rush_touchdown",
]
# nflverse team codes that differ from the seed's codes.
NFLVERSE_TO_SEED = {"LA": "LAR", "OAK": "LV", "SD": "LAC", "STL": "LAR"}
TEAMS = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
    "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
    "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]
PART_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp_participation/pbp_participation_{season}.csv"
NGS_RUSH_URL = "https://github.com/nflverse/nflverse-data/releases/download/nextgen_stats/ngs_rushing.csv.gz"
ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_{season}.csv"

_NAME_MAP = {}
_OL_GRADES_BY_TEAM = {}
_OL_GRADES_BY_PLAYER = {}
_PFR_TO_GSIS = None
_OL_GRADES_CACHE_CSV = None

# URLs that failed to download this run (e.g. FTN charting before 2022). Cached so we don't
# retry the same 404 dozens of times across refinement/receiver loops.
_FAILED_REMOTE = {}


def _is_http_not_found(err):
    return isinstance(err, HTTPError) and getattr(err, "code", None) == 404

def _nflverse_cache_dir():
    d = os.path.join(CACHE_DIR, "nflverse")
    os.makedirs(d, exist_ok=True)
    return d

def _nflverse_cache_subdir(*parts):
    d = os.path.join(_nflverse_cache_dir(), *parts)
    os.makedirs(d, exist_ok=True)
    return d

def _repo_root():
    return os.path.dirname(__file__)

def _legacy_ol_csv_path():
    return os.path.join(_repo_root(), "claude", "ol_grades_final.csv")

def _ol_grades_cache_csv_path(seasons):
    payload = {
        "seasons": [int(s) for s in sorted(int(x) for x in seasons)],
        "schema": "ol_grades_pipeline_cache_v1",
    }
    digest = hashlib.md5(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return os.path.join(_nflverse_cache_subdir("derived", "ol_grades"), f"{digest}.csv")

def _ol_grades_source_csv_path():
    global _OL_GRADES_CACHE_CSV
    if _OL_GRADES_CACHE_CSV and os.path.exists(_OL_GRADES_CACHE_CSV):
        return _OL_GRADES_CACHE_CSV
    legacy = _legacy_ol_csv_path()
    return legacy if os.path.exists(legacy) else None

def _ensure_ol_grades_cache(seasons, refresh=False):
    """Generate (or reuse) the derived OL grades CSV from ol_grades_pipeline.

    Runs the grading model in-process (not via subprocess) so real tracebacks surface and
    the downloaded nflverse parquet files persist in the shared cache dir for fast rebuilds.
    Returns the absolute path to the CSV when available, else None.
    """
    global _OL_GRADES_CACHE_CSV, _OL_GRADES_BY_TEAM, _OL_GRADES_BY_PLAYER

    out_csv = _ol_grades_cache_csv_path(seasons)
    if (not refresh) and os.path.exists(out_csv):
        _OL_GRADES_CACHE_CSV = out_csv
        return out_csv

    try:
        import src.nflverse.ol_grades_pipeline as _olp
    except Exception as e:
        print(f"    → OL grades pipeline: unavailable ({type(e).__name__}: {e})")
        legacy = _legacy_ol_csv_path()
        _OL_GRADES_CACHE_CSV = legacy if os.path.exists(legacy) else None
        if _OL_GRADES_CACHE_CSV is None:
            print("      ⚠ No OL grades source available (pipeline import failed + legacy CSV missing).")
        return _OL_GRADES_CACHE_CSV

    parquet_cache = _nflverse_cache_subdir("raw", "ol_parquet")
    seasons_i = sorted(int(s) for s in seasons)
    print("    → OL grades pipeline: building cache …", end="", flush=True)
    try:
        # market=True fills the card's Market Percentile tile, which otherwise always renders
        # "—". Worth having: OverTheCap APY correlates +0.47 with career accolades, making it
        # the strongest external quality signal available for free — far stronger than the
        # model's own coefficients. It stays a separate column, never blended into the grade.
        df = _olp.build_grades_df(seasons=seasons_i, cache_dir=parquet_cache, market=True)
        os.makedirs(os.path.dirname(out_csv), exist_ok=True)
        df.to_csv(out_csv, index=False)
        _OL_GRADES_CACHE_CSV = out_csv
        _OL_GRADES_BY_TEAM = {}
        _OL_GRADES_BY_PLAYER = {}
        print(f" ok ({len(df)} linemen → {os.path.basename(out_csv)})")
        return out_csv
    except Exception as e:
        print(" failed")
        import traceback
        traceback.print_exc()
        print(f"      ⚠ OL grades pipeline failed: {type(e).__name__}: {e}")

    # Fallback for users who still keep a static CSV at the historical path.
    legacy = _legacy_ol_csv_path()
    _OL_GRADES_CACHE_CSV = legacy if os.path.exists(legacy) else None
    if _OL_GRADES_CACHE_CSV is None:
        print("      ⚠ No OL grades source available (pipeline output + legacy CSV missing).")
    return _OL_GRADES_CACHE_CSV

def _md5_cache_path(url):
    """Stable local cache path for a remote nflverse asset, keyed by URL md5.

    We treat anything already in the cache as current; the md5 is only used to
    derive a collision-resistant filename from the URL.
    """
    digest = hashlib.md5(url.encode("utf-8")).hexdigest()
    base = os.path.basename(url.split("?", 1)[0]) or "asset.csv"
    return os.path.join(_nflverse_cache_subdir("raw", "aux"), f"{digest}_{base}")

def _legacy_md5_cache_path(url):
    digest = hashlib.md5(url.encode("utf-8")).hexdigest()
    base = os.path.basename(url.split("?", 1)[0]) or "asset.csv"
    return os.path.join(_nflverse_cache_dir(), f"{digest}_{base}")

def _cache_remote(url, label=None):
    """Download a remote nflverse asset once, then always reuse the cached file."""
    path = _md5_cache_path(url)
    legacy = _legacy_md5_cache_path(url)
    if os.path.exists(legacy) and not os.path.exists(path):
        os.replace(legacy, path)
    if not os.path.exists(path):
        if url in _FAILED_REMOTE:
            # Already failed this run (e.g. FTN before 2022) — don't hammer the 404 repeatedly.
            raise _FAILED_REMOTE[url]
        import urllib.request
        tag = label or os.path.basename(url)
        print(f"  → downloading {tag} …", end="", flush=True)
        try:
            urllib.request.urlretrieve(url, path)
        except Exception as e:
            print(" unavailable")
            _FAILED_REMOTE[url] = e
            raise
        print(" ok")
    return path

def _pickle_cache_path(kind, payload):
    """Stable pickle path for a parsed DataFrame cache.

    `payload` should fully describe the parsed shape (source + columns/options), so
    a pickle can be safely reused across runs without re-reading the CSV.
    """
    digest = hashlib.md5(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return os.path.join(_nflverse_cache_subdir("parsed", kind), f"{digest}.pkl")

def _legacy_pickle_cache_path(kind, payload):
    digest = hashlib.md5(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return os.path.join(_nflverse_cache_dir(), f"{kind}_{digest}.pkl")

def _name_map(season):
    """gsis player id → normalized full name (pbp only carries abbreviated names like 'A.Rodgers')."""
    if season not in _NAME_MAP:
        r = _aux_csv(ROSTER_URL.format(season=season), usecols=["gsis_id", "full_name"])
        _NAME_MAP[season] = {gid: _norm(nm) for gid, nm in zip(r["gsis_id"], r["full_name"]) if isinstance(gid, str)}
    return _NAME_MAP[season]

import re as _re
def _norm(name):
    """Normalize a player name to the seed's key convention (matches build_seed._norm_name)."""
    s = (name or "").lower()
    s = _re.sub(r"[.'\-]", "", s)
    s = _re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", s)
    return _re.sub(r"\s+", " ", s).strip()

def _passer_rating_df(df):
    """Official NFL passer rating for a set of attempts (or None for empty input)."""
    att = len(df)
    if att == 0:
        return None
    a = max(0.0, min(2.375, (df["complete_pass"].sum() / att - 0.3) * 5))
    b = max(0.0, min(2.375, (df["yards_gained"].sum() / att - 3) * 0.25))
    c = min(2.375, df["pass_touchdown"].sum() / att * 20)
    d = max(0.0, 2.375 - df["interception"].sum() / att * 25)
    return round((a + b + c + d) / 6 * 100, 1)

def _cache_pbp(season):
    """Download the season's pbp csv.gz once to the local cache; return the path."""
    d = _nflverse_cache_subdir("raw", "pbp")
    path = os.path.join(d, f"pbp_{season}.csv.gz")
    legacy = os.path.join(_nflverse_cache_dir(), f"pbp_{season}.csv.gz")
    if os.path.exists(legacy) and not os.path.exists(path):
        os.replace(legacy, path)
    if not os.path.exists(path):
        import urllib.request
        url = PBP_URL.format(season=season)
        print(f"  → downloading pbp {season} …", end="", flush=True)
        urllib.request.urlretrieve(url, path)
        print(" ok")
    return path

def _load_pbp(season, cols=None):
    # Under a week cap the frame must carry `week` so the cap can be applied, whatever
    # column subset the caller asked for.
    if MAX_WEEK is not None and cols and "week" not in cols:
        cols = list(cols) + ["week"]
    key = (season, tuple(cols) if cols else None)
    if key not in _PBP_DF_CACHE:
        csv_path = _cache_pbp(season)
        usecols = list(cols) if cols else list(PBP_COLS)
        payload = {"season": season, "cols": usecols}
        pkl_path = _pickle_cache_path("pbp", payload)
        legacy_pkl = _legacy_pickle_cache_path("pbp", payload)
        if os.path.exists(legacy_pkl) and not os.path.exists(pkl_path):
            os.replace(legacy_pkl, pkl_path)
        # A pickle older than its raw csv is stale (the in-season refresher deletes and
        # re-downloads the current season's pbp weekly) — re-parse rather than mask it.
        if os.path.exists(pkl_path) and os.path.getmtime(pkl_path) < os.path.getmtime(csv_path):
            try:
                os.remove(pkl_path)
            except OSError:
                pass
        if os.path.exists(pkl_path):
            _PBP_DF_CACHE[key] = pd.read_pickle(pkl_path)
        else:
            df = pd.read_csv(csv_path, compression="gzip", usecols=usecols, low_memory=False)
            df.to_pickle(pkl_path)
            _PBP_DF_CACHE[key] = df
    df = _PBP_DF_CACHE[key]
    # Time machine (build_seed.py --as-of): every pbp-derived block sees only the weeks that
    # were complete as of that week. The cache keeps the full season; the cap is applied on
    # the way out so it can never leak into a later, uncapped build.
    if MAX_WEEK is not None and "week" in df.columns:
        wk = pd.to_numeric(df["week"], errors="coerce")
        df = df[wk.notna() & (wk <= int(MAX_WEEK))]
    return df

MAX_WEEK = None   # set by the in-season builder for a time-machine build; None = all weeks
_PBP_DF_CACHE = {}
_AUX_CACHE = {}
_AUX_PARQUET_CACHE = {}
def _aux_csv(url, **kw):
    """Memoized pd.read_csv for season-level auxiliary tables (NGS/PFR/participation/FTN).

    Assets are cached on disk by URL md5, then memoized in-memory by read options,
    so repeated builds neither re-download nor re-parse the same files unnecessarily.
    """
    key = (url, tuple(kw.get("usecols") or ()), kw.get("compression"))
    if key not in _AUX_CACHE:
        csv_path = _cache_remote(url)
        payload = {
            "url": url,
            "usecols": list(kw.get("usecols") or []),
            "compression": kw.get("compression"),
        }
        pkl_path = _pickle_cache_path("aux", payload)
        legacy_pkl = _legacy_pickle_cache_path("aux", payload)
        if os.path.exists(legacy_pkl) and not os.path.exists(pkl_path):
            os.replace(legacy_pkl, pkl_path)
        # Same rule as _load_pbp: a pickle older than its csv is stale. The in-season refresher
        # re-downloads the roster/games csvs weekly; without this the parsed positions/names
        # stayed frozen at the first fetch and late-season call-ups had no position at all.
        if os.path.exists(pkl_path) and os.path.exists(csv_path) \
                and os.path.getmtime(pkl_path) < os.path.getmtime(csv_path):
            try:
                os.remove(pkl_path)
            except OSError:
                pass
        if os.path.exists(pkl_path):
            _AUX_CACHE[key] = pd.read_pickle(pkl_path)
        else:
            # low_memory=False loads the whole file before inferring dtypes, avoiding the C
            # parser's chunked mixed-dtype path (which can crash on FTN's sparse boolean columns).
            kw.setdefault("low_memory", False)
            df = pd.read_csv(csv_path, **kw)
            df.to_pickle(pkl_path)
            _AUX_CACHE[key] = df
    return _AUX_CACHE[key]

def _aux_parquet(url, columns=None):
    """Memoized pd.read_parquet for remote parquet assets (PFR weekly, players map)."""
    key = (url, tuple(columns or ()))
    if key not in _AUX_PARQUET_CACHE:
        path = _cache_remote(url)
        _AUX_PARQUET_CACHE[key] = pd.read_parquet(path, columns=columns)
    return _AUX_PARQUET_CACHE[key]

# Map a drive's final result to points scored by the offense on that drive (approximation:
# TD ≈ 6.97 expected points with the PAT, FG = 3). Everything else (punt/downs/INT/fumble) = 0.
def _drive_points(result):
    r = str(result)
    if r == "Touchdown":
        return 6.97
    if r == "Field goal":
        return 3.0
    return 0.0

def _drive_result_flags(result):
    r = str(result)
    return {
        "td": r == "Touchdown",
        "fg": r == "Field goal",
        "punt": r == "Punt",
        "turnover": r == "Turnover",
        "downs": r == "Turnover on downs",
        "safety": r == "Safety",
        "eoh": r == "End of half",
    }

def _side_table(plays, team_col, last5_weeks, defense=False):
    """Aggregate the 6 Sharp-shaped metrics for one side of the ball (posteam or defteam).

    NOTE: we intentionally use ALL regular-season pass/run plays (no garbage-time / win-probability
    filter). Empirically that matches Sharp's published EPA/Play closest (adding a wp band raised the
    mean error from ~0.015 to ~0.025); the small residual is Sharp's 2-dp rounding + their own EPA model.

    For DEFENSE, Sharp stores EPA/Play as "EPA prevented" (higher = better defense), so we negate the
    raw EPA-allowed. The other defensive columns stay as raw "allowed" values (lower = better).
    """
    plays = plays.copy()
    plays["explosive"] = plays["yards_gained"] >= 20
    g = plays.groupby(team_col)
    epa = g["epa"].mean()
    if defense:
        epa = -epa
    ypl = g["yards_gained"].mean()
    # Yards/play over the last 5 weeks of the season (Sharp's "Y/PL Last 5")
    l5 = plays[plays["week"].isin(last5_weeks)].groupby(team_col)["yards_gained"].mean()
    # Explosive = any play of 20+ yards (matches Sharp's ~7% scale better than 20-pass/10-rush)
    expl = g["explosive"].mean() * 100
    # Points per drive from drive results
    dr = plays.dropna(subset=["fixed_drive"]).copy()
    dr["dpts"] = dr["fixed_drive_result"].map(_drive_points)
    per_drive = dr.groupby([team_col, "game_id", "fixed_drive"])["dpts"].first().reset_index()
    ppd = per_drive.groupby(team_col)["dpts"].mean()
    # "Down/series conversion": share of series that end in a first down or TD
    sc = plays.dropna(subset=["series_result"]).copy()
    sc["conv"] = sc["series_result"].isin(["First down", "Touchdown"])
    # one row per series would need series ids; approximate at play level (close enough for ranks)
    dconv = sc.groupby(team_col)["conv"].mean() * 100
    out = pd.DataFrame({
        "EPA/Play": epa.round(3),
        "Yards Per Play": ypl.round(2),
        "Y/PL Last 5": l5.round(2),
        "Points Per Drive": ppd.round(2),
        "Explosive Play Rate": expl.round(1),
        "Down Conversion Rate": dconv.round(1),
    })
    return out

def team_metrics(season):
    """Return (offense_df, defense_df) of the 6 Sharp-shaped columns, indexed by team code."""
    if not HAVE_PANDAS:
        raise RuntimeError("pandas is required for nflverse_stats; install it or skip this module.")
    pbp = _load_pbp(season)
    # Regular season only, to match Sharp's tables (pbp includes postseason).
    if "season_type" in pbp.columns:
        pbp = pbp[pbp["season_type"] == "REG"]
    plays = pbp[(pbp["play_type"].isin(["pass", "run"])) & pbp["posteam"].notna()].copy()
    # Normalize team codes to the seed's convention (LA→LAR, etc.).
    plays["posteam"] = plays["posteam"].replace(NFLVERSE_TO_SEED)
    plays["defteam"] = plays["defteam"].replace(NFLVERSE_TO_SEED)
    weeks = sorted(plays["week"].dropna().unique())
    last5 = weeks[-5:]
    off = _side_table(plays, "posteam", last5)
    dfn = _side_table(plays, "defteam", last5, defense=True)
    return off, dfn

# ── O-Line / Tendencies / Pace (pbp + PFR + NGS) ─────────────────────────────
def _pfr_pass_team(season):
    """Team-level pressure rate allowed (from PFR advanced passing)."""
    df = _aux_csv(PFR_PASS_URL)
    df = df[(df["season"] == season) & (df["team"] != "2TM")].copy()
    df["team"] = df["team"].replace(NFLVERSE_TO_SEED)
    g = df.groupby("team")
    att = g["pass_attempts"].sum()
    pressure = g["times_pressured"].sum() / att * 100
    return pd.DataFrame({"Pressure Rate Allowed": pressure.round(1)})

def _pfr_rush_team(season):
    """Team-level rushing context (from PFR advanced rushing)."""
    df = _aux_csv(PFR_RUSH_URL)
    tmcol = "tm" if "tm" in df.columns else "team"
    df = df[(df["season"] == season) & (df[tmcol] != "2TM")].copy()
    df[tmcol] = df[tmcol].replace(NFLVERSE_TO_SEED)
    # Only RBs (Sharp's metric is "per RB rush").
    if "pos" in df.columns:
        df = df[df["pos"] == "RB"]

    # nflverse occasionally ships mixed/object dtypes in rushing fields (for example
    # `loaded` can arrive as non-numeric text). Coerce here so bad values become NaN
    # instead of crashing seed builds with TypeError during arithmetic.
    for c in ["att", "ybc", "yac", "yds", "brk_tkl", "loaded", "x1d"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    g = df.groupby(tmcol)
    nan = float("nan")
    att = g["att"].sum().replace(0, nan)
    ybc = g["ybc"].sum(min_count=1) / att
    yac = g["yac"].sum(min_count=1) / att
    ypc = g["yds"].sum(min_count=1) / att
    brk = g["brk_tkl"].sum(min_count=1) / att * 100
    loaded = g["loaded"].sum(min_count=1) / att * 100
    first = g["x1d"].sum(min_count=1) / att * 100
    return pd.DataFrame({
        "YBC/Rush": ybc.round(2),
        "YAC/Rush": yac.round(2),
        "Yards/Rush": ypc.round(2),
        "Broken Tackle Rate": brk.round(1),
        "Loaded Box Rate": loaded.round(1),
        "Rush 1D Rate": first.round(1),
    })


def _ngs_rush_team(season):
    """Team-level rushing context from NGS season totals (week==0)."""
    df = _aux_csv(NGS_RUSH_URL, compression="gzip")
    df = df[(df["season"] == season) & (df["season_type"] == "REG") & (df["week"] == 0)].copy()
    if df.empty:
        return pd.DataFrame()
    df["team_abbr"] = df["team_abbr"].replace(NFLVERSE_TO_SEED)
    att = df["rush_attempts"].replace(0, np.nan)
    df["w_roe"] = df["rush_yards_over_expected_per_att"] * att
    df["w_box"] = df["percent_attempts_gte_eight_defenders"] * att
    df["w_tlos"] = df["avg_time_to_los"] * att
    g = df.groupby("team_abbr")
    den = g["rush_attempts"].sum().replace(0, np.nan)
    return pd.DataFrame({
        "ROE/Att": (g["w_roe"].sum() / den).round(2),
        "8+ Box Rate": (g["w_box"].sum() / den).round(1),
        "Time to LOS": (g["w_tlos"].sum() / den).round(2),
    })

def _ngs_pass_team(season):
    """Team-level average time to throw (from Next Gen Stats, season totals week==0)."""
    df = _aux_csv(NGS_PASS_URL, compression="gzip")
    df = df[(df["season"] == season) & (df["season_type"] == "REG") & (df["week"] == 0)].copy()
    df["team_abbr"] = df["team_abbr"].replace(NFLVERSE_TO_SEED)
    # Weight each QB's time-to-throw by pass attempts, aggregate to team.
    df["w"] = df["avg_time_to_throw"] * df["attempts"]
    g = df.groupby("team_abbr")
    ttt = g["w"].sum() / g["attempts"].sum()
    return pd.DataFrame({"Time to Throw": ttt.round(2)})


def _pct_rank(series, lower_better=False):
    """0-100 percentile-like score where higher is always better."""
    s = pd.to_numeric(series, errors="coerce")
    if s.dropna().empty:
        return pd.Series(index=s.index, dtype="float64")
    base = s.rank(pct=True) * 100
    return (100 - base) if lower_better else base


def _ol_pass_metrics(season):
    """Team pass-protection metrics from nflverse PFR + pbp + participation + FTN.

    Produces the requested OL ranking columns:
      - dropbacks volume
      - pressure/hit/hurry/blitz rates allowed
      - pocket time allowed
      - total sack + non-QB-fault sack rates allowed
      - no-blitz pressure rate
      - last-5 sack rate
      - pass-utilization and utilization-weighted OL score
    """
    if not HAVE_PANDAS:
        raise RuntimeError("pandas is required for nflverse_stats.")

    # Base play-level denominators (dropbacks/rushes/sacks, plus last-5 sack trend).
    pbp = _load_pbp(season, [
        "game_id", "play_id", "season_type", "week", "posteam", "play_type",
        "qb_dropback", "sack", "rush_attempt", "qb_scramble", "qb_kneel"
    ])
    pbp = pbp[pbp["season_type"] == "REG"].copy()
    pbp["posteam"] = pbp["posteam"].replace(NFLVERSE_TO_SEED)
    pbp = pbp[pbp["posteam"].notna()]

    db = pbp[pbp["qb_dropback"] == 1].copy()
    db_ct = db.groupby("posteam").size().rename("Dropbacks")
    sack_ct = db.groupby("posteam")["sack"].sum().rename("_sacks")

    run = pbp[(pbp["rush_attempt"] == 1) & (pbp["qb_scramble"] == 0) & (pbp["qb_kneel"] == 0)]
    run_ct = run.groupby("posteam").size().rename("_designed_rushes")

    wk = db[["posteam", "week"]].dropna().drop_duplicates()
    wk["rk"] = wk.groupby("posteam")["week"].rank("dense", ascending=False)
    l5_keys = set(map(tuple, wk[wk["rk"] <= 5][["posteam", "week"]].values))
    db_l5 = db[["posteam", "week", "sack"]].copy()
    db_l5["is_l5"] = [(t, w) in l5_keys for t, w in zip(db_l5["posteam"], db_l5["week"])]
    l5_sack = db_l5[db_l5["is_l5"]].groupby("posteam")["sack"].sum().rename("Last 5 Sacks Allowed")
    l5_db = db_l5[db_l5["is_l5"]].groupby("posteam").size().rename("_last5_dropbacks")

    out = pd.DataFrame(index=sorted(set(db_ct.index) | set(run_ct.index)))
    out = out.join(db_ct, how="left").join(run_ct, how="left").join(sack_ct, how="left")
    out = out.join(l5_sack, how="left").join(l5_db, how="left")
    out["Dropbacks"] = out["Dropbacks"].fillna(0)
    out["_designed_rushes"] = out["_designed_rushes"].fillna(0)
    out["_sacks"] = out["_sacks"].fillna(0)
    out["Last 5 Sacks Allowed"] = out["Last 5 Sacks Allowed"].fillna(0)
    out["_last5_dropbacks"] = out["_last5_dropbacks"].fillna(0)

    util_den = (out["Dropbacks"] + out["_designed_rushes"]).replace(0, np.nan)
    out["Pass Rate"] = (out["Dropbacks"] / util_den * 100).fillna(0)
    out["Sack Rate"] = (out["_sacks"] / out["Dropbacks"].replace(0, np.nan) * 100).fillna(0)
    out["Last 5 Sack Rate"] = (
        out["Last 5 Sacks Allowed"] / out["_last5_dropbacks"].replace(0, np.nan) * 100
    ).fillna(0)

    # PFR pass charting: rates per team using dropbacks as denominator for consistency.
    try:
        pfr = _aux_csv(PFR_PASS_URL)
        pfr = pfr[(pfr["season"] == season) & (pfr["team"] != "2TM")].copy()
        pfr["team"] = pfr["team"].replace(NFLVERSE_TO_SEED)
        g = pfr.groupby("team")
        pr = g[["times_pressured", "times_hit", "times_hurried", "times_blitzed", "pass_attempts"]].sum()
        pr["Pocket Time Allowed"] = (
            (pfr["pocket_time"] * pfr["pass_attempts"]).groupby(pfr["team"]).sum()
            / g["pass_attempts"].sum().replace(0, np.nan)
        )
        pr = pr.join(out[["Dropbacks"]], how="left")
        den = pr["Dropbacks"].replace(0, np.nan)
        out["Pressure Rate"] = (pr["times_pressured"] / den * 100).reindex(out.index)
        out["Hit Rate"] = (pr["times_hit"] / den * 100).reindex(out.index)
        out["Hurry Rate"] = (pr["times_hurried"] / den * 100).reindex(out.index)
        out["Blitz Rate"] = (pr["times_blitzed"] / den * 100).reindex(out.index)
        out["Pocket Time"] = pr["Pocket Time Allowed"].reindex(out.index)
    except Exception as e:
        print(f"  (skipped _ol_pass_metrics PFR pass block: {type(e).__name__})")

    # FTN+participation enriches non-QB-fault sacks and no-blitz pressure.
    try:
        ftn = _aux_csv(
            FTN_URL.format(season=season),
            usecols=["nflverse_game_id", "nflverse_play_id", "n_blitzers", "is_qb_fault_sack"],
        )
        part = _aux_csv(
            PART_URL.format(season=season),
            usecols=["nflverse_game_id", "play_id", "was_pressure"],
        )
        d = db[["game_id", "play_id", "posteam", "sack"]].copy()
        d = d.merge(
            ftn,
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "nflverse_play_id"],
            how="left",
        ).merge(
            part,
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "play_id"],
            how="left",
            suffixes=("", "_part"),
        )

        sack_rows = d[d["sack"] == 1]
        qb_fault = (sack_rows["is_qb_fault_sack"] == True).groupby(sack_rows["posteam"]).sum()  # noqa: E712
        non_qb_fault = (sack_rows.groupby("posteam").size() - qb_fault).clip(lower=0)
        out["Non-QB Sack Rate"] = (
            non_qb_fault.reindex(out.index).fillna(0) / out["Dropbacks"].replace(0, np.nan) * 100
        ).fillna(0)

        nbp = d[(d["n_blitzers"] == 0) & (d["was_pressure"] == True)].groupby("posteam").size()  # noqa: E712
        out["No Blitz Pressure Rate"] = (
            nbp.reindex(out.index).fillna(0) / out["Dropbacks"].replace(0, np.nan) * 100
        ).fillna(0)
    except Exception as e:
        # FTN/participation lags can legitimately 404 for newer seasons; skip quietly.
        if not _is_http_not_found(e):
            print(f"  (skipped _ol_pass_metrics FTN/participation block: {type(e).__name__})")

    # Composite pass-protection + utilization weighting (pass-heavy teams weight pass-pro more).
    low_cols = [
        "Pressure Rate", "Hit Rate", "Hurry Rate",
        "Sack Rate", "Non-QB Sack Rate", "No Blitz Pressure Rate",
    ]
    for c in low_cols:
        if c not in out.columns:
            out[c] = np.nan
    if "Pocket Time" not in out.columns:
        out["Pocket Time"] = np.nan

    pass_score = (
        _pct_rank(out["Pressure Rate"], lower_better=True) * 0.30
        + _pct_rank(out["Hit Rate"], lower_better=True) * 0.10
        + _pct_rank(out["Hurry Rate"], lower_better=True) * 0.10
        + _pct_rank(out["Sack Rate"], lower_better=True) * 0.20
        + _pct_rank(out["Non-QB Sack Rate"], lower_better=True) * 0.15
        + _pct_rank(out["No Blitz Pressure Rate"], lower_better=True) * 0.10
        + _pct_rank(out["Pocket Time"], lower_better=False) * 0.05
    )
    run_proxy = _pct_rank(out.get("Stuff Rate"), lower_better=True) if "Stuff Rate" in out.columns else 50
    util = out["Pass Rate"].fillna(50) / 100
    out["Pass Score"] = pass_score
    out["Overall Score"] = (util * pass_score + (1 - util) * run_proxy)

    # Final formatting and cleanup.
    cols = [
        "Dropbacks", "Pass Rate",
        "Pressure Rate", "Hit Rate", "Hurry Rate", "Blitz Rate",
        "Pocket Time", "Sack Rate", "Non-QB Sack Rate",
        "No Blitz Pressure Rate", "Last 5 Sacks Allowed", "Last 5 Sack Rate",
        "Pass Score", "Overall Score",
    ]
    for c in cols:
        if c not in out.columns:
            out[c] = np.nan
    out = out[cols]
    out["Dropbacks"] = pd.to_numeric(out["Dropbacks"], errors="coerce").fillna(0).round(0)
    out["Last 5 Sacks Allowed"] = pd.to_numeric(out["Last 5 Sacks Allowed"], errors="coerce").fillna(0).round(0)
    for c in out.columns:
        if c not in {"Dropbacks", "Last 5 Sacks Allowed"}:
            out[c] = pd.to_numeric(out[c], errors="coerce").round(2)
    return out


def _ol_snap_pct_by_player(season):
    """Team -> player name -> OL snap share (% on-field across pass/run snaps)."""
    try:
        pbp = _load_pbp(season, ["game_id", "play_id", "season_type", "posteam", "play_type"])
        pbp = pbp[(pbp["season_type"] == "REG") & pbp["play_type"].isin(["pass", "run"]) & pbp["posteam"].notna()].copy()
        if pbp.empty:
            return {}
        pbp["posteam"] = pbp["posteam"].replace(NFLVERSE_TO_SEED)
        part = _aux_csv(PART_URL.format(season=season), usecols=["nflverse_game_id", "play_id", "offense_players"])
        m = pbp.merge(part, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "play_id"], how="inner")
        m = m[m["offense_players"].notna()].copy()
        if m.empty:
            return {}

        roster = _aux_csv(ROSTER_URL.format(season=season), usecols=["gsis_id", "full_name", "position"]).drop_duplicates("gsis_id")
        roster = roster[roster["position"].isin(["T", "G", "C", "OT", "OG", "OL"])].copy()
        if roster.empty:
            return {}
        ol_ids = set(roster["gsis_id"].dropna().astype(str))
        name_by_id = {str(r["gsis_id"]): str(r["full_name"]).strip() for _, r in roster.iterrows() if pd.notna(r["gsis_id"]) and pd.notna(r["full_name"])}

        m["pid_list"] = m["offense_players"].astype(str).str.split(";")
        ex = m[["posteam", "pid_list"]].explode("pid_list")
        ex["pid_list"] = ex["pid_list"].astype(str)
        ex = ex[ex["pid_list"].isin(ol_ids)]
        if ex.empty:
            return {}

        counts = ex.groupby(["posteam", "pid_list"]).size()
        team_snaps = m.groupby("posteam").size().replace(0, np.nan)

        out = {}
        for (tm, pid), n in counts.items():
            nm = name_by_id.get(str(pid))
            if not nm:
                continue
            pct = float(n) / float(team_snaps.get(tm, np.nan)) * 100.0
            out.setdefault(str(tm), {})[nm] = round(pct, 2)
        return out
    except Exception:
        return {}

# FTN charting (2022+) unlocks a batch of team tendencies pbp can't supply: motion, play-action,
# RPO, screen, trick, drop rate (offense) and blitz rate (defense). Validated vs Warren Sharp on
# 2025 — motion ρ≈0.90, blitz(5+ rushers) ρ≈0.97, play-action ρ≈0.81. RPO/screen/trick/drop have
# no Sharp equivalent but are cheap, useful tendencies. Returns (offense_df, defense_df).
def _ftn_team(season):
    pbp = _load_pbp(season, ["game_id", "play_id", "season_type", "posteam", "defteam",
                             "play_type", "qb_dropback"])
    pbp = pbp[pbp["season_type"] == "REG"]
    try:
        ftn = _aux_csv(FTN_URL.format(season=season),
                       usecols=["nflverse_game_id", "nflverse_play_id", "is_motion", "is_play_action",
                                "is_rpo", "is_screen_pass", "is_trick_play", "is_drop",
                                "is_catchable_ball", "n_pass_rushers"])
    except Exception as e:
        if _is_http_not_found(e):
            return pd.DataFrame(), pd.DataFrame()
        raise
    m = pbp.merge(ftn, left_on=["game_id", "play_id"],
                  right_on=["nflverse_game_id", "nflverse_play_id"], how="left")
    plays = m[(m["play_type"].isin(["pass", "run"])) & m["posteam"].notna()].copy()
    plays["posteam"] = plays["posteam"].replace(NFLVERSE_TO_SEED)
    plays["defteam"] = plays["defteam"].replace(NFLVERSE_TO_SEED)
    db = plays[plays["qb_dropback"] == 1]
    # Offense tendencies (posteam)
    motion = plays.groupby("posteam")["is_motion"].mean() * 100
    pa = db.groupby("posteam")["is_play_action"].mean() * 100
    rpo = plays.groupby("posteam")["is_rpo"].mean() * 100
    screen = db.groupby("posteam")["is_screen_pass"].mean() * 100
    trick = plays.groupby("posteam")["is_trick_play"].mean() * 100
    catchable = db.groupby("posteam")["is_catchable_ball"].sum()
    drops = db.groupby("posteam")["is_drop"].sum()
    drop_rate = (drops / catchable * 100)
    off = pd.DataFrame({
        "Motion Rate": motion.round(1),
        "Play Action Rate": pa.round(1),
        "RPO Rate": rpo.round(1),
        "Screen Rate": screen.round(1),
        "Trick Play Rate": trick.round(1),
        "Drop Rate": drop_rate.round(1),
    })
    # Defense tendencies (defteam): blitz = 5+ pass rushers on a dropback
    blitz = db.groupby("defteam").apply(lambda d: (d["n_pass_rushers"] >= 5).mean() * 100)
    dfn = pd.DataFrame({"Blitz Rate": blitz.round(1)})
    return off, dfn


def ol_weekly_team(season):
    """Compact weekly OL raw metrics per team for client-side week-range recomputation.

    Returns a compact shape:
      {
        "weeks": [1..N],
        "pass_cols": [...],
        "run_cols": [...],
        "teams": {"ARI": {"pass": [[...],[...]], "run": [[...],[...]]}, ...}
      }
    """
    pbp_cols = [
        "game_id", "play_id", "season_type", "week", "posteam", "play_type",
        "qb_dropback", "rush_attempt", "qb_scramble", "qb_kneel", "sack", "yards_gained",
        "ydstogo", "first_down",
    ]
    pbp = _load_pbp(season, pbp_cols)
    pbp = pbp[(pbp["season_type"] == "REG") & pbp["play_type"].isin(["pass", "run"]) & pbp["posteam"].notna()].copy()
    if pbp.empty:
        return {}
    pbp["posteam"] = pbp["posteam"].replace(NFLVERSE_TO_SEED)
    pbp["week"] = pd.to_numeric(pbp["week"], errors="coerce")
    pbp = pbp[pbp["week"].notna()].copy()
    pbp["week"] = pbp["week"].astype(int)
    weeks = sorted(int(w) for w in pbp["week"].unique() if int(w) > 0)
    if not weeks:
        return {}

    db = pbp[pbp["qb_dropback"] == 1].copy()
    run = pbp[(pbp["rush_attempt"] == 1) & (pbp["qb_scramble"] == 0) & (pbp["qb_kneel"] == 0)].copy()

    teams = sorted(set(pbp["posteam"].dropna().astype(str).tolist()))
    idx = pd.MultiIndex.from_product([teams, weeks], names=["team", "week"])
    out = pd.DataFrame(index=idx)

    out["dropbacks"] = db.groupby(["posteam", "week"]).size().reindex(idx)
    out["designed_rushes"] = run.groupby(["posteam", "week"]).size().reindex(idx)
    out["sacks"] = db.groupby(["posteam", "week"])["sack"].sum(min_count=1).reindex(idx)

    out["stuffed"] = run.groupby(["posteam", "week"]).apply(lambda d: (d["yards_gained"] <= 0).sum()).reindex(idx)
    out["explosive"] = run.groupby(["posteam", "week"]).apply(lambda d: (d["yards_gained"] >= 10).sum()).reindex(idx)
    out["rush_yards"] = run.groupby(["posteam", "week"])["yards_gained"].sum(min_count=1).reindex(idx)

    if "first_down" in run.columns:
        out["rush_first_downs"] = run.groupby(["posteam", "week"])["first_down"].sum(min_count=1).reindex(idx)
    else:
        out["rush_first_downs"] = run.groupby(["posteam", "week"]).apply(
            lambda d: (pd.to_numeric(d["yards_gained"], errors="coerce") >= pd.to_numeric(d["ydstogo"], errors="coerce")).sum()
        ).reindex(idx)

    try:
        pw = _aux_parquet(PFR_PASS_WEEK_URL.format(season=season))
        pw = pw[pw["game_type"] == "REG"].copy()
        pw["team"] = pw["team"].replace(NFLVERSE_TO_SEED)
        pw["week"] = pd.to_numeric(pw["week"], errors="coerce").astype("Int64")
        pw = pw[pw["week"].notna()].copy()
        g = pw.groupby(["team", "week"])
        out["times_pressured"] = g["times_pressured"].sum(min_count=1).reindex(idx)
        out["times_hit"] = g["times_hit"].sum(min_count=1).reindex(idx)
        out["times_hurried"] = g["times_hurried"].sum(min_count=1).reindex(idx)
        out["times_blitzed"] = g["times_blitzed"].sum(min_count=1).reindex(idx)
    except Exception:
        pass

    try:
        rw = _aux_parquet(PFR_RUSH_WEEK_URL.format(season=season))
        rw = rw[rw["game_type"] == "REG"].copy()
        rw["team"] = rw["team"].replace(NFLVERSE_TO_SEED)
        rw["week"] = pd.to_numeric(rw["week"], errors="coerce").astype("Int64")
        rw = rw[rw["week"].notna()].copy()
        g = rw.groupby(["team", "week"])
        out["ybc"] = g["rushing_yards_before_contact"].sum(min_count=1).reindex(idx)
        out["yac"] = g["rushing_yards_after_contact"].sum(min_count=1).reindex(idx)
        out["broken_tackles"] = g["rushing_broken_tackles"].sum(min_count=1).reindex(idx)
    except Exception:
        pass

    try:
        ngp = _aux_csv(
            NGS_PASS_URL,
            compression="gzip",
            usecols=["season", "season_type", "week", "team_abbr", "attempts", "avg_time_to_throw"],
        )
        ngp = ngp[(ngp["season"] == season) & (ngp["season_type"] == "REG") & (ngp["week"] > 0)].copy()
        ngp["team_abbr"] = ngp["team_abbr"].replace(NFLVERSE_TO_SEED)
        ngp["attempts"] = pd.to_numeric(ngp["attempts"], errors="coerce").fillna(0)
        ngp["avg_time_to_throw"] = pd.to_numeric(ngp["avg_time_to_throw"], errors="coerce")
        ngp = ngp[ngp["attempts"] > 0]
        if not ngp.empty:
            ngp["pt_w"] = ngp["avg_time_to_throw"] * ngp["attempts"]
            g = ngp.groupby(["team_abbr", "week"])
            out["pocket_time_w"] = g["pt_w"].sum(min_count=1).reindex(idx)
            out["pocket_time_att"] = g["attempts"].sum(min_count=1).reindex(idx)
    except Exception:
        pass

    try:
        ngr = _aux_csv(
            NGS_RUSH_URL,
            compression="gzip",
            usecols=[
                "season", "season_type", "week", "team_abbr", "rush_attempts",
                "rush_yards_over_expected_per_att", "percent_attempts_gte_eight_defenders", "avg_time_to_los",
            ],
        )
        ngr = ngr[(ngr["season"] == season) & (ngr["season_type"] == "REG") & (ngr["week"] > 0)].copy()
        ngr["team_abbr"] = ngr["team_abbr"].replace(NFLVERSE_TO_SEED)
        ngr["rush_attempts"] = pd.to_numeric(ngr["rush_attempts"], errors="coerce").fillna(0)
        ngr["rush_yards_over_expected_per_att"] = pd.to_numeric(ngr["rush_yards_over_expected_per_att"], errors="coerce")
        ngr["percent_attempts_gte_eight_defenders"] = pd.to_numeric(ngr["percent_attempts_gte_eight_defenders"], errors="coerce")
        ngr["avg_time_to_los"] = pd.to_numeric(ngr["avg_time_to_los"], errors="coerce")
        ngr = ngr[ngr["rush_attempts"] > 0]
        if not ngr.empty:
            ngr["roe_w"] = ngr["rush_yards_over_expected_per_att"] * ngr["rush_attempts"]
            ngr["box8_w"] = ngr["percent_attempts_gte_eight_defenders"] * ngr["rush_attempts"]
            ngr["tlos_w"] = ngr["avg_time_to_los"] * ngr["rush_attempts"]
            g = ngr.groupby(["team_abbr", "week"])
            out["ngs_att"] = g["rush_attempts"].sum(min_count=1).reindex(idx)
            out["roe_w"] = g["roe_w"].sum(min_count=1).reindex(idx)
            out["box8_w"] = g["box8_w"].sum(min_count=1).reindex(idx)
            out["tlos_w"] = g["tlos_w"].sum(min_count=1).reindex(idx)
    except Exception:
        pass

    try:
        ftn = _aux_csv(
            FTN_URL.format(season=season),
            usecols=["nflverse_game_id", "nflverse_play_id", "n_blitzers", "is_qb_fault_sack"],
        )
        part = _aux_csv(
            PART_URL.format(season=season),
            usecols=["nflverse_game_id", "play_id", "was_pressure"],
        )
        d = db[["game_id", "play_id", "week", "posteam", "sack"]].copy()
        d = d.merge(
            ftn,
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "nflverse_play_id"],
            how="left",
        ).merge(
            part,
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "play_id"],
            how="left",
            suffixes=("", "_part"),
        )
        sack_rows = d[d["sack"] == 1].copy()
        qb_fault = (sack_rows["is_qb_fault_sack"] == True).groupby([sack_rows["posteam"], sack_rows["week"]]).sum()  # noqa: E712
        sack_tot = sack_rows.groupby(["posteam", "week"]).size()
        non_qb = (sack_tot - qb_fault).clip(lower=0)
        out["non_qb_sacks"] = non_qb.reindex(idx)

        nbp = d[(d["n_blitzers"] == 0) & (d["was_pressure"] == True)].groupby(["posteam", "week"]).size()  # noqa: E712
        out["no_blitz_pressures"] = nbp.reindex(idx)
    except Exception:
        pass

    pass_cols = [
        "dropbacks", "designed_rushes", "sacks",
        "times_pressured", "times_hit", "times_hurried", "times_blitzed",
        "non_qb_sacks", "no_blitz_pressures", "pocket_time_w", "pocket_time_att",
    ]
    run_cols = [
        "designed_rushes", "stuffed", "explosive", "rush_yards", "ybc", "yac",
        "broken_tackles", "rush_first_downs", "ngs_att", "roe_w", "box8_w", "tlos_w",
    ]

    for c in pass_cols + run_cols:
        if c not in out.columns:
            out[c] = 0
        out[c] = pd.to_numeric(out[c], errors="coerce").fillna(0.0)

    packed = {"weeks": weeks, "pass_cols": pass_cols, "run_cols": run_cols, "teams": {}}
    for tm in teams:
        pass_rows = []
        run_rows = []
        for wk in weeks:
            row = out.loc[(tm, wk)]
            pass_rows.append([round(float(row[c]), 4) for c in pass_cols])
            run_rows.append([round(float(row[c]), 4) for c in run_cols])
        packed["teams"][tm] = {"pass": pass_rows, "run": run_rows}
    return packed


def adv_weekly_team(season):
    """Compact weekly team aggregates for advanced-card range recomputation.

    Stores additive numerators/denominators so the client can recompute accurate
    windowed values + league ranks for offense/defense/tendencies/pace cards.
    """
    pbp_cols = [
        "game_id", "play_id", "season_type", "week", "posteam", "defteam", "play_type",
        "qb_dropback", "rush_attempt", "qb_scramble", "qb_kneel", "qb_spike",
        "sack", "qb_hit", "complete_pass", "pass_touchdown", "interception", "fumble_lost",
        "passing_yards", "rushing_yards", "receiving_yards", "rush_touchdown", "pass_attempt", "yardline_100",
        "yards_gained", "epa", "fixed_drive", "fixed_drive_result", "series_result",
        "shotgun", "no_huddle", "air_yards", "wp", "half_seconds_remaining",
        "game_seconds_remaining",
    ]
    pbp = _load_pbp(season, pbp_cols)
    pbp = pbp[(pbp["season_type"] == "REG") & pbp["posteam"].notna()].copy()
    if pbp.empty:
        return {}
    pbp["posteam"] = pbp["posteam"].replace(NFLVERSE_TO_SEED)
    pbp["defteam"] = pbp["defteam"].replace(NFLVERSE_TO_SEED)
    pbp["week"] = pd.to_numeric(pbp["week"], errors="coerce")
    pbp = pbp[pbp["week"].notna()].copy()
    pbp["week"] = pbp["week"].astype(int)
    plays = pbp[pbp["play_type"].isin(["pass", "run"])].copy()
    if plays.empty:
        return {}
    weeks = sorted(int(w) for w in pbp["week"].unique() if int(w) > 0)
    if not weeks:
        return {}

    teams = sorted(set(pbp["posteam"].dropna().astype(str).tolist()) | set(pbp["defteam"].dropna().astype(str).tolist()))
    idx = pd.MultiIndex.from_product([teams, weeks], names=["team", "week"])
    out = pd.DataFrame(index=idx)

    # Offense / defense core (_side_table-compatible numerators/denominators).
    plays["explosive"] = pd.to_numeric(plays["yards_gained"], errors="coerce") >= 20
    plays["conv"] = plays["series_result"].isin(["First down", "Touchdown"])
    plays["conv_obs"] = plays["series_result"].notna()

    out["off_plays"] = plays.groupby(["posteam", "week"]).size().reindex(idx).fillna(0)
    out["off_yards"] = pd.to_numeric(plays["yards_gained"], errors="coerce").groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_epa"] = pd.to_numeric(plays["epa"], errors="coerce").groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_explosive"] = plays.groupby(["posteam", "week"])["explosive"].sum(min_count=1).reindex(idx).fillna(0)
    out["off_conv"] = plays.groupby(["posteam", "week"])["conv"].sum(min_count=1).reindex(idx).fillna(0)
    out["off_conv_obs"] = plays.groupby(["posteam", "week"])["conv_obs"].sum(min_count=1).reindex(idx).fillna(0)

    out["def_plays"] = plays.groupby(["defteam", "week"]).size().reindex(idx).fillna(0)
    out["def_yards"] = pd.to_numeric(plays["yards_gained"], errors="coerce").groupby([plays["defteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["def_epa_allowed"] = pd.to_numeric(plays["epa"], errors="coerce").groupby([plays["defteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["def_explosive_allowed"] = plays.groupby(["defteam", "week"])["explosive"].sum(min_count=1).reindex(idx).fillna(0)
    out["def_conv_allowed"] = plays.groupby(["defteam", "week"])["conv"].sum(min_count=1).reindex(idx).fillna(0)
    out["def_conv_obs"] = plays.groupby(["defteam", "week"])["conv_obs"].sum(min_count=1).reindex(idx).fillna(0)

    # Pass/run split EPA numerators + denominators for Power Score.
    is_pass = (plays["play_type"] == "pass")
    is_run = (plays["play_type"] == "run")
    epa_vals = pd.to_numeric(plays["epa"], errors="coerce").fillna(0)

    out["off_pass_plays"] = is_pass.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_pass_epa"] = epa_vals.where(is_pass, 0).groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_run_plays"] = is_run.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_run_epa"] = epa_vals.where(is_run, 0).groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)

    out["def_pass_plays"] = is_pass.groupby([plays["defteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["def_pass_epa_allowed"] = epa_vals.where(is_pass, 0).groupby([plays["defteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["def_run_plays"] = is_run.groupby([plays["defteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["def_run_epa_allowed"] = epa_vals.where(is_run, 0).groupby([plays["defteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)

    dr = pbp.dropna(subset=["fixed_drive"]).copy()
    dr["dpts"] = dr["fixed_drive_result"].map(_drive_points)
    d_off = dr.groupby(["posteam", "week", "game_id", "fixed_drive"])["dpts"].first().reset_index()
    d_def = dr.groupby(["defteam", "week", "game_id", "fixed_drive"])["dpts"].first().reset_index()
    out["off_drive_pts"] = d_off.groupby(["posteam", "week"])["dpts"].sum(min_count=1).reindex(idx).fillna(0)
    out["off_drive_ct"] = d_off.groupby(["posteam", "week"]).size().reindex(idx).fillna(0)
    out["def_drive_pts_allowed"] = d_def.groupby(["defteam", "week"])["dpts"].sum(min_count=1).reindex(idx).fillna(0)
    out["def_drive_ct"] = d_def.groupby(["defteam", "week"]).size().reindex(idx).fillna(0)

    drive_core = plays.dropna(subset=["fixed_drive"]).copy()
    drive_core["is_rz"] = pd.to_numeric(drive_core["yardline_100"], errors="coerce") <= 20
    drive_core["is_g10"] = pd.to_numeric(drive_core["yardline_100"], errors="coerce") <= 10
    drive_core["drive_conv"] = drive_core["series_result"].isin(["First down", "Touchdown"])
    drive_sum = drive_core.groupby(["posteam", "week", "game_id", "fixed_drive"]).agg(
        drive_play_ct=("play_id", "nunique"),
        drive_conv_ct=("drive_conv", "sum"),
        reached_rz=("is_rz", "max"),
        reached_g10=("is_g10", "max"),
        pass_td=("pass_touchdown", "sum"),
        rush_td=("rush_touchdown", "sum"),
    ).reset_index()

    drive_results = dr.groupby(["posteam", "week", "game_id", "fixed_drive"])["fixed_drive_result"].first().reset_index()
    for key in ["td", "fg", "punt", "turnover", "downs", "safety", "eoh"]:
        drive_results[key] = drive_results["fixed_drive_result"].map(lambda r: 1 if _drive_result_flags(r)[key] else 0)
    drive_results = drive_results.merge(
        drive_sum[["posteam", "week", "game_id", "fixed_drive", "drive_play_ct", "drive_conv_ct", "reached_rz", "reached_g10", "pass_td", "rush_td"]],
        on=["posteam", "week", "game_id", "fixed_drive"], how="left"
    )
    drive_results["three_out"] = ((drive_results["drive_play_ct"] >= 3) & (drive_results["drive_conv_ct"] <= 0)).astype(int)
    drive_results["rz_td"] = ((drive_results["reached_rz"] == True) & (drive_results["td"] == 1)).astype(int)
    drive_results["g10_td"] = ((drive_results["reached_g10"] == True) & (drive_results["td"] == 1)).astype(int)
    drive_results["kill_drive"] = ((drive_results["punt"] == 1) | (drive_results["turnover"] == 1) | (drive_results["downs"] == 1)).astype(int)

    for col, src in [
        ("off_drive_td_ct", "td"),
        ("off_drive_fg_ct", "fg"),
        ("off_drive_punt_ct", "punt"),
        ("off_drive_turnover_ct", "turnover"),
        ("off_drive_tod_ct", "downs"),
        ("off_drive_safety_ct", "safety"),
        ("off_drive_end_half_ct", "eoh"),
        ("off_drive_three_out_ct", "three_out"),
        ("off_drive_kill_ct", "kill_drive"),
        ("off_drive_rz_ct", "reached_rz"),
        ("off_drive_rz_td_ct", "rz_td"),
        ("off_drive_g10_ct", "reached_g10"),
        ("off_drive_g10_td_ct", "g10_td"),
        ("off_drive_pass_td_ct", "pass_td"),
        ("off_drive_rush_td_ct", "rush_td"),
    ]:
        out[col] = drive_results.groupby(["posteam", "week"])[src].sum(min_count=1).reindex(idx).fillna(0)

    # Team fantasy-ecosystem output: intentionally double counts passing + receiving production,
    # because the goal is total fantasy points created for the offense's fantasy-relevant players.
    pass_yd = pd.to_numeric(plays["passing_yards"], errors="coerce").fillna(0)
    rush_yd = pd.to_numeric(plays["rushing_yards"], errors="coerce").fillna(0)
    rec_yd = pd.to_numeric(plays["receiving_yards"], errors="coerce").fillna(0)
    pass_td = pd.to_numeric(plays["pass_touchdown"], errors="coerce").fillna(0)
    ints = pd.to_numeric(plays["interception"], errors="coerce").fillna(0)
    fumbles = pd.to_numeric(plays["fumble_lost"], errors="coerce").fillna(0)
    rush_td = pd.to_numeric(plays.get("rush_touchdown"), errors="coerce").fillna(0)
    rec = pd.to_numeric(plays["complete_pass"], errors="coerce").fillna(0)

    off_fp_std = (pass_yd/25.0) + (pass_td*10.0) - (ints*2.0) + (rush_yd/10.0) + (rush_td*6.0) + (rec_yd/10.0) - (fumbles*2.0)
    off_fp_half = off_fp_std + (rec*0.5)
    off_fp_ppr = off_fp_std + rec
    out["off_fp_std"] = off_fp_std.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_fp_half"] = off_fp_half.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_fp_ppr"] = off_fp_ppr.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    pass_att = pd.to_numeric(plays["pass_attempt"], errors="coerce").fillna(0)
    out["off_targets"] = pass_att.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_receptions"] = rec.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_pass_td"] = pass_td.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["off_rush_td"] = rush_td.groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)

    # Tendencies base.
    out["tend_plays"] = out["off_plays"]
    out["tend_shotgun"] = pd.to_numeric(plays["shotgun"], errors="coerce").fillna(0).groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["tend_nohuddle"] = pd.to_numeric(plays["no_huddle"], errors="coerce").fillna(0).groupby([plays["posteam"], plays["week"]]).sum(min_count=1).reindex(idx).fillna(0)

    db = plays[plays["qb_dropback"] == 1].copy()
    out["db"] = db.groupby(["posteam", "week"]).size().reindex(idx).fillna(0)
    air = pd.to_numeric(db["air_yards"], errors="coerce")
    out["air_sum"] = air.groupby([db["posteam"], db["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["air_att"] = air.notna().groupby([db["posteam"], db["week"]]).sum(min_count=1).reindex(idx).fillna(0)

    for c in ["tend_motion", "tend_play_action", "tend_rpo", "tend_screen", "tend_trick", "tend_drop", "tend_catchable"]:
        out[c] = 0.0
    try:
        ftn = _aux_csv(
            FTN_URL.format(season=season),
            usecols=[
                "nflverse_game_id", "nflverse_play_id", "is_motion", "is_play_action", "is_rpo",
                "is_screen_pass", "is_trick_play", "is_drop", "is_catchable_ball", "n_pass_rushers",
            ],
        )
        m = plays.merge(
            ftn,
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "nflverse_play_id"],
            how="left",
        )
        dbm = m[m["qb_dropback"] == 1].copy()
        out["tend_motion"] = (m["is_motion"] == True).groupby([m["posteam"], m["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
        out["tend_rpo"] = (m["is_rpo"] == True).groupby([m["posteam"], m["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
        out["tend_trick"] = (m["is_trick_play"] == True).groupby([m["posteam"], m["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
        out["tend_play_action"] = (dbm["is_play_action"] == True).groupby([dbm["posteam"], dbm["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
        out["tend_screen"] = (dbm["is_screen_pass"] == True).groupby([dbm["posteam"], dbm["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
        out["tend_drop"] = (dbm["is_drop"] == True).groupby([dbm["posteam"], dbm["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
        out["tend_catchable"] = (dbm["is_catchable_ball"] == True).groupby([dbm["posteam"], dbm["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
    except Exception:
        pass

    # Coverage/personnel and defensive tendencies/line proxies from participation + FTN.
    # Keep everything as additive weekly counts so client week windows recompute exact rates.
    for c in [
        "cov_obs", "cov_man", "cov_zone",
        "cov_shell_obs", "cov_mofc", "cov_mofo", "cov_c1", "cov_c2", "cov_c3",
        "off_pers_obs", "off_wr3", "off_mte", "off_11", "off_12", "off_13", "off_21", "off_multirb",
        "def_pers_obs", "def_sub", "def_nickel", "def_dime",
        "blitz_db_obs", "blitz_db5",
        "dl_dropbacks", "dl_pressures", "dl_no_blitz_obs", "dl_no_blitz_pressures",
        "dl_rush_att", "dl_rush_stuffed",
    ]:
        out[c] = 0.0
    try:
        part = _aux_csv(
            PART_URL.format(season=season),
            usecols=[
                "nflverse_game_id", "play_id", "defense_man_zone_type", "defense_coverage_type",
                "offense_personnel", "defense_personnel",
            ],
        )
        chart = plays.merge(
            ftn,
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "nflverse_play_id"],
            how="left",
        ).merge(
            part,
            left_on=["game_id", "play_id"],
            right_on=["nflverse_game_id", "play_id"],
            how="left",
            suffixes=("", "_part"),
        )

        dbm = chart[chart["qb_dropback"] == 1].copy()
        # Defensive tendencies (FTN): blitz = 5+ pass rushers on a dropback.
        out["blitz_db_obs"] = dbm["n_pass_rushers"].notna().groupby([dbm["defteam"], dbm["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["blitz_db5"] = (dbm["n_pass_rushers"] >= 5).groupby([dbm["defteam"], dbm["week"]]).sum(min_count=1).reindex(idx).fillna(0)

        # Coverage (participation): man/zone + MOFC/MOFO + Cover 1/2/3.
        mz = dbm.dropna(subset=["defense_man_zone_type"]).copy()
        out["cov_obs"] = mz.groupby(["defteam", "week"]).size().reindex(idx).fillna(0)
        out["cov_man"] = (mz["defense_man_zone_type"] == "MAN_COVERAGE").groupby([mz["defteam"], mz["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["cov_zone"] = (mz["defense_man_zone_type"] == "ZONE_COVERAGE").groupby([mz["defteam"], mz["week"]]).sum(min_count=1).reindex(idx).fillna(0)

        cc = dbm[dbm["defense_coverage_type"].notna() & (dbm["defense_coverage_type"] != "")].copy()
        MOFC = ["COVER_0", "COVER_1", "COVER_3"]
        MOFO = ["COVER_2", "COVER_4", "COVER_6", "2_MAN"]
        out["cov_shell_obs"] = cc.groupby(["defteam", "week"]).size().reindex(idx).fillna(0)
        out["cov_mofc"] = cc["defense_coverage_type"].isin(MOFC).groupby([cc["defteam"], cc["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["cov_mofo"] = cc["defense_coverage_type"].isin(MOFO).groupby([cc["defteam"], cc["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["cov_c1"] = (cc["defense_coverage_type"] == "COVER_1").groupby([cc["defteam"], cc["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["cov_c2"] = (cc["defense_coverage_type"] == "COVER_2").groupby([cc["defteam"], cc["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["cov_c3"] = (cc["defense_coverage_type"] == "COVER_3").groupby([cc["defteam"], cc["week"]]).sum(min_count=1).reindex(idx).fillna(0)

        # Offensive personnel groups from participation strings.
        op = chart.dropna(subset=["offense_personnel"]).copy()
        op = op[op["play_type"].isin(["pass", "run"])]
        op_cache = {s: _parse_personnel(s) for s in op["offense_personnel"].unique()}
        op["backs"] = op["offense_personnel"].map(lambda s: op_cache[s].get("RB", 0) + op_cache[s].get("FB", 0))
        op["te"] = op["offense_personnel"].map(lambda s: op_cache[s].get("TE", 0))
        op["wr"] = op["offense_personnel"].map(lambda s: op_cache[s].get("WR", 0))
        out["off_pers_obs"] = op.groupby(["posteam", "week"]).size().reindex(idx).fillna(0)
        out["off_wr3"] = (op["wr"] >= 3).groupby([op["posteam"], op["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["off_mte"] = (op["te"] >= 2).groupby([op["posteam"], op["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["off_11"] = ((op["backs"] == 1) & (op["te"] == 1)).groupby([op["posteam"], op["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["off_12"] = ((op["backs"] == 1) & (op["te"] == 2)).groupby([op["posteam"], op["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["off_13"] = ((op["backs"] == 1) & (op["te"] == 3)).groupby([op["posteam"], op["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["off_21"] = ((op["backs"] == 2) & (op["te"] == 1)).groupby([op["posteam"], op["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["off_multirb"] = (op["backs"] >= 2).groupby([op["posteam"], op["week"]]).sum(min_count=1).reindex(idx).fillna(0)

        # Defensive personnel groupings.
        dp = chart.dropna(subset=["defense_personnel"]).copy()
        dp = dp[dp["play_type"].isin(["pass", "run"])]
        dp_cache = {s: _parse_personnel(s) for s in dp["defense_personnel"].unique()}
        dp["dbs"] = dp["defense_personnel"].map(lambda s: sum(dp_cache[s].get(k, 0) for k in ("CB", "FS", "SS", "S", "DB")))
        out["def_pers_obs"] = dp.groupby(["defteam", "week"]).size().reindex(idx).fillna(0)
        out["def_sub"] = (dp["dbs"] >= 5).groupby([dp["defteam"], dp["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["def_nickel"] = (dp["dbs"] == 5).groupby([dp["defteam"], dp["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["def_dime"] = (dp["dbs"] >= 6).groupby([dp["defteam"], dp["week"]]).sum(min_count=1).reindex(idx).fillna(0)

        # Defensive-line weekly proxies.
        dbm["hit_or_sack"] = ((pd.to_numeric(dbm["qb_hit"], errors="coerce").fillna(0) > 0) |
                               (pd.to_numeric(dbm["sack"], errors="coerce").fillna(0) > 0))
        out["dl_dropbacks"] = dbm.groupby(["defteam", "week"]).size().reindex(idx).fillna(0)
        out["dl_pressures"] = dbm.groupby(["defteam", "week"])["hit_or_sack"].sum(min_count=1).reindex(idx).fillna(0)
        out["dl_no_blitz_obs"] = (dbm["n_pass_rushers"] == 0).groupby([dbm["defteam"], dbm["week"]]).sum(min_count=1).reindex(idx).fillna(0)
        out["dl_no_blitz_pressures"] = ((dbm["n_pass_rushers"] == 0) & (dbm["hit_or_sack"] == True)).groupby([dbm["defteam"], dbm["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
        rd = chart[(chart["rush_attempt"] == 1) & (chart["qb_scramble"] == 0) & (chart["qb_kneel"] == 0)].copy()
        out["dl_rush_att"] = rd.groupby(["defteam", "week"]).size().reindex(idx).fillna(0)
        out["dl_rush_stuffed"] = (pd.to_numeric(rd["yards_gained"], errors="coerce") <= 0).groupby([rd["defteam"], rd["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    except Exception:
        pass

    # Pace components.
    snaps = pbp[(((pbp["qb_dropback"] == 1) | ((pbp["rush_attempt"] == 1) & (pbp["qb_scramble"] == 0)))
                 & (pbp["qb_kneel"] == 0) & (pbp["qb_spike"] == 0) & pbp["posteam"].notna())].copy()
    snaps["posteam"] = snaps["posteam"].replace(NFLVERSE_TO_SEED)
    snaps["week"] = pd.to_numeric(snaps["week"], errors="coerce")
    snaps = snaps[snaps["week"].notna()].copy()
    snaps["week"] = snaps["week"].astype(int)
    snaps["neutral"] = snaps["wp"].between(0.20, 0.80) & (snaps["half_seconds_remaining"] > 120)
    out["pace_snaps"] = snaps.groupby(["posteam", "week"]).size().reindex(idx).fillna(0)
    out["pace_neutral_db"] = ((snaps["neutral"] == True) & (snaps["qb_dropback"] == 1)).groupby([snaps["posteam"], snaps["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712
    out["pace_neutral_snaps"] = (snaps["neutral"] == True).groupby([snaps["posteam"], snaps["week"]]).sum(min_count=1).reindex(idx).fillna(0)  # noqa: E712

    s = snaps.sort_values(["game_id", "posteam", "fixed_drive", "game_seconds_remaining"], ascending=[True, True, True, False]).copy()
    s["diff"] = s.groupby(["game_id", "posteam", "fixed_drive"])["game_seconds_remaining"].shift(1) - s["game_seconds_remaining"]
    s = s[s["diff"].between(1, 45)]
    out["pace_sec_sum"] = pd.to_numeric(s["diff"], errors="coerce").groupby([s["posteam"], s["week"]]).sum(min_count=1).reindex(idx).fillna(0)
    out["pace_sec_n"] = s.groupby(["posteam", "week"]).size().reindex(idx).fillna(0)
    out["pace_games"] = snaps.groupby(["posteam", "week"])["game_id"].nunique().reindex(idx).fillna(0)
    game_tot = snaps.groupby("game_id").size()
    tp = snaps[["game_id", "posteam", "week"]].drop_duplicates().copy()
    tp["gp"] = tp["game_id"].map(game_tot)
    out["pace_total_game_plays"] = tp.groupby(["posteam", "week"])["gp"].sum(min_count=1).reindex(idx).fillna(0)

    cols = [
        "off_plays", "off_yards", "off_epa", "off_pass_plays", "off_pass_epa", "off_run_plays", "off_run_epa", "off_explosive", "off_conv", "off_conv_obs", "off_drive_pts", "off_drive_ct",
        "off_drive_td_ct", "off_drive_fg_ct", "off_drive_punt_ct", "off_drive_turnover_ct", "off_drive_tod_ct", "off_drive_safety_ct", "off_drive_end_half_ct",
        "off_drive_three_out_ct", "off_drive_kill_ct", "off_drive_rz_ct", "off_drive_rz_td_ct", "off_drive_g10_ct", "off_drive_g10_td_ct",
        "off_drive_pass_td_ct", "off_drive_rush_td_ct", "off_fp_std", "off_fp_half", "off_fp_ppr", "off_targets", "off_receptions", "off_pass_td", "off_rush_td",
        "def_plays", "def_yards", "def_epa_allowed", "def_pass_plays", "def_pass_epa_allowed", "def_run_plays", "def_run_epa_allowed", "def_explosive_allowed", "def_conv_allowed", "def_conv_obs", "def_drive_pts_allowed", "def_drive_ct",
        "tend_plays", "tend_shotgun", "tend_nohuddle", "db", "air_sum", "air_att", "tend_motion", "tend_play_action", "tend_rpo", "tend_screen", "tend_trick", "tend_drop", "tend_catchable",
        "pace_snaps", "pace_neutral_db", "pace_neutral_snaps", "pace_sec_sum", "pace_sec_n", "pace_games", "pace_total_game_plays",
        "cov_obs", "cov_man", "cov_zone", "cov_shell_obs", "cov_mofc", "cov_mofo", "cov_c1", "cov_c2", "cov_c3",
        "off_pers_obs", "off_wr3", "off_mte", "off_11", "off_12", "off_13", "off_21", "off_multirb",
        "def_pers_obs", "def_sub", "def_nickel", "def_dime", "blitz_db_obs", "blitz_db5",
        "dl_dropbacks", "dl_pressures", "dl_no_blitz_obs", "dl_no_blitz_pressures", "dl_rush_att", "dl_rush_stuffed",
    ]
    for c in cols:
        if c not in out.columns:
            out[c] = 0
        out[c] = pd.to_numeric(out[c], errors="coerce").fillna(0.0)

    packed = {"weeks": weeks, "cols": cols, "teams": {}}
    for tm in teams:
        rows = []
        for wk in weeks:
            row = out.loc[(tm, wk)]
            rows.append([round(float(row[c]), 6) for c in cols])
        packed["teams"][tm] = rows
    return packed

# Defensive pass-rush + run-defense table (PFR def charting + pbp + FTN proxy). Mirrors Sharp's
# defensive_line: Pressure Rate, No-Blitz Pressure Rate, Rush Stuff Rate, plus Missed Tackles.
# Same fidelity tier as the O-Line table (rank ρ ~0.73–0.84 vs Sharp 2025; pressure proxies read
# lower than Sharp's because per-play hurries aren't public — hit+sack is the public proxy).
def team_defense_line(season):
    if not HAVE_PANDAS:
        raise RuntimeError("pandas is required for nflverse_stats.")
    pbp = _load_pbp(season, ["game_id", "play_id", "season_type", "defteam", "qb_dropback",
                             "qb_hit", "sack", "rush_attempt", "qb_scramble", "qb_kneel", "yards_gained"])
    pbp = pbp[pbp["season_type"] == "REG"].copy()
    pbp["defteam"] = pbp["defteam"].replace(NFLVERSE_TO_SEED)
    opp_db = pbp[pbp["qb_dropback"] == 1].groupby("defteam").size()
    out = pd.DataFrame(index=opp_db.index)
    # Pressure Rate + Missed Tackles from PFR defensive charting (summed over a team's defenders).
    try:
        d = _aux_csv(PFR_DEF_URL)
        d = d[(d["season"] == season) & (d["tm"] != "2TM")].copy()
        d["tm"] = d["tm"].replace(NFLVERSE_TO_SEED)
        g = d.groupby("tm")
        out["Pressure Rate"] = (g["prss"].sum() / opp_db * 100).round(1)
        out["Missed Tackles"] = g["m_tkl"].sum().round(0)
    except Exception as e:
        print(f"  (skipped PFR def charting: {type(e).__name__})")
    # No-Blitz Pressure Rate: (QB hit or sack) on non-blitz dropbacks (FTN n_blitzers == 0).
    try:
        ftn = _aux_csv(FTN_URL.format(season=season),
                       usecols=["nflverse_game_id", "nflverse_play_id", "n_blitzers"])
        m = pbp[pbp["qb_dropback"] == 1].merge(
            ftn, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "nflverse_play_id"], how="left")
        m = m.dropna(subset=["n_blitzers"])
        m["hit"] = (m["qb_hit"] == 1) | (m["sack"] == 1)
        nob = m[m["n_blitzers"] == 0].groupby("defteam")["hit"].mean() * 100
        out["No Blitz Pressure Rate"] = nob.round(1)
    except Exception as e:
        if not _is_http_not_found(e):
            print(f"  (skipped no-blitz pressure proxy: {type(e).__name__})")
    # Rush Stuff Rate forced: designed rushes (no scrambles/kneels) held to <= 0 yards.
    rd = pbp[(pbp["rush_attempt"] == 1) & (pbp["qb_scramble"] == 0) & (pbp["qb_kneel"] == 0)]
    out["Rush Stuff Rate"] = (rd.groupby("defteam").apply(lambda x: (x["yards_gained"] <= 0).mean() * 100)).round(1)
    # Order columns to mirror Sharp's defensive_line layout.
    cols = [c for c in ["Pressure Rate", "No Blitz Pressure Rate", "Rush Stuff Rate", "Missed Tackles"] if c in out.columns]
    return out[cols]

def team_extended(season):
    """Compute O-Line / Tendencies / Pace columns (the ones nflverse can supply) per team."""
    if not HAVE_PANDAS:
        raise RuntimeError("pandas is required for nflverse_stats.")
    pbp = _load_pbp(season)
    if "season_type" in pbp.columns:
        pbp = pbp[pbp["season_type"] == "REG"]
    p = pbp[(pbp["play_type"].isin(["pass", "run"])) & pbp["posteam"].notna()].copy()
    p["posteam"] = p["posteam"].replace(NFLVERSE_TO_SEED)
    games = p.groupby("posteam")["game_id"].nunique()
    g = p.groupby("posteam")
    # Tendencies (pbp)
    shotgun = g["shotgun"].mean() * 100
    nohuddle = g["no_huddle"].mean() * 100
    passes = p[p["pass"] == 1]
    airatt = passes.dropna(subset=["air_yards"]).groupby("posteam")["air_yards"].mean()
    # Pace (pbp)
    off_plays_g = g.size() / games
    neutral = p[(p["vegas_wp"] > 0.20) & (p["vegas_wp"] < 0.80)]
    neutral_db = neutral.groupby("posteam")["pass"].mean() * 100
    # O-Line rush stuff (pbp): share of rushes for <= 0 yards
    rush = p[p["rush"] == 1].copy()
    rush["stuff"] = rush["yards_gained"] <= 0
    rush["explosive"] = rush["yards_gained"] >= 10
    stuff = rush.groupby("posteam")["stuff"].mean() * 100
    explosive = rush.groupby("posteam")["explosive"].mean() * 100
    out = pd.DataFrame({
        "Shotgun Rate": shotgun.round(1),
        "NoHuddle Rate": nohuddle.round(1),
        "AirYards/Att": airatt.round(2),
        "Off Plays/G": off_plays_g.round(1),
        "Neutral DB Rate": neutral_db.round(1),
        "Stuff Rate": stuff.round(1),
        "Explosive Run Rate": explosive.round(1),
    })
    # Join PFR + NGS derived columns
    for fn in (_pfr_rush_team, _ngs_pass_team, _ngs_rush_team):
        try:
            out = out.join(fn(season))
        except Exception as e:
            print(f"  (skipped {fn.__name__}: {type(e).__name__})")
    # Enriched OL pass-protection metrics and utilization-weighted score stack.
    try:
        out = out.join(_ol_pass_metrics(season))
    except Exception as e:
        print(f"  (skipped _ol_pass_metrics: {type(e).__name__})")
    # Join FTN charting tendencies (2022+): motion / play-action / RPO / screen / trick / drop.
    try:
        ftn_off, _ = _ftn_team(season)
        out = out.join(ftn_off)
    except Exception as e:
        print(f"  (skipped FTN team tendencies: {type(e).__name__})")

    # PFR rushing `loaded` has occasionally shipped as non-numeric strings.
    # When that happens, keep the OL run card populated by borrowing NGS's
    # 8+ defender box rate as the nearest available proxy.
    if "Loaded Box Rate" in out.columns and "8+ Box Rate" in out.columns:
        out["Loaded Box Rate"] = out["Loaded Box Rate"].where(out["Loaded Box Rate"].notna(), out["8+ Box Rate"])

    return out

# Pace-of-play table (pbp only). Neutral dropback rate + seconds/play (with last-5 variants) +
# plays per game. Validated vs Sharp 2025 — Neutral DB ρ≈0.93, Total Plays/G ρ≈0.99, Sec/Play ρ≈0.82.
def team_pace(season):
    if not HAVE_PANDAS:
        raise RuntimeError("pandas is required for nflverse_stats.")
    pbp = _load_pbp(season, ["game_id", "play_id", "week", "posteam", "fixed_drive", "qb_dropback",
                             "rush_attempt", "qb_scramble", "qb_kneel", "qb_spike", "wp",
                             "half_seconds_remaining", "game_seconds_remaining", "season_type"])
    pbp = pbp[pbp["season_type"] == "REG"].copy()
    pbp["posteam"] = pbp["posteam"].replace(NFLVERSE_TO_SEED)
    # A "snap" for pace = a dropback or a designed rush (no scrambles/kneels/spikes).
    snaps = pbp[(((pbp["qb_dropback"] == 1) | ((pbp["rush_attempt"] == 1) & (pbp["qb_scramble"] == 0)))
                & (pbp["qb_kneel"] == 0) & (pbp["qb_spike"] == 0) & pbp["posteam"].notna())].copy()
    # Last-5 flag: each team's five largest week numbers.
    wk = snaps[["posteam", "week"]].drop_duplicates()
    wk["rk"] = wk.groupby("posteam")["week"].rank("dense", ascending=False)
    l5set = set(map(tuple, wk[wk["rk"] <= 5][["posteam", "week"]].values))
    snaps["is_l5"] = [(t, w) in l5set for t, w in zip(snaps["posteam"], snaps["week"])]
    # Neutral script: win prob 20–80% and outside the final 2:00 of a half.
    snaps["neutral"] = snaps["wp"].between(0.20, 0.80) & (snaps["half_seconds_remaining"] > 120)
    def _ndb(d):
        nd = d[d["neutral"]]
        return nd["qb_dropback"].mean() * 100 if len(nd) else None
    g = snaps.groupby("posteam")
    ndb_all = g.apply(_ndb)
    ndb_l5 = snaps[snaps["is_l5"]].groupby("posteam").apply(_ndb)
    off_ppg = g.apply(lambda d: len(d) / d["game_id"].nunique())
    # Seconds per play: clock gap between consecutive snaps in the same drive (clamped 1–45s).
    s = snaps.sort_values(["game_id", "posteam", "fixed_drive", "game_seconds_remaining"],
                          ascending=[True, True, True, False]).copy()
    s["diff"] = s.groupby(["game_id", "posteam", "fixed_drive"])["game_seconds_remaining"].shift(1) - s["game_seconds_remaining"]
    s = s[s["diff"].between(1, 45)]
    secplay = s.groupby("posteam")["diff"].mean()
    secplay_l5 = s[s["is_l5"]].groupby("posteam")["diff"].mean()
    # Total plays/game (both offenses) in this team's games.
    game_tot = snaps.groupby("game_id").size()
    tp = snaps[["game_id", "posteam"]].drop_duplicates()
    tp["gp"] = tp["game_id"].map(game_tot)
    tot_ppg = tp.groupby("posteam")["gp"].mean()
    return pd.DataFrame({
        "Neutral DB Rate": ndb_all.round(1),
        "Neutral DB Rate Last 5": ndb_l5.round(1),
        "Sec/Play": secplay.round(1),
        "Sec/Play Last 5": secplay_l5.round(1),
        "Off Plays/G": off_ppg.round(1),
        "Total Plays/G": tot_ppg.round(1),
    })

# ── SumerSports-style player tables (pbp + NGS + PFR + participation) ─────────
_QB_COLS = ["season_type", "game_id", "play_id", "passer_player_id", "passer_player_name", "rusher_player_id",
            "qb_dropback", "qb_scramble", "sack", "complete_pass", "pass_attempt",
            "passing_yards", "pass_touchdown", "interception", "air_yards", "epa",
            "success", "rushing_yards", "rush_touchdown", "rush", "yards_gained", "touchdown"]

def sumer_qb(season, min_plays=150, refinement=None):
    """Per-QB advanced table keyed by normalized name — compare to Sumer's QB table."""
    pbp = _load_pbp(season, _QB_COLS)
    pbp = pbp[pbp["season_type"] == "REG"]
    names = _name_map(season)
    # Per-QB average time to throw from Next Gen Stats (season totals, week==0).
    try:
        ngs = _aux_csv(NGS_PASS_URL, compression="gzip")
        ngs = ngs[(ngs["season"] == season) & (ngs["season_type"] == "REG") & (ngs["week"] == 0)]
        ttt = dict(zip(ngs["player_gsis_id"], ngs["avg_time_to_throw"]))
    except Exception:
        ttt = {}
    db = pbp[pbp["qb_dropback"] == 1].copy()
    # QB id per dropback: the passer, or (on a scramble) the rusher.
    db["qb"] = db["passer_player_id"].fillna(db["rusher_player_id"])
    db = db.dropna(subset=["qb"])
    if refinement:
        db = _refine_filter(db, season, refinement)
    gd = db.groupby("qb")
    rows = {}
    eff_min = 25 if refinement else min_plays   # situational splits have far fewer dropbacks
    for qid, d in gd:
        dropbacks = len(d)
        if dropbacks < eff_min:
            continue
        att = d["pass_attempt"].sum()
        scr_mask = d["qb_scramble"] == 1
        scr = int(scr_mask.sum())
        sacks = d["sack"].sum()
        # Sumer files QB scrambles as RUSHING (yards/EPA/TD), though nflfastR logs them as dropbacks.
        scr_epa = d.loc[scr_mask, "epa"].sum()
        scr_yds = d.loc[scr_mask, "yards_gained"].sum()
        scr_td = d.loc[scr_mask, "touchdown"].sum()
        # designed QB runs (non-scramble rushes by this player)
        runs = pbp[(pbp["rush"] == 1) & (pbp["qb_scramble"] != 1) & (pbp["rusher_player_id"] == qid)]
        plays = dropbacks + len(runs)
        pass_epa = d["epa"].sum() - scr_epa       # scramble EPA moves to rushing
        rush_epa = runs["epa"].sum() + scr_epa
        rush_yds = int(runs["rushing_yards"].sum() + scr_yds)
        rush_td = int(runs["rush_touchdown"].sum() + scr_td)
        name = names.get(qid)
        if not name:
            continue
        rows[name] = {
            "Plays": plays,
            "Total EPA": round(pass_epa + rush_epa, 2),
            "EPA/Play": round((pass_epa + rush_epa) / plays, 3) if plays else None,
            "Pass EPA": round(pass_epa, 1),
            "Rush EPA": round(rush_epa, 1),
            "Scramble %": round(scr / plays * 100, 2) if plays else None,
            "Sack %": round(sacks / dropbacks * 100, 2) if dropbacks else None,
            "Success %": round(d["success"].mean() * 100, 2),
            "ADoT": round(d[d["pass_attempt"] == 1]["air_yards"].mean(), 2),
            "Comp %": round(d["complete_pass"].sum() / att * 100, 2) if att else None,
            "Pass Yards": int(d["passing_yards"].sum()),
            "Time To Throw": round(ttt[qid], 2) if qid in ttt and pd.notna(ttt[qid]) else None,
            "Pass TD": int(d["pass_touchdown"].sum()),
            "INT": int(d["interception"].sum()),
            "YPA": round(d["passing_yards"].sum() / att, 2) if att else None,
            "Rush Yards": rush_yds,
            "Rush TD": rush_td,
        }
    return rows

def _first_name(df, qid):
    """Best-effort display name for a player id from the passer name column."""
    m = df[df["passer_player_id"] == qid]["passer_player_name"]
    return m.iloc[0] if len(m) else str(qid)

_RB_COLS = ["season_type", "game_id", "play_id", "rusher_player_id", "rusher_player_name",
            "receiver_player_id", "receiver_player_name", "rush", "pass", "rush_attempt",
            "rushing_yards", "rush_touchdown", "epa", "success", "first_down_rush",
            "tackled_for_loss", "complete_pass", "receiving_yards", "yards_after_catch",
            "pass_touchdown", "posteam"]

def sumer_rb(season, min_rush=40, refinement=None):
    """Per-RB advanced table keyed by normalized name — compare to Sumer's RB table."""
    pbp = _load_pbp(season, _RB_COLS)
    pbp = pbp[pbp["season_type"] == "REG"]
    names = _name_map(season)
    ru = pbp[(pbp["rush"] == 1) & pbp["rusher_player_id"].notna()].copy()
    if refinement:
        ru = _refine_filter(ru, season, refinement)
    # Yards after contact per RB (PFR advanced rushing, keyed by normalized name).
    try:
        pfr = _aux_csv(PFR_RUSH_URL)
        pfr = pfr[pfr["season"] == season]
        yac_contact = {_norm(n): v for n, v in zip(pfr["player"], pfr["yac"])}
    except Exception:
        yac_contact = {}
    # Target share: player targets / team targets (pass attempts with a receiver).
    tgt = pbp[pbp["receiver_player_id"].notna()]
    team_tgts = tgt.groupby("posteam").size().to_dict()
    player_tgts = tgt.groupby("receiver_player_id").size().to_dict()
    player_team = tgt.groupby("receiver_player_id")["posteam"].agg(
        lambda s: s.mode().iloc[0] if len(s.mode()) else None).to_dict()
    g = ru.groupby("rusher_player_id")
    rows = {}
    eff_min = 8 if refinement else min_rush   # situational splits have far fewer carries
    for rid, d in g:
        att = len(d)
        if att < eff_min:
            continue
        name = names.get(rid)
        if not name:
            continue
        yds = d["rushing_yards"].sum()
        rec = pbp[(pbp["complete_pass"] == 1) & (pbp["receiver_player_id"] == rid)]
        rows[name] = {
            "Rushes": att,
            "EPA/Rush": round(d["epa"].mean(), 3),
            "Total EPA": round(d["epa"].sum(), 2),
            "Rush Yards": int(yds),
            "Rush TD": int(d["rush_touchdown"].sum()),
            "Yards Per Carry": round(yds / att, 2),
            "Yards After Contact": int(yac_contact[name]) if name in yac_contact and pd.notna(yac_contact[name]) else None,
            "Success %": round(d["success"].mean() * 100, 2),
            "TFL %": round(d["tackled_for_loss"].mean() * 100, 2),
            "Explosive %": round((d["rushing_yards"] >= 15).mean() * 100, 2),
            "First Down %": round(d["first_down_rush"].mean() * 100, 2),
            "Receptions": int(len(rec)),
            "Rec. Yards": int(rec["receiving_yards"].sum()),
            "Rec. TDs": int(rec["pass_touchdown"].sum()),
            "YAC": int(rec["yards_after_catch"].sum()),
            "Target Share": round(player_tgts.get(rid, 0) / team_tgts.get(player_team.get(rid), 1) * 100, 2) if rid in player_team else None,
        }
    return rows

# ── WR/TE tables — routes run via participation (on-field for a dropback) ─────
# "Routes run" isn't a raw column anywhere; it's derived: a receiver who's on the field
# (in offense_players) for a QB dropback is credited a route. This matches Sumer's Routes Run
# to ~1% for WRs; TEs run slightly high because it can't detect a TE who stayed in to block.
_ROUTES_CACHE, _POS_CACHE, _CTX_CACHE = {}, {}, {}
_REC_COLS = ["season_type", "game_id", "play_id", "receiver_player_id", "complete_pass",
             "receiving_yards", "yards_after_catch", "air_yards", "pass_touchdown", "epa",
             "posteam", "pass"]
_WRTE_COLS = ["Routes Run", "Receptions", "Rec. Yards", "Target Share", "Touchdowns",
              "YAC", "ADoT", "Catch %", "Contested Catches", "Drops", "Total EPA",
              "Targets/Route Run", "YPRR"]

# Situational refinements → the play-context columns each needs. Per-down splits are granular
# (1st–4th) as requested. Coverage splits (vs man/zone) match Sumer's rates but not raw counts
# (NGS vs PFF classification). Play-action needs FTN (2022+); box splits are RB-only.
FTN_URL = "https://github.com/nflverse/nflverse-data/releases/download/ftn_charting/ftn_charting_{season}.csv"
REFINEMENTS = ["1st_down", "2nd_down", "3rd_down", "4th_down", "red_zone", "when_leading",
               "when_trailing", "non_garbage_time", "vs_man", "vs_zone", "play_action",
               "pure_dropback", "blitzed", "pressured"]
REFINEMENTS_RB = ["light_box", "7_box", "stacked_box"]

def _play_context(season):
    """Per-play context (down/field/score/wp + participation coverage/pressure/box + FTN PA),
    indexed by (game_id, play_id). Cached; used to filter plays for situational refinements."""
    if season in _CTX_CACHE:
        return _CTX_CACHE[season]
    pbp = _load_pbp(season, ["game_id", "play_id", "season_type", "down", "yardline_100",
                             "score_differential", "vegas_wp"])
    pbp = pbp[pbp["season_type"] == "REG"]
    try:
        part = _aux_csv(PART_URL.format(season=season),
                        usecols=["nflverse_game_id", "play_id", "defense_man_zone_type",
                                 "was_pressure", "number_of_pass_rushers", "defenders_in_box"])
        pbp = pbp.merge(part, left_on=["game_id", "play_id"],
                        right_on=["nflverse_game_id", "play_id"], how="left")
    except Exception:
        for c in ("defense_man_zone_type", "was_pressure", "number_of_pass_rushers", "defenders_in_box"):
            pbp[c] = None
    try:  # FTN play-action (2022+ only)
        ftn = _aux_csv(FTN_URL.format(season=season),
                       usecols=["nflverse_game_id", "nflverse_play_id", "is_play_action"])
        pbp = pbp.merge(ftn, left_on=["game_id", "play_id"],
                        right_on=["nflverse_game_id", "nflverse_play_id"], how="left")
    except Exception:
        pbp["is_play_action"] = None
    _CTX_CACHE[season] = pbp.set_index(["game_id", "play_id"])
    return _CTX_CACHE[season]

def _refine_mask(d, ref):
    """Boolean mask selecting plays that match a refinement (d carries the context columns)."""
    if ref == "1st_down": return d["down"] == 1
    if ref == "2nd_down": return d["down"] == 2
    if ref == "3rd_down": return d["down"] == 3
    if ref == "4th_down": return d["down"] == 4
    if ref == "red_zone": return d["yardline_100"] <= 20
    if ref == "when_leading": return d["score_differential"] > 0
    if ref == "when_trailing": return d["score_differential"] < 0
    if ref == "non_garbage_time": return (d["vegas_wp"] > 0.05) & (d["vegas_wp"] < 0.95)
    if ref == "vs_man": return d["defense_man_zone_type"] == "MAN_COVERAGE"
    if ref == "vs_zone": return d["defense_man_zone_type"] == "ZONE_COVERAGE"
    if ref == "pressured": return d["was_pressure"] == True   # noqa: E712
    if ref == "blitzed": return d["number_of_pass_rushers"] >= 5
    if ref == "play_action": return d["is_play_action"] == True   # noqa: E712
    if ref == "pure_dropback": return d["is_play_action"] == False   # noqa: E712
    if ref == "light_box": return d["defenders_in_box"] < 7
    if ref == "7_box": return d["defenders_in_box"] == 7
    if ref == "stacked_box": return d["defenders_in_box"] >= 8
    return pd.Series(True, index=d.index)

def _refine_filter(df, season, ref):
    """Filter a play DataFrame (with game_id, play_id) to a refinement's matching plays."""
    if not ref:
        return df
    ctx = _play_context(season)
    joined = df.merge(ctx.reset_index()[["game_id", "play_id", "down", "yardline_100",
                      "score_differential", "vegas_wp", "defense_man_zone_type", "was_pressure",
                      "number_of_pass_rushers", "defenders_in_box", "is_play_action"]],
                      on=["game_id", "play_id"], how="left", suffixes=("", "_ctx"))
    return joined[_refine_mask(joined, ref).fillna(False)]

def _routes_map(season, refinement=None):
    """gsis id → routes run (times on the field for a regular-season QB dropback), optionally
    restricted to a situational refinement's dropbacks."""
    key = (season, refinement)
    if key in _ROUTES_CACHE:
        return _ROUTES_CACHE[key]
    part = _aux_csv(PART_URL.format(season=season),
                    usecols=["nflverse_game_id", "play_id", "offense_players"])
    pbp = _load_pbp(season, ["game_id", "play_id", "qb_dropback", "season_type"])
    pbp = pbp[pbp["season_type"] == "REG"]
    m = part.merge(pbp, left_on=["nflverse_game_id", "play_id"], right_on=["game_id", "play_id"])
    db = m[(m["qb_dropback"] == 1) & m["offense_players"].notna()].copy()
    if refinement:
        db = _refine_filter(db, season, refinement)
    db["ids"] = db["offense_players"].str.findall(r"00-\d+")
    _ROUTES_CACHE[key] = db.explode("ids").groupby("ids").size().to_dict()
    return _ROUTES_CACHE[key]

def _pos_map(season):
    """gsis id → roster position (to split receivers into WR / TE)."""
    if season not in _POS_CACHE:
        r = _aux_csv(ROSTER_URL.format(season=season), usecols=["gsis_id", "position"])
        _POS_CACHE[season] = {g: p for g, p in zip(r["gsis_id"], r["position"]) if isinstance(g, str)}
    return _POS_CACHE[season]

def _receivers(season, min_targets=15, refinement=None):
    """Per-receiver Sumer-shaped table (routes via participation), keyed by gsis id. When a
    refinement is given, targets and routes are both restricted to that situation."""
    pbp = _load_pbp(season, _REC_COLS)
    pbp = pbp[pbp["season_type"] == "REG"]
    tgt = pbp[pbp["receiver_player_id"].notna()].copy()
    if refinement:
        tgt = _refine_filter(tgt, season, refinement)
    # FTN charting (2022+): per-target contested-ball + drop flags. Merged onto the targeted
    # receiver's plays so we can tally contested CATCHES (contested + completed) and drops.
    try:
        ftn = _aux_csv(FTN_URL.format(season=season),
                       usecols=["nflverse_game_id", "nflverse_play_id", "is_contested_ball", "is_drop"])
        tgt = tgt.merge(ftn, left_on=["game_id", "play_id"],
                        right_on=["nflverse_game_id", "nflverse_play_id"], how="left")
    except Exception:
        tgt["is_contested_ball"] = None
        tgt["is_drop"] = None
    team_tgts = tgt.groupby("posteam").size().to_dict()
    routes = _routes_map(season, refinement)
    names = _name_map(season)
    pos = _pos_map(season)
    rows = {}
    eff_min = 5 if refinement else min_targets   # situational splits have far fewer targets
    for rid, d in tgt.groupby("receiver_player_id"):
        tgts = len(d)
        if tgts < eff_min:
            continue
        name = names.get(rid)
        if not name:
            continue
        rec = int(d["complete_pass"].sum())
        ry = int(d["receiving_yards"].sum())
        rr = int(routes.get(rid, 0))
        team = d["posteam"].mode().iloc[0] if len(d["posteam"].mode()) else None
        contested = int(((d["is_contested_ball"] == True) & (d["complete_pass"] == 1)).sum())  # noqa: E712
        drops = int((d["is_drop"] == True).sum())  # noqa: E712
        rows[rid] = {
            "name": name, "pos": pos.get(rid),
            "Routes Run": rr,
            "Receptions": rec,
            "Rec. Yards": ry,
            "Target Share": round(tgts / team_tgts.get(team, 1) * 100, 2) if team else None,
            "Touchdowns": int(d["pass_touchdown"].sum()),
            "YAC": int(d["yards_after_catch"].sum()),
            "ADoT": round(d["air_yards"].mean(), 2),
            "Catch %": round(rec / tgts * 100, 2),
            "Contested Catches": contested,
            "Drops": drops,
            "Total EPA": round(d["epa"].sum(), 2),
            "Targets/Route Run": round(tgts / rr, 2) if rr else None,
            "YPRR": round(ry / rr, 2) if rr else None,
        }
    return rows

def _receivers_pos(season, pos, refinement=None):
    return {r["name"]: {c: r[c] for c in _WRTE_COLS}
            for r in _receivers(season, refinement=refinement).values() if r["pos"] == pos}

def sumer_wr(season, refinement=None):
    """Per-WR advanced table (incl. routes/YPRR) — compare to Sumer's WR table."""
    return _receivers_pos(season, "WR", refinement)

def sumer_te(season, refinement=None):
    """Per-TE advanced table — TE routes run slightly high (can't detect stay-in-to-block)."""
    return _receivers_pos(season, "TE", refinement)

# ── Route tree — route-type distribution when targeted (participation `route`) ─
# nflverse participation carries a `route` label on each pass play = the route the TARGETED
# receiver ran. Counting those per receiver gives a "routes run when targeted" distribution,
# which is exactly what a route tree visualizes. (This is when-targeted, not all routes run.)
ROUTE_TYPES = ["SCREEN", "SWING", "SHALLOW CROSS/DRAG", "SLANT", "QUICK OUT", "HITCH/CURL",
               "TEXAS/ANGLE", "IN/DIG", "DEEP OUT", "WHEEL", "POST", "CORNER", "GO"]

def route_trees(season, min_routes=12):
    """{normalized_name: {'pos','total','tree':{ROUTE:count}}} for pass-catchers with enough
    labeled targets. `total` counts only targets that carry a route label. Includes optional
    per-route receiving outputs (TD/rec/yds/PPR FP) for richer route-tree displays."""
    pbp = _load_pbp(season, [
        "game_id", "play_id", "season_type", "receiver_player_id", "pass_touchdown",
        "complete_pass", "receiving_yards"
    ])
    pbp = pbp[(pbp["season_type"] == "REG") & pbp["receiver_player_id"].notna()]
    part = _aux_csv(PART_URL.format(season=season),
                    usecols=["nflverse_game_id", "play_id", "route"])
    m = pbp.merge(part, left_on=["game_id", "play_id"],
                  right_on=["nflverse_game_id", "play_id"], how="left")
    m = m[m["route"].notna()]
    names, pos = _name_map(season), _pos_map(season)
    out = {}
    for rid, d in m.groupby("receiver_player_id"):
        name = names.get(rid)
        if not name or len(d) < min_routes:
            continue
        tree = d["route"].value_counts().to_dict()
        route_tds = d.groupby("route")["pass_touchdown"].sum().to_dict()
        route_rec = d.groupby("route")["complete_pass"].sum().to_dict()
        route_yds = d.groupby("route")["receiving_yards"].sum().to_dict()
        out[name] = {
            "pos": pos.get(rid),
            "total": int(len(d)),
            "total_tds": int(d["pass_touchdown"].sum()),
            "total_rec": int(d["complete_pass"].sum()),
            "total_yds": int(d["receiving_yards"].sum()),
            "tree": {k: int(v) for k, v in tree.items()},
            "route_tds": {k: int(route_tds.get(k, 0)) for k in tree.keys()},
            "route_rec": {k: int(route_rec.get(k, 0)) for k in tree.keys()},
            "route_yds": {k: int(route_yds.get(k, 0)) for k in tree.keys()},
        }
    return out

def qb_charting(season, min_attempts=50):
    """Per-QB accuracy & decision charting for the player card's passing view.

    Two sources, one row per QB, keyed by normalized full name like the zone
    matrix so the card looks players up the same way:
      - PFR advanced passing: on-target %, bad-throw %, batted balls,
        pressure % (the README's on_tgt_throws / bad_throw_pct / batted_balls)
      - FTN per-play charting joined to pbp passers: interception-worthy % and
        catchable-throw % of attempts (is_interception_worthy /
        is_catchable_ball)
    League medians ride along so the card colors against the field instead of
    against a hardcoded notion of good."""
    out = {"players": {}, "lg": {}}
    # ── PFR ──────────────────────────────────────────────────────────────────
    try:
        df = _aux_csv(PFR_PASS_URL)
        df = df[(df["season"] == season)].copy()
        g = df.groupby("player")           # sums the 2TM split rows per player
        att = g["pass_attempts"].sum()
        keep = att[att >= min_attempts].index
        pfr = pd.DataFrame({
            "att": att,
            "on_tgt_pct": (g["on_tgt_throws"].sum() / att * 100).round(1),
            "bad_throw_pct": (g["bad_throws"].sum() / att * 100).round(1),
            "batted": g["batted_balls"].sum(),
            "pressure_pct": (g["times_pressured"].sum()
                             / g["pass_attempts"].sum() * 100).round(1),
        }).loc[keep]
    except Exception as e:
        print(f"  (qb_charting: PFR pass failed: {e})")
        return {}
    # ── FTN (joined to pbp for passer identity) ──────────────────────────────
    ftn_by_name = {}
    try:
        from src.nflverse.ol_grades_pipeline import pq_optional
        ftn = pq_optional(f"ftn_{season}.parquet",
                          f"ftn_charting/ftn_charting_{season}.parquet",
                          ["nflverse_game_id", "nflverse_play_id",
                           "is_interception_worthy", "is_catchable_ball"])
        if ftn is not None and not ftn.empty:
            pbp = _load_pbp(season, ["game_id", "play_id", "passer_player_id",
                                     "pass_attempt", "season_type"])
            pbp = pbp[(pbp["season_type"] == "REG") & (pbp["pass_attempt"] == 1)
                      & pbp["passer_player_id"].notna()]
            j = pbp.merge(ftn, left_on=["game_id", "play_id"],
                          right_on=["nflverse_game_id", "nflverse_play_id"],
                          how="inner")
            names = _name_map(season)
            j["passer_key"] = j["passer_player_id"].map(names)
            j = j[j["passer_key"].notna()]
            gg = j.groupby("passer_key")
            n = gg.size()
            iw = (gg["is_interception_worthy"].sum() / n * 100).round(1)
            cb = (gg["is_catchable_ball"].sum() / n * 100).round(1)
            for key, v in iw.items():
                ftn_by_name[key] = {"intw_pct": float(v),
                                    "catchable_pct": float(cb[key]),
                                    "charted": int(n[key])}
    except Exception as e:
        print(f"  (qb_charting: FTN join failed: {e})")
    for full, r in pfr.iterrows():
        key = _norm(full)
        f = ftn_by_name.get(key, {})
        out["players"][key] = {
            "name": full, "att": int(r["att"]),
            "on_tgt_pct": float(r["on_tgt_pct"]),
            "bad_throw_pct": float(r["bad_throw_pct"]),
            "batted": int(r["batted"]),
            "pressure_pct": float(r["pressure_pct"]),
            **f,
        }
    if out["players"]:
        import statistics as _st
        for k in ("on_tgt_pct", "bad_throw_pct", "pressure_pct", "intw_pct",
                  "catchable_pct"):
            vs = [p[k] for p in out["players"].values() if k in p]
            if vs:
                out["lg"][k] = round(_st.median(vs), 1)
    return out


def qb_passing_zones(season, min_attempts=25):
    """Per-QB NGS-style passer-rating zone matrix keyed by normalized full name.

    Zones are left/middle/right x behind/short/inter/deep, with each cell carrying
    QB rating, league average for that zone, and attempt counts.
    """
    pbp = _load_pbp(season, _QB_ZONE_COLS)
    pbp = pbp[pbp["season_type"] == "REG"]
    att = pbp[(pbp["pass_attempt"] == 1) & (pbp["sack"] == 0)
              & (pbp["two_point_attempt"] == 0) & pbp["pass_location"].notna()
              & pbp["passer_player_id"].notna()].copy()
    if att.empty:
        return {}
    att["posteam"] = att["posteam"].replace(NFLVERSE_TO_SEED)
    att["depth"] = pd.cut(att["air_yards"], bins=[-100, -0.5, 9.5, 19.5, 100],
                          labels=["behind", "short", "inter", "deep"])
    row_order = ["deep", "inter", "short", "behind"]
    col_order = ["left", "middle", "right"]
    names = _name_map(season)
    out = {}
    for qid, qb in att.groupby("passer_player_id"):
        if len(qb) < min_attempts:
            continue
        name = names.get(qid)
        if not name:
            continue
        zones = {}
        for depth in row_order:
            zones[depth] = {}
            for loc in col_order:
                lg = att[(att["depth"] == depth) & (att["pass_location"] == loc)]
                me = qb[(qb["depth"] == depth) & (qb["pass_location"] == loc)]
                zones[depth][loc] = {
                    "rating": _passer_rating_df(me),
                    "league_avg": _passer_rating_df(lg),
                    "attempts": int(len(me)),
                    # Yards and TDs per zone, so the chart can be read as production and not
                    # only as efficiency. Rating already answers "how well did he throw here";
                    # these answer "how much did it actually produce".
                    "yards": int(me["yards_gained"].sum()) if len(me) else 0,
                    "td": int(me["pass_touchdown"].sum()) if len(me) else 0,
                }
        comp_pct = round(float(qb["complete_pass"].mean() * 100), 1) if len(qb) else None
        out[name] = {
            "team": (qb["posteam"].mode().iloc[0] if len(qb["posteam"].mode()) else None),
            "totals": {
                "passer_rating": _passer_rating_df(qb),
                "comp_pct": comp_pct,
                "yards": int(qb["yards_gained"].sum()),
                "td": int(qb["pass_touchdown"].sum()),
                "int": int(qb["interception"].sum()),
                "attempts": int(len(qb)),
            },
            "zones": zones,
        }
    return out


def _ol_grades_by_team(season=None):
    """Team/slot → latest OL grades from the local validated grades CSV.

    Returns {TEAM:{LT|LG|C|RG|RT:{name,run_grade,pass_grade,pass_snaps}}}.
    """
    global _OL_GRADES_BY_TEAM
    skey = str(season) if season is not None else "latest"
    if skey in _OL_GRADES_BY_TEAM:
        return _OL_GRADES_BY_TEAM[skey]
    out = {}
    path = _ol_grades_source_csv_path()
    if not path or not os.path.exists(path):
        _OL_GRADES_BY_TEAM[skey] = out
        return out
    try:
        hdr = set(pd.read_csv(path, nrows=0).columns)
        use = [c for c in ["gsis_id", "name", "team", "slot", "run_grade", "pass_grade", "pass_snaps"] if c in hdr]
        g = pd.read_csv(path, usecols=use)
    except Exception:
        _OL_GRADES_BY_TEAM[skey] = out
        return out
    if season is not None and "gsis_id" in g.columns:
        try:
            rost = _aux_parquet(
                f"https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{int(season)}.parquet",
                columns=["gsis_id", "team", "position"],
            )
            rost = rost.dropna(subset=["gsis_id"]).copy()
            rost["team"] = rost["team"].astype(str).str.strip().str.upper().replace(NFLVERSE_TO_SEED)
            rost = rost[rost["team"].isin(TEAMS)]
            if not rost.empty:
                tm_by_id = rost.groupby("gsis_id")["team"].agg(lambda s: s.mode().iloc[0] if len(s.mode()) else s.iloc[0])
                pos_by_id = rost.groupby("gsis_id")["position"].agg(lambda s: s.mode().iloc[0] if len(s.mode()) else s.iloc[0])
                gid = g["gsis_id"].astype(str)
                g["team"] = gid.map(tm_by_id).fillna(g["team"])
                if "slot" in g.columns:
                    season_slot = gid.map(pos_by_id)
                    season_slot = season_slot.astype(str).str.strip().str.upper()
                    valid_slot = season_slot.isin(["LT", "LG", "C", "RG", "RT"])
                    g.loc[valid_slot, "slot"] = season_slot[valid_slot]
        except Exception:
            pass
    g["team"] = g["team"].astype(str).str.strip().str.upper()
    g["slot"] = g["slot"].astype(str).str.strip().str.upper()
    g = g[g["team"].isin(TEAMS) & g["slot"].isin(["LT", "LG", "C", "RG", "RT"])]
    if g.empty:
        _OL_GRADES_BY_TEAM[skey] = out
        return out
    g["pass_snaps"] = pd.to_numeric(g["pass_snaps"], errors="coerce").fillna(0)
    g = g.sort_values(["team", "slot", "pass_snaps"], ascending=[True, True, False])
    best = g.groupby(["team", "slot"], as_index=False).first()
    for _, r in best.iterrows():
        tm = r["team"]
        sl = r["slot"]
        out.setdefault(tm, {})[sl] = {
            "name": r["name"] if pd.notna(r["name"]) else None,
            "run_grade": r["run_grade"] if pd.notna(r["run_grade"]) else None,
            "pass_grade": r["pass_grade"] if pd.notna(r["pass_grade"]) else None,
            "pass_snaps": int(r["pass_snaps"]),
        }
    _OL_GRADES_BY_TEAM[skey] = out
    return out


def _ol_grades_by_player(season=None, utilization_by_team=None, team_ol_context=None, starters_by_team=None, player_snap_pct_by_team=None):
    """Normalized player-name lookup for OL grade cards.

    Returns {normName:{team,slot,pos,pass_grade,pass_pctile,pass_conf,pass_snaps,
            run_grade,run_pctile,run_conf,poa_carries,shared_credit,penalty_rate,
            allpro_recent,career_ap1,career_pb,consensus_flag,market_pctile}}.
    """
    global _OL_GRADES_BY_PLAYER
    skey = str(season) if season is not None else "latest"
    if skey in _OL_GRADES_BY_PLAYER and utilization_by_team is None and team_ol_context is None and starters_by_team is None and player_snap_pct_by_team is None:
        return _OL_GRADES_BY_PLAYER[skey]
    out = {}
    path = _ol_grades_source_csv_path()
    if not path or not os.path.exists(path):
        _OL_GRADES_BY_PLAYER[skey] = out
        return out
    cols = [
        "name", "team", "slot", "pos",
        "pass_grade", "pass_pctile", "pass_conf", "pass_snaps",
        "run_grade", "run_pctile", "run_conf", "poa_carries",
        "ol_grade", "ol_pctile", "ol_conf", "team_pass_pctile", "team_run_pctile",
        "team_ctx_pass_pctile", "team_ctx_run_pctile", "team_ctx_exposure", "snap_pct",
        "p_market", "p_snap", "p_draft", "is_active", "espn_pbwr", "espn_rbwr",
        "hist_seasons", "ol_pctile_hist", "market_pctile_hist",
        "shared_credit", "penalty_rate", "penalty_hold_rate", "penalty_fs_rate",
        "allpro_recent", "career_ap1", "career_pb",
        "consensus_flag", "market_pctile",
        # Contextual fields may already exist when a future pipeline writes them directly.
        "pass_rate", "run_rate", "ol_weighted_pctile", "ol_weighted_grade",
        "entanglement_factor", "is_projected_starter", "last5_sacks_allowed_est",
    ]
    try:
        # market_pctile only exists when the pipeline ran with the market lens; read whatever
        # columns are present so a marketless cache still populates every player grade.
        available = set(pd.read_csv(path, nrows=0).columns)
        use = [c for c in cols if c in available]
        g = pd.read_csv(path, usecols=use)
    except Exception:
        _OL_GRADES_BY_PLAYER[skey] = out
        return out
    if g.empty:
        _OL_GRADES_BY_PLAYER[skey] = out
        return out
    if season is not None and "gsis_id" in g.columns:
        try:
            rost = _aux_parquet(
                f"https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{int(season)}.parquet",
                columns=["gsis_id", "team", "position"],
            )
            rost = rost.dropna(subset=["gsis_id"]).copy()
            rost["team"] = rost["team"].astype(str).str.strip().str.upper().replace(NFLVERSE_TO_SEED)
            rost = rost[rost["team"].isin(TEAMS)]
            if not rost.empty:
                tm_by_id = rost.groupby("gsis_id")["team"].agg(lambda s: s.mode().iloc[0] if len(s.mode()) else s.iloc[0])
                pos_by_id = rost.groupby("gsis_id")["position"].agg(lambda s: s.mode().iloc[0] if len(s.mode()) else s.iloc[0])
                gid = g["gsis_id"].astype(str)
                g["team"] = gid.map(tm_by_id).fillna(g.get("team"))
                season_slot = gid.map(pos_by_id)
                season_slot = season_slot.astype(str).str.strip().str.upper()
                valid_slot = season_slot.isin(["LT", "LG", "C", "RG", "RT"])
                g.loc[valid_slot, "slot"] = season_slot[valid_slot]
        except Exception:
            pass
    # The grades CSV is a single pooled table, so without this every lineman would be
    # stamped into every season's payload — Amarius Mims, drafted in 2024, showed a graded
    # 2021, 2022 and 2023 on his card. `hist_seasons` records the seasons a player actually
    # took a snap in, so use it to scope each season's map to who was really there.
    if season is not None and "hist_seasons" in g.columns:
        want = str(int(season))

        def _played(v):
            if v is None or (isinstance(v, float) and pd.isna(v)):
                return True          # no history recorded: keep rather than silently drop
            parts = [p.strip() for p in str(v).split(",") if p.strip()]
            return (want in parts) if parts else True

        g = g[g["hist_seasons"].map(_played)]
        if g.empty:
            _OL_GRADES_BY_PLAYER[skey] = out
            return out

    g["name"] = g["name"].astype(str).str.strip()
    # Normalize nflverse team codes before the TEAMS filter below. The grades CSV carries
    # nflverse's own abbreviations ("LA" for the Rams), while TEAMS uses the seed's ("LAR"),
    # so without this every Rams lineman failed the isin() and the team had no OL grades at
    # all — 12 players, silently absent rather than visibly broken.
    g["team"] = (g["team"].astype(str).str.strip().str.upper()
                 .replace(NFLVERSE_TO_SEED))
    g["slot"] = g["slot"].astype(str).str.strip().str.upper()
    g["pass_snaps"] = pd.to_numeric(g["pass_snaps"], errors="coerce").fillna(0)
    g = g[(g["name"] != "") & g["team"].isin(TEAMS) & g["slot"].isin(["LT", "LG", "C", "RG", "RT"])]
    if g.empty:
        _OL_GRADES_BY_PLAYER[skey] = out
        return out
    # If a name appears multiple times, keep the highest-snap record.
    g = g.sort_values(["name", "pass_snaps"], ascending=[True, False]).groupby("name", as_index=False).first()

    # Model-layer enrichment lives in ol_grades_pipeline.py; nflverse.py only shapes payloads.
    if utilization_by_team is not None or team_ol_context is not None or starters_by_team is not None or player_snap_pct_by_team is not None:
        try:
            import src.nflverse.ol_grades_pipeline as _olp
            if hasattr(_olp, "enrich_ol_player_records"):
                g = _olp.enrich_ol_player_records(
                    g,
                    utilization_by_team=utilization_by_team,
                    team_ol_context=team_ol_context,
                    starters_by_team=starters_by_team,
                    player_snap_pct_by_team=player_snap_pct_by_team,
                )
        except Exception as e:
            print(f"  (OL contextual enrichment fallback in nflverse.py: {type(e).__name__})")
    for _, r in g.iterrows():
        name = r.get("name")
        key = _norm(name)
        if not key:
            continue
        def _v(col):
            v = r.get(col)
            return None if pd.isna(v) else v
        out[key] = {
            "name": _v("name"),
            "team": _v("team"),
            "slot": _v("slot"),
            "pos": _v("pos"),
            "pass_grade": _v("pass_grade"),
            "pass_pctile": _v("pass_pctile"),
            "pass_conf": _v("pass_conf"),
            "pass_snaps": (None if _v("pass_snaps") is None else int(_v("pass_snaps"))),
            "run_grade": _v("run_grade"),
            "run_pctile": _v("run_pctile"),
            "run_conf": _v("run_conf"),
            "poa_carries": _v("poa_carries"),
            "shared_credit": _v("shared_credit"),
            "ol_grade": _v("ol_grade"),
            "ol_pctile": _v("ol_pctile"),
            "ol_conf": _v("ol_conf"),
            "team_pass_pctile": _v("team_pass_pctile"),
            "team_run_pctile": _v("team_run_pctile"),
            "p_market": _v("p_market"),
            "p_snap": _v("p_snap"),
            "p_draft": _v("p_draft"),
            "espn_pbwr": _v("espn_pbwr"),
            "espn_rbwr": _v("espn_rbwr"),
            "hist_seasons": _v("hist_seasons"),
            "ol_pctile_hist": _v("ol_pctile_hist"),
            "market_pctile_hist": _v("market_pctile_hist"),
            "penalty_rate": _v("penalty_rate"),
            "penalty_hold_rate": _v("penalty_hold_rate"),
            "penalty_fs_rate": _v("penalty_fs_rate"),
            "allpro_recent": _v("allpro_recent"),
            "career_ap1": _v("career_ap1"),
            "career_pb": _v("career_pb"),
            "consensus_flag": _v("consensus_flag"),
            "market_pctile": _v("market_pctile"),
            "pass_rate": _v("pass_rate"),
            "run_rate": _v("run_rate"),
            "ol_weighted_pctile": _v("ol_weighted_pctile"),
            "ol_weighted_grade": _v("ol_weighted_grade"),
            "entanglement_factor": _v("entanglement_factor"),
            "snap_pct": _v("snap_pct"),
            "team_context_weight": _v("team_context_weight"),
            "is_projected_starter": _v("is_projected_starter"),
            "last5_sacks_allowed_est": _v("last5_sacks_allowed_est"),
        }

    # Cache the base table once; season/context-aware fields are layered via pipeline helper.
    _OL_GRADES_BY_PLAYER[skey] = out
    return out


def _pfr_to_gsis_map():
    """Build once: PFR player id → GSIS id from nflverse players parquet."""
    global _PFR_TO_GSIS
    if _PFR_TO_GSIS is not None:
        return _PFR_TO_GSIS
    out = {}
    try:
        pl = _aux_parquet(PLAYERS_PARQUET_URL)
    except Exception:
        _PFR_TO_GSIS = out
        return out
    pfr_cols = [c for c in pl.columns if "pfr" in c and pl[c].notna().any()]
    if not pfr_cols or "gsis_id" not in pl.columns:
        _PFR_TO_GSIS = out
        return out
    pcol = pfr_cols[0]
    w = pl[[pcol, "gsis_id"]].dropna().drop_duplicates(pcol)
    out = {str(r[pcol]): str(r["gsis_id"]) for _, r in w.iterrows()}
    _PFR_TO_GSIS = out
    return out


def defensive_weekly_players(season):
    """Per-defender weekly logs (DL/LB/DB groups) for player-card use.

    Returns {normName:{name,team,pos,group,weeks:[...],totals:{...}}}.
    """
    try:
        wk = _aux_parquet(PFR_DEF_WEEK_URL.format(season=season))
    except Exception:
        return {}
    if wk is None or wk.empty:
        return {}
    wk = wk[wk["game_type"] == "REG"].copy()
    if wk.empty:
        return {}
    # Map PFR weekly rows to GSIS ids so we can bind to roster position/name consistently.
    p2g = _pfr_to_gsis_map()
    wk["gsis_id"] = wk["pfr_player_id"].astype(str).map(p2g)
    wk = wk[wk["gsis_id"].notna()].copy()
    if wk.empty:
        return {}

    roster = _aux_csv(ROSTER_URL.format(season=season), usecols=["gsis_id", "full_name", "position", "team"])
    if roster.empty:
        return {}
    roster = roster.dropna(subset=["gsis_id"]).drop_duplicates("gsis_id")
    rmap = roster.set_index("gsis_id")

    def _grp(pos):
        p = str(pos or "").upper()
        if p in {"DE", "DT", "NT", "DL"}:
            return "DL"
        if p in {"LB", "MLB", "OLB", "ILB", "WLB", "SLB"}:
            return "LB"
        if p in {"DB", "CB", "S", "SS", "FS"}:
            return "DB"
        return None

    rows = []
    stat_cols = [
        "def_targets", "def_completions_allowed", "def_yards_allowed", "def_receiving_td_allowed",
        "def_passer_rating_allowed", "def_adot", "def_yards_after_catch", "def_times_blitzed",
        "def_times_hurried", "def_times_hitqb", "def_sacks", "def_pressures",
        "def_tackles_combined", "def_missed_tackles", "def_missed_tackle_pct", "def_ints",
    ]
    have = [c for c in stat_cols if c in wk.columns]
    base_cols = ["gsis_id", "week", "team", "opponent", "pfr_player_name"] + have
    for _, r in wk[base_cols].iterrows():
        gid = r["gsis_id"]
        if gid not in rmap.index:
            continue
        rr = rmap.loc[gid]
        pos = rr.get("position")
        grp = _grp(pos)
        if grp is None:
            continue
        nm = rr.get("full_name") if pd.notna(rr.get("full_name")) else r.get("pfr_player_name")
        if not nm or pd.isna(nm):
            continue
        team = str(r.get("team") or rr.get("team") or "").upper()
        team = NFLVERSE_TO_SEED.get(team, team)
        rec = {
            "gsis_id": gid,
            "name": str(nm),
            "team": team,
            "pos": str(pos or "").upper(),
            "group": grp,
            "week": int(r.get("week") or 0),
            "opp": NFLVERSE_TO_SEED.get(str(r.get("opponent") or "").upper(), str(r.get("opponent") or "").upper()),
        }
        for c in have:
            v = r.get(c)
            rec[c] = None if pd.isna(v) else float(v)
        rows.append(rec)
    if not rows:
        return {}

    out = {}
    for rec in rows:
        key = _norm(rec["name"])
        if not key:
            continue
        d = out.setdefault(key, {
            "name": rec["name"],
            "team": rec["team"],
            "pos": rec["pos"],
            "group": rec["group"],
            "_gsis": rec["gsis_id"],   # join key for snap counts; stripped before return
            "weeks": [],
            "totals": {},
        })
        d["weeks"].append({
            "week": rec["week"],
            "team": rec["team"],
            "opp": rec["opp"],
            "targets": rec.get("def_targets"),
            "cmp_allowed": rec.get("def_completions_allowed"),
            "yds_allowed": rec.get("def_yards_allowed"),
            "td_allowed": rec.get("def_receiving_td_allowed"),
            "rating_allowed": rec.get("def_passer_rating_allowed"),
            "adot": rec.get("def_adot"),
            "yac_allowed": rec.get("def_yards_after_catch"),
            "blitzes": rec.get("def_times_blitzed"),
            "hurries": rec.get("def_times_hurried"),
            "qb_hits": rec.get("def_times_hitqb"),
            "sacks": rec.get("def_sacks"),
            "pressures": rec.get("def_pressures"),
            "tackles": rec.get("def_tackles_combined"),
            "missed_tackles": rec.get("def_missed_tackles"),
            "missed_tackle_pct": rec.get("def_missed_tackle_pct"),
            "ints": rec.get("def_ints"),
        })

    # Stable per-player order and compact totals for summary cards.
    sum_fields = [
        "targets", "cmp_allowed", "yds_allowed", "td_allowed", "yac_allowed", "blitzes", "hurries",
        "qb_hits", "sacks", "pressures", "tackles", "missed_tackles", "ints",
    ]
    mean_fields = ["rating_allowed", "adot", "missed_tackle_pct", "snap_pct"]
    sum_fields = sum_fields + ["snaps"]

    # Compact encoding to keep the seed small (this table is the largest nflverse block):
    #   • drop the per-week `team` (identical to the player-level team; the card reader uses
    #     rec.team, never w.team),
    #   • encode whole-number floats as ints (5.0 → 5), round others to 2dp,
    #   • omit None/absent stat fields entirely — the player-card reader renders a missing
    #     value exactly like null ('–'), so this is display-identical while much smaller.
    # Zeros are preserved (a recorded 0 is meaningful and still renders '0').
    def _num(v):
        if v is None:
            return None
        if isinstance(v, float):
            return int(v) if v == int(v) else round(v, 2)
        return v

    def _pack_week(w):
        packed = {}
        for k, v in w.items():
            if k == "team" or v is None:
                continue
            packed[k] = _num(v)
        return packed

    # ── Snap share: the inclusion baseline (the "Dexter Lawrence" fix) ───────────
    # A week belongs on the card if the player took a defensive snap — full stop. PFR decides
    # whether a week gets STATS; snap counts decide whether it EXISTS. So:
    #   • weeks PFR charted get snaps/snap_pct attached,
    #   • weeks he played but PFR never charted get a stub row (week/opp/snaps only; the stat
    #     cells render '–' exactly like any other missing value),
    #   • totals carry games (charted) AND gp (actually played) so the card can be honest
    #     about the difference.
    # If snap counts are unavailable the cards behave exactly as they do today.
    try:
        snaps = _aux_parquet(SNAP_COUNTS_URL.format(season=season),
                             columns=["game_type", "week", "pfr_player_id", "opponent",
                                      "defense_snaps", "defense_pct"])
        snaps = snaps[(snaps["game_type"] == "REG") & (snaps["defense_snaps"].fillna(0) > 0)]
        gsis_to_pfr = {}
        for pfr_id, gid in p2g.items():
            gsis_to_pfr.setdefault(gid, pfr_id)
        by_pfr = {}
        for _, sr in snaps.iterrows():
            by_pfr.setdefault(str(sr["pfr_player_id"]), []).append(sr)
        for key, d in out.items():
            pfr_id = gsis_to_pfr.get(d.get("_gsis"))
            srows = by_pfr.get(str(pfr_id)) if pfr_id else None
            if not srows:
                continue
            wkmap = {}
            for sr in srows:
                opp = str(sr["opponent"] or "").upper()
                wkmap[int(sr["week"])] = (
                    int(sr["defense_snaps"]),
                    None if pd.isna(sr["defense_pct"]) else round(float(sr["defense_pct"]), 3),
                    NFLVERSE_TO_SEED.get(opp, opp),
                )
            have_weeks = {int(w.get("week") or 0) for w in d["weeks"]}
            for w in d["weeks"]:
                hit = wkmap.get(int(w.get("week") or 0))
                if hit:
                    w["snaps"], w["snap_pct"] = hit[0], hit[1]
            for wknum, (sn, pct, opp) in wkmap.items():
                if wknum not in have_weeks:
                    d["weeks"].append({"week": wknum, "team": d["team"], "opp": opp,
                                       "snaps": sn, "snap_pct": pct})
            d["_gp"] = len({int(w.get("week") or 0) for w in d["weeks"]})
    except Exception:
        pass

    for key, d in out.items():
        # games = weeks PFR actually charted; gp = weeks he took a snap. They differ a lot for
        # run-stuffing interior linemen, which is the whole point of showing both.
        charted = sum(1 for w in d["weeks"]
                      if any(w.get(f) is not None
                             for f in ("tackles", "targets", "pressures", "sacks")))
        d["weeks"] = sorted(d["weeks"], key=lambda w: int(w.get("week") or 0))
        gp = d.pop("_gp", None) or len(d["weeks"])
        d.pop("_gsis", None)
        t = {"games": charted, "gp": gp}
        for f in sum_fields:
            vals = [w.get(f) for w in d["weeks"] if w.get(f) is not None]
            t[f] = (None if not vals else round(float(sum(vals)), 2))
        for f in mean_fields:
            vals = [w.get(f) for w in d["weeks"] if w.get(f) is not None]
            t[f] = (None if not vals else round(float(sum(vals) / len(vals)), 2))
        d["totals"] = {k: _num(v) for k, v in t.items() if v is not None}
        d["weeks"] = [_pack_week(w) for w in d["weeks"]]
    return out


def _rb_lane(loc, gap):
    if loc == "middle":
        return "MID"
    side = "L" if loc == "left" else ("R" if loc == "right" else None)
    gmap = {"end": "E", "tackle": "T", "guard": "G"}
    return (side + gmap.get(gap, "")) if side and gap in gmap else None


def rb_rushing_fans(season, min_attempts=20, min_lane_attempts=3):
    """Per-RB rushing fan payload keyed by normalized player name.

    Includes lane-level rushing efficiency vs league lane averages plus OL grade cards.
    """
    pbp = _load_pbp(season, _RB_FAN_COLS)
    runs = pbp[(pbp["season_type"] == "REG") & (pbp["rush_attempt"] == 1)
               & (pbp["qb_scramble"] == 0) & (pbp["two_point_attempt"] == 0)
               & pbp["run_location"].notna() & pbp["rusher_player_id"].notna()].copy()
    if runs.empty:
        return {}
    runs["posteam"] = runs["posteam"].replace(NFLVERSE_TO_SEED)
    runs["lane"] = runs.apply(lambda r: _rb_lane(r["run_location"], r.get("run_gap")), axis=1)
    runs = runs[runs["lane"].notna()]
    if runs.empty:
        return {}
    lanes_order = ["LE", "LT", "LG", "MID", "RG", "RT", "RE"]
    lg_lane_ypc = runs.groupby("lane")["yards_gained"].mean().to_dict()
    names = _name_map(season)
    ol_cards = _ol_grades_by_team(season)
    out = {}
    for rid, rb in runs.groupby("rusher_player_id"):
        if len(rb) < min_attempts:
            continue
        name = names.get(rid)
        if not name:
            continue
        team = rb["posteam"].mode().iloc[0] if len(rb["posteam"].mode()) else None
        lanes = {}
        for lane in lanes_order:
            g = rb[rb["lane"] == lane]
            if len(g) < min_lane_attempts:
                continue
            ypc = float(g["yards_gained"].mean())
            succ = float(g["success"].mean() * 100) if g["success"].notna().any() else None
            ly = lg_lane_ypc.get(lane)
            lanes[lane] = {
                "attempts": int(len(g)),
                "ypc": round(ypc, 2),
                "success_rate": (None if succ is None else round(succ, 1)),
                "league_ypc": (None if ly is None else round(float(ly), 2)),
                "ypc_diff": (None if ly is None else round(ypc - float(ly), 2)),
                # Volume and scoring per gap alongside the efficiency figures — a lane can be
                # highly efficient on six carries or be the one he actually scores through.
                "yards": int(g["yards_gained"].sum()),
                "td": (int(g["rush_touchdown"].sum()) if "rush_touchdown" in g.columns else 0),
            }
        if not lanes:
            continue
        att = int(len(rb))
        yds = int(rb["yards_gained"].sum())
        ypc = round(yds / att, 2) if att else None
        succ = (None if not rb["success"].notna().any() else round(float(rb["success"].mean() * 100), 1))
        out[name] = {
            "team": team,
            "totals": {
                "attempts": att,
                "yards": yds,
                "ypc": ypc,
                "success_rate": succ,
            },
            "lanes": lanes,
            "line": ol_cards.get(team, {}),
        }
    return out

# ── Participation-based coverage + personnel (the newly-unlocked charting) ────
def coverage_personnel(season):
    """Team man/zone coverage rates (defense) + 3WR / multi-TE personnel rates (offense)."""
    part = _aux_csv(PART_URL.format(season=season),
                    usecols=["nflverse_game_id", "play_id", "defense_man_zone_type",
                             "defense_coverage_type", "offense_personnel"])
    pbp = _load_pbp(season, ["game_id", "play_id", "posteam", "defteam", "season_type", "play_type"])
    pbp = pbp[pbp["season_type"] == "REG"]
    m = part.merge(pbp, left_on=["nflverse_game_id", "play_id"], right_on=["game_id", "play_id"])
    m["posteam"] = m["posteam"].replace(NFLVERSE_TO_SEED)
    m["defteam"] = m["defteam"].replace(NFLVERSE_TO_SEED)
    # Coverage (defense): man vs zone rate on charted dropbacks
    mz = m.dropna(subset=["defense_man_zone_type"]).copy()
    mz["man"] = mz["defense_man_zone_type"] == "MAN_COVERAGE"
    man = mz.groupby("defteam")["man"].mean() * 100
    cover = pd.DataFrame({"Man Rate": man.round(1), "Zone Rate": (100 - man).round(1)})
    # Coverage shell (NGS coverage type): middle-of-field closed (single-high: C0/C1/C3) vs open
    # (two-high: C2/C4/C6/2-Man) + the three dominant cover families. Validated vs Sharp 2025
    # (Middle Closed ρ≈0.79, Middle Open ρ≈0.83).
    cc = m[m["defense_coverage_type"].notna() & (m["defense_coverage_type"] != "")].copy()
    if len(cc):
        MOFC = ["COVER_0", "COVER_1", "COVER_3"]
        MOFO = ["COVER_2", "COVER_4", "COVER_6", "2_MAN"]
        cover["Middle Closed Rate"] = (cc.assign(x=cc["defense_coverage_type"].isin(MOFC))
                                       .groupby("defteam")["x"].mean() * 100).round(1)
        cover["Middle Open Rate"] = (cc.assign(x=cc["defense_coverage_type"].isin(MOFO))
                                     .groupby("defteam")["x"].mean() * 100).round(1)
        for cn in (1, 2, 3):
            cover[f"Cover {cn}"] = (cc.assign(x=cc["defense_coverage_type"] == f"COVER_{cn}")
                                    .groupby("defteam")["x"].mean() * 100).round(1)
    # Personnel (offense): 3WR rate, multi-TE rate from the personnel string
    pp = m.dropna(subset=["offense_personnel"]).copy()
    pp["wr"] = pp["offense_personnel"].str.extract(r"(\d+)\s*WR").astype(float)
    pp["te"] = pp["offense_personnel"].str.extract(r"(\d+)\s*TE").astype(float)
    pp = pp[pp["play_type"].isin(["pass", "run"])]
    wr3 = pp.assign(x=pp["wr"] >= 3).groupby("posteam")["x"].mean() * 100
    mte = pp.assign(x=pp["te"] >= 2).groupby("posteam")["x"].mean() * 100
    pers = pd.DataFrame({"3WR Rate": wr3.round(1), "Multi TE Rate": mte.round(1)})
    return cover, pers

# Richer personnel groupings from the participation personnel strings. Offense: 11/12/21 grouping
# rates + multi-RB (2-back). Defense: sub-package (5+ DB), nickel (5 DB), dime+ (6+ DB). Validated
# vs Sharp 2025 — Multi RB Rate ρ≈0.99 (exact), Sub Package Rate ρ≈0.96.
def _parse_personnel(s):
    """'1 RB, 1 TE, 3 WR' → {'RB':1,'TE':1,'WR':3}; '4 DL, 2 LB, 5 DB' → {...}."""
    return {pos: int(nn) for nn, pos in _re.findall(r"(\d+)\s+([A-Z]+)", s or "")}

def personnel_groups(season):
    part = _aux_csv(PART_URL.format(season=season),
                    usecols=["nflverse_game_id", "play_id", "offense_personnel", "defense_personnel"])
    pbp = _load_pbp(season, ["game_id", "play_id", "posteam", "defteam", "season_type", "play_type"])
    pbp = pbp[pbp["season_type"] == "REG"]
    m = part.merge(pbp, left_on=["nflverse_game_id", "play_id"], right_on=["game_id", "play_id"])
    m["posteam"] = m["posteam"].replace(NFLVERSE_TO_SEED)
    m["defteam"] = m["defteam"].replace(NFLVERSE_TO_SEED)
    m = m[m["play_type"].isin(["pass", "run"])]
    # Offense: parse each unique personnel string once → backs (RB+FB) and TE counts.
    o = m.dropna(subset=["offense_personnel"]).copy()
    ocache = {s: _parse_personnel(s) for s in o["offense_personnel"].unique()}
    o["backs"] = o["offense_personnel"].map(lambda s: ocache[s].get("RB", 0) + ocache[s].get("FB", 0))
    o["te"] = o["offense_personnel"].map(lambda s: ocache[s].get("TE", 0))
    o["p11"] = ((o["backs"] == 1) & (o["te"] == 1)).astype(float)
    o["p12"] = ((o["backs"] == 1) & (o["te"] == 2)).astype(float)
    o["p13"] = ((o["backs"] == 1) & (o["te"] == 3)).astype(float)
    o["p21"] = ((o["backs"] == 2) & (o["te"] == 1)).astype(float)
    o["multirb"] = (o["backs"] >= 2).astype(float)
    go = o.groupby("posteam")
    off = pd.DataFrame({
        "11 Personnel": (go["p11"].mean() * 100).round(1),
        "12 Personnel": (go["p12"].mean() * 100).round(1),
        "13 Personnel": (go["p13"].mean() * 100).round(1),
        "21 Personnel": (go["p21"].mean() * 100).round(1),
        "Multi RB Rate": (go["multirb"].mean() * 100).round(1),
    })
    # Defense: DB count on the field → sub-package / nickel / dime+ share.
    d = m.dropna(subset=["defense_personnel"]).copy()
    dcache = {s: _parse_personnel(s) for s in d["defense_personnel"].unique()}
    d["dbs"] = d["defense_personnel"].map(
        lambda s: sum(dcache[s].get(k, 0) for k in ("CB", "FS", "SS", "S", "DB")))
    d["sub"] = (d["dbs"] >= 5).astype(float)
    d["nickel"] = (d["dbs"] == 5).astype(float)
    d["dime"] = (d["dbs"] >= 6).astype(float)
    gd = d.groupby("defteam")
    dfn = pd.DataFrame({
        "Sub Package Rate": (gd["sub"].mean() * 100).round(1),
        "Nickel Rate": (gd["nickel"].mean() * 100).round(1),
        "Dime+ Rate": (gd["dime"].mean() * 100).round(1),
    })
    return off, dfn


def _scheme_parse_personnel(s):
    """'1 RB, 1 TE, 3 WR' -> (backs, te, wr, ol)."""
    if not isinstance(s, str):
        return None
    nums = {pos: int(nn) for nn, pos in _re.findall(r"(\d+)\s+([A-Z]+)", s)}
    b = nums.get("RB", 0) + nums.get("FB", 0)
    t = nums.get("TE", 0)
    w = nums.get("WR", 0)
    ol = nums.get("T", 0) + nums.get("G", 0) + nums.get("C", 0)
    if b > 3 or t > 4 or w > 5:
        return None
    return b, t, w, ol


def _scheme_align(row):
    f = row.get("offense_formation")
    if f == "PISTOL":
        return "pistol"
    if f == "SHOTGUN":
        return "gun"
    if f == "UNDER CENTER":
        return "uc"
    return "gun" if row.get("shotgun") == 1 else "uc"


def _scheme_lane(row):
    loc = row.get("run_location")
    gap = row.get("run_gap")
    if loc == "middle":
        return "MID"
    if pd.isna(loc):
        return None
    side = "L" if loc == "left" else ("R" if loc == "right" else None)
    gmap = {"end": "E", "tackle": "T", "guard": "G"}
    return (side + gmap.get(gap, "")) if side and gap in gmap else None


def _scheme_name_from_group(b, t, align, ol):
    jumbo = " JUMBO" if ol >= 6 else ""
    if b == 0:
        return ("EMPTY" if align != "uc" else "EMPTY UC") + jumbo
    if align == "uc":
        return ("I-FORM" if b >= 2 else "SINGLE BACK") + jumbo
    if align == "pistol":
        return "PISTOL" + jumbo
    return "SHOTGUN" + jumbo


def coaching_scheme(season, min_group_plays=1, max_groups=40):
    """Team coaching-scheme visualization payload keyed by team code.

    Produces compact per-team view buckets (down × distance-to-sticks × play-type) with top
    personnel groups, pass-run tendencies, route leaders by slot, and top run lanes. Every
    personnel grouping with at least one play is included (no plays-per-group threshold), so a
    filter combination only reads “no plays” when the situation truly never occurred.
    """
    pbp_cols = [
        "game_id", "play_id", "posteam", "play_type", "pass", "rush_attempt", "qb_scramble",
        "epa", "success", "down", "ydstogo", "yardline_100", "season_type", "shotgun", "run_location", "run_gap",
        # rusher_player_id is REQUIRED to identify RBs: on a run play receiver_player_id is
        # always null, so ranking backs off it silently produced zero RB slots.
        "receiver_player_id", "rusher_player_id",
        # production per formation (yards/TDs), split pass vs run
        "yards_gained", "pass_touchdown", "rush_touchdown",
    ]
    pbp = _load_pbp(season, pbp_cols)
    pbp = pbp[(pbp["season_type"] == "REG") & pbp["play_type"].isin(["pass", "run"])].copy()
    if pbp.empty:
        return {}
    part = _aux_csv(PART_URL.format(season=season),
                    usecols=["nflverse_game_id", "play_id", "offense_personnel", "offense_formation", "route"])
    try:
        ftn = _aux_csv(FTN_URL.format(season=season),
                       usecols=["nflverse_game_id", "nflverse_play_id", "is_motion", "is_play_action", "is_no_huddle"])
    except Exception:
        ftn = pd.DataFrame(columns=["nflverse_game_id", "nflverse_play_id", "is_motion", "is_play_action", "is_no_huddle"])

    d = pbp.merge(part, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "play_id"], how="inner")
    if len(ftn):
        d = d.merge(ftn, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "nflverse_play_id"], how="left")
    else:
        d["is_motion"] = False
        d["is_play_action"] = False
        d["is_no_huddle"] = False
    d["posteam"] = d["posteam"].replace(NFLVERSE_TO_SEED)

    pr = d["offense_personnel"].apply(_scheme_parse_personnel)
    d = d[pr.notna()].copy()
    if d.empty:
        return {}
    pr = pr[pr.notna()]
    d["backs"] = [x[0] for x in pr]
    d["te"] = [x[1] for x in pr]
    d["wr"] = [x[2] for x in pr]
    d["ol"] = [x[3] for x in pr]
    d["p"] = d["backs"].astype(str) + d["te"].astype(str)
    d["align"] = d.apply(_scheme_align, axis=1)
    d["lane"] = d.apply(_scheme_lane, axis=1)
    d["is_red_zone"] = d["yardline_100"].notna() & (d["yardline_100"] <= 20)

    roster = _aux_csv(ROSTER_URL.format(season=season), usecols=["gsis_id", "full_name", "position", "team", "jersey_number"]).drop_duplicates("gsis_id")
    rmap = roster.set_index("gsis_id") if len(roster) else pd.DataFrame()

    def _lname(pid):
        if pid is None or pd.isna(pid) or len(rmap) == 0 or pid not in rmap.index:
            return "—"
        nm = str(rmap.at[pid, "full_name"] or "").strip()
        if not nm:
            return "—"
        bits = nm.split()
        return bits[-1] if bits else nm

    def _jersey(pid):
        if pid is None or pd.isna(pid) or len(rmap) == 0 or pid not in rmap.index:
            return None
        try:
            v = rmap.at[pid, "jersey_number"]
            if pd.isna(v):
                return None
            return str(int(v))
        except Exception:
            return None

    def _slots_for_team(df_team):
        pass_rows = df_team[df_team["pass"] == 1]
        tgt = pass_rows["receiver_player_id"].dropna().value_counts()
        # Backs are ranked by CARRIES, which live in rusher_player_id. This previously read
        # receiver_player_id — null on every run play — so `rush` came back empty, no RB1/RB2
        # slots were ever created, and every RB assign shipped with routes:[] (the app then
        # fell back to the generic route tree, which is why RBs showed no target %).
        # The old `if len(rush)==0` retry was a no-op: value_counts() already drops NaN.
        rush_col = "rusher_player_id" if "rusher_player_id" in df_team.columns else "receiver_player_id"
        rush = df_team[(df_team["rush_attempt"] == 1) & (df_team["qb_scramble"] == 0)][rush_col].dropna().value_counts()

        def _top(counts, want, k):
            out = []
            for pid in counts.index:
                if pid is None or pd.isna(pid) or len(rmap) == 0 or pid not in rmap.index:
                    continue
                pos = str(rmap.at[pid, "position"] or "").upper()
                if pos in want:
                    out.append(pid)
                if len(out) >= k:
                    break
            return out

        wrs = _top(tgt, {"WR"}, 4)
        tes = _top(tgt, {"TE"}, 2)
        rbs = _top(rush, {"RB", "FB"}, 2)
        slots = {}
        names = {}
        jerseys = {}
        for i, pid in enumerate(wrs):
            slots[f"WR{i+1}"] = pid; names[str(pid)] = _lname(pid); jerseys[str(pid)] = _jersey(pid)
        for i, pid in enumerate(tes):
            slots[f"TE{i+1}"] = pid; names[str(pid)] = _lname(pid); jerseys[str(pid)] = _jersey(pid)
        for i, pid in enumerate(rbs):
            slots[f"RB{i+1}"] = pid; names[str(pid)] = _lname(pid); jerseys[str(pid)] = _jersey(pid)
        jerseys = {k: v for k, v in jerseys.items() if v is not None}
        return slots, names, jerseys

    out = {}
    for team, dt in d.groupby("posteam"):
        if team not in TEAMS:
            continue
        slots, names, jerseys = _slots_for_team(dt)
        pass_all = dt[(dt["pass"] == 1) & dt["route"].notna() & (dt["route"] != "")]

        # season-level route fallback by player id
        season_routes = {}
        for slot, pid in slots.items():
            g = pass_all[pass_all["receiver_player_id"] == pid]
            if len(g):
                vc = g["route"].value_counts()
                season_routes[pid] = [[str(k), round(100 * float(v) / len(g), 1)] for k, v in vc.head(9).items()]

        pool = {(p, a): gg for (p, a), gg in dt.groupby(["p", "align"])}

        def assign_for(slot, pid, pcode, align):
            if pid is None:
                return {"slot": slot, "name": "—", "routes": []}
            gg = pool.get((pcode, align))
            fr = []
            if gg is not None and len(gg):
                pg = gg[(gg["pass"] == 1) & (gg["receiver_player_id"] == pid) & gg["route"].notna() & (gg["route"] != "")]
                if len(pg) >= 2:
                    vc = pg["route"].value_counts()
                    fr = [[str(k), round(100 * float(v) / len(pg), 1)] for k, v in vc.head(9).items()]
            if not fr:
                fr = season_routes.get(pid, [])
            return {"slot": slot, "name": names.get(str(pid), _lname(pid)), "routes": fr}

        formation_table = {}

        def summarize(dfv):
            if dfv is None or not len(dfv):
                return {"total": 0, "groups": []}
            total = int(len(dfv))
            groups = []
            for (pcode, align, b, t, w, ol), g in dfv.groupby(["p", "align", "backs", "te", "wr", "ol"]):
                n = int(len(g))
                if n < min_group_plays:
                    continue
                gp = g[g["pass"] == 1]
                gr = g[g["pass"] == 0]
                runs = g[(g["rush_attempt"] == 1) & (g["qb_scramble"] == 0) & g["lane"].notna()]
                lanes = []
                for lane, lg in runs.groupby("lane"):
                    lanes.append([str(lane), int(len(lg)), round(float(lg["epa"].mean()), 2)])
                lanes.sort(key=lambda x: -x[1])
                # Formation metadata + slot assignments (with route trees) are filter-independent,
                # so store them once per unique signature in a per-team table and reference them by
                # `sig` from each bucket. This dedupes the large assigns/route data across the ~80
                # down×distance×play-type buckets (the app re-expands groups from the table).
                sig = f"{pcode}|{align}|{int(w)}|{int(t)}|{int(b)}|{int(ol)}"
                if sig not in formation_table:
                    assigns = []
                    for i in range(int(w)):
                        assigns.append(assign_for(f"WR{i+1}", slots.get(f"WR{i+1}"), pcode, align))
                    for i in range(int(t)):
                        assigns.append(assign_for(f"TE{i+1}", slots.get(f"TE{i+1}"), pcode, align))
                    for i in range(int(b)):
                        assigns.append(assign_for(f"RB{i+1}", slots.get(f"RB{i+1}"), pcode, align))
                    formation_table[sig] = {
                        "p": str(pcode),
                        "align": str(align),
                        "name": _scheme_name_from_group(int(b), int(t), str(align), int(ol)),
                        "backs": int(b), "te": int(t), "wr": int(w), "ol": int(ol),
                        "assigns": assigns,
                    }
                groups.append({
                    "sig": sig,
                    "n": n,
                    "share": round(100 * n / total, 1),
                    "pass_rate": round(100 * float(g["pass"].mean()), 1),
                    "epa": round(float(g["epa"].mean()), 3),
                    "succ": round(100 * float(g["success"].mean()), 1),
                    "np": int(len(gp)),
                    "ep": (None if not len(gp) else round(float(gp["epa"].mean()), 3)),
                    "sp": (None if not len(gp) else round(100 * float(gp["success"].mean()), 1)),
                    "nr": int(len(gr)),
                    "er": (None if not len(gr) else round(float(gr["epa"].mean()), 3)),
                    "sr": (None if not len(gr) else round(100 * float(gr["success"].mean()), 1)),
                    # Production out of this formation, split pass vs run. Unlike the route
                    # trees (filter-independent, shared via `sig`), these are real per-bucket
                    # totals — they move with the down/distance/type filters.
                    "py": int(gp["yards_gained"].fillna(0).sum()) if len(gp) else 0,
                    "ptd": int(gp["pass_touchdown"].fillna(0).sum()) if len(gp) else 0,
                    "ry": int(gr["yards_gained"].fillna(0).sum()) if len(gr) else 0,
                    "rtd": int(gr["rush_touchdown"].fillna(0).sum()) if len(gr) else 0,
                    "lanes": lanes[:3],
                })
            groups.sort(key=lambda x: -x["n"])
            return {"total": total, "groups": groups[:max_groups]}

        # Full down × distance-to-sticks × play-type cross product so every filter combination
        # in the modal resolves to real plays (down, distance, and play-type all co-exist in the
        # pbp). Empty leaf/branch nodes are pruned so the lazy sidecar stays lean; the app fills
        # any missing combination with an empty node at render time.
        down_specs = [("all", None), ("1", 1), ("2", 2), ("3", 3), ("4", 4)]
        dist_specs = [("all", None), ("short", (1, 3)), ("med", (4, 7)), ("long", (8, 99))]
        type_specs = [("all", None), ("pa", "is_play_action"),
                  ("motion", "is_motion"), ("nohuddle", "is_no_huddle"),
                  ("redzone", "is_red_zone")]

        def _nonempty(node):
            return node.get("total", 0) > 0 and len(node.get("groups", [])) > 0

        views = {}
        any_node = False
        for dkey, dval in down_specs:
            dsub = dt if dval is None else dt[dt["down"] == dval]
            if not len(dsub):
                continue
            dist_map = {}
            for diskey, drange in dist_specs:
                if drange is None:
                    ds2 = dsub
                else:
                    lo, hi = drange
                    ds2 = dsub[(dsub["ydstogo"] >= lo) & (dsub["ydstogo"] <= hi)]
                if not len(ds2):
                    continue
                type_map = {}
                for tkey, tcol in type_specs:
                    tsub = ds2 if tcol is None else ds2[ds2[tcol] == True]  # noqa: E712
                    node = summarize(tsub)
                    if _nonempty(node):
                        type_map[tkey] = node
                        any_node = True
                if type_map:
                    dist_map[diskey] = type_map
            if dist_map:
                views[dkey] = dist_map
        if not any_node:
            continue
        out[team] = {
            "team": team,
            "slots": {k: str(v) for k, v in slots.items()},
            "names": names,
            "jerseys": jerseys,
            "formations": formation_table,
            "views": views,
        }
    return out

# ── Seed block builder (opt-in `--nflverse` addition, non-destructive) ────────
# Emits a parallel `nflverse` block shaped like the existing Sharp (team values/ranks) and
# Sumer (player values-list) tables, so the app can A/B them against the scraped originals.
# Only the high-fidelity columns validated against Sharp/Sumer are included.
_DEF_LOWER_BETTER = ["Yards Per Play", "Y/PL Last 5", "Points Per Drive",
                     "Explosive Play Rate", "Down Conversion Rate"]

def _shape_team(df, lower_better=()):
    cols = list(df.columns)
    ranks = {c: df[c].rank(ascending=(c in lower_better), method="min") for c in cols}
    teams = {}
    for code, row in df.iterrows():
        teams[code] = {
            "values": {c: (None if pd.isna(row[c]) else round(float(row[c]), 3)) for c in cols},
            "ranks": {c: (None if pd.isna(ranks[c][code]) else int(ranks[c][code])) for c in cols},
        }
    return {"columns": cols, "teams": teams}

def _shape_players(rows):
    if not rows:
        return {"columns": [], "players": {}}
    cols = list(next(iter(rows.values())).keys())
    return {"columns": cols, "players": {n: {"values": [r.get(c) for c in cols]} for n, r in rows.items()}}

# Which situational refinements each position table exposes. Coverage/pressure/PA are pass concepts
# (QB/WR/TE); RB gets box counts + downs/game-state. Per-down splits are granular (1st–4th).
_REF_PASS = REFINEMENTS                                  # downs + game-state + coverage/pressure/PA
_REF_RB = ["1st_down", "2nd_down", "3rd_down", "4th_down", "red_zone",
           "when_leading", "when_trailing", "non_garbage_time"] + REFINEMENTS_RB

def _players_with_refs(builder, season, refs):
    """Base player table plus a `refinements` sub-dict (one shaped table per situation).
    Empty refinements (e.g. play-action pre-2022 with no FTN data) are skipped."""
    base = _shape_players(builder(season))
    rdict = {}
    for r in refs:
        try:
            shaped = _shape_players(builder(season, refinement=r))
        except Exception:
            continue
        if shaped["players"]:
            rdict[r] = shaped
    if rdict:
        base["refinements"] = rdict
    return base

def build_team_block(season):
    """The Sharp-shaped team tables for one season (offense/defense/tendencies/pace/personnel/
    coverage/OL/def tendencies/defensive line). Returns (team, ext) — `ext` is the extended
    team frame the OL per-player enrichment also reads. Shared by the offseason seed build and
    the in-season sidecar, so the Advanced tab can show the season in progress."""
    off, dfn = team_metrics(season)
    ext = team_extended(season)
    cover, pers = coverage_personnel(season)
    # FTN charting tendencies (2022+): motion/PA/RPO/screen/trick/drop (offense) + blitz (defense).
    try:
        _, ftn_def = _ftn_team(season)
    except Exception:
        ftn_def = None
    # Richer personnel groupings (offense 11/12/21 + multi-RB; defense sub-package/nickel/dime+).
    try:
        off_pers, def_pers = personnel_groups(season)
    except Exception:
        off_pers, def_pers = None, None
    # Offensive tendencies: pbp (shotgun/no-huddle/air yards) + FTN (motion/PA/RPO/screen/trick/drop).
    tend_cols = ["Shotgun Rate", "NoHuddle Rate", "AirYards/Att", "Motion Rate", "Play Action Rate",
                 "RPO Rate", "Screen Rate", "Trick Play Rate", "Drop Rate"]
    tend_cols = [c for c in tend_cols if c in ext.columns]
    # O-Line split into two focused cards: pass protection and run blocking.
    ol_pass_cols = [
        "Overall Score", "Dropbacks", "Pass Score",
        "Pressure Rate", "Hit Rate", "Hurry Rate", "Blitz Rate", "No Blitz Pressure Rate",
        "Sack Rate", "Non-QB Sack Rate", "Pocket Time", "Last 5 Sacks Allowed", "Last 5 Sack Rate",
    ]
    ol_pass_cols = [c for c in ol_pass_cols if c in ext.columns]
    ol_run_cols = [
        "Overall Score", "Stuff Rate", "Explosive Run Rate", "Yards/Rush", "YBC/Rush", "YAC/Rush",
        "Rush 1D Rate", "Broken Tackle Rate", "ROE/Att", "8+ Box Rate", "Time to LOS",
    ]
    ol_run_cols = [c for c in ol_run_cols if c in ext.columns]
    # Personnel: base 3WR/multi-TE (coverage_personnel) + 11/12/21 + multi-RB grouping rates.
    if off_pers is not None:
        pers = pers.join(off_pers)
    pers_cols = ["11 Personnel", "12 Personnel", "13 Personnel", "21 Personnel", "3WR Rate", "Multi TE Rate", "Multi RB Rate"]
    pers_cols = [c for c in pers_cols if c in pers.columns]
    # Defensive tendencies: FTN blitz + personnel sub-package/nickel/dime+.
    dtend = None
    if ftn_def is not None and def_pers is not None:
        dtend = ftn_def.join(def_pers, how="outer")
    elif ftn_def is not None:
        dtend = ftn_def
    elif def_pers is not None:
        dtend = def_pers
    team = {
        "offense": _shape_team(off),
        "defense": _shape_team(dfn, lower_better=_DEF_LOWER_BETTER),
        "tendencies": _shape_team(ext[tend_cols], lower_better=["Drop Rate"]),
        "pace": _shape_team(team_pace(season), lower_better=["Sec/Play", "Sec/Play Last 5"]),
        "personnel": _shape_team(pers[pers_cols]),
        "coverage": _shape_team(cover),   # man/zone solid; MOFC/MOFO validated ρ≈0.8 vs Sharp
    }
    if ol_pass_cols:
        team["offensive_line_pass"] = _shape_team(
            ext[ol_pass_cols],
            lower_better=[
                "Pressure Rate", "Hit Rate", "Hurry Rate",
                "Sack Rate", "Non-QB Sack Rate",
                "No Blitz Pressure Rate", "Last 5 Sacks Allowed", "Last 5 Sack Rate",
            ],
        )
    if ol_run_cols:
        team["offensive_line_run"] = _shape_team(
            ext[ol_run_cols],
            lower_better=["Stuff Rate", "8+ Box Rate", "Time to LOS"],
        )
    if dtend is not None and len(dtend.columns):
        dt_cols = [c for c in ["Blitz Rate", "Sub Package Rate", "Nickel Rate", "Dime+ Rate"] if c in dtend.columns]
        team["def_tendencies"] = _shape_team(dtend[dt_cols])
    # Defensive pass-rush / run-defense line (PFR def + pbp + FTN proxy). Higher pressure/stuff =
    # better defense (default rank); fewer missed tackles is better (lower_better).
    try:
        dl = team_defense_line(season)
        if len(dl.columns):
            team["defensive_line"] = _shape_team(dl, lower_better=["Missed Tackles"])
    except Exception as e:
        print(f"  (skipped defensive line: {type(e).__name__})")
    return team, ext


def build_player_tables(season):
    """Sumer-shaped per-player tables (+ situational refinements) for one season."""
    return {
        "QB": _players_with_refs(sumer_qb, season, _REF_PASS),
        "RB": _players_with_refs(sumer_rb, season, _REF_RB),
        "WR": _players_with_refs(sumer_wr, season, _REF_PASS),
        "TE": _players_with_refs(sumer_te, season, _REF_PASS),
    }


def build_nflverse_season(season):
    """Full nflverse block for one season: Sharp-shaped team tables + Sumer-shaped player tables
    (each with situational `refinements`)."""
    team, ext = build_team_block(season)
    ol_pass_cols = [c for c in [
        "Overall Score", "Dropbacks", "Pass Score",
        "Pressure Rate", "Hit Rate", "Hurry Rate", "Blitz Rate", "No Blitz Pressure Rate",
        "Sack Rate", "Non-QB Sack Rate", "Pocket Time", "Last 5 Sacks Allowed", "Last 5 Sack Rate",
    ] if c in ext.columns]
    ol_run_cols = [c for c in [
        "Overall Score", "Stuff Rate", "Explosive Run Rate", "Yards/Rush", "YBC/Rush", "YAC/Rush",
        "Rush 1D Rate", "Broken Tackle Rate", "ROE/Att", "8+ Box Rate", "Time to LOS",
    ] if c in ext.columns]
    players = {
        "QB": _players_with_refs(sumer_qb, season, _REF_PASS),
        "RB": _players_with_refs(sumer_rb, season, _REF_RB),
        "WR": _players_with_refs(sumer_wr, season, _REF_PASS),
        "TE": _players_with_refs(sumer_te, season, _REF_PASS),
    }
    starter_map = _ol_grades_by_team(season)
    starter_names = {
        tm: {v.get("name") for _, v in slots.items() if isinstance(v, dict) and v.get("name")}
        for tm, slots in starter_map.items()
    }
    util_map = ext["Pass Rate"].to_dict() if "Pass Rate" in ext.columns else {}
    # Player contextual enrichment uses the full OL feature set available in this season.
    ol_ctx_cols = list(dict.fromkeys(ol_pass_cols + ol_run_cols))
    ol_ctx = ext[ol_ctx_cols].to_dict("index") if ol_ctx_cols else {}
    snap_pct_map = _ol_snap_pct_by_player(season)

    return {
        "team": team,
        "players": players,
        "routes": route_trees(season),
        "qb_passing": qb_passing_zones(season),
        "qb_charting": qb_charting(season),
        "rb_fan": rb_rushing_fans(season),
        "ol_weekly": ol_weekly_team(season),
        "adv_weekly": adv_weekly_team(season),
        "ol_players": _ol_grades_by_player(
            season=season,
            utilization_by_team=util_map,
            team_ol_context=ol_ctx,
            starters_by_team=starter_names,
            player_snap_pct_by_team=snap_pct_map,
        ),
        "def_weekly": defensive_weekly_players(season),
        "coaching_scheme": coaching_scheme(season),
        # Season-level team head coaches derived from nflverse pbp (REG games).
        # This is historical truth for that season and powers season-aware HC context in UI.
        "head_coaches": season_head_coaches(season),
        # Season rosters: who each team actually had that year. Small enough (~100KB/season)
        # to ride inline rather than needing a lazy sidecar like the two blocks above.
        "rosters": team_rosters(season),
    }

def _nflverse_built_cache_path(seasons):
    """Path for cached built nflverse output, keyed by requested seasons AND this
    module's own bytes. The schema tag used to be bumped by hand, which meant a
    new builder (qb_charting, 2026-09-02) silently never ran: the old cache hit
    forever. Hashing the source makes the cache self-invalidating on any code
    change — the autonomous behaviour, at the cost of one rebuild per edit."""
    try:
        with open(os.path.abspath(__file__), "rb") as _f:
            src_digest = hashlib.md5(_f.read()).hexdigest()
    except Exception:
        src_digest = "unknown"
    payload = {"seasons": [str(s) for s in seasons], "schema": "nflverse_seed_v8_hc_history",
               "builder": src_digest}
    digest = hashlib.md5(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return os.path.join(_nflverse_cache_subdir("built"), f"{digest}.json")


def season_head_coaches(season):
    """Return season head coach by team from nflverse pbp.

    Output shape: {TEAM: "Coach Name"}. Uses REG games only and collapses to one coach per
    team by game-level frequency (supports mid-season changes while still picking primary coach).
    """
    try:
        df = _load_pbp(season, cols=["game_id", "season_type", "home_team", "away_team", "home_coach", "away_coach"])
    except Exception:
        return {}
    if df is None or df.empty:
        return {}

    reg = df[df["season_type"] == "REG"].copy()
    if reg.empty:
        return {}

    # One record per game/team side (coach repeats on every play).
    home = reg[["game_id", "home_team", "home_coach"]].dropna(subset=["home_team", "home_coach"]).drop_duplicates()
    home = home.rename(columns={"home_team": "team", "home_coach": "coach"})
    away = reg[["game_id", "away_team", "away_coach"]].dropna(subset=["away_team", "away_coach"]).drop_duplicates()
    away = away.rename(columns={"away_team": "team", "away_coach": "coach"})
    g = pd.concat([home, away], ignore_index=True)
    if g.empty:
        return {}

    g["team"] = g["team"].astype(str).str.upper().map(lambda t: NFLVERSE_TO_SEED.get(t, t))
    g["coach"] = g["coach"].astype(str).str.strip()
    g = g[(g["team"] != "") & (g["coach"] != "")]
    if g.empty:
        return {}

    out = {}
    for tm, grp in g.groupby("team"):
        vc = grp["coach"].value_counts()
        if vc.empty:
            continue
        top_n = int(vc.iloc[0])
        tied = sorted([nm for nm, n in vc.items() if int(n) == top_n])
        out[str(tm)] = tied[0] if tied else str(vc.index[0])
    return out


def build_nflverse(seasons, refresh=False):
    """Build the additive nflverse block for the given seasons (skips failures gracefully).

    Reuses a cached built output unless `refresh=True`.
    """
    if not HAVE_PANDAS:
        return {}

    cache_path = _nflverse_built_cache_path(seasons)
    if not refresh and os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                cached = json.load(f)
            print(f"    → nflverse built cache: hit ({os.path.basename(cache_path)})")
            return cached if isinstance(cached, dict) else {}
        except Exception:
            pass

    # Only needed on a cache miss (or refresh): derive OL grades once, then load from the CSV
    # cache for both rb_fan line cards and OL player-card payloads.
    _ensure_ol_grades_cache(seasons, refresh=refresh)

    out = {}
    for s in seasons:
        try:
            out[str(s)] = build_nflverse_season(int(s))
            print(f"    → nflverse {s}: ok")
        except Exception as e:
            print(f"    → nflverse {s}: FAILED ({type(e).__name__}: {e})")
    # A build with a failed season (a 502 from nflverse, a half-published file) must not be
    # cached: every later build would silently inherit the hole until someone --refresh'd.
    if len(out) == len(seasons):
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(out, f, separators=(",", ":"))
        except Exception:
            pass
    else:
        print(f"    → nflverse: {len(seasons)-len(out)} season(s) failed — not caching this build")
    return out

# ── Comparison against the baked Sharp tables ────────────────────────────────
def _spearman(a, b):
    """Rank correlation without scipy: Pearson on the rank vectors."""
    ra = pd.Series(a).rank(); rb = pd.Series(b).rank()
    return ra.corr(rb)

def compare(season):
    off, dfn = team_metrics(season)
    seed = json.load(open("triplecrown_seed.json"))
    sharp = seed.get("sharp", {})
    sseason = seed.get("sharp_season")
    print(f"\nComputed nflverse season: {season}  |  seed Sharp season: {sseason}")
    if str(sseason) != str(season):
        print("  ⚠ seasons differ — compare ranks with that in mind.")
    for tbl_key, comp, label, higher_better in [
        ("offense", off, "OFFENSE", True),
        ("defensive", dfn, "DEFENSE (allowed)", False),
    ]:
        tbl = sharp.get(tbl_key)
        if not tbl:
            continue
        teams = tbl["teams"]
        cols = comp.columns.tolist()
        print(f"\n══════════ {label} — nflverse vs Sharp ({tbl_key}) ══════════")
        # Build aligned frames on the intersection of teams
        codes = [c for c in comp.index if c in teams]
        for col in cols:
            ours = {c: comp.loc[c, col] for c in codes}
            # Sharp column name may differ slightly for defense ("Yards Per Play Allowed" etc.)
            scol = col
            if col not in tbl["columns"]:
                # try the "Allowed" variant
                cand = [x for x in tbl["columns"] if x.startswith(col.split(" Last")[0])]
                scol = cand[0] if cand else None
            if not scol or scol not in tbl["columns"]:
                print(f"  {col:22} — no matching Sharp column")
                continue
            theirs = {c: teams[c]["values"].get(scol) for c in codes if teams[c]["values"].get(scol) is not None}
            common = [c for c in codes if c in theirs]
            if len(common) < 10:
                print(f"  {col:22} — too few overlapping teams")
                continue
            rho = _spearman([ours[c] for c in common], [theirs[c] for c in common])
            print(f"  {col:22} rank ρ = {rho:+.2f}")
    # Spot check: top-5 offenses by our EPA vs Sharp EPA rank
    print("\n── Spot check: our EPA/Play leaders vs Sharp EPA/Play rank ──")
    seed_off = sharp.get("offense", {}).get("teams", {})
    top = off.sort_values("EPA/Play", ascending=False).head(8)
    for code, row in top.iterrows():
        srank = seed_off.get(code, {}).get("ranks", {}).get("EPA/Play")
        sval = seed_off.get(code, {}).get("values", {}).get("EPA/Play")
        print(f"  {code}: ours EPA/Play {row['EPA/Play']:+.3f}  |  Sharp value {sval}  rank {srank}")

    # ── Extended tables: O-Line / Tendencies / Pace ──
    ext = team_extended(season)
    print("\n══════════ EXTENDED (O-Line / Tendencies / Pace) — nflverse vs Sharp ══════════")
    for tbl_key in ["offensive_line", "tendencies", "pace"]:
        tbl = sharp.get(tbl_key)
        if not tbl:
            continue
        teams = tbl["teams"]
        print(f"\n  [{tbl_key}] Sharp cols: {tbl['columns']}")
        codes = [c for c in ext.index if c in teams]
        for col in ext.columns:
            if col not in tbl["columns"]:
                continue
            ours = {c: ext.loc[c, col] for c in codes if pd.notna(ext.loc[c, col])}
            theirs = {c: teams[c]["values"].get(col) for c in ours if teams[c]["values"].get(col) is not None}
            common = [c for c in ours if c in theirs]
            if len(common) < 10:
                continue
            rho = _spearman([ours[c] for c in common], [theirs[c] for c in common])
            # sample values for the first team
            c0 = common[0]
            print(f"    {col:28} rank ρ = {rho:+.2f}   e.g. {c0}: ours {ours[c0]} / Sharp {theirs[c0]}")

def _sumer_players(seed, season, pos):
    node = seed.get("sumer", {}).get(str(season), {}).get(pos, {})
    cols = node.get("columns", [])
    out = {}
    for name, row in node.get("players", {}).items():
        out[name] = dict(zip(cols, row["values"]))
    return out

def compare_sumer(season):
    seed = json.load(open("triplecrown_seed.json"))
    for pos, builder in [("QB", sumer_qb), ("RB", sumer_rb), ("WR", sumer_wr), ("TE", sumer_te)]:
        ours = builder(season)
        theirs = _sumer_players(seed, season, pos)
        common = [n for n in ours if n in theirs]
        print(f"\n══════════ SUMER {pos} — nflverse vs Sumer ({len(common)} players matched) ══════════")
        if not common:
            continue
        cols = [c for c in ours[common[0]] if c in next(iter(theirs.values()))]
        for col in cols:
            pairs = [(ours[n][col], theirs[n][col]) for n in common
                     if ours[n].get(col) is not None and theirs[n].get(col) is not None]
            if len(pairs) < 8:
                continue
            a = [p[0] for p in pairs]; b = [p[1] for p in pairs]
            rho = _spearman(a, b)
            mae = sum(abs(x - y) for x, y in pairs) / len(pairs)
            print(f"  {col:14} ρ={rho:+.2f}  MAE={mae:8.2f}")
        # spot check one well-known player
        for probe in ["josh allen", "lamar jackson", "drake maye", "saquon barkley", "bijan robinson"]:
            if probe in common:
                print(f"    e.g. {probe}: ours {ours[probe]} \n         Sumer {theirs[probe]}")
                break

def compare_participation(season):
    seed = json.load(open("triplecrown_seed.json"))
    sharp = seed.get("sharp", {})
    cover, pers = coverage_personnel(season)
    print("\n══════════ COVERAGE + PERSONNEL (participation) — nflverse vs Sharp ══════════")
    for tbl_key, comp in [("coverage_schemes", cover), ("personnel", pers)]:
        tbl = sharp.get(tbl_key)
        if not tbl:
            continue
        teams = tbl["teams"]
        print(f"\n  [{tbl_key}] Sharp cols: {tbl['columns']}")
        codes = [c for c in comp.index if c in teams]
        for col in comp.columns:
            if col not in tbl["columns"]:
                continue
            ours = {c: comp.loc[c, col] for c in codes if pd.notna(comp.loc[c, col])}
            theirs = {c: teams[c]["values"].get(col) for c in ours if teams[c]["values"].get(col) is not None}
            common = [c for c in ours if c in theirs]
            if len(common) < 10:
                continue
            rho = _spearman([ours[c] for c in common], [theirs[c] for c in common])
            c0 = common[0]
            print(f"    {col:16} rank ρ = {rho:+.2f}   e.g. {c0}: ours {ours[c0]} / Sharp {theirs[c0]}")

if __name__ == "__main__":
    if not HAVE_PANDAS:
        sys.exit("pandas not installed — this prototype needs it (the seed builder does not).")
    # Default = the most recent completed season (Jan/Feb still belong to the prior league year).
    import time as _time
    _now = _time.gmtime()
    season = int(sys.argv[1]) if len(sys.argv) > 1 else (_now.tm_year - 2 if _now.tm_mon < 3 else _now.tm_year - 1)
    mode = sys.argv[2] if len(sys.argv) > 2 else "all"
    if mode in ("all", "sharp"):
        compare(season)
    if mode in ("all", "sumer"):
        compare_sumer(season)
    if mode in ("all", "coverage"):
        compare_participation(season)



def team_rosters(season):
    """Per-team season roster from nflverse (players only — no trades/FA/draft context).

    Powers the Roster tab when viewing a completed season: what each team ACTUALLY had that
    year, rather than today's roster. Returns
      {TEAM: [[name, pos, jersey, yrs_exp, age, sleeper_id, status, snaps], ...]}
    grouped by position and ordered by SNAPS within each position — so the first player at a
    position is that season's real starter. This is better than a depth chart for a completed
    year: a depth chart is somebody's opinion, snap counts are what actually happened.

    Kept deliberately lean: rosters are 32 teams x ~60 players x 5 seasons, so an array-of-
    arrays (not dicts) with only the fields the view needs keeps this a small seed block.
    sleeper_id (not gsis) is carried because the app's hsURL()/pcardOnclick() resolve
    headshots and player cards from Sleeper ids.
    ACT (active) + RES (IR/reserve) only: CUT/DEV/practice-squad churn isn't "the roster".
    """
    try:
        r = _aux_csv(ROSTER_URL.format(season=season),
                     usecols=["season", "team", "position", "jersey_number", "status",
                              "full_name", "birth_date", "years_exp", "gsis_id", "sleeper_id"])
    except Exception:
        return {}
    if r is None or r.empty:
        return {}
    r = r[r["status"].isin(["ACT", "RES"])].copy()
    r = r.dropna(subset=["full_name", "team"])
    r = r.drop_duplicates(subset=["gsis_id", "team"])
    # Age as of Sept 1 of that season — the number a dynasty manager actually thinks in.
    ref = pd.Timestamp(f"{season}-09-01")
    bd = pd.to_datetime(r["birth_date"], errors="coerce")
    r["age"] = ((ref - bd).dt.days / 365.25).round(1)
    # Position sort order: offense skill first (the fantasy reader's eye), then the rest.
    # Season snap totals per player — the ordering signal that makes "starter" real.
    snaps_by_gsis = {}
    try:
        sn = _aux_parquet(SNAP_COUNTS_URL.format(season=season),
                          columns=["game_type", "pfr_player_id", "offense_snaps", "defense_snaps", "st_snaps"])
        sn = sn[sn["game_type"] == "REG"]
        p2g = _pfr_to_gsis_map()
        sn["gsis_id"] = sn["pfr_player_id"].astype(str).map(p2g)
        sn = sn.dropna(subset=["gsis_id"])
        sn["tot"] = (sn["offense_snaps"].fillna(0) + sn["defense_snaps"].fillna(0)).astype(int)
        snaps_by_gsis = sn.groupby("gsis_id")["tot"].sum().to_dict()
    except Exception:
        pass   # no snaps → fall back to jersey ordering below

    ORDER = {"QB": 0, "RB": 1, "FB": 2, "WR": 3, "TE": 4, "OL": 5, "T": 5, "G": 5, "C": 5,
             "DL": 6, "DE": 6, "DT": 6, "NT": 6, "LB": 7, "DB": 8, "CB": 8, "S": 8,
             "K": 9, "P": 9, "LS": 9}
    out = {}
    for team, grp in r.groupby("team"):
        tm = NFLVERSE_TO_SEED.get(str(team).upper(), str(team).upper())
        rows = []
        for _, x in grp.iterrows():
            pos = str(x["position"] or "").upper()
            gid = None if pd.isna(x["gsis_id"]) else str(x["gsis_id"])
            sid = None if pd.isna(x.get("sleeper_id")) else str(int(float(x["sleeper_id"])))
            rows.append([
                str(x["full_name"]),
                pos,
                None if pd.isna(x["jersey_number"]) else int(x["jersey_number"]),
                None if pd.isna(x["years_exp"]) else int(x["years_exp"]),
                None if pd.isna(x["age"]) else float(x["age"]),
                sid,
                str(x["status"]),
                int(snaps_by_gsis.get(gid, 0)),
            ])
        # position group, then snaps DESC (starter first), then jersey as a stable tiebreak
        rows.sort(key=lambda z: (ORDER.get(z[1], 10), -z[7], z[2] if z[2] is not None else 999))
        if rows:
            out[tm] = rows
    return out
