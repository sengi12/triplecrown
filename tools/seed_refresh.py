#!/usr/bin/env python3
"""Refresh only the parts of the seed that are actually stale, then refuse to ship a bad one.

WHY THIS EXISTS
    build_seed.py rebuilds everything, and its refresh flags are coarse (--refresh,
    --refresh-web, --refresh-nflverse). Running it unattended on a schedule would re-scrape a
    dozen sources daily to pick up the one that changed — rude to those sites, slow, and far
    more likely to trip a rate limit or a bot filter.

    It would also be DANGEROUS, which is the real reason for this script. Several build steps
    degrade to an empty result when a scrape fails: build_ecr() prints a warning and returns
    {} if FantasyPros blocks the request. A human running the build sees that warning. A cron
    job does not — it would quietly commit a seed with no rankings in it, overwriting good
    data with nothing.

HOW IT WORKS
    Two ideas, neither of which requires changing build_seed.py:

    1. SELECTIVE CACHE INVALIDATION. Every fetcher in build_seed.py follows the pattern
       `if not refresh and os.path.exists(cache_path): use cache`. A cache MISS therefore
       forces a fetch regardless of any flag. So to refresh exactly one source, delete exactly
       that source's cache entries and run a plain build. Nothing else touches the network.

    2. VALIDATE BEFORE COMMIT. The previous seed is kept, the new one is compared against it,
       and anything that looks like data loss aborts the run and restores the old seed. The
       default posture is "keep yesterday's good data", never "ship today's empty data".

FRESHNESS
    nflverse publishes a timestamp.json per release, so its cadence is READ, not guessed —
    which matters because its sections update on different schedules. Everything else uses a
    simple interval, because those sources publish no freshness signal.

USAGE
    python tools/seed_refresh.py --check            # what's stale? (no network writes, no build)
    python tools/seed_refresh.py                    # refresh what's due, validate, write
    python tools/seed_refresh.py --force ecr,ktc    # refresh these regardless of schedule
    python tools/seed_refresh.py --dry-run          # decide + report, but don't build
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache")
SEEDS = os.path.join(ROOT, "seeds")
SEED_MAIN = os.path.join(SEEDS, "triplecrown_seed.json")
STATE_PATH = os.path.join(SEEDS, "refresh-state.json")

DAY = 86400

SIDECAR_INSEASON = os.path.join(SEEDS, "triplecrown_seed.inseason.json")


def _seed_state():
    """The committed seed's NFL-state block: {season, season_type, week} (best-effort)."""
    try:
        with open(SEED_MAIN) as f:
            j = json.load(f)
        st = j.get("state") or {}
        y = int(st.get("season") or j.get("season") or 0)
        if 2000 <= y <= 2100:
            return {"season": y, "season_type": str(st.get("season_type") or "off"),
                    "week": int(st.get("week") or 0)}
    except Exception:
        pass
    t = time.gmtime()
    return {"season": t.tm_year - 1 if t.tm_mon < 3 else t.tm_year,
            "season_type": "off", "week": 0}


_SEED_STATE = _seed_state()
_CUR_SEASON = _SEED_STATE["season"]

