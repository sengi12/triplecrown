"""The Advanced tab for the season in progress: PFR's weekly files stand in for its season
files (team pressure rate and missed tackles, OL pressure/hurry, contact yards, RB yards after
contact, the QB charting band), the FTN counters no longer die with the participation file,
and the personnel groupings are inferred (FTN backs × last season's tight-end split, tilted
to this season's snap counts) and flagged. Plus the rollover guards on the bake side."""
import os
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src", "nflverse"))
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import nflverse as nv  # noqa: E402

P = F = 0


def chk(c, label):
    global P, F
    if c:
        P += 1
        print("  PASS:", label)
    else:
        F += 1
        print("  FAIL:", label)


def mean(d):
    return sum(k * v for k, v in d.items())


print("=== the tilt: last season's shape, this season's mean ===")
d = nv._tilt_to_mean({1: .7, 2: .25, 3: .05}, 1.6)
chk(abs(mean(d) - 1.6) < 1e-6 and abs(sum(d.values()) - 1) < 1e-9, "a TE split tilted to a 1.6 mean hits it and stays a distribution")
chk(d[3] > .05 and d[1] < .7, "more tight ends: the two- and three-TE shares rise, the one-TE share falls")
d0 = nv._tilt_to_mean({1: .7, 2: .25, 3: .05}, None)
chk(abs(d0[1] - .7) < 1e-9, "no snap-count anchor → the prior unchanged")
chk(nv._tilt_to_mean({1: .7, 2: .3}, 5.0) == {1: .7, 2: .3}, "an unreachable target (outside the support) leaves the prior alone")
cond = {1: {1: .7, 2: .25, 3: .05}, 2: {0: .1, 1: .7, 2: .2}}
pb = {1: .8, 2: .2}
t = nv._tilt_conditionals(cond, pb, 1.5)
mu = sum(pb[b] * mean(t[b]) for b in pb)
chk(abs(mu - 1.5) < 1e-6, "one tilt parameter moves every backs-conditional so the MIXTURE mean matches the snap counts")
chk(t[2][2] > cond[2][2] and t[1][1] < cond[1][1], "and it moves the one-back and two-back splits the same way")

print("\n=== the groupings from P(backs) and P(te | backs) ===")
r = nv._personnel_rates({1: .8, 2: .2}, {1: {1: .6, 2: .3, 3: .1}, 2: {1: .9, 2: .1}})
chk(abs(r["p11"] - .48) < 1e-9 and abs(r["p12"] - .24) < 1e-9 and abs(r["p13"] - .08) < 1e-9 and abs(r["p21"] - .18) < 1e-9, "11 = P(1 back)·P(1 TE | 1 back) and so on: 48 / 24 / 8 / 18")
chk(abs(r["mrb"] - .2) < 1e-9 and abs(r["mte"] - (.8 * .4 + .2 * .1)) < 1e-9, "multi-RB is the measured two-back share; multi-TE sums the 2+ TE mass")
chk(abs(r["wr3"] - .48) < 1e-9, "3WR = five skill players less backs less tight ends ≥ 3 → only 11 personnel here")
r = nv._personnel_rates({1: .8, 2: .2}, {1: {(1, 1): .6, (1, 2): .4}, 2: {(2, 1): .5, (1, 2): .5}})
chk(abs(r["p11"] - .48) < 1e-9 and abs(r["p12"] - .42) < 1e-9 and abs(r["p21"] - .10) < 1e-9 and abs(r["mrb"] - .10) < 1e-9,
    "keyed on FTN's backfield count: a two-in-the-backfield play that was 12 personnel (H-back) counts as 12, not 21")
