#!/usr/bin/env python3
"""
cfbfastr.py — college production tables for NFL rookies
───────────────────────────────────────────────────────
Reads the cfbfastR play-by-play releases and turns them into the same shape as the nflverse
Sumer-style player tables, so a rookie's college career can render through the machinery the
app already has. Companion to src/cfb/link.py, which supplies the Sleeper→CFBD id map.

WHAT THE COLLEGE PBP GIVES US (and what it doesn't)
    Present: EPA, win probability, success, red zone, scoring opportunity, stuffed runs,
             drive context, pregame Elo for both teams, and per-play player attribution.
    Absent:  air yards, pass location, run gap, YAC, personnel, snaps, pressure. There is no
             public college source for any of it, so no route/zone/fan card can exist here.

PLAY ATTRIBUTION — verified against the 2025 file, because the column names mislead:
    completion_player_id / incompletion_player_id ... the PASSER, not the receiver
    reception_player_id ......................... the receiver, on completions only
    target_player_id ............................ the intended receiver, on incompletions only
    sack_taken_player_id ........................ the sacked QB
    interception_thrown_player_id ............... the intercepted QB — and these plays carry
                                                  NO completion/incompletion id, so a dropback
                                                  set that omits them silently drops every
                                                  interception. They average -3.98 EPA; leaving
                                                  them out inflated one QB's EPA/dropback from
                                                  0.023 to 0.160.
    rush_player_id .............................. the ball carrier
    touchdown_player_id ......................... UNUSABLE for role attribution. On passing
                                                  touchdowns it names the passer 36% of the
                                                  time and the receiver 27%, and is null for
                                                  the rest. Touchdowns are counted here as
                                                  "role id matches AND the touchdown flag is
                                                  set" instead, which is consistent.
So a receiver's targets are reception ∪ target, and a QB's dropbacks are
completion ∪ incompletion ∪ sack_taken ∪ interception_thrown. Getting this backwards yields a
table full of QBs with 900 receiving yards, which is the tell that it's wrong.

KNOWN GAP — and why dominator rating here is yards-only:
    Receiving-TD attribution is both incomplete and wildly uneven. Measured across 2025, the
    share of a team's passing touchdowns that carry a receiver id averages 66% and ranges from
    25% to 100% (Alabama 84%, Arizona State 45%). The shortfall is NOT missing at random, so a
    TD share is not comparable between two players on different teams — the textbook dominator
    (mean of yards share and TD share) would rank prospects partly by their school's data
    quality. Receiving-YARDS attribution, by contrast, covers 96% on average with a 97% median.
    So `dominator` here is the yards share alone. `td_share` is still reported, alongside
    `td_cov` — the team's TD attribution coverage — so nothing downstream trusts it blindly.

    Targets have a milder version of the same problem: every reception carries a receiver id,
    but only ~79% of incompletions do, so coverage averages 90% (min 61%) and catch rate reads
    high by roughly the size of the gap. `tgt_cov` is reported for the same reason.

SCALE NOTE
    Each season's parquet is ~110-130 MB. We read ~40 of its 362 columns, compute team
    denominators from the full slate (share metrics need every team's totals), then keep only
    the linked players. The result is cached, so the big read happens once per season ever.

Usage:
    python -m src.cfb.cfbfastr            # build for the current rookie class, print a summary
    python -m src.cfb.cfbfastr 2025       # a different class
"""
import hashlib
import json
import os
import sys

try:
    import pandas as pd
    HAVE_PANDAS = True
except Exception:
    pd = None
    HAVE_PANDAS = False

from src.cfb import link

PBP_URL = ("https://github.com/sportsdataverse/sportsdataverse-data/releases/download/"
           "cfbfastR_cfb_pbp/play_by_play_{season}.parquet")

SCHEMA = "cfb_rookie_v1"

# Only the columns the aggregates actually need. The file has 362; reading 40 is what keeps
# this tractable.
PBP_COLS = [
    "year", "week", "game_id", "season_type", "pos_team", "def_pos_team", "conference",
    "home_team", "away_team", "home_team_pregame_elo", "away_team_pregame_elo",
    "down", "distance", "yards_to_goal", "yards_gained", "play_type",
    "EPA", "wp_before", "success", "rz_play", "stuffed_run",
    "rush", "pass", "pass_attempt", "completion", "sack", "touchdown",
    "rush_player_id", "rush_yds",
    "reception_player_id", "reception_yds", "completion_yds", "target_player_id",
    "completion_player_id", "incompletion_player_id", "interception_thrown_player_id",
    "sack_taken_player_id", "touchdown_player_id",
    "position_rush", "position_reception", "position_target",
]