# ── Source manifest ───────────────────────────────────────────────────────────
# `paths`    cache entries to delete (relative to cache/), globs allowed
# `every`    minimum seconds between refreshes; None = never on a schedule
# `why`      shown in the report so a run explains itself
#
# Cadences are set to how often the SOURCE actually changes, not how often we'd like fresh
# data. Scraping a monthly page daily gets you the same bytes and a worse reputation.
SOURCES = {
    "sleeper": {
        "paths": ["players.json", "proj_*.json", "stats_*.json", "weekly"],
        "every": 1 * DAY,
        "why": "Sleeper players/projections/stats — ADP and rosters move daily",
    },
    "ecr": {
        "paths": ["fantasypros"],
        "every": 7 * DAY,
        "why": "FantasyPros ECR — experts re-rank weekly in season",
    },
    "dynasty": {
        "paths": ["dynasty"],
        "every": 30 * DAY,
        "why": "FantasyPros dynasty trade chart — republished monthly",
    },
    "ktc": {
        "paths": ["ktc"],
        "every": 30 * DAY,
        "why": "KeepTradeCut player id map — only changes as players enter the league",
    },
    "contracts": {
        "paths": ["contracts"],
        "every": 14 * DAY,
        "why": "OverTheCap contracts — signings land year-round, heaviest in March",
    },
    # The HISTORICAL block: five completed seasons of advanced metrics, OL grades, coaching
    # charting. Completed seasons do not change, so this only needs to move in the OFFSEASON,
    # when the season that just ended gets folded in (nflverse finishes publishing pbp
    # participation / FTN / snap counts for it through February). During the season nflverse
    # republishes pbp, rosters and snap counts nightly; timestamp-driven staleness would wipe
    # and rebuild all five seasons nearly every day (a full ~1 GB re-download under the job
    # timeout) for data that is not changing. The CURRENT season lives in the `inseason`
    # sidecar below, which is what updates weekly while games are being played.
    "nflverse": {
        "paths": ["nflverse"],
        "every": None,          # driven by upstream timestamps, see nflverse_stale()
        "offseason_only": True, # completed seasons only move between the Super Bowl and kickoff
        "why": "nflverse advanced metrics — rebuilt only when a release actually changes, offseason only",
    },
    "sharp": {
        "paths": ["sharp"],
        "every": 30 * DAY,
        "why": "Warren Sharp splits + strength of schedule — season-stable",
    },
    "coordinators": {
        "paths": ["coordinators"],
        "every": 30 * DAY,
        "why": "Wikipedia coordinators/head coaches — changes in hiring season",
    },
    # College prospect profiles for the incoming rookie class (src/cfb/).
    #
    # This was 180 days on the assumption that a rebuild was expensive — the underlying
    # cfbfastR parquets are ~110-130 MB per season. Measured, that assumption is wrong: the
    # build's cache key is a hash of the linked athlete ids, so an unchanged rookie set is a
    # plain JSON read. A no-op refresh takes 0.02s and touches no parquet at all.
    #
    # With the cost gone, the argument for a long interval goes with it, and a real argument
    # against it appears: a fixed interval anchors to whenever it last ran, not to the draft.
    # Land a 180-day tick in January and the next one is July — after most dynasty rookie
    # drafts. A rookie with no college profile during rookie-draft season is exactly the
    # failure this feature exists to prevent. The class is not fixed on draft night either;
    # Sleeper keeps adding UDFAs and camp signings through the summer, and each one changes
    # the id set and so needs a rebuild to get a profile.
    #
    # 90 days is ~4 runs a year and guarantees a rebuild within three months of the draft
    # whatever the phase. The honest trigger would be "the rookie id set changed" rather than
    # elapsed time — the cache key already encodes precisely that — but this scheduler has no
    # event triggers, and at 0.02s a wasted tick costs nothing worth engineering around.
    # Since the veteran extension (profiles.build_all) the block is one bucket per rookie
    # year, each cached on its own id set — a roster move only rebuilds the class it touches.
    "cfb": {
        "paths": ["cfb"],
        "every": 90 * DAY,
        "why": "cfbfastR college production — rookie set keeps growing through the summer",
    },
    # Offseason roster movement, derived from nflverse rosters/draft/trades. This used to be
    # Spotrac, which could never be scheduled: it answers 403 to datacenter IPs, and a blocked
    # fetch would have emptied the tab. nflverse has no bot protection, so it now runs here
    # like everything else. Weekly is generous — the draft and trade feeds move in bursts, and
    # rosters churn all season.
    "roster_moves": {
        "paths": ["nflverse_moves"],
        "every": None,          # upstream-driven, like nflverse
        "upstream": ["rosters", "draft_picks", "trades"],
        "why": "nflverse rosters/draft/trades — rebuilt only when one of those feeds moves",
    },
    # The current-season weekly sidecar (seeds/triplecrown_seed.inseason.json). A FIXED
    # weekly interval on purpose, not upstream timestamps: nflverse pbp moves nightly during
    # the season, and timestamp-driven staleness would recreate exactly the daily-commit/
    # daily-deploy churn this separate sidecar exists to avoid. One Pages deploy a week.
    # Invalidates only the CURRENT season's pbp/roster raw files, so no other season re-fetches.
    "inseason": {
        "paths": [f"nflverse/raw/pbp/pbp_{_CUR_SEASON}.csv.gz",
                  f"nflverse/raw/aux/*_roster_{_CUR_SEASON}.csv",
                  "nflverse/raw/aux/*_games.csv"],
        "every": 7 * DAY,
        "in_season_only": True,     # dormant in the offseason — nothing is moving
        "why": "current-season nflverse weekly sidecar — weekly during the season",
    },
}

