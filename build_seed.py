#!/usr/bin/env python3
"""
TripleCrown seed builder
─────────────────────
Fetches Sleeper's player database, 2026 season projections, and the last N
seasons of real stats, caches them locally (so re-runs are fast), and emits a
single `triplecrown_seed.json` (plus optional nflverse sidecars) that the
TripleCrown web app auto-loads.

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
from html.parser import HTMLParser as _HTMLParser
FANTASYPROS_URLS = {
    "half_ppr":  "https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php",
    "ppr":       "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php",
    "std":       "https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php",
    "dynasty":   "https://www.fantasypros.com/nfl/rankings/dynasty-overall.php",
    "dynasty_superflex": "https://www.fantasypros.com/nfl/rankings/dynasty-superflex.php",
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


# ── OverTheCap contracts (age / APY / total / guaranteed / free-agency year) ──
# Powers the Dynasty rankings Age/APY/FA columns AND the player-card contract band. Every
# OverTheCap position page shares the same 8-column table, so we pull all of them (not just the
# fantasy skill positions) — the card can then show a contract for any player. The tables are
# plain HTML (no JS), so stdlib + a light regex parse is enough — no BeautifulSoup dependency.
# Columns on the page: player, team, age, total value, avg/year (APY), total guaranteed,
# fully guaranteed, free agency (year the current deal expires → player hits FA).
OTC_URLS = {
    "QB":   "https://overthecap.com/position/quarterback",
    "RB":   "https://overthecap.com/position/running-back",
    "FB":   "https://overthecap.com/position/fullback",
    "WR":   "https://overthecap.com/position/wide-receiver",
    "TE":   "https://overthecap.com/position/tight-end",
    "LT":   "https://overthecap.com/position/left-tackle",
    "LG":   "https://overthecap.com/position/left-guard",
    "C":    "https://overthecap.com/position/center",
    "RG":   "https://overthecap.com/position/right-guard",
    "RT":   "https://overthecap.com/position/right-tackle",
    "IDL":  "https://overthecap.com/position/interior-defensive-line",
    "EDGE": "https://overthecap.com/position/edge-rusher",
    "LB":   "https://overthecap.com/position/linebacker",
    "CB":   "https://overthecap.com/position/cornerback",
    "S":    "https://overthecap.com/position/safety",
    "K":    "https://overthecap.com/position/kicker",
    "P":    "https://overthecap.com/position/punter",
    "LS":   "https://overthecap.com/position/long-snapper",
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

def _otc_money(raw):
    """Parse an OverTheCap dollar cell ('$64,000,000') → int dollars, or None."""
    m = _re.search(r"[\d,]+", (raw or "").replace("$", ""))
    if not m:
        return None
    try:
        return int(m.group().replace(",", ""))
    except Exception:
        return None

def fetch_otc_contracts(pos, url, refresh):
    """Fetch one OverTheCap position page → {nameKey: {age, apy, fa, total, gtd}}."""
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
        # age → int if possible
        age = None
        m = _re.search(r"\d+", cells[2])
        if m:
            age = int(m.group())
        # APY / total value / total guaranteed → normalized numeric dollars (strip $ and commas)
        apy = _otc_money(cells[4])
        total = _otc_money(cells[3])
        gtd = _otc_money(cells[5])
        # free agency → the 4-digit year the player becomes a free agent
        fa = None
        m = _re.search(r"(20\d{2})", cells[7])
        if m:
            fa = int(m.group(1))
        out[key] = {"age": age, "apy": apy, "fa": fa, "total": total, "gtd": gtd}
    print(f" ok ({len(out)} players)")
    with open(cache_path, "w") as f:
        json.dump(out, f)
    return out

def build_contracts(refresh):
    """Build {nameKey: {age, apy, fa, total, gtd, pos}} merged across all positions."""
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
        print(f"\n  Contracts loaded: {total} players (age/APY/total/guaranteed/free-agency year)")
    return contracts


# ── KeepTradeCut dynasty player IDs (keeptradecut.com) ───────────────────────
# KTC is a popular crowd-sourced dynasty trade-value site. Its dynasty-rankings page embeds a
# `var playersArray = [...]` of every ranked dynasty asset, each carrying a ready-made URL slug
# (e.g. "bijan-robinson-1414"). We bake a {nameKey: {slug, pos}} map so a player card can link
# straight to that player's KTC page (opened in a new tab) for at-a-glance dynasty value/trend.
# Not browser-reachable (CORS / bot protection), so — like the other pulled sources — we fetch
# it here and bundle the result into the seed. A miss (no match) simply hides the link.
KTC_URL = "https://keeptradecut.com/dynasty-rankings"
KTC_POS_KEEP = {"QB", "RB", "WR", "TE"}

def _extract_js_array(html, varname):
    """Extract a `var <varname> = [ ... ]` JSON array from page HTML via bracket-counting
    (robust against brackets/quotes inside the data). Returns the parsed list, or None."""
    i = html.find(varname)
    if i < 0:
        return None
    start = html.find("[", i)
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
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(html[start:j + 1])
                    except Exception:
                        return None
    return None

def parse_ktc_players(html):
    """Parse KTC's embedded playersArray HTML → {nameKey: {slug, pos}} for skill players."""
    arr = _extract_js_array(html, "playersArray")
    out = {}
    for p in (arr or []):
        pos = p.get("position")
        slug = p.get("slug")
        name = p.get("playerName")
        if pos not in KTC_POS_KEEP or not slug or not name:
            continue
        key = _norm_name(name)
        if key:
            out[key] = {"slug": slug, "pos": pos}
    return out

def build_ktc(refresh):
    """Fetch KTC dynasty rankings → {nameKey: {slug, pos}} for skill players (QB/RB/WR/TE)."""
    cache_path = os.path.join(CACHE_DIR, "ktc", "players.json")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if not refresh and os.path.exists(cache_path):
        print("  → KTC: using cache")
        with open(cache_path) as f:
            return json.load(f)
    print("  → fetching KeepTradeCut dynasty rankings ...", end="", flush=True)
    try:
        req = request.Request(KTC_URL, headers=UA)
        with request.urlopen(req, timeout=60) as r:
            raw = r.read()
        # Some responses arrive gzip-encoded; decode when the magic bytes are present.
        if raw[:2] == b"\x1f\x8b":
            import gzip, io
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
        html = raw.decode("utf-8", "replace")
    except Exception as e:
        print(f" FAILED ({type(e).__name__}: {e}) — KTC links will be omitted")
        return {}
    out = parse_ktc_players(html)
    if not out:
        print(" FAILED (couldn't parse playersArray) — KTC links will be omitted")
        return {}
    print(f" ok ({len(out)} players)")
    with open(cache_path, "w") as f:
        json.dump(out, f)
    return out


# ── SumerSports advanced per-player stats (sumersports.com) ──────────────────────
# Per-player advanced metrics by position (QB/RB/WR/TE), for the "Advanced (SumerSports)"
# toggle on the rankings page. The pages are server-side rendered (the stat <table> is in the
# raw HTML), so stdlib fetch + a light parse is enough — but the browser can't reach them
# (no CORS), so we pull here and bake the result into the seed as SEED_SUMER.
#
# Reference-season only: these stats exist for completed seasons (2022-2025 as of now), so we
# bake one table per position PER SEASON. The app shows them only when viewing a matching
# reference season (never on the 2026 projections, never for seasons without data).
SUMER_POS_URLS = {
    "QB": "https://sumersports.com/players/quarterback/",
    "RB": "https://sumersports.com/players/running-back/",
    "WR": "https://sumersports.com/players/wide-receiver/",
    "TE": "https://sumersports.com/players/tight-end/",
}
# Seasons to bundle. SumerSports only publishes 2022+ (subject to change); missing seasons
# are simply omitted so the app never shows an empty tab for them.
SUMER_SEASONS = [2025, 2024, 2023, 2022]
# Columns that identify the row rather than being a stat — dropped from the stat set. The rest
# (whatever the page shows for that position) become the ordered `columns` the app renders.
SUMER_META_COLS = {"Player Name", "Season", "Team", "Position", "Rank"}
# Refinement splits (When Leading / Red Zone / vs. Man / box counts / …) — the game-situation
# filters SumerSports exposes as its "Refinement" dropdown. We bake one extra table per
# refinement per position/season (URL: ?refinement=<value>&season=YYYY) so the app's
# "Situational" dropdown can swap the Adv. Metrics columns to a specific split. Values below
# are the exact refinement query values the site accepts for each position (verified live).
SUMER_REFINEMENTS = {
    "QB": ["when_leading", "when_trailing", "red_zone", "non_garbage_time", "late_down",
           "play_action", "pure_dropback", "vs_man", "vs_zone", "blitzed", "pressured"],
    "WR": ["when_leading", "when_trailing", "red_zone", "non_garbage_time", "late_down",
           "vs_man", "vs_zone"],
    "TE": ["when_leading", "when_trailing", "red_zone", "non_garbage_time", "late_down",
           "vs_man", "vs_zone"],
    "RB": ["when_leading", "when_trailing", "red_zone", "non_garbage_time", "late_down",
           "early_downs", "zone-concepts", "duo-concepts", "gap-concepts",
           "under-7-box-defenders", "7-box-defenders", "8-plus-box-defenders"],
}

