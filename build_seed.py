#!/usr/bin/env python3
"""
TripleCrown seed builder
─────────────────────
Fetches Sleeper's player database, 2026 season projections, and the last N
seasons of real stats, caches them locally (so re-runs are fast), and emits a
single `triplecrown_seed.js` that the TripleCrown web app loads as its baseline.

Usage:
    python build_seed.py                 # build 2026 projections + 5 prior seasons of stats
    python build_seed.py --season 2026   # choose the projection season
    python build_seed.py --history 5     # how many prior seasons of stats to bundle
    python build_seed.py --refresh       # ignore caches and re-download everything

Mirrors the caching approach in draft.py's update_players(): the big players
payload is fetched once and saved to players.json, then reused.
"""
import argparse, json, os, sys, time
from urllib import request, error

CACHE_DIR = "triplecrown_cache"
PLAYERS_URL       = "https://api.sleeper.app/v1/players/nfl"
PROJECTIONS_URL   = "https://api.sleeper.com/projections/nfl/{season}?season_type={stype}&grouping=season"
STATS_URL         = "https://api.sleeper.com/stats/nfl/{season}?season_type={stype}&grouping=season"
# Per-week stats for a single player (used to split a traded player's season by team).
WEEKLY_URL        = "https://api.sleeper.com/stats/nfl/player/{pid}?season_type={stype}&season={season}&grouping=week"
UA = {"User-Agent": "Mozilla/5.0 (TripleCrown seed builder)"}

# Positions and teams we care about
POS_KEEP   = {"QB", "RB", "WR", "TE"}
TEAMS = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB',
         'HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG',
         'NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS']

# Sleeper stat keys → our schema
STAT_MAP = {
    "pass_yd": "passing_yards", "pass_td": "passing_touchdowns",
    "pass_att": "passing_attempts", "pass_cmp": "passing_completions",
    "pass_int": "interceptions_thrown",
    "rush_yd": "rushing_yards", "rush_td": "rushing_touchdowns", "rush_att": "rushing_attempts",
    "rec": "receptions", "rec_yd": "receiving_yards", "rec_td": "receiving_touchdowns",
    "rec_tgt": "receiving_targets", "fum_lost": "fumbles_lost",
    "gp": "games_played", "gs": "games_started",
    "off_snp": "off_snaps", "tm_off_snp": "team_off_snaps",
}

def fetch(url, label):
    print(f"  → fetching {label} ...", end="", flush=True)
    req = request.Request(url, headers=UA)
    for attempt in range(3):
        try:
            with request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
            print(f" ok ({len(data) if hasattr(data,'__len__') else '?'} items)")
            return data
        except error.HTTPError as e:
            if e.code == 404:
                print(" not found (404)")
                return None
            print(f" retry ({e.code})")
            time.sleep(2)
        except Exception as e:
            print(f" retry ({type(e).__name__})")
            time.sleep(2)
    print(" FAILED")
    return None

# ── FantasyPros Expert Consensus Rankings (ECR) ──────────────────────────────
# We replace ADP with ECR. Each scoring format has its own cheatsheet page; the page
# embeds a JSON blob `ecrData = {...};` whose `players` array gives rank_ecr, tier,
# player_name, player_team_id, player_position_id and player_age. We fetch each format
# and build {format: {playerKey: {rank_ecr, tier, age}}} for the app to consume.
import re as _re
FANTASYPROS_URLS = {
    "half_ppr":  "https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php",
    "ppr":       "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php",
    "std":       "https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php",
    "dynasty":   "https://www.fantasypros.com/nfl/rankings/dynasty-overall.php",
    "superflex":      "https://www.fantasypros.com/nfl/rankings/half-point-ppr-superflex-cheatsheets.php",
    "superflex_ppr":  "https://www.fantasypros.com/nfl/rankings/ppr-superflex-cheatsheets.php",
}

def _norm_name(s):
    s = (s or "").lower()
    s = _re.sub(r"[.'\-]", "", s)
    s = _re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", s)
    return _re.sub(r"\s+", " ", s).strip()

