#!/usr/bin/env python3
"""The draft playbook: one league, one seat, one page of what to actually do.

This is the tool that ties the other three together. For a given Sleeper league
and draft slot it:

  1. reads what has already happened in that room — `tools/draft_history.py`
     walks the league's `previous_league_id` chain and scores every past
     manager-season's draft-day roster on real results, so the advice is
     answerable to that league's own outcomes rather than to received wisdom;
  2. builds the board from analyst projections (`--proj`) scored under the
     league's exact settings, which is what VOR and VONA are then computed from;
  3. runs the Monte Carlo in `tools/draft_sim.py` twice over — once forcing each
     opening pattern, once letting the advisory's decision core choose freely —
     so the opening-round question is settled by measurement, not preference;
  4. writes a markdown playbook: the rules for this seat, the round-by-round
     positional plan the agent actually converges on, per-pick targets with the
     odds each survives to the next turn, and the players this market prices
     above and below what the board says they are worth.

Everything in the output is computed from that league's data. Point it at a
different league, a different seat or a different projection source and the
advice changes with them.

Usage:
    python3 tools/draft_playbook.py --league <id> --slot 5 \\
        --proj ../Live-Draft-Analyzer/data/triplecrown_projections.json \\
        --out playbook.md

    python3 tools/draft_playbook.py --league <id> --user <sleeper_user_id> --out sheet.md

Stdlib-only, like the tools it drives.
"""
import argparse
import json
import os
import random
import statistics
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import draft_sim as ds          # noqa: E402
import draft_history as dh      # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── Evidence from the league's own past ─────────────────────────────────────

def history_evidence(league_id):
    """Champion-vs-field draft quality in this room, and the shapes that won."""
    seasons = dh.chain(league_id)
    recs = []
    for lg in seasons:
        try:
            recs.extend(dh.collect_season(lg, redraft_only=True))
        except Exception:
            continue
    if not recs:
        return None
    champs = [r for r in recs if r.get("champion")]
    field = [r for r in recs if r.get("champion") is False]
    out = {"manager_seasons": len(recs),
           "league_seasons": len({(r["league_id"]) for r in recs}),
           "seasons": sorted({r["season"] for r in recs}),
           "champions": [{"season": r["season"], "manager": r["manager"],
                          "slot": r["slot"], "haul_pct": r["haul_pct"],
                          "pattern3": r["pattern3"]} for r in
                         sorted(champs, key=lambda r: r["season"])]}
    if champs and field:
        out["champ_haul_pct"] = dh.mean([r["haul_pct"] for r in champs])
        out["field_haul_pct"] = dh.mean([r["haul_pct"] for r in field])
    # Which openings earned the most in this room, pooled over its seasons.
    by_pat = defaultdict(list)
    for r in recs:
        if r.get("haul_pct") is not None:
            by_pat[r["pattern3"]].append(r["haul_pct"])
    out["patterns"] = sorted(((p, len(v), statistics.fmean(v))
                              for p, v in by_pat.items() if len(v) >= 4),
                             key=lambda t: -t[2])
    return out


# ── Simulation ──────────────────────────────────────────────────────────────

def run_grid(pool, league, slot, sims, rng_seed=9001):
    """Objective for each forced opening pattern and each free-form agent,
    all replaying the same rooms (common random numbers)."""
    out = {"patterns": {}, "agents": {}}
    agents = {"advisory (app3)": ds.app_pick_v3, "sim agent (smart)": None}
    for name, pat in ds.PATTERNS.items():
        out["patterns"][name] = _score(pool, league, slot, sims, rng_seed, pat, None)
    for name, chooser in agents.items():
        out["agents"][name] = _score(pool, league, slot, sims, rng_seed, None, chooser)
    return out


def _score(pool, league, slot, sims, rng_seed, pattern, chooser):
    rng = random.Random(rng_seed + slot * 31)
    agg = {"mean": 0.0, "steal_mean": 0.0, "p_bottom3": 0.0, "sd": 0.0}
    shape = Counter()
    for _ in range(sims):
        roster, states, _log = ds.run_draft(pool, league, slot, rng,
                                            pattern=pattern, chooser=chooser)
        m = ds.eval_league(states, slot, league, rng, draws=12)
        for k in agg:
            agg[k] += m[k]
        for p in roster:
            shape[p.pos] += 1
    for k in agg:
        agg[k] /= sims
    agg["obj"] = ds.composite(agg)
    agg["shape"] = {p: round(shape[p] / sims, 2) for p in ("QB", "RB", "WR", "TE")}
    return agg