lam = nv._tilt_lambda({1: {(1, 1): .7, (1, 2): .3}}, {1: 1.0}, 1.6)
t2 = nv._apply_tilt({1: {(1, 1): .7, (1, 2): .3}}, lam)
chk(lam > 0 and abs(t2[1][(1, 2)] - .6) < 1e-6, "the tilt acts on the tight ends of a (backs, TE) state and hits the target mean")
chk(nv._tilt_lambda({1: {1: .7, 2: .3}}, {1: 1.0}, None) == 0.0 and nv._tilt_lambda({1: {1: .7, 2: .3}}, {1: 1.0}, 9.0) == 0.0, "no target, or one out of reach → no tilt")
gm = nv._group_mix(pd.DataFrame({"pmix": [[(1, 2, 60.0), (1, 1, 40.0)], None, [(1, 2, 70.0), (1, 1, 26.0), (1, 3, 4.0)]]}))
chk(gm == [["12", 65], ["11", 33]], "a set's mix averages its plays' estimates, drops the sub-5% tail, biggest first")
s = nv._shrink({1: 10, 2: 0}, {1: 50, 2: 40, 3: 10}, k=40)
chk(abs(s[1] - .6) < 1e-9 and abs(s[2] - .32) < 1e-9 and abs(s[3] - .08) < 1e-9, "a thin team split is shrunk toward the league's (10 plays vs k=40)")
chk(nv._shrink({}, {}) == {}, "nothing known → nothing")

print("\n=== the weekly defense file gives the season table's two PFR numbers ===")
dw = pd.DataFrame({"team": ["DET", "DET", "SEA"], "week": [1, 2, 1], "def_pressures": [10, 12, 7], "def_missed_tackles": [5, 6, 9]})
r = nv._team_defense_line_weekly(dw, pd.Series({"DET": 70, "SEA": 40}))
chk(r["Pressure Rate"]["DET"] == 31.4 and r["Pressure Rate"]["SEA"] == 17.5, "pressure rate = charted pressures over opponent dropbacks (22/70, 7/40)")
chk(r["Missed Tackles"]["DET"] == 11 and r["Missed Tackles"]["SEA"] == 9, "missed tackles sum the defenders' weeks")

print("\n=== the weekly frame reader ===")
_orig_parquet = nv._aux_parquet
nv._aux_parquet = lambda url, columns=None: pd.DataFrame({
    "game_type": ["REG", "REG", "POST", "REG"], "week": [1, 2, 19, 3], "team": ["LA", "DET", "DET", "DET"], "x": [1, 2, 3, 4]})
w = nv._pfr_week_frame("u/{season}", 2026)
chk(list(w["team"]) == ["LAR", "DET", "DET"] and list(w["week"]) == [1, 2, 3], "REG rows only, teams in the seed's codes, week as int")
nv.MAX_WEEK = 2
w = nv._pfr_week_frame("u/{season}", 2026)
chk(list(w["week"]) == [1, 2], "the time machine's MAX_WEEK caps it")
nv.MAX_WEEK = None


def _boom(url, columns=None):
    raise RuntimeError("404")


nv._aux_parquet = _boom
chk(nv._pfr_week_frame("u/{season}", 2026).empty, "a missing file is an empty frame, not an exception")
nv._aux_parquet = _orig_parquet

print("\n=== qb_charting from the weekly passing file ===")
_orig = (nv._aux_csv, nv._pfr_week_frame, nv._pfr_to_gsis_map, nv._load_pbp)


def _no_season_file(url, **kw):
    raise RuntimeError("no season file")


nv._aux_csv = _no_season_file
nv._pfr_week_frame = lambda tmpl, season, columns=None: pd.DataFrame({
    "game_type": ["REG"] * 3, "week": [1, 2, 1], "pfr_player_id": ["GoffJa00", "GoffJa00", "DarnSa00"],
    "pfr_player_name": ["Jared Goff", "Jared Goff", "Sam Darnold"],
    "times_pressured": [8, 6, 12], "times_sacked": [2, 1, 4], "passing_bad_throws": [5, 4, 9]})
nv._pfr_to_gsis_map = lambda: {"GoffJa00": "00-G", "DarnSa00": "00-D"}
nv._load_pbp = lambda season, cols=None: pd.DataFrame({
    "season_type": ["REG"] * 100, "pass_attempt": [1] * 100,
    "passer_player_id": ["00-G"] * 60 + ["00-D"] * 40})
