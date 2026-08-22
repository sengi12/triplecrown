#!/usr/bin/env python3
"""
profiles.py — the seed block: one college profile per fantasy-relevant rookie
────────────────────────────────────────────────────────────────────────────
Assembles what the player card actually renders. Each rookie — and, via build_all(), every
fantasy-relevant veteran drafted since 2015 — gets their college seasons, a per-game log, and
— the part that makes the numbers mean anything — a percentile for each headline metric
against the 2018-2025 drafted prospects at the same position.

    src/cfb/link.py         Sleeper pid  → CFBD athlete id
    src/cfb/cfbfastr.py     athlete id   → per-season production
    src/cfb/percentiles.py  production   → rank within the position's prospect class
    profiles.py (here)      all of it    → one JSON block for the seed

CONFIDENCE IS PART OF THE PAYLOAD. A link whose method ends in "?" matched on name while the
colleges disagreed, and a profile built on one would show another player's career. Those are
dropped here rather than shipped with a caveat, because a card has nowhere good to put "this
might be a different person".

Usage:
    python -m src.cfb.profiles            # build for the current class, print a sample
"""
import json
import os
import sys

from src.cfb import cfbfastr, link, percentiles

SCHEMA = "cfb_profiles_v1"

# Metrics surfaced as percentile bars on the card, in display order. A deliberately short list —
# seven bars is readable, fifteen is a spreadsheet.
HEADLINE = {
    "QB": ["epa_play", "succ", "ypa", "comp_pct", "sack_pct", "pass_td", "rush_yds"],
    "RB": ["dominator", "epa_play", "succ", "ypc", "expl_rate", "rush_share", "tgt_share"],
    "WR": ["dominator", "tgt_share", "yptpa", "epa_play", "succ", "ypr", "expl_rate"],
    "TE": ["dominator", "tgt_share", "yptpa", "epa_play", "succ", "ypr", "expl_rate"],
}

# Human labels, so the card doesn't have to carry a second copy of this mapping.
LABELS = {
    "epa_play": "EPA/play", "succ": "Success rate", "ypa": "Yards/attempt",
    "comp_pct": "Completion %", "sack_pct": "Sack rate", "pass_td": "Passing TDs",
    "rush_yds": "Rushing yards", "ypc": "Yards/carry", "expl_rate": "Explosive rate",
    "stuff_rate": "Stuff rate", "rush_share": "Rush share", "tgt_share": "Target share",
    "dominator": "Dominator", "yptpa": "Yds/team pass att", "ypr": "Yards/reception",
    "scrim_share": "Scrimmage yds share",
}


def _profiles_from_links(links, draft_class, ref, refresh=False):
    """{pid: profile} for one rookie-year bucket, from its resolved link map."""
    usable = {pid: l for pid, l in links.items()
              if l.get("athlete_id") and not (l.get("method") or "").endswith("?")}
    if not usable:
        return {}
    # College play-by-play starts in 2014; a 2015-2017 draftee gets the seasons that exist.
    seasons = range(max(cfbfastr.FIRST_PBP_SEASON, draft_class - 4), draft_class)
    data = cfbfastr.build(usable, seasons, refresh=refresh)
    out = {}
    for pid, node in data.items():
        pos = node.get("pos")
        if pos not in HEADLINE:
            continue
        year, final = percentiles.final_season(node)
        if not final:
            continue
        pct = {}
        for metric in HEADLINE[pos]:
            v = percentiles.rank(ref, pos, metric, final.get(metric))
            if v is not None:
                pct[metric] = v
        out[pid] = {
            "name": node.get("name"), "pos": pos, "athlete_id": node.get("athlete_id"),
            "method": node.get("method"), "college": final.get("team"),
            "conf": final.get("conf"), "final": year, "seasons": node["seasons"],
            "pct": pct, "class": int(draft_class),
            # Whether the pool this player was ranked against is thin enough to caveat.
            "ref_n": ((ref.get("pos") or {}).get(pos, {}).get(HEADLINE[pos][0], {}) or {}).get("n"),
        }
    return out


def _block(draft_class, ref):
    return {"schema": SCHEMA, "class": int(draft_class),
            "reference": {"classes": ref.get("classes"), "steps": ref.get("steps")},
            "labels": LABELS, "headline": HEADLINE, "players": {}}