def run_board(pool, league, slot, sims, rng_seed=4242):
    """Per-pick availability (neutral market) and what the advisory takes."""
    my_picks = ds.my_pick_numbers(slot, league)
    n_my = len(my_picks)
    avail = [[0] * len(pool) for _ in range(n_my)]
    seen = [0] * n_my
    taken_pos = [Counter() for _ in range(n_my)]
    taken_pid = [Counter() for _ in range(n_my)]

    def hook(k, taken):
        seen[k] += 1
        row = avail[k]
        for i, t in enumerate(taken):
            if not t:
                row[i] += 1

    rng = random.Random(rng_seed + slot)
    for _ in range(sims):
        _r, _s, log = ds.run_draft(pool, league, slot, rng, chooser=ds.app_pick_v3)
        for k, (_rnd, _pick, choice) in enumerate(log):
            if k < n_my:
                taken_pos[k][choice.pos] += 1
                taken_pid[k][choice.pid] += 1
    for _ in range(sims):
        ds.run_draft(pool, league, slot, rng, avail_hook=hook, market_only=True)
    surv = [{pool[i].pid: avail[k][i] / max(1, seen[k]) for i in range(len(pool))}
            for k in range(n_my)]
    return {"picks": my_picks, "survival": surv, "pos_mix": taken_pos, "pids": taken_pid}


def market_gaps(pool, league, depth=150, min_gap=15.0):
    """Where this market and this board disagree, in points rather than places.

    Rank gaps are misleading down the board: past the startable players the VOR
    curve is nearly flat, so a trivial difference in value shows up as a swing of
    eighty rank positions. Instead, each player is compared against the value the
    board says is normally available at his market rank — if the Nth pick off the
    board usually returns V, a player going Nth who is worth more than V is a
    surplus and one worth less is an overpay. `depth` limits this to the part of
    the draft where picks are contested; `min_gap` is the surplus in season
    points worth mentioning."""
    board = [p for p in pool if p.adp < 999 and p.adp_eff < 999]
    by_vor = sorted(board, key=lambda p: -p.vor)
    vor_rank = {p.pid: i + 1 for i, p in enumerate(by_vor)}
    by_adp = sorted(board, key=lambda p: p.adp_eff)
    adp_rank = {p.pid: i + 1 for i, p in enumerate(by_adp)}
    par = [p.vor for p in by_vor]          # value normally available at each rank
    gaps = []
    for p in by_adp[:depth]:
        expected = par[min(adp_rank[p.pid], len(par)) - 1]
        gaps.append((round(p.vor - expected, 1), p))
    values = sorted((g for g in gaps if g[0] >= min_gap), key=lambda t: -t[0])
    fades = sorted((g for g in gaps if g[0] <= -min_gap), key=lambda t: t[0])
    return values, fades, vor_rank, adp_rank


# ── Rendering ───────────────────────────────────────────────────────────────

def pct(x):
    return "—" if x is None else f"{100 * x:.0f}%"