q = nv.qb_charting(2026, min_attempts=1)
g = q["players"]["jared goff"]
chk(g["att"] == 60 and g["pressure_pct"] == round(14 / 63 * 100, 1) and g["bad_throw_pct"] == 15.0, "pressure % over dropbacks (attempts + sacks), bad-throw % over attempts, summed across weeks")
chk(g["on_tgt_pct"] is None and g["batted"] is None, "on-target and batted balls are season-file only and stay empty")
chk("pressure_pct" in q["lg"] and "on_tgt_pct" not in q["lg"], "league medians over what exists")
nv._aux_csv, nv._pfr_week_frame, nv._pfr_to_gsis_map, nv._load_pbp = _orig

print("\n=== personnel inferred end to end (synthetic 2026 on a 2025 prior) ===")
_orig = (nv._aux_csv, nv._load_pbp, nv._snap_share)
# 2026: DET and SEA, two weeks, 100 plays each; FTN charts 1 back on 80% and 2 backs on 20%.
plays = []
for tm, opp in (("DET", "SEA"), ("SEA", "DET")):
    for wk in (1, 2):
        for i in range(100):
            plays.append({"game_id": f"2026_0{wk}_DET_SEA", "play_id": i + (0 if tm == "DET" else 1000), "season_type": "REG", "week": wk,
                          "posteam": tm, "defteam": opp, "play_type": "pass" if i % 2 else "run", "backs": 2 if i % 5 == 0 else 1})
pbp26 = pd.DataFrame(plays)
ftn26 = pd.DataFrame({"nflverse_game_id": pbp26["game_id"], "nflverse_play_id": pbp26["play_id"], "n_offense_backfield": pbp26["backs"]})
# 2025 participation: DET lived in 12 personnel (1 back → 2 TE half the time), SEA in 11.
prev = []
for tm, opp in (("DET", "SEA"), ("SEA", "DET")):
    for i in range(200):
        te = (2 if i % 2 else 1) if tm == "DET" else (1 if i % 10 else 2)
        b = 2 if i % 5 == 0 else 1
        prev.append({"game_id": "2025_01_DET_SEA", "play_id": i + (0 if tm == "DET" else 1000), "posteam": tm, "defteam": opp,
                     "season_type": "REG", "play_type": "pass", "off": f"{b} RB, {te} TE, {5 - b - te} WR",
                     "dfn": "4 DL, 2 LB, 5 DB" if i % 3 else "4 DL, 3 LB, 4 DB"})
pbp25 = pd.DataFrame(prev)
part25 = pd.DataFrame({"nflverse_game_id": pbp25["game_id"], "play_id": pbp25["play_id"], "offense_personnel": pbp25["off"], "defense_personnel": pbp25["dfn"]})


def _csv(url, **kw):
    if "ftn_charting" in url:
        return ftn26.copy()
    if "participation" in url and "2025" in url:
        return part25.copy()
    raise RuntimeError("no such file: " + url)


