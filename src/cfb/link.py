#!/usr/bin/env python3
"""
link.py — Sleeper player id → CFBD college athlete id
─────────────────────────────────────────────────────
The bridge every college-data feature depends on. cfbfastR/CFBD keys everything by a numeric
`athlete_id`; the app keys everything by a Sleeper player id. Nothing joins them directly:

  • Sleeper's `espn_id` is populated for 0% of rookies (measured on the 2026 class), so the
    ESPN athlete id the player card resolves at runtime doesn't exist at build time.
  • nflverse `draft_picks` carries `cfb_player_id`, but that's a Sports Reference slug
    ("cameron-ward-1"), not CFBD's numeric id — the two id spaces never meet.

Resolution runs in tiers, most trustworthy first:

    espn_id ............ nflverse's roster carries its own espn_id, and CFBD's athlete_id is
                         the same number. Exact, but only ~37% populated for a rookie class.
    name ............... normalized full name, unique in the CFBD roster union.
    name+college ....... several same-name players, one at the right school.
    name-variant ....... same surname, compatible first name (Matt/Matthew, Ty/Tyler).
    surname+college .... same surname and school, first names unrelated (Tank/Nathaniel Dell).

Two guards run under all of them: side-of-ball (a same-named lineman is never our receiver)
and recency (someone who last played five years ago is not this year's rookie).

MEASURED, 2026-08
    2026 rookie class (300 active skill players):  291 resolved (97.0%), 9 unmatched.
    2018-2025 draft classes (636 players):         633 resolved (99.5%).
    Every unmatched player is D2/D3/NAIA/Ivy that CFBD does not roster — not a matching failure.

    PRECISION, against independent ground truth: on the 117 players of the 2026 class where
    nflverse publishes an espn_id AND name matching also produced a link, the two agreed on
    117 of 117 (100%). That is the number worth trusting — coverage says how many we found,
    this says how many we got right.

A link whose method ends in "?" resolved on name alone while the colleges disagreed. It is
returned rather than dropped, but callers that put college stats on a player card should
require a method without the "?". Note that a "?" is not proof of a bad match: Tyren
Montgomery flagged because Sleeper lists his college as John Carroll while he is CFBD's
Nicholls player, and the espn_id tier later confirmed the match was right and Sleeper wrong.

Resolved maps are cached to cache/cfb/links/link_<class>.json. Anything that never resolves
goes in src/cfb/link_overrides.json (checked in, hand-editable) — the intended escape hatch for
the tail, not a bug.

Usage:
    python -m src.cfb.link              # link the current rookie class, print a report
    python -m src.cfb.link 2025         # a different class
"""
import hashlib
import json
import os
import re
import sys
import unicodedata

try:
    import pandas as pd
    HAVE_PANDAS = True
except Exception:
    pd = None
    HAVE_PANDAS = False

CACHE_DIR = "cache"
ROSTER_URL = ("https://github.com/sportsdataverse/cfbfastR-data/raw/main/"
              "rosters/parquet/cfb_rosters_{season}.parquet")
# nflverse's draft table is how historical rookie classes are enumerated — see draft_pool().
# WARNING: its gsis_id is provisional for the CURRENT class. Measured 2026-08: 0 of 230 draft
# picks' gsis_ids appear in roster_2026, against 253 of 256 for the 2025 class. Fine as a
# unique key (which is all this module uses it for), useless for joining to a live roster.
DRAFT_PICKS_URL = ("https://github.com/nflverse/nflverse-data/releases/download/"
                   "draft_picks/draft_picks.parquet")
# nflverse rosters carry their own espn_id, maintained independently of Sleeper's. It is the
# ESPN athlete id, and CFBD's athlete_id is the SAME number — verified on 117 players of the
# 2026 class with 100% agreement — so it is both a free exact bridge and a way to audit the
# name matcher against something other than itself.
NFLVERSE_ROSTER_CSV = ("https://github.com/nflverse/nflverse-data/releases/download/"
                       "rosters/roster_{season}.csv")

