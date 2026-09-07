#!/usr/bin/env python3
"""Per-opponent draft tendencies, harvested from every real draft a manager has done.

The playbook's survival odds hinge on the three specific people picking between
your turns, but the sim gives every opponent the same ADP-plus-drift brain. This
tool asks whether individual managers have measurable, *transferable* tendencies
— and only what transfers earns a seat in the sim.

The n=5 problem and its fix: one league gives one draft per manager per year.
But `/user/{uid}/drafts/nfl/{season}` lists EVERY league draft that user did
that season, all public, all with full pick logs (mocks are invisible to the
API and mostly autopicker noise anyway — real drafts are both bigger and
better data). A typical multi-league opponent yields dozens of real drafts.

The study is a TRANSFER test. v1 (2026-09-07, 18 manager-seasons) failed all
three of its gates — but two design flaws confounded it: a manager's OTHER-
format drafts predicted their target-format behavior (superflex QB timing
polluting 1QB predictions), and the R1-R2 opening pair is slot-driven (what
you do picking 1st vs 12th differs regardless of who you are). v2, pre-
registered here before its first run, fixes exactly those two and nothing
else — same thresholds, no tuning:
  1. Reach: a manager's mean reach (consensus round minus their pick round,
     positive = takes players early) in their other SAME-FORMAT drafts, vs
     their reach in the target league. PASS: Spearman r >= +0.25, n >= 12.
  2. QB timing: predict the round of their first QB from their other
     same-format drafts; baseline predicts the format's mean. PASS: the
     profile beats the baseline in >= 60% of manager-seasons (n >= 10).
  3. RB early share (slot-invariant, replaces the opening pair): share of
     the manager's first 8 picks spent on RB, predicted from their other
     same-format drafts vs the format's mean. PASS: beats baseline in
     >= 60% (n >= 10). The opening pair stays in the report as color only.
Dynasty startups are their own market: the format bucket gains a "-dyn"
suffix when the league is dynasty (settings.type == 2), so startup rooms
never share a consensus or a baseline with redraft rooms.
v2 ran 2026-09-07: 7 eligible manager-seasons — format matching (correct)
collapsed the sample; qb_timing beat its baseline 7/7 but n < 10. Verdict:
underpowered, not null. v3, pre-registered here before its first run, changes
the DESIGN's power, not the thresholds: split-half reliability. For each
(manager, format) with >= 4 non-autodraft drafts, the drafts are split
even/odd by date; the halves' means are correlated across units. A stable
personal tendency shows r > 0; the format-mean baseline is exactly r = 0.
PASS per measure (reach, first_qb, rb_share8): Spearman r >= +0.25 with
n >= 12 units. Only PASSing measures get wired into draft_sim's opponents
(reach additionally shrunk toward 0 by sample size); the `study` command
still reports the v2 target-league transfer alongside. Failing measures
die here, in public.

Consensus is self-consistent, like draft_corpus: a player's expected slot is
his mean normalized round across the harvested drafts of that season+format,
so nothing depends on knowing what national ADP said years ago. Pick numbers
normalize to continuous rounds ((pick_no-1)/teams + 1) so 10- and 12-team
rooms compare. Rookie-only dynasty drafts (rounds < 10) are excluded — a
5-round rookie draft is a different game from a startup or redraft.

Autodraft guard: a draft where the manager's mean |reach| over their first 10
picks is under 0.15 rounds (~2 picks in a 12-team room) reads as the clock
picking from the default queue, and is dropped from their profile.

Usage:
  python3 tools/manager_profile.py crawl --league <id> [--seasons 2021-2026] \
      [--out cache/managers_<league>.json]
  python3 tools/manager_profile.py study --data cache/managers_<league>.json
  python3 tools/manager_profile.py report --data cache/managers_<league>.json

Stdlib-only, shares the corpus fetch cache (cache/corpus/).
"""
import argparse
import json
import os
import statistics
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import draft_corpus as dc      # noqa: E402  (fetch cache + fmt_of live there)

API = "https://api.sleeper.app/v1"
MIN_TEAMS, MAX_TEAMS = 8, 14
MIN_ROUNDS = 10                # < 10 rounds = dynasty rookie draft; different game
AUTODRAFT_ABS_REACH = 0.15     # mean |reach| (rounds) under this = default-queue suspect
MIN_OBS_FOR_CONSENSUS = 3      # a player's consensus slot needs >= 3 sightings


# ── pure helpers (unit-tested; no network) ──────────────────────────────────

