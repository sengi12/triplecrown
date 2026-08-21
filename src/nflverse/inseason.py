#!/usr/bin/env python3
"""
inseason.py — the small weekly sidecar for the season IN PROGRESS.
─────────────────────────────────────────────────────────────────────────────
Everything else nflverse-shaped in the seed describes completed seasons and is
rebuilt on the offseason cadence. This module builds the one block that must
move during the season — weekly team aggregates, per-player weekly usage, and
defense-vs-position allowances — from the current season's play-by-play, plus
the full-season schedule (future opponents included) for matchup context.

Design constraints:
  * SMALL. The payload ships to phones weekly; raw components only, rounded,
    column-packed. The client computes rates/ranks/fantasy points itself, so
    league scoring is always respected.
  * Fail-soft. Any missing upstream (early September, nflverse lag) returns {}
    and the seed build carries on — same contract as the nflverse/cfb blocks.
  * Players are keyed by GSIS id with a normalized name+pos fallback; the app
    resolves GSIS → Sleeper id through the Sleeper player DB's gsis_id field.

Payload shape (v1):
  { "v": 1, "season": 2026, "weeks": [1..N], "asof": iso-utc,
    "adv_weekly": {"<season>": <adv_weekly_team block>},         # reused verbatim
    "player_weekly": {"cols": [...], "players": {gsis: {"n": name, "p": pos,
        "t": team, "w": {"<week>": [...]}}}},
    "def_vs_pos": {"cols": [...], "teams": {CODE: {"QB"|"RB"|"WR"|"TE":
        {"<week>": [...]}}}},
    "schedule": {CODE: {"<week>": "OPP"}} }
"""
import time

try:
    import pandas as pd
    HAVE_PANDAS = True
except Exception:  # pragma: no cover — builder degrades to an empty block
    HAVE_PANDAS = False

from . import nflverse as _nfl

NFLDATA_GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"

# Per-player weekly columns (raw counts; the app derives shares/rates).
PLAYER_WEEK_COLS = ["tgt", "rec", "rec_yd", "rec_td", "air_yd",
                    "carry", "rush_yd", "rush_td",
                    "pass_att", "pass_yd", "pass_td", "pass_int",
                    "epa_touch", "team_tgt"]
# Defense-vs-position weekly columns — enough to score fantasy points allowed
# under any league's settings client-side.
DVP_COLS = ["tgt", "rec", "rec_yd", "rec_td",
            "carry", "rush_yd", "rush_td",
            "pass_att", "pass_yd", "pass_td", "pass_int"]

_POS_KEEP = {"QB", "RB", "WR", "TE"}
# Roster position variants folded into the four fantasy buckets.
_POS_FOLD = {"HB": "RB", "FB": "RB"}


def _fold_pos(p):
    p = str(p or "").upper()
    p = _POS_FOLD.get(p, p)
    return p if p in _POS_KEEP else None


def _r1(v):
    """Round to 1dp, dropping float noise; ints stay ints."""
    f = float(v or 0)
    i = int(f)
    return i if abs(f - i) < 1e-9 else round(f, 1)


def build_schedule(season):
    """Full-season opponent map (future weeks included): {TEAM: {week: OPP}}."""
    g = _nfl._aux_csv(NFLDATA_GAMES_URL,
                      usecols=["season", "game_type", "week", "away_team", "home_team"])
    g = g[(g["season"] == int(season)) & (g["game_type"] == "REG")]
    out = {}
    for _, row in g.iterrows():
        wk = int(row["week"])
        home = _nfl.NFLVERSE_TO_SEED.get(row["home_team"], row["home_team"])
        away = _nfl.NFLVERSE_TO_SEED.get(row["away_team"], row["away_team"])
        out.setdefault(home, {})[str(wk)] = away
        out.setdefault(away, {})[str(wk)] = home
    return out