def _extract_ecr_json(html):
    """Extract the ecrData object using brace-counting (robust against nested objects
    and '};' sequences that appear inside the JSON — a plain non-greedy regex breaks on
    real FantasyPros pages). Returns the JSON string, or None."""
    i = html.find("ecrData")
    if i < 0:
        return None
    eq = html.find("=", i)
    if eq < 0:
        return None
    start = html.find("{", eq)
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for j in range(start, len(html)):
        c = html[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return html[start:j + 1]
    return None

def fetch_fantasypros_ecr(fmt, url, refresh):
    """Fetch one FantasyPros cheatsheet page, parse the embedded ecrData JSON,
    return {playerKey: {rank_ecr, tier, age, team, pos}}. Cached as raw HTML→json."""
    cache_path = os.path.join(CACHE_DIR, "fantasypros", f"{fmt}.json")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if not refresh and os.path.exists(cache_path):
        print(f"  → ECR {fmt}: using cache")
        with open(cache_path) as f:
            return json.load(f)
    print(f"  → fetching ECR {fmt} ...", end="", flush=True)
    try:
        req = request.Request(url, headers=UA)
        with request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f" FAILED ({type(e).__name__}: {e}) — skipping {fmt}")
        return {}
    if "ecrData" not in html:
        # Save the raw HTML so the user can inspect what FantasyPros actually returned.
        dbg = os.path.join(CACHE_DIR, "fantasypros", f"{fmt}_raw.html")
        with open(dbg, "w", encoding="utf-8") as f:
            f.write(html)
        print(f" no 'ecrData' in page ({len(html)} bytes) — saved raw HTML to {dbg}")
        print(f"     (FantasyPros may have blocked the request or changed its page layout)")
        return {}
    snippet = _extract_ecr_json(html)
    if not snippet:
        print(" found 'ecrData' but could not extract the JSON object")
        return {}
    try:
        data = json.loads(snippet)
    except Exception as e:
        dbg = os.path.join(CACHE_DIR, "fantasypros", f"{fmt}_ecrdata.txt")
        with open(dbg, "w", encoding="utf-8") as f:
            f.write(snippet)
        print(f" parse error ({type(e).__name__}) — saved extracted text to {dbg}")
        return {}
    out = {}
    for p in data.get("players", []):
        try:
            rank = int(float(p.get("rank_ecr"))) if p.get("rank_ecr") not in (None, "") else None
        except Exception:
            rank = None
        try:
            tier = int(float(p.get("tier"))) if p.get("tier") not in (None, "") else None
        except Exception:
            tier = None
        key = _norm_name(p.get("player_name"))
        if not key:
            continue
        out[key] = {
            "rank_ecr": rank, "tier": tier,
            "age": p.get("player_age"),
            "team": p.get("player_team_id"),
            "pos": _re.sub(r"\d+", "", p.get("player_position_id") or ""),
        }
    print(f" ok ({len(out)} players)")
    with open(cache_path, "w") as f:
        json.dump(out, f)
    return out

def build_ecr(refresh):
    """Build the full ECR map: {format: {playerKey: {rank_ecr, tier, age, team, pos}}}."""
    ecr = {}
    for fmt, url in FANTASYPROS_URLS.items():
        ecr[fmt] = fetch_fantasypros_ecr(fmt, url, refresh)
    total = sum(len(v) for v in ecr.values())
    if total == 0:
        print("\n  ⚠ WARNING: no ECR data was fetched from FantasyPros.")
        print("    The rankings page will show 'No FantasyPros ECR loaded'. Common causes:")
        print("      • No internet access where build_seed.py ran")
        print("      • FantasyPros blocked the request (try again, or run with --refresh)")
        print(f"      • Their page layout changed (check the *_raw.html files in {CACHE_DIR}/fantasypros/)")
    else:
        per = ", ".join(f"{f}={len(v)}" for f, v in ecr.items() if v)
        print(f"\n  ECR loaded: {per}")
    return ecr


# ── OverTheCap contracts (age / APY / free-agency year) — for the Dynasty rankings tab ──
# The dynasty view benefits from a realistic picture of how long a player stays with their
# team, so we pull each position's contract table from OverTheCap. The tables are plain HTML
# (no JS), so stdlib + a light regex parse is enough — no BeautifulSoup dependency.
# Columns on the page: player, team, age, total value, avg/year (APY), total guaranteed,
# fully guaranteed, free agency (year the current deal expires → player hits FA).
OTC_URLS = {
    "QB": "https://overthecap.com/position/quarterback",
    "RB": "https://overthecap.com/position/running-back",
    "WR": "https://overthecap.com/position/wide-receiver",
    "TE": "https://overthecap.com/position/tight-end",
}