# nflverse releases this project actually reads. Each exposes a timestamp.json, so we compare
# the published timestamp to what we saw last time rather than assuming a cadence.
NFLVERSE_RELEASES = [
    "pbp", "pbp_participation", "pfr_advstats", "nextgen_stats",
    "ftn_charting", "players", "rosters", "weekly_rosters", "snap_counts",
]
NFLVERSE_TS = "https://github.com/nflverse/nflverse-data/releases/download/{tag}/timestamp.json"

# ── Seed guards ───────────────────────────────────────────────────────────────
# A rebuilt seed is compared against the previous one before it is allowed to stand.
# `min_ratio` is how much of the previous entry count must survive; anything less is treated
# as a failed scrape rather than as real change. These are intentionally loose enough to
# allow genuine movement (players retire, charts get trimmed) and tight enough to catch a
# source returning nothing.
GUARDS = {
    # The college block is optional and fail-soft in build_seed.py; guarding it as never_empty
    # would turn a missing pandas into a rejected build.
    "cfb":            {"min_ratio": 0.70, "never_empty": False},
    "ecr":            {"min_ratio": 0.80, "never_empty": True},
    "contracts":      {"min_ratio": 0.80, "never_empty": True},
    "dynasty_values": {"min_ratio": 0.70, "never_empty": True},
    "ktc":            {"min_ratio": 0.80, "never_empty": True},
    "sharp":          {"min_ratio": 0.70, "never_empty": True},
    "seed":           {"min_ratio": 0.90, "never_empty": True},
    "history":        {"min_ratio": 0.90, "never_empty": True},
    "nflverse":       {"min_ratio": 0.80, "never_empty": True},
    "coordinators":   {"min_ratio": 0.70, "never_empty": True},
    # `additions` only empties when an nflverse roster csv fails to download (build_additions
    # returns {} on any fetch error) — it does NOT fold into history — so it is guarded.
    "additions":      {"min_ratio": 0.50, "never_empty": True},
    "sos":            {"min_ratio": 0.80, "never_empty": True},
    "hc_history":     {"min_ratio": 0.80, "never_empty": True},
}

# Blocks that are dicts of per-source sub-tables, each fetched by its own request. The total
# can stay above its floor while one sub-table silently comes back empty (one FantasyPros
# format rate-limited, one Sharp page blocked, one OverTheCap position page refused): check
# every sub-key that existed before against its own previous size.
SUBKEY_GUARDS = {
    "ecr":   0.80,   # one entry per ranking format
    "sharp": 0.70,   # one entry per Sharp table
}


def log(msg=""):
    print(msg, flush=True)


def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {"sources": {}, "nflverse": {}}


def save_state(state):
    os.makedirs(SEEDS, exist_ok=True)
    state["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")