# How many prior college seasons to scan. Five covers a redshirt-senior's full career, so a
# rookie who last played in 2021 still resolves.
LOOKBACK_SEASONS = 5
# A real prospect played recently. Requiring a roster appearance within two seasons of the
# draft class is what stops a 2021-only namesake from stealing a 2026 rookie's link.
MAX_SEASONS_STALE = 2

SKILL_POSITIONS = ("QB", "RB", "WR", "TE")
# CFBD positions that can back a Sleeper skill player. Deliberately the whole offensive-skill
# side rather than an exact position map: college-to-NFL conversion within these four is
# routine (Ty Pezza is a Brown WR and a Sleeper TE), while a lineman or defender who happens to
# share a name never is. Keeping the guard at side-of-ball granularity is what still filters the
# 118 unrelated Bells without discarding real matches.
_POS_SKILL = {"QB", "RB", "FB", "HB", "TB", "WR", "TE", "ATH", "SB"}

_ROSTER_INDEX = {}
_ESPN_INDEX = {}

# Short forms that share no prefix with the formal name, so the prefix rule in
# _first_name_compatible can't catch them. Sleeper prefers the short form ("Jimmy Bell"),
# CFBD prefers what's on the roster sheet ("James Bell").
_NICKNAMES = {
    "jimmy": "james", "jim": "james", "jamie": "james",
    "mike": "michael", "mikey": "michael",
    "bill": "william", "billy": "william", "will": "william",
    "bob": "robert", "bobby": "robert", "rob": "robert", "robbie": "robert",
    "jack": "john", "johnny": "john",
    "tony": "anthony",
    "drew": "andrew", "andy": "andrew",
    "dick": "richard", "rick": "richard", "ricky": "richard",
    "dave": "david", "davey": "david",
    "steve": "steven", "stevie": "steven",
    "joe": "joseph", "joey": "joseph",
    "chuck": "charles", "charlie": "charles",
    "hank": "henry",
    "ted": "edward", "eddie": "edward",
    "frank": "franklin",
    "gus": "augustus",
    "buddy": "",     # pure nicknames with no formal root — fall through to the college check
    "deuce": "", "boogie": "", "moose": "", "chip": "",
}


def _cache_subdir(*parts):
    d = os.path.join(CACHE_DIR, "cfb", *parts)
    os.makedirs(d, exist_ok=True)
    return d


def _md5_cache_path(url):
    """Stable local path for a remote asset, keyed by URL md5 (mirrors nflverse.py)."""
    digest = hashlib.md5(url.encode("utf-8")).hexdigest()
    base = os.path.basename(url.split("?", 1)[0]) or "asset.parquet"
    return os.path.join(_cache_subdir("raw"), f"{digest}_{base}")


def _cache_remote(url, label=None):
    """Download a remote asset once, then always reuse the cached file."""
    path = _md5_cache_path(url)
    if not os.path.exists(path):
        import urllib.request
        print(f"  → downloading {label or os.path.basename(url)} …", end="", flush=True)
        try:
            urllib.request.urlretrieve(url, path)
        except Exception:
            # github.com/<org>/<repo>/raw/<ref>/ is a redirect to raw.githubusercontent.com;
            # some proxies refuse the redirect but pass the destination. Try it directly
            # before giving up — same bytes, same cache path.
            m = re.match(r"https://github\.com/([^/]+)/([^/]+)/raw/([^/]+)/(.+)$", url)
            if not m:
                print(" unavailable")
                raise
            alt = f"https://raw.githubusercontent.com/{m.group(1)}/{m.group(2)}/{m.group(3)}/{m.group(4)}"
            try:
                urllib.request.urlretrieve(alt, path)
            except Exception:
                print(" unavailable")
                raise
        print(" ok")
    return path


def norm_name(s):
    """Normalize a player name for matching.

    Deliberately more aggressive than build_seed._norm_name: CFBD splits first/last and carries
    accents and inconsistent suffixes, so we strip to letters only. That collapses "T.J." and
    "TJ", "Amon-Ra" and "Amon Ra", "Peña" and "Pena".
    """
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"[^a-z]", "", s)