def _weekly_frames(season):
    """The pbp slices player_weekly and def_vs_pos are computed from."""
    cols = ["week", "season_type", "posteam", "defteam", "play_type",
            "pass_attempt", "complete_pass", "sack",
            "passing_yards", "receiving_yards", "rushing_yards", "air_yards",
            "pass_touchdown", "rush_touchdown", "interception", "epa",
            "passer_player_id", "receiver_player_id", "rusher_player_id"]
    pbp = _nfl._load_pbp(season, cols)
    pbp = pbp[(pbp["season_type"] == "REG") & pbp["posteam"].notna()].copy()
    if pbp.empty:
        return None
    for c in ("posteam", "defteam"):
        pbp[c] = pbp[c].replace(_nfl.NFLVERSE_TO_SEED)
    pbp["week"] = pd.to_numeric(pbp["week"], errors="coerce")
    pbp = pbp[pbp["week"].notna()].copy()
    pbp["week"] = pbp["week"].astype(int)
    for c in ("passing_yards", "receiving_yards", "rushing_yards", "air_yards", "epa"):
        pbp[c] = pd.to_numeric(pbp[c], errors="coerce").fillna(0)
    for c in ("pass_attempt", "complete_pass", "sack", "pass_touchdown",
              "rush_touchdown", "interception"):
        pbp[c] = pd.to_numeric(pbp[c], errors="coerce").fillna(0).astype(int)
    return pbp


def build_player_weekly(season, pbp):
    """Per-player weekly usage lines from pbp (receiving / rushing / passing)."""
    pos_map = _nfl._pos_map(season)
    name_map = _nfl._name_map(season)
    players = {}

    def node(gid, team):
        p = players.get(gid)
        if p is None:
            p = players[gid] = {"n": name_map.get(gid, ""), "p": _fold_pos(pos_map.get(gid)),
                                "t": team, "w": {}}
        p["t"] = team  # last team seen that season wins (matches trade reality)
        return p

    def line(p, wk):
        return p["w"].setdefault(str(int(wk)), [0] * len(PLAYER_WEEK_COLS))

    ci = {c: i for i, c in enumerate(PLAYER_WEEK_COLS)}

    # A target = a pass attempt (sacks excluded) with a charted receiver.
    tgt = pbp[(pbp["pass_attempt"] == 1) & (pbp["sack"] == 0) & pbp["receiver_player_id"].notna()]
    team_tgts = tgt.groupby(["posteam", "week"]).size()
    for (gid, team, wk), grp in tgt.groupby(["receiver_player_id", "posteam", "week"]):
        row = line(node(gid, team), wk)
        row[ci["tgt"]] += len(grp)
        row[ci["rec"]] += int(grp["complete_pass"].sum())
        row[ci["rec_yd"]] = _r1(row[ci["rec_yd"]] + grp["receiving_yards"].sum())
        row[ci["rec_td"]] += int(grp["pass_touchdown"].sum())
        row[ci["air_yd"]] = _r1(row[ci["air_yd"]] + grp["air_yards"].sum())
        row[ci["epa_touch"]] = _r1(row[ci["epa_touch"]] + grp["epa"].sum())
        row[ci["team_tgt"]] = int(team_tgts.get((team, wk), 0))

    rush = pbp[(pbp["play_type"] == "run") & pbp["rusher_player_id"].notna()]
    for (gid, team, wk), grp in rush.groupby(["rusher_player_id", "posteam", "week"]):
        row = line(node(gid, team), wk)
        row[ci["carry"]] += len(grp)
        row[ci["rush_yd"]] = _r1(row[ci["rush_yd"]] + grp["rushing_yards"].sum())
        row[ci["rush_td"]] += int(grp["rush_touchdown"].sum())
        row[ci["epa_touch"]] = _r1(row[ci["epa_touch"]] + grp["epa"].sum())

    qb = pbp[(pbp["pass_attempt"] == 1) & pbp["passer_player_id"].notna()]
    for (gid, team, wk), grp in qb.groupby(["passer_player_id", "posteam", "week"]):
        row = line(node(gid, team), wk)
        row[ci["pass_att"]] += int((grp["sack"] == 0).sum())
        row[ci["pass_yd"]] = _r1(row[ci["pass_yd"]] + grp["passing_yards"].sum())
        row[ci["pass_td"]] += int(grp["pass_touchdown"].sum())
        row[ci["pass_int"]] += int(grp["interception"].sum())

    # Keep only fantasy positions with something to say.
    players = {g: p for g, p in players.items() if p["p"] and p["w"]}
    return {"cols": PLAYER_WEEK_COLS, "players": players}


