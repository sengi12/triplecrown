#!/usr/bin/env python3
"""
tendencies.py — play-calling tendencies under the situation, per team-season
─────────────────────────────────────────────────────────────────────────────
The Playbook shows what a team runs; this shows WHEN it calls what, and how much of that
an opponent could guess. The methods follow The Side Quest's coaching work (Michael
MacKelvie and Nick Gurol, thesidequest.com — "The Coaching Report Card"), re-derived here
from the public nflverse play-by-play and FTN charting the app already ingests:

  situations     the pass rate in each situation (down × distance, field zone, score
                 state, the fourth quarter) beside the league's, with EPA per play
  guessability   how often a defence that knew only the situation would guess the call
                 right — the league's situation rates give the baseline, the team's own
                 rates (shrunk toward the league's) give its number; the difference is
                 what the caller adds beyond the situation. Their finding: the best
                 play-callers are MORE guessable, not less, once the situation is held.
  sequencing     pass-after-pass vs pass-after-run (the streak lift), holding the same
                 formation snap to snap, no-huddle
  play action    the rate on early downs, EPA with and without, and the setup test —
                 play action after a run vs cold (their finding: cold works fine)
  motion         the rate, and EPA with and without it
  defence        blitz rate by situation, the blitz streak (blitz after a blitz vs after
                 none — callers run hot), what a blitz buys in pressure and EPA, box counts

Everything is a rate or an EPA on a stated sample; the league row sits beside every
team's so the card can say "3rd of 32" and mean it. Per-play inputs never ship.
"""
import math

try:
    import numpy as np
    import pandas as pd
    HAVE_PANDAS = True
except Exception:  # pragma: no cover
    np = pd = None
    HAVE_PANDAS = False

SCHEMA = "tendencies_v1"
SHRINK_K = 15          # plays of a team's own bucket that count as much as the league's rate
MIN_SITUATION_N = 8    # a situation with fewer plays prints no rate

PBP_COLS = [
    "game_id", "play_id", "posteam", "defteam", "week", "season_type", "play_type", "pass", "rush",
    "down", "ydstogo", "yardline_100", "score_differential", "qtr", "epa", "success",
    "qb_kneel", "qb_spike", "qb_hit", "sack", "shotgun", "fixed_drive",
]
FTN_COLS = ["nflverse_game_id", "nflverse_play_id", "is_motion", "is_play_action", "is_no_huddle",
            "qb_location", "n_blitzers", "n_defense_box"]


def _num(s):
    return pd.to_numeric(s, errors="coerce")


def _flag(s):
    """FTN booleans arrive as True/False, 'TRUE'/'FALSE', 1/0 or NaN."""
    if s is None:
        return None
    if s.dtype == bool:
        return s
    x = s.astype(str).str.strip().str.lower()
    out = x.map({"true": True, "false": False, "1": True, "0": False, "1.0": True, "0.0": False})
    return out.where(s.notna(), other=np.nan)


def _r(v, dp=1):
    try:
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        return round(float(v), dp)
    except Exception:
        return None


def _rate(mask_num, mask_den):
    n = int(mask_den.sum())
    return (_r(100.0 * mask_num[mask_den].mean(), 1) if n else None), n


def _epa(series):
    s = _num(series).dropna()
    return (_r(s.mean(), 3) if len(s) else None), int(len(s))


