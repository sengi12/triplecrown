#!/usr/bin/env python3
"""
ol_unit.py — college line context for rookie offensive linemen
──────────────────────────────────────────────────────────────
A rookie lineman's card has nothing to show: no NFL snaps, and the college play-by-play
(cfbfastR) carries no lineman attribution at all — no snaps, no pressures allowed, no run
gaps, no blocking grades. Nobody outside PFF can grade a college lineman from public data.

What the play-by-play CAN say is how his UNIT played. Per team-season, from every
non-garbage-time snap:

    ly      line yards per carry — the Football Outsiders split of a rush between the line
            and the back: losses count 120%, the first four yards 100%, yards five to ten
            50%, anything beyond is the back's
    stuff   % of carries stopped at or behind the line
    tfl     % of carries that lost yards
    power   % of 3rd/4th-and-≤2 carries that moved the chains (or scored)
    sack    % of dropbacks that ended in a sack
    opp_elo the mean pregame Elo of the defenses faced (the schedule, in one number)

Each rate is also given as a percentile among FBS-sized units that season (≥ MIN_RUSHES
non-garbage carries), higher = better for the line in every case. A rookie's profile is the
unit row for each season he was on that school's roster.

This is CONTEXT, not a grade, and the card labels it as the unit's. A tackle on a line that
allowed sacks on 2% of dropbacks is not thereby a good tackle — but a reader who knows the
line was 95th percentile in pass protection and 20th in short yardage knows more about the
system he comes from than a blank card tells them.
"""
import os
import re

try:
    import pandas as pd
    HAVE_PANDAS = True
except Exception:
    pd = None
    HAVE_PANDAS = False

from src.cfb import link, cfbfastr

SCHEMA = "cfb_ol_unit_v1"

# Sleeper's codes for offensive linemen (it uses several).
OL_POSITIONS = ("OL", "OT", "OG", "C", "G", "T")
# CFBD roster codes that can back one of them.
POS_LINE = {"OL", "OT", "OG", "C", "G", "T", "LS"}

# A full FBS season is 350-500 non-garbage carries; below this the unit's rates are noise
# (and the team is usually FCS, whose slate would skew the percentiles).
MIN_RUSHES = 150

# (metric, higher is better for the line)
METRICS = (("ly", True), ("stuff", False), ("tfl", False), ("power", True), ("sack", False))

# Percentiles are taken within a division: an FBS line against FBS lines, an FCS line (Weber
# State, North Dakota State) against FCS lines — the row says which pool it was ranked in.
FBS_CONFERENCES = {
    "ACC", "Big 12", "Big Ten", "SEC", "Pac-12", "Pac-10", "American Athletic", "Conference USA",
    "Mid-American", "Mountain West", "Sun Belt", "FBS Independents", "Big East", "Western Athletic",
}


def _pool(conf):
    return "FBS" if str(conf or "") in FBS_CONFERENCES else "FCS"


# ── The college prior: one number from the unit's percentiles, its level and its slate ──
# A rookie lineman's grade before a snap blends his draft slot with this: the unit's mean
# percentile in his last two college seasons (the final season weighing 70%), scaled for
# the LEVEL he played at — a Power-conference line's 80th percentile is the 80th; a Group of
# Five line's counts 85% of that, an FCS line's 60% — and tilted a little for the SLATE (the
# mean pregame Elo of the defenses faced: ±3 points per 100 Elo from the FBS mean, capped
# at ±6). It is explicitly a team-context number: college play-by-play has no lineman
# attribution, so this is the line he played on, not him — the card says so with an asterisk.
POWER_CONFERENCES = {"SEC", "Big Ten", "Big 12", "ACC", "Pac-12", "Pac-10", "Big East"}
POWER_INDEPENDENTS = {"Notre Dame"}
LEVEL_FACTOR = {"power": 1.0, "fbs": 0.85, "fcs": 0.60}
ELO_MID, ELO_TILT_PER_100, ELO_TILT_CAP = 1500.0, 3.0, 6.0
SEASON_WEIGHTS = (0.7, 0.3)      # final college season, the one before