class _SumerTableParser(_HTMLParser):
    """Parse the first <table> on a SumerSports page into (headers, rows-of-cells).
    Uses stdlib html.parser so `<thead>` isn't mistaken for a `<th>` (a naive regex on
    `<th[^>]*>` matches `<thead>` too)."""
    def __init__(self):
        super().__init__()
        self._in_table = False
        self._cell = False
        self._buf = ""
        self._row = []
        self.headers = []
        self.rows = []
    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._in_table = True
        elif self._in_table and tag in ("th", "td"):
            self._cell = True
            self._buf = ""
        elif self._in_table and tag == "tr":
            self._row = []
    def handle_endtag(self, tag):
        if tag == "table":
            self._in_table = False
        elif self._in_table and tag in ("th", "td"):
            self._cell = False
            self._row.append(self._buf.strip())
        elif self._in_table and tag == "tr" and self._row:
            if not self.headers and any(self._row):
                self.headers = self._row[:]
            else:
                self.rows.append(self._row[:])
    def handle_data(self, data):
        if self._cell:
            self._buf += data

def _sumer_num(raw):
    """Parse a SumerSports cell into a number when possible (strip commas + %), else the
    trimmed string. Percentages keep their numeric magnitude (e.g. '35.82%' -> 35.82)."""
    s = (raw or "").strip()
    if not s or s in ("-", "—", "N/A"):
        return None
    t = s.replace(",", "").replace("%", "").strip()
    try:
        return float(t) if ("." in t or "%" in s) else int(t)
    except ValueError:
        return s

def fetch_sumer_table(pos, season, refresh, refinement=None):
    """Fetch one SumerSports position page for a season → a data-driven table dict:
        {columns:[...], pct_cols:[...], players:{nameKey:{values:[...], team, rank}}}
    or None if the page couldn't be fetched/parsed. `refinement` selects a game-situation
    split (red_zone, when_trailing, …) via the site's ?refinement= param; None = base overall."""
    tag = refinement or "base"
    # Organize sumer files into per-season subfolders (like weekly): sumer/<season>/<pos>_<tag>.json
    cache_path = os.path.join(CACHE_DIR, "sumer", str(season), f"{pos}_{tag}.json")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if not refresh and os.path.exists(cache_path):
        print(f"  → sumer {pos} {season} ({tag}): using cache")
        with open(cache_path) as f:
            return json.load(f)
    url = SUMER_POS_URLS[pos] + f"?season={season}"
    if refinement:
        url += f"&refinement={refinement}"
    print(f"  → fetching sumer {pos} {season} ({tag}) ...", end="", flush=True)
    try:
        req = request.Request(url, headers=UA)
        with request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f" FAILED ({type(e).__name__}: {e})")
        return None
    p = _SumerTableParser()
    p.feed(html)
    if not p.headers or not p.rows:
        print(" no table")
        return None
    headers = p.headers
    # Stat columns = every header that isn't a row-identifier. Preserve page order.
    stat_cols = [h for h in headers if h not in SUMER_META_COLS]
    name_i = headers.index("Player Name") if "Player Name" in headers else 0
    season_i = headers.index("Season") if "Season" in headers else None
    stat_idx = [headers.index(h) for h in stat_cols]
    players = {}
    pct = set()
    for cells in p.rows:
        if len(cells) < len(headers):
            continue
        # Row season may differ from the requested one on some pages — trust the request.
        raw_name = cells[name_i]
        name = _re.sub(r"^\s*\d+\.\s*", "", raw_name).strip()
        key = _norm_name(name)
        if not key:
            continue
        values = []
        for ci, col in zip(stat_idx, stat_cols):
            raw = cells[ci]
            if "%" in raw:
                pct.add(col)
            values.append(_sumer_num(raw))
        # Only the ordered `values` are consumed by the app (matched to `columns` by index);
        # the site's rank prefix + the empty team cell are dropped to keep the seed lean.
        players[key] = {"values": values}
    if not players:
        print(" empty")
        return None
    out = {"columns": stat_cols, "pct_cols": sorted(pct), "players": players}
    print(f" ok ({len(players)} players, {len(stat_cols)} cols)")
    with open(cache_path, "w") as f:
        json.dump(out, f)
    return out

def build_sumer(refresh):
    """Build {season: {POS: {columns, pct_cols, players, refinements:{...}}}} across QB/RB/WR/TE
    for each completed season we can fetch. Each position also carries a `refinements` map of
    game-situation splits (When Leading / Red Zone / vs. Man / box counts …) keyed by the site's
    refinement value, each holding its own {columns, pct_cols, players}. Seasons/positions/
    refinements that fail are simply omitted so the app never renders an empty advanced tab."""
    sumer = {}
    for season in SUMER_SEASONS:
        per_pos = {}
        for pos in SUMER_POS_URLS:
            tbl = fetch_sumer_table(pos, season, refresh)
            if tbl and tbl.get("players"):
                # Situational refinements ride along inside the base table (best-effort — any
                # that fail to fetch/parse are dropped so the base view is never blocked).
                refis = {}
                for r in SUMER_REFINEMENTS.get(pos, []):
                    rt = fetch_sumer_table(pos, season, refresh, refinement=r)
                    if rt and rt.get("players"):
                        refis[r] = rt
                if refis:
                    tbl = dict(tbl)
                    tbl["refinements"] = refis
                per_pos[pos] = tbl
        if per_pos:
            sumer[str(season)] = per_pos
    seasons = sorted(sumer.keys(), reverse=True)
    if not sumer:
        print("\n  ⚠ WARNING: no SumerSports data fetched — the Advanced (SumerSports) toggle")
        print("    won't appear. (No internet, site blocked, or layout changed.)")
    else:
        per = ", ".join(f"{s}:{sum(len(t['players']) for t in sumer[s].values())}" for s in seasons)
        print(f"\n  SumerSports loaded — players per season: {per}")
    return sumer