def _strip_tags(s):
    return _re.sub(r"<[^>]+>", "", s).replace("&nbsp;", " ").strip()

def _parse_otc_table(html):
    """Yield lists of cell-texts for each <tr> that has <td> cells."""
    rows = []
    for tr in _re.findall(r"<tr[^>]*>(.*?)</tr>", html, _re.DOTALL | _re.IGNORECASE):
        cells = _re.findall(r"<td[^>]*>(.*?)</td>", tr, _re.DOTALL | _re.IGNORECASE)
        if cells:
            rows.append([_strip_tags(c) for c in cells])
    return rows

def fetch_otc_contracts(pos, url, refresh):
    """Fetch one OverTheCap position page → {nameKey: {age, apy, fa}}."""
    cache_path = os.path.join(CACHE_DIR, "contracts", f"{pos}.json")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if not refresh and os.path.exists(cache_path):
        print(f"  → contracts {pos}: using cache")
        with open(cache_path) as f:
            return json.load(f)
    print(f"  → fetching contracts {pos} ...", end="", flush=True)
    try:
        req = request.Request(url, headers=UA)
        with request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f" FAILED ({type(e).__name__}: {e}) — skipping {pos}")
        return {}
    rows = _parse_otc_table(html)
    out = {}
    for cells in rows:
        # Expected layout: [player, team, age, total value, avg/year, tot gtd, full gtd, free agency]
        if len(cells) < 8:
            continue
        name = cells[0]
        key = _norm_name(name)
        if not key:
            continue
        age_raw = cells[2]
        apy_raw = cells[4]
        fa_raw = cells[7]
        # age → int if possible
        age = None
        m = _re.search(r"\d+", age_raw)
        if m:
            age = int(m.group())
        # APY → normalized numeric dollars (strip $ and commas)
        apy = None
        m = _re.search(r"[\d,]+", apy_raw.replace("$", ""))
        if m:
            try:
                apy = int(m.group().replace(",", ""))
            except Exception:
                apy = None
        # free agency → the 4-digit year the player becomes a free agent
        fa = None
        m = _re.search(r"(20\d{2})", fa_raw)
        if m:
            fa = int(m.group(1))
        out[key] = {"age": age, "apy": apy, "fa": fa}
    print(f" ok ({len(out)} players)")
    with open(cache_path, "w") as f:
        json.dump(out, f)
    return out

def build_contracts(refresh):
    """Build {nameKey: {age, apy, fa, pos}} merged across all positions."""
    contracts = {}
    for pos, url in OTC_URLS.items():
        tbl = fetch_otc_contracts(pos, url, refresh)
        for key, info in tbl.items():
            info["pos"] = pos
            contracts[key] = info
    total = len(contracts)
    if total == 0:
        print("\n  ⚠ WARNING: no contract data fetched from OverTheCap — the Dynasty tab's")
        print("    Age/APY/FA columns will be blank. (No internet, OTC blocked, or layout changed.)")
    else:
        print(f"\n  Contracts loaded: {total} players (age/APY/free-agency year)")
    return contracts