nv._aux_csv = _csv
nv._load_pbp = lambda season, cols=None: (pbp26 if int(season) == 2026 else pbp25.drop(columns=["off", "dfn"])).copy()
snap = {"DET": 1.5, "SEA": 1.1}
nv._snap_share = lambda season, positions, side: (snap if side == "offense" else {"DET": 4.5, "SEA": 5.2})
nv._PERS_INFER.pop(2026, None)
inf = nv._personnel_inferred(2026)
chk(inf is not None and inf["prior"] == 2025 and set(inf["off"].index) == {"DET", "SEA"}, "both teams get an inferred offense table on the 2025 prior")
det, sea = inf["off"].loc["DET"], inf["off"].loc["SEA"]
chk(det["Multi RB Rate"] == 20.0 and sea["Multi RB Rate"] == 20.0, "the two-back share is FTN's measured 20%, not a prior")
chk(det["12 Personnel"] > sea["12 Personnel"] and sea["11 Personnel"] > det["11 Personnel"], "DET (a 12-personnel team last year, 1.5 TE per snap now) reads more 12; SEA more 11")
chk(abs(det["11 Personnel"] + det["12 Personnel"] + det["13 Personnel"] - 80.0) < 0.2, "the one-back groupings sum to the one-back share")
wk = inf["weekly"][("DET", 1)]
chk(wk["off_pers_obs"] == 100 and abs(wk["off_11"] + wk["off_12"] + wk["off_13"] + wk["off_21"] + (wk["off_multirb"] - wk["off_21"]) - 100) < 1.0 and wk["def_pers_obs"] == 100,
    "weekly expected counts per team-week, offense and defense, so a week window recomputes")
dd = inf["def"]
chk(dd.loc["SEA"]["Sub Package Rate"] > dd.loc["DET"]["Sub Package Rate"], "the defense: SEA (5.2 DBs per snap) reads more sub package than DET (4.5)")
# the snap-count anchor is what moves it: same prior, more tight ends → more 12 personnel
snap["SEA"] = 1.6
nv._PERS_INFER.pop(2026, None)
inf2 = nv._personnel_inferred(2026)
chk(inf2["off"].loc["SEA"]["12 Personnel"] > sea["12 Personnel"] and inf2["off"].loc["SEA"]["Multi TE Rate"] > sea["Multi TE Rate"], "a team that started using a second tight end shows it the week the snap counts do")
chk(inf2["joint"] is False, "without last season's charting the prior is TE | backs")

print("\n=== the joint prior when last season was charted (H-backs) ===")
# 2025 charting: DET's two-in-the-backfield plays were 12 personnel (an H-back), SEA's were 21.
ftn25 = pd.DataFrame({"nflverse_game_id": pbp25["game_id"], "nflverse_play_id": pbp25["play_id"],
                      "qb_location": ["S"] * len(pbp25), "n_offense_backfield": [2 if i % 5 == 0 else 1 for i in range(len(pbp25))]})
prev2 = pbp25.copy()
prev2["off"] = ["1 RB, 2 TE, 2 WR" if (i % 5 == 0 and tm == "DET") else ("2 RB, 1 TE, 2 WR" if (i % 5 == 0) else "1 RB, 1 TE, 3 WR")
                for i, tm in zip(range(len(prev2)), prev2["posteam"])]
part25b = pd.DataFrame({"nflverse_game_id": prev2["game_id"], "play_id": prev2["play_id"], "offense_personnel": prev2["off"], "defense_personnel": prev2["dfn"]})


def _csv2(url, **kw):
    if "ftn_charting" in url and "2026" in url:
        return ftn26.copy()
    if "ftn_charting" in url and "2025" in url:
        return ftn25.copy()
    if "participation" in url and "2025" in url:
        return part25b.copy()
    raise RuntimeError("no such file: " + url)


nv._aux_csv = _csv2
nv._snap_share = lambda season, positions, side: {}
nv._PERS_INFER.pop(2026, None)
inf3 = nv._personnel_inferred(2026)
chk(inf3 is not None and inf3["joint"] is True and inf3["priors"]["joint_lg"].get(2), "with charted 2025 the prior is (backs, TE) keyed on FTN's backfield count")
d3, s3 = inf3["off"].loc["DET"], inf3["off"].loc["SEA"]
chk(d3["12 Personnel"] > d3["21 Personnel"] and s3["21 Personnel"] > s3["12 Personnel"], "DET's two-in-the-backfield plays read 12 (its H-back), SEA's read 21 — same FTN count, different truth")
chk(inf3["priors"]["al_lg"].get(("gun", 2)) and ("DET", "gun", 2) in inf3["priors"]["al_team"], "and the alignment × backfield prior the Playbook's sets read is there")
nv._aux_csv, nv._load_pbp, nv._snap_share = _orig
nv._PERS_INFER.pop(2026, None)

