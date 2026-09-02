#!/usr/bin/env python3
"""Harvest a corpus of real completed Sleeper drafts and measure our market
model against it.

Sleeper's public API is read-only — there is no supported way to sit a bot in
their mock-draft lobby. But every REAL draft's pick-by-pick log is public, and
real leagues are the distribution our opponents actually come from (mock lobbies
are mostly autopickers). So instead of borrowing Sleeper's bots, we fit ours:

  crawl:  seed league -> its users -> each user's other leagues -> their drafts
  keep:   completed snake drafts of the target season, bucketed by format
  fit:    where each player actually goes (mean pick) and how widely he ranges
          (the sigma curve our survival odds assume), K/DEF timing, QB volume
  score:  replay held-out drafts and Brier-score the survival predictions the
          app would have made, current model vs the refit

The corpus is self-consistent: a player's "ADP" here is his mean pick across
these drafts, so the fit never depends on knowing what national ADP said on
draft day.

Usage:
  python3 tools/draft_corpus.py crawl --league <id> [--league <id>] \
      --season 2026 --max-leagues 400 --out cache/corpus_2026.json
  python3 tools/draft_corpus.py fit --corpus cache/corpus_2026.json
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.request

API = "https://api.sleeper.app/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, "..", "cache", "corpus")
SLEEP = 0.12          # polite crawl pace; Sleeper's public API is generous but not ours to hammer


def fetch(url, cache_name):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    time.sleep(SLEEP)
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = json.load(r)
    except Exception:
        data = None
    with open(path, "w") as f:
        json.dump(data, f)
    return data


def fmt_of(league):
    """Coarse format bucket: what the room is buying decides which market it is."""
    rp = league.get("roster_positions") or []
    if "SUPER_FLEX" in rp or rp.count("QB") >= 2:
        return "superflex"
    rec = (league.get("scoring_settings") or {}).get("rec", 0) or 0
    return "ppr" if rec >= 0.9 else ("half" if rec >= 0.4 else "std")


def crawl(args):
    seen_leagues, seen_users, queue = set(), set(), list(args.league)
    corpus = {"season": args.season, "drafts": []}
    kept = 0
    while queue and len(seen_leagues) < args.max_leagues:
        lid = queue.pop(0)
        if lid in seen_leagues:
            continue
        seen_leagues.add(lid)
        lg = fetch(f"{API}/league/{lid}", f"league_{lid}.json")
        if not lg:
            continue
        if str(lg.get("season")) != str(args.season):
            continue
        # Expand through this league's managers to their other leagues.
        if len(seen_leagues) + len(queue) < args.max_leagues:
            for u in fetch(f"{API}/league/{lid}/users", f"users_{lid}.json") or []:
                uid = u.get("user_id")
                if not uid or uid in seen_users:
                    continue
                seen_users.add(uid)
                for other in fetch(f"{API}/user/{uid}/leagues/nfl/{args.season}",
                                   f"uleagues_{uid}_{args.season}.json") or []:
                    oid = other.get("league_id")
                    if oid and oid not in seen_leagues:
                        queue.append(oid)
        # Keep this league's completed snake drafts.
        teams = lg.get("total_rosters") or 0
        if teams < 8 or teams > 14:
            continue
        for d in fetch(f"{API}/league/{lid}/drafts", f"drafts_{lid}.json") or []:
            if d.get("status") != "complete" or d.get("type") != "snake":
                continue
            did = d.get("draft_id")
            picks = fetch(f"{API}/draft/{did}/picks", f"picks_{did}.json")
            if not picks or len(picks) < teams * 10:
                continue
            rows = [{"no": p.get("pick_no"), "pid": str(p.get("player_id")),
                     "pos": ((p.get("metadata") or {}).get("position") or "")}
                    for p in picks if p.get("pick_no")]
            corpus["drafts"].append({
                "league": lid, "draft": did, "teams": teams,
                "rounds": (d.get("settings") or {}).get("rounds"),
                "format": fmt_of(lg),
                "lineup": lg.get("roster_positions"),
                "picks": sorted(rows, key=lambda r: r["no"]),
            })
            kept += 1
        if kept and kept % 25 == 0:
            print(f"  {len(seen_leagues)} leagues visited, {kept} drafts kept", flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(corpus, f)
    from collections import Counter
    print(f"crawled {len(seen_leagues)} leagues -> kept {kept} drafts -> {args.out}")
    print("  by format:", dict(Counter(d['format'] for d in corpus['drafts'])))


# ── fit ──────────────────────────────────────────────────────────────────────
def sigma_current(adp):
    return max(3.5, min(24.0, 0.18 * adp))


def fit(args):
    corpus = json.load(open(args.corpus))
    drafts = [d for d in corpus["drafts"] if d["teams"] == args.teams] \
        if args.teams else corpus["drafts"]
    from collections import defaultdict, Counter
    by_fmt = defaultdict(list)
    for d in drafts:
        by_fmt[d["format"]].append(d)
    for fmt, ds in sorted(by_fmt.items(), key=lambda kv: -len(kv[1])):
        if len(ds) < args.min_drafts:
            continue
        print(f"\n=== {fmt}: {len(ds)} drafts ===")
        # Where each player goes, and how widely.
        picks_by_pid = defaultdict(list)
        for d in ds:
            for p in d["picks"]:
                if p["pos"] in ("QB", "RB", "WR", "TE"):
                    picks_by_pid[p["pid"]].append(p["no"])
        rows = [(sum(v) / len(v), v) for v in picks_by_pid.values() if len(v) >= args.min_obs]
        rows.sort(key=lambda r: r[0])
        print(f"  {len(rows)} players with >={args.min_obs} observations")
        print(f"  {'mean pick':>10} {'n':>5} {'observed sd':>12} {'our sigma':>10}")
        for lo, hi in ((1, 12), (13, 24), (25, 48), (49, 72), (73, 96), (97, 120), (121, 160)):
            bucket = [(m, v) for m, v in rows if lo <= m <= hi]
            if not bucket:
                continue
            n = sum(len(v) for _, v in bucket)
            var = sum(sum((x - m) ** 2 for x in v) for m, v in bucket) \
                / max(1, sum(len(v) - 1 for _, v in bucket))
            mid = sum(m for m, _ in bucket) / len(bucket)
            print(f"  {lo:>4}-{hi:<5} {n:>5} {math.sqrt(var):>12.1f} {sigma_current(mid):>10.1f}")
        # K/DEF timing: which round do they actually go?
        kd_round = Counter()
        kd_total = 0
        for d in ds:
            for p in d["picks"]:
                if p["pos"] in ("K", "DEF"):
                    kd_round[min(18, (p["no"] - 1) // d["teams"] + 1)] += 1
                    kd_total += 1
        if kd_total:
            tail = {r: round(100 * c / kd_total) for r, c in sorted(kd_round.items()) if c / kd_total >= 0.03}
            print(f"  K/DEF: {kd_total} picks, by round (%): {tail}")
        # QB volume per round — the drift calibration's ground truth.
        qb_round = Counter()
        for d in ds:
            for p in d["picks"]:
                if p["pos"] == "QB":
                    qb_round[(p["no"] - 1) // d["teams"] + 1] += 1
        per = {r: round(qb_round[r] / len(ds), 1) for r in range(1, 9)}
        print(f"  QBs taken per draft, rounds 1-8: {per}")



# ── score ────────────────────────────────────────────────────────────────────
def norm_cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def sigma_fit_factory(rows):
    """Piecewise-linear sd as a function of mean pick, from the corpus itself."""
    pts = []
    for lo, hi in ((1, 12), (13, 24), (25, 48), (49, 72), (73, 96), (97, 120), (121, 160)):
        bucket = [(m, v) for m, v in rows if lo <= m <= hi]
        if not bucket or sum(len(v) - 1 for _, v in bucket) < 30:
            continue
        var = sum(sum((x - m) ** 2 for x in v) for m, v in bucket) \
            / sum(len(v) - 1 for _, v in bucket)
        pts.append((sum(m for m, _ in bucket) / len(bucket), math.sqrt(var)))
    def f(adp):
        if not pts:
            return sigma_current(adp)
        if adp <= pts[0][0]:
            return pts[0][1]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if adp <= x1:
                return y0 + (y1 - y0) * (adp - x0) / (x1 - x0)
        return pts[-1][1]
    return f, pts


def _replay(drafts, obs, models, min_obs=5):
    """Leave-one-out replay of real drafts: predict every available player's
    survival to a rotating seat's next pick under each model, score against what
    happened. Returns {name: [brier_sum, bias_sum, n]}. The shared core of
    `score` (reporting) and `fit_params` (the self-training refresh)."""
    tot = {m: [0.0, 0.0, 0] for m in models}
    for di, d in enumerate(drafts):
        board = {}
        for pid, v in obs.items():
            mine = [p["no"] for p in d["picks"] if p["pid"] == pid]
            rest = [x for x in v if not (mine and x == mine[0])] if mine else v
            if len(rest) >= max(3, min_obs - 2):
                board[pid] = sum(rest) / len(rest)
        gone_at = {p["pid"]: p["no"] for p in d["picks"]}
        seat = (di % d["teams"]) + 1
        turns = [n for n in range(1, d["teams"] * (d["rounds"] or 15) + 1)
                 if ((n - 1) // d["teams"]) % 2 == 0 and (n - 1) % d["teams"] + 1 == seat
                 or ((n - 1) // d["teams"]) % 2 == 1 and d["teams"] - ((n - 1) % d["teams"]) == seat]
        for here, nxt in zip(turns, turns[1:]):
            for pid, adp in board.items():
                if gone_at.get(pid, 10 ** 9) <= here:
                    continue
                if adp > here + 45:
                    continue
                outcome = 1.0 if gone_at.get(pid, 10 ** 9) >= nxt else 0.0
                for m, sf in models.items():
                    sg = sf(adp)
                    pr = norm_cdf((adp - (nxt - 0.5)) / sg)
                    if m.endswith("| here") or m.startswith("mix "):
                        s_here = norm_cdf((adp - (here - 0.5)) / sg)
                        pr = pr / s_here if s_here > 1e-9 else 1.0
                    if m.startswith("mix "):
                        eps, tau = (float(x) for x in m[4:].split("/"))
                        pr = (1 - eps) * pr + eps * math.exp(-(nxt - here) / tau)
                    tot[m][0] += (pr - outcome) ** 2
                    tot[m][1] += pr - outcome
                    tot[m][2] += 1
    return tot


def _obs_for(drafts):
    from collections import defaultdict
    obs = defaultdict(list)
    for d in drafts:
        for p in d["picks"]:
            if p["pos"] in ("QB", "RB", "WR", "TE"):
                obs[p["pid"]].append(p["no"])
    return obs


# Consumer-side bounds live in the app and the sim too — a bad fit must not be
# able to reach a draft even if a bad blob ships.
FIT_MIN_DRAFTS = 20
EPS_GRID = (0.10, 0.15, 0.20, 0.25, 0.30, 0.35)
TAU_GRID = (40, 60, 80, 100, 120, 160)
EPS_BOUNDS = (0.0, 0.5)
TAU_BOUNDS = (20.0, 300.0)


def fit_params(corpus, teams=12, min_drafts=FIT_MIN_DRAFTS):
    """Fit the contamination mixture on everything the corpus holds (formats
    pooled — they have agreed within noise every time we have fit them apart),
    and refuse to emit anything from a thin corpus. Pure: no network, no I/O."""
    drafts = [d for d in corpus["drafts"] if d["teams"] == teams]
    if len(drafts) < min_drafts:
        return None
    obs = _obs_for(drafts)
    models = {"uncond": sigma_current, "cond | here": sigma_current}
    for eps in EPS_GRID:
        for tau in TAU_GRID:
            models[f"mix {eps}/{tau}"] = sigma_current
    tot = _replay(drafts, obs, models)
    briers = {m: v[0] / v[2] for m, v in tot.items() if v[2]}
    # The Brier surface is a plateau; a raw argmin walks the grid edge and would
    # ratchet a little further every refresh. Take the LEAST contamination that
    # gets within 1% of the plateau's best — stable, and honest about how little
    # the corner buys.
    mixes = [m for m in briers if m.startswith("mix ")]
    floor = min(briers[m] for m in mixes)
    near = [m for m in mixes if briers[m] <= floor * 1.01]
    best = min(near, key=lambda m: tuple(float(x) for x in m[4:].split("/")))
    eps, tau = (float(x) for x in best[4:].split("/"))
    if not (EPS_BOUNDS[0] <= eps <= EPS_BOUNDS[1] and TAU_BOUNDS[0] <= tau <= TAU_BOUNDS[1]):
        return None
    if briers[best] >= briers["uncond"]:
        return None                                   # the fit must actually beat doing nothing
    from collections import Counter
    qb_r1 = {}
    for fmt in ("superflex", "ppr", "half", "std"):
        ds_f = [d for d in drafts if d["format"] == fmt]
        if len(ds_f) >= 8:
            c = sum(1 for d in ds_f for p in d["picks"]
                    if p["pos"] == "QB" and p["no"] <= d["teams"])
            qb_r1[fmt] = round(c / len(ds_f), 2)
    return {"season": corpus.get("season"), "fitted_at": time.strftime("%Y-%m-%d"),
            "drafts": len(drafts), "eps": eps, "tau": tau,
            "brier": {"uncond": round(briers["uncond"], 4),
                      "cond": round(briers["cond | here"], 4),
                      "mix": round(briers[best], 4)},
            "behavior": {"qb_round1": qb_r1},
            "seeds": corpus.get("seeds", [])}


def refresh(args):
    """The self-training loop: re-crawl (incremental — the cache pays only for
    new drafts), re-fit, and write the market-model blob build_seed.py bakes
    into the seed. Emits nothing rather than something from thin data."""
    prior = None
    if os.path.exists(args.out):
        try:
            prior = json.load(open(args.out))
        except Exception:
            prior = None
    seeds = list(args.league or []) or (prior or {}).get("seeds") or []
    if not seeds:
        print("no seed leagues (pass --league or provide a prior blob with seeds)")
        sys.exit(1)

    class A:                                          # crawl() reads an argparse-shaped object
        league = seeds
        season = args.season
        max_leagues = args.max_leagues
        out = args.corpus
    crawl(A)
    corpus = json.load(open(args.corpus))
    corpus["seeds"] = seeds
    blob = fit_params(corpus)
    if blob is None:
        print(f"corpus too thin or fit no better than baseline — keeping "
              f"{'prior blob' if prior else 'nothing'}")
        return
    with open(args.out, "w") as f:
        json.dump(blob, f, indent=1)
    print(f"market model refreshed -> {args.out}")
    print(f"  {blob['drafts']} drafts | eps {blob['eps']} tau {blob['tau']} | "
          f"Brier uncond {blob['brier']['uncond']} -> mix {blob['brier']['mix']}")
    if prior:
        print(f"  (prior: eps {prior.get('eps')} tau {prior.get('tau')}, "
              f"fitted {prior.get('fitted_at')})")


def score(args):
    """Leave-one-out replay: predict survival to each seat's next pick with the
    shipped sigma curve vs the corpus-fitted one, scored on what really happened.
    This is the availability number the advisory's take-now/can-wait verdict and
    the %-pill are built from — the closest thing the engine has to 'accuracy'."""
    corpus = json.load(open(args.corpus))
    drafts = [d for d in corpus["drafts"]
              if d["format"] == args.format and d["teams"] == args.teams]
    if len(drafts) < 10:
        print(f"only {len(drafts)} {args.format} drafts — not enough to hold any out")
        return
    obs = _obs_for(drafts)
    fit_rows = [(sum(v) / len(v), v) for v in obs.values() if len(v) >= 5]
    fit_rows.sort(key=lambda r: r[0])
    sig_fit, pts = sigma_fit_factory(fit_rows)
    models = {"shipped sigma": sigma_current, "fitted sigma": sig_fit,
              "shipped | here": sigma_current, "fitted | here": sig_fit}
    for eps in EPS_GRID:
        for tau in TAU_GRID:
            models[f"mix {eps}/{tau}"] = sigma_current
    print(f"{args.format}, {args.teams}-team: {len(drafts)} drafts, "
          f"{len(fit_rows)} players in the board")
    print("fitted sigma knots:", [(round(x), round(y, 1)) for x, y in pts])
    tot = _replay(drafts, obs, models, min_obs=args.min_obs)
    print(f"\n{'model':<16} {'Brier':>8} {'bias':>8} {'n':>8}")
    for m, (b, bias, n) in tot.items():
        print(f"{m:<16} {b / n:8.4f} {bias / n:+8.4f} {n:8d}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crawl")
    c.add_argument("--league", action="append", required=True)
    c.add_argument("--season", default="2026")
    c.add_argument("--max-leagues", type=int, default=400)
    c.add_argument("--out", default=os.path.join(HERE, "..", "cache", "corpus.json"))
    f = sub.add_parser("fit")
    f.add_argument("--corpus", required=True)
    f.add_argument("--teams", type=int, default=12)
    f.add_argument("--min-drafts", type=int, default=8)
    f.add_argument("--min-obs", type=int, default=5)
    sc = sub.add_parser("score")
    sc.add_argument("--corpus", required=True)
    sc.add_argument("--format", default="ppr")
    sc.add_argument("--teams", type=int, default=12)
    sc.add_argument("--min-obs", type=int, default=5)
    rf = sub.add_parser("refresh")
    rf.add_argument("--league", action="append")
    rf.add_argument("--season", default="2026")
    rf.add_argument("--max-leagues", type=int, default=400)
    rf.add_argument("--corpus", default=os.path.join(HERE, "..", "cache", "corpus_live.json"))
    rf.add_argument("--out", default=os.path.join(HERE, "..", "cache", "market_model.json"))
    args = ap.parse_args()
    {"crawl": crawl, "fit": fit, "score": score, "refresh": refresh}[args.cmd](args)


if __name__ == "__main__":
    main()
