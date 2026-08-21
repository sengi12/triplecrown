#!/usr/bin/env python3
"""
refresh_ol_seed.py — push new OL grades into an existing seed without a full rebuild.

WHY THIS EXISTS
    `build_seed.py` produces the whole seed, which takes a long time and touches every
    other block. When only the OL grading pipeline has changed, that is a lot of work and
    a lot of blast radius to ship one table. This merges the derived OL grades CSV into the
    `ol_players` map of a seed that already exists, leaving every other block untouched.

    It is a refresh, not a substitute: `build_seed.py` remains the source of truth and
    produces the same fields on its next full run. Use this to iterate on grades.

WHAT IT UPDATES
    Fields copied straight from the OL grades CSV (the model's own output), plus a
    recomputed `ol_weighted_*`, which is a utilization reweighting of the phase percentiles
    and would otherwise still reflect the grades it was computed from.

    Enrichment fields the seed already carries and this tool does not touch:
    pass_rate / run_rate (team pass utilization) and is_projected_starter, both of which
    come from the wider nflverse build rather than the OL CSV.

Usage:
    python tools/refresh_ol_seed.py                       # seeds/triplecrown_seed.json
    python tools/refresh_ol_seed.py --seed path/to.json --dry-run
"""
import argparse
import glob
import gzip
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "src", "nflverse"))

try:
    import pandas as pd
    from ol_grades_pipeline import norm_name, pct_to_letter
except Exception as e:
    print(f"error: needs the scientific stack ({type(e).__name__}: {e})", file=sys.stderr)
    print("       try: /Users/$(whoami)/.pyenv/shims/python3 tools/refresh_ol_seed.py",
          file=sys.stderr)
    sys.exit(2)

# Straight passthrough from the derived CSV to the seed payload. Mirrors the field list in
# nflverse.py::_ol_grades_by_player, so a full rebuild and a refresh agree.
CSV_FIELDS = [
    "name", "team", "slot", "pos",
    "ol_grade", "ol_pctile", "ol_conf",
    "pass_grade", "pass_pctile", "pass_conf", "pass_snaps",
    "run_grade", "run_pctile", "run_conf", "poa_carries",
    "team_pass_pctile", "team_run_pctile",
    "p_market", "p_snap", "p_draft", "snap_pct",
    "espn_pbwr", "espn_rbwr",
    "hist_seasons", "ol_pctile_hist", "market_pctile_hist",
    "shared_credit", "penalty_rate", "penalty_hold_rate", "penalty_fs_rate",
    "allpro_recent", "career_ap1", "career_pb", "consensus_flag", "market_pctile",
]


def latest_grades_csv(explicit=None):
    if explicit:
        return explicit
    pat = os.path.join(REPO, "cache", "nflverse", "derived", "ol_grades", "*.csv")
    hits = sorted(glob.glob(pat), key=os.path.getmtime, reverse=True)
    return hits[0] if hits else None


