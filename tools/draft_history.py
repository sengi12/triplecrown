#!/usr/bin/env python3
"""What actually won leagues: draft shape vs. season outcome, from real history.

Walks the `previous_league_id` chain of one or more Sleeper leagues, and for
every manager-season reconstructs the draft as a *shape* (which positions were
taken in which rounds) and scores it against two outcomes:

  * **haul** — what the drafted roster alone was worth. Every drafted player is
    scored on his real end-of-season stats under that league's exact scoring
    settings, then the best legal starting lineup is filled from the draft-day
    roster only. This is the draft's own contribution, with waivers and trades
    held out, which is what a draft strategy can actually be judged on.
  * **title** — who won the league, read from the season's winners bracket.

Both outcomes are converted to a within-league-season percentile before they
are pooled, so a 10-team non-PPR league and a 12-team PPR superflex league can
sit in the same table without the scoring scale dominating.

The point is to answer, with the user's own league history rather than
received wisdom, which draft shapes tracked with titles and with points — and
to hand `tools/draft_sim.py` a target worth simulating toward.

Usage:
    python3 tools/draft_history.py --league <id> [--league <id> ...]
    python3 tools/draft_history.py --league <id> --out history.json
    python3 tools/draft_history.py --user <sleeper_user_id> --redraft-only

Stdlib-only, like the rest of the pipeline.
"""
import argparse
import json
import os
import statistics
import sys
import urllib.request
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, "cache", "drafthistory")
API = "https://api.sleeper.app/v1"

SKILL = ("QB", "RB", "WR", "TE")
FLEX_ELIG = {"FLEX": ("RB", "WR", "TE"), "WRRB_FLEX": ("RB", "WR"),
             "WRRB": ("RB", "WR"), "REC_FLEX": ("WR", "TE"),
             "SUPER_FLEX": ("QB", "RB", "WR", "TE")}
BENCH = {"BN", "IR", "TAXI"}
# Stat keys that are ranks/percentages, not scoreable events. Sleeper reuses a
# few scoring-key names for context stats, so intersecting blindly overcounts.
NON_SCORING = {"gp", "gs", "gms_active", "off_snp", "def_snp", "st_snp",
               "tm_off_snp", "tm_def_snp", "tm_st_snp"}


def fetch(url, cache_name):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    with urllib.request.urlopen(url, timeout=90) as r:
        data = json.load(r)
    with open(path, "w") as f:
        json.dump(data, f)
    return data


def season_stats(season):
    return fetch(f"{API}/stats/nfl/regular/{season}", f"stats_{season}.json")


def score_season(stats, scoring):
    """Fantasy points for one player-season under a league's scoring settings."""
    total = 0.0
    for k, v in (scoring or {}).items():
        if k in NON_SCORING:
            continue
        got = stats.get(k)
        if got:
            total += float(got) * float(v)
    return total


# ── League shape ─────────────────────────────────────────────────────────────

class Shape:
    def __init__(self, roster_positions):
        self.base = {p: 0 for p in SKILL}
        self.flex = []            # list of eligible-position tuples
        self.kd = 0
        self.bench = 0
        for slot in roster_positions or []:
            if slot in BENCH:
                self.bench += 1
            elif slot in FLEX_ELIG:
                self.flex.append(FLEX_ELIG[slot])
            elif slot in self.base:
                self.base[slot] += 1
            elif slot in ("K", "DEF", "DL", "LB", "DB", "IDP_FLEX"):
                self.kd += 1
        self.superflex = any("QB" in e for e in self.flex) or self.base["QB"] > 1

    def fill(self, entries):
        """Best starting lineup from [(pos, points, round), ...] (skill only).
        Returns (total points, the entries that started)."""
        pool = {p: [] for p in SKILL}
        for e in entries:
            if e[0] in pool:
                pool[e[0]].append(e)
        for p in pool:
            pool[p].sort(key=lambda e: -e[1])
        used = {p: 0 for p in SKILL}
        total, started = 0.0, []
        for pos, n in self.base.items():
            take = pool[pos][:n]
            total += sum(e[1] for e in take)
            started += take
            used[pos] = len(take)
        # Flex slots: greedily take the best remaining eligible player. Ordering
        # the slots most-restrictive-first keeps a superflex from eating the RB
        # a WR/RB flex still needs.
        for elig in sorted(self.flex, key=len):
            best, best_pos = None, None
            for pos in elig:
                if used[pos] < len(pool[pos]):
                    e = pool[pos][used[pos]]
                    if best is None or e[1] > best[1]:
                        best, best_pos = e, pos
            if best is not None:
                total += best[1]
                started.append(best)
                used[best_pos] += 1
        return total, started