def cached(name, url, label, refresh):
    path = os.path.join(CACHE_DIR, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not refresh and os.path.exists(path):
        print(f"  → {label}: using cache {path}")
        with open(path) as f:
            return json.load(f)
    data = fetch(url, label)
    if data is not None:
        with open(path, "w") as f:
            json.dump(data, f)
    return data

def get_players(refresh):
    players = cached("players.json", PLAYERS_URL, "Sleeper player DB", refresh)
    if not players:
        print("FATAL: could not load players DB"); sys.exit(1)
    # players is a dict keyed by player_id
    slim = {}
    for pid, p in players.items():
        pos = p.get("position")
        if pos not in POS_KEEP: continue
        slim[pid] = {
            "player_id": pid,
            "name": f"{p.get('first_name','')} {p.get('last_name','')}".strip(),
            "first_name": p.get("first_name",""), "last_name": p.get("last_name",""),
            "pos": pos, "team": p.get("team"),
            "age": p.get("age"), "years_exp": p.get("years_exp"),
            "headshot": None,  # Sleeper headshots use a CDN by player_id (handled in app)
            "bye_week": None,
        }
    print(f"  → kept {len(slim)} skill players (QB/RB/WR/TE with a team)")
    return slim

def normalize_row(row):
    """Sleeper projection/stat row → {stats, team, pos, name}. The row's team is the
    team the player was on THAT season, which is what we key the seed on."""
    stats = row.get("stats", {}) or {}
    out = {}
    for sk, ours in STAT_MAP.items():
        if sk in stats and stats[sk] is not None:
            out[ours] = stats[sk]
    player = row.get("player") or {}
    name = None
    if player.get("first_name") or player.get("last_name"):
        name = f"{player.get('first_name','')} {player.get('last_name','')}".strip()
    return {
        "stats": out,
        "team": row.get("team"),
        "pos": row.get("position") or player.get("position"),
        "name": name,
    }, row.get("player_id")

def build_projection_index(season, refresh):
    rows = cached(f"proj_{season}.json", PROJECTIONS_URL.format(season=season, stype="regular"),
                  f"{season} projections", refresh)
    idx = {}
    if rows:
        for row in rows:
            rec, pid = normalize_row(row)
            if pid: idx[str(pid)] = rec
    return idx

def build_stats_index(season, refresh):
    rows = cached(f"stats_{season}.json", STATS_URL.format(season=season, stype="regular"),
                  f"{season} stats", refresh)
    idx = {}
    if rows:
        for row in rows:
            rec, pid = normalize_row(row)
            if pid: idx[str(pid)] = rec
    return idx

# Aggregate a single player's weekly rows into per-team season records. Returns a list
# of {team, games_played, games_started, snap_pct, stats:{...}} — one per team they
# played for that season.
#
# "games_played" here means games where the player was effectively the starter / primary,
# decided by that week's snap share (off_snp / tm_off_snp). A week where the QB took only
# mop-up snaps (e.g. Flacco weeks 16-17 in CIN at ~10-17%) does NOT count as a game played,
# so a backup who spelled the starter for garbage time isn't credited a full game. Stats are
# still summed from every week on that team (so the team's passing totals stay complete),
# but the games count reflects who actually led the offense.
STARTER_SNAP_THRESHOLD = 0.50   # ≥50% of team offensive snaps in a game = "started" it

def aggregate_weeks_by_team(weekly, season):
    by_team = {}
    for wk, row in (weekly or {}).items():
        if not row or not isinstance(row, dict): continue
        s = row.get("stats") or {}
        team = row.get("team")
        if not team: continue
        b = by_team.setdefault(team, {
            "team": team, "games_played": 0, "games_started": 0,
            "starter_games": 0, "off_snaps": 0, "team_off_snaps": 0,
            "starter_off_snaps": 0, "starter_team_off_snaps": 0, "stats": {},
        })
        off = s.get("off_snp", 0) or 0
        tm_off = s.get("tm_off_snp", 0) or 0
        gp = s.get("gp", 0) or 0
        has_snap_data = ("off_snp" in s) and ("tm_off_snp" in s) and tm_off > 0
        week_snap = (off / tm_off) if has_snap_data else 0.0
        # always accumulate full snap totals (for an overall snap% reference)
        b["off_snaps"] += off
        b["team_off_snaps"] += tm_off
        b["games_started"] += s.get("gs", 0) or 0
        # a "game played" for our purposes = a game this player effectively started.
        # If snap data is missing but the player recorded a game, count it (some weeks
        # on Sleeper lack snap tracking, e.g. week 18).
        if gp and (week_snap >= STARTER_SNAP_THRESHOLD or not has_snap_data):
            b["starter_games"] += 1
            b["starter_off_snaps"] += off
            b["starter_team_off_snaps"] += tm_off
        # sum stats from EVERY week on this team (keeps the team passing totals complete)
        for sk, ours in STAT_MAP.items():
            if sk in ("gp", "gs", "off_snp", "tm_off_snp"): continue
            if sk in s and s[sk] is not None:
                b["stats"][ours] = b["stats"].get(ours, 0) + s[sk]
    out = []
    for team, b in by_team.items():
        # games_played = games this player started (snap-share based), not mop-up appearances
        b["games_played"] = b["starter_games"]
        # snap% reported is the average over the games they actually started
        denom = b["starter_team_off_snaps"] or b["team_off_snaps"]
        num = b["starter_off_snaps"] or b["off_snaps"]
        b["snap_pct"] = round(num / denom * 100.0, 1) if denom else None
        b["stats"]["games_played"] = b["games_played"]
        b["stats"]["games_started"] = b["games_started"]
        # drop the intermediate accumulators from the emitted record
        for k in ("starter_games", "starter_off_snaps", "starter_team_off_snaps"):
            b.pop(k, None)
        out.append(b)
    # most-involved team first (by starter games, then snaps)
    out.sort(key=lambda r: (-(r["games_played"]), -(r["off_snaps"])))
    return out

def fetch_weekly(pid, season, refresh):
    # organize weekly files into per-season subfolders: triplecrown_cache/weekly/<season>/<pid>.json
    return cached(os.path.join("weekly", str(season), f"{pid}.json"),
                  WEEKLY_URL.format(pid=pid, season=season, stype="regular"),
                  f"{season} weekly for {pid}", refresh)

# Build a per-season history map. For each player, store a LIST of per-team records.
# To keep API usage sane we fetch weekly data only for QBs (the position where the
# games/snap-share feature matters and where mid-season trades most distort a team's
# passing picture). Everyone else uses their single season-grouping row.
#
# Why weekly data for ~80 QBs/year? The season-grouping endpoint reports only a player's
# FINAL team, so a mid-season trade (Flacco: CLE→CIN) is invisible there — the only way to
# detect and split it is the per-week feed. We fetch weekly for every QB who played, but the
# data is only actually *used* for the handful who turn out to be multi-team; the rest fall
# back to their season totals. All responses are cached under triplecrown_cache/weekly/<season>/
# so re-runs are instant and you only pay the fetch cost once.
def build_history(players, stats_by_season, refresh):
    history = {}  # pid -> { season: [ {team, games_played, games_started, snap_pct, stats}, ... ] }
    for season, sidx in stats_by_season.items():
        qb_pids = [pid for pid, rec in sidx.items()
                   if (rec.get("pos") == "QB" or (players.get(pid, {}).get("pos") == "QB"))
                   and (rec.get("stats", {}).get("games_played", 0) or 0) > 0]
        print(f"  → {season}: checking {len(qb_pids)} QBs for mid-season team changes…")
        weekly_calls = 0
        split_qbs = []
        for pid, rec in sidx.items():
            stats = rec.get("stats", {})
            season_team = rec.get("team")
            gp = stats.get("games_played", 0) or 0
            recs = None
            is_qb = pid in qb_pids
            if is_qb:
                weekly = fetch_weekly(pid, season, refresh)
                weekly_calls += 1
                if weekly:
                    split = aggregate_weeks_by_team(weekly, season)
                    if split:
                        recs = split
                        if len(split) > 1:
                            nm = rec.get("name") or players.get(pid, {}).get("name") or pid
                            split_qbs.append(f"{nm} ({'/'.join(r['team'] for r in split)})")
            if recs is None:
                recs = [{
                    "team": season_team, "pos": rec.get("pos"), "name": rec.get("name"),
                    "games_played": gp, "games_started": stats.get("games_started", 0),
                    "snap_pct": None, "stats": stats,
                }]
            else:
                for r in recs:
                    r["pos"] = rec.get("pos"); r["name"] = rec.get("name")
            history.setdefault(pid, {})[season] = recs
        note = f" · multi-team: {', '.join(split_qbs)}" if split_qbs else " · none switched teams"
        print(f"     ({weekly_calls} weekly lookups, cached){note}")
    return history

def assemble(players, proj_idx, stats_by_season, history, proj_season):
    """Group players by team into the SEED_DATA structure the app expects.
    The current-season seed uses each player's projection-season team; the history
    map (prebuilt, supports per-team splits for traded players) is attached as-is."""
    seed = {t: {"QB": [], "RB": [], "WR": [], "TE": []} for t in TEAMS}

    # Build the current-season seed from the projection index (knows the season team).
    for pid, rec in proj_idx.items():
        meta = players.get(pid, {})
        proj = rec.get("stats", {})
        team = rec.get("team") or meta.get("team")
        pos  = rec.get("pos")  or meta.get("pos")
        name = rec.get("name") or meta.get("name") or "Unknown"
        if team not in seed: continue
        if pos not in ("QB", "RB", "WR", "TE"): continue
        entry = {
            "name": name, "slug": None,
            "player_id": pid, "pos": pos, "team": team,
            "headshot": None, "age": meta.get("age"),
            "passing_yards": proj.get("passing_yards", 0),
            "passing_touchdowns": proj.get("passing_touchdowns", 0),
            "passing_attempts": proj.get("passing_attempts", 0),
            "passing_completions": proj.get("passing_completions", 0),
            "interceptions_thrown": proj.get("interceptions_thrown", 0),
            "rushing_yards": proj.get("rushing_yards", 0),
            "rushing_tds": proj.get("rushing_touchdowns", 0),
            "rushing_attempts": proj.get("rushing_attempts", 0),
            "receiving_targets": proj.get("receiving_targets", 0),
            "receptions": proj.get("receptions", 0),
            "receiving_yards": proj.get("receiving_yards", 0),
            "receiving_tds": proj.get("receiving_touchdowns", 0),
            "adp": proj.get("adp", 999), "adp_ppr": proj.get("adp_ppr", 999),
            "adp_half_ppr": proj.get("adp_half_ppr", 999), "adp_2qb": proj.get("adp_2qb", 999),
            "bye_week": None, "risk": 5, "upside": 5,
            "games_played": proj.get("games_played", 0) or (17 if pos != "QB" else 0),
            "snap_pct": None,
        }
        # Sleeper projections often omit targets; estimate from receptions.
        if not entry["receiving_targets"] and entry["receptions"]:
            cr = 0.68 if pos == "TE" else 0.65
            entry["receiving_targets"] = round(entry["receptions"] / cr)
        if pos == "QB":
            include = (entry["passing_attempts"] or entry["passing_yards"] or entry["games_played"])
        else:
            include = any(entry[k] for k in ("passing_yards","rushing_attempts","receiving_targets","receptions"))
        if include:
            seed[team][pos].append(entry)

    # Sort skill positions by ADP/volume; project QB games from passing-yards share
    # (Sleeper sets gp=18 for everyone in projections, so we can't use it directly).
    for team in seed:
        for pos in ("RB", "WR", "TE"):
            seed[team][pos].sort(key=lambda e: (e.get("adp_ppr") or 999,
                -(e.get("passing_yards",0)+e.get("rushing_yards",0)+e.get("receiving_yards",0))))
        _project_qb_games(seed[team]["QB"])
        seed[team]["QB"].sort(key=lambda e: (
            -(e.get("games", 0)), -(e.get("passing_attempts", 0)), -(e.get("passing_yards", 0))))
        _assign_qb_snap_shares(seed[team]["QB"])
    return seed, history

def _project_qb_games(qbs):
    """Project games for a team's QBs from their share of projected passing yards.
    Clear starter (>=75% of team pass yards) -> 17 games, others 0. Committee -> games
    proportional to yards (rounded up). Tiny share (<12%, Sleeper ADP padding) -> 0."""
    if not qbs:
        return
    if len(qbs) == 1:
        qbs[0]["games"] = 17
        qbs[0]["games_played"] = 17
        return
    total = sum(q.get("passing_yards", 0) for q in qbs)
    if total <= 0:
        for i, q in enumerate(qbs):
            q["games"] = 17 if i == 0 else 0
            q["games_played"] = q["games"]
        return
    shares = [q.get("passing_yards", 0) / total for q in qbs]
    top = max(shares)
    if top >= 0.75:
        for q, sh in zip(qbs, shares):
            q["games"] = 17 if sh == top else 0
            q["games_played"] = q["games"]
        return
    import math
    for q, sh in zip(qbs, shares):
        g = 0 if sh < 0.12 else min(17, math.ceil(sh * 17))
        q["games"] = g
        q["games_played"] = g

def _assign_qb_snap_shares(qbs):
    """Primary QB (most games) gets games/17; the remainder is split among the others by
    their games. A lone QB gets 100%."""
    if not qbs:
        return
    if len(qbs) == 1:
        qbs[0]["snap_share"] = 1
        return
    gkey = "games"
    if not any(q.get(gkey, q.get("games_played", 0)) for q in qbs):
        for q in qbs:
            q["snap_share"] = 1 / len(qbs)
        return
    starter = qbs[0]
    sg = starter.get(gkey, starter.get("games_played", 0))
    starter_share = min(1.0, sg / 17.0)
    starter["snap_share"] = starter_share
    remainder = max(0.0, 1.0 - starter_share)
    others = qbs[1:]
    others_gp = sum(q.get(gkey, q.get("games_played", 0)) for q in others)
    if others_gp > 0:
        for q in others:
            q["snap_share"] = remainder * (q.get(gkey, q.get("games_played", 0)) / others_gp)
    else:
        for q in others:
            q["snap_share"] = remainder / len(others)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026, help="projection season (default 2026)")
    ap.add_argument("--history", type=int, default=5,
                    help="prior seasons of stats to bundle (default 5; e.g. --history 10 for ten years)")
    ap.add_argument("--refresh", action="store_true", help="ignore caches, re-download")
    args = ap.parse_args()

    print(f"TripleCrown seed builder — projections {args.season}, last {args.history} seasons of stats\n")
    print("Step 1/6: players")
    players = get_players(args.refresh)

    print("\nStep 2/6: projections")
    proj_idx = build_projection_index(args.season, args.refresh)

    print(f"\nStep 3/6: historical stats ({args.season-args.history}–{args.season-1})")
    stats_by_season = {}
    for yr in range(args.season-1, args.season-1-args.history, -1):
        stats_by_season[str(yr)] = build_stats_index(yr, args.refresh)

    print("\nStep 4/6: per-team history (QB weekly splits for traded players)")
    history = build_history(players, stats_by_season, args.refresh)

    print("\nStep 5/6: assembling seed")
    seed, history = assemble(players, proj_idx, stats_by_season, history, args.season)

    print("\nStep 6/7: FantasyPros ECR (replaces ADP)")
    ecr = build_ecr(args.refresh)

    print("\nStep 7/7: OverTheCap contracts (dynasty age/APY/FA)")
    contracts = build_contracts(args.refresh)

    # Keep only seasons that actually returned stats (older years may be unavailable).
    nonempty_seasons = sorted([s for s, idx in stats_by_season.items() if idx], reverse=True)
    if len(nonempty_seasons) < len(stats_by_season):
        missing = sorted(set(stats_by_season) - set(nonempty_seasons), reverse=True)
        print(f"  (note: no data returned for {', '.join(missing)} — omitting those tabs)")

    # Emit the JS the app embeds
    BUILDER_VERSION = "2.3-contracts"   # bump when aggregation logic changes
    out_js = "triplecrown_seed.js"
    with open(out_js, "w") as f:
        f.write("// Auto-generated by build_seed.py — do not edit by hand.\n")
        f.write(f"// builder_version: {BUILDER_VERSION}\n")
        f.write(f"const SEED_SEASON = {args.season};\n")
        f.write(f"const SEED_DATA = {json.dumps(seed, separators=(',',':'))};\n")
        f.write(f"const SEED_HISTORY = {json.dumps(history, separators=(',',':'))};\n")
        f.write(f"const SEED_HISTORY_SEASONS = {json.dumps(nonempty_seasons)};\n")
        f.write(f"const SEED_ECR = {json.dumps(ecr, separators=(',',':'))};\n")
        f.write(f"const SEED_CONTRACTS = {json.dumps(contracts, separators=(',',':'))};\n")
    # Also emit the raw seed json for reference
    with open("triplecrown_seed.json", "w") as f:
        json.dump({"season": args.season, "builder_version": BUILDER_VERSION,
                   "seed": seed, "history": history,
                   "history_seasons": nonempty_seasons, "ecr": ecr,
                   "contracts": contracts}, f, indent=2)

    nplayers = sum(len(seed[t][p]) for t in seed for p in seed[t])
    print(f"\nDone (builder {BUILDER_VERSION}). {nplayers} players across {len(TEAMS)} teams.")
    print(f"  • triplecrown_seed.json → load this in the app via the 📦 Seed button (recommended)")
    print(f"  • {out_js}  → optional: embed into the HTML to replace the SEED_DATA block")
    print(f"  • {CACHE_DIR}/ → cached raw API responses (delete to force refresh)")
    print("\nNext: open ff_projections.html. By default it pulls live 2026 projections from")
    print("Sleeper on load. To use this prebuilt snapshot (with historical seasons), click")
    print("the 📦 Seed button and choose triplecrown_seed.json — no HTML editing needed.")

if __name__ == "__main__":
    main()
