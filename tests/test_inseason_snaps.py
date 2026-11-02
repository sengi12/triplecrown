"""In-season sidecar: nflverse snap counts merged into the per-player weekly rows — an
existing week gains snaps + snap_pct, a snap-only week becomes a row of zeros with snaps,
a percent or a fraction upstream both land as an integer percent, no PFR→GSIS match is
skipped, and a week with no snap entry keeps the columns unknown (not zero)."""
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


try:
    import pandas as pd
except Exception as e:  # pragma: no cover
    alt = _reexec_with_deps()
    if alt:
        sys.exit(subprocess.run([alt, os.path.abspath(__file__)], env=dict(os.environ, _TC_SNAPS_REEXEC="1")).returncode)
    print(f"SKIP: no interpreter with pandas found ({e})")
    sys.exit(0)

import src.nflverse.inseason as ins

fails = 0
def chk(c, l):
    global fails
    print(("  PASS: " if c else "  FAIL: ") + l); fails += (0 if c else 1)

chk(ins.PLAYER_WEEK_COLS[-5:] == ["snaps", "snap_pct", "pass_2pt", "rush_2pt", "rec_2pt"], "the snap and two-point columns trail the usage line, so older rows read them as absent")

snaps = pd.DataFrame({
    "game_type": ["REG", "REG", "REG", "REG", "REG"],
    "week": [1, 2, 1, 1, 2],
    "team": ["KC", "KC", "DET", "SF", "SF"],
    "pfr_player_id": ["KelcTr00", "KelcTr00", "GibbJa00", "NoMatch0", "PctAsPc0"],
    "offense_snaps": [50, 40, 30, 20, 45],
    "offense_pct": [0.85, 0.70, 0.5, 0.4, 75.0],
})
p2g = {"KelcTr00": "00-0030506", "GibbJa00": "00-0039117", "PctAsPc0": "00-0099999"}
m = ins._snaps_frame_to_map(snaps, p2g)
chk(m["00-0030506"] == {1: (50, 85.0, "KC"), 2: (40, 70.0, "KC")}, "fractions upstream become percents, per week")
chk(m["00-0099999"] == {2: (45, 75.0, "SF")}, "a percent upstream stays a percent")
chk("NoMatch0" not in str(m) and len(m) == 3, "a PFR id with no GSIS match is skipped")

players = {"00-0030506": {"n": "travis kelce", "p": "TE", "t": "KC", "w": {"1": [5, 3, 71, 0, 29, 0, 0, 0, 0, 0, 0, 0, 5.0, 25]}}}
ins.merge_snaps(players, m, {"00-0039117": "RB", "00-0099999": "OL"}, {"00-0039117": "jahmyr gibbs"})
ci = {c: i for i, c in enumerate(ins.PLAYER_WEEK_COLS)}
k = players["00-0030506"]["w"]
chk(k["1"][ci["snaps"]] == 50 and k["1"][ci["snap_pct"]] == 85 and k["1"][ci["tgt"]] == 5, "Kelce week 1: the pbp row gains snaps 50 / 85% and keeps its targets")
chk(k["2"][ci["snaps"]] == 40 and k["2"][ci["snap_pct"]] == 70 and sum(k["2"][:ci["snaps"]]) == 0, "Kelce week 2 (no touches in pbp): a row of zeros with the snaps")
g = players.get("00-0039117")
chk(g and g["p"] == "RB" and g["t"] == "DET" and g["n"] == "jahmyr gibbs" and g["w"]["1"][ci["snap_pct"]] == 50, "a snap-only player is added with pos, team and name")
chk("00-0099999" not in players, "an OL with snaps is not a fantasy row")

# Unknown stays unknown: a week with no snap entry for a player who has pbp touches.
players2 = {"00-0030506": {"n": "travis kelce", "p": "TE", "t": "KC", "w": {"3": [4, 4, 40, 0, 20, 0, 0, 0, 0, 0, 0, 0, 1.0, 30]}}}
ins.merge_snaps(players2, m, {}, {})
w3 = players2["00-0030506"]["w"]["3"]
chk(len(w3) < len(ins.PLAYER_WEEK_COLS) or w3[ci["snap_pct"]] is None, "a week the snap file does not cover carries no snap_pct (unknown, not 0)")
chk(ins.merge_snaps({"x": {"w": {}}}, {}, {}, {}) == {"x": {"w": {}}}, "no snap counts yet → the rows are untouched")

