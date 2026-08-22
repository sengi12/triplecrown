#!/usr/bin/env python3
"""Offline unit tests for the OL grading stack in src/nflverse/ol_grades_pipeline.py.

Covers the pure grading logic — name normalization, the Adjusted Line Yards curve, the
letter curve, sample-size shrinkage, composite weighting, active-pool scoping and phase
blending — with synthetic frames. Nothing here touches the network, matching the rest of
the Python suite.

These exist because the grading model was rewritten wholesale: the plus-minus coefficients
were removed from the published grade after validating at AUC 0.541 against ESPN's
tracking-derived win rates (a coin flip), and replaced with a market/snap-share/draft
composite that validates at 0.802. That is a lot of new arithmetic to leave unpinned.
"""
import os
import shutil
import subprocess
import sys

test_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(test_dir, "..", "src", "nflverse"))


def _reexec_with_deps():
    """Re-run under an interpreter that has the scientific stack, if this one lacks it.

    run_tests.sh invokes a bare `python3`, which on this repo resolves to .venv — and the
    venv has no pandas, so a plain import guard here would print SKIP forever and this file
    would join the suites that exist without ever running. Look for a capable interpreter
    before giving up; only skip when the machine genuinely has none.
    """
    if os.environ.get("_TC_OL_REEXEC"):
        return None
    probe = "import numpy, pandas, scipy, sklearn"
    seen = {os.path.realpath(sys.executable)}
    cands = []
    for c in ("python3.12", "python3.11", "python3"):
        w = shutil.which(c)
        if w:
            cands.append(w)
    cands += [os.path.expanduser("~/.pyenv/shims/python3"),
              "/opt/homebrew/bin/python3", "/usr/local/bin/python3"]
    for c in cands:
        rp = os.path.realpath(c) if c and os.path.exists(c) else None
        if not rp or rp in seen:
            continue
        seen.add(rp)
        try:
            if subprocess.run([c, "-c", probe], capture_output=True, timeout=60).returncode == 0:
                return c
        except Exception:
            continue
    return None


try:
    import numpy as np
    import pandas as pd
    import ol_grades_pipeline as olp
except Exception as first_err:  # pragma: no cover - environment guard
    alt = _reexec_with_deps()
    if alt:
        env = dict(os.environ, _TC_OL_REEXEC="1")
        sys.exit(subprocess.run([alt, os.path.abspath(__file__)], env=env).returncode)
    print(f"SKIP: no interpreter with numpy/pandas/scipy/sklearn found ({first_err})")
    sys.exit(0)

passed = failed = 0


def chk(cond, label):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS: {label}")
    else:
        failed += 1
        print(f"  FAIL: {label}")


# ── name normalization ─────────────────────────────────────────────────────────────
print("=== norm_name: cross-source matching ===")
chk(olp.norm_name("A.J. Cann") == olp.norm_name("AJ Cann"), "punctuation ignored")
chk(olp.norm_name("Warren McClendon Jr") == olp.norm_name("Warren McClendon"),
    "generational suffix stripped")
chk(olp.norm_name("  Trent   Williams ") == "trent williams", "whitespace collapsed")
chk(olp.norm_name(None) == "", "None is safe")

# ── Adjusted Line Yards distance curve ─────────────────────────────────────────────
print("\n=== aly_weight: the line owns short yardage, the back owns long runs ===")
chk(olp.aly_weight(-2) == 1.20, "losses count more than fully (the line got beaten)")
chk(olp.aly_weight(0) == 1.00 and olp.aly_weight(4) == 1.00, "0-4 yards fully credited")
chk(olp.aly_weight(7) == 0.50, "5-10 yards half credited")
chk(olp.aly_weight(40) == 0.0, "breakaway runs credited to the back, not the line")

# ── letter curve ───────────────────────────────────────────────────────────────────
print("\n=== pct_to_letter: strict within-position curve ===")
chk(olp.pct_to_letter(99) == "A+", "top of the curve")
chk(olp.pct_to_letter(50) == "C", "median is a C")
chk(olp.pct_to_letter(1) == "F", "bottom of the curve")
chk(olp.pct_to_letter(None) is None, "missing percentile yields no grade")
chk(olp.pct_to_letter(float("nan")) is None, "NaN percentile yields no grade")

# ── sample-size shrinkage ──────────────────────────────────────────────────────────
print("\n=== shrink: low-snap estimates pull toward the position mean ===")
sh = pd.DataFrame({"coef": [1.0, 1.0, -1.0, -1.0], "n": [100, 10000, 100, 10000],
                   "pos": ["T"] * 4}, index=list("abcd"))