# School names that no amount of normalization reconciles, because the two sources use
# genuinely different words. Keys are the form produced by norm_college's tokenizer (letters
# only, "St."/"St" already expanded to "state") BEFORE the final state→st contraction.
# Everything else is handled by the prefix rule in _college_matches, so this stays short.
_COLLEGE_ALIASES = {
    "tennesseemartin": "utmartin",
    "mississippi": "olemiss",
    "southernmississippi": "southernmiss",
    "pitt": "pittsburgh",
    "centralflorida": "ucf",
    "southerncalifornia": "usc",
    "texaschristian": "tcu",
    "brighamyoung": "byu",
    "louisianastate": "lsu",
    "miamiflorida": "miami",
    "northcarolinastate": "ncstate",
    "floridainternational": "fiu",
    "louisianalafayette": "louisiana",
    "louisianamonroe": "ulmonroe",
    # nflverse/PFR spellings, which abbreviate differently from CFBD.
    "lamonroe": "ulmonroe",
    "alabirmingham": "uab",
    "massachusetts": "umass",
    "semissouristate": "southeastmissouristate",
    "nevadalasvegas": "unlv",
    "texasel": "utep",
    "texassanantonio": "utsa",
    "miamiohio": "miamioh",
    "bowlinggreenstate": "bowlinggreen",
}

# Tokens that carry no identifying information once split off a school name.
_COLLEGE_NOISE = {"university", "univ", "u", "college", "the", "of", "at"}


def norm_college(s):
    """Normalize a school name for comparison.

    Tokenizes on whitespace/punctuation first, so an abbreviated "St." can be expanded to
    "state" — norm_name() strips spaces, which makes that distinction unrecoverable afterwards.
    Without this, nflverse's "North Carolina St." and CFBD's "NC State" never meet.

    Alias substitution then happens BEFORE the state→st contraction, or every alias key
    containing "state" would be unreachable.
    """
    txt = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    toks = [t for t in re.split(r"[^a-z]+", txt) if t]
    out = []
    for t in toks:
        if t in _COLLEGE_NOISE:
            continue
        out.append("state" if t == "st" else t)
    base = "".join(out)
    base = _COLLEGE_ALIASES.get(base, base)
    return base.replace("state", "st")


def _college_matches(sleeper_college, cfbd_teams):
    """True when a Sleeper college string plausibly names one of these CFBD teams.

    Prefix agreement on six characters is enough in practice ("texasam" vs "texasamaggies",
    "miamioh" vs "miamiohio") and avoids maintaining a full alias table.
    """
    c = norm_college(sleeper_college)
    if not c:
        return False
    for t in cfbd_teams:
        n = norm_college(t)
        if not n:
            continue
        if c == n or c.startswith(n[:6]) or n.startswith(c[:6]):
            return True
    return False


def _first_name_compatible(a, b):
    """True when two first names plausibly name the same person.

    Covers the two ways Sleeper and CFBD disagree: truncation (Matt/Matthew, Ty/Tyler,
    Cam/Cameron) and substitution (Jimmy/James). A pure nickname with no formal root maps to
    "" here and returns False, deferring that player to the college check or the overrides file.
    """
    if not a or not b:
        return False
    if a == b:
        return True
    a, b = _NICKNAMES.get(a, a), _NICKNAMES.get(b, b)
    if not a or not b:
        return False
    if a == b:
        return True
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= 2 and long.startswith(short)


def espn_id_index(season):
    """{normalized name: ESPN athlete id} from the nflverse roster for one NFL season.

    Coverage is partial — 37% of the 2026 rookie class — so this supplements name matching
    rather than replacing it. Where it is present it is exact, which makes it the highest
    confidence tier available and the only independent check on everything below it.
    """
    season = int(season)
    if season in _ESPN_INDEX:
        return _ESPN_INDEX[season]
    if not HAVE_PANDAS:
        return {}
    try:
        path = _cache_remote(NFLVERSE_ROSTER_CSV.format(season=season), f"nflverse roster {season}")
        df = pd.read_csv(path, low_memory=False, usecols=["full_name", "espn_id"])
    except Exception:
        _ESPN_INDEX[season] = {}
        return {}
    out = {}
    for name, eid in zip(df["full_name"], df["espn_id"]):
        if pd.notna(eid) and name:
            out[norm_name(name)] = str(int(eid))
    _ESPN_INDEX[season] = out
    return out


