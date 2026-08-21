#!/usr/bin/env python3
"""
percentiles.py — turn college production into a percentile against the same position's prospects
────────────────────────────────────────────────────────────────────────────────────────────────
A rookie's college line means nothing on its own. "32% dominator rating" is only informative
against the distribution of every other drafted receiver's final college season, and "0.081
EPA per dropback" is only informative against other drafted quarterbacks.

So this builds a REFERENCE POOL from the 2018-2025 draft classes — enumerated out of nflverse
draft_picks, linked to CFBD by src/cfb/link.py, and measured by src/cfb/cfbfastr.py — and
reduces it to percentile cut points. The pool is the expensive part and the cut points are
tiny, which is the whole point: roughly 600 numbers ship in the seed instead of eight years of
college play-by-play.

WHY THE FINAL COLLEGE SEASON
    One row per prospect, and it's the season that actually got them drafted. Pooling every
    season a player ever played would trip over the same players appearing three times and
    would mix true-freshman usage in with a senior's.

WHY DRAFTED PLAYERS ONLY
    draft_picks has no undrafted players, so the reference class is "drafted skill players".
    That is the right comparison set anyway: it's the population a current rookie belongs to,
    not the population of everyone who ever played a college snap.

Usage:
    python -m src.cfb.percentiles            # build cut points, print the distributions
"""
import json
import os
import sys
import time

from src.cfb import cfbfastr, link

SCHEMA = "cfb_percentiles_v1"

# Draft classes that make up the reference pool. 2018 is the practical floor: CFBD's roster
# files thin out badly before then (2013 has 8.4k rows against 2025's 30k), so earlier classes
# would be measured against a pool with holes in it.
REFERENCE_FLOOR = 2018


def reference_classes(draft_class=None):
    """Draft classes making up the reference pool: the floor through the class before
    `draft_class`. Computed, not frozen, so the pool keeps growing as classes complete."""
    if draft_class is None:
        now = time.gmtime()
        # Jan/Feb still belong to the prior league year; the draft class matches the league year.
        draft_class = now.tm_year - 1 if now.tm_mon < 3 else now.tm_year
    return range(REFERENCE_FLOOR, max(REFERENCE_FLOOR + 1, int(draft_class)))

# Metrics ranked per position, and which direction is good. `False` means lower is better, so
# the percentile is inverted before it's stored — a low sack rate should read as a high score.
METRICS = {
    "QB": [("epa_play", True), ("succ", True), ("ypa", True), ("comp_pct", True),
           ("sack_pct", False), ("pass_td", True), ("rush_yds", True)],
    "RB": [("epa_play", True), ("succ", True), ("ypc", True), ("expl_rate", True),
           ("stuff_rate", False), ("rush_share", True), ("tgt_share", True)],
    "WR": [("dominator", True), ("tgt_share", True), ("yptpa", True), ("epa_play", True),
           ("succ", True), ("ypr", True), ("expl_rate", True)],
}
METRICS["TE"] = METRICS["WR"]

# Volume floors for pool membership. A receiver with four targets can post a gaudy rate that
# would distort every cut point above it.
MIN_VOLUME = {"QB": ("dropbacks", 100), "RB": ("rushes", 50),
              "WR": ("tgt", 25), "TE": ("tgt", 20)}

# Cut points every 5th percentile. Fine enough to interpolate against, small enough to ship.
STEPS = list(range(0, 101, 5))


def final_season(node):
    """The player's last college season block — their draft-year résumé."""
    seasons = node.get("seasons") or {}
    if not seasons:
        return None, None
    year = max(seasons, key=int)
    return year, seasons[year]


def qualifies(pos, block):
    field, floor = MIN_VOLUME.get(pos, (None, 0))
    return bool(block) and field and (block.get(field) or 0) >= floor


def _quantiles(values):
    """Cut points at every 5th percentile, by linear interpolation between order statistics."""
    vs = sorted(values)
    n = len(vs)
    out = []
    for p in STEPS:
        if n == 1:
            out.append(round(float(vs[0]), 4))
            continue
        pos = p / 100 * (n - 1)
        lo = int(pos)
        hi = min(lo + 1, n - 1)
        frac = pos - lo
        out.append(round(float(vs[lo] + (vs[hi] - vs[lo]) * frac), 4))
    return out


def build_reference(classes=None, refresh=False):
    """Cut points per position per metric, plus the pool size each was computed from."""
    classes = classes or reference_classes()
    path = os.path.join(link._cache_subdir("derived", "percentiles"),
                        f"{SCHEMA}_{min(classes)}_{max(classes)}.json")
    if os.path.exists(path) and not refresh:
        with open(path) as f:
            return json.load(f)

    # One combined link map, keyed by class so two classes can't collide on a gsis id, and one
    # pass over the college seasons all those classes draw on.
    links, seasons = {}, set()
    for cls in classes:
        for pid, l in link.build_draft_link_map(cls).items():
            if l.get("athlete_id") and not (l.get("method") or "").endswith("?"):
                links[f"{cls}:{pid}"] = l
        seasons.update(range(cls - 4, cls))
    print(f"  reference pool: {len(links)} linked prospects across {len(seasons)} college seasons")
    data = cfbfastr.build(links, sorted(seasons), refresh=refresh)

    pools = {}
    for key, node in data.items():
        pos = node.get("pos")
        if pos not in METRICS:
            continue
        _, block = final_season(node)
        if not qualifies(pos, block):
            continue
        for metric, _ in METRICS[pos]:
            v = block.get(metric)
            if v is not None:
                pools.setdefault(pos, {}).setdefault(metric, []).append(v)

    out = {"schema": SCHEMA, "classes": [min(classes), max(classes)], "steps": STEPS, "pos": {}}
    for pos, metrics in pools.items():
        out["pos"][pos] = {m: {"n": len(vs), "cuts": _quantiles(vs),
                               "higher_is_better": dict(METRICS[pos])[m]}
                           for m, vs in metrics.items()}
    with open(path, "w") as f:
        json.dump(out, f, sort_keys=True)
    return out


def rank(ref, pos, metric, value):
    """Percentile (0-100) of one value against the reference pool, already direction-corrected.

    Returns None when the metric isn't ranked for this position or the value is missing, so a
    caller can tell "no opinion" apart from "0th percentile".
    """
    node = ((ref.get("pos") or {}).get(pos) or {}).get(metric)
    if not node or value is None:
        return None
    cuts, steps = node["cuts"], ref["steps"]
    if value <= cuts[0]:
        pct = 0.0
    elif value >= cuts[-1]:
        pct = 100.0
    else:
        pct = float(steps[-1])
        for i in range(1, len(cuts)):
            if value <= cuts[i]:
                span = cuts[i] - cuts[i - 1]
                frac = 0 if span == 0 else (value - cuts[i - 1]) / span
                pct = steps[i - 1] + frac * (steps[i] - steps[i - 1])
                break
    return round(pct if node["higher_is_better"] else 100 - pct, 1)


def main():
    ref = build_reference(refresh=True)
    print()
    for pos in ("QB", "RB", "WR", "TE"):
        node = ref["pos"].get(pos)
        if not node:
            continue
        any_metric = next(iter(node.values()))
        print(f"  {pos}  (n={any_metric['n']})")
        for metric, _ in METRICS[pos]:
            m = node.get(metric)
            if not m:
                continue
            c = m["cuts"]
            arrow = "↑" if m["higher_is_better"] else "↓"
            print(f"    {metric:<12}{arrow}  p10={c[2]:<8} p25={c[5]:<8} p50={c[10]:<8} "
                  f"p75={c[15]:<8} p90={c[18]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