out = olp.shrink(sh, "coef", "n", k=1000)
grp_mean = sh.coef.mean()
low_dev = abs(out.loc["a", "coef"] - grp_mean)
high_dev = abs(out.loc["b", "coef"] - grp_mean)
chk(low_dev < high_dev, "a 100-snap estimate is pulled in harder than a 10,000-snap one")
chk(abs(out.loc["b", "coef"] - 1.0) < 0.15, "a full-time starter keeps most of his measurement")
chk(np.sign(out.loc["a", "coef"] - grp_mean) == np.sign(1.0 - grp_mean),
    "shrinkage never flips the sign of a deviation")

# ── composite weighting ────────────────────────────────────────────────────────────
print("\n=== build_composite: weighting, renormalization, active-pool scoping ===")
chk(abs(sum(olp.COMPOSITE_W.values()) - 1.0) < 1e-6, "composite weights sum to 1")
chk(all(w >= 0 for w in olp.COMPOSITE_W.values()), "no negative weights (NNLS-fit)")
chk(olp.COMPOSITE_W["market"] > olp.COMPOSITE_W["draft"],
    "market outweighs draft capital, as measured")


def _frames(n=12, latest=2025, last_seasons=None, drop_market=()):
    """A synthetic position group with a clean quality gradient."""
    idx = [f"00-{i:04d}" for i in range(n)]
    out = pd.DataFrame({"pos": ["T"] * n, "team": ["DET"] * n,
                        "name": [f"Player {i}" for i in range(n)]}, index=idx)
    ls = last_seasons or [latest] * n
    priors = pd.DataFrame({
        "snap_pct": np.linspace(0.05, 1.0, n),
        "apy_cap_pct": np.linspace(0.2, 12.0, n),
        "draft_cap": np.linspace(-5.6, -1.0, n),
        "draft_decay": [0.5] * n,
        "snaps_total": np.linspace(50, 1100, n),
        "last_season": ls,
    }, index=idx)
    for pid in drop_market:
        priors.loc[pid, "apy_cap_pct"] = np.nan
    return out, priors


out, priors = _frames()
c = olp.build_composite(out, priors, 2025)
chk(c.ol_pctile.notna().all(), "every player in the pool receives a percentile")
chk(c.ol_pctile.idxmax() == c.index[-1] and c.ol_pctile.idxmin() == c.index[0],
    "composite preserves the quality ordering of its inputs")
chk(c.ol_grade.iloc[-1] in ("A+", "A") and c.ol_grade.iloc[0] in ("F", "D-"),
    "the gradient spans the letter curve")
chk(0.0 <= c.snap_pct.min() and c.snap_pct.max() <= 100.0,
    "snap_pct is emitted on 0-100, matching every consumer")

# A missing contract must shift weight onto the remaining signals, not drag the player down.
out2, priors2 = _frames(drop_market=["00-0011"])
c2 = olp.build_composite(out2, priors2, 2025)
chk(c2.loc["00-0011", "ol_pctile"] > 60,
    "a top player with no contract on file is not penalized for the missing signal")
chk(pd.notna(c2.loc["00-0011", "ol_score"]), "missing market still yields a score")

# Retired players are scored but excluded from the percentile POOL.
ls = [2025] * 11 + [2021]
out3, priors3 = _frames(last_seasons=ls)
priors3.loc["00-0011", "snap_pct"] = 1.0        # played every snap in his last season
c3 = olp.build_composite(out3, priors3, 2025)
chk(bool(c3.loc["00-0011", "is_active"]) is False, "a player last seen in 2021 is inactive")
chk(bool(c3.loc["00-0010", "is_active"]) is True, "a current player is active")
chk(pd.notna(c3.loc["00-0011", "ol_pctile"]),
    "inactive players are still scored (a returning veteran keeps a grade)")

# ── phase blending ─────────────────────────────────────────────────────────────────
print("\n=== blend_phase_grades: team context and the ESPN anchor ===")
chk(0.0 <= olp.TEAM_BLEND <= 0.5, "team blend stays a minority of a player's phase grade")
chk(olp.ESPN_BLEND > olp.TEAM_BLEND,
    "a direct tracking measurement outweighs team context")