def _latest_team(entry):
    """The school this athlete last played for — what a card should name as "their" college.

    Transfers are the norm now, so the alphabetically-first team is frequently the wrong answer
    (Kevin Coleman reads as Jackson State when he finished at Missouri).
    """
    by = entry.get("by_season") or {}
    return by[max(by)] if by else (sorted(entry["teams"])[0] if entry["teams"] else None)


def roster_index(seasons):
    """Name indices over the CFBD season rosters.

    Returns {"full": {normalized full name: {athlete_id: entry}},
             "last": {normalized last name: {athlete_id: entry}}}
    where entry = {teams, seasons, positions, firsts, by_season}. The `last` index backs the
    name-variant fallback — within one last name the candidate set is small enough to
    disambiguate on first name, position and college.
    """
    key = tuple(sorted(seasons))
    if key in _ROSTER_INDEX:
        return _ROSTER_INDEX[key]
    if not HAVE_PANDAS:
        raise RuntimeError("linking college athletes requires pandas (pip install -r requirements.txt)")
    full, last_idx = {}, {}
    for season in key:
        try:
            path = _cache_remote(ROSTER_URL.format(season=season), f"cfb roster {season}")
        except Exception:
            continue    # a season the data repo hasn't published yet is not fatal
        df = pd.read_parquet(path, columns=["athlete_id", "first_name", "last_name",
                                            "team", "position", "season"])
        for aid, first, last, team, pos in zip(df["athlete_id"], df["first_name"],
                                               df["last_name"], df["team"], df["position"]):
            if aid is None:
                continue
            nf, nl = norm_name(first), norm_name(last)
            if not nl:
                continue
            for idx, k in ((full, nf + nl), (last_idx, nl)):
                if not k:
                    continue
                entry = idx.setdefault(k, {}).setdefault(str(aid), {
                    "teams": set(), "seasons": set(), "positions": set(), "firsts": set(),
                    "by_season": {}})
                entry["teams"].add(team)
                entry["seasons"].add(int(season))
                entry["by_season"][int(season)] = team
                if pos:
                    entry["positions"].add(str(pos))
                if nf:
                    entry["firsts"].add(nf)
    out = {"full": full, "last": last_idx}
    _ROSTER_INDEX[key] = out
    return out


def _overrides_path():
    return os.path.join(os.path.dirname(__file__), "link_overrides.json")


def load_overrides():
    """Hand-maintained {sleeper_pid: athlete_id | null} for players matching can't resolve.

    A null value means "confirmed to have no CFBD coverage" (D2/D3/NAIA), which suppresses the
    player from the unresolved report without pretending we found them.
    """
    path = _overrides_path()
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        raw = json.load(f)
    return {str(k): v for k, v in raw.get("players", {}).items()}


def _name_parts(player):
    """(full key, normalized first, normalized last) for a record, however it stores the name.

    The full key normalizes the WHOLE name rather than joining a split first and last, because
    splitting on whitespace gets compound surnames and suffixes wrong in exactly the cases that
    matter: "Amon-Ra St. Brown" splits to a surname of "Brown", and "Marvin Harrison Jr." to a
    surname of "Jr.". Normalizing the whole string collapses to letters in order, so it lands on
    the same key as CFBD's first + last for both. The split first/last is still needed, but only
    for the last-name fallback tier.
    """
    full = player.get("full_name")
    first, last = player.get("first_name"), player.get("last_name")
    if not full:
        full = f"{first or ''} {last or ''}"
    if not (first and last):
        # norm_name() maps a bare suffix to "", so filtering on it drops Jr./III/etc.
        toks = [t for t in str(full).split() if norm_name(t)]
        first = first or (toks[0] if toks else "")
        last = last or (toks[-1] if len(toks) > 1 else "")
    return norm_name(full), norm_name(first), norm_name(last)


