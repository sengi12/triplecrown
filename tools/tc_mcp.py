#!/usr/bin/env python3
"""TripleCrown MCP server — the app's data as tools for any MCP client.

MCP (Model Context Protocol) is the open standard AI clients use to call
outside tools: Claude Desktop, Claude Code, Cursor and the rest speak it. This
file is a complete, dependency-free server for it. Point a client at it and
"who do I start, Brown or Henry, in my superflex league?" is answered from
TripleCrown's own numbers — the same grounding sheet the in-app ⚖ compare
builds (src/js/93-ai-compare.js), the same board draft_sim.py scores, the same
seed the site ships — instead of from whatever the model remembers.

Nothing here touches the web app. It is a local process reading the seed on
disk; no hosting, no network unless you pass --league to pull a Sleeper
league's real scoring (cached after the first call), no bytes added to
index.html.

Register it (Claude Desktop → claude_desktop_config.json):

  {"mcpServers": {"triplecrown": {
      "command": "python3",
      "args": ["/path/to/triplecrown/tools/tc_mcp.py", "--format", "superflex"]}}}

Claude Code:  claude mcp add triplecrown -- python3 /path/to/triplecrown/tools/tc_mcp.py

Try a tool without a client:

  python3 tools/tc_mcp.py --call compare a="Chase Brown" b="Derrick Henry"
  python3 tools/tc_mcp.py --call rankings pos=RB limit=15

Transport is stdio (newline-delimited JSON-RPC 2.0, MCP 2024-11-05 and later).
Stdlib-only, like the core seed pipeline.
"""
import argparse
import difflib
import gzip
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import draft_sim as ds  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED_PATH = os.path.join(ROOT, "seeds", "triplecrown_seed.json")
INSEASON_PATH = os.path.join(ROOT, "seeds", "triplecrown_seed.inseason.json")
SERVER_NAME = "triplecrown"
SERVER_VERSION = "1.0"
PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
SKILL = ("QB", "RB", "WR", "TE")

# Default league shapes when no Sleeper league is given: a 12-team room with the
# usual lineup, scored the way each format name implies.
_BASE_SCORING = {"pass_yd": 0.04, "pass_td": 4.0, "pass_int": -2.0, "rush_yd": 0.1,
                 "rush_td": 6.0, "rec": 1.0, "rec_yd": 0.1, "rec_td": 6.0}
_BASE_ROSTER = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"] + ["BN"] * 6
FORMATS = {
    "ppr": (dict(_BASE_SCORING), _BASE_ROSTER),
    "half_ppr": (dict(_BASE_SCORING, rec=0.5), _BASE_ROSTER),
    "std": (dict(_BASE_SCORING, rec=0.0), _BASE_ROSTER),
    "superflex": (dict(_BASE_SCORING), _BASE_ROSTER[:7] + ["SUPER_FLEX"] + _BASE_ROSTER[7:]),
}

# The instruction the in-app compare gives its model, so an MCP client's model
# judges from the same footing instead of reading the board back.
ANALYST_FRAME = (
    "How to answer: you are auditing a draft board, not reading it back. The "
    "board ranks (VOR/ECR/ADP) are the consensus under review — never cite a rank "
    "as your reason. Decide from the underlying evidence: volume (targets, carries, "
    "attempts), touchdown access, per-game rates, schedule, role, age, injury, "
    "contract situation and the computed head-to-head differences. Answer as "
    "\"PICK: <name>.\" then \"WHY:\" with 2-4 sentences citing specific numbers "
    "from the data, then \"FLIP IF:\" one sentence naming what would reverse it. "
    "If the evidence truly cannot separate them, say \"PICK: coin flip\" and what "
    "would tip it. What the data doesn't say, don't invent."
)


def log(msg):
    """stderr only — stdout is the protocol channel."""
    sys.stderr.write(f"[tc_mcp] {msg}\n")
    sys.stderr.flush()


def _load_json(path):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    if os.path.exists(path + ".gz"):
        with gzip.open(path + ".gz", "rt") as f:
            return json.load(f)
    raise FileNotFoundError(path)


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def ecr_norm(s):
    """Mirror of ecrNormName (src/js/60-rankings-data.js): the key the ECR,
    contract and dynasty tables are written under."""
    s = re.sub(r"[.'\-]", "", str(s or "").lower())
    s = re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _r(v, nd=0):
    x = _num(v)
    if x is None:
        return None
    return int(round(x)) if nd == 0 else round(x, nd)


