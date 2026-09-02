#!/usr/bin/env python3
"""Monte-Carlo mock-draft simulator + per-round cheat-sheet generator.

Simulates full snake drafts (incl. 3rd-round-reversal) for a Sleeper league:
opponents draft off noisy market ADP with positional-need behavior (the same
market model as the webapp's VONA engine in src/js/98-draft-follow.js:
sigma = clamp(adp*0.18, 3.5, 24)); our seat runs a configurable strategy.
Player value = the seed's Sleeper-baseline projections scored under the
league's actual scoring (incl. expected value of per-game yardage bonuses,
calibrated on 2023-25 nflverse weekly data), optionally tilted by the TC model
(same clamp as the app's tcPts) and by a weekly-floor preference.

Team quality is scored the way a "vampire" league punishes weakness: expected
weekly starting-lineup points across weeks 1..14 (byes + optimal fill from
bench), the probability of landing in the league's bottom-3 in a given week
(vampire-target risk), and steal-resilience (lineup points after losing the
roster's best player).

Our seat's agent is selectable (--strategy): the sim's own my_pick ("smart"),
a faithful replica of the webapp's on-the-clock advisory ("app", to measure what
blindly following it produces; "app2" adds budget guards), or the decision core
that was ported back INTO the webapp's computeVONA ("app3" — keep it in sync
with src/js/98-draft-follow.js).

Usage:
  python3 tools/draft_sim.py --league <league_id> --user <user_id> --sims 2000 --out sheet.json
  python3 tools/draft_sim.py --league <league_id> --slot 10 --compare --sims 150
  python3 tools/draft_sim.py --league <league_id> --slot 10 --strategy app3 --sims 300

Stdlib-only, like the core seed pipeline.
"""
import argparse
import csv
import io
import json
import math
import os
import random
import statistics
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED_PATH = os.path.join(ROOT, "seeds", "triplecrown_seed.json")
CACHE_DIR = os.path.join(ROOT, "cache", "draftsim")

SLEEPER_LEAGUE_URL = "https://api.sleeper.app/v1/league/{}"
SLEEPER_LG_DRAFTS_URL = "https://api.sleeper.app/v1/league/{}/drafts"
NFLDATA_GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
NFLVERSE_TO_SEED = {"LA": "LAR", "OAK": "LV", "SD": "LAC", "STL": "LAR"}

# ── Weekly-score volatility, calibrated on 2023-25 nflverse weekly data ──────
# sd(week pts) ≈ a + b * (PPR points per game), fit over player-seasons with
# 8+ games above a per-position floor (QB 8 / RB 5 / WR 5 / TE 4 ppg).
WEEK_SD = {"QB": (6.43, 0.067), "RB": (3.59, 0.275), "WR": (3.20, 0.337), "TE": (2.01, 0.435)}

# ── Big-game bonus probability curves (empirical, 2023-25) ───────────────────
# P(single-game stat >= threshold) as a function of the player's per-game
# average; linear interpolation between bucket midpoints, flat above the top.
BONUS_CURVES = {
    "rush100": [(25, .009), (35, .018), (45, .055), (55, .111), (65, .162), (75, .213), (85, .281), (95, .443), (115, .58)],
    "rush200": [(55, .0), (65, .002), (75, .012), (95, .038), (115, .07)],
    "rec100": [(25, .006), (35, .022), (45, .054), (55, .105), (65, .187), (75, .211), (85, .355), (95, .421), (110, .48)],
    "rec200": [(65, .0), (75, .003), (95, .018), (105, .039), (120, .06)],
    "pass300": [(162, .017), (187, .085), (212, .102), (237, .176), (262, .279), (287, .357), (310, .45)],
    "pass400": [(200, .005), (240, .012), (262, .022), (287, .071), (320, .11)],
}

KDEF_WEEKLY_PTS = 14.5   # K + DEF combined weekly expectation (same for every team)
KDEF_WEEKLY_SD = 6.0
VAMPIRE_WEEKS = list(range(1, 15))  # weeks the vampire hunts (regular season)