def level_of(row):
    """'power' | 'fbs' | 'fcs' for one unit-table row (conference + team + pool)."""
    conf, team, pool = str(row.get("conf") or ""), str(row.get("team") or ""), str(row.get("pool") or "FBS")
    if pool == "FCS":
        return "fcs"
    if conf in POWER_CONFERENCES or team in POWER_INDEPENDENTS:
        return "power"
    return "fbs"


def college_prior(profile):
    """0-100 (1-99 clamped) college line prior for one ol_unit profile, or None without seasons."""
    seasons = ((profile or {}).get("ol_unit") or {}).get("seasons") or []
    rows = sorted([r for r in seasons if isinstance(r, dict) and r.get("pct")], key=lambda r: int(r.get("season") or 0), reverse=True)
    if not rows:
        return None
    num = den = 0.0
    for w, r in zip(SEASON_WEIGHTS, rows[:len(SEASON_WEIGHTS)]):
        vals = [float(v) for v in (r.get("pct") or {}).values() if v is not None]
        if not vals:
            continue
        u = sum(vals) / len(vals)
        score = u * LEVEL_FACTOR[level_of(r)]
        elo = r.get("opp_elo")
        if elo is not None:
            score += max(-ELO_TILT_CAP, min(ELO_TILT_CAP, (float(elo) - ELO_MID) / 100.0 * ELO_TILT_PER_100))
        num += w * score
        den += w
    if den <= 0:
        return None
    return round(min(99.0, max(1.0, num / den)), 1)


def _nn(name):
    s = str(name or "").lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)


def prior_map(players, classes, refresh=False, verbose=False):
    """{'gsis:<id>': prior, 'nm:<normalized name>': prior} for the linemen of these draft
    classes — what the OL grades pipeline reads (ol_grades_pipeline.ROOKIE_COLLEGE) when it
    grades a rookie before his first snap. Keyed both ways because Sleeper's gsis_id is
    missing on many young players; the name key is the fallback."""
    out = {}
    for cls in sorted(set(int(c) for c in classes)):
        try:
            profs = build(players, cls, refresh=refresh, verbose=verbose)
        except Exception as e:
            if verbose:
                print(f"    ! OL college prior skipped for {cls}: {type(e).__name__}: {e}", flush=True)
            continue
        for pid, prof in profs.items():
            p = college_prior(prof)
            if p is None:
                continue
            raw = (players or {}).get(str(pid)) or {}
            gid = raw.get("gsis_id")
            if gid:
                out[f"gsis:{str(gid).strip()}"] = p
            nm = _nn(prof.get("name") or raw.get("full_name"))
            if nm:
                out[f"nm:{nm}"] = p
    return out

_UNITS = {}


def _num(s):
    return pd.to_numeric(s, errors="coerce")