# ── Warren Sharp advanced offensive stats (sharpfootballanalysis.com) ────────────
# Read-only reference tables for the "Advanced Stats" tab: previous-season offensive
# metrics + pace/personnel/tendencies/O-line, plus league ranks per column. These pages
# are plain HTML tables keyed by team NICKNAME (e.g. "Rams"), so we map nickname → our
# team code. Like ECR/contracts, they can't be fetched from the browser (no CORS), so we
# pull here and bake the result into the seed as SEED_SHARP.
SHARP_URLS = {
    "offense":        "https://www.sharpfootballanalysis.com/stats-nfl/nfl-offensive-stats/",
    "offensive_line": "https://www.sharpfootballanalysis.com/stats-nfl/nfl-offensive-line-stats/",
    "tendencies":     "https://www.sharpfootballanalysis.com/stats-nfl/nfl-offensive-tendencies-stats/",
    "personnel":      "https://www.sharpfootballanalysis.com/stats-nfl/nfl-offensive-personnel/",
    "pace":           "https://www.sharpfootballanalysis.com/stats-nfl/nfl-team-pace-stats/",
    # Defensive tables (lesser priority, categorized separately in the app)
    "defensive":            "https://www.sharpfootballanalysis.com/stats-nfl/nfl-defensive-stats/",
    "defensive_line":       "https://www.sharpfootballanalysis.com/stats-nfl/nfl-defensive-line-stats/",
    "defensive_tendencies": "https://www.sharpfootballanalysis.com/stats-nfl/nfl-defensive-tendencies/",
    "coverage_schemes":     "https://www.sharpfootballanalysis.com/stats-nfl/nfl-coverage-schemes/",
    "coverage_by_position": "https://www.sharpfootballanalysis.com/stats-nfl/nfl-coverage-stats-by-position/",
}
# Friendly titles for the app's table toggle.
SHARP_TITLES = {
    "offense":        "Offensive Metrics",
    "offensive_line": "Offensive Line",
    "tendencies":     "Tendencies",
    "personnel":      "Personnel",
    "pace":           "Pace",
    "defensive":            "Defensive Metrics",
    "defensive_line":       "Defensive Line",
    "defensive_tendencies": "Defensive Tendencies",
    "coverage_schemes":     "Coverage Schemes",
    "coverage_by_position": "Coverage by Position",
}
# Which side of the ball each table belongs to (for the app's Offense/Defense grouping).
SHARP_CATEGORY = {
    "offense":"offense",
    "offensive_line":"offense",
    "tendencies":"offense",
    "personnel":"offense",
    "pace":"offense",
    "defensive":"defense",
    "defensive_line":"defense",
    "defensive_tendencies":"defense",
    "coverage_schemes":"defense",
    "coverage_by_position":"defense",
}
# Team NICKNAME (as shown in most Sharp stat tables) → our team code.
NICK_TO_CODE = {
    "cardinals":"ARI","falcons":"ATL","ravens":"BAL","bills":"BUF","panthers":"CAR",
    "bears":"CHI","bengals":"CIN","browns":"CLE","cowboys":"DAL","broncos":"DEN",
    "lions":"DET","packers":"GB","texans":"HOU","colts":"IND","jaguars":"JAX",
    "chiefs":"KC","chargers":"LAC","rams":"LAR","raiders":"LV","dolphins":"MIA",
    "vikings":"MIN","patriots":"NE","saints":"NO","giants":"NYG","jets":"NYJ",
    "eagles":"PHI","steelers":"PIT","seahawks":"SEA","49ers":"SF","buccaneers":"TB",
    "titans":"TEN","commanders":"WAS",
}
# Full team name (as shown on the SOS page) → our team code. Also emitted to the app so
# team pages can show "Cincinnati Bengals" instead of "CIN".
FULLNAME_TO_CODE = {
    "arizona cardinals":"ARI","atlanta falcons":"ATL","baltimore ravens":"BAL",
    "buffalo bills":"BUF","carolina panthers":"CAR","chicago bears":"CHI",
    "cincinnati bengals":"CIN","cleveland browns":"CLE","dallas cowboys":"DAL",
    "denver broncos":"DEN","detroit lions":"DET","green bay packers":"GB",
    "houston texans":"HOU","indianapolis colts":"IND","jacksonville jaguars":"JAX",
    "kansas city chiefs":"KC","los angeles chargers":"LAC","los angeles rams":"LAR",
    "las vegas raiders":"LV","miami dolphins":"MIA","minnesota vikings":"MIN",
    "new england patriots":"NE","new orleans saints":"NO","new york giants":"NYG",
    "new york jets":"NYJ","philadelphia eagles":"PHI","pittsburgh steelers":"PIT",
    "seattle seahawks":"SEA","san francisco 49ers":"SF","tampa bay buccaneers":"TB",
    "tennessee titans":"TEN","washington commanders":"WAS",
}
# code → full display name (inverse of the above) for the app.
CODE_TO_FULLNAME = {v: k.title().replace("Ny ","NY ").replace("Lv ","LV ") for k, v in FULLNAME_TO_CODE.items()}
# fix a couple of title-case quirks
CODE_TO_FULLNAME["SF"] = "San Francisco 49ers"
SHARP_SOS_URL = "https://www.sharpfootballanalysis.com/analysis/nfl-strength-of-schedule/"
# nflverse public schedule (plain CSV, stdlib-readable) — used to compute our OWN strength-of-
# schedule ranking from the sum of each team's opponents' Vegas win totals.
NFLDATA_GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
SCHED_TO_SEED = {"LA": "LAR"}   # nflverse schedule codes that differ from the seed's codes

# Columns where a LOWER value is better (so rank 1 = lowest). Everything else: higher=better.
# Matched by case-insensitive substring against the column header.
SHARP_OFF_LOWER_IS_BETTER = [
    "pressure rate allowed",
    "no blitz pressure rate allowed",
    "rush stuff rate",
    "sec/play",
    "sec/play last 5",
]
# Columns where a HIGHER value is better even though the header might otherwise look defensive.
# These override the lower-is-better rules when both match the same text.
SHARP_OFF_HIGHER_IS_BETTER = [
    "yards before contact per rb rush",
    "time to throw",
    "epa/play",
    "yards/play",
    "yards per play",
    "y/pl last 5",
    "points per drive",
    "explosive play rate",
    "down conversion rate",
    "neutral db rate",
    "neutral db rate last 5",
    "off plays/g",
    "total plays/g",
    "3wr rate",
    "3wr rate last 5",
    "multi te rate",
    "multi rb rate",
    "motion rate",
    "play action rate",
    "airyards/att",
    "shotgun rate",
    "nohuddle rate",
]
# Columns where a LOWER value is better (so rank 1 = lowest). Everything else: higher=better.
# Defensive stats that are "good" when low (e.g. yards/play allowed, points/play allowed, etc.)
SHARP_DEF_LOWER_IS_BETTER = [
    "yards before contact per rb rush",
    "ypt allowed wr",
    "ypt allowed te",
    "ypt allowed rb",
    "ypt allowed outside",
    "ypt allowed slot",
    "yards per play allowed",
    "y/pl last 5",
    "points per drive allowed",
    "explosive play rate allowed",
    "down conversion rate allowed",
]
# Columns where a HIGHER value is better.
# Defensive stats that are "good" when high (e.g. pressure rate, blitz rate, etc.)
SHARP_DEF_HIGHER_IS_BETTER = [
    "pressure rate",
    "no blitz pressure rate",
    "rush stuff rate",
    "blitz rate",
    "light box rate",
    "heavy box rate",
    "sub package rate",
    "man rate",
    "zone rate",
    "middle closed rate",
    "middle open rate",
    "epa/play",
]

def _sharp_off_col_lower_better(col):
    c = col.lower()
    if any(c in k for k in SHARP_OFF_HIGHER_IS_BETTER):
        return False
    return any(k in c for k in SHARP_OFF_LOWER_IS_BETTER)

def _sharp_def_col_lower_better(col):
    c = col.lower()
    if any(c in k for k in SHARP_DEF_HIGHER_IS_BETTER):
        return False
    return any(k in c for k in SHARP_DEF_LOWER_IS_BETTER)

def _parse_sharp_table(html):
    """Parse the first real data <table> on a Sharp page into (headers, rows-of-cells)
    using only stdlib regex — mirrors the user's BeautifulSoup parser without the dep."""
    # Grab the first <table>...</table> (their stat table is the first on the page body).
    m = _re.search(r"<table[^>]*>(.*?)</table>", html, _re.DOTALL | _re.IGNORECASE)
    if not m:
        return [], []
    tbl = m.group(1)
    # Headers: prefer <thead> ths; fall back to first row's th/td.
    headers = []
    thead = _re.search(r"<thead[^>]*>(.*?)</thead>", tbl, _re.DOTALL | _re.IGNORECASE)
    header_src = thead.group(1) if thead else tbl
    for th in _re.findall(r"<th[^>]*>(.*?)</th>", header_src, _re.DOTALL | _re.IGNORECASE):
        headers.append(_strip_tags(th))
    # Body rows
    body = _re.search(r"<tbody[^>]*>(.*?)</tbody>", tbl, _re.DOTALL | _re.IGNORECASE)
    body_src = body.group(1) if body else tbl
    rows = []
    for tr in _re.findall(r"<tr[^>]*>(.*?)</tr>", body_src, _re.DOTALL | _re.IGNORECASE):
        cells = [_strip_tags(td) for td in _re.findall(r"<td[^>]*>(.*?)</td>", tr, _re.DOTALL | _re.IGNORECASE)]
        if cells and (not headers or len(cells) == len(headers)):
            rows.append(cells)
    return headers, rows

def _sharp_cell_num(text):
    """Return a float if the cell is numeric (handles %, commas), else None."""
    t = (text or "").strip().rstrip("%").replace(",", "").strip()
    if t == "":
        return None
    try:
        return float(t)
    except ValueError:
        return None

def _sharp_col_is_rate(col):
    """Columns whose values are percentages — the app appends % at display time.
    We DON'T bake % into the stored number so ranking/sorting stay numeric."""
    c = (col or "").lower()
    return "rate" in c or "%" in c or "share" in c or col.strip().endswith("%")

def _sharp_row_code(name):
    """Map a Sharp table's team cell (nickname OR full name) to our code."""
    n = (name or "").strip().lower()
    return NICK_TO_CODE.get(n) or FULLNAME_TO_CODE.get(n)