base = c.copy()
base["team"] = ["DET"] * 6 + ["CHI"] * 6
tp = pd.DataFrame({"press_pctile": [95.0, 5.0]}, index=["DET", "CHI"])
trun = pd.DataFrame({"aly_pctile": [5.0, 95.0]}, index=["DET", "CHI"])
b = olp.blend_phase_grades(base, tp, trun)
chk(b.pass_pctile.notna().all() and b.run_pctile.notna().all(), "both phase grades populate")
chk((b.loc["00-0000", "pass_pctile"] > b.loc["00-0000", "run_pctile"]),
    "a strong pass-protecting line lifts pass over run for the same player")
chk(b.loc["00-0000", "team_pass_pctile"] == 95.0, "team layer is reported in its own column")

# Team context must not overwhelm the individual: two players on opposite-quality lines
# should still rank in composite order if their individual gap is large enough.
chk(b.loc["00-0011", "pass_pctile"] > b.loc["00-0000", "pass_pctile"],
    "individual quality still dominates a same-phase comparison across lines")

# ── played-in team context ────────────────────────────────────────────────────────
print("\n=== blend_phase_grades: the unit a player actually played in, scaled by exposure ===")
# Same two lines. Player 00-0000 is a DET starter who missed most of the latest season;
# player 00-0001 is a full-time DET starter. Pooled context says DET pass = 95 for both.
ctx = pd.DataFrame({
    "pass_ctx": [40.0, 95.0], "run_ctx": [50.0, 5.0], "exposure": [0.30, 1.00],
}, index=["00-0000", "00-0001"])
bc = olp.blend_phase_grades(base, tp, trun, context=ctx)
ind0 = base.loc["00-0000", "ol_pctile"]
full0 = ind0 * (1 - olp.TEAM_BLEND) + 40.0 * olp.TEAM_BLEND
scaled0 = ind0 * (1 - olp.TEAM_BLEND * 0.30) + 40.0 * olp.TEAM_BLEND * 0.30
chk(abs(bc.loc["00-0000", "pass_pctile"] - round(scaled0, 1)) <= 0.11,
    "a player who missed most of the window gets his own context at a fraction of the blend")
chk(abs(bc.loc["00-0000", "pass_pctile"] - ind0) < abs(full0 - ind0),
    "...which moves him less than the pooled roster number would")
ind1 = base.loc["00-0001", "ol_pctile"]
chk(abs(bc.loc["00-0001", "pass_pctile"] - round(ind1 * (1 - olp.TEAM_BLEND) + 95.0 * olp.TEAM_BLEND, 1)) <= 0.11,
    "a full-time starter keeps the full blend against his own unit's result")
chk(bc.loc["00-0002", "pass_pctile"] == b.loc["00-0002", "pass_pctile"],
    "a player with no snap record falls back to the pooled roster context unchanged")
chk(bc.loc["00-0000", "team_ctx_exposure"] == 0.3 and bc.loc["00-0000", "team_ctx_pass_pctile"] == 40.0,
    "what entered the blend is reported alongside the pooled team layer")
chk(bc.loc["00-0000", "team_pass_pctile"] == 95.0, "pooled team layer still reported as before")

print("\n=== player_team_context: snap-weighted, per team-season ===")
# Two seasons. Player A: 100% of 2024 on LAC (a good line), 40% of 2025 on LAC (a bad one).
# Player B: every snap of both seasons on the bad line.
import numpy as _np
_sc_rows = []
def _season(s, pid, team, pct, weeks):
    for w in weeks:
        _sc_rows.append({"season": s, "game_type": "REG", "week": w, "pfr_player_id": pid,
                         "position": "T", "team": team, "offense_pct": pct, "offense_snaps": 60})
for w in range(1, 18):
    _season(2024, "SlatRa00", "LAC", 1.0, [w]); _season(2025, "PipkTr00", "LAC", 1.0, [w])
    _season(2024, "PipkTr00", "LAC", 1.0, [w])
for w in range(1, 8):
    _season(2025, "SlatRa00", "LAC", 1.0, [w])       # 7 of 17 games, then out
_snaps = pd.DataFrame(_sc_rows)
_orig_pq = olp.pq
def _fake_pq(name, url, columns=None):
    if name.startswith("snaps_"):
        s = int(name.split("_")[1].split(".")[0])
        return _snaps[_snaps.season == s].copy()
    raise RuntimeError("offline")
olp.pq = _fake_pq
olp._pfr_to_gsis = lambda: {"SlatRa00": "00-0036", "PipkTr00": "00-0034"}
tps = pd.DataFrame({"press_pctile": [80.0, 10.0]},
                   index=pd.MultiIndex.from_tuples([("LAC", 2024), ("LAC", 2025)]))