def unit_table(df):
    """Per-team line metrics from a play-by-play frame (already garbage-filtered or not).

    {team: {rushes, ly, stuff, tfl, power, dropbacks, sack, opp_elo, conf, pct:{metric: 0-100}}}
    Teams under MIN_RUSHES are dropped; percentiles are among the rest.
    """
    d = df[~df["garbage"]] if "garbage" in df.columns else df
    rush = d[(_num(d["rush"]).fillna(0) == 1) & (_num(d["sack"]).fillna(0) != 1)].copy()
    yg = _num(rush["yards_gained"]).fillna(0)
    dist = _num(rush["distance"])
    rush["ly"] = yg.clip(upper=0) * 1.2 + yg.clip(lower=0, upper=4) + (yg.clip(lower=4, upper=10) - 4) * 0.5
    rush["stuff"] = (yg <= 0).astype(int)
    rush["tfl"] = (yg < 0).astype(int)
    power_play = _num(rush["down"]).isin([3, 4]) & (dist <= 2)
    rush["pw"] = power_play.astype(int)
    rush["pwok"] = (power_play & ((yg >= dist) | (_num(rush["touchdown"]).fillna(0) == 1))).astype(int)
    g = rush.groupby("pos_team")
    t = pd.DataFrame({
        "rushes": g.size(),
        "ly": g["ly"].mean(),
        "stuff": g["stuff"].mean() * 100,
        "tfl": g["tfl"].mean() * 100,
        "pw": g["pw"].sum(),
        "pwok": g["pwok"].sum(),
        "opp_elo": g["opp_elo"].mean() if "opp_elo" in rush.columns else g.size() * float("nan"),
    })
    t["power"] = t["pwok"] / t["pw"].where(t["pw"] > 0) * 100
    db = d[(_num(d["pass"]).fillna(0) == 1) | (_num(d["sack"]).fillna(0) == 1)]
    gs = db.groupby("pos_team")
    t["dropbacks"] = gs.size()
    t["sack"] = _num(gs["sack"].mean()) * 100
    if "conference" in d.columns:
        conf = d.groupby("pos_team")["conference"].agg(lambda s: s.dropna().mode().iloc[0] if len(s.dropna().mode()) else None)
        t["conf"] = conf
    t = t[t["rushes"] >= MIN_RUSHES]
    out = {}
    if not len(t):
        return out
    if "conf" not in t.columns:
        t["conf"] = None
    t["pool"] = t["conf"].map(_pool)
    pcts = {}
    for m, hi in METRICS:
        # the best unit ranks 100 either way, within its own division
        pcts[m] = t.groupby("pool")[m].rank(ascending=hi, pct=True) * 100
    for team, r in t.iterrows():
        row = {
            "rushes": int(r["rushes"]), "dropbacks": int(r["dropbacks"]) if pd.notna(r["dropbacks"]) else 0,
            "ly": round(float(r["ly"]), 2), "stuff": round(float(r["stuff"]), 1), "tfl": round(float(r["tfl"]), 1),
            "power": (round(float(r["power"]), 1) if pd.notna(r["power"]) else None),
            "sack": (round(float(r["sack"]), 1) if pd.notna(r["sack"]) else None),
            "opp_elo": (int(round(float(r["opp_elo"]))) if pd.notna(r["opp_elo"]) else None),
            "conf": (str(r["conf"]) if pd.notna(r["conf"]) else None),
            "pool": str(r["pool"]),
            "pct": {m: (int(round(float(pcts[m][team]))) if pd.notna(pcts[m][team]) else None) for m, _ in METRICS},
        }
        out[str(team)] = row
    return out


def team_units(season):
    """The unit table for one college season (cached in memory)."""
    if season in _UNITS:
        return _UNITS[season]
    _UNITS[season] = unit_table(cfbfastr.load_pbp(season))
    return _UNITS[season]


def build(players, draft_class, refresh=False, verbose=True):
    """{sleeper_pid: profile} for the rookie linemen who link to a CFBD roster.

    profile = {name, pos, college, athlete_id, method, ol_unit:{schema, seasons:[row…]}}
    where each row is the unit table's entry for a season he was on that roster.
    """
    if not HAVE_PANDAS:
        return {}
    draft_class = int(draft_class)
    pool = link.rookie_pool(players, draft_class, positions=OL_POSITIONS)
    if not pool:
        return {}
    cache_path = os.path.join(link._cache_subdir("links"), f"ol_links_{draft_class}.json")
    prev = link.POS_GUARD
    link.POS_GUARD = POS_LINE
    try:
        links = link._link_pool(pool, draft_class, cache_path, refresh=refresh)
    finally:
        link.POS_GUARD = prev
    idx = link.roster_index(range(draft_class - link.LOOKBACK_SEASONS, draft_class))
    by_aid = {}
    for entries in idx["full"].values():
        for aid, e in entries.items():
            by_aid.setdefault(str(aid), e)
    out, linked = {}, 0
    for pid, lk in links.items():
        aid = lk.get("athlete_id")
        e = by_aid.get(str(aid)) if aid else None
        if not e:
            continue
        linked += 1
        rows = []
        for season in sorted(e.get("by_season") or {}):
            season = int(season)
            if season < cfbfastr.FIRST_PBP_SEASON or season >= draft_class:
                continue
            try:
                units = team_units(season)
            except Exception:
                continue
            row = units.get(str(e["by_season"][season]))
            if row:
                rows.append({"season": season, "team": str(e["by_season"][season]), **row})
        if rows:
            out[str(pid)] = {"name": lk.get("name"), "pos": lk.get("pos"), "college": lk.get("college"),
                             "athlete_id": str(aid), "method": lk.get("method"),
                             "ol_unit": {"schema": SCHEMA, "seasons": rows}}
    if verbose:
        print(f"    OL unit context: {len(pool)} rookie linemen, {linked} linked, {len(out)} with a unit line", flush=True)
    return out