def prepare(d):
    """Scrimmage plays with the situation columns the tendencies read, in game order."""
    d = d.copy()
    d = d[d["play_type"].isin(["pass", "run"]) & d["posteam"].notna()]
    if "season_type" in d.columns:
        d = d[d["season_type"].fillna("REG") == "REG"]
    for c in ("qb_kneel", "qb_spike"):
        if c in d.columns:
            d = d[_num(d[c]).fillna(0) != 1]
    d = d[_num(d["down"]).notna()].copy()
    d["is_pass"] = _num(d["pass"]).fillna(0) == 1
    d["down_i"] = _num(d["down"]).astype(int).clip(1, 4)
    ytg = _num(d["ydstogo"]).fillna(10)
    d["dist"] = np.where(ytg <= 3, "short", np.where(ytg <= 7, "mid", "long"))
    y100 = _num(d["yardline_100"]).fillna(50)
    d["field"] = np.where(y100 <= 20, "rz", np.where(y100 >= 80, "own", "mid"))
    diff = _num(d["score_differential"]).fillna(0)
    d["score"] = np.where(diff <= -9, "trail", np.where(diff >= 9, "lead", "close"))
    d["late"] = _num(d["qtr"]).fillna(1) >= 4
    d["epa_n"] = _num(d["epa"])
    d["pressed"] = (_num(d.get("qb_hit", 0)).fillna(0) > 0) | (_num(d.get("sack", 0)).fillna(0) > 0)
    for c in ("is_motion", "is_play_action", "is_no_huddle"):
        d[c] = _flag(d[c]) if c in d.columns else np.nan
    d["blitz"] = (_num(d["n_blitzers"]) >= 1) if "n_blitzers" in d.columns else np.nan
    d["box"] = _num(d["n_defense_box"]) if "n_defense_box" in d.columns else np.nan
    d["qb_loc"] = d["qb_location"].astype(str).str.lower().where(d["qb_location"].notna(), None) if "qb_location" in d.columns else None
    d = d.sort_values(["game_id", "play_id"])
    # the previous scrimmage play of the same drive (None at a drive's first play)
    drive = d["fixed_drive"] if "fixed_drive" in d.columns else d["game_id"]
    key = d["game_id"].astype(str) + "|" + d["posteam"].astype(str) + "|" + drive.astype(str)
    same = key.eq(key.shift(1))
    d["prev_pass"] = d["is_pass"].shift(1).where(same, other=np.nan)
    d["prev_loc"] = d["qb_loc"].shift(1).where(same, other=None)
    # the defence's previous dropback of the game (for the blitz streak)
    return d


def _bucket(d):
    return (d["down_i"].astype(str) + "|" + d["dist"] + "|" + d["field"] + "|" + d["score"] + "|" + d["late"].astype(int).astype(str))


SITUATIONS = [
    ("1st", lambda d: d["down_i"] == 1),
    ("2nd & short", lambda d: (d["down_i"] == 2) & (d["dist"] == "short")),
    ("2nd & mid", lambda d: (d["down_i"] == 2) & (d["dist"] == "mid")),
    ("2nd & long", lambda d: (d["down_i"] == 2) & (d["dist"] == "long")),
    ("3rd & short", lambda d: (d["down_i"] == 3) & (d["dist"] == "short")),
    ("3rd & mid", lambda d: (d["down_i"] == 3) & (d["dist"] == "mid")),
    ("3rd & long", lambda d: (d["down_i"] == 3) & (d["dist"] == "long")),
    ("4th down", lambda d: d["down_i"] == 4),
    ("Backed up", lambda d: d["field"] == "own"),
    ("Red zone", lambda d: d["field"] == "rz"),
    ("Trailing 9+", lambda d: d["score"] == "trail"),
    ("Within 8", lambda d: d["score"] == "close"),
    ("Leading 9+", lambda d: d["score"] == "lead"),
    ("4th quarter", lambda d: d["late"]),
    ("Early downs, neutral", lambda d: (d["down_i"] <= 2) & (d["score"] == "close") & (~d["late"])),
]


