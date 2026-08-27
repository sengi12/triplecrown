#!/usr/bin/env python3
"""Re-score every college profile's fantasy-relevance number from the current
src/cfb/prospect_model.json — the fast loop for tweaking weights.

    edit src/cfb/prospect_model.json
    python3 tools/prospect_rescore.py            # rewrites seeds/triplecrown_seed.json (+ .gz)
    python3 bake_seed.py --seed seeds/triplecrown_seed.json --out index_ui_preview.html

Only `prob` is recomputed (from each player's already-baked pick/age/stats); the combine
percentile bars are data, not model, and stay untouched. Requires no pandas.
"""
import gzip, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from src.cfb import combine

SEED = "seeds/triplecrown_seed.json"
j = json.load(open(SEED))
players = (j.get("cfb") or {}).get("players") or {}
n = changed = 0
for pid, prof in players.items():
    pr = prof.get("prospect")
    if not pr:
        continue
    n += 1
    st = pr.get("stats") or {}
    prob = combine.score(prof.get("pos"), pr.get("pick") or combine.UNDRAFTED_PICK,
                         pr.get("age"), st.get("forty"), st.get("wt"),
                         st.get("vertical"), st.get("broad_jump"), pr.get("x") or {})
    pctl = combine.pctl_of(prof.get("pos"), prob)
    if prob != pr.get("prob") or pctl != pr.get("pctl"):
        pr["prob"] = prob
        pr["pctl"] = pctl
        changed += 1
json.dump(j, open(SEED, "w"), separators=(",", ":"))
blob = open(SEED, "rb").read()
open(SEED + ".gz", "wb").write(gzip.compress(blob, compresslevel=9, mtime=0))
print(f"re-scored {n} profiles ({changed} changed) -> {SEED} (+.gz)")
print("preview: python3 bake_seed.py --seed seeds/triplecrown_seed.json --out index_ui_preview.html")