def describe(lg, shape):
    rec = (lg.get("scoring_settings") or {}).get("rec", 0) or 0
    ppr = "PPR" if rec >= 1 else "half" if rec >= 0.5 else "std"
    tag = "SF" if shape.superflex else "1QB"
    return f"{lg.get('total_rosters')}tm/{ppr}/{tag}"


# ── Collection ───────────────────────────────────────────────────────────────

def chain(league_id):
    out, lid = [], league_id
    while lid and lid != "0":
        lg = fetch(f"{API}/league/{lid}", f"league_{lid}.json")
        if not lg:
            break
        out.append(lg)
        lid = lg.get("previous_league_id")
    return [lg for lg in out if lg.get("status") == "complete"]


def champion(lg):
    try:
        bracket = fetch(f"{API}/league/{lg['league_id']}/winners_bracket",
                        f"bracket_{lg['league_id']}.json")
        rosters = fetch(f"{API}/league/{lg['league_id']}/rosters",
                        f"rosters_{lg['league_id']}.json")
    except Exception:
        return None, []
    final = next((m for m in bracket or [] if m.get("p") == 1), None)
    champ = None
    if final and final.get("w"):
        champ = next((r.get("owner_id") for r in rosters or []
                      if r.get("roster_id") == final["w"]), None)
    return champ, rosters or []


def collect_season(lg, redraft_only):
    """One completed league-season -> list of per-manager records."""
    season = lg["season"]
    drafts = fetch(f"{API}/league/{lg['league_id']}/drafts",
                   f"drafts_{lg['league_id']}.json") or []
    draft = next((d for d in drafts if d.get("status") == "complete"), None)
    if not draft:
        return []
    # A dynasty/keeper league's "draft" is a 3-5 round rookie draft; the shape
    # question there is a different sport. Skip unless asked for.
    rounds = (draft.get("settings") or {}).get("rounds") or 0
    is_startup = rounds >= 10
    if redraft_only and not is_startup:
        return []
    picks = fetch(f"{API}/draft/{draft['draft_id']}/picks",
                  f"picks_{draft['draft_id']}.json") or []
    if not picks:
        return []
    users = {u["user_id"]: (u.get("display_name") or u["user_id"])
             for u in fetch(f"{API}/league/{lg['league_id']}/users",
                            f"users_{lg['league_id']}.json") or []}
    champ_id, rosters = champion(lg)
    pts_for = {}
    for r in rosters:
        st = r.get("settings") or {}
        pts_for[r.get("owner_id")] = float(st.get("fpts", 0)) + float(st.get("fpts_decimal", 0)) / 100.0
    stats = season_stats(season)
    scoring = lg.get("scoring_settings") or {}
    shape = Shape(lg.get("roster_positions"))
    teams = (draft.get("settings") or {}).get("teams") or lg.get("total_rosters") or 12

    by_mgr = defaultdict(list)
    for p in sorted(picks, key=lambda q: q["pick_no"]):
        owner = p.get("picked_by") or f"slot{p.get('draft_slot')}"
        by_mgr[owner].append(p)

    recs = []
    for owner, mine in by_mgr.items():
        seq, entries, slot = [], [], None
        for p in mine:
            pos = (p.get("metadata") or {}).get("position") or "?"
            slot = slot or p.get("draft_slot")
            if pos in SKILL:
                st = stats.get(str(p.get("player_id")))
                pts = score_season(st, scoring) if st else 0.0
                seq.append({"round": p["round"], "pos": pos,
                            "name": ((p.get("metadata") or {}).get("first_name", "") + " " +
                                     (p.get("metadata") or {}).get("last_name", "")).strip(),
                            "pid": p.get("player_id"), "pts": round(pts, 2)})
                entries.append((pos, pts, p["round"]))
        if not seq:
            continue
        first = {}
        for e in seq:
            first.setdefault(e["pos"], e["round"])
        counts_early = Counter(e["pos"] for e in seq if e["round"] <= 6)
        haul, started = shape.fill(entries)
        recs.append({
            "league": lg.get("name"), "league_id": lg["league_id"], "season": season,
            "format": describe(lg, shape), "superflex": shape.superflex,
            "teams": teams, "rounds": rounds,
            "manager": users.get(owner, owner), "owner_id": owner, "slot": slot,
            "pattern3": "-".join(e["pos"] for e in seq[:3]),
            "pattern5": "-".join(e["pos"] for e in seq[:5]),
            "first_round": first,
            "early_counts": dict(counts_early),
            "total_counts": dict(Counter(e["pos"] for e in seq)),
            "haul": round(haul, 2),
            "started_rounds": [e[2] for e in started],
            "haul_by_round": {str(r): round(sum(e[1] for e in started if e[2] == r), 2)
                              for r in sorted({e[2] for e in started})},
            "pts_for": pts_for.get(owner),
            "champion": owner == champ_id if champ_id else None,
            "picks": seq,
        })
    # Within-season percentiles: 1.0 = best draft haul in the room.
    for key in ("haul", "pts_for"):
        vals = sorted(r[key] for r in recs if r.get(key) is not None)
        for r in recs:
            v = r.get(key)
            r[key + "_pct"] = (None if v is None or len(vals) < 2 else
                               round(vals.index(v) / (len(vals) - 1), 4))
    return recs