def interp(curve, x):
    if x <= curve[0][0]:
        return curve[0][1] * max(0.0, x / curve[0][0])  # fade to 0 below the first bucket
    if x >= curve[-1][0]:
        return curve[-1][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return curve[-1][1]


def norm_cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def norm_name(s):
    s = "".join(c for c in str(s).lower() if c.isalnum() or c == " ").strip()
    parts = [p for p in s.split() if p not in ("jr", "sr", "ii", "iii", "iv", "v")]
    return "".join(parts)


# ── League config ────────────────────────────────────────────────────────────

class League:
    def __init__(self, league_json, draft_json):
        self.name = league_json.get("name", "?")
        self.scoring = league_json.get("scoring_settings") or {}
        rp = league_json.get("roster_positions") or []
        self.lineup = {"QB": 0, "RB": 0, "WR": 0, "TE": 0, "FLEX": 0, "SUPER_FLEX": 0, "K": 0, "DEF": 0}
        self.bench = 0
        for slot in rp:
            if slot == "BN":
                self.bench += 1
            elif slot in ("WRRB_FLEX", "REC_FLEX"):
                self.lineup["FLEX"] += 1  # close enough for a 2-flex PPR board
            elif slot in self.lineup:
                self.lineup[slot] += 1
        st = (draft_json or {}).get("settings") or {}
        self.teams = st.get("teams") or league_json.get("total_rosters") or 12
        self.rounds = st.get("rounds") or (sum(self.lineup.values()) + self.bench)
        self.reversal = st.get("reversal_round") or 0
        self.qb_limit = st.get("position_limit_qb") or 3
        self.kd_slots = self.lineup["K"] + self.lineup["DEF"]
        self.skill_picks = self.rounds - self.kd_slots
        # Replacement levels; compute_vor() fills these in against a real pool.
        self.repl_vpg = {"QB": 0.0, "RB": 0.0, "WR": 0.0, "TE": 0.0}
        self.flex_repl_vpg = 0.0
        self.sf_repl_vpg = 0.0
        # Market context for one run: how far ahead of the ADP board this room
        # is running (read live), and how far ahead we make it run (for tests).
        self.adp_index = {}
        self.now_pick = None    # set by run_draft before each chooser call
        self.use_drift = False
        self.drift = {"QB": 0.0, "RB": 0.0, "WR": 0.0, "TE": 0.0}
        self.opp_drift = {}

    def starters_skill(self):
        """(dedicated starters, RB/WR/TE flex slots, superflex slots).

        The superflex count is kept apart from the flex count on purpose: a
        SUPER_FLEX slot can start a quarterback and a FLEX cannot, and folding
        the two together is what makes a superflex board look like a 1QB board.
        The app keeps them apart too — see FLEX_ELIGIBLE in
        src/js/98-draft-follow.js and leagueStarterCounts() in
        src/js/60-rankings-data.js."""
        return ({p: self.lineup[p] for p in ("QB", "RB", "WR", "TE")},
                self.lineup["FLEX"], self.lineup["SUPER_FLEX"])

    def superflex(self):
        return self.lineup["SUPER_FLEX"] > 0 or self.lineup["QB"] > 1

    def qb_cap(self):
        """Most QBs worth rostering: one spare behind the startable slots where a
        superflex creates them, two otherwise. Same formula as posCap in
        _vonaBudget (src/js/98-draft-follow.js), bounded by the league's own
        position limit, which Sleeper enforces in the real draft."""
        sf = self.lineup["SUPER_FLEX"]
        slots = self.lineup["QB"] + sf
        # One spare behind the startable slots wherever more than one QB starts —
        # a dedicated 2-QB lineup counts exactly like a superflex here (the old
        # `if sf` capped BAFL-style rooms at their bare starters).
        return min(self.qb_limit, slots + 1 if slots >= 2 else 2)

    def te_cap(self):
        return max(2, self.lineup["TE"] + 1)

    def qb_starters(self):
        """Startable QB slots: the dedicated ones plus the superflex slots a QB
        is expected to fill. In a 1QB room this is 1; in superflex it is 2, and
        a roster that stops at one has an empty starting slot every week."""
        return self.lineup["QB"] + (self.lineup["SUPER_FLEX"] if self.superflex() else 0)


def slot_on_clock(pick_no, teams, reversal_round):
    rnd = (pick_no - 1) // teams + 1
    idx = (pick_no - 1) % teams + 1
    reversed_ = (rnd % 2 == 0)
    if reversal_round and rnd >= reversal_round:
        reversed_ = not reversed_
    return (teams - idx + 1) if reversed_ else idx


def my_pick_numbers(slot, league):
    return [p for p in range(1, league.teams * league.rounds + 1)
            if slot_on_clock(p, league.teams, league.reversal) == slot]


# ── Scoring under the league's settings ──────────────────────────────────────

def league_points(p, sc, games):
    """Season fantasy points for a seed projection row under Sleeper scoring
    `sc`, including expected value of per-game yardage bonuses."""
    g = max(1.0, games)
    pts = (
        p.get("passing_yards", 0) * sc.get("pass_yd", 0)
        + p.get("passing_touchdowns", 0) * sc.get("pass_td", 0)
        + p.get("interceptions_thrown", 0) * sc.get("pass_int", 0)
        + p.get("rushing_yards", 0) * sc.get("rush_yd", 0)
        + p.get("rushing_tds", 0) * sc.get("rush_td", 0)
        + p.get("receptions", 0) * sc.get("rec", 0)
        + p.get("receiving_yards", 0) * sc.get("rec_yd", 0)
        + p.get("receiving_tds", 0) * sc.get("rec_td", 0)
    )
    ry_g = (p.get("rushing_yards") or 0) / g
    cy_g = (p.get("receiving_yards") or 0) / g
    py_g = (p.get("passing_yards") or 0) / g
    pts += g * (
        (sc.get("bonus_rush_yd_100") or 0) * interp(BONUS_CURVES["rush100"], ry_g)
        + (sc.get("bonus_rush_yd_200") or 0) * interp(BONUS_CURVES["rush200"], ry_g)
        + (sc.get("bonus_rec_yd_100") or 0) * interp(BONUS_CURVES["rec100"], cy_g)
        + (sc.get("bonus_rec_yd_200") or 0) * interp(BONUS_CURVES["rec200"], cy_g)
        + (sc.get("bonus_pass_yd_300") or 0) * interp(BONUS_CURVES["pass300"], py_g)
        + (sc.get("bonus_pass_yd_400") or 0) * interp(BONUS_CURVES["pass400"], py_g)
    )
    return pts


# ── Player pool ──────────────────────────────────────────────────────────────

class Player:
    __slots__ = ("pid", "name", "pos", "team", "adp", "adp_eff", "sigma", "val",
                 "vpg", "vpg_active", "sd_week", "vor", "bye", "ecr", "tier",
                 "tc_mult", "idx", "noisy", "src", "risk", "upside", "spread")

    def __repr__(self):
        return f"<{self.name} {self.pos} adp={self.adp} val={self.val:.0f}>"


# ── Analyst projections (the "pro" baseline) ─────────────────────────────────
# A projections export keyed by Sleeper player_id, with one row per analyst.
# Using it makes the board — and therefore VOR, VONA and every downstream
# recommendation — an expression of what the analysts actually project, instead
# of the platform's own numbers.

PRO_FIELD_MAP = {          # analyst field -> the seed field league_points reads
    "passing_yards": "passing_yards",
    "passing_touchdowns": "passing_touchdowns",
    "interceptions_thrown": "interceptions_thrown",
    "rushing_yards": "rushing_yards",
    "rushing_touchdowns": "rushing_tds",
    "receptions": "receptions",
    "receiving_yards": "receiving_yards",
    "receiving_touchdowns": "receiving_tds",
}
PRO_GAMES = 17.0           # analyst season totals are full-season by convention


def load_pro_projections(path, analyst="consensus"):
    """player_id -> a seed-shaped stat line built from an analyst projections file.

    `analyst` picks one analyst by name, or "consensus" to average every analyst
    who projected that player. Consensus also carries `spread`: the coefficient
    of variation of the analysts' scoring-stat totals, which is a usable stand-in
    for how contested a player's outlook is.
    """
    with open(path) as f:
        raw = json.load(f)
    rows = raw.get("projections") if isinstance(raw, dict) else raw
    by_pid = {}
    for r in rows or []:
        pid = str((r.get("sleeper") or {}).get("player_id") or r.get("player_id") or "")
        if not pid:
            continue
        if analyst != "consensus" and (r.get("analyst_name") or "").lower() != analyst.lower():
            continue
        by_pid.setdefault(pid, []).append(r)
    out = {}
    for pid, rs in by_pid.items():
        line = {"name": rs[0].get("name"), "pos": rs[0].get("fantasy_position"),
                "team": rs[0].get("team"), "games": PRO_GAMES, "_n": len(rs)}
        for src, dst in PRO_FIELD_MAP.items():
            # Same rule as the app's averageGroup (src/js/85-import-export.js):
            # average the analysts who actually carry the field, not all of them,
            # so one analyst's blank does not silently halve a projection.
            vals = [float(r[src]) for r in rs
                    if r.get(src) is not None and r.get(src) != ""]
            line[dst] = (sum(vals) / len(vals)) if vals else 0.0
        for extra in ("risk", "upside"):
            vals = [float(r[extra]) for r in rs if r.get(extra) is not None]
            line["_" + extra] = (sum(vals) / len(vals)) if vals else None
        # Analyst disagreement, as a scale-free spread of total scoring volume.
        tot = [sum(float(r.get(src) or 0.0) for src in PRO_FIELD_MAP) for r in rs]
        mu = sum(tot) / len(tot)
        line["_spread"] = ((statistics.pstdev(tot) / mu) if len(tot) > 1 and mu > 0 else 0.0)
        out[pid] = line
    return out


def market_format(league):
    """Which ADP board this league actually drafts off. Mirrors adpFor() in
    src/js/60-rankings-data.js: a superflex/2QB room runs on the 2QB board, and
    the PPR variants each have their own. Getting this wrong makes the simulated
    room draft QBs at the wrong time, which is most of what a superflex draft is."""
    if league.lineup["SUPER_FLEX"] or league.lineup["QB"] > 1:
        return "superflex"
    rec = float(league.scoring.get("rec") or 0)
    return "ppr" if rec >= 1 else "half_ppr" if rec >= 0.5 else "std"


ADP_COLUMNS = {"superflex": ("adp_2qb",), "ppr": ("adp_ppr",),
               "half_ppr": ("adp_half_ppr",), "std": ("adp_std", "adp")}


def adp_for(row, fmt):
    """The market's rank for this player on `fmt`'s board, falling back the same
    way the app does when a format's column is missing."""
    for key in ADP_COLUMNS.get(fmt, ("adp_ppr",)) + ("adp_ppr", "adp"):
        v = row.get(key)
        if v is not None and v != "" and float(v) < 999:
            return float(v)
    return 999.0


def adp_sigma(adp):
    return min(24.0, max(3.5, adp * 0.18))  # mirrors 98-draft-follow.js adpSigma()


def build_pool(seed, sc, byes, tc_weight, floor_kappa, pro=None, fmt="ppr"):
    """The draft board. With `pro` (see load_pro_projections) the analysts'
    stat lines replace the seed's for every player they cover, and the seed's
    remaining players are rescaled onto the analysts' scale per position so the
    deep board stays comparable with the top of it. `fmt` selects which ADP board
    the simulated room drafts off — see market_format()."""
    rows = []
    for team, posmap in seed["seed"].items():
        for pos in ("QB", "RB", "WR", "TE"):
            rows.extend(posmap.get(pos) or [])
    ecr_tbl = (seed.get("ecr") or {}).get("ppr") or {}

    # Pass 1: score every row on both sources, so the two can be reconciled.
    scored = []
    for r in rows:
        games = min(17.0, float(r.get("games") or r.get("games_played") or 17))
        seed_pts = league_points(r, sc, games)
        line = (pro or {}).get(str(r.get("player_id") or ""))
        pro_pts = league_points(line, sc, PRO_GAMES) if line else None
        scored.append((r, games, seed_pts, line, pro_pts))
    # Per-position calibration: the analysts' median view of a player the seed
    # also has. Applied to the players the analysts didn't cover.
    factor = {}
    for pos in ("QB", "RB", "WR", "TE"):
        ratios = [pp / sp for (r, _g, sp, ln, pp) in scored
                  if ln and r["pos"] == pos and sp > 30 and pp]
        factor[pos] = statistics.median(ratios) if len(ratios) >= 5 else 1.0

    pool = []
    for r, games, seed_pts, line, pro_pts in scored:
        if line:
            base_pts, games = pro_pts, PRO_GAMES
        else:
            base_pts = seed_pts * factor.get(r["pos"], 1.0)
        if base_pts <= 0:
            continue
        p = Player()
        p.pid = str(r.get("player_id") or "")
        p.name = r["name"]
        p.pos = r["pos"]
        p.team = r.get("team") or ""
        p.adp = adp_for(r, fmt)
        p.src = "pro" if line else ("seed*" if pro else "seed")
        p.risk = (line or {}).get("_risk") if line else r.get("risk")
        p.upside = (line or {}).get("_upside") if line else r.get("upside")
        p.spread = (line or {}).get("_spread") if line else None
        tc = r.get("tc") or {}
        p.tc_mult = 1.0
        if (tc.get("base") or 0) >= 5 and tc.get("fpg") is not None:
            p.tc_mult = min(2.0, max(0.25, tc["fpg"] / tc["base"]))  # same clamp as app tcPts
        p.val = base_pts * ((1.0 - tc_weight) + tc_weight * p.tc_mult)
        p.vpg = p.val / 17.0
        p.vpg_active = p.val / games
        a, b = WEEK_SD[p.pos]
        p.sd_week = a + b * p.vpg_active
        # Vampire tilt: prefer steadier week-to-week producers when values are close.
        p.val -= floor_kappa * 17.0 * (p.sd_week - a)  # only the volume-driven part of sd
        p.vpg = p.val / 17.0
        p.bye = byes.get(p.team)
        e = ecr_tbl.get(norm_name(p.name)) or {}
        p.ecr = e.get("rank_ecr")
        p.tier = e.get("tier")
        p.vor = 0.0
        pool.append(p)
    # Market rank for players the market doesn't draft: park them behind the board.
    undrafted = sorted((p for p in pool if p.adp >= 999), key=lambda p: -p.val)
    for i, p in enumerate(undrafted):
        p.adp_eff = 190.0 + 1.5 * i
        p.sigma = 30.0
    for p in pool:
        if p.adp < 999:
            p.adp_eff = p.adp
            p.sigma = adp_sigma(p.adp)
    pool = sorted(pool, key=lambda p: p.adp_eff)[:400]
    for i, p in enumerate(pool):
        p.idx = i
    return pool


SF_QB_FLOOR = 2.3   # QBs per team a superflex room ends up needing (app: computeVOR)


def apply_market_model(fantasy_obj):
    """Adopt the seed's fitted survival calibration (draft_corpus.py refresh),
    within hard bounds so a bad blob can never reach a simulation. Mirrors
    _vonaMixParams in the app."""
    global MIX_EPS, MIX_TAU
    mm = (fantasy_obj or {}).get("market_model") or {}
    eps, tau = mm.get("eps"), mm.get("tau")
    if isinstance(eps, (int, float)) and 0.0 <= eps <= 0.5:
        MIX_EPS = float(eps)
    if isinstance(tau, (int, float)) and 20.0 <= tau <= 300.0:
        MIX_TAU = float(tau)


def build_board(seed, league, byes, tc_weight=0.0, floor_kappa=0.08, pro=None):
    """The one correct way to get a scored, VOR'd board for a league.

    build_pool() takes the ADP format as a parameter and defaults it to PPR,
    which silently simulates a superflex league off the single-QB board — the
    quarterbacks then fall two rounds late and every conclusion drawn from the
    run is wrong. Deriving it from the league here means a caller cannot make
    that mistake by omission."""
    apply_market_model(seed)
    pool = build_pool(seed, league.scoring, byes, tc_weight, floor_kappa,
                      pro=pro, fmt=market_format(league))
    compute_vor(pool, league)
    return pool


def compute_vor(pool, league):
    """Sets p.vor and league.repl_vpg (replacement-level per-week value per pos).

    Replacement level is the last starter the whole league consumes at each
    position: dedicated slots first, then the RB/WR/TE flexes, then the
    superflex slots — which quarterbacks are eligible for and usually win. This
    mirrors computeVOR() in src/js/60-rankings-data.js, including its superflex
    QB floor; without that floor a superflex board prices QBs off the 1QB
    replacement level and the whole position reads as worthless."""
    base, flex_n, sf_n = league.starters_skill()
    bypos = {pos: sorted((p for p in pool if p.pos == pos), key=lambda p: -p.val) for pos in base}
    ptr = {pos: base[pos] * league.teams for pos in base}

    def consume(eligible, count):
        for _ in range(count):
            best, best_val = None, None
            for pos in eligible:
                if ptr[pos] < len(bypos[pos]):
                    v = bypos[pos][ptr[pos]].val
                    if best_val is None or v > best_val:
                        best, best_val = pos, v
            if best is None:
                return
            ptr[best] += 1

    consume(("RB", "WR", "TE"), flex_n * league.teams)
    consume(("QB", "RB", "WR", "TE"), sf_n * league.teams)
    if sf_n:
        ptr["QB"] = max(ptr["QB"], math.ceil(league.teams * SF_QB_FLOOR))
    league.repl_vpg = {}
    for pos in base:
        lst = bypos[pos]
        if not lst:
            league.repl_vpg[pos] = 0.0
            continue
        baseline = lst[min(max(ptr[pos] - 1, 0), len(lst) - 1)].val
        league.repl_vpg[pos] = baseline / 17.0
        for p in lst:
            p.vor = p.val - baseline
    league.flex_repl_vpg = min(league.repl_vpg.get(q, 0.0) for q in ("RB", "WR", "TE"))
    league.sf_repl_vpg = (min(league.repl_vpg.get(q, 0.0) for q in ("QB", "RB", "WR", "TE"))
                          if sf_n else league.flex_repl_vpg)


# ── Reading the room ─────────────────────────────────────────────────────────
# ADP is a national average. A given room is not: superflex leagues in this
# sample take 5.8 quarterbacks in round one where the 2QB board says three, and
# a survival model that trusts the board tells you to wait for players who are
# already gone. Every pick that has happened is evidence about the room, so use
# it: measure how far ahead of the board each position is running, and price the
# remaining players at that position as if their ADP were that much earlier.

DRIFT_CAP = 24.0        # picks; one strange run must not rewrite the board
DRIFT_PRIOR = 4.0       # pseudo-picks of "the board is right" to damp early noise
DRIFT_DEADZONE = 2.0    # picks; below this the "signal" is just a normal room


def position_adp_index(pool):
    """{pos: [adp of the 1st, 2nd, ... player off the board there]} — the
    national board's own schedule for each position."""
    idx = {}
    for pos in ("QB", "RB", "WR", "TE"):
        idx[pos] = sorted(p.adp_eff for p in pool if p.pos == pos)
    return idx


def market_drift(counts, pick_no, adp_index, teams, seats_counted=None):
    """Picks-ahead-of-board, per position, from what the room has already taken.

    `counts` is drafted-so-far per position. If the room's kth player at a
    position was supposed to go at pick M and it is only pick N, the room is
    running M-N picks early there. Damped toward zero while the sample is small
    and clamped, so the correction earns its influence rather than assuming it.
    """
    scale = (teams / seats_counted) if seats_counted else 1.0
    drift = {}
    for pos, sched in adp_index.items():
        drift[pos] = 0.0
        if not sched:
            continue
        k = counts.get(pos, 0) * scale
        # With none gone the signal is that the position's best player is still
        # sitting there, so compare against the board's very first name.
        due = sched[min(int(round(k)), len(sched)) - 1] if k >= 1 else sched[0]
        # Evidence is the larger of what happened and what the board predicted:
        # "five receivers should be gone and none are" says as much as five going
        # early, and neither says much on pick two.
        expected = sum(1 for a in sched if a <= pick_no)
        m = max(k, expected)
        if m < 1:
            continue
        raw = max(-DRIFT_CAP, min(DRIFT_CAP, due - pick_no))
        val = raw * (m / (m + DRIFT_PRIOR))
        # Every room wobbles a few picks around the board by chance. Correcting
        # for that is fitting noise, so only move once the gap is real, and then
        # only by the part that exceeds it.
        if abs(val) <= DRIFT_DEADZONE:
            continue
        drift[pos] = val - math.copysign(DRIFT_DEADZONE, val)
    return drift


# ── Draft simulation ─────────────────────────────────────────────────────────

class TeamState:
    __slots__ = ("counts", "kd_open", "roster")

    def __init__(self, kd_slots):
        self.counts = {"QB": 0, "RB": 0, "WR": 0, "TE": 0}
        self.kd_open = kd_slots
        self.roster = []


POS_CAPS = {"QB": 3, "RB": 8, "WR": 9, "TE": 3}


def opponent_pick(state, order, taken, rnd, picks_left, league, rng):
    """Pick for a market-driven opponent: best noisy-ADP with need adjustments.
    Returns a Player, or None for a K/DEF pick (consumes no skill player)."""
    if state.kd_open > 0:
        if picks_left <= state.kd_open:
            state.kd_open -= 1
            return None
        ramp = rnd - (league.rounds - 3)
        p_kd = 0.0 if ramp < 0 else (0.05, 0.18, 0.45)[min(2, ramp)]
        if rng.random() < p_kd:
            state.kd_open -= 1
            return None
    base, _flex_n, _sf_n = league.starters_skill()
    need_qb = state.counts["QB"] < league.qb_starters()
    need_te = state.counts["TE"] < base["TE"]
    skill_left = picks_left - state.kd_open
    open_starts = sum(max(0, base[q] - state.counts[q]) for q in base)
    must_fill = open_starts >= skill_left
    best, best_score = None, None
    for p in order:
        if taken[p.idx]:
            continue
        c = state.counts[p.pos]
        if c >= POS_CAPS[p.pos] or (p.pos == "QB" and c >= league.qb_limit):
            continue
        score = p.noisy
        if p.pos == "QB" and c >= league.qb_starters():
            score += 30 if rnd <= 9 else 12
        if p.pos == "TE" and c >= 1:
            score += 22 if rnd <= 9 else 8
        if rnd >= 9 and need_qb and p.pos == "QB":
            score -= (rnd - 8) * 6
        if rnd >= 9 and need_te and p.pos == "TE":
            score -= (rnd - 8) * 5
        if must_fill:
            needed = ((p.pos == "QB" and need_qb) or (p.pos == "TE" and need_te)
                      or (p.pos == "RB" and state.counts["RB"] < base["RB"])
                      or (p.pos == "WR" and state.counts["WR"] < base["WR"]))
            if not needed:
                continue
        if best_score is None or score < best_score:
            best, best_score = p, score
        if best_score is not None and p.noisy > best_score + 40:
            break  # order is by noisy adp: nothing further can win
    return best


def lineup_value(roster, league, extra_vpg=None, extra_pos=None):
    """Generic-week starting-lineup value with empty slots at replacement level.
    Optionally evaluates with one extra (vpg, pos) added — the candidate."""
    base, flex_n, sf_n = league.starters_skill()
    bypos = {"QB": [], "RB": [], "WR": [], "TE": []}
    for p in roster:
        bypos[p.pos].append(p.vpg)
    if extra_pos:
        bypos[extra_pos].append(extra_vpg)
    total = 0.0
    leftovers, qb_left = [], []
    for pos in bypos:
        vs = sorted(bypos[pos], reverse=True)
        n = base[pos]
        total += sum(vs[:n]) + max(0, n - len(vs)) * league.repl_vpg[pos]
        (qb_left if pos == "QB" else leftovers).extend(vs[n:])
    leftovers.sort(reverse=True)
    total += sum(leftovers[:flex_n]) + max(0, flex_n - len(leftovers)) * league.flex_repl_vpg
    # Superflex slots take the best of what is left, quarterbacks included.
    sf_pool = sorted(leftovers[flex_n:] + qb_left, reverse=True)
    total += sum(sf_pool[:sf_n]) + max(0, sf_n - len(sf_pool)) * league.sf_repl_vpg
    return total


def candidate_score(state, pos, vpg, league):
    """Weekly value a candidate adds: starting-lineup gain, else bench value."""
    gain = lineup_value(state.roster, league, extra_vpg=vpg, extra_pos=pos) \
        - lineup_value(state.roster, league)
    if gain > 0.05:
        return gain
    # Pure bench pick: insurance + bye coverage. Worth more when the position
    # is thin (vampire leagues punish a roster that can't absorb a loss).
    over_repl = max(0.0, vpg - league.repl_vpg[pos])
    thin = 0.15 if state.counts[pos] <= league.lineup[pos] else 0.0
    w = (0.15 if pos == "QB" else 0.12 if pos == "TE" else 0.30) + thin
    return w * over_repl + 0.04 * vpg  # small absolute term breaks dead-bench ties


def expected_best_vpg(cands, next_pick, top_n=12, shift=0.0):
    """E[best per-week value available at our next pick] for one position."""
    ev, p_none = 0.0, 1.0
    for p in cands[:top_n]:
        p_surv = norm_cdf((p.adp_eff - shift - (next_pick - 0.5)) / p.sigma)
        ev += p_none * p_surv * p.vpg
        p_none *= (1.0 - p_surv)
        if p_none < 1e-4:
            break
    if cands:
        ev += p_none * cands[min(top_n, len(cands) - 1)].vpg * 0.9
    return ev


def my_pick_fallback(state, avail_by_pos, league):
    best = None
    for pos in ("QB", "RB", "WR", "TE"):
        c = state.counts[pos]
        if c >= POS_CAPS[pos] or (pos == "QB" and c >= league.qb_cap()) \
                or (pos == "TE" and c >= league.te_cap()):
            continue
        for p in avail_by_pos[pos][:1]:
            if best is None or p.val > best.val:
                best = p
    return best


def my_pick(state, avail_by_pos, next_pick, league, forced_pos=None):
    base, _flex_n, _sf_n = league.starters_skill()
    # Roster minimums: starters plus flex/bye coverage at RB and WR. If the
    # unmet minimums need every remaining pick, draft only those positions.
    min_targets = {"QB": league.qb_starters(), "TE": base["TE"],
                   "RB": base["RB"] + 2, "WR": base["WR"] + 2}
    unmet = {q: max(0, min_targets[q] - state.counts[q]) for q in min_targets}
    picks_left_skill = league.skill_picks - len(state.roster)
    must_fill = sum(unmet.values()) >= picks_left_skill
    bye_counts = {}
    for p in state.roster:
        if p.bye:
            bye_counts[p.bye] = bye_counts.get(p.bye, 0) + 1
    choices = []
    for pos in ("QB", "RB", "WR", "TE"):
        cands = avail_by_pos[pos]
        if not cands:
            continue
        c = state.counts[pos]
        if c >= POS_CAPS[pos] or (pos == "QB" and c >= league.qb_cap()) \
                or (pos == "TE" and c >= league.te_cap()):
            continue
        if must_fill and unmet[pos] == 0:
            continue
        best_now = cands[0]
        v_now = candidate_score(state, pos, best_now.vpg, league)
        if next_pick:
            sh = league.drift.get(pos, 0.0) if league.use_drift else 0.0
            v_next = candidate_score(state, pos,
                                     expected_best_vpg(cands, next_pick, shift=sh), league)
        else:
            v_next = v_now * 0.8
        score = max(0.0, v_now - v_next) + 0.25 * v_now
        if best_now.bye and bye_counts.get(best_now.bye, 0) >= 3:
            score *= 0.95  # avoid stacking a 4th body on one bye week
        choices.append((score, pos, best_now))
    if not choices and must_fill:
        # The must-fill position pools are empty (tiny pools only): take value.
        return my_pick_fallback(state, avail_by_pos, league)
    if not choices:
        return None
    if forced_pos:
        forced = [c for c in choices if c[1] == forced_pos]
        if forced:
            return forced[0][2]
    # Late-round guards: don't leave QB/TE starters unfilled.
    picks_after = league.skill_picks - len(state.roster) - 1
    late_need = {"QB": league.qb_starters(), "TE": base["TE"]}
    for pos in ("QB", "TE"):
        if state.counts[pos] < late_need[pos] and picks_after <= (2 if pos == "QB" else 1) \
                and avail_by_pos[pos]:
            return avail_by_pos[pos][0]
    choices.sort(key=lambda t: -t[0])
    return choices[0][2]


# ── Webapp advisory replica (src/js/98-draft-follow.js computeVONA) ──────────
# A faithful port of the app's on-the-clock advisory, used as a draft strategy
# so the Monte Carlo can measure what a drafter who follows it blindly ends up
# with. guards=False replicates the advisory as shipped; guards=True adds the
# roster-budget rules this sim's own agent uses (the candidate webapp upgrade):
# pick-budget must-fill, late-round QB/TE last-call, position caps, and an
# urgency ramp on unmet minimums as the budget tightens.

WORTH_A_BACKUP = 20.0   # VOR above which a filled QB/TE is a "stud backup" (JS constant)


def _flex_open(state, league):
    """Flex slots this roster has not covered. A superflex slot counts here too
    — it is an open starting spot, and a spare QB is one of the things that
    fills it."""
    base, flex_n, sf_n = league.starters_skill()
    over = sum(max(0, state.counts[q] - base[q]) for q in ("RB", "WR", "TE"))
    # A spare QB only consumes a slot where one can start him.
    spare_qb = max(0, state.counts["QB"] - base["QB"]) if sf_n else 0
    return max(0, flex_n + sf_n - over - spare_qb)


def _league_demand(states, league):
    """JS vonaLeagueDemand: league-wide unfilled starter slots per position;
    a flex slot counts 1/3 toward each of RB/WR/TE."""
    base, flex_n, sf_n = league.starters_skill()
    dem = {"QB": 0.0, "RB": 0.0, "WR": 0.0, "TE": 0.0}
    for st in states.values():
        for q in dem:
            dem[q] += max(0, base[q] - st.counts[q])
        over = sum(max(0, st.counts[q] - base[q]) for q in ("RB", "WR", "TE"))
        fo = max(0, flex_n - over)
        for q in ("RB", "WR", "TE"):
            dem[q] += fo / 3.0
        # A superflex slot is demand at four positions, not three — which is
        # what makes a superflex QB market tight (JS: FLEX_ELIGIBLE.SUPER_FLEX).
        sfo = max(0, sf_n - max(0, over - flex_n) - max(0, st.counts["QB"] - base["QB"]))
        for q in ("QB", "RB", "WR", "TE"):
            dem[q] += sfo / 4.0
    return dem


def _optimal_lineup_vor(roster, league, extra=None):
    """JS _vonaOptimalLineupVor: best-VOR-first fill, dedicated slots before
    flex, empty slots and negative-VOR players contribute 0."""
    base, flex_n, sf_n = league.starters_skill()
    bypos = {"QB": [], "RB": [], "WR": [], "TE": []}
    for p in roster:
        bypos[p.pos].append(p.vor)
    if extra is not None:
        bypos[extra.pos].append(extra.vor)
    total, leftovers, qb_left = 0.0, [], []
    for pos, vs in bypos.items():
        vs.sort(reverse=True)
        total += sum(max(0.0, v) for v in vs[:base[pos]])
        (qb_left if pos == "QB" else leftovers).extend(vs[base[pos]:])
    leftovers.sort(reverse=True)
    total += sum(max(0.0, v) for v in leftovers[:flex_n])
    sf_pool = sorted(leftovers[flex_n:] + qb_left, reverse=True)
    return total + sum(max(0.0, v) for v in sf_pool[:sf_n])


def _expected_best_vor(cands, next_pick, top_n=12, shift=0.0, now_pick=None):
    """E[best-VOR survivor at our next pick] — closed-form survival stand-in for
    the app's per-window MC (same independence assumption as expected_best_vpg).
    `shift` moves this position's whole board earlier by the room's drift.

    `now_pick` conditions on what we can SEE: the player is still on the board
    at this pick, so his survival is S(next)/S(now), not S(next). Without it a
    faller reads as "gone by your next pick" at 3% when reality is ~45% — the
    2026 corpus (tools/draft_corpus.py score) puts the unconditional model at
    Brier 0.18-0.20 and the conditional at 0.11-0.14 on held-out real drafts.
    Kept optional so the frozen baselines (app/app3) replay exactly as shipped."""
    ev, p_none = 0.0, 1.0
    for p in cands[:top_n]:
        s = norm_cdf((p.adp_eff - shift - (next_pick - 0.5)) / p.sigma)
        if now_pick is not None:
            s_now = norm_cdf((p.adp_eff - shift - (now_pick - 0.5)) / p.sigma)
            s = (s / s_now) if s_now > 1e-9 else 1.0
            s = (1.0 - MIX_EPS) * s + MIX_EPS * math.exp(-(next_pick - now_pick) / MIX_TAU)
        ev += p_none * s * p.vor
        p_none *= (1.0 - s)
        if p_none < 1e-4:
            break
    if cands:
        ev += p_none * cands[min(top_n, len(cands) - 1)].vor * 0.9
    return ev


def app_pick(state, avail_by_pos, next_pick, league, states, guards=False):
    """One pick chosen the way the webapp advisory headlines it: rows scored by
    adjDrop x lineupFactor, headline = best-scoring unfilled-starter row, else
    best row overall. See computeVONA in 98-draft-follow.js."""
    base, flex_n, _sf_n = league.starters_skill()
    ded_need = {q: state.counts[q] < base[q] for q in base}
    ded_need["QB"] = state.counts["QB"] < league.qb_starters()
    flex_open = _flex_open(state, league)
    dem = _league_demand(states, league)
    skill_left = league.skill_picks - len(state.roster)
    # Guards (candidate upgrade): unmet roster minimums vs the remaining budget.
    min_targets = {"QB": league.qb_starters(), "TE": base["TE"],
                   "RB": base["RB"] + 2, "WR": base["WR"] + 2}
    unmet = {q: max(0, min_targets[q] - state.counts[q]) for q in min_targets}
    must_fill = guards and sum(unmet.values()) >= skill_left
    if guards:
        # Last-call: don't leave the QB/TE starter to a pick that no longer exists.
        picks_after = skill_left - 1
        for pos, room in (("QB", 2), ("TE", 1)):
            if ded_need[pos] and picks_after <= room and avail_by_pos[pos]:
                return avail_by_pos[pos][0]
    slack = skill_left - sum(unmet.values())
    rows = []
    for pos in ("QB", "RB", "WR", "TE"):
        cands = avail_by_pos[pos]
        if not cands:
            continue
        if guards:
            c = state.counts[pos]
            if c >= POS_CAPS[pos] or (pos == "QB" and c >= league.qb_cap()) \
                    or (pos == "TE" and c >= league.te_cap()):
                continue
            if must_fill and unmet[pos] == 0:
                continue
        now = cands[0]
        startable = [p for p in cands if p.vor > 0]
        supply = len(startable)
        spread = max(0.0, now.vor - (startable[-1].vor if startable else 0.0))
        step = spread / (supply - 1) if supply > 1 else spread
        pressure = (dem[pos] / supply) if supply else (3.0 if dem[pos] > 0 else 0.0)
        flat = supply >= math.ceil(dem[pos]) + 2 and (spread < 14 or step < 1.5)
        sh = league.drift.get(pos, 0.0) if league.use_drift else 0.0
        exp_vor = _expected_best_vor(cands, next_pick, shift=sh) if next_pick else now.vor * 0.8
        raw_drop = now.vor - exp_vor
        if ded_need[pos]:
            weight = 1.0
        elif flex_open and pos in ("RB", "WR", "TE"):
            weight = 0.6
        else:
            weight = 0.5 if now.vor >= WORTH_A_BACKUP else 0.15
        scarcity = 1 + min(0.8, max(0.0, pressure - 0.8) * 0.9)
        puntable = flat and not (ded_need[pos] and pressure >= 1)
        weight *= scarcity * (0.45 if puntable else 1.0)
        if guards and unmet[pos] > 0 and slack <= 3:
            weight *= 1 + 0.3 * (4 - max(0, slack))   # urgency ramp near the budget line
        gain = _optimal_lineup_vor(state.roster, league, extra=now) \
            - _optimal_lineup_vor(state.roster, league)
        rows.append({"pos": pos, "now": now, "adj": raw_drop * weight,
                     "gain": gain, "need": ded_need[pos]})
    if not rows:
        return my_pick_fallback(state, avail_by_pos, league)
    max_gain = max(1.0, max(r["gain"] for r in rows))
    for r in rows:
        r["score"] = r["adj"] * (0.35 + 0.65 * r["gain"] / max_gain)
    rows.sort(key=lambda r: -r["score"])
    needed = [r for r in rows if r["need"]]
    return (needed[0] if needed else rows[0])["now"]


class _Cand:
    """Lightweight (pos, vor) stand-in for _optimal_lineup_vor's `extra`."""
    __slots__ = ("pos", "vor")

    def __init__(self, pos, vor):
        self.pos = pos
        self.vor = vor


# ── Decision-core tunables ───────────────────────────────────────────────────
# Every free parameter in app_pick_v3/_cand_score_vor, named so it can be swept
# rather than argued about. Defaults are the values the app shipped with; see
# tests/test_draft_sim.py for what each one is allowed to do.
V3_NOW_WEIGHT = 0.25      # share of "value added now" added to the regret of waiting
                          # (frozen: this is the pre-2026-09-01 shipped baseline)
# Survival-belief contamination, fitted on 116 real 2026 drafts (draft_corpus.py
# score, leave-one-out): with probability MIX_EPS a still-available player's ADP
# anchor is simply WRONG for this room (news, a fade) and his hazard is a slow
# exp(-picks/MIX_TAU) decay instead of a normal tail. Both formats independently
# land on eps 0.2-0.3, tau 80-120; together with conditioning this takes the
# survival model from Brier .18-.20 to .11-.13 with bias -0.19 -> -0.02.
MIX_EPS = 0.25
MIX_TAU = 120.0
# World-model counterpart, OFF by default: when set, the simulated ROOM also
# contains anchor-is-wrong players (their market position drawn Exp(WORLD_TAU)
# instead of N(adp, sigma)). The measured world (draft_corpus.py) has them; the
# legacy world does not, which is why an agent holding the corpus-validated
# belief can only lose in-sim until this is on. Kept as a switch so every
# historical baseline still replays exactly.
WORLD_EPS = 0.0
WORLD_TAU = 120.0
V5_NOW_WEIGHT = 0.15      # ...and what the app ships now. Swept 0/.10/.15/.25/.40/.60
                          # over 12 seats x 2 formats: 0 is much worse (you must
                          # still prefer the better player when both will last),
                          # 0.25 reaches. 0.15 is the measured best of the range.
V3_DEPTH_RB = 2           # RB bodies wanted beyond the dedicated starters
V3_DEPTH_WR = 2           # WR bodies wanted beyond the dedicated starters
CAND_W_QB = 0.15          # bench weight: a QB behind a filled QB room
CAND_W_TE = 0.12          # bench weight: a TE behind a filled TE room
CAND_W_FLEX = 0.30        # bench weight: an RB/WR who doesn't crack the lineup
CAND_THIN = 0.15          # extra bench weight while the position is still thin
CAND_TIE = 0.04           # small absolute term so dead-bench picks still order
V3_BYE_PENALTY = 0.0      # score multiplier per starter already on that bye week
V3_BYE_FREE = 2           # byes at a week that cost nothing


def _cand_score_ros(roster, counts, pos, vor, league, before=None):
    """candidate_score against an EXPLICIT roster/counts pair. `before` is the
    roster's own optimal-lineup VOR; pass it in when scoring many candidates
    against the same roster, which is the inner loop of the two-ply lookahead."""
    if before is None:
        before = _optimal_lineup_vor(roster, league)
    after = _optimal_lineup_vor(roster, league, extra=_Cand(pos, vor))
    gain = (after - before) / 17.0
    if gain > 0.05:
        return gain
    over_repl = max(0.0, vor) / 17.0
    thin = CAND_THIN if counts[pos] <= league.lineup[pos] else 0.0
    w = (CAND_W_QB if pos == "QB" else CAND_W_TE if pos == "TE" else CAND_W_FLEX) + thin
    return w * over_repl + CAND_TIE * over_repl


def _cand_score_vor(state, pos, vor, league):
    """my_pick's candidate_score, but computed in the webapp's units: VOR and
    the optimal-lineup fill the app already has (empty slots ~ replacement = 0
    VOR). Returns weekly value added: starting-lineup gain, else bench value."""
    return _cand_score_ros(state.roster, state.counts, pos, vor, league)


def _take_top(state, cands, next_pick, league):
    """Default within-position choice: the best player on your board."""
    return cands[0]


# ── Which PLAYER at that position — the reach guard ─────────────────────────
# v3 answers "which position?" and then always takes that position's top-VOR
# player. That is where reaching comes from: a player your projections love and
# the market does not stays the top of his position every pick until you spend
# one on him, and nothing notices that he would still be sitting there two rounds
# later.
#
# So decide between the men at that position over two picks:
#
#     total(p) = what p adds now
#              + what the best of the OTHERS is worth if he survives to my next pick
#
# Restricted to one position this is well posed, and it says the obvious thing:
# if your #1 will last and your #2 will not, take #2 now and let #1 come back to
# you. The cost of reaching is simply the value you forfeit at your next pick —
# no hand-tuned "reach penalty" required.
#
# (Applying the same two-ply ACROSS positions was measured and is worse: 1QB -0.07,
# superflex -1.25 over 12 seats. A one-pick horizon always promises that a good
# player is still coming, so the agent waits on scarce positions until they are
# gone. The cross-positional judgement stays with v3's scarcity/need scoring.)
V5_CAND = 4      # players per position considered
V5_TAIL = 0.9


def _best_in_pos(state, cands, next_pick, league):
    top = cands[:V5_CAND]
    if len(top) < 2 or not next_pick:
        return cands[0]
    surv = [_v4_survival(q, next_pick, league, now_pick=league.now_pick) for q in top]
    before0 = _optimal_lineup_vor(state.roster, league)
    best, best_total = None, None
    for i, p in enumerate(top):
        v_now = _cand_score_ros(state.roster, state.counts, p.pos, p.vor, league,
                                before=before0)
        ros2 = state.roster + [p]
        cnt2 = dict(state.counts)
        cnt2[p.pos] += 1
        before2 = _optimal_lineup_vor(ros2, league)
        ev, p_none = 0.0, 1.0
        for j, q in enumerate(top):
            if j == i:
                continue
            sc = _cand_score_ros(ros2, cnt2, q.pos, q.vor, league, before=before2)
            ev += p_none * surv[j] * sc
            p_none *= (1.0 - surv[j])
        if top:
            ev += p_none * _cand_score_ros(ros2, cnt2, top[-1].pos, top[-1].vor,
                                           league, before=before2) * V5_TAIL
        total = v_now + ev
        if best_total is None or total > best_total:
            best, best_total = p, total
    return best


def app_pick_v5(state, avail_by_pos, next_pick, league, states):
    """The engine the webapp ships: v3's position judgement, a lighter pull
    toward raw board value, the PLAYER at that position chosen over two picks so
    the agent stops reaching on its own board (see _best_in_pos), and survival
    CONDITIONED on the board it can see (see _expected_best_vor's now_pick)."""
    return app_pick_v3(state, avail_by_pos, next_pick, league, states,
                       pick_in_pos=_best_in_pos, now_weight=V5_NOW_WEIGHT,
                       cond=True)


def app_pick_v3(state, avail_by_pos, next_pick, league, states, pick_in_pos=_take_top,
                now_weight=None, cond=False):
    """Candidate webapp advisory: the sim agent's decision core (my_pick) driven
    entirely by data the webapp already computes — VOR pools, expected best VOR
    at the next pick, roster counts. score = regret of waiting + a share of the
    value added now; hard roster-minimum and last-call guards on top.
    `pick_in_pos` decides WHICH player at the winning position (default: the top
    of your board) and `now_weight` how hard raw board value pulls; app_pick_v5
    passes the two-ply reach guard and the lighter weight the app ships."""
    if now_weight is None:
        now_weight = V3_NOW_WEIGHT
    base, _flex_n, _sf_n = league.starters_skill()
    min_targets = {"QB": league.qb_starters(), "TE": base["TE"],
                   "RB": base["RB"] + V3_DEPTH_RB, "WR": base["WR"] + V3_DEPTH_WR}
    unmet = {q: max(0, min_targets[q] - state.counts[q]) for q in min_targets}
    skill_left = league.skill_picks - len(state.roster)
    must_fill = sum(unmet.values()) >= skill_left
    picks_after = skill_left - 1
    need = {"QB": league.qb_starters(), "TE": base["TE"]}
    # Byes already spoken for. A week where several starters are out is a week
    # the lineup can't fill, which the weekly evaluation punishes directly.
    bye_load = {}
    for q in state.roster:
        if q.bye:
            bye_load[q.bye] = bye_load.get(q.bye, 0) + 1
    for pos, room in (("QB", 2), ("TE", 1)):
        if state.counts[pos] < need[pos] and picks_after <= room and avail_by_pos[pos]:
            return pick_in_pos(state, avail_by_pos[pos], next_pick, league)
    choices = []
    for pos in ("QB", "RB", "WR", "TE"):
        cands = avail_by_pos[pos]
        if not cands:
            continue
        c = state.counts[pos]
        if c >= POS_CAPS[pos] or (pos == "QB" and c >= league.qb_cap()) \
                or (pos == "TE" and c >= league.te_cap()):
            continue
        if must_fill and unmet[pos] == 0:
            continue
        now = cands[0]
        v_now = _cand_score_vor(state, pos, now.vor, league)
        if next_pick:
            sh = league.drift.get(pos, 0.0) if league.use_drift else 0.0
            np_ = league.now_pick if cond else None
            v_next = _cand_score_vor(state, pos,
                                     _expected_best_vor(cands, next_pick, shift=sh,
                                                        now_pick=np_), league)
        else:
            v_next = v_now * 0.8
        score = max(0.0, v_now - v_next) + now_weight * v_now
        if V3_BYE_PENALTY and now.bye:
            stacked = max(0, bye_load.get(now.bye, 0) - V3_BYE_FREE + 1)
            score *= max(0.0, 1.0 - V3_BYE_PENALTY * stacked)
        choices.append((score, pos, now))
    if not choices:
        return my_pick_fallback(state, avail_by_pos, league)
    choices.sort(key=lambda t: -t[0])
    return pick_in_pos(state, avail_by_pos[choices[0][1]], next_pick, league)


# ── v4: choose the PLAYER, not the position ─────────────────────────────────
# v3 asks "which POSITION should I take?" and then always takes that position's
# top-VOR player. That is where reaching comes from: if your board loves a
# receiver the market does not, he is cands[0] every single pick until you take
# him, and nothing in the score notices that he would still be sitting there two
# rounds later.
#
# v4 evaluates PLAYERS over a two-pick horizon:
#
#     total(p) = value p adds now  +  value of the best thing still on the board
#                                     at my next pick, GIVEN I took p
#
# The second term is the whole point. Taking a player who was going to fall back
# to you removes a high-value survivor from your own next pick, so his total is
# low — the board is telling you to take the guy who will NOT be there and
# collect the faller later. Taking a player who is about to be gone costs the
# next pick almost nothing, so his total is high. No hand-tuned "reach penalty"
# is needed: the cost of reaching is just the value you forfeit at your next
# pick, priced in the same units as everything else.
V4_CAND_PER_POS = 3    # players per position evaluated individually
V4_HORIZON_POS = 5     # players per position in the "what's left next pick" pool
V4_DEPTH = 20          # how deep the survival expectation runs
V4_NEXT_WEIGHT = 1.0   # weight on what the next pick is still worth
V4_TAIL = 0.9          # residual factor when nothing in the horizon survives
V4_SURV_CAP = 0.995    # a certainty of 1.0 would make the exclusion term blow up


def _v4_survival(p, next_pick, league, now_pick=None):
    sh = league.drift.get(p.pos, 0.0) if league.use_drift else 0.0
    s = norm_cdf((p.adp_eff - sh - (next_pick - 0.5)) / p.sigma)
    if now_pick is not None:
        s_now = norm_cdf((p.adp_eff - sh - (now_pick - 0.5)) / p.sigma)
        s = (s / s_now) if s_now > 1e-9 else 1.0
        s = (1.0 - MIX_EPS) * s + MIX_EPS * math.exp(-(next_pick - now_pick) / MIX_TAU)
    return min(V4_SURV_CAP, s)


def app_pick_v4(state, avail_by_pos, next_pick, league, states):
    """Two-ply, player-level advisory. Same roster guards as v3 (caps, must-fill,
    last call); the ranking underneath them is value-now plus value-still-there,
    which is what stops the agent reaching on its own board."""
    base, _flex_n, _sf_n = league.starters_skill()
    min_targets = {"QB": league.qb_starters(), "TE": base["TE"],
                   "RB": base["RB"] + V3_DEPTH_RB, "WR": base["WR"] + V3_DEPTH_WR}
    unmet = {q: max(0, min_targets[q] - state.counts[q]) for q in min_targets}
    skill_left = league.skill_picks - len(state.roster)
    must_fill = sum(unmet.values()) >= skill_left
    picks_after = skill_left - 1
    need = {"QB": league.qb_starters(), "TE": base["TE"]}
    for pos, room in (("QB", 2), ("TE", 1)):
        if state.counts[pos] < need[pos] and picks_after <= room and avail_by_pos[pos]:
            return avail_by_pos[pos][0]

    def legal(pos, counts):
        c = counts[pos]
        if c >= POS_CAPS[pos]:
            return False
        if pos == "QB" and c >= league.qb_cap():
            return False
        if pos == "TE" and c >= league.te_cap():
            return False
        if must_fill and unmet[pos] == 0:
            return False
        return True

    cands, horizon = [], []
    for pos in ("QB", "RB", "WR", "TE"):
        if not legal(pos, state.counts):
            continue
        cands.extend(avail_by_pos[pos][:V4_CAND_PER_POS])
        horizon.extend(avail_by_pos[pos][:V4_HORIZON_POS])
    if not cands:
        return my_pick_fallback(state, avail_by_pos, league)
    if not next_pick:
        return max(cands, key=lambda q: _cand_score_vor(state, q.pos, q.vor, league))

    surv = {id(q): _v4_survival(q, next_pick, league) for q in horizon}
    before0 = _optimal_lineup_vor(state.roster, league)
    best, best_total = None, None
    for p in cands:
        v_now = _cand_score_ros(state.roster, state.counts, p.pos, p.vor, league,
                                before=before0)
        ros2 = state.roster + [p]
        cnt2 = dict(state.counts)
        cnt2[p.pos] += 1
        before2 = _optimal_lineup_vor(ros2, league)
        scored = []
        for q in horizon:
            if q is p or not legal(q.pos, cnt2):
                continue
            scored.append((_cand_score_ros(ros2, cnt2, q.pos, q.vor, league,
                                           before=before2), q))
        scored.sort(key=lambda t: -t[0])
        ev, p_none = 0.0, 1.0
        for sc, q in scored[:V4_DEPTH]:
            s = surv[id(q)]
            ev += p_none * s * sc
            p_none *= (1.0 - s)
            if p_none < 1e-4:
                break
        if scored:
            ev += p_none * scored[-1][0] * V4_TAIL
        total = v_now + V4_NEXT_WEIGHT * ev
        if best_total is None or total > best_total:
            best, best_total = p, total
    return best


def run_draft(pool, league, my_slot, rng, pattern=None, avail_hook=None, market_only=False,
              chooser=None):
    """One full mock. Returns (my_roster, states, my_log). `avail_hook(k, taken)`
    is called at each of our picks (k = 0-based index into our pick list).
    With market_only, our seat drafts like the market too — used to measure
    neutral availability ("would he be there if I waited")."""
    od = league.opp_drift or {}
    for p in pool:
        if WORLD_EPS and rng.random() < WORLD_EPS:
            p.noisy = rng.expovariate(1.0 / WORLD_TAU)
        else:
            p.noisy = p.adp_eff - od.get(p.pos, 0.0) + rng.gauss(0.0, p.sigma)
    order = sorted(pool, key=lambda p: p.noisy)
    if league.use_drift and not league.adp_index:
        league.adp_index = position_adp_index(pool)
    taken = [False] * len(pool)
    states = {s: TeamState(league.kd_slots) for s in range(1, league.teams + 1)}
    my_picks = my_pick_numbers(my_slot, league)
    my_log = []
    avail_by_pos = {pos: sorted((p for p in pool if p.pos == pos), key=lambda p: -p.val)
                    for pos in ("QB", "RB", "WR", "TE")}
    total = league.teams * league.rounds
    my_k = 0
    for pick_no in range(1, total + 1):
        slot = slot_on_clock(pick_no, league.teams, league.reversal)
        st = states[slot]
        rnd = (pick_no - 1) // league.teams + 1
        picks_left = league.rounds - rnd + 1
        if slot == my_slot and not market_only:
            if avail_hook:
                avail_hook(my_k, taken)
            my_k += 1
            if picks_left <= st.kd_open:  # our last picks: K then DEF
                st.kd_open -= 1
                continue
            later = [n for n in my_picks if n > pick_no]
            nxt = later[0] if later else None
            if league.use_drift:
                seen = {q: sum(t.counts[q] for sl, t in states.items() if sl != my_slot)
                        for q in ("QB", "RB", "WR", "TE")}
                league.drift = market_drift(seen, pick_no, league.adp_index,
                                            league.teams, league.teams - 1)
            if chooser:
                league.now_pick = pick_no
                choice = chooser(st, avail_by_pos, nxt, league, states)
            else:
                forced = None
                if pattern:
                    my_rnd = len(st.roster) + 1
                    if my_rnd <= len(pattern):
                        forced = pattern[my_rnd - 1]
                choice = my_pick(st, avail_by_pos, nxt, league, forced_pos=forced)
            if choice is None:
                continue
            my_log.append((rnd, pick_no, choice))
        elif slot == my_slot:
            if avail_hook:
                avail_hook(my_k, taken)
            my_k += 1
            choice = opponent_pick(st, order, taken, rnd, picks_left, league, rng)
            if choice is None:
                continue
        else:
            choice = opponent_pick(st, order, taken, rnd, picks_left, league, rng)
            if choice is None:
                continue
        taken[choice.idx] = True
        avail_by_pos[choice.pos].remove(choice)
        st.counts[choice.pos] += 1
        st.roster.append(choice)
    return states[my_slot].roster, states, my_log


# ── Team evaluation (vampire objective) ──────────────────────────────────────

def weekly_lineup(roster, week, league):
    """(expected points, variance) of the optimal lineup for one week."""
    base, flex_n, sf_n = league.starters_skill()
    bypos = {}
    for p in sorted(roster, key=lambda q: -q.vpg):
        if p.bye != week:
            bypos.setdefault(p.pos, []).append(p)
    pts, var = KDEF_WEEKLY_PTS, KDEF_WEEKLY_SD ** 2
    for pos in ("QB", "RB", "WR", "TE"):
        for p in (bypos.get(pos) or [])[: base[pos]]:
            pts += p.vpg
            var += p.sd_week ** 2
    flex_pool = [p for pos in ("RB", "WR", "TE") for p in (bypos.get(pos) or [])[base[pos]:]]
    flex_pool.sort(key=lambda q: -q.vpg)
    started = flex_pool[:flex_n]
    sf_pool = flex_pool[flex_n:] + (bypos.get("QB") or [])[base["QB"]:]
    sf_pool.sort(key=lambda q: -q.vpg)
    started += sf_pool[:sf_n]
    for p in started:
        pts += p.vpg
        var += p.sd_week ** 2
    return pts, var


def eval_team(roster, league):
    weekly = [weekly_lineup(roster, w, league) for w in VAMPIRE_WEEKS]
    mean = sum(w[0] for w in weekly) / len(weekly)
    sd = math.sqrt(sum(w[1] for w in weekly) / len(weekly))
    return mean, sd, weekly


def eval_league(states, my_slot, league, rng, draws=25):
    """Our metrics in the context of the actual room we drafted against."""
    evals = {s: eval_team(st.roster, league) for s, st in states.items()}
    my_mean, my_sd, _ = evals[my_slot]
    slots = sorted(evals)
    bottom3, n = 0, 0
    for wi in range(len(VAMPIRE_WEEKS)):
        mus = [evals[s][2][wi] for s in slots]
        for _ in range(draws):
            scores = [(rng.gauss(mu, math.sqrt(var)), s) for (mu, var), s in zip(mus, slots)]
            scores.sort()
            rank = next(i for i, (_, s) in enumerate(scores) if s == my_slot)
            if rank < 3:
                bottom3 += 1
            n += 1
    roster = states[my_slot].roster
    if roster:
        best = max(roster, key=lambda p: p.val)
        steal_mean = eval_team([p for p in roster if p is not best], league)[0]
    else:
        steal_mean = 0.0
    return {"mean": my_mean, "sd": my_sd, "p_bottom3": bottom3 / max(1, n), "steal_mean": steal_mean}


def composite(m):
    return 0.6 * m["mean"] + 0.4 * m["steal_mean"] - 30.0 * m["p_bottom3"]


# ── Data loading ─────────────────────────────────────────────────────────────

def fetch_json(url, cache_name):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    with urllib.request.urlopen(url, timeout=20) as r:
        data = json.load(r)
    with open(path, "w") as f:
        json.dump(data, f)
    return data


def load_byes(season):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"byes_{season}.json")
    if os.path.exists(path):
        with open(path) as f:
            return {k: int(v) for k, v in json.load(f).items()}
    with urllib.request.urlopen(NFLDATA_GAMES_URL, timeout=60) as r:
        text = r.read().decode()
    weeks_by_team = {}
    for row in csv.DictReader(io.StringIO(text)):
        if row["season"] != str(season) or row["game_type"] != "REG":
            continue
        for t in (row["home_team"], row["away_team"]):
            t = NFLVERSE_TO_SEED.get(t, t)
            weeks_by_team.setdefault(t, set()).add(int(row["week"]))
    byes = {}
    for t, wks in weeks_by_team.items():
        missing = [w for w in range(1, 19) if w not in wks]
        if len(missing) == 1:
            byes[t] = missing[0]
    with open(path, "w") as f:
        json.dump(byes, f)
    return byes