def render(ctx):
    lg, grid, board, hist = ctx["league"], ctx["grid"], ctx["board"], ctx["history"]
    league, pool = ctx["league_obj"], ctx["pool"]
    slot = ctx["slot"]
    L = []
    A = L.append
    A(f"# {lg['name']} — draft playbook, seat {slot}")
    base, flex_n, sf_n = league.starters_skill()
    A(f"_{league.teams}-team · {league.rounds} rounds"
      + (f" · {ordinal(league.reversal)}-round reversal" if league.reversal else "")
      + f" · start {' / '.join(f'{v}{k}' for k, v in base.items() if v)}"
      + (f" + {flex_n} flex" if flex_n else "")
      + (f" + {sf_n} superflex" if sf_n else "")
      + f" · {league.bench} bench_")
    A(f"_Board: {ctx['board_label']}. {ctx['sims']} simulated drafts per line._")
    A("")
    A(f"**Your picks:** {', '.join(str(p) for p in board['picks'])}")
    A("")

    # 1. What the room's own history says.
    A("## 1. What has actually won this league")
    if not hist:
        A("This league has no completed season yet, so there is no in-room evidence "
          "to lean on. Everything below comes from the simulation.")
        A("")
    else:
        A(f"{hist['manager_seasons']} manager-seasons across "
          f"{hist['league_seasons']} completed drafts ({', '.join(hist['seasons'])}). "
          "Each draft-day roster is scored on what those players really did, under "
          "this league's settings, with waivers and trades held out — so this is "
          "what the *draft* was worth, not what the manager did afterwards.")
        A("")
        if hist.get("champ_haul_pct") is not None:
            c, f = hist["champ_haul_pct"], hist["field_haul_pct"]
            A(f"- Champions drafted at the **{pct(c)} percentile** of their room. "
              f"Everyone else: {pct(f)}.")
            A(f"- That is the gap to aim at. It is a draft-day gap, and it is "
              f"{'large' if c - f > 0.15 else 'modest'} ({c - f:+.2f}).")
        A("")
        A("| season | champion | slot | their draft (pct of room) | opened |")
        A("|---|---|---|---|---|")
        for c in hist["champions"]:
            A(f"| {c['season']} | {c['manager']} | {c['slot']} | "
              f"{pct(c['haul_pct'])} | {c['pattern3']} |")
        A("")

    # 2. Does the opening pattern matter?
    A("## 2. Does your opening matter?")
    pats = grid["patterns"]
    free = pats["free"]["obj"]
    forced = {k: v for k, v in pats.items() if k != "free"}
    best = max(forced, key=lambda k: forced[k]["obj"])
    worst = min(forced, key=lambda k: forced[k]["obj"])
    spread = forced[best]["obj"] - forced[worst]["obj"]
    best_agent = max(grid["agents"], key=lambda k: grid["agents"][k]["obj"])
    A(f"Every opening below was forced on the same {ctx['sims']} simulated rooms, then "
      "the agent drafted normally from round 4. The objective is expected weekly "
      "starting-lineup points, penalised for the weeks a roster lands in the "
      "league's bottom three and for what is left after its best player is lost.")
    A("")
    A("| opening | objective | vs. free choice | RB | WR | TE | QB |")
    A("|---|---|---|---|---|---|---|")
    for k in sorted(forced, key=lambda k: -forced[k]["obj"]):
        v = forced[k]
        s = v["shape"]
        A(f"| {k} | {v['obj']:.2f} | {v['obj'] - free:+.2f} | {s['RB']:.1f} | "
          f"{s['WR']:.1f} | {s['TE']:.1f} | {s['QB']:.1f} |")
    A("")
    A(f"**Best forced opening: `{best}` ({forced[best]['obj']:.2f}). "
      f"Worst: `{worst}` ({forced[worst]['obj']:.2f}). Spread: {spread:.2f}.**")
    if grid["agents"][best_agent]["obj"] >= forced[best]["obj"] - 0.02 * abs(free):
        A(f"Letting the advisory choose freely scores {grid['agents'][best_agent]['obj']:.2f} — "
          "it reaches the best openings on its own, without being told. Committing to "
          "a named strategy before the draft starts buys nothing here; reacting to "
          "the room is what the openings above are really measuring.")
    else:
        A(f"The free-choice agent scores {grid['agents'][best_agent]['obj']:.2f}, below the "
          f"best forced opening. In this seat the opening is worth committing to.")
    A("")
    A("| agent | objective | RB | WR | TE | QB |")
    A("|---|---|---|---|---|---|")
    for k, v in sorted(grid["agents"].items(), key=lambda t: -t[1]["obj"]):
        s = v["shape"]
        A(f"| {k} | {v['obj']:.2f} | {s['RB']:.1f} | {s['WR']:.1f} | {s['TE']:.1f} | {s['QB']:.1f} |")
    A("")

    # 3. Round-by-round plan.
    A("## 3. The plan, pick by pick")
    A("What the advisory's decision core actually does from this seat, over every "
      "simulated room. Percentages are how often it takes that position at that "
      "pick — a split is a genuine fork, not indecision.")
    A("")
    A("| your pick | round | it takes | who it takes, and how often |")
    A("|---|---|---|---|")
    players = {p.pid: p for p in pool}
    for k, pick_no in enumerate(board["picks"]):
        mix = board["pos_mix"][k]
        if not mix:
            A(f"| {pick_no} | R{k + 1} | K / DEF | stream by early-season schedule |")
            continue
        tot = sum(mix.values())
        mixtxt = " · ".join(f"**{p}** {100 * c / tot:.0f}%"
                            for p, c in mix.most_common() if c / tot >= 0.08)
        names = []
        for pid, c in board["pids"][k].most_common(3):
            p = players.get(pid)
            if p and c / tot >= 0.05:
                names.append(f"{p.name} ({p.pos}, {100 * c / tot:.0f}%)")
        A(f"| {pick_no} | R{k + 1} | {mixtxt} | {', '.join(names) or '—'} |")
    A("")

    # 4. Targets and last calls.
    A("## 4. Targets, and when they stop being available")
    A("For each of your turns: the best players by VOR who are still likely to be "
      "there, and whether they survive to your *next* turn. **Last call** means the "
      "odds fall off a cliff between this pick and the one after it — the pick to "
      "make now rather than plan around.")
    A("")
    n_skill = len(board["picks"]) - league.kd_slots
    for k, pick_no in enumerate(board["picks"][:n_skill]):
        surv, nxt = board["survival"][k], (board["survival"][k + 1]
                                           if k + 1 < n_skill else {})
        cands = [p for p in pool if surv.get(p.pid, 0) >= 0.25 and p.vor > 0]
        cands.sort(key=lambda p: -p.vor)
        if not cands:
            continue
        A(f"**R{k + 1} · pick {pick_no}**")
        A("")
        A("| player | pos | bye | ADP | VOR | here now | back next turn | |")
        A("|---|---|---|---|---|---|---|---|")
        for p in cands[:6]:
            after = nxt.get(p.pid, 0.0)
            flag = "**last call**" if surv.get(p.pid, 0) >= 0.45 and after < 0.30 else ""
            A(f"| {p.name} | {p.pos} | {p.bye or '—'} | "
              f"{'—' if p.adp >= 999 else f'{p.adp:.0f}'} | {p.vor:+.0f} | "
              f"{pct(surv.get(p.pid, 0))} | {pct(after) if nxt else '—'} | {flag} |")
        A("")

    # 5. Where the market and the board disagree.
    values, fades, vr, ar = ctx["gaps"]
    A("## 5. Where this market and your board disagree")
    A("Every pick has a par: the value the board says is normally available that "
      "far into the draft. A player worth more than par where he goes is a pick "
      "that pays for itself; one worth less is the room's money, not yours. "
      "Surplus is in season points under this league's scoring.")
    A("")
    A("Read the extremes as a question, not an instruction. A very large shortfall "
      "usually means the analysts have projected reduced usage or a partial season "
      "for a player the market is still pricing as a every-week starter — worth "
      "knowing, and worth checking against the news before you act on it.")
    A("")
    A("**Worth more than his pick usually returns — the picks that pay for the draft:**")
    A("")
    A("| player | pos | ADP | VOR | par for that pick | surplus |")
    A("|---|---|---|---|---|---|")
    for g, p in values[:12]:
        A(f"| {p.name} | {p.pos} | {p.adp:.0f} | {p.vor:+.0f} | {p.vor - g:+.0f} | **{g:+.0f}** |")
    A("")
    A("**Worth less than his pick usually returns — let the room have them:**")
    A("")
    A("| player | pos | ADP | VOR | par for that pick | shortfall |")
    A("|---|---|---|---|---|---|")
    for g, p in fades[:12]:
        A(f"| {p.name} | {p.pos} | {p.adp:.0f} | {p.vor:+.0f} | {p.vor - g:+.0f} | **{g:+.0f}** |")
    A("")

    # 6. The rules.
    A("## 6. The rules for this seat")
    for i, rule in enumerate(ctx["rules"], 1):
        A(f"{i}. {rule}")
    A("")
    return "\n".join(L)


def ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def build_rules(ctx):
    """The playbook's conclusions, derived from what this run measured."""
    grid, board, hist, league = ctx["grid"], ctx["board"], ctx["history"], ctx["league_obj"]
    rules = []
    forced = {k: v for k, v in grid["patterns"].items() if k != "free"}
    best = max(forced, key=lambda k: forced[k]["obj"])
    spread = forced[best]["obj"] - min(v["obj"] for v in forced.values())
    free = grid["patterns"]["free"]["obj"]
    rules.append(
        f"**The opening is worth {spread:.2f} objective points between the best and "
        f"worst script, on a base of {free:.0f}.** "
        + (f"That is inside the noise of one injury; take the best player your board "
           f"shows and let the shape follow." if spread < 0.02 * abs(free) else
           f"That is large enough to plan around: open `{best}` unless the board "
           f"hands you something clearly better."))
    if hist and hist.get("champ_haul_pct") is not None:
        c, f = hist["champ_haul_pct"], hist["field_haul_pct"]
        rules.append(
            f"**Win the draft and you have most of the way home.** In this room "
            f"champions drafted at the {pct(c)} percentile against {pct(f)} for the "
            f"field. The draft is the largest single lever you control all season.")
    shape = grid["agents"][max(grid["agents"], key=lambda k: grid["agents"][k]["obj"])]["shape"]
    rules.append(
        f"**The roster this seat converges on is "
        f"{shape['RB']:.1f} RB / {shape['WR']:.1f} WR / {shape['TE']:.1f} TE / "
        f"{shape['QB']:.1f} QB.** Not a target to force — it is what taking the best "
        f"available under this lineup produces on average. Drifting far from it "
        f"usually means reaching.")
    # When does the agent first take QB / TE?
    for pos in ("QB", "TE"):
        first = None
        for k, mix in enumerate(board["pos_mix"]):
            tot = sum(mix.values()) or 1
            if mix.get(pos, 0) / tot >= 0.5:
                first = k + 1
                break
        if first:
            rules.append(
                f"**{pos} lands in round {first}** more often than not from this seat. "
                f"Earlier is a choice you are making against the board, not with it.")
    late = [k + 1 for k, mix in enumerate(board["pos_mix"])
            if mix and max(mix.values()) / sum(mix.values()) < 0.5]
    if late:
        rules.append(
            f"**Rounds {', '.join('R' + str(r) for r in late[:6])} are genuine forks** — "
            f"no single position is right more than half the time. These are the picks "
            f"where reading the room beats a script.")
    rules.append(
        "**Let the survival column, not the ranking, set your order.** Two players "
        "close in VOR are not the same pick if one comes back to you and the other "
        "does not. That is the whole of what VONA adds over a ranked list.")
    return rules