def _guard(cands, player, draft_class):
    """Drop roster entries that can't be this player, on recency and side of the ball."""
    out = {}
    for aid, e in cands.items():
        if draft_class and max(e["seasons"]) < draft_class - 1 - MAX_SEASONS_STALE:
            continue                                    # last played too long ago to be this rookie
        # Older roster files record an unknown position as "?" (and pandas can surface a null
        # as the string "nan"). Both mean "not stated" — treating them as a real position makes
        # the guard reject every pre-2018 Georgia skill player, Nick Chubb included.
        listed = {p.upper() for p in e["positions"] if p and p.isalpha()}
        if listed and not (listed & _POS_SKILL):
            continue                                    # a same-name lineman, not our receiver
        out[aid] = e
    return out


def _candidates(player, idx, draft_class):
    """Roster entries that could be this player, after the recency and position guards."""
    fullkey, _, _ = _name_parts(player)
    return _guard(idx["full"].get(fullkey) or {}, player, draft_class)


def _variant_candidates(player, idx, draft_class):
    """Fallback pool: same last name, compatible first name, after the same guards.

    This is what catches Matt/Matthew Hibner and Ty/Tyler Pezza — the single largest cause of
    unresolved FBS players, since Sleeper and CFBD disagree on which form of a first name to
    print far more often than they disagree on anything else.
    """
    _, first, last = _name_parts(player)
    pool = _guard(idx["last"].get(last) or {}, player, draft_class)
    return {aid: e for aid, e in pool.items()
            if any(_first_name_compatible(first, f) for f in e["firsts"])}


def link_player(player, idx, draft_class, overrides=None, espn_ids=None):
    """Resolve one Sleeper player record to a CFBD athlete id.

    Returns {athlete_id, college, seasons, method} — or {athlete_id: None, reason} when the
    player can't be resolved. `method` records how confident the match is, so the seed can
    show college data only where the link is trustworthy.
    """
    pid = str(player.get("player_id") or "")
    overrides = overrides or {}
    if pid in overrides:
        aid = overrides[pid]
        if aid is None:
            return {"athlete_id": None, "reason": "no_cfbd_coverage", "method": "override"}
        e = None
        for entries in idx["full"].values():
            if str(aid) in entries:
                e = entries[str(aid)]
                break
        return {"athlete_id": str(aid), "method": "override",
                "college": _latest_team(e) if e else player.get("college"),
                "seasons": sorted(e["seasons"]) if e else [],
                "teams": sorted(e["teams"]) if e else []}

    def _pick(cands, tier, checked_college):
        """Best of a candidate set: the id with the longest career, then the most recent one.

        CFBD sometimes issues a transferring player a fresh athlete_id at the new school, so a
        correct match can look like two candidates that are really one person. Preferring the id
        with the most seasons picks up the fullest career rather than a one-season fragment.

        A unique name match that was never college-checked is where false positives hide — one
        "Tyren Montgomery" in the rosters is not necessarily *our* Tyren Montgomery. When the
        colleges disagree the link is still returned, but flagged `name?` so callers can require
        confidence and the build report can surface it for review.
        """
        aid, e = max(cands.items(), key=lambda kv: (len(kv[1]["seasons"]), max(kv[1]["seasons"])))
        if len(cands) > 1:
            tier += "+multi"
        elif not checked_college and player.get("college") \
                and not _college_matches(player.get("college"), e["teams"]):
            tier += "?"
        return {"athlete_id": aid, "method": tier, "college": _latest_team(e),
                "seasons": sorted(e["seasons"]), "teams": sorted(e["teams"]),
                "also": sorted(a for a in cands if a != aid) or None}

    def _resolve(cands, tier):
        """One candidate → link. Several → narrow by college. Neither → None."""
        if len(cands) == 1:
            return _pick(cands, tier, checked_college=False)
        hits = {aid: e for aid, e in cands.items()
                if _college_matches(player.get("college"), e["teams"])}
        if hits:
            return _pick(hits, tier + "+college", checked_college=True)
        return None

    # Highest-confidence tier: an exact ESPN athlete id from the nflverse roster. Two
    # independent sources agreeing on an id beats any amount of string matching, and it
    # resolves cases the college check would otherwise flag — Tyren Montgomery reads as a
    # Nicholls player because he IS one; Sleeper's "John Carroll" is simply the wrong college.
    eid = (espn_ids or {}).get(_name_parts(player)[0])
    if eid:
        for entries in (idx["full"], idx["last"]):
            for cand in entries.values():
                if eid in cand:
                    e = cand[eid]
                    return {"athlete_id": eid, "method": "espn_id", "college": _latest_team(e),
                            "seasons": sorted(e["seasons"]), "teams": sorted(e["teams"]),
                            "also": None}
        # Known id, but CFBD never rostered them (D2/D3). Return it anyway — downstream finds no
        # production and drops the profile, which is the honest outcome.
        return {"athlete_id": eid, "method": "espn_id", "college": player.get("college"),
                "seasons": [], "teams": [], "also": None}

    cands = _candidates(player, idx, draft_class)
    link = _resolve(cands, "name") if cands else None
    if link:
        return link
    variants = _variant_candidates(player, idx, draft_class)
    link = _resolve(variants, "name-variant") if variants else None
    if link:
        return link

    # Last resort: same surname, same school, right era, skill position. First names diverge
    # for reasons no table can enumerate — Tank Dell is CFBD's Nathaniel Dell, Isiah Pacheco is
    # their Isaiah. Surname plus school is strong enough evidence on its own, and requiring a
    # unique hit keeps a pair of brothers at one school from resolving to each other.
    _, _, last = _name_parts(player)
    by_school = {aid: e for aid, e in _guard(idx["last"].get(last) or {}, player, draft_class).items()
                 if _college_matches(player.get("college"), e["teams"])}
    if len(by_school) == 1:
        return _pick(by_school, "surname+college", checked_college=True)

    pool = cands or variants
    if not pool:
        return {"athlete_id": None, "reason": "no_name_match", "method": None}
    return {"athlete_id": None, "reason": "ambiguous", "method": None,
            "candidates": [{"athlete_id": aid, "teams": sorted(e["teams"]),
                            "seasons": sorted(e["seasons"])} for aid, e in pool.items()]}