def build_def_vs_pos(season, pbp):
    """Weekly production ALLOWED by each defense, split by the producer's position."""
    pos_map = _nfl._pos_map(season)
    ci = {c: i for i, c in enumerate(DVP_COLS)}
    teams = {}

    def line(dteam, pos, wk):
        return (teams.setdefault(dteam, {}).setdefault(pos, {})
                .setdefault(str(int(wk)), [0] * len(DVP_COLS)))

    tgt = pbp[(pbp["pass_attempt"] == 1) & (pbp["sack"] == 0) & pbp["receiver_player_id"].notna()]
    for (dteam, wk, gid), grp in tgt.groupby(["defteam", "week", "receiver_player_id"]):
        pos = _fold_pos(pos_map.get(gid))
        if not pos:
            continue
        row = line(dteam, pos, wk)
        row[ci["tgt"]] += len(grp)
        row[ci["rec"]] += int(grp["complete_pass"].sum())
        row[ci["rec_yd"]] = _r1(row[ci["rec_yd"]] + grp["receiving_yards"].sum())
        row[ci["rec_td"]] += int(grp["pass_touchdown"].sum())

    rush = pbp[(pbp["play_type"] == "run") & pbp["rusher_player_id"].notna()]
    for (dteam, wk, gid), grp in rush.groupby(["defteam", "week", "rusher_player_id"]):
        pos = _fold_pos(pos_map.get(gid))
        if not pos:
            continue
        row = line(dteam, pos, wk)
        row[ci["carry"]] += len(grp)
        row[ci["rush_yd"]] = _r1(row[ci["rush_yd"]] + grp["rushing_yards"].sum())
        row[ci["rush_td"]] += int(grp["rush_touchdown"].sum())

    qb = pbp[(pbp["pass_attempt"] == 1) & pbp["passer_player_id"].notna()]
    for (dteam, wk, gid), grp in qb.groupby(["defteam", "week", "passer_player_id"]):
        if _fold_pos(pos_map.get(gid)) != "QB":
            continue
        row = line(dteam, "QB", wk)
        row[ci["pass_att"]] += int((grp["sack"] == 0).sum())
        row[ci["pass_yd"]] = _r1(row[ci["pass_yd"]] + grp["passing_yards"].sum())
        row[ci["pass_td"]] += int(grp["pass_touchdown"].sum())
        row[ci["pass_int"]] += int(grp["interception"].sum())

    return {"cols": DVP_COLS, "teams": teams}


def build_inseason(season):
    """The whole sidecar block for one season. {} whenever the data isn't there yet."""
    if not HAVE_PANDAS:
        print("  [inseason] pandas not available — skipping")
        return {}
    season = int(season)
    try:
        pbp = _weekly_frames(season)
    except Exception as e:
        print(f"  [inseason] no pbp for {season} yet ({e}) — skipping")
        return {}
    if pbp is None or pbp.empty:
        print(f"  [inseason] no regular-season plays for {season} yet — skipping")
        return {}
    weeks = sorted(int(w) for w in pbp["week"].unique())
    out = {"v": 1, "season": season, "weeks": weeks,
           "asof": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        out["adv_weekly"] = {str(season): _nfl.adv_weekly_team(season)}
    except Exception as e:
        print(f"  [inseason] adv_weekly failed ({e}) — omitting")
    try:
        out["player_weekly"] = build_player_weekly(season, pbp)
    except Exception as e:
        print(f"  [inseason] player_weekly failed ({e}) — omitting")
    try:
        out["def_vs_pos"] = build_def_vs_pos(season, pbp)
    except Exception as e:
        print(f"  [inseason] def_vs_pos failed ({e}) — omitting")
    try:
        out["schedule"] = build_schedule(season)
    except Exception as e:
        print(f"  [inseason] schedule failed ({e}) — omitting")
    n_players = len((out.get("player_weekly") or {}).get("players", {}))
    print(f"  [inseason] {season}: weeks {weeks[0]}–{weeks[-1]}, {n_players} players")
    return out
