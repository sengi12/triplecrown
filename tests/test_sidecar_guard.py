"""The lazy sidecars, regressed against their previous copies.

validate() compares the MAIN seed block by block. The per-season sidecars written beside it
were never looked at — which is how a coaching sidecar rebuilt with no play-action and no
motion shipped without the refresh noticing. The Scheme tab read "Not charted for this season"
for all 32 teams of a season that WAS charted, and the only thing that caught it was a test
assertion days later that could name the symptom but not the cause.

Size alone cannot catch that one: the coaching payload moved from a bucket per
down x distance x play-type to one row per play and got ~44% SMALLER doing it, so a tight size
floor would have rejected a real improvement while the actual loss hid inside rows that were
still there. So the guard asks the same question the app's hasType() asks, in the same flag
bits: does this season still carry the tendencies it carried before?
"""
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import seed_refresh as SR  # noqa: E402

P = F = 0


def chk(c, label):
    global P, F
    if c:
        P += 1
        print("  PASS:", label)
    else:
        F += 1
        print("  FAIL:", label)


TEAMS = ["DET", "KC", "SF", "BUF"]
# [set, week, down, ydstogo, flags, epa, success, yards, td, lane]
# flags: 1 pass · 2 play-action · 4 motion · 8 no-huddle · 16 red zone
def rows(flagset):
    return [[0, 1, 1, 10, f, 0, 0, 0, 0, -1] for f in flagset]


def rows_doc(flagset):
    return {"v": 5, "leg": {"rt": [], "ln": [], "al": []},
            "teams": {t: {"plays": rows(flagset), "lanes": [], "games": [[1, "SEA"]]} for t in TEAMS}}


def bucket_doc(types):
    """The older shape: a nested views grid whose pa/motion/nohuddle nodes may be pruned."""
    node = [10, []]
    inner = {"all": node}
    for t in types:
        inner[t] = node
    return {"v": 3, "leg": {"rt": [], "ln": [], "al": []},
            "teams": {t: {"views": {"all": {"all": inner}}} for t in TEAMS}}


print("=== the census reads both payload shapes, like the app does ===")
chk(SR.coaching_charted_bits({"plays": rows([1 | 2, 1 | 4, 1 | 8])}) & 2, "rows: play-action seen")
chk(SR.coaching_charted_bits({"plays": rows([1 | 2, 1 | 4, 1 | 8])}) & 4, "rows: motion seen")
chk(SR.coaching_charted_bits({"plays": rows([1, 1, 1])}) & SR.COACHING_CHARTED_MASK == 0,
    "rows with the bits clear on every play read as uncharted")
chk(SR.coaching_charted_bits({"views": {"all": {"all": {"all": [1, []], "pa": [1, []]}}}}) & 2,
    "buckets: a pa node means play-action was charted")
chk(SR.coaching_charted_bits({"views": {"all": {"all": {"all": [1, []]}}}}) & 2 == 0,
    "buckets: a pruned pa node reads as uncharted")


def run_guard(old_doc, new_doc, name="coaching.2025"):
    """Write `new_doc` where the guard will look for it, and regress it against `old_doc`."""
    tmp = tempfile.mkdtemp()
    real_seeds = SR.SEEDS
    SR.SEEDS = tmp
    try:
        path = os.path.join(tmp, f"triplecrown_seed.{name}.json")
        with open(path, "w") as f:
            json.dump(new_doc, f)
        return SR.check_season_sidecars({name: old_doc} if old_doc is not None else {})
    finally:
        SR.SEEDS = real_seeds
        shutil.rmtree(tmp, ignore_errors=True)


print("=== the regression this guard exists for ===")
charted = rows_doc([1 | 2, 1 | 4, 1 | 8, 1, 1, 1])
bad = run_guard(charted, rows_doc([1, 1, 1, 1, 1, 1]))
chk(len(bad) == 1, "a season that loses play-action and motion is rejected")
chk("charted tendencies vanished" in bad[0][2] and "4 team(s)" in bad[0][2],
    f"and the note says what was lost, for how many teams ({bad[0][2][:70]}…)")

print("=== and the migration it must NOT reject ===")
# The real event: buckets → rows, ~44% smaller, same tendencies. A size floor alone would
# have called this a failure and held back a genuine improvement.
migrated = run_guard(bucket_doc(["pa", "motion", "nohuddle"]), rows_doc([1 | 2, 1 | 4, 1 | 8, 1]))
chk(migrated == [], "the bucket → per-play migration passes: smaller, but nothing was lost")

print("=== partial loss counts too ===")
partial = run_guard(rows_doc([1 | 2, 1 | 4, 1 | 8, 1]), rows_doc([1 | 2, 1 | 8, 1, 1]))
chk(len(partial) == 1, "losing motion alone, while keeping play-action, is still a regression")

print("=== a pre-FTN season stays quiet ===")
preftn = run_guard(rows_doc([1, 1, 1]), rows_doc([1, 1, 1]))
chk(preftn == [], "a season that never had the tendencies does not trip the guard every run")
gained = run_guard(rows_doc([1, 1, 1]), rows_doc([1 | 2, 1 | 4, 1]))
chk(gained == [], "and gaining them (a season charted for the first time) is not a regression")

print("=== the blunt failures, on any sidecar ===")
chk(len(run_guard(rows_doc([1 | 2, 1 | 4]), {"v": 5, "leg": {}, "teams": {}})) == 1,
    "a sidecar that comes back empty is rejected")
big = {"v": 5, "leg": {}, "teams": {t: {"plays": rows([1] * 50)} for t in TEAMS}}
small = {"v": 5, "leg": {}, "teams": {"DET": {"plays": rows([1])}}}
chk(len(run_guard(big, small)) == 1, "a sidecar that collapses below the floor is rejected")
chk(run_guard(None, small) == [], "a sidecar with no previous copy has nothing to regress against")

print("=== every lazy sidecar is covered, and the in-season one is left to its own guard ===")
tmp = tempfile.mkdtemp()
real = SR.SEEDS
SR.SEEDS = tmp
try:
    for n in ("coaching.2025", "def_weekly", "ol_weekly", "adv_weekly", "cfb_logs", "inseason"):
        with open(os.path.join(tmp, f"triplecrown_seed.{n}.json"), "w") as f:
            json.dump({"a": 1}, f)
    with open(os.path.join(tmp, "triplecrown_seed.json"), "w") as f:
        json.dump({"a": 1}, f)
    found = set(SR.season_sidecars())
finally:
    SR.SEEDS = real
    shutil.rmtree(tmp, ignore_errors=True)
chk({"coaching.2025", "def_weekly", "ol_weekly", "adv_weekly", "cfb_logs"} <= found,
    "the lazy sidecars are all in scope")
chk("inseason" not in found, "the in-season sidecar is not — check_inseason_sidecar owns it")
chk(not any(n.startswith("triplecrown") for n in found), "and the main seed is not a sidecar")

print(f"\nRESULT: {P}/{P + F} " + ("ALL PASS" if not F else "SOME FAILED"))
sys.exit(1 if F else 0)