def fetch_sharp_table(key, url, refresh):
    """Pull one Sharp page → {columns, title, category, pct_cols, teams:{CODE:{values,ranks}}}."""
    cache_path = os.path.join(CACHE_DIR, "sharp", f"{key}.json")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if not refresh and os.path.exists(cache_path):
        print(f"  → sharp {key}: using cache")
        with open(cache_path) as f:
            return json.load(f)
    print(f"  → fetching sharp {key} ...", end="", flush=True)
    try:
        req = request.Request(url, headers=UA)
        with request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f" FAILED ({type(e).__name__}: {e}) — skipping {key}")
        return None
    headers, rows = _parse_sharp_table(html)
    if not headers or not rows:
        print(" no table found — skipping")
        return None
    # First column is the team name; the rest are stat columns.
    stat_cols = headers[1:]
    pct_cols = [c for c in stat_cols if _sharp_col_is_rate(c)]
    teams = {}
    raw_by_col = {c: [] for c in stat_cols}  # (code, value) for ranking
    for cells in rows:
        code = _sharp_row_code(cells[0])
        if not code:
            continue
        values = {}
        for ci, col in enumerate(stat_cols):
            v = _sharp_cell_num(cells[ci + 1])
            values[col] = v
            if v is not None:
                raw_by_col[col].append((code, v))
        teams[code] = {"values": values, "ranks": {}}
    # Compute 1..32 rank per column (1 = best), respecting per-column direction.
    for col, pairs in raw_by_col.items():
        if SHARP_CATEGORY[key] == "offense":
            lower_better = _sharp_off_col_lower_better(col)
        else:
            lower_better = _sharp_def_col_lower_better(col)
        ordered = sorted(pairs, key=lambda cv: cv[1], reverse=not lower_better)
        for rank, (code, _v) in enumerate(ordered, start=1):
            if code in teams:
                teams[code]["ranks"][col] = rank
    out = {"columns": stat_cols, "title": SHARP_TITLES.get(key, key),
           "category": SHARP_CATEGORY.get(key, "offense"), "pct_cols": pct_cols, "teams": teams}
    print(f" ok ({len(teams)} teams, {len(stat_cols)} cols, {SHARP_CATEGORY.get(key,'offense')})")
    with open(cache_path, "w") as f:
        json.dump(out, f)
    return out

def build_sharp(refresh):
    """Build {tableKey: {columns, title, teams:{CODE:{values,ranks}}}} across all pages."""
    sharp = {}
    for key, url in SHARP_URLS.items():
        tbl = fetch_sharp_table(key, url, refresh)
        if tbl:
            sharp[key] = tbl
    if not sharp:
        print("\n  ⚠ WARNING: no Warren Sharp stats fetched — the Advanced Stats tab will be empty.")
    else:
        cols = sum(len(t["columns"]) for t in sharp.values())
        print(f"\n  Sharp advanced stats loaded: {len(sharp)} tables, {cols} total columns")
    return sharp


def _sos_opponent_ranks(win_totals, season, refresh):
    """Our own SOS: sum each team's opponents' Vegas win totals from the real schedule, then rank
    ascending (1 = easiest slate). Returns {CODE:{opp_win_total, opp_games, rank}} or {} on failure.
    Uses the nflverse schedule CSV (stdlib csv reader — no pandas needed)."""
    import csv, io
    cache_path = os.path.join(CACHE_DIR, "sharp", f"schedule_{season}.csv")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    text = None
    if not refresh and os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            text = f.read()
    if text is None:
        try:
            req = request.Request(NFLDATA_GAMES_URL, headers=UA)
            with request.urlopen(req, timeout=60) as r:
                text = r.read().decode("utf-8", "replace")
            with open(cache_path, "w", encoding="utf-8") as f:
                f.write(text)
        except Exception as e:
            print(f"  (SOS schedule fetch failed: {type(e).__name__}: {e})")
            return {}
    opps = {}
    for row in csv.DictReader(io.StringIO(text)):
        if str(row.get("season")) != str(season) or row.get("game_type") != "REG":
            continue
        h = SCHED_TO_SEED.get(row["home_team"], row["home_team"])
        a = SCHED_TO_SEED.get(row["away_team"], row["away_team"])
        opps.setdefault(h, []).append(a)
        opps.setdefault(a, []).append(h)
    if not opps:
        return {}
    out = {}
    for code, ol in opps.items():
        vals = [win_totals[o] for o in ol if win_totals.get(o) is not None]
        out[code] = {"opp_win_total": round(sum(vals), 1), "opp_games": len(vals)}
    for i, code in enumerate(sorted(out, key=lambda c: out[c]["opp_win_total"])):
        out[code]["rank"] = i + 1
    return out


def build_sos(refresh, season=2026):
    """Strength of schedule → {CODE:{rank, win_total, opp_win_total, name}}.
    Vegas win totals come from the scraped table; the RANK is our own calculation = the sum of
    each team's opponents' win totals (rank 1 = easiest). Falls back to the scraped rank only if
    the schedule can't be fetched."""
    cache_path = os.path.join(CACHE_DIR, "sharp", "sos.json")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if not refresh and os.path.exists(cache_path):
        print("  → SOS: using cache")
        with open(cache_path) as f:
            return json.load(f)
    print("  → fetching strength of schedule ...", end="", flush=True)
    try:
        req = request.Request(SHARP_SOS_URL, headers=UA)
        with request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f" FAILED ({type(e).__name__}: {e})")
        return {}
    headers, rows = _parse_sharp_table(html)
    # Expected headers: ["2026 SOS Ranking", "Team", "2026 Vegas Win Total"]
    out = {}
    for cells in rows:
        if len(cells) < 3:
            continue
        rank = _sharp_cell_num(cells[0])
        code = _sharp_row_code(cells[1])
        win_total = _sharp_cell_num(cells[2])
        if code and rank is not None:
            out[code] = {"rank": int(rank), "win_total": win_total,
                         "name": CODE_TO_FULLNAME.get(code, code)}
    if not out:
        print(" no SOS table found")
        return out
    # Replace the scraped rank with our own opponent-win-total ranking.
    win_totals = {c: out[c]["win_total"] for c in out if out[c].get("win_total") is not None}
    ours = _sos_opponent_ranks(win_totals, season, refresh)
    if ours:
        for c in out:
            if c in ours:
                out[c]["rank"] = ours[c]["rank"]
                out[c]["opp_win_total"] = ours[c]["opp_win_total"]
                out[c]["opp_games"] = ours[c]["opp_games"]
        print(f" ok ({len(out)} teams, own opponent-win-total ranking)")
    else:
        print(f" ok ({len(out)} teams, scraped ranking — schedule unavailable)")
    with open(cache_path, "w") as f:
        json.dump(out, f)
    return out


# ── NFL coordinators (Wikipedia) + head-coach playcaller list ────────────────────
# Wikipedia lists current OCs/DCs with a "Previous coaching position" column that names
# the coach's PRIOR team and role — the key to the app's Coordinators tab. When a team has
# a brand-new (Since == projection season) coordinator who came from ANOTHER NFL team, the
# app can carry that former team's tendencies/personnel over as a forecast. When the
# coordinator has been in place since a PRIOR year (or was promoted internally), last
# season's stats already apply, so we just surface the name.
#
# Quirk: the coordinator NAME renders blank in the table cell (it's a stub link), but each
# row has a citation whose text contains the name ("Ravens Hire Declan Doyle as Offensive
# Coordinator"). Citations appear in row order, so we pair them up.
WIKI_OC_TITLE = "List_of_current_NFL_offensive_coordinators"
WIKI_DC_TITLE = "List_of_current_NFL_defensive_coordinators"
# MediaWiki parse API → rendered HTML of the page. The coordinators table is a standard
# <table class="wikitable"> whose cells (Team | Coordinator | Since | Previous position)
# contain the actual text — far more reliable than pulling raw wikitext or citations.
WIKI_API = ("https://en.wikipedia.org/w/api.php?action=parse&page={title}"
            "&prop=text&format=json&formatversion=2&redirects=1")

# Head coaches who are their team's primary offensive playcaller. When true, the app notes
# that the OC is less pivotal (the HC drives the scheme). Maintained by hand each season.
# (Requested design: a short, clearly-labeled, editable list — accurate over heuristics.)
HC_PLAYCALLERS = {
    "CIN": "Zac Taylor", "LAR": "Sean McVay", "SF": "Kyle Shanahan", "BUF": "Joe Brady",
    "MIA": "Mike McDaniel", "GB": "Matt LaFleur",
    "LV": "Klint Kubiak", "NO": "Kellen Moore", "DEN": "Sean Payton",
    "ARI": "Mike LaFleur", "MIN": "Kevin O'Connell", "KC": "Andy Reid", 
    "PIT": "Mike McCarthy", 
    "JAX": "Liam Coen", "CHI": "Ben Johnson",
    "IND": "Shane Steichen", "CLE": "Todd Monken", "CAR": "Dave Canales", "ATL": "Kevin Stefanski"
    
    # NOTE: verify/adjust each offseason — playcalling duties shift year to year.
}