def norm_round(pick_no, teams):
    """Continuous round number: pick 1 -> 1.0, last pick of R1 in a 12-teamer
    -> ~1.92. Makes 10- and 12-team rooms comparable."""
    return (pick_no - 1) / teams + 1.0


def build_consensus(drafts):
    """pid -> mean normalized round, per (season, format) bucket, from the
    harvested drafts themselves. Returns {(season,fmt): {pid: (mean, n)}}."""
    obs = defaultdict(lambda: defaultdict(list))
    for d in drafts:
        key = (str(d["season"]), d["format"])
        for p in d["picks"]:
            obs[key][p["pid"]].append(norm_round(p["no"], d["teams"]))
    out = {}
    for key, players in obs.items():
        out[key] = {pid: (statistics.fmean(v), len(v)) for pid, v in players.items()}
    return out


def manager_picks(draft, uid):
    """This manager's picks in draft order (picked_by attribution)."""
    return [p for p in draft["picks"] if p.get("by") == uid]


def draft_features(draft, uid, consensus):
    """One manager's tendency read from one draft. None if they made no picks
    (an orphaned team) or the draft smells like autodraft."""
    mine = manager_picks(draft, uid)
    if len(mine) < 5:
        return None
    teams = draft["teams"]
    key = (str(draft["season"]), draft["format"])
    cons = consensus.get(key, {})
    reaches = []
    for p in mine[:10]:
        c = cons.get(p["pid"])
        if c and c[1] >= MIN_OBS_FOR_CONSENSUS:
            reaches.append(c[0] - norm_round(p["no"], teams))
    reach_mean = statistics.fmean(reaches) if len(reaches) >= 4 else None
    autodraft = reach_mean is not None and statistics.fmean(
        abs(r) for r in reaches) < AUTODRAFT_ABS_REACH
    first_round = {}
    for p in mine:
        pos = p["pos"]
        if pos and pos not in first_round:
            first_round[pos] = norm_round(p["no"], teams)
    open_pair = "-".join(p["pos"] or "?" for p in mine[:2])
    early = mine[:8]
    rb_share8 = sum(1 for p in early if p["pos"] == "RB") / len(early) if len(early) >= 6 else None
    return {
        "draft": draft["draft"], "league": draft["league"],
        "season": str(draft["season"]), "format": draft["format"],
        "open_pair": open_pair,
        "first_qb": first_round.get("QB"),
        "first_te": first_round.get("TE"),
        "rb_share8": rb_share8,
        "reach": reach_mean,
        "n_reach_obs": len(reaches),
        "autodraft": autodraft,
    }


def spearman(xs, ys):
    """Rank correlation, stdlib-only (Pearson on ranks, mean-rank ties)."""
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    dx = sum((a - mx) ** 2 for a in rx) ** 0.5
    dy = sum((b - my) ** 2 for b in ry) ** 0.5
    return num / (dx * dy) if dx and dy else 0.0


def transfer_rows(feats_by_manager, target_league_ids):
    """For every manager-season with a target-league draft AND >= 2 other
    (non-autodraft) drafts: (uid, season, others[], target). The study's unit."""
    rows = []
    for uid, feats in feats_by_manager.items():
        by_season = defaultdict(list)
        for f in feats:
            by_season[f["season"]].append(f)
        for season, fs in by_season.items():
            tgt = [f for f in fs if str(f["league"]) in target_league_ids]
            # v2: only SAME-FORMAT evidence transfers — a superflex habit says
            # nothing about a 1QB room, and v1 proved it the hard way.
            oth = [f for f in fs if str(f["league"]) not in target_league_ids
                   and not f["autodraft"] and tgt and f["format"] == tgt[0]["format"]]
            if tgt and len(oth) >= 2:
                rows.append({"uid": uid, "season": season,
                             "others": oth, "target": tgt[0]})
    return rows


def splithalf_units(feats_by_manager, min_drafts=4):
    """v3 units: (manager, format) -> (half1 feats, half2 feats), split even/odd
    over the manager's same-format non-autodraft drafts ordered by season+draft id."""
    units = []
    for uid, feats in feats_by_manager.items():
        by_fmt = defaultdict(list)
        for f in feats:
            if not f["autodraft"]:
                by_fmt[f["format"]].append(f)
        for fmt, fs in by_fmt.items():
            if len(fs) < min_drafts:
                continue
            fs = sorted(fs, key=lambda f: (f["season"], f["draft"]))
            units.append({"uid": uid, "format": fmt,
                          "h1": fs[0::2], "h2": fs[1::2]})
    return units