def clean(v):
    """JSON-safe scalar: NaN and pandas NA become None, numpy scalars become Python."""
    if v is None or (isinstance(v, float) and v != v):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "item"):
        v = v.item()
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", default=os.path.join(REPO, "seeds", "triplecrown_seed.json"))
    ap.add_argument("--grades-csv", default=None)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    csv = latest_grades_csv(a.grades_csv)
    if not csv or not os.path.exists(csv):
        print("error: no derived OL grades CSV found; run the pipeline first", file=sys.stderr)
        return 1
    if not os.path.exists(a.seed):
        print(f"error: seed not found: {a.seed}", file=sys.stderr)
        return 1

    g = pd.read_csv(csv)
    have = [c for c in CSV_FIELDS if c in g.columns]
    missing = [c for c in CSV_FIELDS if c not in g.columns]
    if "ol_grade" not in have:
        print("error: grades CSV has no ol_grade column — is it from the old pipeline?",
              file=sys.stderr)
        return 1
    if missing:
        print(f"  note: CSV lacks {len(missing)} optional field(s): {', '.join(missing)}")

    # nflverse team codes ("LA") differ from the seed's ("LAR"); normalize or a whole team
    # silently fails the downstream TEAMS filter.
    NFLVERSE_TO_SEED = {"LA": "LAR", "OAK": "LV", "SD": "LAC", "STL": "LAR"}
    if "team" in g.columns:
        g["team"] = (g["team"].astype(str).str.strip().str.upper()
                     .replace(NFLVERSE_TO_SEED))

    by_key = {}
    for _, r in g.iterrows():
        k = norm_name(r.get("name"))
        if not k:
            continue
        # Same tie-break as the payload layer: highest snap count wins a duplicate name.
        prev = by_key.get(k)
        if prev is not None and (clean(prev.get("pass_snaps")) or 0) >= (clean(r.get("pass_snaps")) or 0):
            continue
        by_key[k] = {c: clean(r.get(c)) for c in have}

    print(f"  grades CSV : {os.path.relpath(csv, REPO)}  ({len(by_key)} linemen)")

    with open(a.seed, "rb") as f:
        seed = json.loads(f.read())
    years = (seed.get("nflverse") or {}).get("years") or {}
    if not years:
        print("error: seed has no nflverse.years block", file=sys.stderr)
        return 1

    total_updated = total_seen = 0
    for season in sorted(years, reverse=True):
        blk = years[season]
        if not isinstance(blk, dict):
            continue
        op = blk.get("ol_players")
        if not isinstance(op, dict) or not op:
            continue
        updated = 0
        drop = []
        for key, rec in op.items():
            total_seen += 1
            src = by_key.get(key) or by_key.get(norm_name(rec.get("name")))
            if not src:
                continue

            # Scope each season to the players who were actually in the league. The grades
            # CSV is one pooled table, so a straight merge stamps everyone into every
            # season — Amarius Mims, a 2024 draftee, carried a graded 2021 on his card.
            hs = src.get("hist_seasons")
            if hs:
                played = [x.strip() for x in str(hs).split(",") if x.strip()]
                if played and str(season) not in played:
                    drop.append(key)
                    continue
            # Team and slot in the seed are season-specific; the CSV only knows the latest.
            for c, v in src.items():
                if c in ("team", "slot") and rec.get(c):
                    continue
                rec[c] = v

            # ol_weighted_* is a utilization reweighting of the phase percentiles, so it has
            # to move with them. pass_rate/run_rate come from the wider build and stay put.
            pw = rec.get("pass_rate")
            pw = 50.0 if pw is None else float(pw)
            pp = rec.get("pass_pctile")
            rp = rec.get("run_pctile")
            if pp is not None or rp is not None:
                pp = 50.0 if pp is None else float(pp)
                rp = 50.0 if rp is None else float(rp)
                w = max(0.0, min(100.0, pw)) / 100.0
                comp = w * pp + (1.0 - w) * rp
                rec["ol_weighted_pctile"] = round(comp, 2)
                rec["ol_weighted_grade"] = pct_to_letter(comp)
            # Entanglement was a plus-minus concept; the composite does not use it.
            rec.pop("entanglement_factor", None)
            rec.pop("team_context_weight", None)
            updated += 1
        for k in drop:
            op.pop(k, None)

        # Add linemen the seed never had. Until the team-code fix above, the Rams were
        # missing from every season, so a merge that only updates existing records would
        # leave them missing forever.
        added = 0
        for k, src in by_key.items():
            if k in op or not src.get("team"):
                continue
            hs = src.get("hist_seasons")
            if hs:
                played = [x.strip() for x in str(hs).split(",") if x.strip()]
                if played and str(season) not in played:
                    continue
            elif str(season) != str(max(years)):
                continue
            op[k] = dict(src)
            added += 1
        total_updated += updated
        graded = sum(1 for r in op.values() if r.get("ol_grade"))
        note = f", {len(drop)} removed (not in the league that season)" if drop else ""
        note += f", {added} added" if added else ""
        print(f"  season {season}: {updated} updated, {graded} carry ol_grade{note}")

    if a.dry_run:
        print(f"\ndry run — {total_updated}/{total_seen} records would be updated; nothing written")
        return 0

    blob = json.dumps(seed, separators=(",", ":")).encode()
    with open(a.seed, "wb") as f:
        f.write(blob)
    with open(a.seed + ".gz", "wb") as f:
        f.write(gzip.compress(blob, compresslevel=9, mtime=0))
    print(f"\nwrote {os.path.relpath(a.seed, REPO)} "
          f"({len(blob):,} bytes) + .gz — {total_updated}/{total_seen} records updated")
    print("note: index_baked.html embeds its own copy; re-run bake_seed.py to refresh it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