# A play is garbage time when the outcome is no longer in doubt. CFBD exposes this as a flag on
# its API endpoints; on raw play-by-play we reconstruct it from win probability. 10/90 is
# deliberately wider than CFBD's own definition — college blowouts are common enough that a
# tighter cut would discard a meaningful share of a bad team's snaps.
GARBAGE_WP_LOW = 0.10
GARBAGE_WP_HIGH = 0.90

# Explosive-play thresholds, in the conventional places for each phase.
EXPLOSIVE_RUSH_YDS = 12
EXPLOSIVE_PASS_YDS = 20

_PBP_CACHE = {}


def _derived_cache_path(kind, payload):
    digest = hashlib.md5(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return os.path.join(link._cache_subdir("derived", kind), f"{digest}.json")


def _ids(series):
    """CFBD athlete ids arrive as floats (4685522.0). Normalize to the string form link.py uses."""
    return series.astype("Int64").astype(str).where(series.notna())


def load_pbp(season):
    """Projected, id-normalized play-by-play for one college season (regular + postseason)."""
    if not HAVE_PANDAS:
        raise RuntimeError("college tables require pandas (pip install -r requirements.txt)")
    if season in _PBP_CACHE:
        return _PBP_CACHE[season]
    path = link._cache_remote(PBP_URL.format(season=season), f"cfb pbp {season}")
    df = pd.read_parquet(path, columns=PBP_COLS)
    for c in ("rush_player_id", "reception_player_id", "target_player_id",
              "completion_player_id", "incompletion_player_id",
              "interception_thrown_player_id", "sack_taken_player_id", "touchdown_player_id"):
        df[c] = _ids(df[c])
    # Opponent Elo is the rating of whichever side isn't holding the ball. It's the only
    # opponent-quality signal that costs nothing — it's already on every row.
    df["opp_elo"] = df["away_team_pregame_elo"].where(
        df["pos_team"] == df["home_team"], df["home_team_pregame_elo"])
    df["garbage"] = (df["wp_before"] < GARBAGE_WP_LOW) | (df["wp_before"] > GARBAGE_WP_HIGH)
    _PBP_CACHE[season] = df
    return df


def team_totals(df):
    """Per-team season denominators for every share metric (target share, dominator, …).

    Computed over the whole slate, not just linked players — a share is meaningless unless the
    denominator counts everyone.
    """
    rec = df[df["reception_player_id"].notna()]
    tgt_plays = df[df["reception_player_id"].notna() | df["target_player_id"].notna()]
    rush = df[df["rush_player_id"].notna()]
    # Every passing touchdown, attributed or not — the denominator for TD-attribution coverage.
    all_pass_td = df[df["play_type"] == "Passing Touchdown"]
    # Every pass thrown, attributed to a receiver or not — the denominator for target coverage.
    all_pass = df[df["play_type"].isin(["Pass Reception", "Pass Incompletion", "Passing Touchdown"])]
    out = pd.DataFrame({
        "pass_att": df.groupby("pos_team")["pass_attempt"].sum(),
        "targets": tgt_plays.groupby("pos_team").size(),
        "rec_yds": rec.groupby("pos_team")["reception_yds"].sum(),
        "rec_td": rec[rec["touchdown"] == 1].groupby("pos_team").size(),
        "rushes": rush.groupby("pos_team").size(),
        "rush_yds": rush.groupby("pos_team")["rush_yds"].sum(),
        "rec_td_all": all_pass_td.groupby("pos_team").size(),
        "targets_all": all_pass.groupby("pos_team").size(),
        "plays": df[df["pass"].fillna(0) + df["rush"].fillna(0) > 0].groupby("pos_team").size(),
    }).fillna(0)
    return out


def _rate(num, den, pct=True, nd=1):
    if not den:
        return None
    v = num / den * (100 if pct else 1)
    return round(float(v), nd)


def _mean(series, nd=3):
    if series is None or not len(series) or series.isna().all():
        return None
    return round(float(series.mean()), nd)


def _epa_block(plays, prefix=""):
    """EPA / success / explosiveness for a set of plays, with and without garbage time.

    Both are reported because they answer different questions: the raw number is what a box
    score would show, the clean number is what the player did when the game was live.
    """
    clean = plays[~plays["garbage"]]
    return {
        f"{prefix}epa": round(float(plays["EPA"].sum()), 1) if len(plays) else None,
        f"{prefix}epa_play": _mean(plays["EPA"]),
        f"{prefix}succ": _rate(float(plays["success"].sum()), len(plays)),
        f"{prefix}epa_play_cln": _mean(clean["EPA"]),
        f"{prefix}succ_cln": _rate(float(clean["success"].sum()), len(clean)),
    }


def _game_rows(plays, value_cols):
    """Per-game log for one player: one row per game, in schedule order."""
    if not len(plays):
        return []
    rows = []
    for (wk, gid), g in plays.groupby(["week", "game_id"], sort=True):
        row = {"wk": int(wk), "opp": g["def_pos_team"].iloc[0],
               "opp_elo": int(g["opp_elo"].iloc[0]) if pd.notna(g["opp_elo"].iloc[0]) else None,
               "epa": round(float(g["EPA"].sum()), 2), "n": len(g)}
        for k, col, agg in value_cols:
            v = g[col].sum() if agg == "sum" else len(g[g[col].notna()])
            row[k] = int(v) if pd.notna(v) else 0
        rows.append(row)
    return rows


def qb_season(df, aid, totals):
    """One QB's season: dropbacks are completion ∪ incompletion ∪ sack_taken, plus rushes."""
    db = df[(df["completion_player_id"] == aid) | (df["incompletion_player_id"] == aid)
            | (df["sack_taken_player_id"] == aid)
            | (df["interception_thrown_player_id"] == aid)]
    if not len(db):
        return None
    ru = df[df["rush_player_id"] == aid]
    att = db[db["pass_attempt"] == 1]
    comp = db[db["completion_player_id"] == aid]
    ints = db[db["interception_thrown_player_id"] == aid]
    sacks = db[db["sack_taken_player_id"] == aid]
    pass_yds = float(comp["completion_yds"].sum())
    out = {
        "dropbacks": len(db), "att": len(att), "comp": len(comp),
        "comp_pct": _rate(len(comp), len(att)),
        "pass_yds": int(pass_yds), "ypa": _rate(pass_yds, len(att), pct=False, nd=2),
        "pass_td": int(comp["touchdown"].sum()),
        "int": len(ints), "sacks": len(sacks), "sack_pct": _rate(len(sacks), len(db)),
        "rushes": len(ru), "rush_yds": int(ru["rush_yds"].sum()),
        "rush_td": int(ru["touchdown"].sum()),
        "rush_epa": round(float(ru["EPA"].sum()), 1) if len(ru) else 0.0,
    }
    out.update(_epa_block(db))
    out["log"] = _game_rows(db, [("att", "pass_attempt", "sum"), ("comp", "completion", "sum")])
    return out


def _receiving(df, aid):
    """A receiver's target plays: receptions plus the incompletions thrown their way."""
    return df[(df["reception_player_id"] == aid) | (df["target_player_id"] == aid)]


def rb_season(df, aid, totals):
    ru = df[df["rush_player_id"] == aid]
    tg = _receiving(df, aid)
    if not len(ru) and not len(tg):
        return None
    team = ru["pos_team"].mode().iloc[0] if len(ru) else tg["pos_team"].mode().iloc[0]
    t = totals.loc[team] if team in totals.index else None
    yds = float(ru["rush_yds"].sum())
    rec = tg[tg["reception_player_id"] == aid]
    out = {
        "rushes": len(ru), "rush_yds": int(yds),
        "ypc": _rate(yds, len(ru), pct=False, nd=2),
        "rush_td": int(ru["touchdown"].sum()) if len(ru) else 0,
        "stuff_rate": _rate(float(ru["stuffed_run"].sum()), len(ru)),
        "expl_rate": _rate(int((ru["yards_gained"] >= EXPLOSIVE_RUSH_YDS).sum()), len(ru)),
        "tgt": len(tg), "rec": len(rec), "rec_yds": int(rec["reception_yds"].sum()),
        "rec_epa": round(float(tg["EPA"].sum()), 1) if len(tg) else 0.0,
        "rush_share": _rate(len(ru), int(t["rushes"])) if t is not None else None,
        "tgt_share": _rate(len(tg), int(t["targets"])) if t is not None else None,
    }
    out.update(_epa_block(ru))
    out["log"] = _game_rows(ru, [("att", "rush", "sum"), ("yds", "rush_yds", "sum")])
    return out


def wr_season(df, aid, totals):
    """WR/TE season, including the two share metrics that actually predict NFL production."""
    tg = _receiving(df, aid)
    if not len(tg):
        return None
    team = tg["pos_team"].mode().iloc[0]
    t = totals.loc[team] if team in totals.index else None
    rec = tg[tg["reception_player_id"] == aid]
    yds = float(rec["reception_yds"].sum())
    tds = int(rec["touchdown"].sum())
    ru = df[df["rush_player_id"] == aid]
    out = {
        "tgt": len(tg), "rec": len(rec), "rec_yds": int(yds), "rec_td": tds,
        "catch_rate": _rate(len(rec), len(tg)),
        "ypr": _rate(yds, len(rec), pct=False, nd=2),
        "ypt": _rate(yds, len(tg), pct=False, nd=2),
        "expl_rate": _rate(int((rec["yards_gained"] >= EXPLOSIVE_PASS_YDS).sum()), len(tg)),
        "rz_tgt": int(tg["rz_play"].sum()),
        "rushes": len(ru), "rush_yds": int(ru["rush_yds"].sum()) if len(ru) else 0,
    }
    if t is not None:
        out["tgt_share"] = _rate(len(tg), int(t["targets"]))
        out["yptpa"] = _rate(yds, int(t["pass_att"]), pct=False, nd=2)
        # Dominator rating: the mean of a player's share of team receiving yards and share of
        # team receiving TDs. The most predictive single college number for WR prospects, and
        # computable here because the denominators are just the rest of the roster.
        out["yds_share"] = _rate(yds, float(t["rec_yds"]), nd=1)
        out["td_share"] = _rate(tds, float(t["rec_td"]), nd=1)
        out["td_cov"] = _rate(float(t["rec_td"]), float(t["rec_td_all"]), nd=0)
        out["tgt_cov"] = _rate(float(t["targets"]), float(t["targets_all"]), nd=0)
        out["dominator"] = out["yds_share"]
    out.update(_epa_block(tg))
    out["log"] = _game_rows(tg, [("tgt", "pass", "sum"), ("yds", "reception_yds", "sum")])
    return out


_BUILDERS = {"QB": qb_season, "RB": rb_season, "WR": wr_season, "TE": wr_season}


def _role_mask(df, ids):
    """Rows where any of these athlete ids touched the ball."""
    m = False
    for c in ("rush_player_id", "reception_player_id", "target_player_id",
              "completion_player_id", "incompletion_player_id",
              "sack_taken_player_id", "interception_thrown_player_id"):
        m = df[c].isin(ids) if m is False else (m | df[c].isin(ids))
    return m


def build_season(season, links):
    """{player key: season block} for every linked player who appears in this college season."""
    df = load_pbp(season)
    totals = team_totals(df)          # needs the FULL slate — shares need every team's totals
    # Past that point only our players' rows matter. Narrowing 280k plays to a few thousand
    # before the per-player loop is what makes a twelve-season build finish in minutes.
    ids = {l.get("athlete_id") for l in links.values() if l.get("athlete_id")}
    df = df[_role_mask(df, ids)]
    out = {}
    for pid, l in links.items():
        aid, pos = l.get("athlete_id"), l.get("pos")
        builder = _BUILDERS.get(pos)
        if not aid or not builder:
            continue
        block = builder(df, aid, totals)
        if not block:
            continue
        rows = df[(df["rush_player_id"] == aid) | (df["reception_player_id"] == aid)
                  | (df["target_player_id"] == aid) | (df["completion_player_id"] == aid)
                  | (df["incompletion_player_id"] == aid)]
        block["team"] = rows["pos_team"].mode().iloc[0] if len(rows) else l.get("college")
        block["conf"] = rows["conference"].mode().iloc[0] if len(rows) and rows["conference"].notna().any() else None
        block["games"] = int(rows["game_id"].nunique())
        block["opp_elo"] = int(rows["opp_elo"].mean()) if rows["opp_elo"].notna().any() else None
        out[pid] = block
    return out


def build(links, seasons, refresh=False):
    """{sleeper_pid: {"seasons": {year: block}}} for a linked rookie class."""
    payload = {"schema": SCHEMA, "seasons": sorted(int(s) for s in seasons),
               "ids": sorted(l.get("athlete_id") or "" for l in links.values())}
    path = _derived_cache_path("rookies", payload)
    if os.path.exists(path) and not refresh:
        with open(path) as f:
            return json.load(f)
    out = {}
    for season in sorted(seasons):
        print(f"  college {season} …", end="", flush=True)
        blocks = build_season(season, links)
        for pid, block in blocks.items():
            out.setdefault(pid, {"seasons": {}})["seasons"][str(season)] = block
        # Each season frame is hundreds of MB; holding twelve of them at once is what turns a
        # long build into a swapping one.
        _PBP_CACHE.pop(season, None)
        print(f" {len(blocks)} players")
    for pid, node in out.items():
        l = links.get(pid) or {}
        node["name"] = l.get("name")
        node["pos"] = l.get("pos")
        node["athlete_id"] = l.get("athlete_id")
        node["method"] = l.get("method")
    with open(path, "w") as f:
        json.dump(out, f, sort_keys=True)
    return out


def main():
    draft_class = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    with open(os.path.join(link.CACHE_DIR, "players.json")) as f:
        players = json.load(f)
    links = link.build_link_map(players, draft_class)
    seasons = range(draft_class - 4, draft_class)
    print(f"building college tables for the {draft_class} class ({seasons.start}–{seasons.stop - 1})")
    data = build(links, seasons, refresh=True)
    print(f"\n  {len(data)} players with college production")
    for pos in ("QB", "RB", "WR", "TE"):
        n = sum(1 for v in data.values() if v.get("pos") == pos)
        print(f"    {pos}: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