def run_splithalf(units):
    """Split-half reliability per measure: mean(half1) vs mean(half2) across
    units. r=0 is exactly the format-mean baseline; r>=0.25 with n>=12 PASSes."""
    out = {}
    for key in ("reach", "first_qb", "rb_share8"):
        xs, ys = [], []
        for u in units:
            a = [f.get(key) for f in u["h1"] if f.get(key) is not None]
            b = [f.get(key) for f in u["h2"] if f.get(key) is not None]
            if a and b:
                xs.append(statistics.fmean(a)); ys.append(statistics.fmean(b))
        r = spearman(xs, ys) if len(xs) >= 5 else None
        out[key] = {"n": len(xs), "spearman": r,
                    "pass": r is not None and len(xs) >= 12 and r >= 0.25}
    return out


def run_study(rows):
    """The three pre-registered measures. Returns the verdicts dict."""
    out = {}
    # 1. Reach transfer
    xs, ys = [], []
    for r in rows:
        o = [f["reach"] for f in r["others"] if f["reach"] is not None]
        t = r["target"]["reach"]
        if o and t is not None:
            xs.append(statistics.fmean(o)); ys.append(t)
    r_reach = spearman(xs, ys) if len(xs) >= 5 else None
    out["reach"] = {"n": len(xs), "spearman": r_reach,
                    "pass": r_reach is not None and len(xs) >= 12 and r_reach >= 0.25}
    # 2. QB timing transfer vs format-mean baseline
    fmt_mean = defaultdict(list)
    for r in rows:
        for f in r["others"] + [r["target"]]:
            if f["first_qb"] is not None:
                fmt_mean[f["format"]].append(f["first_qb"])
    fmt_mean = {k: statistics.fmean(v) for k, v in fmt_mean.items()}
    wins = tries = 0
    for r in rows:
        o = [f["first_qb"] for f in r["others"] if f["first_qb"] is not None]
        t, fmt = r["target"]["first_qb"], r["target"]["format"]
        if o and t is not None and fmt in fmt_mean:
            profile_err = abs(statistics.fmean(o) - t)
            base_err = abs(fmt_mean[fmt] - t)
            if profile_err != base_err:
                tries += 1
                wins += profile_err < base_err
    out["qb_timing"] = {"n": tries, "profile_beats_baseline": (wins / tries) if tries else None,
                        "pass": tries >= 10 and wins / tries >= 0.60}
    # 3. RB early share (slot-invariant) vs the format's mean, same MAE contest
    fmt_rb = defaultdict(list)
    for r in rows:
        for f in r["others"] + [r["target"]]:
            if f.get("rb_share8") is not None:
                fmt_rb[f["format"]].append(f["rb_share8"])
    fmt_rb = {k: statistics.fmean(v) for k, v in fmt_rb.items()}
    wins3 = tries3 = 0
    for r in rows:
        o = [f["rb_share8"] for f in r["others"] if f.get("rb_share8") is not None]
        t, fmt = r["target"].get("rb_share8"), r["target"]["format"]
        if o and t is not None and fmt in fmt_rb:
            pe, be = abs(statistics.fmean(o) - t), abs(fmt_rb[fmt] - t)
            if pe != be:
                tries3 += 1
                wins3 += pe < be
    out["rb_share8"] = {"n": tries3, "profile_beats_baseline": (wins3 / tries3) if tries3 else None,
                        "pass": tries3 >= 10 and wins3 / tries3 >= 0.60}
    return out


# ── crawl (network; cached) ─────────────────────────────────────────────────