def _offense(t, lg_rate, lg_bucket):
    """One offence's tendencies from its plays `t`; lg_bucket maps the fine bucket → league pass rate."""
    out = {"plays": int(len(t))}
    pr, _ = _rate(t["is_pass"], t["is_pass"].notna())
    out["pass_rate"] = pr
    # situations: team rate, league rate, EPA/play
    sit = {}
    for label, fn in SITUATIONS:
        m = fn(t)
        n = int(m.sum())
        team_rate = _r(100.0 * t.loc[m, "is_pass"].mean(), 1) if n >= MIN_SITUATION_N else None
        epa, _ = _epa(t.loc[m, "epa_n"]) if n >= MIN_SITUATION_N else (None, 0)
        sit[label] = {"n": n, "pass": team_rate, "lg": lg_rate.get(label), "epa": epa}
    out["situations"] = sit
    # guessability: the league's situation rates as the baseline; the team's own, shrunk
    b = _bucket(t)
    L = b.map(lg_bucket).fillna(lg_rate.get("all", 50.0) / 100.0)
    cnt = b.map(b.value_counts())
    T = b.map(t.groupby(b)["is_pass"].mean())
    p = (SHRINK_K * L + cnt * T) / (SHRINK_K + cnt)
    guess_lg = float(np.maximum(L, 1 - L).mean()) if len(t) else float("nan")
    guess_team = float(np.maximum(p, 1 - p).mean()) if len(t) else float("nan")
    naive = max(pr or 0, 100 - (pr or 0)) if pr is not None else None
    out["guess"] = {"situation": _r(100 * guess_lg, 1), "team": _r(100 * guess_team, 1),
                    "beyond": _r(100 * (guess_team - guess_lg), 1), "naive": _r(naive, 1)}
    # sequencing
    prev = t["prev_pass"].notna()
    pap, n_pp = _rate(t["is_pass"], prev & (t["prev_pass"] == 1))
    par, n_pr = _rate(t["is_pass"], prev & (t["prev_pass"] == 0))
    hold = None
    hm = t["prev_loc"].notna() & t["qb_loc"].notna() if "qb_loc" in t.columns else None
    if hm is not None and int(hm.sum()) >= MIN_SITUATION_N:
        hold = _r(100.0 * (t.loc[hm, "qb_loc"] == t.loc[hm, "prev_loc"]).mean(), 1)
    nh, _ = _rate(t["is_no_huddle"] == True, t["is_no_huddle"].notna())  # noqa: E712
    out["sequencing"] = {"pass_after_pass": pap, "pass_after_run": par, "n_after_pass": n_pp, "n_after_run": n_pr,
                         "streak_lift": (_r(pap - par, 1) if pap is not None and par is not None else None),
                         "formation_hold": hold, "no_huddle": nh}
    # play action
    db = t["is_pass"]
    pa = t["is_play_action"] == True  # noqa: E712
    charted = t["is_play_action"].notna()
    early = (t["down_i"] <= 2) & (~t["late"])
    pa_rate, n_early = _rate(pa, db & charted & early)
    epa_pa, n_pa = _epa(t.loc[db & pa, "epa_n"])
    epa_nopa, n_nopa = _epa(t.loc[db & charted & ~pa, "epa_n"])
    after_run = t["prev_pass"] == 0
    cold = t["prev_pass"].isna() | (t["prev_pass"] == 1)
    epa_pa_run, n_pa_run = _epa(t.loc[db & pa & after_run, "epa_n"])
    epa_pa_cold, n_pa_cold = _epa(t.loc[db & pa & cold, "epa_n"])
    out["play_action"] = {"rate_early": pa_rate, "n_early": n_early, "epa": epa_pa, "n": n_pa,
                          "epa_without": epa_nopa, "n_without": n_nopa,
                          "epa_after_run": epa_pa_run, "n_after_run": n_pa_run,
                          "epa_cold": epa_pa_cold, "n_cold": n_pa_cold}
    # motion
    mo = t["is_motion"] == True  # noqa: E712
    mch = t["is_motion"].notna()
    mo_rate, n_m = _rate(mo, mch)
    e_mo, n_mo = _epa(t.loc[mch & mo, "epa_n"])
    e_nomo, n_nomo = _epa(t.loc[mch & ~mo, "epa_n"])
    e_mo_p, _ = _epa(t.loc[mch & mo & db, "epa_n"])
    e_nomo_p, _ = _epa(t.loc[mch & ~mo & db, "epa_n"])
    out["motion"] = {"rate": mo_rate, "n": n_m, "epa": e_mo, "n_with": n_mo, "epa_without": e_nomo, "n_without": n_nomo,
                     "epa_pass": e_mo_p, "epa_pass_without": e_nomo_p}
    return out