def synthetic_league(fmt):
    """A League for a format name, when no Sleeper league is supplied."""
    if fmt not in FORMATS:
        raise ValueError(f"unknown format {fmt!r}; one of {', '.join(FORMATS)}")
    scoring, roster = FORMATS[fmt]
    league_json = {"name": f"12-team {fmt}", "total_rosters": 12,
                   "scoring_settings": scoring, "roster_positions": roster}
    return ds.League(league_json, {"settings": {"teams": 12, "rounds": len(roster)}})


def sleeper_league(league_id):
    lg = ds.fetch_json(ds.SLEEPER_LEAGUE_URL.format(league_id), f"league_{league_id}.json")
    drafts = ds.fetch_json(ds.SLEEPER_LG_DRAFTS_URL.format(league_id), f"drafts_{league_id}.json")
    return ds.League(lg, (drafts or [{}])[0] if drafts else {})


def byes_from_schedule(schedule):
    """{team: bye week} — the one regular-season week a team has no opponent."""
    byes = {}
    for team, sch in (schedule or {}).items():
        missing = [w for w in range(1, 19) if not (sch or {}).get(str(w))]
        if len(missing) == 1:
            byes[team] = missing[0]
    return byes


class TripleCrown:
    """The data layer: seed + in-season sidecar + a league to score them under."""

    def __init__(self, seed=None, inseason=None, league=None, fmt="ppr",
                 seed_path=SEED_PATH, inseason_path=INSEASON_PATH):
        self.seed = seed if seed is not None else _load_json(seed_path)
        if inseason is not None:
            self.inseason = inseason
        else:
            try:
                self.inseason = _load_json(inseason_path)
            except FileNotFoundError:
                self.inseason = {}
        self.league = league or synthetic_league(fmt)
        self.fmt = ds.market_format(self.league)
        self.byes = byes_from_schedule(self.inseason.get("schedule"))
        self.rows = []            # every seed projection row
        self.by_pid = {}
        self.by_norm = {}
        for team, posmap in (self.seed.get("seed") or {}).items():
            for pos in SKILL:
                for r in posmap.get(pos) or []:
                    self.rows.append(r)
                    if r.get("player_id"):
                        self.by_pid[str(r["player_id"])] = r
                    self.by_norm.setdefault(ds.norm_name(r["name"]), []).append(r)
        self.board = {}           # pid -> scored Player (VOR, ADP on this format)
        for p in ds.build_board(self.seed, self.league, self.byes):
            self.board[p.pid] = p
        self.ecr = (self.seed.get("ecr") or {}).get(
            "superflex" if self.fmt == "superflex" else self.fmt) or \
            (self.seed.get("ecr") or {}).get("ppr") or {}

    # ── lookup ──────────────────────────────────────────────────────────────
    def find(self, query, pos=None, limit=8):
        """Rows matching a name or player_id — exact, then substring, then fuzzy."""
        q = str(query or "").strip()
        if not q:
            return []
        if q in self.by_pid:
            return [self.by_pid[q]]
        nq = ds.norm_name(q)
        hits = list(self.by_norm.get(nq) or [])
        if not hits:
            hits = [r for k, rows in self.by_norm.items() if nq and nq in k for r in rows]
        if not hits:
            close = difflib.get_close_matches(nq, list(self.by_norm), n=limit, cutoff=0.72)
            hits = [r for k in close for r in self.by_norm[k]]
        if pos:
            hits = [r for r in hits if r.get("pos") == pos.upper()]
        hits.sort(key=lambda r: self.adp(r))
        return hits[:limit]

    def one(self, query, pos=None):
        hits = self.find(query, pos, limit=1)
        return hits[0] if hits else None

    def adp(self, r):
        return ds.adp_for(r, self.fmt)

    def points(self, r):
        games = min(17.0, float(r.get("games") or r.get("games_played") or 17))
        return ds.league_points(r, self.league.scoring, games)

    def ecr_of(self, r):
        return self.ecr.get(ecr_norm(r["name"])) or {}

    def tc_pts(self, r):
        """The TC model's season view, same clamp as the app's tcPts."""
        tc = r.get("tc") or {}
        if (tc.get("base") or 0) >= 5 and tc.get("fpg") is not None:
            mult = min(2.0, max(0.25, tc["fpg"] / tc["base"]))
            return self.points(r) * mult
        return None

    def history(self, r, seasons=3):
        """[(year, team, games, stats dict)] for the last `seasons` seasons played."""
        h = self.seed.get("history") or {}
        rec = (h.get("players") or {}).get(str(r.get("player_id") or ""))
        if not rec:
            return []
        cols = h.get("sf") or []
        out = []
        for yr in sorted(rec[2], reverse=True):
            stints = rec[2][yr]
            games = int(sum((s[1] or 0) for s in stints))
            if not games:
                continue
            stats = {}
            for s in stints:
                for i, v in enumerate(s[4] or []):
                    if v is not None and i < len(cols):
                        stats[cols[i]] = stats.get(cols[i], 0) + v
            out.append((yr, "/".join(s[0] for s in stints if s[0]), games, stats))
            if len(out) >= seasons:
                break
        return out

    def schedule(self, team, from_week=None, n=None):
        sch = (self.inseason.get("schedule") or {}).get(team) or {}
        if not sch:
            return []
        wk = from_week or self.week()
        out = []
        for w in range(wk, 19):
            out.append((w, sch.get(str(w)) or "BYE"))
            if n and len(out) >= n:
                break
        return out

    def week(self):
        st = self.seed.get("state") or {}
        return int(st.get("week") or 1) if st.get("season_type") == "regular" else 1

    # ── the grounding sheet (mirror of tcAiPlayerContext) ───────────────────
    def sheet(self, r):
        L = []
        p = self.board.get(str(r.get("player_id") or ""))
        ident = [f"age {r['age']}" if r.get("age") is not None else None]
        ident = [x for x in ident if x]
        L.append(f"{r['name']} ({r['pos']}, {r.get('team') or 'FA'}"
                 f"{'; ' + ', '.join(ident) if ident else ''})")
        bits = []
        pts = self.points(r)
        bits.append(f"projected {_r(pts)} pts (league scoring)")
        if p is not None:
            bits.append(f"value over replacement {'+' if p.vor > 0 else ''}{_r(p.vor)}")
        e = self.ecr_of(r)
        if e.get("rank_ecr") is not None:
            bits.append(f"expert consensus rank {e['rank_ecr']}")
        adp = self.adp(r)
        if adp < 999:
            bits.append(f"market ADP {_r(adp)}")
        if e.get("tier") is not None:
            bits.append(f"tier {e['tier']}")
        tcp = self.tc_pts(r)
        if tcp is not None:
            bits.append(f"TC model {_r(tcp)} pts")
        if r.get("risk") is not None or r.get("upside") is not None:
            bits.append(f"risk {r.get('risk')}/5 · upside {r.get('upside')}/5")
        L.append("  board: " + " · ".join(bits))
        c = (self.seed.get("contracts") or {}).get(ecr_norm(r["name"]))
        if c and c.get("apy"):
            L.append(f"  contract: ${_r(c['apy'] / 1e6)}M/yr through "
                     f"{c['fa'] - 1 if c.get('fa') else '?'} (FA {c.get('fa') or '?'})")
        so = (self.seed.get("sos") or {}).get(r.get("team") or "")
        if so:
            L.append(f"  team: SOS rank {so.get('rank')} of 32 · Vegas win total {so.get('win_total')}")
        oc = ((self.seed.get("coordinators") or {}).get(r.get("team") or "") or {}).get("offense")
        if oc and oc.get("is_new"):
            L.append(f"  new offensive coordinator: {oc.get('name')} "
                     f"(was {oc.get('prev_role') or '?'}, {oc.get('prev_team_name') or '?'})")
        bye = self.byes.get(r.get("team") or "")
        if bye:
            L.append(f"  bye: week {bye}")
        # projection stat line, position-appropriate
        n = lambda k: (_r(r.get(k)) if (_num(r.get(k)) or 0) > 0 else None)  # noqa: E731
        g = min(17, n("games") or n("games_played") or 17)
        st = []
        if r["pos"] == "QB":
            for k, lab in (("passing_yards", "pass yds"), ("passing_touchdowns", "pass TD"),
                           ("passing_attempts", "att"), ("interceptions_thrown", "INT"),
                           ("rushing_yards", "rush yds"), ("rushing_tds", "rush TD")):
                if n(k):
                    st.append(f"{n(k)} {lab}")
        else:
            for k, lab in (("rushing_attempts", "carries"), ("rushing_yards", "rush yds"),
                           ("rushing_tds", "rush TD"), ("receiving_targets", "targets"),
                           ("receptions", "rec"), ("receiving_yards", "rec yds"),
                           ("receiving_tds", "rec TD")):
                if n(k):
                    st.append(f"{n(k)} {lab}")
        if st:
            L.append(f"  projection ({g} gm): " + ", ".join(st) + f" → {pts / g:.1f} FP/gm")
        tc = r.get("tc") or {}
        if tc.get("in"):
            i = tc["in"]
            L.append(f"  TC model inputs: {i.get('yr')} {i.get('fpg')} FP/gm over {i.get('g')} gm"
                     f" (expected {i.get('xfpg')}, TD over expectation {i.get('tdoe')})")
        for yr, team, games, stats in self.history(r):
            L.append(f"  {yr} {team}: " + self._hist_line(r["pos"], games, stats))
        q = self._qb_charting(r)
        if q:
            L.append(q)
        nxt = self.schedule(r.get("team") or "", n=4)
        if nxt:
            L.append("  schedule: " + ", ".join(f"wk{w} {o}" for w, o in nxt))
        dv = ((self.seed.get("dynasty_values") or {}).get("players") or {}).get(ecr_norm(r["name"]))
        if dv and (dv.get("v") is not None or dv.get("sf") is not None):
            vals = [f"{dv['v']} (1QB)" if dv.get("v") is not None else None,
                    f"{dv['sf']} (superflex)" if dv.get("sf") is not None else None]
            L.append("  dynasty value: " + " · ".join(v for v in vals if v))
        return "\n".join(L)

    def _hist_line(self, pos, games, s):
        sc = self.league.scoring
        line = {"passing_yards": s.get("passing_yards", 0), "passing_touchdowns": s.get("passing_touchdowns", 0),
                "interceptions_thrown": s.get("interceptions_thrown", 0),
                "rushing_yards": s.get("rushing_yards", 0), "rushing_tds": s.get("rushing_touchdowns", 0),
                "receptions": s.get("receptions", 0), "receiving_yards": s.get("receiving_yards", 0),
                "receiving_tds": s.get("receiving_touchdowns", 0)}
        pts = ds.league_points(line, sc, games)
        parts = [f"{games} gm"]
        if pos == "QB":
            if s.get("passing_yards"):
                parts.append(f"{_r(s['passing_yards'])} pass yds, {_r(s.get('passing_touchdowns', 0))} TD, "
                             f"{_r(s.get('interceptions_thrown', 0))} INT")
            if s.get("rushing_yards"):
                parts.append(f"{_r(s['rushing_yards'])} rush yds, {_r(s.get('rushing_touchdowns', 0))} TD")
        else:
            if s.get("rushing_attempts"):
                parts.append(f"{_r(s['rushing_attempts'])} car {_r(s.get('rushing_yards', 0))} yds "
                             f"{_r(s.get('rushing_touchdowns', 0))} TD")
            if s.get("receiving_targets") or s.get("receptions"):
                parts.append(f"{_r(s.get('receiving_targets', 0))} tgt {_r(s.get('receptions', 0))} rec "
                             f"{_r(s.get('receiving_yards', 0))} yds {_r(s.get('receiving_touchdowns', 0))} TD")
        if s.get("off_snaps") and s.get("team_off_snaps"):
            parts.append(f"{_r(100 * s['off_snaps'] / s['team_off_snaps'])}% snaps")
        parts.append(f"{pts / max(1, games):.1f} FP/gm")
        return ", ".join(parts)

    def _qb_charting(self, r):
        if r["pos"] != "QB":
            return None
        years = ((self.seed.get("nflverse") or {}).get("years") or {})
        for yr in sorted(years, reverse=True):
            q = (((years[yr] or {}).get("qb_charting") or {}).get("players") or {}).get(ds.norm_name(r["name"]))
            if q:
                intw = f"{q.get('intw_pct')}%" if q.get("intw_pct") is not None else "n/a"
                return (f"  {yr} charting: on-target {q.get('on_tgt_pct')}%, bad-throw {q.get('bad_throw_pct')}%, "
                        f"INT-worthy {intw}, pressured {q.get('pressure_pct')}%")
        return None

    # ── head-to-head (mirror of tcAiDeltas) ─────────────────────────────────
    def deltas(self, a, b):
        L = []
        pa, pb = self.board.get(str(a.get("player_id"))), self.board.get(str(b.get("player_id")))
        close = False
        if pa is not None and pb is not None:
            va, vb = pa.vor, pb.vor
            span = max(abs(va), abs(vb), 1.0)
            close = abs(va - vb) / span <= 0.15 or abs(va - vb) < 8
            L.append(f"board value: EFFECTIVELY TIED ({abs(va - vb):.0f} VOR apart) — the ranks cannot decide this one"
                     if close else f"board value: {a['name'] if va > vb else b['name']} by {abs(va - vb):.0f} VOR")

        def gap(label, x, y, unit=""):
            if x is None or y is None or abs(x - y) < 1e-9:
                return
            L.append(f"{label}: {a['name'] if x > y else b['name']} by {_r(abs(x - y))}{unit}")

        gap("projected points", self.points(a), self.points(b), " pts")
        gap("targets", _num(a.get("receiving_targets")), _num(b.get("receiving_targets")))
        gap("carries", _num(a.get("rushing_attempts")), _num(b.get("rushing_attempts")))
        tds = lambda r: sum((_num(r.get(k)) or 0) for k in ("rushing_tds", "receiving_tds", "passing_touchdowns"))  # noqa: E731
        gap("total TDs", tds(a), tds(b))
        aa, ab = self.adp(a), self.adp(b)
        if aa < 999 and ab < 999 and _r(aa) != _r(ab):
            L.append(f"market: drafters take {a['name'] if aa < ab else b['name']} {_r(abs(aa - ab))} picks earlier")
        sos = self.seed.get("sos") or {}
        sa, sb = sos.get(a.get("team") or ""), sos.get(b.get("team") or "")
        if sa and sb and sa.get("rank") != sb.get("rank"):
            L.append(f"easier season schedule: {a['name'] if sa['rank'] < sb['rank'] else b['name']} "
                     f"(SOS {sa['rank']} vs {sb['rank']})")
        ta, tb = self.tc_pts(a), self.tc_pts(b)
        if ta is not None and tb is not None and abs(ta - tb) >= 1:
            L.append(f"TC model: {a['name'] if ta > tb else b['name']} by {_r(abs(ta - tb))} pts")
        return L, close

    # ── tools ───────────────────────────────────────────────────────────────
    def t_state(self):
        st = self.seed.get("state") or {}
        return "\n".join([
            f"TripleCrown seed: season {self.seed.get('season')} · {st.get('season_type')} week {st.get('week')}"
            f" · as of {st.get('asof')} · builder {self.seed.get('builder_version')}",
            f"league: {self.league.name} · {self.league.teams} teams · lineup "
            + "/".join(f"{k}{v}" for k, v in self.league.lineup.items() if v)
            + f" · ADP board: {self.fmt}",
            f"players on the board: {len(self.board)} scored of {len(self.rows)} projected",
            f"schedule: {'loaded' if self.inseason.get('schedule') else 'not available'}"
            f" · byes known for {len(self.byes)} teams",
            "not in this server (browser-only, live): injuries, Sleeper rosters, your notes, in-season pace.",
        ])

    def t_search(self, query, pos=None, limit=8):
        hits = self.find(query, pos, limit=int(limit or 8))
        if not hits:
            return f"No player matches {query!r}."
        return "\n".join(self._row_line(r) for r in hits)

    def _row_line(self, r):
        p = self.board.get(str(r.get("player_id") or ""))
        e = self.ecr_of(r)
        adp = self.adp(r)
        bits = [f"{r['name']} ({r['pos']}, {r.get('team') or 'FA'})", f"{_r(self.points(r))} pts"]
        if p is not None:
            bits.append(f"VOR {'+' if p.vor > 0 else ''}{_r(p.vor)}")
        if adp < 999:
            bits.append(f"ADP {_r(adp)}")
        if e.get("rank_ecr") is not None:
            bits.append(f"ECR {e['rank_ecr']}" + (f" T{e['tier']}" if e.get("tier") else ""))
        if r.get("player_id"):
            bits.append(f"id {r['player_id']}")
        return " · ".join(bits)

    def t_player(self, name, pos=None):
        r = self.one(name, pos)
        if not r:
            return f"No player matches {name!r}. Try search_players."
        return self.sheet(r)

    def t_compare(self, a, b, question=None):
        ra, rb = self.one(a), self.one(b)
        missing = [q for q, r in ((a, ra), (b, rb)) if not r]
        if missing:
            return "No player matches " + ", ".join(repr(m) for m in missing) + ". Try search_players."
        lines, close = self.deltas(ra, rb)
        shape = "/".join(f"{k}{v}" for k, v in self.league.lineup.items() if v)
        return "\n".join([
            f"League: {self.league.name} · lineup {shape}",
            "", "PLAYER A", self.sheet(ra),
            "", "PLAYER B", self.sheet(rb),
            "", "COMPUTED HEAD-TO-HEAD DIFFERENCES",
            "\n".join("- " + l for l in lines) or "- none material",
            "", ("The board values here are effectively tied, so the ranks CANNOT be the answer. " if close else "")
            + ANALYST_FRAME,
            "", f"Question: {question or 'Who should I take?'}",
        ])

    def t_rankings(self, pos=None, limit=25, sort="vor"):
        players = list(self.board.values())
        if pos:
            players = [p for p in players if p.pos == pos.upper()]
        key = {"vor": lambda p: -p.vor, "adp": lambda p: p.adp_eff,
               "points": lambda p: -p.val, "ecr": lambda p: p.ecr or 9999}.get(sort or "vor")
        if key is None:
            return f"unknown sort {sort!r}; one of vor, adp, points, ecr"
        players.sort(key=key)
        out = [f"{'#':>3} {'player':<24} {'pos':<3} {'tm':<3} {'pts':>5} {'VOR':>5} {'ADP':>5} {'ECR':>4} tier"]
        for i, p in enumerate(players[:int(limit or 25)], 1):
            out.append(f"{i:>3} {p.name[:24]:<24} {p.pos:<3} {(p.team or 'FA'):<3} {p.val:>5.0f} {p.vor:>+5.0f} "
                       f"{(f'{p.adp:.0f}' if p.adp < 999 else '-'):>5} {(p.ecr or '-'):>4} {p.tier or ''}")
        out.append(f"({self.league.name}; replacement level per week: "
                   + ", ".join(f"{k} {v:.1f}" for k, v in self.league.repl_vpg.items()) + ")")
        return "\n".join(out)

    def t_team(self, team):
        team = str(team or "").upper()
        names = self.seed.get("team_names") or {}
        if team not in names:
            hit = next((c for c, n in names.items() if team.lower() in str(n).lower()), None)
            if not hit:
                return f"Unknown team {team!r}. Codes: {', '.join(sorted(names))}"
            team = hit
        L = [f"{names[team]} ({team})"]
        so = (self.seed.get("sos") or {}).get(team)
        if so:
            L.append(f"  SOS rank {so.get('rank')} of 32 · Vegas win total {so.get('win_total')}")
        if self.byes.get(team):
            L.append(f"  bye: week {self.byes[team]}")
        hc = (self.seed.get("hc_history") or {}).get(team)
        if hc:
            L.append(f"  head coach: {hc.get('name')} (since {hc.get('since')}{', NEW' if hc.get('is_new') else ''})")
        for side, c in ((self.seed.get("coordinators") or {}).get(team) or {}).items():
            if c:
                L.append(f"  {side} coordinator: {c.get('name')} (since {c.get('since')}"
                         f"{', NEW — was ' + str(c.get('prev_role')) + ', ' + str(c.get('prev_team_name')) if c.get('is_new') else ''})")
        pc = (self.seed.get("hc_playcallers") or {}).get(team)
        if pc:
            L.append(f"  offensive play-caller: {pc}")
        posmap = (self.seed.get("seed") or {}).get(team) or {}
        for pos in SKILL:
            rows = sorted(posmap.get(pos) or [], key=lambda r: -self.points(r))[:4]
            if rows:
                L.append(f"  {pos}: " + "; ".join(f"{r['name']} {_r(self.points(r))} pts"
                                                  + (f" ADP {_r(self.adp(r))}" if self.adp(r) < 999 else "")
                                                  for r in rows))
        adds = (self.seed.get("additions") or {}).get(team) or {}
        skill_moves = [f"+{m['player']} ({m['pos']}, {m.get('kind', 'add')})"
                       for k in ("free_agents", "draft") for m in adds.get(k) or []
                       if m.get("pos") in SKILL]
        for m in adds.get("trades") or []:
            # A trade row reads "Traded to X from Y …"; the team's own list holds both directions.
            if m.get("pos") not in SKILL:
                continue
            to = re.match(r"Traded to (\w+)", str(m.get("detail") or ""))
            to = to.group(1) if to else None
            skill_moves.append(f"+{m['player']} ({m['pos']}, trade)" if not to or to == team
                               else f"-{m['player']} ({m['pos']} → {to}, trade)")
        gone = {x.split(" (")[0] for x in skill_moves if x.startswith("-")}
        skill_moves += [f"-{m['player']} ({m['pos']} → {m.get('to_team')})"
                        for m in adds.get("free_agents_lost") or []
                        if m.get("pos") in SKILL and "-" + str(m["player"]) not in gone]
        if skill_moves:
            L.append("  offseason skill moves: " + ", ".join(skill_moves[:12]))
        sch = self.schedule(team, from_week=1)
        if sch:
            L.append("  schedule: " + ", ".join(f"wk{w} {o}" for w, o in sch))
        return "\n".join(L)

    def t_schedule(self, team, from_week=None):
        team = str(team or "").upper()
        sch = self.schedule(team, from_week=int(from_week) if from_week else None)
        if not sch:
            return f"No schedule for {team!r} (is the in-season sidecar built?)."
        sos = self.seed.get("sos") or {}
        out = []
        for w, o in sch:
            so = sos.get(o) if o != "BYE" else None
            out.append(f"wk{w:<2} {o}" + (f"  (opp win total {so.get('win_total')})" if so else ""))
        return f"{team} schedule\n" + "\n".join(out)

    def t_sos(self):
        sos = self.seed.get("sos") or {}
        rows = sorted(sos.items(), key=lambda kv: kv[1].get("rank") or 99)
        return "SOS rank 1 = easiest season schedule (by opponents' Vegas win totals)\n" + "\n".join(
            f"{v.get('rank'):>2} {k:<3} {v.get('name', ''):<24} win total {v.get('win_total')}"
            f" · opp win totals {v.get('opp_win_total')}" for k, v in rows)


