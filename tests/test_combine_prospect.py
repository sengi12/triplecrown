#!/usr/bin/env python3
"""Offline tests for the prospect fantasy-relevance model (src/cfb/combine.py).

The scoring path is pure math over frozen artifacts (prospect_model.json), so it runs
without pandas; the data-touching functions lazy-import pandas and are covered by the
seed build itself."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from src.cfb import combine

passed = failed = 0
def chk(c, label):
    global passed, failed
    if c: passed += 1; print("  PASS:", label)
    else: failed += 1; print("  FAIL:", label)

print("=== calibrated scoring (frozen artifacts) ===")
p_elite = combine.score('RB', 5, 21, 4.45, 220, 38, 124)
p_mid   = combine.score('RB', 90, 23, 4.60, 210, 33, 117)
p_late  = combine.score('RB', 250, 24, 4.70, 205, 31, 113)
chk(0.80 <= p_elite <= 0.99, f"elite RB archetype scores high ({p_elite:.2f})")
chk(combine.pctl_of('RB', p_elite) >= 95, f"…and lands in the top percentiles ({combine.pctl_of('RB', p_elite)})")
chk(combine.pctl_of('RB', 0.02) <= 40, "a low probability maps to a low percentile")
p_qb_good = combine.score('QB', 10, 21.5, 4.6, 220, 36, 122, {'f_succ':52, 'f_comp_pct':70})
p_qb_bad  = combine.score('QB', 10, 21.5, 4.6, 220, 36, 122, {'f_succ':38, 'f_comp_pct':55})
chk(p_qb_good > p_qb_bad, f"QB college efficiency moves the needle ({p_qb_good:.2f} vs {p_qb_bad:.2f})")
p_te = combine.score('TE', 20, 22, 4.6, 250, 35, 120, {'dom_teamadj':30, 'f_yptpa':2.4})
chk(p_te is not None and 0.01 <= p_te <= 0.97, f"TE extras path scores, certainty-capped ({p_te:.2f})")
chk(p_elite > p_mid > p_late, "probability falls monotonically with draft capital")
chk(p_late < 0.12, f"day-3 RB scores like the base rates say ({p_late:.2f})")
p_udfa = combine.score('WR', combine.UNDRAFTED_PICK, 23, 4.50, 200, 36, 122)
chk(p_udfa is not None and p_udfa < 0.10, f"undrafted pick sentinel scores low ({p_udfa:.2f})")

print("=== missing drills use medians + flags, never crash ===")
p_nodrills = combine.score('WR', 20, 21.5, None, None, None, None)
chk(p_nodrills is not None and 0 < p_nodrills < 1, f"no combine at all still scores ({p_nodrills:.2f})")
chk(combine.score('K', 30, 22, 4.6, 200, 35, 120) is None, "unmodeled position returns None")

print("=== every position has artifacts + sane base rates ===")
m = combine._model()
for pos in ('QB','RB','WR','TE'):
    a = m.get(pos) or {}
    chk(bool(a.get('coef')) and bool(a.get('iso')), f"{pos} artifacts present")
    chk(0.05 < a.get('base_rate', 0) < 0.40, f"{pos} base rate plausible ({a.get('base_rate')})")

print("=== percentile orientation ===")
vals = [4.30, 4.40, 4.50, 4.60, 4.70]
chk(combine._percentile(vals, 4.30, True)  > 80, "fastest 40 → high percentile (lower is better)")
chk(combine._percentile(vals, 4.70, True)  < 20, "slowest 40 → low percentile")
chk(combine._percentile([30,33,36,39,42], 42, False) > 80, "highest vert → high percentile")
chk(combine._percentile(vals, 4.50, True) == 50, "midrank lands at 50")

print("=== height parsing ===")
chk(combine._ht_inches('6-2') == 74, "6-2 → 74 in")
chk(combine._ht_inches(74) == 74, "numeric passthrough")
chk(combine._ht_inches('junk') is None and combine._ht_inches(None) is None, "garbage → None")

print(f"\nRESULT: {passed}/{passed+failed} {'ALL PASS' if failed==0 else 'SOME FAILED'}")
sys.exit(0 if failed == 0 else 1)