def crawl(args):
    seasons = _parse_seasons(args.seasons)
    target_ids = set()
    managers = {}
    for lid in args.league:
        lg = dc.fetch(f"{API}/league/{lid}", f"league_{lid}.json")
        if not lg:
            print(f"  league {lid}: unreachable"); continue
        target_ids.add(str(lid))
        # walk the chain so older seasons of the SAME room count as target too
        prev = lg.get("previous_league_id")
        while prev:
            target_ids.add(str(prev))
            plg = dc.fetch(f"{API}/league/{prev}", f"league_{prev}.json") or {}
            prev = plg.get("previous_league_id")
        for u in dc.fetch(f"{API}/league/{lid}/users", f"users_{lid}.json") or []:
            if u.get("user_id"):
                managers[u["user_id"]] = u.get("display_name") or u.get("username") or u["user_id"]
    print(f"target room ids: {len(target_ids)} · managers: {len(managers)}")

    drafts, seen = [], set()
    for uid, name in managers.items():
        kept = 0
        for season in seasons:
            for d in dc.fetch(f"{API}/user/{uid}/drafts/nfl/{season}",
                              f"udrafts_{uid}_{season}.json") or []:
                did = d.get("draft_id")
                lid = d.get("league_id")
                st = d.get("settings") or {}
                if (not did or did in seen or d.get("status") != "complete"
                        or d.get("type") != "snake" or not lid):
                    continue
                teams, rounds = st.get("teams") or 0, st.get("rounds") or 0
                if not (MIN_TEAMS <= teams <= MAX_TEAMS) or rounds < MIN_ROUNDS:
                    continue
                seen.add(did)
                lg = dc.fetch(f"{API}/league/{lid}", f"league_{lid}.json") or {}
                picks = dc.fetch(f"{API}/draft/{did}/picks", f"picks_{did}.json")
                if not picks or len(picks) < teams * MIN_ROUNDS:
                    continue
                rows = [{"no": p.get("pick_no"), "pid": str(p.get("player_id")),
                         "pos": ((p.get("metadata") or {}).get("position") or ""),
                         "by": p.get("picked_by")}
                        for p in picks if p.get("pick_no")]
                drafts.append({"draft": did, "league": str(lid), "season": str(season),
                               "teams": teams, "rounds": rounds,
                               "format": dc.fmt_of(lg) + ("-dyn" if (lg.get("settings") or {}).get("type") == 2 else ""),
                               "picks": sorted(rows, key=lambda r: r["no"])})
                kept += 1
        print(f"  {name}: {kept} drafts", flush=True)
    out = {"target_league_ids": sorted(target_ids),
           "managers": managers, "drafts": drafts}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f)
    print(f"kept {len(drafts)} drafts -> {args.out}")


def _parse_seasons(spec):
    if "-" in spec:
        a, b = spec.split("-", 1)
        return list(range(int(a), int(b) + 1))
    return [int(s) for s in spec.split(",")]


def _features(data):
    consensus = build_consensus(data["drafts"])
    feats = defaultdict(list)
    for d in data["drafts"]:
        for uid in data["managers"]:
            f = draft_features(d, uid, consensus)
            if f:
                feats[uid].append(f)
    return feats


def study(args):
    data = json.load(open(args.data))
    feats = _features(data)
    rows = transfer_rows(feats, set(data["target_league_ids"]))
    print(f"v2 target-league transfer — manager-seasons eligible: {len(rows)}")
    for name, v in run_study(rows).items():
        print(f"  {name}: {json.dumps(v)}")
    units = splithalf_units(feats)
    print(f"v3 split-half reliability — (manager,format) units: {len(units)}")
    verdicts = run_splithalf(units)
    for name, v in verdicts.items():
        print(f"  {name}: {json.dumps(v)}")
    passing = [k for k, v in verdicts.items() if v["pass"]]
    print(f"PASSING (earn a seat in draft_sim): {passing or 'none'}")


def report(args):
    data = json.load(open(args.data))
    feats = _features(data)
    print(f"{'manager':22} {'drafts':>6} {'auto':>4} {'reach':>7} {'1st QB rd':>9}  favorite open")
    for uid, name in sorted(data["managers"].items(), key=lambda kv: kv[1].lower()):
        fs = [f for f in feats.get(uid, [])]
        good = [f for f in fs if not f["autodraft"]]
        reaches = [f["reach"] for f in good if f["reach"] is not None]
        qbs = [f["first_qb"] for f in good if f["first_qb"] is not None]
        pairs = Counter(f["open_pair"] for f in good)
        print(f"{name[:22]:22} {len(fs):>6} {sum(f['autodraft'] for f in fs):>4} "
              f"{(f'{statistics.fmean(reaches):+.2f}' if reaches else '—'):>7} "
              f"{(f'{statistics.fmean(qbs):.1f}' if qbs else '—'):>9}  "
              f"{pairs.most_common(1)[0][0] if pairs else '—'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crawl"); c.add_argument("--league", action="append", required=True)
    c.add_argument("--seasons", default="2021-2026")
    c.add_argument("--out", default=os.path.join(HERE, "..", "cache", "managers.json"))
    c.set_defaults(fn=crawl)
    s = sub.add_parser("study"); s.add_argument("--data", required=True); s.set_defaults(fn=study)
    r = sub.add_parser("report"); r.add_argument("--data", required=True); r.set_defaults(fn=report)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
