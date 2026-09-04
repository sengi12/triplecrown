"""TC proprietary veteran projections — the model's math and its data plumbing.

Predicts NEXT-season PPR fantasy points per game for every veteran with an NFL season
on tape, from the season he just played: prior production, opportunity (target share,
WOPR, carries), ffopportunity expected points (XFP), TD-over-expected (the luck that
regresses), age, and where he'll actually play next year (team change + how much
opportunity vacated that roster). Recipe validated era-split (train targets ≤2022,
test 2023-25) against a regressed-repeat-FPG baseline before it was frozen:
RB +0.05 / WR +0.08 / TE +0.04 / QB +0.13 test R² over that baseline.

The frozen artifacts live in tc_proj_model.json next to this file (same documented-JSON
pattern as ol_model.json and the cfb prospect model): scoring here is pure math over
that file — no sklearn, and no pandas until build_tc_projections() actually runs.
Output is keyed by Sleeper player_id so build_seed.py can attach it with zero joins.
"""
import os, json, gzip, urllib.request

CACHE_DIR = os.path.join("cache", "tcproj")
STATS_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv.gz"
STATS_URL_LEGACY = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_{season}.csv.gz"
EP_URL = "https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_{season}.parquet"
CONTRACTS_URL = "https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet"
SCHED_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"
NV_PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"

# Sanity floor: if the pipeline scores fewer players than this, something upstream broke
# (schema change, empty download) and the caller should treat the build as failed rather
# than ship a seed that silently lost the model.
MIN_SCORED = 200

_MODEL = None
def _model():
    """Frozen artifacts, lazily loaded; _-prefixed keys are documentation."""
    global _MODEL
    if _MODEL is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tc_proj_model.json")
        with open(path) as f:
            _MODEL = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    return _MODEL


def score_features(pos, feats):
    """Pure-math scoring: predicted next-season PPR FPG from a feature dict.
    Missing/None features impute to the training median. Unmodeled position -> None."""
    m = _model().get(pos)
    if not m:
        return None
    s = m["intercept"]
    for f in m["features"]:
        x = feats.get(f)
        if x is None or x != x:  # None or NaN
            x = m["median"][f]
        s += m["coef"][f] * (x - m["mean"][f]) / m["sd"][f]
    return max(0.0, min(30.0, float(s)))


def score_rookie(pos, pick, age=None, prob=None):
    """Rookie-season projection (PPR total / 17, bust risk priced in) from draft capital,
    draft age and — where it validated — the cfb prospect model's hit probability.
    Pure math over the frozen ROOKIE block; unmodeled position -> None."""
    import math
    blk = _model().get("ROOKIE", {}).get(pos)
    if not blk or pick is None:
        return None
    feats = {"log_pick": math.log2(min(max(float(pick), 1), 300)), "age": age, "prob": prob}
    s = blk["intercept"]
    for f in blk["features"]:
        x = feats.get(f)
        if x is None or x != x:
            x = blk["median"][f]
        s += blk["coef"][f] * (x - blk["mean"][f]) / blk["sd"][f]
    return max(0.0, min(30.0, float(s)))


def baseline_ppr_fpg(row):
    """PPR FPG implied by a seed player's Sleeper-baseline stat line (season totals).
    The card shows this next to the model so both numbers share one scoring basis."""
    pts = ((row.get("passing_yards") or 0) * 0.04 + (row.get("passing_touchdowns") or 0) * 4
           - (row.get("interceptions_thrown") or 0)
           + (row.get("rushing_yards") or 0) * 0.1 + (row.get("rushing_tds") or 0) * 6
           + (row.get("receptions") or 0) + (row.get("receiving_yards") or 0) * 0.1
           + (row.get("receiving_tds") or 0) * 6)
    if not pts:
        return None
    gp = row.get("games_played") or 17
    return round(pts / max(1, min(gp, 17)), 1)


# ── name matching (Sleeper full_name vs nflverse display name) ──────────────────────────
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

def _name_tokens(n):
    toks = ["".join(ch for ch in t.lower() if ch.isalpha()) for t in (n or "").split()]
    return [t for t in toks if t and t not in _SUFFIXES]

def _norm_name(n):
    return "".join(_name_tokens(n))

def _fuzz_name(n):
    """First-3-letters + surname: 'Josh Palmer' and 'Joshua Palmer' collide on purpose."""
    toks = _name_tokens(n)
    return (toks[0][:3] + toks[-1]) if len(toks) >= 2 else "".join(toks)