def fetch_text(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "TripleCrown-seed-refresh"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def nflverse_stale(state, tags=None, bucket="nflverse"):
    """Ask each nflverse release when it was last published; stale if any moved.

    Returns (is_stale, latest_timestamps, notes). A release we cannot reach is NOT treated as
    stale — an outage should not trigger a full rebuild against half-missing data.

    `tags` selects which releases to watch and `bucket` which slot in the state file records
    them, so two sources can watch overlapping sets without clobbering each other's history.
    """
    seen = state.get(bucket, {})
    latest, changed, notes = {}, [], []
    for tag in (tags or NFLVERSE_RELEASES):
        try:
            ts = json.loads(fetch_text(NFLVERSE_TS.format(tag=tag)))["last_updated"]
        except Exception as e:
            notes.append(f"{tag}: unreachable ({type(e).__name__}) — treated as unchanged")
            if tag in seen:
                latest[tag] = seen[tag]
            continue
        latest[tag] = ts
        if seen.get(tag) != ts:
            changed.append(f"{tag} → {ts}")
    return bool(changed), latest, notes + [f"changed: {c}" for c in changed]


def due(name, spec, state, now):
    """Is this source due for a refresh?  → (bool, reason)"""
    if spec["every"] is None and name != "nflverse":
        return False, "manual-only"
    last = state.get("sources", {}).get(name, {}).get("last", 0)
    age = now - last
    if last == 0:
        return True, "never refreshed"
    if spec["every"] is not None and age >= spec["every"]:
        return True, f"{age / DAY:.1f}d old (limit {spec['every'] / DAY:.0f}d)"
    return False, f"fresh ({age / DAY:.1f}d of {spec['every'] / DAY:.0f}d)" if spec["every"] else "manual-only"


def invalidate(spec):
    """Delete this source's cache entries so the next build re-fetches exactly them."""
    removed = []
    for pat in spec["paths"]:
        for p in glob.glob(os.path.join(CACHE, pat)):
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            else:
                try:
                    os.remove(p)
                except OSError:
                    continue
            removed.append(os.path.relpath(p, CACHE))
    return removed


def block_size(node):
    """A comparable 'how much is in here' number for a seed block."""
    if isinstance(node, dict):
        return sum(block_size(v) for v in node.values()) if node else 0
    if isinstance(node, list):
        return len(node)
    return 1


def measure(seed):
    return {k: block_size(v) for k, v in seed.items()}


def validate(old, new):
    """Compare a rebuilt seed against the previous one. → (ok, problems, warnings)"""
    problems, warnings = [], []
    if not isinstance(new, dict) or not new:
        return False, ["new seed is empty or not an object"], []

    before, after = measure(old) if old else {}, measure(new)

    for key, guard in GUARDS.items():
        was, now = before.get(key, 0), after.get(key, 0)
        if guard["never_empty"] and was > 0 and now == 0:
            problems.append(f"{key}: {was} → 0 (block emptied — almost certainly a failed fetch)")
            continue
        if was > 0 and now < was * guard["min_ratio"]:
            problems.append(
                f"{key}: {was} → {now} "
                f"({100 * now / was:.0f}% of previous, floor is {100 * guard['min_ratio']:.0f}%)"
            )
        elif was > 0 and now < was:
            warnings.append(f"{key}: {was} → {now} (down {100 * (1 - now / was):.1f}%, within tolerance)")

    # Sub-table guards (see SUBKEY_GUARDS): a format / table that existed before must still
    # be there at most modestly smaller.
    for key, ratio in SUBKEY_GUARDS.items():
        ob, nb = (old or {}).get(key), (new or {}).get(key)
        if not isinstance(ob, dict) or not isinstance(nb, dict):
            continue
        for sub, oval in ob.items():
            was = block_size(oval)
            if was <= 0:
                continue
            now = block_size(nb.get(sub))
            if now == 0:
                problems.append(f"{key}.{sub}: {was} → 0 (that source came back empty)")
            elif now < was * ratio:
                problems.append(f"{key}.{sub}: {was} → {now} ({100 * now / was:.0f}% of previous, floor {100 * ratio:.0f}%)")

    # Contracts are fetched one OverTheCap page per position, and a page that gets
    # rate-limited silently drops that whole position. A total count cannot see it (QB+TE+
    # defenders still add up), so every position the previous seed had must still be there.
    try:
        have_old = {v.get("pos") for v in ((old or {}).get("contracts") or {}).values()}
        have_new = {v.get("pos") for v in ((new or {}).get("contracts") or {}).values()}
        need = sorted(p for p in have_old if p and p not in have_new)
        if need:
            problems.append(f"contracts: no {', '.join(need)} entries any more (an OverTheCap page failed)")
    except Exception:
        pass

    # Any block that had content and is now present-but-empty is a failed fetch, guarded or not.
    for key, was in before.items():
        if was > 0 and key in after and after[key] == 0 and key not in GUARDS:
            problems.append(f"{key}: {was} → 0 (block emptied)")

    # A block that existed before and vanished entirely is always a problem, guarded or not.
    for key in before:
        if key not in after and before[key] > 0:
            problems.append(f"{key}: block disappeared from the seed")

    return not problems, problems, warnings


def check_inseason_sidecar(old_side):
    """Sidecar-only guard. The additions-style policy (near-empty at week 1 is fine) is
    implicit — growth and first appearance always pass. Two hard rules: for the SAME season
    the weeks list must never shrink (a shrunk list = a failed pbp read), and the file may
    not vanish mid-season. → (ok, note)."""
    try:
        with open(SIDECAR_INSEASON) as f:
            new_side = json.load(f)
    except Exception:
        new_side = None
    if old_side is None:
        return True, None                       # nothing to regress against
    if new_side is None:
        if _SEED_STATE["season_type"] in ("regular", "post"):
            return False, "in-season sidecar vanished mid-season"
        return True, None                       # offseason retirement is correct
    if int(new_side.get("season") or 0) == int(old_side.get("season") or -1):
        ow, nw = len(old_side.get("weeks") or []), len(new_side.get("weeks") or [])
        if nw < ow:
            return False, f"weeks list shrank {ow} → {nw} for the same season (failed pbp read)"
    return True, None


def run_build(extra_args):
    cmd = [sys.executable, "build_seed.py"] + extra_args
    log(f"  $ {' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=ROOT)
    return r.returncode == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="report what is stale and exit")
    ap.add_argument("--dry-run", action="store_true", help="decide and invalidate nothing; no build")
    ap.add_argument("--force", default="", help="comma-separated sources to refresh regardless of schedule")
    ap.add_argument("--build-args", default="", help="extra args passed through to build_seed.py")
    args = ap.parse_args()

    state = load_state()
    now = time.time()
    forced = {s.strip() for s in args.force.split(",") if s.strip()}
    unknown = forced - set(SOURCES)
    if unknown:
        log(f"unknown source(s): {', '.join(sorted(unknown))}")
        log(f"known: {', '.join(sorted(SOURCES))}")
        return 2

    log("TripleCrown seed refresh\n")

    # ── Decide ────────────────────────────────────────────────────────────────
    stale, reasons = [], {}
    nfl_latest, nfl_notes = None, []
    upstream_latest, upstream_notes = {}, []
    for name, spec in SOURCES.items():
        if name in forced:
            stale.append(name)
            reasons[name] = "forced"
            continue
        if spec.get("in_season_only") and _SEED_STATE["season_type"] not in ("regular", "post"):
            reasons[name] = "offseason — dormant"
            continue
        if spec.get("offseason_only") and _SEED_STATE["season_type"] in ("regular", "post"):
            reasons[name] = "in season — completed seasons are frozen (the inseason sidecar carries the live one)"
            continue
        if spec.get("upstream") or name == "nflverse":
            bucket = "nflverse" if name == "nflverse" else f"upstream_{name}"
            is_stale, latest, notes = nflverse_stale(state, spec.get("upstream"), bucket)
            upstream_latest[bucket] = latest
            upstream_notes.extend(f"{name}: {n}" for n in notes)
            if name == "nflverse":
                nfl_latest, nfl_notes = latest, notes
            if is_stale:
                stale.append(name)
                reasons[name] = "upstream release changed"
                # The trades feed is the one that has been visibly behind: until it catches
                # up, build_additions backfills the missing deals from the frozen Spotrac
                # baseline. Say so loudly when it finally moves, because that is the signal
                # that the baseline can be retired.
                if any("trades" in n for n in notes):
                    upstream_notes.append(
                        "  ** the nflverse TRADES feed moved — re-derived roster moves may now "
                        "cover deals that were being backfilled from the Spotrac baseline **")
            else:
                reasons[name] = "no upstream release changed"
            continue
        ok, why = due(name, spec, state, now)
        reasons[name] = why
        if ok:
            stale.append(name)

    width = max(len(n) for n in SOURCES)
    for name in SOURCES:
        mark = "REFRESH" if name in stale else "  skip "
        log(f"  [{mark}] {name.ljust(width)}  {reasons[name]}")
    for n in upstream_notes:
        log(f"            {n}")

    if not stale:
        log("\nNothing is stale. No build needed.")
        for bucket, latest in upstream_latest.items():
            if latest:
                state[bucket] = latest
        if upstream_latest and not args.check and not args.dry_run:
            save_state(state)
        return 0

    log(f"\n{len(stale)} source(s) to refresh: {', '.join(stale)}")
    if args.check or args.dry_run:
        log("(--check/--dry-run: stopping before any change)")
        return 0

    # ── Preserve the current seed so a bad build can be undone ────────────────
    backup = SEED_MAIN + ".prev"
    old_seed = None
    if os.path.exists(SEED_MAIN):
        shutil.copy2(SEED_MAIN, backup)
        try:
            with open(SEED_MAIN) as f:
                old_seed = json.load(f)
        except Exception:
            old_seed = None
    # The in-season sidecar gets its own backup so a bad build can roll back JUST that file.
    side_backups = [(SIDECAR_INSEASON, SIDECAR_INSEASON + ".prev"),
                    (SIDECAR_INSEASON + ".gz", SIDECAR_INSEASON + ".gz.prev")]
    old_sidecar = None
    if os.path.exists(SIDECAR_INSEASON):
        try:
            with open(SIDECAR_INSEASON) as f:
                old_sidecar = json.load(f)
        except Exception:
            old_sidecar = None
    for src_p, dst_p in side_backups:
        if os.path.exists(src_p):
            shutil.copy2(src_p, dst_p)

    # ── Invalidate exactly what is stale ──────────────────────────────────────
    log("\nInvalidating cache entries:")
    for name in stale:
        removed = invalidate(SOURCES[name])
        log(f"  {name}: {len(removed)} entr{'y' if len(removed) == 1 else 'ies'} cleared")

    # ── Build ─────────────────────────────────────────────────────────────────
    # No refresh flags: every fetcher re-downloads on a cache MISS, so the deletions above are
    # precisely the refresh instruction. Anything still cached is left alone.
    log("\nBuilding seed:")
    extra = args.build_args.split() if args.build_args else []
    if not run_build(extra):
        log("\nBUILD ITSELF FAILED — restoring the previous seed.")
        if os.path.exists(backup):
            shutil.move(backup, SEED_MAIN)
        for src_p, dst_p in side_backups:
            if os.path.exists(dst_p):
                shutil.move(dst_p, src_p)
        return 1

    # ── Validate ──────────────────────────────────────────────────────────────
    log("\nValidating the rebuilt seed against the previous one:")
    try:
        with open(SEED_MAIN) as f:
            new_seed = json.load(f)
    except Exception as e:
        log(f"  new seed will not parse ({e}) — restoring previous.")
        if os.path.exists(backup):
            shutil.move(backup, SEED_MAIN)
        for src_p, dst_p in side_backups:
            if os.path.exists(dst_p):
                shutil.move(dst_p, src_p)
        return 1

    ok, problems, warnings = validate(old_seed, new_seed)
    for w in warnings:
        log(f"  note: {w}")
    if not ok:
        for p in problems:
            log(f"  REJECTED: {p}")
        log("\nThe rebuilt seed looks like it lost data — this is what a blocked or failed")
        log("scrape looks like. Restoring the previous seed and leaving the cache cleared so")
        log("the next run retries. Nothing has been committed.")
        if os.path.exists(backup):
            shutil.move(backup, SEED_MAIN)
        for src_p, dst_p in side_backups:
            if os.path.exists(dst_p):
                shutil.move(dst_p, src_p)
        return 1

    log("  all guards passed")
    if os.path.exists(backup):
        os.remove(backup)

    # ── Sidecar guard (rolls back only the in-season file, never the whole run) ──
    ok_side, side_note = check_inseason_sidecar(old_sidecar)
    if not ok_side:
        log(f"  SIDECAR REJECTED: {side_note} — restoring the previous in-season sidecar only")
        for src_p, dst_p in side_backups:
            if os.path.exists(dst_p):
                shutil.move(dst_p, src_p)
    else:
        for _, dst_p in side_backups:
            if os.path.exists(dst_p):
                os.remove(dst_p)

    # ── Record ────────────────────────────────────────────────────────────────
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for name in stale:
        state.setdefault("sources", {})[name] = {"last": int(now), "at": stamp}
    for bucket, latest in upstream_latest.items():
        if latest:
            state[bucket] = latest
    save_state(state)

    log(f"\nRefreshed: {', '.join(stale)}")
    log(f"State written to {os.path.relpath(STATE_PATH, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