def _norm_team_name_to_code(text):
    """Find an NFL team in free text and return its code (checks full names first, then
    nicknames). Returns (code, matched_full_name) or (None, None)."""
    t = (text or "").lower()
    for full, code in FULLNAME_TO_CODE.items():
        if full in t:
            return code, full
    for nick, code in NICK_TO_CODE.items():
        # word-ish boundary so "rams" doesn't match inside other words
        if _re.search(r"\b" + _re.escape(nick) + r"\b", t):
            return code, nick
    return None, None

def _parse_prev_position(prev_text):
    """From e.g. 'Chicago Bears offensive coordinator (2025)' or 'Miami Dolphins head
    coach (2022–2025)' extract (prev_code, role_label, years). Role is normalized to one
    of: head coach / offensive coordinator / defensive coordinator / <verbatim>."""
    if not prev_text:
        return {"prev_code": None, "prev_team_name": None, "role": None, "years": None}
    code, matched = _norm_team_name_to_code(prev_text)
    low = prev_text.lower()
    # Strip the team name and trailing (years) so we're classifying just the role phrase.
    role_txt = prev_text
    if matched:
        role_txt = _re.sub(_re.escape(matched), "", role_txt, flags=_re.IGNORECASE).strip()
    role_txt = _re.sub(r"\s*\([^)]*\)\s*$", "", role_txt).strip()
    role_txt = _re.sub(r"\s+", " ", role_txt).strip(" ,-–—")
    rl = role_txt.lower()
    # Qualified titles must win over the bare title (e.g. "assistant head coach" must NOT be
    # collapsed to "head coach"; "interim head coach", "co-offensive coordinator" preserved).
    QUALIFIERS = ("assistant", "interim", "associate", "co-", "co ", "passing game",
                  "run game", "senior", "acting")
    has_qualifier = any(q in rl for q in QUALIFIERS)
    if has_qualifier:
        # Keep the coach's actual descriptive title verbatim (cleaned).
        role = role_txt
    elif "head coach" in rl:
        role = "head coach"
    elif "offensive coordinator" in rl:
        role = "offensive coordinator"
    elif "defensive coordinator" in rl:
        role = "defensive coordinator"
    else:
        role = role_txt or None
    ym = _re.search(r"\(([^)]*)\)\s*$", prev_text)
    years = ym.group(1) if ym else None
    return {"prev_code": code, "prev_team_name": (CODE_TO_FULLNAME.get(code) if code else None),
            "role": role, "years": years}

def _extract_coord_names_from_citations(raw):
    """Pull coordinator names from citation text in row order. Patterns like
    'name X as (offensive|defensive) coordinator', 'Hire X as', 'promote X to', etc."""
    names = []
    # Citations live after the table; capture quoted headlines and dig names out.
    for m in _re.finditer(r'"([^"]{6,160})"', raw):
        head = m.group(1)
        hl = head.lower()
        if "coordinator" not in hl:
            continue
        # A capitalized 2–3 word name, following a hire/name/promote verb OR preceding a
        # role phrase. Two passes: verb-led, then role-trailing.
        name = None
        pat = _re.search(r"(?i:name[sd]?|hire[sd]?|promote[sd]?|add[sd]?|sign[sd]?|"
                         r"agree to terms with|hiring|expected to hire)\s+"
                         r"([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,2})", head)
        if pat:
            name = pat.group(1).strip()
        else:
            # e.g. "... Phillips as new O-coordinator" — grab the capitalized run before
            # 'as' or before 'offensive/defensive coordinator'.
            pat2 = _re.search(r"([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,2})\s+"
                              r"(?i:as\b|offensive coordinator|defensive coordinator)", head)
            if pat2:
                name = pat2.group(1).strip()
        # Trim a leading team word or stray verb that sometimes gets captured
        # (e.g. "Chargers Name X", "Hire X").
        if name:
            _VERBS={"hire","hires","hired","name","names","named","promote","promotes",
                    "promoted","add","adds","added","sign","signs","signed","hiring"}
            toks=name.split()
            while len(toks)>=3 and (toks[0].lower() in NICK_TO_CODE or toks[0].lower() in _VERBS):
                toks=toks[1:]
            # also handle a single leading verb leaving exactly a 2-word name
            if len(toks)>=3 and toks[0].lower() in _VERBS:
                toks=toks[1:]
            # strip trailing role words the capitalized run may have swept up
            _TAIL={"offensive","defensive","coordinator","coach","as","new","interim"}
            while len(toks)>=3 and toks[-1].lower() in _TAIL:
                toks=toks[:-1]
            name=" ".join(toks)
        names.append(name)
    return names

def _fetch_wiki_html(title, refresh, label):
    """Fetch a page's rendered HTML via the MediaWiki parse API and return (table_html, full_html).
    The parse API returns JSON: {parse:{text:"<...rendered html...>"}}."""
    cache_path = os.path.join(CACHE_DIR, "coordinators", f"{title}.html")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if not refresh and os.path.exists(cache_path):
        print(f"  → {label}: using cache")
        with open(cache_path, encoding="utf-8") as f:
            return f.read()
    api_url = WIKI_API.format(title=title)
    print(f"  → fetching {label} (MediaWiki API) ...", end="", flush=True)
    try:
        req = request.Request(api_url, headers=UA)
        with request.urlopen(req, timeout=60) as r:
            payload = json.loads(r.read().decode("utf-8", "replace"))
        html = payload.get("parse", {}).get("text", "")
        if isinstance(html, dict):   # older formatversion returns {"*": "..."}
            html = html.get("*", "")
        print(" ok")
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(html)
        return html
    except Exception as e:
        print(f" FAILED ({type(e).__name__}: {e})")
        return None

def _parse_wikitable(html):
    """Parse Wikipedia's coordinator wikitables into (headers, rows). Handles the fact that
    these pages have TWO data tables — one for the AFC and one for the NFC — by reading ALL
    tables whose opening tag mentions "wikitable" and concatenating their rows. Also (a) skips
    infobox/navbox tables that appear first, and (b) reads BOTH <th> and <td> cells per row,
    since Wikipedia renders the leading Team column as a <th> that a td-only parser would drop."""
    if not html:
        return [], []
    # Collect the inner HTML of every wikitable on the page (AFC table, NFC table, ...).
    wikitables = []
    for m in _re.finditer(r"<table\b([^>]*)>(.*?)</table>", html, _re.DOTALL | _re.IGNORECASE):
        attrs, inner = m.group(1), m.group(2)
        if "wikitable" in attrs.lower():
            wikitables.append(inner)
    if not wikitables:
        # Fall back to the largest table on the page (most likely the data table).
        tables = _re.findall(r"<table\b[^>]*>(.*?)</table>", html, _re.DOTALL | _re.IGNORECASE)
        if not tables:
            return [], []
        wikitables = [max(tables, key=len)]
    headers = []
    rows = []
    for tbl in wikitables:
        for tr in _re.findall(r"<tr\b[^>]*>(.*?)</tr>", tbl, _re.DOTALL | _re.IGNORECASE):
            # Read cells in document order, whether th or td.
            cells = [_strip_tags(c) for c in _re.findall(r"<t[hd]\b[^>]*>(.*?)</t[hd]>", tr, _re.DOTALL | _re.IGNORECASE)]
            if not cells:
                continue
            # A header row is all-<th> with no <td>. Capture the first as the column headers;
            # any later header rows (e.g. the NFC table repeats them) are skipped, not treated
            # as data.
            is_header_row = bool(_re.search(r"<th\b", tr, _re.IGNORECASE)) and not _re.search(r"<td\b", tr, _re.IGNORECASE)
            if is_header_row:
                if not headers:
                    headers = cells
                continue
            rows.append(cells)
    return headers, rows