def rookie_pool(players, draft_class=None, positions=SKILL_POSITIONS, max_search_rank=None):
    """Active rookie skill players from a Sleeper player DB, as a list of records with player_id."""
    out = []
    for pid, p in players.items():
        if p.get("years_exp") != 0 or not p.get("active"):
            continue
        if positions and p.get("position") not in positions:
            continue
        if max_search_rank is not None and (p.get("search_rank") or 10 ** 9) > max_search_rank:
            continue
        rec = dict(p)
        rec["player_id"] = pid
        out.append(rec)
    return out


# College play-by-play exists from 2014, so the earliest class whose college seasons can be
# read at all is 2015 (one season) and the first with a full four-season window is 2018.
EARLIEST_LINKABLE_CLASS = 2015


def draft_class_of(player, season):
    """The NFL draft class (rookie year) of a Sleeper player record, or None.

    Sleeper stamps `metadata.rookie_year` on some players and `years_exp` on nearly all of
    them. years_exp counts completed NFL seasons, so in the 2026 league year a player with
    years_exp 3 was a 2023 rookie. rookie_year wins where both are present and sane.
    """
    ry = (player.get("metadata") or {}).get("rookie_year") or ""
    if str(ry).isdigit() and 2000 < int(ry) <= int(season):
        return int(ry)
    ye = player.get("years_exp")
    if ye is None or not str(ye).lstrip("-").isdigit():
        return None
    ye = int(ye)
    if ye < 0:
        return None
    return int(season) - ye


