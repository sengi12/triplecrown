#!/usr/bin/env python3
"""Seed refresh scheduling + the guards that stop a bad seed being published.

The guards matter more than the scheduling. Several build_seed.py steps degrade to an empty
result when a scrape is blocked — build_ecr() prints a warning and returns {} if FantasyPros
refuses the request. A person running the build sees that warning; a cron job does not. Without
these guards an automated run would commit a seed with no rankings, silently replacing good
data with nothing.

So the bulk of what follows constructs seeds that LOOK like a failed scrape and asserts the
validator rejects them.
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import seed_refresh as SR  # noqa: E402

PASS = FAILED = 0


def chk(cond, label):
    global PASS, FAILED
    if cond:
        PASS += 1
        print("  PASS:", label)
    else:
        FAILED += 1
        print("  MISS:", label)


def seed(**blocks):
    """A seed-shaped dict. Each block is a dict of N synthetic entries."""
    return {k: {f"p{i}": {"x": 1} for i in range(n)} for k, n in blocks.items()}


print("=== TEST 1: the exact breakage this exists to prevent ===")
# build_ecr() returns {} when FantasyPros blocks the request. That must never ship.
old = seed(ecr=400, seed=1200, history=900, contracts=1600)
new = seed(ecr=0, seed=1200, history=900, contracts=1600)
ok, problems, _ = SR.validate(old, new)
chk(not ok, "a seed whose ECR block emptied is REJECTED")
chk(any("ecr" in p and "0" in p for p in problems), "the rejection names the ecr block")

new2 = seed(seed=1200, history=900, contracts=1600)   # block absent entirely
ok2, problems2, _ = SR.validate(old, new2)
chk(not ok2, "a seed that lost the ECR block entirely is REJECTED")
chk(any("disappeared" in p for p in problems2), "the rejection says the block disappeared")

print("\n=== TEST 2: partial scrapes that return less data ===")
# A source returning half its rows is the more insidious case — no error, just less data.
half = seed(ecr=200, seed=1200, history=900, contracts=1600)
ok, problems, _ = SR.validate(old, half)
chk(not ok, "ECR at 50% of previous is REJECTED (floor is 80%)")
chk(any("50%" in p for p in problems), "the rejection reports the actual percentage")

contracts_gone = seed(ecr=400, seed=1200, history=900, contracts=100)
ok, _, _ = SR.validate(old, contracts_gone)
chk(not ok, "contracts collapsing from 1600 to 100 is REJECTED")

core_loss = seed(ecr=400, seed=600, history=900, contracts=1600)
ok, _, _ = SR.validate(old, core_loss)
chk(not ok, "the core seed block halving is REJECTED (tightest guard, 90%)")

print("\n=== TEST 3: legitimate change is allowed through ===")
same = seed(ecr=400, seed=1200, history=900, contracts=1600)
ok, problems, _ = SR.validate(old, same)
chk(ok, "an unchanged seed passes")

grown = seed(ecr=460, seed=1250, history=980, contracts=1700)
ok, _, _ = SR.validate(old, grown)
chk(ok, "a seed that grew passes")

drift = seed(ecr=380, seed=1180, history=880, contracts=1550)
ok, _, warnings = SR.validate(old, drift)
chk(ok, "small real-world shrinkage (players retiring) passes")
chk(len(warnings) > 0, "…but is reported as a note, so drift stays visible")

print("\n=== TEST 4: a brand-new block is not treated as loss ===")
fresh = seed(ecr=400, seed=1200, history=900, contracts=1600, ktc=500)
ok, _, _ = SR.validate(old, fresh)
chk(ok, "adding a block nobody had before is fine")

ok, _, _ = SR.validate({}, seed(ecr=400, seed=1200))
chk(ok, "a first-ever build (no previous seed) is not blocked")

print("\n=== TEST 5: additions emptying is rejected ===")
# build_additions returns {} ONLY when an nflverse roster csv failed to download — the block
# never folds into history — so a 32 → 0 drop is a broken build, not the end of an offseason.
old_add = seed(ecr=400, seed=1200, additions=32)
new_add = seed(ecr=400, seed=1200, additions=0)
ok, problems, _ = SR.validate(old_add, new_add)
chk(not ok and any('additions' in p for p in problems), "additions going to zero is rejected (roster csv download error)")
# And a sub-table disappearing inside a healthy-looking total is caught too.
old_sub = seed(ecr=400, seed=1200); old_sub["ecr"] = {"ppr": {str(i): {"x": 1} for i in range(200)}, "half_ppr": {str(i): {"x": 1} for i in range(200)}}
new_sub = seed(ecr=400, seed=1200); new_sub["ecr"] = {"ppr": {str(i): {"x": 1} for i in range(400)}, "half_ppr": {}}
ok, problems, _ = SR.validate(old_sub, new_sub)
chk(not ok and any('ecr.half_ppr' in p for p in problems), "one ECR format emptying is rejected even when the total grew")

print("\n=== TEST 6: a broken build is never accepted ===")
ok, _, _ = SR.validate(old, {})
chk(not ok, "an empty seed is rejected")
ok, _, _ = SR.validate(old, None)
chk(not ok, "a null seed is rejected")
ok, _, _ = SR.validate(old, "not a seed")
chk(not ok, "a non-object seed is rejected")

print("\n=== TEST 7: scheduling ===")
now = time.time()
st = {"sources": {}}
isdue, why = SR.due("sleeper", SR.SOURCES["sleeper"], st, now)
chk(isdue and "never" in why, "a source never refreshed is due")

st = {"sources": {"sleeper": {"last": now - 2 * SR.DAY}}}
isdue, _ = SR.due("sleeper", SR.SOURCES["sleeper"], st, now)
chk(isdue, "sleeper is due after 2 days (daily cadence)")

st = {"sources": {"sleeper": {"last": now - 3600}}}
isdue, why = SR.due("sleeper", SR.SOURCES["sleeper"], st, now)
chk(not isdue, "sleeper an hour old is not due")
chk("fresh" in why, "…and says why")

st = {"sources": {"ecr": {"last": now - 3 * SR.DAY}}}
isdue, _ = SR.due("ecr", SR.SOURCES["ecr"], st, now)
chk(not isdue, "ECR is not re-scraped after 3 days (weekly cadence)")
st = {"sources": {"ecr": {"last": now - 8 * SR.DAY}}}
isdue, _ = SR.due("ecr", SR.SOURCES["ecr"], st, now)
chk(isdue, "ECR is due after 8 days")

st = {"sources": {"dynasty": {"last": now - 20 * SR.DAY}}}
isdue, _ = SR.due("dynasty", SR.SOURCES["dynasty"], st, now)
chk(not isdue, "the monthly dynasty chart is not scraped at 20 days")

print("\n=== TEST 8: roster movement is scheduled, now that Spotrac is gone ===")
# Spotrac could never be scheduled (403 from datacenter IPs). nflverse can, which is the
# whole point of the swap — offseason moves now refresh unattended like everything else.
chk("spotrac" not in SR.SOURCES, "Spotrac is no longer a source at all")
chk("roster_moves" in SR.SOURCES, "roster movement is sourced from nflverse")
# Driven by upstream timestamps, not a clock: the draft and trade feeds move in bursts, so a
# fixed interval would either re-scrape for nothing or sit stale for days after a real update.
spec = SR.SOURCES["roster_moves"]
chk(spec["every"] is None, "roster movement has no fixed interval")
chk(spec.get("upstream") == ["rosters", "draft_picks", "trades"],
    "it watches exactly the three feeds build_additions reads")
chk("trades" in spec["upstream"],
    "including the trades feed — the one that lags and is backfilled from the baseline")

print("\n=== TEST 8b: the college cadence beats the draft, not the clock ===")
# A rebuild with an unchanged rookie set is 0.02s (measured) — the cache key is a hash of the
# linked athlete ids, so no parquet is touched. With the cost gone, the only thing a long
# interval buys is phase drift: a 180-day tick landing in January next fires in July, AFTER
# dynasty rookie drafts, which is the one window this data exists for. Sleeper also keeps
# adding UDFAs and camp signings all summer, each changing the id set.
chk(SR.SOURCES["cfb"]["every"] == 90 * SR.DAY, "college profiles refresh every 90 days")
chk(SR.SOURCES["cfb"]["every"] <= 90 * SR.DAY,
    "…and never longer, or a class can miss its own rookie-draft season")
st = {"sources": {"cfb": {"last": now - 95 * SR.DAY}}}
isdue, _ = SR.due("cfb", SR.SOURCES["cfb"], st, now)
chk(isdue, "due once a quarter has passed")
chk(SR.GUARDS["cfb"]["never_empty"] is False,
    "an absent pandas degrades the block rather than rejecting the whole build")
chk(SR.GUARDS["cfb"]["min_ratio"] == 0.70,
    "a ratio floor tolerates the one big step each April when a class turns over")

print("\n=== TEST 9: nflverse freshness is read, not assumed ===")
state = {"nflverse": {t: "2020-01-01 00:00:00 EST" for t in SR.NFLVERSE_RELEASES}}
chk(len(SR.NFLVERSE_RELEASES) == 6, "the 6 frozen-feed releases are tracked (living feeds moved out — see TEST 13)")
chk("pbp" in SR.NFLVERSE_RELEASES and "ftn_charting" in SR.NFLVERSE_RELEASES,
    "including pbp and the charting family")
chk(SR.SOURCES["nflverse"]["every"] is None,
    "nflverse has no fixed cadence — its sections update on different schedules")

print("\n=== TEST 10: cache invalidation hits only its own source ===")
with tempfile.TemporaryDirectory() as tmp:
    real_cache = SR.CACHE
    SR.CACHE = tmp
    try:
        for d in ("fantasypros", "contracts", "nflverse", "sharp"):
            os.makedirs(os.path.join(tmp, d))
            open(os.path.join(tmp, d, "x.json"), "w").write("{}")
        for f in ("players.json", "proj_2026.json", "stats_2025.json"):
            open(os.path.join(tmp, f), "w").write("{}")

        removed = SR.invalidate(SR.SOURCES["ecr"])
        chk(not os.path.exists(os.path.join(tmp, "fantasypros")), "refreshing ECR clears cache/fantasypros")
        chk(os.path.exists(os.path.join(tmp, "contracts")), "…and leaves contracts alone")
        chk(os.path.exists(os.path.join(tmp, "players.json")), "…and leaves Sleeper alone")
        chk(len(removed) == 1, "it reports what it cleared")

        SR.invalidate(SR.SOURCES["sleeper"])
        chk(not os.path.exists(os.path.join(tmp, "players.json")), "the sleeper glob clears players.json")
        chk(not os.path.exists(os.path.join(tmp, "stats_2025.json")), "…and the stats_* glob")
        chk(os.path.exists(os.path.join(tmp, "nflverse")), "…and still leaves nflverse alone")

        SR.invalidate({"paths": ["does_not_exist_*"]})
        chk(True, "invalidating a missing path does not raise")
    finally:
        SR.CACHE = real_cache

print("\n=== TEST 11: every source is well formed ===")
for name, spec in SR.SOURCES.items():
    chk(isinstance(spec.get("paths"), list) and spec["paths"], f"{name}: has cache paths")
    chk("why" in spec and spec["why"], f"{name}: explains itself in the report")

print("\n=== TEST 12: the in-season sidecar source + its own guard ===")
# Fixed weekly cadence on purpose (nflverse pbp timestamps move nightly in-season — timestamp
# driven staleness would recreate the daily-deploy churn the sidecar exists to avoid), gated
# to the season actually running, and scoped to the CURRENT season's cache files only.
ins = SR.SOURCES["inseason"]
chk(ins["every"] == 7 * SR.DAY, "inseason: fixed 7-day cadence, not upstream timestamps")
chk(ins.get("in_season_only") is True, "inseason: dormant outside the season")
chk(any(str(SR._CUR_SEASON) in p for p in ins["paths"]), "inseason: invalidates only the current season's files")
# And the mirror image: the five completed seasons are frozen while games are being played,
# so nightly nflverse republishes cannot trigger a full five-season rebuild every day.
chk(SR.SOURCES["nflverse"].get("offseason_only") is True, "nflverse (historical): frozen in season")
chk(not SR.SOURCES["inseason"].get("offseason_only") and not SR.SOURCES["nflverse"].get("in_season_only"),
    "the two nflverse sources are gated to opposite halves of the year")

import json as _json  # noqa: E402


def _side_case(old, new, season_type="regular"):
    """Run check_inseason_sidecar with `new` on disk (None = file absent)."""
    real_path, real_state = SR.SIDECAR_INSEASON, SR._SEED_STATE
    fd = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    try:
        if new is None:
            fd.close()
            os.unlink(fd.name)
        else:
            fd.write(_json.dumps(new))
            fd.close()
        SR.SIDECAR_INSEASON = fd.name
        SR._SEED_STATE = dict(real_state, season_type=season_type)
        return SR.check_inseason_sidecar(old)
    finally:
        SR.SIDECAR_INSEASON, SR._SEED_STATE = real_path, real_state
        if new is not None and os.path.exists(fd.name):
            os.unlink(fd.name)


ok, _ = _side_case({"season": 2026, "weeks": [1, 2, 3]}, {"season": 2026, "weeks": [1, 2]})
chk(not ok, "weeks list shrinking for the same season is REJECTED (a broken pbp read)")
ok, _ = _side_case({"season": 2026, "weeks": [1, 2]}, {"season": 2026, "weeks": [1, 2, 3]})
chk(ok, "weeks growing passes")
ok, _ = _side_case({"season": 2026, "weeks": [1, 2]}, {"season": 2027, "weeks": [1]})
chk(ok, "a NEW season starting near-empty passes (additions-style policy)")
ok, _ = _side_case(None, {"season": 2026, "weeks": [1]})
chk(ok, "first-ever sidecar passes")
ok, _ = _side_case({"season": 2026, "weeks": [1, 2]}, None, season_type="regular")
chk(not ok, "sidecar vanishing MID-SEASON is REJECTED")
ok, _ = _side_case({"season": 2026, "weeks": list(range(1, 19))}, None, season_type="off")
chk(ok, "offseason retirement of the sidecar passes")

print("\n=== TEST 13: the historical block only watches frozen-feed releases ===")
# players/rosters/weekly_rosters release stamps move near-daily (camp churn / nightly in
# season) while their completed-season files are frozen — watching them rebuilt the whole
# historical block daily. See the NFLVERSE_RELEASES note.
for tag in ("players", "rosters", "weekly_rosters"):
    chk(tag not in SR.NFLVERSE_RELEASES, f"'{tag}' is not a historical-block trigger any more")
for tag in ("pbp", "pfr_advstats", "ftn_charting", "snap_counts"):
    chk(tag in SR.NFLVERSE_RELEASES, f"'{tag}' still is")
chk(set(SR.SOURCES["roster_moves"]["upstream"]) == {"rosters", "draft_picks", "trades"},
    "roster_moves keeps watching the living roster feeds on its own")

print("\n=== TEST 14: upstream damping — at most one historical rebuild per min_gap ===")
_now = time.time()
_spec = SR.SOURCES["nflverse"]
chk(_spec.get("min_gap") == 7 * SR.DAY, "nflverse carries a 7d min gap")
d, why = SR.upstream_damped("nflverse", _spec, {"sources": {"nflverse": {"last": _now - 2 * SR.DAY}}}, _now)
chk(d and "damped" in why, "upstream moved 2d after a rebuild → damped")
d, _ = SR.upstream_damped("nflverse", _spec, {"sources": {"nflverse": {"last": _now - 8 * SR.DAY}}}, _now)
chk(not d, "8d after a rebuild the movement goes through")
d, _ = SR.upstream_damped("nflverse", _spec, {"sources": {}}, _now)
chk(not d, "never-refreshed is never damped")
d, _ = SR.upstream_damped("roster_moves", SR.SOURCES["roster_moves"], {"sources": {"roster_moves": {"last": _now - 1}}}, _now)
chk(not d, "sources without a min_gap (roster_moves) are never damped")

print("\n=== TEST 15: a rebuild that only moved the state.asof build stamp is a no-op ===")
_old = {"state": {"season": 2026, "season_type": "pre", "week": 3, "asof": "2026-08-27T09:00:00Z"},
        "seed": {"KC": {"QB": [{"name": "Mahomes"}]}}, "ecr": {"ppr": {"a": 1}}}
import copy as _copy
_new = _copy.deepcopy(_old)
_new["state"]["asof"] = "2026-08-28T09:00:00Z"
chk(SR.effectively_unchanged(_old, _new), "asof-only difference → effectively unchanged (previous bytes kept)")
_new2 = _copy.deepcopy(_new)
_new2["seed"]["KC"]["QB"][0]["name"] = "Smith"
chk(not SR.effectively_unchanged(_old, _new2), "a real data change is never masked")
_new3 = _copy.deepcopy(_new)
_new3["state"]["week"] = 4
chk(not SR.effectively_unchanged(_old, _new3), "a real STATE change (week rollover) is never masked")
chk(not SR.effectively_unchanged(None, _new), "no previous seed → not 'unchanged'")

print(f"\nRESULT: {'PASS' if FAILED == 0 else 'MISS'} ({PASS}/{PASS + FAILED} checks)")
sys.exit(0 if FAILED == 0 else 1)