def _parse_coordinator_page(html, side, proj_season):
    """Parse a coordinators page's rendered HTML into {CODE: {name, since, prev_*, ...}}.
    Reads the wikitable (Team | Coordinator | Since | Previous coaching position). The
    Coordinator cell holds the name directly in the API HTML."""
    if not html:
        return {}
    headers, rows = _parse_wikitable(html)
    # Fallback name source if a Coordinator cell is ever blank.
    cite_names = _extract_coord_names_from_citations(html)
    # Locate columns by header text when possible (robust to column reordering); else assume
    # the canonical order Team | Coordinator | Since | Previous.
    def col_idx(*names):
        for i, h in enumerate(headers):
            hl = (h or "").lower()
            if any(n in hl for n in names):
                return i
        return None
    i_team = col_idx("team")
    i_name = col_idx("coordinator", "name")
    i_since = col_idx("since", "tenure", "hired")
    i_prev = col_idx("previous", "prior", "former")
    out = {}
    row_i = 0
    for cells in rows:
        if len(cells) < 3:
            continue
        team_cell = cells[i_team] if i_team is not None and i_team < len(cells) else cells[0]
        name_cell = cells[i_name] if i_name is not None and i_name < len(cells) else (cells[1] if len(cells) > 1 else "")
        since_cell = cells[i_since] if i_since is not None and i_since < len(cells) else (cells[2] if len(cells) > 2 else "")
        prev_cell = cells[i_prev] if i_prev is not None and i_prev < len(cells) else (cells[3] if len(cells) > 3 else "")
        code, _m = _norm_team_name_to_code(team_cell)
        if not code:
            continue
        ym = _re.search(r"(20\d{2})", since_cell or "")
        since = int(ym.group(1)) if ym else None
        nm = (name_cell or "").strip() or None
        if not nm and row_i < len(cite_names):
            nm = cite_names[row_i]
        row_i += 1
        prev = _parse_prev_position(prev_cell)
        is_new = (since == proj_season)
        internal = (prev.get("prev_code") == code)
        carryover = (not is_new) or internal
        out[code] = {
            "name": nm, "since": since, "side": side,
            "prev_code": prev["prev_code"], "prev_team_name": prev["prev_team_name"],
            "prev_role": prev["role"], "prev_years": prev["years"],
            "is_new": is_new, "internal": internal, "carryover": carryover,
        }
    return out

def build_coordinators(proj_season, refresh):
    """Build {CODE: {offense:{...}, defense:{...}}} from Wikipedia's OC/DC lists."""
    oc_html = _fetch_wiki_html(WIKI_OC_TITLE, refresh, "offensive coordinators (Wikipedia)")
    dc_html = _fetch_wiki_html(WIKI_DC_TITLE, refresh, "defensive coordinators (Wikipedia)")
    oc = _parse_coordinator_page(oc_html, "offense", proj_season)
    dc = _parse_coordinator_page(dc_html, "defense", proj_season)
    coords = {}
    for code in set(list(oc.keys()) + list(dc.keys())):
        coords[code] = {}
        if code in oc: coords[code]["offense"] = oc[code]
        if code in dc: coords[code]["defense"] = dc[code]
    if not coords:
        print("\n  ⚠ WARNING: no coordinator data parsed from Wikipedia — the Coordinators")
        print("    tab will be hidden. (No internet, page layout changed, or parse miss.)")
    else:
        n_new = sum(1 for c in coords.values()
                    for s in ("offense","defense") if c.get(s,{}).get("is_new") and not c.get(s,{}).get("internal"))
        print(f"\n  Coordinators loaded: {len(coords)} teams "
              f"({n_new} brand-new from another team → get a carryover Coordinators tab)")
    return coords


WIKI_HC_TITLE = "List_of_current_NFL_head_coaches"

def build_head_coach_history(proj_season, refresh):
    """Pull Wikipedia's current-head-coaches table → {CODE: {name, since, prev_code,
    prev_team_name, prev_role, prev_years, is_new}}. This reuses the same table/row parser
    as the coordinator pages (Team | Coach | Since | Previous position). It exists so that
    when a team's HEAD COACH is the primary playcaller (per HC_PLAYCALLERS) AND is new for
    the projection season, the app can carry over the HC's FORMER team's offensive scheme —
    because with a playcalling HC the scheme travels with the coach, not the coordinator."""
    hc_html = _fetch_wiki_html(WIKI_HC_TITLE, refresh, "head coaches (Wikipedia)")
    # Parse with the shared coordinator parser; side label is nominal here ("head").
    hc = _parse_coordinator_page(hc_html, "head", proj_season)
    # Keep only the fields the app needs (drop the coordinator-specific carryover flags,
    # which don't apply the same way to a head coach).
    out = {}
    for code, d in hc.items():
        out[code] = {
            "name": d.get("name"), "since": d.get("since"),
            "prev_code": d.get("prev_code"), "prev_team_name": d.get("prev_team_name"),
            "prev_role": d.get("prev_role"), "prev_years": d.get("prev_years"),
            "is_new": d.get("is_new"),
        }
    if out:
        n_new_from = sum(1 for d in out.values() if d.get("is_new") and d.get("prev_code") and d["prev_code"] != None)
        print(f"  Head-coach history loaded: {len(out)} coaches ({n_new_from} new this season with a former team)")
    else:
        print("\n  ⚠ WARNING: no head-coach history parsed from Wikipedia — playcaller-HC")
        print("    scheme carryover will fall back to the coordinator's former team.")
    return out


# ── New Additions (Spotrac offseason: free agency, draft, trades) ─────────────────
# Spotrac gates plain requests (403), so we send a full browser-like header set — that's
# enough from a normal machine/IP (no headless browser needed). One page per team contains
# all three tables we want; we locate them by the nav-tab labels (FREE AGENTS → #tabN,
# DRAFT → #tabN) and the "accordion-traded" section (Traded Assets).
SPOTRAC_TEAM = {  # our code → Spotrac's team slug
    "ARI":"ari","ATL":"atl","BAL":"bal","BUF":"buf","CAR":"car","CHI":"chi","CIN":"cin",
    "CLE":"cle","DAL":"dal","DEN":"den","DET":"det","GB":"gb","HOU":"hou","IND":"ind",
    "JAX":"jax","KC":"kc","LAC":"lac","LAR":"lar","LV":"lv","MIA":"mia","MIN":"min",
    "NE":"ne","NO":"no","NYG":"nyg","NYJ":"nyj","PHI":"phi","PIT":"pit","SEA":"sea",
    "SF":"sf","TB":"tb","TEN":"ten","WAS":"was",
}
SPOTRAC_URL = ("https://www.spotrac.com/nfl/offseason/spending/_/year/{year}/team/{slug}")
SPOTRAC_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.spotrac.com/nfl/",
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1",
}

def _spot_money_to_millions(text):
    """'$60,000,000' → 60.0 (in millions); '' / '-' → None."""
    if not text: return None
    m = _re.search(r"\$?\s*([\d,]+(?:\.\d+)?)", text)
    if not m: return None
    try:
        return round(int(m.group(1).replace(",", "")) / 1_000_000, 2)
    except ValueError:
        try: return round(float(m.group(1).replace(",", "")) / 1_000_000, 2)
        except ValueError: return None

def _spot_row_cells(tr_html):
    return [_strip_tags(c) for c in _re.findall(r"<td[^>]*>(.*?)</td>", tr_html, _re.DOTALL | _re.IGNORECASE)]

def _spot_player_name(tr_html):
    m = _re.search(r'/nfl/player/\d+"[^>]*>\s*([^<]+?)\s*</a>', tr_html, _re.DOTALL)
    return m.group(1).strip() if m else None

def _spot_table_in_pane(html, tab_id):
    """Return the <table> HTML inside the tab-pane div with id=tab_id, or None."""
    m = _re.search(r'id="' + _re.escape(tab_id) + r'"', html)
    if not m: return None
    ts = html.find("<table", m.start())
    if ts < 0: return None
    te = html.find("</table>", ts)
    return html[ts:te] if te > ts else None

def _spot_find_tab_id(html, label):
    """Find the nav-link href="#tabN" whose visible text matches label (e.g. 'FREE AGENTS')."""
    for m in _re.finditer(r'href="#(tab\d+)"[^>]*>(.*?)</a>', html, _re.DOTALL | _re.IGNORECASE):
        txt = _re.sub(r"\s+", " ", _re.sub(r"<[^>]+>", "", m.group(2))).strip().lower()
        if txt == label.lower():
            return m.group(1)
    return None

def _parse_signing_table(table_html, kind):
    """Free-agents / draft table → list of {player, pos, years, value_m, aav_m, signed}.
    Columns (both): Player | Pos | (blank) | Sign Team | Years | Value | AAV | ... | Signed."""
    if not table_html: return []
    out = []
    for tr in _re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, _re.DOTALL | _re.IGNORECASE):
        name = _spot_player_name(tr)
        if not name: continue
        cells = _spot_row_cells(tr)
        if len(cells) < 6: continue
        pos = cells[1].strip()
        years = None
        ym = _re.search(r"\d+", cells[4] or "")
        if ym: years = int(ym.group(0))
        value_m = _spot_money_to_millions(cells[5])
        aav_m = _spot_money_to_millions(cells[6]) if len(cells) > 6 else None
        signed = cells[-1].strip() if cells else None
        out.append({"player": name, "pos": pos, "years": years,
                    "value_m": value_m, "aav_m": aav_m, "signed": signed, "kind": kind})
    out.sort(key=lambda r: (r["value_m"] is None, -(r["value_m"] or 0)))
    return out