TOOLS = [
    {"name": "state", "description": "What this TripleCrown server is serving: season/week of the seed, "
     "the league shape it scores under, and which data is NOT here (browser-only live data).",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "search_players", "description": "Find players by (partial or misspelled) name or Sleeper id. "
     "Returns projected points, value over replacement, ADP, expert rank and id per hit.",
     "inputSchema": {"type": "object", "required": ["query"], "properties": {
         "query": {"type": "string"}, "pos": {"type": "string", "description": "QB/RB/WR/TE"},
         "limit": {"type": "integer", "default": 8}}}},
    {"name": "get_player", "description": "Everything TripleCrown knows about one player, on one sheet: "
     "board (projection, VOR, ECR, tier, ADP, TC model), projected stat line, last seasons, contract, "
     "team schedule/SOS, coaching change, dynasty value.",
     "inputSchema": {"type": "object", "required": ["name"], "properties": {
         "name": {"type": "string", "description": "player name or Sleeper id"},
         "pos": {"type": "string", "description": "disambiguate: QB/RB/WR/TE"}}}},
    {"name": "compare", "description": "Head-to-head between two players: both sheets, the computed "
     "differences (volume, TDs, VOR, market, schedule, TC model) and the analyst framing the app itself uses. "
     "Use this before answering 'who do I start/draft, A or B?'.",
     "inputSchema": {"type": "object", "required": ["a", "b"], "properties": {
         "a": {"type": "string"}, "b": {"type": "string"},
         "question": {"type": "string", "description": "the user's actual question, if any"}}}},
    {"name": "rankings", "description": "The scored draft board under this league's scoring — value over "
     "replacement, projected points, ADP, expert consensus rank and tier.",
     "inputSchema": {"type": "object", "properties": {
         "pos": {"type": "string", "description": "QB/RB/WR/TE; omit for overall"},
         "limit": {"type": "integer", "default": 25},
         "sort": {"type": "string", "description": "vor (default), adp, points, ecr"}}}},
    {"name": "team", "description": "One NFL team: SOS, win total, bye, coaches (new/returning), "
     "projected skill depth chart, offseason skill-position moves, full schedule.",
     "inputSchema": {"type": "object", "required": ["team"], "properties": {
         "team": {"type": "string", "description": "code like DET or a name"}}}},
    {"name": "schedule", "description": "A team's remaining schedule with each opponent's Vegas win total.",
     "inputSchema": {"type": "object", "required": ["team"], "properties": {
         "team": {"type": "string"}, "from_week": {"type": "integer"}}}},
    {"name": "sos", "description": "All 32 teams by strength of schedule (1 = easiest).",
     "inputSchema": {"type": "object", "properties": {}}},
]