PATTERNS = {
    "free": None,
    "rb-rb-rb": ["RB", "RB", "RB"],
    "rb-rb-wr": ["RB", "RB", "WR"],
    "rb-wr-rb": ["RB", "WR", "RB"],
    "rb-wr-wr": ["RB", "WR", "WR"],
    "wr-rb-rb": ["WR", "RB", "RB"],
    "wr-rb-wr": ["WR", "RB", "WR"],
    "wr-wr-rb": ["WR", "WR", "RB"],
    "wr-wr-wr": ["WR", "WR", "WR"],
    "rb-wr-te": ["RB", "WR", "TE"],
    "wr-rb-te": ["WR", "RB", "TE"],
    "rb-te-wr": ["RB", "TE", "WR"],
    "wr-te-rb": ["WR", "TE", "RB"],
    "rb-wr-qb": ["RB", "WR", "QB"],
    "wr-rb-qb": ["WR", "RB", "QB"],
}


def render_md(sheet):
    """Markdown cheat sheet from a --out JSON: per-pick targets with
    availability %, pick rate, value, and last-call flags."""
    lg = sheet["league"]
    players = {p["pid"]: p for p in sheet["players"]}
    picks = lg["picks"]
    n_skill = len(picks) - (lg["lineup"].get("K", 0) + lg["lineup"].get("DEF", 0))
    chosen = sheet.get("chosen", {})
    lines = [f"# {lg['name']} — draft cheat sheet (slot {lg['slot']})",
             f"_{sheet['params']['sims']} simulated drafts · picks {picks}_", ""]
    for k, pick_no in enumerate(picks):
        rnd = k + 1
        if k >= n_skill:
            lines.append(f"## R{rnd} · pick {pick_no} — K / DEF")
            lines.append("Stream by early-season schedule; any top-12 unit is fine.\n")
            continue
        avail = sheet["avail"][k]
        ch = chosen.get(str(rnd), {})
        cands = [(players[pid], pr) for pid, pr in avail.items() if pid in players]
        # Rank by VOR (cross-position comparable), keep anyone we actually draft
        # here even if they rarely survive this long.
        cands = [c for c in cands if c[1] >= 0.20 or ch.get(c[0]["pid"], 0.0) >= 0.05]
        cands.sort(key=lambda c: (-c[0]["vor"],))
        cands = cands[:10]
        nxt = sheet["avail"][k + 1] if k + 1 < n_skill else {}
        mix = {}
        for pid, rate in ch.items():
            if pid in players:
                mix[players[pid]["pos"]] = mix.get(players[pid]["pos"], 0.0) + rate
        mixtxt = " / ".join(f"{pos} {round(100 * r)}%" for pos, r in
                            sorted(mix.items(), key=lambda t: -t[1])) or "—"
        lines.append(f"## R{rnd} · pick {pick_no}  (agent mix: {mixtxt})")
        lines.append("| player | pos | bye | ADP | value | VOR | avail | drafted by us | note |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for p, pr in cands:
            rate = ch.get(p["pid"], 0.0)
            p_next = nxt.get(p["pid"], 0.0)
            note = ""
            if pr >= 0.45 and p_next < 0.35:
                note = "last call"
            if rate >= 0.15:
                note = ("TARGET " + note).strip()
            lines.append(
                f"| {p['name']} | {p['pos']} | {p['bye'] or '—'} | {p['adp'] or '—'} "
                f"| {p['val']} | {p['vor']:+} | {round(100 * pr)}% | {round(100 * rate)}% | {note} |")
        lines.append("")
    m = sheet["metrics"]
    lines.append(f"_Agent result across sims: {m['mean']:.1f} pts/wk · after-steal "
                 f"{m['steal_mean']:.1f} · P(bottom-3 week) {m['p_bottom3']:.2f}_")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="Mock-draft Monte Carlo + cheat sheet")
    ap.add_argument("--league", default="", help="Sleeper league id")
    ap.add_argument("--render", default="", help="render an existing --out JSON to markdown and exit")
    ap.add_argument("--md", default="", help="markdown output path (with --render)")
    ap.add_argument("--slot", type=int, default=0, help="draft slot (default: auto from --user)")
    ap.add_argument("--user", default="", help="Sleeper user id (to find the slot)")
    ap.add_argument("--sims", type=int, default=1000)
    ap.add_argument("--compare", action="store_true", help="compare early-round position patterns")
    ap.add_argument("--pattern", default="", help="force an early-round pattern (see PATTERNS)")
    ap.add_argument("--strategy", default="smart",
                    choices=["smart", "app", "app2", "app3", "app4", "app5"],
                    help="our seat's agent: smart=my_pick; app=webapp advisory replica (as shipped); "
                         "app2=replica+budget guards; app3=ported decision core; "
                         "app4=two-ply across positions; "
                         "app5=app3 + the two-ply reach guard (overrides --pattern)")
    ap.add_argument("--proj", default="", help="analyst projections JSON: use it as the "
                    "value/VOR baseline instead of the seed's own projections")
    ap.add_argument("--proj-analyst", default="consensus",
                    help="which analyst in --proj to use (default: consensus of all)")
    ap.add_argument("--tc-weight", type=float, default=0.5, help="TC-model blend weight vs Sleeper baseline")
    ap.add_argument("--floor-kappa", type=float, default=0.08, help="weekly-floor tilt (0 = pure expectation)")
    ap.add_argument("--rng-seed", type=int, default=42)
    ap.add_argument("--seed-file", default=SEED_PATH)
    ap.add_argument("--out", default="", help="write cheat-sheet JSON here")
    args = ap.parse_args()

    if args.render:
        with open(args.render) as f:
            md = render_md(json.load(f))
        if args.md:
            with open(args.md, "w") as f:
                f.write(md)
            print(f"wrote {args.md}")
        else:
            print(md)
        return
    if not args.league:
        ap.error("--league is required (or use --render)")

    lg_json = fetch_json(SLEEPER_LEAGUE_URL.format(args.league), f"league_{args.league}.json")
    drafts = fetch_json(SLEEPER_LG_DRAFTS_URL.format(args.league), f"drafts_{args.league}.json")
    draft_json = drafts[0] if drafts else {}
    league = League(lg_json, draft_json)
    slot = args.slot or (draft_json.get("draft_order") or {}).get(args.user, 0)
    if not slot:
        print("No draft slot: pass --slot or --user")
        sys.exit(1)

    with open(args.seed_file) as f:
        seed = json.load(f)
    byes = load_byes(seed.get("season"))
    pro = load_pro_projections(args.proj, args.proj_analyst) if args.proj else None
    fmt = market_format(league)
    pool = build_board(seed, league, byes, args.tc_weight, args.floor_kappa, pro=pro)

    my_picks = my_pick_numbers(slot, league)
    print(f"league={league.name} teams={league.teams} rounds={league.rounds} "
          f"reversal={league.reversal} slot={slot} market={fmt}\npicks={my_picks}")
    print(f"pool={len(pool)}; top5 by value: {[p.name for p in sorted(pool, key=lambda q: -q.val)[:5]]}")
    if pro:
        covered = sum(1 for p in pool if p.src == "pro")
        top100 = sorted(pool, key=lambda q: q.adp_eff)[:100]
        print(f"projections: {args.proj_analyst} from {os.path.basename(args.proj)} — "
              f"{covered}/{len(pool)} of the board ({sum(1 for p in top100 if p.src == 'pro')}/100 "
              f"of the first 100 off it); the rest are seed values rescaled to match.")

    rng = random.Random(args.rng_seed)

    if args.compare:
        results = {}
        for name, pat in PATTERNS.items():
            agg = {"mean": 0.0, "sd": 0.0, "p_bottom3": 0.0, "steal_mean": 0.0}
            for _ in range(args.sims):
                _roster, states, _log = run_draft(pool, league, slot, rng, pattern=pat)
                m = eval_league(states, slot, league, rng, draws=15)
                for k in agg:
                    agg[k] += m[k]
            for k in agg:
                agg[k] /= args.sims
            agg["obj"] = composite(agg)
            results[name] = agg
            print(f"{name:10s} mean={agg['mean']:7.2f} steal={agg['steal_mean']:7.2f} "
                  f"pB3={agg['p_bottom3']:.3f} obj={agg['obj']:7.2f}", flush=True)
        best = max(results, key=lambda k: results[k]["obj"])
        print(f"\nBest pattern: {best}")
        if args.out:
            with open(args.out, "w") as f:
                json.dump(results, f, indent=1)
        return

    pattern = PATTERNS.get(args.pattern) if args.pattern else None
    chooser = {
        "smart": None,
        "app": lambda st, av, nxt, lg, sts: app_pick(st, av, nxt, lg, sts, guards=False),
        "app2": lambda st, av, nxt, lg, sts: app_pick(st, av, nxt, lg, sts, guards=True),
        "app3": app_pick_v3,
        "app4": app_pick_v4,
        "app5": app_pick_v5,
    }[args.strategy]
    n_my = len(my_picks)
    avail_count = [[0] * len(pool) for _ in range(n_my)]
    seen = [0] * n_my
    chosen_count = {}

    def hook(k, taken):
        seen[k] += 1
        row = avail_count[k]
        for i, t in enumerate(taken):
            if not t:
                row[i] += 1

    agg = {"mean": 0.0, "sd": 0.0, "p_bottom3": 0.0, "steal_mean": 0.0}
    for s in range(args.sims):
        _roster, states, my_log = run_draft(pool, league, slot, rng, pattern=pattern,
                                            chooser=chooser)
        m = eval_league(states, slot, league, rng, draws=8)
        for k in agg:
            agg[k] += m[k]
        for my_rnd, (rnd, pick_no, choice) in enumerate(my_log, start=1):
            chosen_count[(my_rnd, choice.pid)] = chosen_count.get((my_rnd, choice.pid), 0) + 1
        if (s + 1) % 1000 == 0:
            print(f"  behavior sim {s + 1}/{args.sims}", flush=True)
    # Neutral-market availability: every seat (ours included) drafts like the
    # market, so P(available at pick N) answers "would he be there if I waited"
    # without our own strategy hiding players from the count.
    for s in range(args.sims):
        run_draft(pool, league, slot, rng, avail_hook=hook, market_only=True)
        if (s + 1) % 1000 == 0:
            print(f"  market sim {s + 1}/{args.sims}", flush=True)
    for k in agg:
        agg[k] /= args.sims
    agg["obj"] = composite(agg)
    print(f"\nagent: mean={agg['mean']:.2f} steal={agg['steal_mean']:.2f} "
          f"pB3={agg['p_bottom3']:.3f} obj={agg['obj']:.2f}")

    if args.out:
        players = [{
            "pid": p.pid, "name": p.name, "pos": p.pos, "team": p.team, "bye": p.bye,
            "adp": None if p.adp >= 999 else p.adp, "val": round(p.val, 1),
            "vor": round(p.vor, 1), "vpg": round(p.vpg, 2), "sd_week": round(p.sd_week, 2),
            "ecr": p.ecr, "tier": p.tier, "tc_mult": round(p.tc_mult, 3), "idx": p.idx,
            "src": p.src, "risk": p.risk, "upside": p.upside,
            "spread": round(p.spread, 3) if p.spread is not None else None,
        } for p in pool]
        avail = [
            {str(pool[i].pid): round(avail_count[k][i] / max(1, seen[k]), 4)
             for i in range(len(pool)) if avail_count[k][i] / max(1, seen[k]) >= 0.02 and pool[i].adp_eff < 220}
            for k in range(n_my)
        ]
        chosen = {}
        for (my_rnd, pid), c in chosen_count.items():
            chosen.setdefault(str(my_rnd), {})[pid] = round(c / args.sims, 4)
        with open(args.out, "w") as f:
            json.dump({
                "league": {"name": league.name, "teams": league.teams, "rounds": league.rounds,
                           "reversal": league.reversal, "slot": slot, "picks": my_picks,
                           "lineup": league.lineup, "bench": league.bench},
                "params": {"sims": args.sims, "tc_weight": args.tc_weight,
                           "floor_kappa": args.floor_kappa, "pattern": args.pattern or "free",
                           "strategy": args.strategy,
                           "proj": os.path.basename(args.proj) if args.proj else None,
                           "proj_analyst": args.proj_analyst if args.proj else None},
                "metrics": agg, "players": players, "avail": avail, "chosen": chosen,
            }, f)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
