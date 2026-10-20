"""Pressure rate on the defensive weekly card: PFR's pressures per pass-rush snap. The
denominator is exact (participation: dropbacks he was on the field for) when the season has
it, else estimated as defensive snaps × the team's dropback share that week; a week needs
5 such snaps and a charted pressure count; the season rate pools the weeks that have both."""
import os, shutil, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _reexec_with_deps():
    """run_tests.sh invokes a bare python3, which in this repo resolves to an empty .venv;
    find an interpreter with pandas before giving up (same helper as test_ol_pipeline)."""
    if os.environ.get("_TC_SNAPS_REEXEC"):
        return None
    probe = "import pandas"
    seen = {os.path.realpath(sys.executable)}
    cands = []
    for c in ("python3.12", "python3.11", "python3"):
        w = shutil.which(c)
        if w and os.path.realpath(w) not in seen:
            cands.append(w); seen.add(os.path.realpath(w))
    for d in (os.path.expanduser("~/.pyenv/shims"), os.path.expanduser("~/.pyenv/versions/nfl/bin")):
        w = os.path.join(d, "python3")
        if os.path.exists(w) and os.path.realpath(w) not in seen:
            cands.append(w); seen.add(os.path.realpath(w))
    for c in cands:
        try:
            if subprocess.run([c, "-c", probe], capture_output=True, timeout=30).returncode == 0:
                return c
        except Exception:
            pass
    return None


_cand = _reexec_with_deps()
if _cand:
    os.environ["_TC_SNAPS_REEXEC"] = "1"
    sys.exit(subprocess.call([_cand, os.path.abspath(__file__)]))

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "nflverse"))
import nflverse as nv

fails = []
def chk(c, l):
    print(("  PASS: " if c else "  FAIL: ") + l)
    if not c: fails.append(l)

share = {("CIN", 1): 0.60, ("CIN", 2): 0.50, ("CIN", 3): 0.55}
weeks = [
    {"week": 1, "team": "CIN", "snaps": 60, "pressures": 4},     # 36 pass snaps → 11.1%
    {"week": 2, "team": "CIN", "snaps": 50, "pressures": 1},     # 25 → 4.0%
    {"week": 3, "team": "CIN", "snaps": 40},                     # played, PFR not charted: no rate
    {"week": 4, "team": "CIN", "snaps": 70, "pressures": 2},     # no share known: no denominator
    {"week": 5, "team": "CIN", "snaps": 6, "pressures": 0},      # share 0 → below the 5-snap floor
]
share[("CIN", 5)] = 0.5
prs, ps = nv._def_pass_rush_rate(weeks, share)
chk(weeks[0]["pass_snaps"] == 36.0 and weeks[0]["prs_rate"] == 11.1, "week 1: 60 snaps × 60% dropbacks = 36 pass-rush snaps, 4 pressures → 11.1%")
chk(weeks[1]["prs_rate"] == 4.0, "week 2: 1 of 25 → 4.0%")
chk(weeks[2].get("pass_snaps") == 22.0 and "prs_rate" not in weeks[2], "an uncharted week gets its pass snaps but no rate")
chk("pass_snaps" not in weeks[3] and "prs_rate" not in weeks[3], "a week with no dropback share has no denominator")
chk(weeks[4]["pass_snaps"] == 3.0 and "prs_rate" not in weeks[4], "three pass-rush snaps are under the five-snap floor")
chk(prs == 5.0 and ps == 61.0 and round(100 * prs / ps, 1) == 8.2, "the season rate pools only the weeks with both: 5 of 61 → 8.2%")

exact = {1: 40, 2: 20}
weeks2 = [{"week": 1, "team": "CIN", "snaps": 60, "pressures": 4}, {"week": 2, "team": "CIN", "snaps": 50, "pressures": 1}, {"week": 3, "team": "CIN", "snaps": 40, "pressures": 2}]
prs2, ps2 = nv._def_pass_rush_rate(weeks2, share, exact)
chk(weeks2[0]["pass_snaps"] == 40.0 and weeks2[0]["prs_rate"] == 10.0 and weeks2[1]["prs_rate"] == 5.0, "with participation the exact on-field dropbacks replace the estimate (40 and 20)")
chk(weeks2[2]["pass_snaps"] == 22.0 and weeks2[2]["prs_rate"] == 9.1, "a week the participation file lacks falls back to the estimate")

print(f"RESULT: {'PASS' if not fails else str(len(fails)) + ' FAIL'}")
sys.exit(1 if fails else 0)