def _parse_traded_table(table_html):
    """Traded Assets → list of {player, pos, to_team, cap_m, date, detail}.
    Columns: Player | Pos | (blank) | To Team | Cap Acquired | Date | Detail."""
    if not table_html: return []
    out = []
    for tr in _re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, _re.DOTALL | _re.IGNORECASE):
        name = _spot_player_name(tr)
        if not name: continue
        cells = _spot_row_cells(tr)
        if len(cells) < 5: continue
        pos = cells[1].strip()
        cap_m = _spot_money_to_millions(cells[4]) if len(cells) > 4 else None
        date = cells[5].strip() if len(cells) > 5 else None
        detail = ""
        # The trade detail is the last non-empty cell (a sentence like "Traded to ...").
        for c in reversed(cells):
            cc = c.strip()
            if len(cc) > 20 and ("trade" in cc.lower() or "for" in cc.lower()):
                detail = cc; break
        out.append({"player": name, "pos": pos, "cap_m": cap_m, "date": date, "detail": detail})
    out.sort(key=lambda r: (r["cap_m"] is None, -(r["cap_m"] or 0)))
    return out

def _spot_dest_team_from_cell(raw_cell):
    """The 'Sign Team' cell of a Free-Agents-Lost row shows where the player went, as two
    logos separated by an arrow then the destination code as text (e.g.
    <img .../cin.png> &rarr; <img .../jets1.png> NYJ). The clean team CODE after the arrow is
    the reliable signal — logo filenames don't always match the code (e.g. jets1.png). We
    read the text-code after the arrow first, and only fall back to the last logo."""
    if not raw_cell: return None
    txt = _strip_tags(raw_cell)
    m = _re.search(r"(?:&rarr;|→|->|&#8594;)\s*([A-Z]{2,3})\b", txt)
    if m:
        code = m.group(1)
        # normalize via reverse Spotrac slug map if needed (codes here are already ours)
        return code
    # Fallback: last logo filename (works when it matches a known slug).
    imgs = _re.findall(r'/images/thumb/([a-z0-9]+)\.png', raw_cell, _re.IGNORECASE)
    if imgs:
        cand = imgs[-1].upper()
        for our, slug in SPOTRAC_TEAM.items():
            if slug.upper() == cand:
                return our
        # strip trailing digits (jets1 → JETS won't map, so give up gracefully)
        return None
    return None

def _parse_losses_table(table_html):
    """Free Agents Lost → list of {player, pos, to_team, years, value_m, aav_m, signed}.
    Same columns as the signings tables, but the 'Sign Team' cell shows the DESTINATION
    team (where the player signed) rather than this team."""
    if not table_html: return []
    out = []
    for tr in _re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, _re.DOTALL | _re.IGNORECASE):
        name = _spot_player_name(tr)
        if not name: continue
        # need raw cells to dig the destination logo out of the sign-team column
        raw_cells = _re.findall(r"<td[^>]*>(.*?)</td>", tr, _re.DOTALL | _re.IGNORECASE)
        cells = [_strip_tags(c) for c in raw_cells]
        if len(cells) < 6: continue
        pos = cells[1].strip()
        # Sign-team column: index 3 (after player, pos, blank). Get destination team.
        to_team = _spot_dest_team_from_cell(raw_cells[3]) if len(raw_cells) > 3 else None
        years = None
        ym = _re.search(r"\d+", cells[4] or "")
        if ym: years = int(ym.group(0))
        value_m = _spot_money_to_millions(cells[5])
        aav_m = _spot_money_to_millions(cells[6]) if len(cells) > 6 else None
        signed = cells[-1].strip() if cells else None
        out.append({"player": name, "pos": pos, "to_team": to_team, "years": years,
                    "value_m": value_m, "aav_m": aav_m, "signed": signed})
    out.sort(key=lambda r: (r["value_m"] is None, -(r["value_m"] or 0)))
    return out

def fetch_team_additions(code, year, refresh):
    slug = SPOTRAC_TEAM.get(code)
    if not slug: return None
    cache_path = os.path.join(CACHE_DIR, "spotrac", f"{code}_{year}.json")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    if not refresh and os.path.exists(cache_path):
        with open(cache_path) as f: return json.load(f)
    url = SPOTRAC_URL.format(year=year, slug=slug)
    try:
        req = request.Request(url, headers=SPOTRAC_HEADERS)
        with request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f"    {code}: FAILED ({type(e).__name__})", end="")
        return None
    fa_id = _spot_find_tab_id(html, "FREE AGENTS")
    dr_id = _spot_find_tab_id(html, "DRAFT")
    free_agents = _parse_signing_table(_spot_table_in_pane(html, fa_id), "free_agent") if fa_id else []
    draft = _parse_signing_table(_spot_table_in_pane(html, dr_id), "draft") if dr_id else []
    # Traded Assets lives in the accordion-traded section.
    trades = []
    tm = _re.search(r'accordion-traded', html)
    if tm:
        ts = html.find("<table", tm.start()); te = html.find("</table>", ts)
        if ts > 0 and te > ts:
            trades = _parse_traded_table(html[ts:te])
    # Free Agents Lost lives in the accordion-falost section (same table shape as signings,
    # but the sign-team column shows where the player went).
    losses = []
    lm = _re.search(r'accordion-falost', html)
    if lm:
        ts = html.find("<table", lm.start()); te = html.find("</table>", ts)
        if ts > 0 and te > ts:
            losses = _parse_losses_table(html[ts:te])
    out = {"free_agents": free_agents, "draft": draft, "trades": trades,
           "free_agents_lost": losses}
    with open(cache_path, "w") as f: json.dump(out, f)
    return out

def build_additions(year, refresh):
    """Build {CODE: {free_agents, draft, trades, free_agents_lost}} from Spotrac."""
    print("  Fetching Spotrac offseason roster changes per team ...")
    additions = {}
    n_ok = 0
    for code in TEAMS:
        data = fetch_team_additions(code, year, refresh)
        if data and (data["free_agents"] or data["draft"] or data["trades"]
                     or data.get("free_agents_lost")):
            additions[code] = data
            n_ok += 1
        # gentle pacing so we don't hammer the site
        if not refresh:
            pass
    if not additions:
        print("\n  ⚠ WARNING: no Spotrac data fetched — the Roster Changes tab will be hidden.")
        print("    (Spotrac may be blocking this machine's requests, or the layout changed.)")
    else:
        nfa = sum(len(a["free_agents"]) for a in additions.values())
        ndr = sum(len(a["draft"]) for a in additions.values())
        ntr = sum(len(a["trades"]) for a in additions.values())
        nlost = sum(len(a.get("free_agents_lost", [])) for a in additions.values())
        print(f"  Roster Changes loaded: {n_ok} teams · {nfa} FA signings, {ndr} draft picks, "
              f"{ntr} trades, {nlost} FA losses")
    return additions


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
            # Roster-truth fields (used to weed out stale/departed players the projections
            # endpoint still lists). `team` here is the player's CURRENT team (None for free
            # agents / departed / retired); `active` + `status` reflect current roster status.
            "active": p.get("active", True),
            "status": p.get("status"),   # e.g. "Active", "Inactive", "Retired"; None = unknown
            "age": p.get("age"), "years_exp": p.get("years_exp"),
            "headshot": None,  # Sleeper headshots use a CDN by player_id (handled in app)
            "bye_week": None,
        }
    print(f"  → kept {len(slim)} skill players (QB/RB/WR/TE with a team)")
    return slim

