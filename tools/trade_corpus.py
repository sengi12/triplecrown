#!/usr/bin/env python3
"""Harvest a corpus of real Sleeper DYNASTY trades and fit tradesourced player
values from them — the trade analogue of tools/draft_corpus.py.

The idea (what KTC's "Tradesourced" does): every completed trade is a rough
statement that the two sides were worth about the same to the people who made it.
Stack thousands of those equalities and solve for a latent value per asset:

    for each trade t:   sum(v_i for i in sideA)  ~=  sum(v_j for j in sideB)

We solve it as ridge-regularized least squares anchored to FantasyPros' DYNASTY
trade-value chart (NOT redraft ECR — dynasty is a different market), so the fit
starts from FP and moves each player toward what the market actually pays. Draft
picks are first-class unknowns solved jointly with players (trades swap the two
constantly, which is what ties the scale together). Recent trades weigh more.

    crawl:  seed dynasty league -> its users -> their dynasty leagues -> trades
    fit:    ridge-to-FP least squares per market (1QB / superflex), by-hand solver
    score:  hold out the most recent trades; does tradesourced explain them (make
            them look more balanced) better than the FP chart alone?

Usage:
  python3 tools/trade_corpus.py crawl  --league <id> --season 2026 \
      --max-leagues 400 --out cache/trade_corpus_2026.json
  python3 tools/trade_corpus.py fit    --corpus cache/trade_corpus_2026.json --market sf
  python3 tools/trade_corpus.py score  --corpus cache/trade_corpus_2026.json --market sf
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.request

API = "https://api.sleeper.app/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
CACHE_DIR = os.path.join(ROOT, "cache", "trade_corpus")
SLEEP = 0.12          # polite crawl pace; the public API is generous but not ours to hammer


def current_season():
    try:
        with urllib.request.urlopen(f"{API}/state/nfl", timeout=15) as r:
            return str(json.load(r).get("season"))
    except Exception:
        import datetime
        now = datetime.date.today()
        return str(now.year if now.month >= 3 else now.year - 1)


def fetch(url, cache_name, ttl=None):
    """Cache-first GET. Completed-season data is immutable, so the cache never
    expires; a ttl (seconds) is only for the in-season legs that still move."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if os.path.exists(path) and (ttl is None or time.time() - os.path.getmtime(path) < ttl):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    time.sleep(SLEEP)
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = json.load(r)
    except Exception:
        data = None
    with open(path, "w") as f:
        json.dump(data, f)
    return data


# ── format axes ──────────────────────────────────────────────────────────────
def is_superflex(league):
    rp = league.get("roster_positions") or []
    return "SUPER_FLEX" in rp or rp.count("QB") >= 2


def ppr_tier(league):
    rec = (league.get("scoring_settings") or {}).get("rec", 0) or 0
    return "ppr" if rec >= 0.9 else ("half" if rec >= 0.4 else "std")


def is_tep(league):
    return ((league.get("scoring_settings") or {}).get("bonus_rec_te", 0) or 0) > 0


def is_dynasty(league, keepers=False):
    """Sleeper settings.type: 0 redraft, 1 keeper, 2 dynasty. A tradesourced
    dynasty value must come from leagues that actually value future assets."""
    t = (league.get("settings") or {}).get("type")
    return t == 2 or (keepers and t == 1)


def _norm_name(s):
    s = (s or "").lower()
    s = re.sub(r"[.'\-]", "", s)
    s = re.sub(r"\s+(jr|sr|ii|iii|iv|v)$", "", s)
    return re.sub(r"\s+", " ", s).strip()


# ── crawl ────────────────────────────────────────────────────────────────────
def _trade_sides(tx, season):
    """Turn one Sleeper trade transaction into two bundles of asset tokens keyed
    by the receiving roster. Player token 'p<id>', pick token 'k<relyr>_<round>'
    (years-out clamped 0..2, round clamped 1..5). Returns {roster_id: [tokens]}
    or None if it isn't a clean two-team trade."""
    rosters = tx.get("roster_ids") or []
    if len(rosters) != 2:
        return None
    sides = {r: [] for r in rosters}
    for pid, r in (tx.get("adds") or {}).items():
        if r in sides and pid:
            sides[r].append("p" + str(pid))
    for pk in (tx.get("draft_picks") or []):
        r = pk.get("owner_id")
        if r not in sides:
            continue
        try:
            rel = int(pk.get("season")) - int(season)
        except Exception:
            rel = 0
        rel = max(0, min(2, rel))
        rnd = max(1, min(5, int(pk.get("round") or 1)))
        sides[r].append(f"k{rel}_{rnd}")
    if any(len(v) == 0 for v in sides.values()):
        return None            # a one-sided "trade" (dump / correction) carries no equality
    return sides