# ── Reporting ────────────────────────────────────────────────────────────────

def mean(xs):
    xs = [x for x in xs if x is not None]
    return statistics.fmean(xs) if xs else None


def fmt(v, w=6, d=3):
    return f"{v:>{w}.{d}f}" if v is not None else f"{'-':>{w}}"


def bucket_table(recs, title, keyfn, minimum=6):
    groups = defaultdict(list)
    for r in recs:
        k = keyfn(r)
        if k is not None:
            groups[k].append(r)
    rows = []
    for k, rs in groups.items():
        if len(rs) < minimum:
            continue
        champs = [r for r in rs if r.get("champion") is not None]
        rows.append((k, len(rs), mean([r["haul_pct"] for r in rs]),
                     mean([r["pts_for_pct"] for r in rs]),
                     (sum(1 for r in champs if r["champion"]) / len(champs)) if champs else None))
    if not rows:
        return
    rows.sort(key=lambda t: -(t[2] if t[2] is not None else -1))
    print(f"\n  {title}")
    print(f"  {'bucket':<16}{'n':>5}{'haul pct':>10}{'ptsF pct':>10}{'title%':>9}")
    for k, n, h, p, c in rows:
        pct = f"{100 * c:>8.1f}%" if c is not None else f"{'-':>9}"
        print(f"  {str(k):<16}{n:>5}{fmt(h, 10)}{fmt(p, 10)}{pct}")


def report(recs, label):
    seasons = sorted({(r["league"], r["season"]) for r in recs})
    print("=" * 72)
    print(f"  DRAFT SHAPE vs OUTCOME — {label}")
    print("=" * 72)
    print(f"  {len(recs)} manager-seasons across {len(seasons)} league-seasons")
    fmts = Counter(r["format"] for r in recs)
    print("  formats: " + ", ".join(f"{k} x{v}" for k, v in fmts.most_common()))
    print("  haul = draft-day roster only, scored on real season stats under that")
    print("  league's settings, best legal lineup. pct = rank within its own room.")

    champs = [r for r in recs if r.get("champion")]
    field = [r for r in recs if r.get("champion") is False]
    if champs:
        print("\n" + "-" * 72)
        print("  DID THE CHAMPION WIN THE DRAFT?")
        print("-" * 72)
        ch, fh = mean([r["haul_pct"] for r in champs]), mean([r["haul_pct"] for r in field])
        cp, fp = mean([r["pts_for_pct"] for r in champs]), mean([r["pts_for_pct"] for r in field])
        print(f"  champions (n={len(champs)}): draft haul pct {fmt(ch)}   season pts pct {fmt(cp)}")
        print(f"  field     (n={len(field)}): draft haul pct {fmt(fh)}   season pts pct {fmt(fp)}")
        if ch is not None and fh is not None:
            gap_draft, gap_season = ch - fh, (cp - fp) if (cp and fp) else 0
            print(f"  edge from the draft {gap_draft:+.3f} vs edge in the standings "
                  f"{gap_season:+.3f}")
            share = gap_draft / gap_season if gap_season else 0
            print(f"  -> roughly {100 * share:.0f}% of the champion's edge was already "
                  f"in the draft-day roster.")
        top = sorted(champs, key=lambda r: -(r["haul_pct"] or 0))
        print("\n  every champion, best draft first:")
        for r in top:
            print(f"    {r['season']} {r['league'][:26]:<26} {r['manager'][:14]:<14} "
                  f"slot {str(r['slot']):>2}  haul pct {fmt(r['haul_pct'],6)}  "
                  f"{r['pattern3']}")

    print("\n" + "-" * 72)
    print("  WHERE THE DRAFT WAS WON  (share of the drafted lineup's points by round block)")
    print("-" * 72)
    blocks = [("R1-3", 1, 3), ("R4-6", 4, 6), ("R7-10", 7, 10), ("R11+", 11, 99)]
    groups = [("champions", champs), ("field", field)] if champs else [("all", recs)]
    print(f"  {'group':<12}" + "".join(f"{b[0]:>9}" for b in blocks)
          + f"{'starters from R7+':>20}")
    for label, rs in groups:
        if not rs:
            continue
        shares, late = [], []
        for r in rs:
            hb = {int(k): v for k, v in (r.get("haul_by_round") or {}).items()}
            tot = sum(hb.values())
            if tot <= 0:
                continue
            shares.append([sum(v for rd, v in hb.items() if lo <= rd <= hi) / tot
                           for _n, lo, hi in blocks])
            sr = r.get("started_rounds") or []
            late.append(sum(1 for rd in sr if rd >= 7) / len(sr) if sr else 0)
        if not shares:
            continue
        avg = [mean([sh[i] for sh in shares]) for i in range(len(blocks))]
        print(f"  {label:<12}" + "".join(f"{100 * v:>8.1f}%" for v in avg)
              + f"{100 * mean(late):>19.1f}%")
    print("  A lineup slot filled from round 7 or later is a pick the market")
    print("  mispriced — the rounds where a draft is actually won or lost.")

    print("\n" + "-" * 72)
    print("  HIT RATE BY ROUND  (chance a pick in this round starts for you)")
    print("-" * 72)
    hits = defaultdict(lambda: [0, 0])          # round -> [starters, picks]
    hits_ch = defaultdict(lambda: [0, 0])
    for r in recs:
        started = Counter(r.get("started_rounds") or [])
        seen = Counter(e["round"] for e in r["picks"])
        for rd, n in seen.items():
            hits[rd][0] += started.get(rd, 0)
            hits[rd][1] += n
            if r.get("champion"):
                hits_ch[rd][0] += started.get(rd, 0)
                hits_ch[rd][1] += n
    print(f"  {'round':<8}{'all':>10}{'champions':>12}{'edge':>9}")
    for rd in sorted(hits):
        if rd > 12 or hits[rd][1] < 20:
            continue
        a = hits[rd][0] / hits[rd][1]
        c = (hits_ch[rd][0] / hits_ch[rd][1]) if hits_ch[rd][1] >= 5 else None
        edge = f"{c - a:+8.1%}" if c is not None else f"{'-':>9}"
        cs = f"{c:>11.1%}" if c is not None else f"{'-':>12}"
        print(f"  R{rd:<7}{a:>9.1%}{cs}{edge}")

    print("\n" + "-" * 72)
    print("  DRAFT SHAPE")
    print("-" * 72)
    bucket_table(recs, "first three skill picks", lambda r: r["pattern3"], minimum=5)
    bucket_table(recs, "RBs taken in rounds 1-6",
                 lambda r: f"{r['early_counts'].get('RB', 0)} RB")
    bucket_table(recs, "WRs taken in rounds 1-6",
                 lambda r: f"{r['early_counts'].get('WR', 0)} WR")
    bucket_table(recs, "round of first QB",
                 lambda r: f"R{min(6, r['first_round'].get('QB', 99))}"
                 if r["first_round"].get("QB") else None)
    bucket_table(recs, "round of first TE",
                 lambda r: f"R{min(8, r['first_round'].get('TE', 99))}"
                 if r["first_round"].get("TE") else None)
    bucket_table(recs, "draft slot (1 = turn one)",
                 lambda r: f"slot {r['slot']}" if r.get("slot") else None)