def class_pools(players, season, positions=SKILL_POSITIONS, only_pids=None,
                max_search_rank=None, min_class=EARLIEST_LINKABLE_CLASS):
    """{draft_class: [player records]} for every fantasy-relevant skill player, by rookie year.

    The rookie class is what the linker has always handled; this just buckets the rest of the
    player pool the same way so each bucket can be linked against the college rosters of ITS
    years. `only_pids` restricts to the players the seed actually ships (the projection pool),
    so a 2016 practice-squad body does not cost a four-season play-by-play scan.
    """
    out = {}
    for pid, p in players.items():
        if only_pids is not None and str(pid) not in only_pids:
            continue
        if not p.get("active"):
            continue
        if positions and p.get("position") not in positions:
            continue
        if max_search_rank is not None and (p.get("search_rank") or 10 ** 9) > max_search_rank:
            continue
        cls = draft_class_of(p, season)
        if cls is None or cls < min_class:
            continue
        rec = dict(p)
        rec["player_id"] = pid
        out.setdefault(cls, []).append(rec)
    return out


def draft_pool(draft_class, positions=SKILL_POSITIONS):
    """Skill players drafted in one year, from nflverse draft_picks, as linkable records.

    Sleeper's player DB only identifies the CURRENT rookie class (years_exp == 0), so it can't
    reconstruct who was a rookie in 2019. The draft table can, and it keys on gsis_id — the same
    id the rest of the seed already uses for NFL players — so a historical prospect pool links
    straight through to nflverse without a second matching problem.

    Undrafted rookies are missing by construction. For percentile baselines that's acceptable
    and arguably correct: the reference class is "drafted skill players", a population the
    current rookies are actually comparable to.
    """
    if not HAVE_PANDAS:
        raise RuntimeError("historical classes require pandas (pip install -r requirements.txt)")
    path = _cache_remote(DRAFT_PICKS_URL, "nflverse draft picks")
    df = pd.read_parquet(path, columns=["season", "round", "pick", "gsis_id", "pfr_player_name",
                                        "position", "college", "age"])
    df = df[(df["season"] == int(draft_class)) & df["gsis_id"].notna()]
    if positions:
        df = df[df["position"].isin(positions)]
    out = []
    for _, r in df.iterrows():
        out.append({"player_id": r["gsis_id"], "full_name": r["pfr_player_name"],
                    "position": r["position"], "college": r["college"],
                    "draft_round": None if pd.isna(r["round"]) else int(r["round"]),
                    "draft_pick": None if pd.isna(r["pick"]) else int(r["pick"]),
                    "draft_age": None if pd.isna(r["age"]) else float(r["age"])})
    return out