def build(draft_class, players, ref=None, refresh=False):
    """The seed block for one rookie class (the original, rookies-only build)."""
    ref = ref or percentiles.build_reference(percentiles.reference_classes(draft_class))
    links = link.build_link_map(players, draft_class, refresh=refresh)
    out = _block(draft_class, ref)
    out["players"] = _profiles_from_links(links, draft_class, ref, refresh=refresh)
    return out


def build_all(season, players, only_pids=None, ref=None, refresh=False, verbose=True):
    """College profiles for EVERY fantasy-relevant skill player, not only the rookie class.

    The rookie class is linked exactly as before. Every other player in `only_pids` (the
    projection pool the seed ships) is bucketed by rookie year and linked against the college
    rosters of his own years, then scored through the same production tables. One reference
    pool — the drafted prospects of the classes before the current one — ranks everybody, so
    a 2022 receiver's dominator percentile means the same thing as a 2026 rookie's. (A player
    drafted 2018-2025 is therefore ranked against a pool that contains him; with 600+ players
    per pool that moves nothing.)

    Players drafted before 2015 have no readable college play-by-play and are skipped; the
    card degrades to the ESPN game log for them, as it always has.
    """
    season = int(season)
    ref = ref or percentiles.build_reference(percentiles.reference_classes(season))
    out = _block(season, ref)
    out["classes"] = {}
    pools = link.class_pools(players, season, only_pids=only_pids)
    # The rookie class keeps its own, unrestricted pool: a rookie has nothing else to show.
    rookies = link.build_link_map(players, season, refresh=refresh)
    rookie_prof = _profiles_from_links(rookies, season, ref, refresh=refresh)
    out["players"].update(rookie_prof)
    out["classes"][str(season)] = {"pool": len(rookies), "profiles": len(rookie_prof)}
    for cls in sorted(pools, reverse=True):
        if cls == season:
            continue
        pool = pools[cls]
        if verbose:
            print(f"  class {cls}: {len(pool)} players", flush=True)
        links = link.build_class_link_map(pool, cls, season, refresh=refresh)
        prof = _profiles_from_links(links, cls, ref, refresh=refresh)
        for pid, p in prof.items():
            out["players"].setdefault(pid, p)
        out["classes"][str(cls)] = {"pool": len(pool), "profiles": len(prof)}
    return out


def split_for_seed(blk):
    """Split a profile block into (inline, logs) for the seed and its lazy sidecar.

    Per-game logs are ~60% of the payload and are only read when someone opens one rookie's
    card, so they follow the pattern def_weekly and coaching_scheme already use: the small part
    rides in the main seed, the bulk becomes a sidecar the app fetches on demand. Measured on
    the 2026 class: 219 KB gzipped together, 82 KB inline + 137 KB sidecar apart.
    """
    inline = {k: v for k, v in blk.items() if k != "players"}
    inline["players"] = {}
    logs = {}
    for pid, p in blk.get("players", {}).items():
        seasons = {}
        for year, block in (p.get("seasons") or {}).items():
            trimmed = {k: v for k, v in block.items() if k != "log"}
            seasons[year] = trimmed
            if block.get("log"):
                logs.setdefault(pid, {})[year] = block["log"]
        slim = dict(p)
        slim["seasons"] = seasons
        inline["players"][pid] = slim
    return inline, logs


def main():
    draft_class = int(sys.argv[1]) if len(sys.argv) > 1 else percentiles.reference_classes().stop
    with open(os.path.join(link.CACHE_DIR, "players.json")) as f:
        players = json.load(f)
    blk = build(draft_class, players)
    path = os.path.join(link._cache_subdir("derived", "profiles"), f"profiles_{draft_class}.json")
    with open(path, "w") as f:
        json.dump(blk, f, sort_keys=True)
    n = len(blk["players"])
    print(f"\n  {n} rookie profiles → {path} ({os.path.getsize(path)/1024:.0f} KB)")

    rank_of = {pid: (players.get(pid, {}).get("search_rank") or 10 ** 9) for pid in blk["players"]}
    top = sorted(blk["players"].items(), key=lambda kv: rank_of[kv[0]])[:12]
    print(f"\n  top fantasy-relevant rookies, percentiles vs {blk['reference']['classes']} prospects:")
    for pid, p in top:
        bars = "  ".join(f"{LABELS.get(m, m)} {p['pct'][m]:.0f}" for m in HEADLINE[p["pos"]]
                         if m in p["pct"])
        print(f"    {p['name']:<22} {p['pos']} {p['college']:<18} ({p['final']})")
        print(f"        {bars}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