def _defense(t):
    """One defence's habits from the plays it faced `t` (posteam is the opponent)."""
    out = {"plays": int(len(t))}
    db = t["is_pass"]
    bl = t["blitz"] == True  # noqa: E712
    ch = t["blitz"].notna()
    rate, n = _rate(bl, db & ch)
    out["blitz"] = {"rate": rate, "n": n}
    for label, m in (("3rd & long", (t["down_i"] == 3) & (t["dist"] == "long")), ("Red zone", t["field"] == "rz"),
                     ("Trailing 9+", t["score"] == "trail"), ("Leading 9+", t["score"] == "lead"), ("1st down", t["down_i"] == 1)):
        r, nn = _rate(bl, db & ch & m)
        out["blitz"][label] = {"rate": (r if nn >= MIN_SITUATION_N else None), "n": nn}
    # the streak: this dropback's blitz given the defence's previous dropback of the game
    x = t[db & ch].copy()
    x = x.sort_values(["game_id", "play_id"])
    same = x["game_id"].eq(x["game_id"].shift(1))
    prev = x["blitz"].shift(1).where(same, other=np.nan)
    after_b, n_ab = _rate(x["blitz"] == True, prev == True)  # noqa: E712
    after_n, n_an = _rate(x["blitz"] == True, prev == False)  # noqa: E712
    out["blitz"]["after_blitz"] = after_b
    out["blitz"]["after_none"] = after_n
    out["blitz"]["streak_lift"] = (_r(after_b - after_n, 1) if after_b is not None and after_n is not None else None)
    out["blitz"]["n_after_blitz"] = n_ab
    out["blitz"]["n_after_none"] = n_an
    # what a blitz buys
    p_b, _ = _rate(t["pressed"], db & ch & bl)
    p_n, _ = _rate(t["pressed"], db & ch & ~bl)
    e_b, n_eb = _epa(t.loc[db & ch & bl, "epa_n"])
    e_n, n_en = _epa(t.loc[db & ch & ~bl, "epa_n"])
    out["blitz"]["pressure_with"] = p_b
    out["blitz"]["pressure_without"] = p_n
    out["blitz"]["epa_with"] = e_b
    out["blitz"]["epa_without"] = e_n
    # box counts against the run
    runs = ~db
    boxed = t["box"].notna()
    light, n_l = _rate(t["box"] <= 6, runs & boxed)
    heavy, n_h = _rate(t["box"] >= 8, runs & boxed)
    e_light, _ = _epa(t.loc[runs & boxed & (t["box"] <= 6), "epa_n"])
    e_heavy, _ = _epa(t.loc[runs & boxed & (t["box"] >= 8), "epa_n"])
    out["box"] = {"light": light, "heavy": heavy, "n": n_l, "epa_light": e_light, "epa_heavy": e_heavy}
    return out


def tendencies_from_frame(d):
    """{"schema", "teams": {TEAM: {"offense": …, "defense": …}}, "league": {"offense", "defense"}, "n_teams"}"""
    d = prepare(d)
    if d.empty:
        return {"schema": SCHEMA, "teams": {}, "league": {}, "n_teams": 0, "has_ftn": False}
    has_ftn = bool(d["is_motion"].notna().any() or d["blitz"].notna().any())
    lg_rate = {label: _r(100.0 * d.loc[fn(d), "is_pass"].mean(), 1) for label, fn in SITUATIONS}
    lg_rate["all"] = _r(100.0 * d["is_pass"].mean(), 1)
    b = _bucket(d)
    lg_bucket = d.groupby(b)["is_pass"].mean().to_dict()
    teams = {}
    for tm, t in d.groupby("posteam"):
        teams.setdefault(str(tm), {})["offense"] = _offense(t, lg_rate, lg_bucket)
    for tm, t in d.groupby("defteam"):
        if pd.isna(tm):
            continue
        teams.setdefault(str(tm), {})["defense"] = _defense(t)
    league = {"offense": _offense(d, lg_rate, lg_bucket), "defense": _defense(d)}
    return {"schema": SCHEMA, "teams": teams, "league": league, "n_teams": len(teams), "has_ftn": has_ftn}


def build_tendencies(season):
    """The season's tendencies from nflverse play-by-play + FTN charting (fail-soft on FTN)."""
    from . import nflverse as _nfl
    pbp = _nfl._load_pbp(season, PBP_COLS)
    pbp = pbp[pbp["play_type"].isin(["pass", "run"]) & pbp["posteam"].notna()].copy()
    if pbp.empty:
        return {"schema": SCHEMA, "teams": {}, "league": {}, "n_teams": 0, "has_ftn": False}
    try:
        ftn = _nfl._aux_csv(_nfl.FTN_URL.format(season=season), usecols=FTN_COLS)
        d = pbp.merge(ftn, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "nflverse_play_id"], how="left")
    except Exception:
        d = pbp
    for c in ("posteam", "defteam"):
        d[c] = d[c].replace(_nfl.NFLVERSE_TO_SEED)
    return tendencies_from_frame(d)