# ── build_player_weekly: two-point tries are scored, never counted as targets or carries;
#    a lateral touchdown belongs to the lateral man (2026 wk 3, Evans → Samuel) ──
ins._nfl._pos_map = lambda season: {"q1": "QB", "w1": "WR", "w9": "WR", "r1": "RB"}
ins._nfl._name_map = lambda season: {"q1": "qb one", "w1": "mike evans", "w9": "deebo samuel", "r1": "back"}
ins.snap_counts_by_gsis = lambda season: {}
base = dict(week=1, season_type="REG", posteam="SF", defteam="ARI", game_id="2026_01_ARI_SF", game_date="2026-09-20",
            pass_attempt=0, complete_pass=0, sack=0, passing_yards=0.0, receiving_yards=0.0, rushing_yards=0.0,
            air_yards=0.0, pass_touchdown=0, rush_touchdown=0, interception=0, epa=0.0, vegas_wp=0.5,
            play_type="pass", two_point_attempt=0, two_point_conv_result=None,
            passer_player_id=None, receiver_player_id=None, rusher_player_id=None, td_player_id=None)
plays = [
    dict(base, pass_attempt=1, complete_pass=1, passing_yards=2.0, receiving_yards=2.0, pass_touchdown=1,
         passer_player_id="q1", receiver_player_id="w1", td_player_id="w9"),            # the lateral TD
    dict(base, pass_attempt=1, complete_pass=1, passing_yards=12.0, receiving_yards=12.0, pass_touchdown=1,
         passer_player_id="q1", receiver_player_id="w1", td_player_id="w1"),            # a real one
    dict(base, pass_attempt=1, two_point_attempt=1, two_point_conv_result="success",
         passer_player_id="q1", receiver_player_id="w1"),                               # 2-pt pass, good
    dict(base, pass_attempt=1, two_point_attempt=1, two_point_conv_result="failure",
         passer_player_id="q1", receiver_player_id="w9"),                               # 2-pt pass, no good
    dict(base, play_type="run", two_point_attempt=1, two_point_conv_result="success", rusher_player_id="r1"),
    dict(base, play_type="run", rushing_yards=5.0, rusher_player_id="r1"),
]
pbp = pd.DataFrame(plays)
for c in ("_comp", "_close", "_garbage", "_over"):
    pbp[c] = False
built = ins.build_player_weekly(2026, pbp)
pw = built["players"] if isinstance(built, dict) and "players" in built else built
ci = {c: i for i, c in enumerate(ins.PLAYER_WEEK_COLS)}
w1, q1, r1 = (pw[k]["w"]["1"] for k in ("w1", "q1", "r1"))
chk(w1[ci["tgt"]] == 2 and w1[ci["rec"]] == 2 and w1[ci["rec_td"]] == 1 and w1[ci["rec_2pt"]] == 1,
    "Evans: two targets (the 2-pt try is not one), one TD (the lateral is Samuel's), one 2-pt catch")
chk("w9" not in pw, "Samuel: a failed 2-pt target is no line at all")
chk(q1[ci["pass_att"]] == 2 and q1[ci["pass_td"]] == 2 and q1[ci["pass_2pt"]] == 1,
    "the QB keeps both passing TDs (the lateral is still his throw) and gets the conversion")
chk(r1[ci["carry"]] == 1 and r1[ci["rush_2pt"]] == 1, "the back: one carry, one rushed conversion")
dvp = ins.build_def_vs_pos(2026, pbp)["teams"]["ARI"]
dci = {c: i for i, c in enumerate(ins.DVP_COLS)}
chk(dvp["WR"]["1"][dci["tgt"]] == 2 and dvp["WR"]["1"][dci["rec_td"]] == 1 and dvp["QB"]["1"][dci["pass_td"]] == 2,
    "def-vs-pos: the same rules — two WR targets, one WR touchdown, two passing touchdowns allowed")

print(f"RESULT: {'PASS' if not fails else str(fails) + ' FAIL'}")
sys.exit(1 if fails else 0)