print("\n=== the wiring (source) ===")
src = open(os.path.join(HERE, "..", "src", "nflverse", "nflverse.py")).read()
chk('if _empty("Pressure Rate") or _empty("Missed Tackles"):' in src and "_team_defense_line_weekly(dw, opp_db)" in src, "team_defense_line falls back to the weekly defense file")
chk('if _empty("Pressure Rate") or _empty("Hurry Rate"):' in src and "PFR_PASS_WEEK_URL, season," in src, "the OL pass table reads the weekly passing file for pressures and hurries")
chk('if _empty("YBC/Rush") or _empty("YAC/Rush") or _empty("Broken Tackle Rate"):' in src, "the OL run table reads the weekly rushing file for the contact split")
chk("if not yac_contact:" in src and "rushing_yards_after_contact" in src, "RB yards after contact fall back to the weekly rushing file")
i = src.index("def adv_weekly_team"); body = src[i:src.index("def team_defense_line")]
chk(body.index('out["dl_dropbacks"]') < body.index("part = _aux_csv(") and '"dl_pfr_obs", "dl_pfr_pressures", "dl_missed_tackles", "off_pers_est", "def_pers_est"' in body,
    "adv_weekly: the FTN/pbp pass-rush counters come before (outside) the participation try; PFR's weekly pressures/missed tackles and the estimate flags ship as columns")
chk('inf = _personnel_inferred(season)' in body and 'out.loc[(tm, w), "off_pers_est"] = 1.0' in body, "adv_weekly fills inferred personnel counts per week when participation is missing")
j = src.index("def ol_weekly_team"); obody = src[j:j + 9000]
chk('"sack", "qb_hit", "yards_gained"' in obody and 'pressed = hit | (d["sack"] == 1)' in obody and obody.index('out["non_qb_sacks"]') < obody.index("PART_URL"),
    "ol_weekly: non-QB sacks (FTN) survive without participation; no-blitz pressure uses the hit-or-sack proxy")
k = src.index("def build_team_block"); tb = src[k:k + 7000]
chk('team["personnel"]["estimated"]' in tb and 'team["def_tendencies"]["estimated"]' in tb and "_personnel_inferred(season)" in tb, "build_team_block flags inferred personnel and defensive packages")
ins = open(os.path.join(HERE, "..", "src", "nflverse", "inseason.py")).read()
chk('"qb_charting"' in ins and '"head_coaches"' in ins and "_nfl.qb_charting(season, min_attempts=1)" in ins, "the live build ships qb_charting and head_coaches")
js = open(os.path.join(HERE, "..", "src", "js", "15b-nflverse-lazy.js")).read()
chk("'head_coaches']" in js, "and the app adopts head_coaches from the sidecar")

print("\n=== the rollover guards (bake side) ===")
bs = open(os.path.join(HERE, "..", "build_seed.py")).read()
chk("PROJ_MIN_LIVE_ROWS = 200" in bs and 'if (r or {}).get("stats"))' in bs and "proj_idx, proj_season = _prev_idx, args.season - 1" in bs,
    "an opened-but-unfilled projection season builds on the previous season's numbers")
chk('last_played = args.season if TC_STATE.get("season_type") in ("post", "off") else args.season - 1' in bs, "the season just played is in the history window in the post-season and the offseason")
chk("_side_season = _sidecar_season(_inseason_path)" in bs and "not in (nflverse or {})" in bs, "the in-season sidecar retires only once the frozen block carries its season")
sr = open(os.path.join(HERE, "..", "tools", "seed_refresh.py")).read()
chk("def _proj_count(s):" in sr and "pj_now < pj_was * 0.70" in sr, "the refresher rejects a seed whose projected volume collapsed")

print(f"\nRESULT: {P}/{P + F} {'ALL PASS' if F == 0 else 'SOME FAILED'}")
sys.exit(0 if F == 0 else 1)