RESOURCES = [{"uri": "triplecrown://state", "name": "TripleCrown state", "mimeType": "text/plain",
              "description": "Season, week, league shape and data coverage of this server."}]


class Server:
    """A minimal MCP server over stdio: JSON-RPC 2.0, one message per line."""

    def __init__(self, data_factory):
        self._factory = data_factory
        self._data = None
        self.initialized = False

    @property
    def data(self):
        if self._data is None:
            self._data = self._factory()
        return self._data

    def call_tool(self, name, args):
        d = self.data
        args = args or {}
        fn = {"state": lambda: d.t_state(),
              "search_players": lambda: d.t_search(args.get("query"), args.get("pos"), args.get("limit") or 8),
              "get_player": lambda: d.t_player(args.get("name"), args.get("pos")),
              "compare": lambda: d.t_compare(args.get("a"), args.get("b"), args.get("question")),
              "rankings": lambda: d.t_rankings(args.get("pos"), args.get("limit") or 25, args.get("sort") or "vor"),
              "team": lambda: d.t_team(args.get("team")),
              "schedule": lambda: d.t_schedule(args.get("team"), args.get("from_week")),
              "sos": lambda: d.t_sos()}.get(name)
        if fn is None:
            raise KeyError(name)
        return fn()

    def handle(self, msg):
        """One request → one response dict, or None for a notification."""
        method, mid, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
        if method is None:
            return None
        if method.startswith("notifications/"):
            if method == "notifications/initialized":
                self.initialized = True
            return None
        try:
            if method == "initialize":
                want = params.get("protocolVersion")
                result = {"protocolVersion": want if want in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[-1],
                          "capabilities": {"tools": {"listChanged": False}, "resources": {}},
                          "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                          "instructions": "Fantasy football data from TripleCrown. For any 'A or B' question "
                                          "call compare first; for a single player call get_player; use "
                                          "search_players when a name is uncertain. Cite the numbers, not the ranks."}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                name = params.get("name")
                try:
                    text = self.call_tool(name, params.get("arguments"))
                    result = {"content": [{"type": "text", "text": text}], "isError": False}
                except KeyError:
                    return self._error(mid, -32602, f"unknown tool {name!r}")
                except Exception as e:  # a tool's failure is a tool result, per spec
                    result = {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True}
            elif method == "resources/list":
                result = {"resources": RESOURCES}
            elif method == "resources/read":
                uri = params.get("uri")
                if uri != RESOURCES[0]["uri"]:
                    return self._error(mid, -32002, f"unknown resource {uri!r}")
                result = {"contents": [{"uri": uri, "mimeType": "text/plain", "text": self.data.t_state()}]}
            elif method in ("prompts/list",):
                result = {"prompts": []}
            else:
                return self._error(mid, -32601, f"method not found: {method}")
        except Exception as e:
            return self._error(mid, -32603, f"{type(e).__name__}: {e}")
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    @staticmethod
    def _error(mid, code, message):
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}

    def serve(self, inp=None, out=None):
        inp, out = inp or sys.stdin, out or sys.stdout
        for line in inp:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                out.write(json.dumps(self._error(None, -32700, "parse error")) + "\n")
                out.flush()
                continue
            msgs = msg if isinstance(msg, list) else [msg]
            for m in msgs:
                resp = self.handle(m) if isinstance(m, dict) else self._error(None, -32600, "invalid request")
                if resp is not None:
                    out.write(json.dumps(resp, ensure_ascii=False) + "\n")
                    out.flush()


def _parse_kv(pairs):
    out = {}
    for kv in pairs:
        k, _, v = kv.partition("=")
        out[k] = int(v) if v.isdigit() else v
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--seed", default=SEED_PATH)
    ap.add_argument("--inseason", default=INSEASON_PATH)
    ap.add_argument("--format", default="ppr", choices=sorted(FORMATS),
                    help="league shape to score under when no --league is given")
    ap.add_argument("--league", help="Sleeper league id: score under its real settings (fetched once, cached)")
    ap.add_argument("--call", nargs="+", metavar="TOOL [k=v ...]",
                    help="run one tool from the command line and exit")
    a = ap.parse_args(argv)

    def factory():
        league = sleeper_league(a.league) if a.league else None
        return TripleCrown(league=league, fmt=a.format, seed_path=a.seed, inseason_path=a.inseason)

    srv = Server(factory)
    if a.call:
        print(srv.call_tool(a.call[0], _parse_kv(a.call[1:])))
        return 0
    log(f"serving {SERVER_NAME} {SERVER_VERSION} over stdio (format {a.league or a.format})")
    srv.serve()
    return 0


if __name__ == "__main__":
    sys.exit(main())