def normalize_row(row):
    """Sleeper projection/stat row → {stats, team, pos, name, adp}. The row's team is the
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
    # ADP lives under `stats` in the projections feed (adp_ppr, adp_half_ppr, adp_2qb,
    # adp_std, adp_dynasty*, …). Sleeper uses 999 as "unranked". Capture the formats the
    # app uses; leave 999 when a format is missing so the app can detect "no ADP".
    def _adp(k):
        v = stats.get(k)
        return v if (v is not None) else 999
    adp = {
        "adp_std":  _adp("adp_std"),
        "adp_ppr":  _adp("adp_ppr"),
        "adp_half_ppr": _adp("adp_half_ppr"),
        "adp_2qb":  _adp("adp_2qb"),
        "adp_dynasty":       _adp("adp_dynasty"),
        "adp_dynasty_ppr":   _adp("adp_dynasty_ppr"),
        "adp_dynasty_2qb":   _adp("adp_dynasty_2qb"),
        # a generic "adp" = the PPR value (closest to a default board) when present, else std
        "adp": stats.get("adp_ppr") if stats.get("adp_ppr") is not None else _adp("adp_std"),
    }
    return {
        "stats": out,
        "team": row.get("team"),
        "pos": row.get("position") or player.get("position"),
        "name": name,
        "adp": adp,
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
    skipped_stale = []
    for pid, rec in proj_idx.items():
        meta = players.get(pid, {})
        proj = rec.get("stats", {})
        adp_d = rec.get("adp", {}) or {}
        # ROSTER TRUTH: the projections endpoint's `team` is unreliable for fringe/departed
        # players — it can carry a stale historical team (so a QB who last played for a team
        # years ago, or has since left/retired, still shows up on that roster). The Sleeper
        # PLAYER DB has the authoritative current team (None for free agents / departed /
        # retired). Prefer it; fall back to the projection team only when the DB has no record.
        db_team = meta.get("team")
        proj_team = rec.get("team")
        if meta:
            # We know this player. Trust the DB's current team. If the DB says they're NOT on
            # a team (free agent / retired / departed), or they're inactive/retired, drop them
            # from projectable rosters — they shouldn't appear on any team's 2026 depth chart.
            status = (meta.get("status") or "")
            is_inactive = (meta.get("active") is False) or (status in ("Retired", "Inactive"))
            if not db_team or is_inactive:
                skipped_stale.append((rec.get("name") or meta.get("name") or pid, proj_team, status or "no team"))
                continue
            team = db_team
        else:
            # Unknown to the DB (rare) — fall back to the projection's team.
            team = proj_team
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
            "adp": adp_d.get("adp", 999), "adp_ppr": adp_d.get("adp_ppr", 999),
            "adp_half_ppr": adp_d.get("adp_half_ppr", 999), "adp_2qb": adp_d.get("adp_2qb", 999),
            "adp_std": adp_d.get("adp_std", 999),
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
    if skipped_stale:
        print(f"  → filtered {len(skipped_stale)} stale/departed players the projections feed "
              f"still listed (not on a current roster / inactive / retired).")
        # show a few examples so it's transparent what was removed
        for nm, pt, why in skipped_stale[:6]:
            print(f"       · {nm} (proj listed {pt or '—'}; {why})")
        if len(skipped_stale) > 6:
            print(f"       · … and {len(skipped_stale)-6} more")
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
    ap.add_argument("--nflverse", dest="nflverse", action="store_true", default=True,
                    help="compute nflverse advanced metrics (default: on; requires pandas) and add "
                        "them as a parallel 'nflverse' seed block")
    ap.add_argument("--no-nflverse", dest="nflverse", action="store_false",
                    help="skip nflverse advanced metrics")
    ap.add_argument("--sumer", action="store_true",
                    help="also scrape SumerSports advanced per-player stats into the seed (opt-in; "
                         "the app now defaults to nflverse for advanced metrics, so this is only for A/B analysis)")
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

    print("\nStep 4/8: per-team history (QB weekly splits for traded players)")
    history = build_history(players, stats_by_season, args.refresh)

    print("\nStep 5/8: assembling seed")
    seed, history = assemble(players, proj_idx, stats_by_season, history, args.season)

    print("\nStep 6/8: FantasyPros ECR (replaces ADP)")
    ecr = build_ecr(args.refresh)

    print("\nStep 7/8: OverTheCap contracts (dynasty age/APY/FA)")
    contracts = build_contracts(args.refresh)

    print("\nStep 8/8: Warren Sharp advanced stats (offense + defense) & strength of schedule")
    sharp = build_sharp(args.refresh)
    sos = build_sos(args.refresh, args.season)
    coordinators = build_coordinators(args.season, args.refresh)
    hc_history = build_head_coach_history(args.season, args.refresh)
    print("\n  New Additions (Spotrac free agency / draft / trades)")
    additions = build_additions(args.season, args.refresh)

    # SumerSports is now opt-in only (--sumer). nflverse advanced metrics are the app's default
    # advanced source, so we no longer bake the scraped SumerSports tables into the seed unless
    # explicitly requested for A/B analysis.
    sumer, sumer_seasons = {}, []
    if args.sumer:
        print("\n  SumerSports advanced per-player stats (opt-in — QB/RB/WR/TE, per season)")
        sumer = build_sumer(args.refresh)
        sumer_seasons = sorted(sumer.keys(), reverse=True)

    print("\n  KeepTradeCut dynasty player IDs (player-card links)")
    ktc = build_ktc(args.refresh)

    # Keep only seasons that actually returned stats (older years may be unavailable).
    nonempty_seasons = sorted([s for s, idx in stats_by_season.items() if idx], reverse=True)
    if len(nonempty_seasons) < len(stats_by_season):
        missing = sorted(set(stats_by_season) - set(nonempty_seasons), reverse=True)
        print(f"  (note: no data returned for {', '.join(missing)} — omitting those tabs)")

    # Default-on, additive, dependency-isolated: nflverse-computed advanced metrics.
    # Imported lazily so users can still opt out via --no-nflverse.
    nflverse = {}
    if args.nflverse:
        print("\n  nflverse advanced metrics (default-on, additive — requires pandas)")
        try:
            import nflverse_stats as _nfl
            if not _nfl.HAVE_PANDAS:
                print("    ⚠ pandas not installed — skipping nflverse metrics (the rest of the seed is unaffected)")
            else:
                # Cover the same seasons we normally fetch history for (automated for future use).
                nflverse = _nfl.build_nflverse(nonempty_seasons, refresh=args.refresh)
        except Exception as e:
            print(f"    ⚠ nflverse metrics failed: {type(e).__name__}: {e}")
    else:
        print("\n  nflverse advanced metrics disabled (--no-nflverse)")


    # Split the two largest, rarely-viewed nflverse blocks (def_weekly, coaching_scheme) out of
    # the main seed into sidecar files. The app lazy-loads them on demand (opening a defensive
    # player card / a team's coaching-scheme modal) so the initial seed load stays lean & fast.
    # The baked/offline build re-embeds them (see bake_seed.py) since file:// can't fetch.
    nflverse_def_weekly = {}
    nflverse_coaching = {}
    for _s, _blk in nflverse.items():
        if isinstance(_blk, dict):
            if "def_weekly" in _blk:
                nflverse_def_weekly[_s] = _blk.pop("def_weekly")
            if "coaching_scheme" in _blk:
                nflverse_coaching[_s] = _blk.pop("coaching_scheme")


    # Emit the seed json the app loads (compact — no indentation. Pretty-printing this
    # file more than doubled it; the app fetches + JSON.parses it, so compact = smaller
    # download and faster parse with identical data).
    BUILDER_VERSION = "2.12-adp-fix"   # bump when aggregation logic changes

    with open("triplecrown_seed.json", "w") as f:
        json.dump({"season": args.season, "builder_version": BUILDER_VERSION,
                   "seed": seed, "history": history,
                   "history_seasons": nonempty_seasons, "ecr": ecr,
                   "contracts": contracts, "sharp": sharp, "sos": sos,
                   "team_names": CODE_TO_FULLNAME, "coordinators": coordinators,
                   "hc_history": hc_history, "additions": additions,
                   "hc_playcallers": HC_PLAYCALLERS, "sharp_season": args.season-1,
                   "sumer": sumer, "sumer_seasons": sumer_seasons, "ktc": ktc,
                   "nflverse": nflverse}, f, separators=(",", ":"))
    # Sidecar files — lazy-loaded by the app on demand (hosted). Only written when non-empty.
    if nflverse_def_weekly:
        with open("triplecrown_seed.def_weekly.json", "w") as f:
            json.dump(nflverse_def_weekly, f, separators=(",", ":"))
    if nflverse_coaching:
        with open("triplecrown_seed.coaching.json", "w") as f:
            json.dump(nflverse_coaching, f, separators=(",", ":"))

    nplayers = sum(len(seed[t][p]) for t in seed for p in seed[t])
    print(f"\nDone (builder {BUILDER_VERSION}). {nplayers} players across {len(TEAMS)} teams.")
    print(f"  • triplecrown_seed.json → load this in the app via the 📦 Seed button (recommended)")
    if nflverse_def_weekly:
        print("  • triplecrown_seed.def_weekly.json → lazy sidecar (defensive weekly player cards)")
    if nflverse_coaching:
        print("  • triplecrown_seed.coaching.json   → lazy sidecar (coaching scheme modal)")
    print(f"  • {CACHE_DIR}/ → cached raw API responses (delete to force refresh)")
    print("\nNext: open the TripleCrown app (index.html). By default it pulls live 2026")
    print("projections from Sleeper on load. To use this prebuilt snapshot (with historical")
    print("seasons + advanced stats), click the 📦 Seed button and choose triplecrown_seed.json")
    print("— no HTML editing needed.")

if __name__ == "__main__":
    main()