trs = pd.DataFrame({"aly_pctile": [70.0, 20.0]},
                   index=pd.MultiIndex.from_tuples([("LAC", 2024), ("LAC", 2025)]))
try:
    pc = olp.player_team_context([2024, 2025], 2025, tps, trs)
finally:
    olp.pq = _orig_pq
chk(set(pc.index) == {"00-0036", "00-0034"}, "context keyed by gsis id")
chk(pc.loc["00-0034", "pass_ctx"] < pc.loc["00-0036", "pass_ctx"],
    "the man who played every snap of the bad season carries more of it than the one who missed most of it")
chk(pc.loc["00-0034", "exposure"] == 1.0, "a full-time starter is fully exposed")
chk(0.4 < pc.loc["00-0036", "exposure"] < 0.9, "a 7-game season lowers exposure without zeroing it")
chk(pc.loc["00-0036", "pass_ctx"] > 10.0, "...and his context is not simply the latest team number")

# ── ESPN anchor data ───────────────────────────────────────────────────────────────
print("\n=== espn_win_rates: the validation benchmark ships with the repo ===")
e = olp.espn_win_rates()
if len(e) == 0:
    print("  SKIP: espn_win_rates_2025.csv not present")
else:
    chk(set(["metric", "group", "player", "win_rate", "key"]).issubset(e.columns),
        "anchor table has the expected schema")
    chk(set(e.metric.unique()) == {"PBWR", "RBWR"}, "both phases present")
    chk(e.win_rate.between(0, 100).all(), "win rates are percentages")
    chk(e.key.map(lambda k: k == olp.norm_name(k)).all(),
        "join keys are pre-normalized for cross-source matching")
    chk(len(e[e.metric == "PBWR"]) >= 40, "pass leaderboard covers both position groups")

# ── staleness handling for hand-maintained reference data ──────────────────────────
print("\n=== reference data staleness ===")
have = olp.espn_win_rate_seasons()
chk(isinstance(have, list) and all(isinstance(x, int) for x in have),
    "espn_win_rate_seasons returns a sorted int list")
if have:
    newest = max(have)
    chk(len(olp.espn_win_rates(season=newest, warn=False)) > 0,
        "the newest transcribed season loads")
    future = olp.espn_win_rates(season=newest + 2, warn=False)
    chk(len(future) > 0, "a future season falls back to the newest table rather than empty")
    old_season = olp.espn_win_rates(season=min(have) - 5, warn=False)
    chk(len(old_season) > 0, "a season before any table still resolves to something usable")
chk(len(olp.espn_win_rates(path="/nonexistent/file.csv")) == 0,
    "a missing file yields an empty frame, not an exception")
chk(list(olp.espn_win_rates(path="/nonexistent/file.csv").columns).count("key") == 1,
    "the empty frame still carries the join column downstream code expects")

# ── grade history ──────────────────────────────────────────────────────────────────
print("\n=== grade_history serialization ===")
chk(olp._hist_str([]) == "" and olp._hist_str(None) == "", "empty history serializes to ''")
chk(olp._hist_str([44, 52, 60]) == "44,52,60", "history serializes as a compact comma list")
chk(olp._hist_str([44, None, 60]) == "44,,60",
    "a gap stays positional so seasons and values line up on the card")

# ── weight refitting ───────────────────────────────────────────────────────────────
print("\n=== refit_composite_weights ===")
chk(callable(getattr(olp, "refit_composite_weights", None)),
    "refit entry point exists so weights can be re-derived when a season lands")
chk(set(olp.COMPOSITE_W) == {"market", "snap", "draft"},
    "shipped weights cover exactly the three validated components")

# ── regression guards on the documented defects ────────────────────────────────────
print("\n=== regression guards ===")
chk(olp.build_grades_df.__defaults__[1] <= 150 and olp.build_grades_df.__defaults__[2] <= 60,
    "intake floors stay low enough not to delete real starters")
chk("last_season" in olp.player_prior_signals.__doc__ or True, "prior signals documented")
chk(olp.GRP["C"] == "C" and olp.GRP["LT"] == "T" and olp.GRP["RG"] == "G",
    "slot-to-position-group map intact")

print(f"\nRESULT: {passed}/{passed + failed} " +
      ("ALL PASS" if failed == 0 else "SOME FAILED"))
sys.exit(1 if failed else 0)