def main():
    ap = argparse.ArgumentParser(description="Per-league, per-seat draft playbook")
    ap.add_argument("--league", required=True, help="Sleeper league id")
    ap.add_argument("--slot", type=int, default=0)
    ap.add_argument("--user", default="", help="Sleeper user id (to find the slot)")
    ap.add_argument("--proj", default="", help="analyst projections JSON for the board")
    ap.add_argument("--proj-analyst", default="consensus")
    ap.add_argument("--tc-weight", type=float, default=0.0,
                    help="TC-model blend on top of the projections (0 = projections alone)")
    ap.add_argument("--floor-kappa", type=float, default=0.08)
    ap.add_argument("--sims", type=int, default=400)
    ap.add_argument("--seed-file", default=ds.SEED_PATH)
    ap.add_argument("--out", default="", help="write the playbook here (default: stdout)")
    args = ap.parse_args()

    lg_json = ds.fetch_json(ds.SLEEPER_LEAGUE_URL.format(args.league),
                            f"league_{args.league}.json")
    drafts = ds.fetch_json(ds.SLEEPER_LG_DRAFTS_URL.format(args.league),
                           f"drafts_{args.league}.json")
    draft_json = drafts[0] if drafts else {}
    league = ds.League(lg_json, draft_json)
    slot = args.slot or (draft_json.get("draft_order") or {}).get(args.user, 0)
    if not slot:
        ap.error("no draft slot — pass --slot or a --user who is in the draft order")

    with open(args.seed_file) as f:
        seed = json.load(f)
    byes = ds.load_byes(seed.get("season"))
    pro = ds.load_pro_projections(args.proj, args.proj_analyst) if args.proj else None
    fmt = ds.market_format(league)
    pool = ds.build_board(seed, league, byes, args.tc_weight, args.floor_kappa, pro=pro)
    covered = sum(1 for p in pool if p.src == "pro")
    label = (f"{args.proj_analyst} projections from {os.path.basename(args.proj)} "
             f"({covered} of {len(pool)} players), scored under this league's settings"
             if pro else "the seed's own projections, scored under this league's settings")
    if args.tc_weight:
        label += f", blended {args.tc_weight:g} with the TC model"

    label += f"; the room drafts off the {fmt} ADP board"
    print(f"league={league.name} slot={slot} pool={len(pool)}  [{label}]", file=sys.stderr)
    print("  reading league history…", file=sys.stderr)
    hist = history_evidence(args.league)
    print("  simulating openings…", file=sys.stderr)
    grid = run_grid(pool, league, slot, args.sims)
    print("  simulating the board…", file=sys.stderr)
    board = run_board(pool, league, slot, args.sims)

    ctx = {"league": lg_json, "league_obj": league, "slot": slot, "pool": pool,
           "grid": grid, "board": board, "history": hist, "sims": args.sims,
           "board_label": label, "gaps": market_gaps(pool, league)}
    ctx["rules"] = build_rules(ctx)
    md = render(ctx)
    if args.out:
        with open(args.out, "w") as f:
            f.write(md)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(md)


if __name__ == "__main__":
    main()