def _link_pool(pool, draft_class, cache_path, refresh=False, espn_seasons=None):
    """Link a list of player records, with the resolved map cached to disk.

    `espn_seasons`: NFL seasons whose nflverse rosters supply espn_ids. The draft-class year is
    always included; a veteran bucket also passes the current season, whose roster names him
    with an id far more often than the one from his rookie year.
    """
    if os.path.exists(cache_path) and not refresh:
        with open(cache_path) as f:
            return json.load(f)
    idx = roster_index(range(draft_class - LOOKBACK_SEASONS, draft_class))
    overrides = load_overrides()
    espn_ids = {}
    for s in sorted({int(draft_class), *(espn_seasons or [])}):
        espn_ids.update(espn_id_index(s))
    out = {}
    for p in pool:
        link = link_player(p, idx, draft_class, overrides, espn_ids)
        link["name"] = p.get("full_name")
        link["pos"] = p.get("position")
        link["sleeper_college"] = p.get("college")
        for k in ("draft_round", "draft_pick", "draft_age"):
            if p.get(k) is not None:
                link[k] = p[k]
        out[str(p["player_id"])] = link
    with open(cache_path, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    return out


def build_draft_link_map(draft_class, positions=SKILL_POSITIONS, refresh=False):
    """{gsis_id: link} for one historical draft class, cached to cache/cfb/links/draft_<year>.json."""
    return _link_pool(draft_pool(draft_class, positions), draft_class,
                      os.path.join(_cache_subdir("links"), f"draft_{draft_class}.json"), refresh)


def build_link_map(players, draft_class, positions=SKILL_POSITIONS, max_search_rank=None,
                   refresh=False):
    """{sleeper_pid: link} for the current rookie class, cached to cache/cfb/links/link_<class>.json."""
    cache_path = os.path.join(_cache_subdir("links"), f"link_{draft_class}.json")
    pool = rookie_pool(players, draft_class, positions, max_search_rank) \
        if (refresh or not os.path.exists(cache_path)) else []
    return _link_pool(pool, draft_class, cache_path, refresh)
    return out


def build_class_link_map(pool, draft_class, season, refresh=False):
    """{sleeper_pid: link} for one rookie-year bucket of the current player pool.

    Cached per class to cache/cfb/links/link_<class>.json — the same file the rookie build
    uses for the current class, so the two never disagree about a player. A bucket whose
    membership grew since the cache was written is re-linked (a cached map that lacks a pid
    in the pool is stale, not authoritative).
    """
    cache_path = os.path.join(_cache_subdir("links"), f"link_{draft_class}.json")
    if not refresh and os.path.exists(cache_path):
        with open(cache_path) as f:
            cached = json.load(f)
        if all(str(p["player_id"]) in cached for p in pool):
            return {str(p["player_id"]): cached[str(p["player_id"])] for p in pool}
        refresh = True
    return _link_pool(pool, draft_class, cache_path, refresh,
                      espn_seasons=[int(season)] if int(season) != int(draft_class) else None)


def report(link_map):
    """Human-readable resolution summary — printed on every build so drift is visible."""
    total = len(link_map)
    by_method = {}
    unresolved = []
    for pid, l in link_map.items():
        if l.get("athlete_id"):
            by_method[l.get("method")] = by_method.get(l.get("method"), 0) + 1
        else:
            by_method[l.get("reason")] = by_method.get(l.get("reason"), 0) + 1
            if l.get("reason") != "no_cfbd_coverage":
                unresolved.append((pid, l))
    # "Resolved" has exactly one definition everywhere: an athlete_id, by a method that isn't
    # the low-confidence "?" variant. Counting method names instead silently under-reports every
    # time a new tier is added.
    resolved = sum(1 for l in link_map.values()
                   if l.get("athlete_id") and not (l.get("method") or "").endswith("?"))
    lines = [f"  college links: {resolved}/{total} resolved "
             f"({round(resolved / total * 100, 1) if total else 0}%)"]
    for k in sorted(by_method):
        lines.append(f"    {k or 'unmatched'}: {by_method[k]}")
    if unresolved:
        lines.append(f"    → add to src/cfb/link_overrides.json ({len(unresolved)}):")
        for pid, l in sorted(unresolved, key=lambda kv: kv[1].get("name") or ""):
            lines.append(f"       {pid:>6}  {l.get('name'):<26} {l.get('pos'):<3} "
                         f"{l.get('sleeper_college') or '?':<24} [{l.get('reason')}]")
    return "\n".join(lines)


def main():
    draft_class = int(sys.argv[1]) if len(sys.argv) > 1 else None
    players_path = os.path.join(CACHE_DIR, "players.json")
    if not os.path.exists(players_path):
        print(f"{players_path} not found — run build_seed.py first to populate the Sleeper cache.")
        return 1
    with open(players_path) as f:
        players = json.load(f)
    if draft_class is None:
        # Sleeper stamps metadata.rookie_year on current rookies; fall back to the newest year
        # seen. Both `metadata` and `rookie_year` are frequently null, and rookie_year is "0"
        # for players Sleeper hasn't classified, so every read here has to be defensive.
        years = []
        for p in players.values():
            if p.get("years_exp") != 0:
                continue
            ry = (p.get("metadata") or {}).get("rookie_year") or ""
            if str(ry).isdigit() and int(ry) > 2000:
                years.append(int(ry))
        draft_class = max(years) if years else 0
    print(f"linking the {draft_class} rookie class to CFBD athlete ids "
          f"(rosters {draft_class - LOOKBACK_SEASONS}–{draft_class - 1})")
    link_map = build_link_map(players, draft_class, refresh=True)
    print(report(link_map))
    return 0


if __name__ == "__main__":
    sys.exit(main())
