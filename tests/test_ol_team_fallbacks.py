"""The team O-line tables early in a season: a composite score over the components that
exist (PFR's pressure, hurry and pocket time post days after the games), never NaN because
one column is still empty."""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "nflverse"))
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


print("=== _weighted_pct_score: the weights renormalize over what exists ===")
df = pd.DataFrame({
    "Pressure Rate": [np.nan] * 4,          # PFR not posted yet: the whole column is empty
    "Sack Rate": [2.0, 4.0, 6.0, 8.0],      # counted from play-by-play: lower is better
    "Hit Rate": [1.0, np.nan, 3.0, 4.0],    # one team's value missing
}, index=list("ABCD"))
s = nv._weighted_pct_score(df, [("Pressure Rate", True, 0.3), ("Sack Rate", True, 0.2), ("Hit Rate", True, 0.1)])
chk(s.notna().all(), "an all-empty component drops out: every team still gets a score")
chk(s["A"] > s["C"] > s["D"], "the team allowing the fewest sacks and hits scores highest")
chk(abs(s["B"] - 50.0) < 1e-9, "a team missing one value is scored on its other components alone (B: sack rank only → 50)")
# A: sack pct 25 → 75 (lower better), hit pct 33.3 → 66.7; weighted (75·.2 + 66.7·.1)/.3 = 72.2
chk(abs(s["A"] - (75 * 0.2 + (100 - 100 / 3) * 0.1) / 0.3) < 1e-6, "the weights renormalize over the components a team has")
chk(nv._weighted_pct_score(df, [("Pressure Rate", True, 1.0)]).isna().all(), "nothing to score → NaN, not zero")
hi = nv._weighted_pct_score(df, [("Sack Rate", False, 1.0)])
chk(hi["D"] > hi["A"], "a higher-is-better component ranks the other way")

print("\n=== the pass-protection composite reads it ===")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "nflverse", "nflverse.py")).read()
chk("pass_score = _weighted_pct_score(out, [" in src, "_ol_pass_metrics builds Pass Score from the renormalized composite")
chk('if _empty("Hit Rate") and "qb_hit" in db.columns' in src and 'if _empty("Blitz Rate")' in src,
    "hit and blitz rates fall back to pbp/FTN when PFR's column is present but empty")
chk('if _empty("Yards/Rush")' in src and 'if _empty("Rush 1D Rate")' in src,
    "yards per rush and rush first-down rate fall back to the play-by-play")
chk("pressed = hit | (d[\"sack\"] == 1)" in src, "no-blitz pressure uses the hit-or-sack proxy when participation is gone")
chk("first_down_rush" in nv.PBP_COLS, "the play-by-play load carries first_down_rush, so the Rush 1D fallback has its column")
i = src.index("def _ol_grades_by_player"); body = src[i:i + 4000]
chk(all(f'"{c}"' in body for c in ("rookie_prior", "p_college", "draft_year")), "the OL payload reads the pre-snap flag, the college prior and the class from the grades CSV")
chk("(valid_slot | rookie)" in src and 'g.loc[rookie & ~valid_slot, "slot"] = ""' in src, "a pre-snap row with no slot rides through the payload's slot filter on its flag")

print(f"\nRESULT: {P}/{P + F} {'ALL PASS' if F == 0 else 'SOME FAILED'}")
sys.exit(0 if F == 0 else 1)