def main():
    ap = argparse.ArgumentParser(description="Draft shape vs season outcome, from league history")
    ap.add_argument("--league", action="append", default=[],
                    help="Sleeper league id (repeatable); the whole chain is walked")
    ap.add_argument("--user", default="", help="Sleeper user id: use all of their leagues")
    ap.add_argument("--redraft-only", action="store_true",
                    help="skip dynasty/keeper rookie drafts (<10 rounds)")
    ap.add_argument("--split-format", action="store_true",
                    help="also report superflex and 1QB rooms separately")
    ap.add_argument("--out", default="", help="write the full record set here as JSON")
    args = ap.parse_args()

    league_ids = list(args.league)
    if args.user:
        for szn in range(2018, 2027):
            for lg in fetch(f"{API}/user/{args.user}/leagues/nfl/{szn}",
                            f"user_{args.user}_{szn}.json") or []:
                league_ids.append(lg["league_id"])
    if not league_ids:
        ap.error("pass --league or --user")

    seen, recs = set(), []
    for lid in league_ids:
        for lg in chain(lid):
            if lg["league_id"] in seen:
                continue
            seen.add(lg["league_id"])
            try:
                recs.extend(collect_season(lg, args.redraft_only))
            except Exception as e:                       # a season with no bracket/picks
                print(f"  (skipped {lg.get('name')} {lg.get('season')}: {e})", file=sys.stderr)
    if not recs:
        print("No completed drafts found.")
        return
    report(recs, "all rooms")
    if args.split_format:
        for want, label in ((True, "superflex / 2QB rooms"), (False, "single-QB rooms")):
            sub = [r for r in recs if r["superflex"] is want]
            if len(sub) >= 20:
                print("\n")
                report(sub, label)
    if args.out:
        with open(args.out, "w") as f:
            json.dump(recs, f, indent=1)
        print(f"\nwrote {args.out} ({len(recs)} records)")


if __name__ == "__main__":
    main()
