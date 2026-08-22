#!/usr/bin/env python3
"""
refresh_cfb_seed.py — rebuild only the college-profile block of an existing seed.

WHY THIS EXISTS
    Same reason as refresh_ol_seed.py: build_seed.py rebuilds everything, and the college
    profiles are one self-contained block (src/cfb/) that reads nothing from the rest of the
    build except the list of projected players. Re-running it alone takes a few minutes and
    touches nothing else — which is what you want when a draft class lands or the linker
    changes, and also what a phone can finish.

WHAT IT DOES
    1. Reads the projected player pool from the seed (every player on a team's projection
       list) and the raw Sleeper player DB from cache/players.json (downloaded if absent).
    2. Runs src.cfb.profiles.build_all — the rookie class plus every projected veteran
       drafted since 2015, bucketed by rookie year.
    3. Writes the inline block back into seeds/triplecrown_seed.json (+ .gz) and the per-game
       logs into seeds/triplecrown_seed.cfb_logs.json (+ .gz), exactly as build_seed.py does.

Usage:
    python tools/refresh_cfb_seed.py                 # seeds/triplecrown_seed.json
    python tools/refresh_cfb_seed.py --refresh       # ignore cached links / tables
    python tools/refresh_cfb_seed.py --dry-run       # build + report, write nothing
"""
import argparse
import gzip
import json
import os
import sys
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
os.chdir(REPO)

PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"


def _write(path, obj):
    blob = json.dumps(obj, separators=(",", ":")).encode()
    with open(path, "wb") as f:
        f.write(blob)
    with open(path + ".gz", "wb") as f:
        f.write(gzip.compress(blob, compresslevel=9, mtime=0))
    return len(blob)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", default=os.path.join(REPO, "seeds", "triplecrown_seed.json"))
    ap.add_argument("--refresh", action="store_true", help="re-link and re-read play-by-play")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    try:
        import src.cfb.profiles as profiles
    except Exception as e:
        print(f"error: needs pandas + pyarrow ({type(e).__name__}: {e})", file=sys.stderr)
        return 2
    if not profiles.cfbfastr.HAVE_PANDAS:
        print("error: pandas not installed (pip install -r requirements.txt)", file=sys.stderr)
        return 2

    with open(a.seed) as f:
        seed = json.load(f)
    season = int(seed.get("season") or (seed.get("state") or {}).get("season") or 0)
    if not season:
        print("error: seed carries no season", file=sys.stderr)
        return 1
    pool = {str(p.get("player_id")) for team in (seed.get("seed") or {}).values()
            for rows in team.values() for p in rows if p.get("player_id")}
    print(f"  season {season}, {len(pool)} projected players")

    players_path = os.path.join(REPO, "cache", "players.json")
    if not os.path.exists(players_path):
        os.makedirs(os.path.dirname(players_path), exist_ok=True)
        print("  → downloading Sleeper player DB …", end="", flush=True)
        urllib.request.urlretrieve(PLAYERS_URL, players_path)
        print(" ok")
    with open(players_path) as f:
        players = json.load(f)

    blk = profiles.build_all(season, players, only_pids=pool, refresh=a.refresh)
    inline, logs = profiles.split_for_seed(blk)
    classes = blk.get("classes") or {}
    print(f"\n  {len(inline['players'])} college profiles across {len(classes)} draft classes:")
    for cls in sorted(classes, reverse=True):
        c = classes[cls]
        print(f"    {cls}: {c['profiles']}/{c['pool']}")

    if a.dry_run:
        print("\n  dry run — nothing written")
        return 0
    seed["cfb"] = inline
    n = _write(a.seed, seed)
    print(f"\nwrote {os.path.relpath(a.seed, REPO)} ({n:,} bytes) + .gz")
    if logs:
        m = _write(os.path.join(REPO, "seeds", "triplecrown_seed.cfb_logs.json"), logs)
        print(f"wrote seeds/triplecrown_seed.cfb_logs.json ({m:,} bytes) + .gz")
    print("note: index_baked.html embeds its own copy; re-run bake_seed.py to refresh it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