def _cached_download(url, name, refresh):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, name)
    if not refresh and os.path.exists(path) and os.path.getsize(path) > 1024:
        return path
    req = urllib.request.Request(url, headers={"User-Agent": "triplecrown-seed"})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def _weekly_frame(season, refresh):
    """One season of nflverse weekly player stats, schema-harmonized (2025+ renamed
    recent_team->team and interceptions->passing_interceptions; we only read the stable
    columns). Tries the current stats_player release first, then the legacy tag."""
    import pandas as pd
    name = f"stats_player_week_{season}.csv.gz"
    try:
        path = _cached_download(STATS_URL.format(season=season), name, refresh)
        df = pd.read_csv(path, low_memory=False)
    except Exception:
        path = _cached_download(STATS_URL_LEGACY.format(season=season), name, refresh)
        df = pd.read_csv(path, low_memory=False)
    if "recent_team" in df.columns and "team" not in df.columns:
        df = df.rename(columns={"recent_team": "team"})
    return df[(df.season_type == "REG") & df.position.isin(["QB", "RB", "WR", "TE"])]


def build_tc_projections(season, players_raw, refresh=False):
    """season = the projection season (e.g. 2026); features come from season-1 (+season-2
    for the two-year blend). players_raw = the raw Sleeper player DB (current teams,
    birth dates, gsis ids). Returns {sleeper_player_id: {"fpg": float, "in": {...}}}."""
    import pandas as pd, numpy as np

    prior, prev = season - 1, season - 2
    wk = _weekly_frame(prior, refresh)
    wkp = _weekly_frame(prev, refresh)

    # Career peak FPG (QB feature, v1.2): best season (>=8 games) since 2010 — uncensored
    # for every active player, matching the 1999+-trained semantics. One small cached
    # download per season; only three columns are kept so the sweep stays light.
    peaks = {}
    for yr in range(2010, prior + 1):
        try:
            f = wk if yr == prior else (wkp if yr == prev else _weekly_frame(yr, refresh))
            s = f.groupby("player_id").agg(g=("week", "count"), ppr=("fantasy_points_ppr", "sum"))
            s = s[s.g >= 8]
            for pid, r in s.iterrows():
                v = r.ppr / r.g
                if v > peaks.get(pid, -1):
                    peaks[pid] = v
        except Exception:
            continue   # one missing historical season shouldn't sink the block

    def per_season(frame):
        agg = frame.groupby(["player_id", "position"]).agg(
            g=("week", "count"), ppr=("fantasy_points_ppr", "sum"),
            team=("team", lambda s: s.mode().iloc[0]),
            name=("player_display_name", "first"),
            tgt=("targets", "sum"), car=("carries", "sum"),
            pa=("attempts", "sum"), py=("passing_yards", "sum"),
            rec_td=("receiving_tds", "sum"), ru_td=("rushing_tds", "sum"),
            ptd=("passing_tds", "sum"),
            tgt_sh=("target_share", "mean"), wopr=("wopr", "mean"),
        ).reset_index()
        agg["fpg"] = agg.ppr / agg.g.clip(lower=1)
        agg["tgt_g"] = agg.tgt / agg.g.clip(lower=1)
        agg["car_g"] = agg.car / agg.g.clip(lower=1)
        agg["pa_g"] = agg.pa / agg.g.clip(lower=1)
        agg["py_g"] = agg.py / agg.g.clip(lower=1)
        agg["opps_g"] = (agg.tgt + agg.car) / agg.g.clip(lower=1)
        return agg

    cur = per_season(wk)

    # XFP / expected TDs (ffopportunity), prior season only
    ep_path = _cached_download(EP_URL.format(season=prior), f"ep_weekly_{prior}.parquet", refresh)
    ep = pd.read_parquet(ep_path, columns=["week", "player_id", "total_fantasy_points",
                                           "total_fantasy_points_exp", "total_touchdown_exp"])
    epa = ep.groupby("player_id").agg(
        ep_g=("week", "count"), xfp=("total_fantasy_points_exp", "sum"),
        afp=("total_fantasy_points", "sum"), exp_td=("total_touchdown_exp", "sum")).reset_index()
    epa["xfpg"] = epa.xfp / epa.ep_g.clip(lower=1)
    epa["fpoe_g"] = (epa.afp - epa.xfp) / epa.ep_g.clip(lower=1)
    cur = cur.merge(epa[["player_id", "xfpg", "fpoe_g", "exp_td"]], on="player_id", how="left")
    # v1.6: ALL touchdowns vs ALL expected touchdowns — total_touchdown_exp includes passing
    # for QBs, so the actual side must too (the old rec+rush-only construction made every QB
    # ~-20 "unlucky" and the term an accidental passing-volume proxy).
    cur["td_oe"] = (cur.ptd.fillna(0) + cur.rec_td + cur.ru_td) - cur.exp_td
    # v1.6 QB feature: expected total TDs per game, same denominator as the training set (games played)
    cur["exp_td_g"] = cur.exp_td / cur.g.clip(lower=1)

    # two-year blend — GAMES-WEIGHTED (v1.1): a 17-game season out-votes an 8-game one
    # whichever year it was, so an injury-shortened season defers to the healthy one.
    prev_fpg = per_season(wkp)[["player_id", "fpg", "g"]].rename(columns={"fpg": "fpg_prev2", "g": "g_prev2"})
    cur = cur.merge(prev_fpg, on="player_id", how="left")
    cur["fpg_2yr"] = np.where(cur.fpg_prev2.notna(),
                              (cur.g * cur.fpg + cur.g_prev2 * cur.fpg_prev2) / (cur.g + cur.g_prev2),
                              cur.fpg)

    # Sleeper join: current team, birth year, sleeper id — gsis first, then name(+fuzzy)
    by_gsis, by_name, by_fuzz = {}, {}, {}
    for spid, v in (players_raw or {}).items():
        if not isinstance(v, dict) or v.get("position") not in ("QB", "RB", "WR", "TE"):
            continue
        by = None
        bd = v.get("birth_date")
        if isinstance(bd, str) and len(bd) >= 4 and bd[:4].isdigit():
            by = int(bd[:4])
        rec = {"sleeper_id": str(spid), "team_next": v.get("team"), "by": by}
        if v.get("gsis_id"):
            by_gsis[str(v["gsis_id"]).strip()] = rec
        by_name[(_norm_name(v.get("full_name")), v["position"])] = rec
        fk = (_fuzz_name(v.get("full_name")), v["position"])
        by_fuzz[fk] = None if fk in by_fuzz else rec  # ambiguous fuzzy keys are dropped

    def _link(r):
        return (by_gsis.get(str(r.player_id).strip())
                or by_name.get((_norm_name(r["name"]), r.position))
                or by_fuzz.get((_fuzz_name(r["name"]), r.position)) or {})

    linked = cur.apply(lambda r: pd.Series(_link(r), dtype=object), axis=1)
    for c in ("sleeper_id", "team_next", "by"):
        cur[c] = linked[c] if c in linked.columns else None
    cur["age"] = prior - pd.to_numeric(cur.by, errors="coerce")
    cur["team_next"] = cur.team_next.where(cur.team_next.notna(), cur.team)
    cur["team_changed"] = (cur.team_next != cur.team).astype(int)

    # destination context: how much of the NEXT team's prior-season opportunity departed
    opp = cur.groupby("team").apply(lambda x: (x.tgt + x.car).sum(), include_groups=False).rename("team_opp").reset_index()
    dep = cur[cur.team_changed == 1].groupby("team").apply(lambda x: (x.tgt + x.car).sum(), include_groups=False).rename("dep_opp").reset_index()
    vac = opp.merge(dep, on="team", how="left").fillna({"dep_opp": 0})
    vac["vacated_share"] = vac.dep_opp / vac.team_opp.clip(lower=1)
    vmap = dict(zip(vac.team, vac.vacated_share))
    cur["dest_vacated"] = cur.team_next.map(vmap)

    cur["peak_fpg"] = cur.player_id.map(peaks)
    cur["peak_fpg"] = cur[["peak_fpg", "fpg"]].max(axis=1)   # this season counts toward the peak too

    # Contract commitment (WR feature, v1.4): cap-relative APY of the deal active in the
    # projection season. Teams play who they pay. otc_id-linked via the nflverse players
    # master; fail-soft — a missing download leaves the column NaN and the scorer imputes.
    try:
        # PARQUET on purpose: the release's .csv.gz twin stopped updating in 2022 and a
        # stale money table flips this feature's value — see the _doc's v1_4_note.
        cpath = _cached_download(CONTRACTS_URL, "historical_contracts.parquet", refresh)
        ppath = _cached_download(NV_PLAYERS_URL, "nv_players.csv", refresh)
        cts = pd.read_parquet(cpath, columns=["position", "otc_id", "year_signed", "years", "apy_cap_pct"])
        cts = cts[cts.position.isin(["QB", "RB", "WR", "TE", "FB"])].dropna(subset=["otc_id", "year_signed"])
        nvp = pd.read_csv(ppath, low_memory=False, usecols=["gsis_id", "otc_id"]).dropna()
        cts = cts.merge(nvp.drop_duplicates("otc_id"), on="otc_id", how="inner")
        cts["end"] = cts.year_signed + cts.years.fillna(1) - 1
        act = cts[(cts.year_signed <= season) & (cts.end >= season)]
        act = act.sort_values("year_signed").groupby("gsis_id").tail(1)
        cur["apy_cap_pct"] = cur.player_id.map(act.set_index("gsis_id").apy_cap_pct)
    except Exception:
        cur["apy_cap_pct"] = np.nan

    # Team environment (v1.3): the statistical shadow of scheme/coaching — offensive volume,
    # pass rate and skill-position scoring per team game in the prior season, plus the
    # DESTINATION team's versions and deltas for movers (WR features; QB uses own-team only).
    env = wk.groupby("team").agg(pa=("attempts", "sum"), car=("carries", "sum"),
                                 ppr=("fantasy_points_ppr", "sum"),
                                 tg=("week", "nunique")).reset_index()
    env["env_plays"] = (env.pa + env.car) / env.tg.clip(lower=1)
    env["env_pass"] = env.pa / (env.pa + env.car).clip(lower=1)
    env["env_pts"] = env.ppr / env.tg.clip(lower=1)
    emap = env.set_index("team")[["env_plays", "env_pass", "env_pts"]]
    for c in ("env_plays", "env_pass", "env_pts"):
        cur[c] = cur.team.map(emap[c])
        cur["d" + c] = cur.team_next.map(emap[c])
        cur[c + "_d"] = cur["d" + c] - cur[c]

    # Schedule softness (v1.7; QB feature): the projection season's opponents are already
    # known (schedule formula), so average their prior-season PPR allowed per game to MY
    # position, z-scored within position. Fail-soft: no schedule -> NaN -> imputed median.
    try:
        spath = _cached_download(SCHED_URL, "games.csv", refresh)
        gsch = pd.read_csv(spath, usecols=["season", "game_type", "home_team", "away_team"])
        gsch = gsch[(gsch.game_type == "REG") & (gsch.season == season)]
        oppl = pd.concat([gsch.rename(columns={"home_team": "team", "away_team": "opp"})[["team", "opp"]],
                          gsch.rename(columns={"away_team": "team", "home_team": "opp"})[["team", "opp"]]])
        for c in ("team", "opp"):
            oppl[c] = oppl[c].replace({"OAK": "LV", "SD": "LAC", "STL": "LA"})
        dvp = wk.groupby(["opponent_team", "position"]).agg(allowed=("fantasy_points_ppr", "sum")).reset_index()
        dgames = wk.groupby("opponent_team").week.nunique().rename("dgames").reset_index()
        dvp = dvp.merge(dgames, on="opponent_team")
        dvp["allowed_g"] = dvp.allowed / dvp.dgames.clip(lower=1)
        dvp["z"] = dvp.groupby("position").allowed_g.transform(lambda x: (x - x.mean()) / x.std())
        posz = {(r.opponent_team, r.position): r.z for r in dvp.itertuples()}
        by_team = {t: list(g.opp) for t, g in oppl.groupby("team")}
        def _sos(r):
            vals = [posz.get((o, r.position)) for o in by_team.get(r.team_next, [])]
            vals = [v for v in vals if v is not None and v == v]
            return float(np.mean(vals)) if vals else np.nan
        cur["sos_pos"] = cur.apply(_sos, axis=1)
    except Exception:
        cur["sos_pos"] = np.nan

    out = {}
    feat_cols = ["fpg", "fpg_2yr", "tgt_sh", "wopr", "tgt_g", "car_g", "opps_g",
                 "pa_g", "py_g", "xfpg", "fpoe_g", "td_oe", "exp_td_g", "sos_pos", "age",
                 "team_changed", "dest_vacated", "g", "peak_fpg",
                 "env_plays", "env_pass", "env_pts",
                 "denv_plays", "denv_pass", "denv_pts",
                 "env_plays_d", "env_pass_d", "env_pts_d", "apy_cap_pct"]
    for _, r in cur.iterrows():
        if not r.sleeper_id:
            continue
        feats = {f: (None if pd.isna(r[f]) else float(r[f])) for f in feat_cols}
        fpg = score_features(r.position, feats)
        if fpg is None:
            continue
        out[str(r.sleeper_id)] = {
            "fpg": round(fpg, 1),
            # Compact inputs for the card's ⓘ: last season's line + the levers that moved
            # the number (all vs-{prior} season). Keys are short on purpose — this rides
            # inside every player object of the seed.
            "in": {"yr": prior, "g": int(r.g), "fpg": round(float(r.fpg), 1),
                   "xfpg": None if pd.isna(r.xfpg) else round(float(r.xfpg), 1),
                   "tdoe": None if pd.isna(r.td_oe) else round(float(r.td_oe), 1),
                   "age": None if pd.isna(r.age) else int(r.age),
                   "mv": int(r.team_changed),
                   "pk": None if pd.isna(r.peak_fpg) else round(float(r.peak_fpg), 1)},
        }
    if len(out) < MIN_SCORED:
        raise RuntimeError(f"tc projections scored only {len(out)} players (floor {MIN_SCORED}) — refusing")
    return out