def crawl(args):
    seen_leagues, seen_users, queue = set(), set(), list(args.league)
    corpus = {"season": args.season, "trades": [], "seeds": list(args.league)}
    kept = 0
    # In-season legs still move; give them a short ttl. Past seasons are frozen.
    live = args.season == current_season()
    while queue and len(seen_leagues) < args.max_leagues:
        lid = queue.pop(0)
        if lid in seen_leagues:
            continue
        seen_leagues.add(lid)
        lg = fetch(f"{API}/league/{lid}", f"league_{lid}.json")
        if not lg or str(lg.get("season")) != str(args.season):
            continue
        # Expand through this league's managers to their other leagues (dynasty or not —
        # we filter when we visit; a manager's redraft league can still lead to a dynasty one).
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
        if not is_dynasty(lg, args.keepers):
            continue
        teams = lg.get("total_rosters") or 0
        if teams < 8 or teams > 16:
            continue
        meta = {"sf": is_superflex(lg), "ppr": ppr_tier(lg), "tep": is_tep(lg), "teams": teams}
        for leg in range(1, args.weeks + 1):
            txs = fetch(f"{API}/league/{lid}/transactions/{leg}",
                        f"tx_{lid}_{leg}.json", ttl=(3600 if live else None)) or []
            for tx in txs:
                if tx.get("type") != "trade" or tx.get("status") not in (None, "complete"):
                    continue
                sides = _trade_sides(tx, args.season)
                if not sides:
                    continue
                a, b = list(sides.keys())
                corpus["trades"].append({
                    "league": lid, "tx": tx.get("transaction_id"),
                    "at": tx.get("status_updated") or tx.get("created"),
                    "A": sides[a], "B": sides[b], **meta,
                })
                kept += 1
        if kept and kept % 200 == 0:
            print(f"  {len(seen_leagues)} leagues visited, {kept} trades kept", flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(corpus, f)
    from collections import Counter
    print(f"crawled {len(seen_leagues)} leagues -> kept {kept} dynasty trades -> {args.out}")
    print("  superflex:", sum(1 for t in corpus['trades'] if t['sf']),
          " 1QB:", sum(1 for t in corpus['trades'] if not t['sf']))
    print("  by ppr:", dict(Counter(t['ppr'] for t in corpus['trades'])))


# ── priors (FantasyPros DYNASTY chart + Sleeper player map) ───────────────────
def load_player_map(path=None):
    """player_id -> (normalized name, position) from the Sleeper player DB.
    Fetches and caches the DB when it isn't on disk (cold CI cache)."""
    path = path or os.path.join(ROOT, "cache", "players.json")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with urllib.request.urlopen(f"{API}/players/nfl", timeout=60) as r:
            raw = json.load(r)
        with open(path, "w") as f:
            json.dump(raw, f)
    else:
        raw = json.load(open(path))
    out = {}
    for pid, p in raw.items():
        nm = p.get("full_name") or " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x)
        out[str(pid)] = (_norm_name(nm), p.get("position"))
    return out


def _pick_round(label):
    m = re.match(r"\s*(\d+)\s*[.:]", label) or re.search(r"(\d)\s*(?:st|nd|rd|th)", label, re.I) \
        or re.search(r"round\s*(\d)", label, re.I)
    return int(m.group(1)) if m else None


def build_pick_priors(fp_picks, season, col):
    """Mean FP pick value per (years-out, round) for the chosen value column
    (col=1 is the 1QB value, col=2 the superflex value). years-out beyond the FP
    horizon decays 0.8x per extra year."""
    by_year = {}
    for yr, rows in (fp_picks or {}).items():
        acc = {}
        for row in rows:
            if len(row) < 3:
                continue
            rnd = _pick_round(str(row[0]))
            if rnd is None:
                continue
            try:
                v = float(row[col])
            except Exception:
                continue
            acc.setdefault(rnd, []).append(v)
        if acc:
            by_year[int(yr)] = {r: sum(vs) / len(vs) for r, vs in acc.items()}
    years = sorted(by_year)

    def prior(rel, rnd):
        want = int(season) + rel
        if not years:
            return None
        yr = want if want in by_year else max(y for y in years if y <= want) if any(y <= want for y in years) else min(years)
        base = by_year[yr]
        val = base.get(rnd) or (max(base.values()) if rnd < min(base) else min(base.values()))
        return val * (0.8 ** max(0, want - max(years)))
    return prior


def load_priors(market, priors_path=None, players_path=None):
    """Returns (player_prior: pid->value, pick_prior: (rel,rnd)->value, fp_by_pid).
    market 'sf' uses FP superflex values (falls back to 1QB), '1qb' uses 1QB."""
    priors_path = priors_path or os.path.join(ROOT, "cache", "dynasty", "values.json")
    if not os.path.exists(priors_path):
        priors_path = os.path.join(ROOT, "seeds", "triplecrown_seed.json")
    dv = json.load(open(priors_path))
    dv = dv.get("dynasty_values", dv)          # accept either the block or the whole seed
    fp_players = dv.get("players") or {}
    pmap = load_player_map(players_path)
    col = 2 if market == "sf" else 1
    fp_by_pid = {}
    for pid, (nm, pos) in pmap.items():
        ent = fp_players.get(nm)
        if not ent:
            continue
        v = ent.get("sf") if (market == "sf" and ent.get("sf") is not None) else ent.get("v")
        if v is not None:
            fp_by_pid[pid] = float(v)
    pick_prior = build_pick_priors(dv.get("picks"), int(dv.get("asof", "0-0").split("-")[0] or 0) or 0, col)
    return fp_by_pid, pick_prior, pmap


# ── the fit: ridge-to-FP least squares, solved by coordinate descent ──────────
def _asset_prior(tok, fp_by_pid, pick_prior):
    if tok[0] == "p":
        return fp_by_pid.get(tok[1:])          # None if the player has no FP dynasty value
    m = re.match(r"k(\d)_(\d)", tok)
    return pick_prior(int(m.group(1)), int(m.group(2))) if m else None


def _recency_weight(at_ms, now_ms, half_life_days):
    if not at_ms or not half_life_days:
        return 1.0
    age_days = max(0.0, (now_ms - float(at_ms)) / 86400000.0)
    return 0.5 ** (age_days / half_life_days)


def solve_values(trades, fp_by_pid, pick_prior, min_obs=3, lam=0.25,
                 half_life_days=45, sweeps=60, now_ms=None, default_prior=0.0):
    """Coordinate-descent solve of the ridge-to-FP least squares. Assets seen in
    >= min_obs trades are unknowns pulled toward their prior with weight `lam`;
    rarer assets stay FIXED at their prior and just contribute a constant to each
    trade's balance. Returns {token: value}."""
    now_ms = now_ms or time.time() * 1000
    from collections import Counter
    counts = Counter()
    for t in trades:
        for tok in set(t["A"]) | set(t["B"]):
            counts[tok] += 1
    solved = {tok for tok, c in counts.items() if c >= min_obs}
    # Iterate assets in a STABLE order: a set's order follows PYTHONHASHSEED, which on a
    # weakly-pinned slice moved where the descent settled — the daily refit would then drift
    # run-to-run on identical trades. Sorted order makes the fit reproducible.
    solved_order = sorted(solved)

    def prior_of(tok):
        p = _asset_prior(tok, fp_by_pid, pick_prior)
        return default_prior if p is None else p

    v = {tok: prior_of(tok) for tok in solved_order}
    # Per-trade signed asset list (+1 side A, -1 side B) and the fixed-asset constant.
    rows = []
    for t in trades:
        w = _recency_weight(t.get("at"), now_ms, half_life_days)
        signed, const = [], 0.0
        for tok in t["A"]:
            if tok in solved:
                signed.append((tok, 1.0))
            else:
                const += prior_of(tok)
        for tok in t["B"]:
            if tok in solved:
                signed.append((tok, -1.0))
            else:
                const -= prior_of(tok)
        if signed:
            rows.append({"w": w, "signed": signed, "const": const, "r": 0.0})
    # index: token -> [(row, sign)]
    idx = {}
    for row in rows:
        for tok, s in row["signed"]:
            idx.setdefault(tok, []).append((row, s))
        row["r"] = sum(s * v[tok] for tok, s in row["signed"]) + row["const"]
    for _ in range(sweeps):
        max_delta = 0.0
        for tok in solved_order:
            hits = idx.get(tok) or []
            denom = lam + sum(row["w"] for row, _ in hits)
            numer = lam * prior_of(tok)
            for row, s in hits:
                numer -= row["w"] * s * (row["r"] - s * v[tok])
            nv = numer / denom
            d = nv - v[tok]
            if abs(d) > max_delta:
                max_delta = abs(d)
            v[tok] = nv
            for row, s in hits:
                row["r"] += s * d
        # Tight tolerance: on an underdetermined slice the descent drifts slowly along the
        # weakly-penalized direction, and a loose stop halted it far from the ridge optimum.
        if max_delta < 1e-7:
            break
    return v


def _bucket(corpus, market):
    return [t for t in corpus["trades"] if (t.get("sf") is (market == "sf"))]


def relative_imbalance(trade, value_of):
    a = sum(value_of(tok) for tok in trade["A"])
    b = sum(value_of(tok) for tok in trade["B"])
    tot = a + b
    return abs(a - b) / tot if tot > 1e-9 else None


def fit(args):
    corpus = json.load(open(args.corpus))
    trades = _bucket(corpus, args.market)
    if len(trades) < args.min_trades:
        print(f"only {len(trades)} {args.market} trades — need >= {args.min_trades}")
        return
    fp_by_pid, pick_prior, pmap = load_priors(args.market, args.priors)
    vals = solve_values(trades, fp_by_pid, pick_prior, min_obs=args.min_obs,
                        lam=args.lam, half_life_days=args.half_life)

    def val(tok):
        if tok in vals:
            return vals[tok]
        p = _asset_prior(tok, fp_by_pid, pick_prior)
        return 0.0 if p is None else p

    # In-sample fit: does it make real trades look balanced?
    imb_fit = [relative_imbalance(t, val) for t in trades]
    imb_fp = [relative_imbalance(t, lambda tok: (_asset_prior(tok, fp_by_pid, pick_prior) or 0.0)) for t in trades]
    imb_fit = sorted(x for x in imb_fit if x is not None)
    imb_fp = sorted(x for x in imb_fp if x is not None)
    med = lambda a: a[len(a) // 2] if a else float("nan")
    print(f"=== {args.market.upper()} market: {len(trades)} trades, {sum(1 for k in vals if k[0]=='p')} players + "
          f"{sum(1 for k in vals if k[0]=='k')} pick tiers solved ===")
    print(f"median relative imbalance   tradesourced {med(imb_fit):.3f}   vs FP chart {med(imb_fp):.3f}")
    # Biggest disagreements with FP (market pays more / less than FP says).
    id2name = {pid: nm for pid, (nm, pos) in pmap.items()}
    movers = []
    for tok, v in vals.items():
        if tok[0] != "p":
            continue
        fp = fp_by_pid.get(tok[1:])
        if fp is None:
            continue
        movers.append((v - fp, id2name.get(tok[1:], tok), fp, v))
    movers.sort()
    print("\nmarket pays LESS than FP (overrated by chart):")
    for d, nm, fp, v in movers[:10]:
        print(f"  {nm:<24} FP {fp:6.1f} -> trade {v:6.1f}  ({d:+.1f})")
    print("market pays MORE than FP (underrated by chart):")
    for d, nm, fp, v in movers[-10:][::-1]:
        print(f"  {nm:<24} FP {fp:6.1f} -> trade {v:6.1f}  ({d:+.1f})")
    print("\nrookie pick tiers (years-out_round -> value):")
    for tok in sorted(k for k in vals if k[0] == "k"):
        print(f"  {tok}: {vals[tok]:.1f}")


def score(args):
    """Time-split held-out study: fit on the older trades, then measure whether
    tradesourced values make the most-recent (unseen) trades look more balanced
    than the FP dynasty chart alone. Lower median relative imbalance = the model
    explains real market behaviour better."""
    corpus = json.load(open(args.corpus))
    trades = [t for t in _bucket(corpus, args.market) if t.get("at")]
    trades.sort(key=lambda t: float(t["at"]))
    if len(trades) < args.min_trades:
        print(f"only {len(trades)} dated {args.market} trades — need >= {args.min_trades}")
        return
    cut = int(len(trades) * (1 - args.holdout))
    train, test = trades[:cut], trades[cut:]
    fp_by_pid, pick_prior, pmap = load_priors(args.market, args.priors)
    vals = solve_values(train, fp_by_pid, pick_prior, min_obs=args.min_obs,
                        lam=args.lam, half_life_days=args.half_life,
                        now_ms=float(train[-1]["at"]))
    fp_only = lambda tok: (_asset_prior(tok, fp_by_pid, pick_prior) or 0.0)

    def ts(tok):
        return vals.get(tok, fp_only(tok))

    imb_fit = sorted(x for x in (relative_imbalance(t, ts) for t in test) if x is not None)
    imb_fp = sorted(x for x in (relative_imbalance(t, fp_only) for t in test) if x is not None)
    med = lambda a: a[len(a) // 2] if a else float("nan")
    mean = lambda a: sum(a) / len(a) if a else float("nan")
    win = sum(1 for t in test
              if (relative_imbalance(t, ts) or 9) < (relative_imbalance(t, fp_only) or 9))
    print(f"=== {args.market.upper()} held-out study ===")
    print(f"train {len(train)} trades -> test {len(test)} most-recent trades")
    print(f"median relative imbalance   tradesourced {med(imb_fit):.3f}   FP chart {med(imb_fp):.3f}   "
          f"({'BETTER' if med(imb_fit) < med(imb_fp) else 'worse'})")
    print(f"mean   relative imbalance   tradesourced {mean(imb_fit):.3f}   FP chart {mean(imb_fp):.3f}")
    print(f"tradesourced was closer on {win}/{len(test)} held-out trades ({100*win/max(1,len(test)):.0f}%)")


def _emit_market(corpus, market, lam, min_obs, half_life):
    """Solve one market and shape it for the seed: per player {fp, trade, n, pos}
    keyed by the app's normalized name, plus the solved pick tiers. `fp`/`trade`
    are raw chart points (0-100), the same units DYNASTY_VALUES stores — so the
    app blends them before its own LA_VAL_SCALE lift, no rescaling here."""
    trades = _bucket(corpus, market)
    if not trades:
        return None
    fp_by_pid, pick_prior, pmap = load_priors(market)
    now_ms = max((float(t["at"]) for t in trades if t.get("at")), default=None)
    vals = solve_values(trades, fp_by_pid, pick_prior, min_obs=min_obs,
                        lam=lam, half_life_days=half_life, now_ms=now_ms)
    from collections import Counter
    counts = Counter()
    for t in trades:
        for tok in set(t["A"]) | set(t["B"]):
            if tok[0] == "p":
                counts[tok] += 1
    players = {}
    for tok, v in vals.items():
        if tok[0] != "p":
            continue
        pid = tok[1:]
        nm, pos = pmap.get(pid, (None, None))
        fp = fp_by_pid.get(pid)
        if not nm or fp is None:
            continue
        n = counts.get(tok, 0)
        prev = players.get(nm)                      # two Sleeper ids, one name: keep the busier
        if prev and prev["n"] >= n:
            continue
        players[nm] = {"fp": round(fp, 1), "trade": round(v, 1), "n": n, "pos": pos}
    picks = {tok: round(v, 1) for tok, v in vals.items() if tok[0] == "k"}
    return {"players": players, "picks": picks, "trades": len(trades)}


def refresh(args):
    """Self-training loop for the trade calculator: re-crawl (incremental — the
    cache pays only for new trades), re-fit both markets, and write the
    trade_values blob build_seed.py bakes into the seed. Keeps the prior blob
    rather than emit a thinner one, so a bad crawl day can't gut the calculator."""
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
        weeks = args.weeks
        keepers = args.keepers
        out = args.corpus
    crawl(A)
    corpus = json.load(open(args.corpus))

    markets = {}
    for m in ("sf", "1qb"):
        em = _emit_market(corpus, m, args.lam, args.min_obs, args.half_life)
        if em and em["trades"] >= args.min_trades:
            markets[m] = em
    if not markets:
        print(f"no market cleared --min-trades {args.min_trades} — keeping "
              f"{'prior blob' if prior else 'nothing'}")
        return
    total_players = sum(len(m["players"]) for m in markets.values())
    if prior:
        prior_players = sum(len(m.get("players") or {}) for m in (prior.get("markets") or {}).values())
        if total_players < prior_players * 0.7:
            print(f"new blob thin ({total_players} vs prior {prior_players} player rows) — keeping prior")
            return
    blob = {
        "asof": time.strftime("%Y-%m-%d"),
        "source": "sleeper tradesourced · ridge-to-FantasyPros-dynasty",
        "trades": len(corpus["trades"]),
        "lam": args.lam, "half_life_days": args.half_life,
        "markets": markets, "seeds": seeds,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(blob, f)
    print(f"trade values refreshed -> {args.out}")
    for m, em in markets.items():
        print(f"  {m}: {em['trades']} trades, {len(em['players'])} players, {len(em['picks'])} pick tiers")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crawl")
    c.add_argument("--league", action="append", required=True)
    c.add_argument("--season", default=None, help="defaults to Sleeper's current season")
    c.add_argument("--max-leagues", type=int, default=400)
    c.add_argument("--weeks", type=int, default=18, help="transaction legs to scan per league")
    c.add_argument("--keepers", action="store_true", help="also include type=1 keeper leagues")
    c.add_argument("--out", default=os.path.join(ROOT, "cache", "trade_corpus.json"))
    for name in ("fit", "score"):
        p = sub.add_parser(name)
        p.add_argument("--corpus", required=True)
        p.add_argument("--market", choices=("sf", "1qb"), default="sf")
        p.add_argument("--priors", default=None, help="FP dynasty_values json (default: cache then seed)")
        p.add_argument("--min-obs", type=int, default=3, help="trades an asset needs to be a solved unknown")
        p.add_argument("--min-trades", type=int, default=50)
        p.add_argument("--lam", type=float, default=6.0, help="ridge pull toward the FP prior (higher = trust the chart more; ~6 avoids overfit at low trade counts)")
        p.add_argument("--half-life", type=float, default=45.0, help="recency half-life in days")
        if name == "score":
            p.add_argument("--holdout", type=float, default=0.2)
    rf = sub.add_parser("refresh")
    rf.add_argument("--league", action="append",
                    help="seed dynasty leagues; defaults to the seeds in the prior blob")
    rf.add_argument("--season", default=None, help="defaults to Sleeper's current season")
    rf.add_argument("--max-leagues", type=int, default=1200,
                    help="crawl budget: bigger = more trades = a firmer market edge")
    rf.add_argument("--weeks", type=int, default=18)
    rf.add_argument("--keepers", action="store_true")
    rf.add_argument("--corpus", default=os.path.join(ROOT, "cache", "trade_corpus_live.json"))
    rf.add_argument("--out", default=os.path.join(ROOT, "seeds", "trade_values.json"))
    rf.add_argument("--min-obs", type=int, default=3)
    rf.add_argument("--min-trades", type=int, default=100,
                    help="a market needs this many trades to publish (else the prior blob stays)")
    rf.add_argument("--lam", type=float, default=8.0,
                    help="ridge pull toward FP; ~8 is where the held-out fit edges the chart")
    rf.add_argument("--half-life", type=float, default=45.0)
    args = ap.parse_args()
    if getattr(args, "season", "-") is None:
        args.season = current_season()
        print(f"season (from Sleeper state): {args.season}")
    {"crawl": crawl, "fit": fit, "score": score, "refresh": refresh}[args.cmd](args)


if __name__ == "__main__":
    main()
