#!/usr/bin/env python3
"""
bake_seed.py — embed triplecrown_seed.json straight into the TripleCrown app (index.html).

Why: opening the app from a phone (or by double-clicking the file) uses the file://
protocol, where the browser blocks fetch() for security — so the app can't auto-load
triplecrown_seed.json next to it. The fix is to bake the seed *into* the HTML as plain
JavaScript constants. Then there's no network request at all: one self-contained file
you can email/AirDrop to your phone and open anywhere, fully offline, advanced stats and all.

Usage:
    python bake_seed.py
        → reads ./triplecrown_seed.json + ./index.html,
          writes ./index_baked.html

    python bake_seed.py --seed path/to/seed.json --html path/to/app.html --out my_app.html

Then just open the *_baked.html file on your phone — no server, no CORS.
"""
import argparse, json, os, re, sys

# ── Seed compaction codecs ───────────────────────────────────────────────────
# build_seed.py writes the hosted files in compact form. For the self-contained
# offline bake we decode them back to plain before embedding, so the baked app
# needs no decode step at runtime. Decoders no-op on already-plain input, so this
# is safe whether or not the input files were compacted.

def _decode_coaching(c):
    if not c or c.get("v") != 2:
        return c
    rt, ln = c["leg"]["rt"], c["leg"]["ln"]

    def dec_routes(rc):
        return [[rt[i], pct] for i, pct in rc]

    out = {}
    for code, t in c["teams"].items():
        slots, names = t["slots"], t["names"]

        formations, sig_order = {}, []
        for sig, name, backs, te, wr, ol, assigns_c in t["forms"]:
            sig_order.append(sig)
            parts = sig.split("|")
            assigns = []
            for slot, routes_c in assigns_c:
                pid = slots.get(slot)
                pname = names.get(pid, "\u2014") if pid else "\u2014"
                assigns.append({"slot": slot, "name": pname, "routes": dec_routes(routes_c)})
            formations[sig] = {"p": parts[0], "align": parts[1], "name": name,
                               "backs": backs, "te": te, "wr": wr, "ol": ol, "assigns": assigns}

        def dec_lanes(lc):
            return [[ln[i], n, epa] for i, n, epa in lc]

        def dec_group(gc):
            fi, n, share, pass_rate, epa, succ, np_, ep, sp, er, sr, lanes_c = gc
            return {"sig": sig_order[fi], "n": n, "share": share, "pass_rate": pass_rate,
                    "epa": epa, "succ": succ, "np": np_, "ep": ep, "sp": sp,
                    "nr": n - np_, "er": er, "sr": sr, "lanes": dec_lanes(lanes_c)}

        views = {}
        for dk, dnode in t["views"].items():
            views[dk] = {}
            for dsk, dsnode in dnode.items():
                views[dk][dsk] = {}
                for pk, node in dsnode.items():
                    if node is None:
                        views[dk][dsk][pk] = None
                    else:
                        total, groups = node
                        views[dk][dsk][pk] = {"total": total, "groups": [dec_group(g) for g in groups]}

        out[code] = {"team": t["team"], "slots": slots, "names": names,
                     "jerseys": t.get("jerseys", {}), "formations": formations, "views": views}
    return out

def _decode_defweekly(c):
    if not c or c.get("kind") != "def_weekly":
        return c
    wf = c["wf"]

    def dec_row(row):
        if row is None:
            return None
        return {wf[i]: v for i, v in enumerate(row) if v is not None}

    out = {}
    for y, node in c["years"].items():
        pl = {}
        for pname, rec in node.items():
            name, team, pos, group, totals_c, weeks_c = rec
            p = {"name": name, "team": team, "pos": pos, "group": group}
            if totals_c is not None:
                p["totals"] = dec_row(totals_c)
            p["weeks"] = [dec_row(w) for w in weeks_c]
            pl[pname] = p
        out[y] = pl
    return out

def _decode_fantasy(c):
    if not c or c.get("__codec") != "fantasy-1":
        return c
    out = dict(c)
    out.pop("__codec", None)

    # ---- history --------------------------------------------------------------
    hc = c["history"]; sf = hc["sf"]

    def dec_stats(row):
        return {sf[i]: v for i, v in enumerate(row) if v is not None}

    hist = {}
    for pid, (name, pos, sc) in hc["players"].items():
        seasons = {}
        for yr, rows in sc.items():
            recs = []
            for base in rows:
                team, gp, gs, snap, stats_c = base[0], base[1], base[2], base[3], base[4]
                rec = {"team": team, "pos": pos, "name": name,
                       "games_played": gp, "games_started": gs, "snap_pct": snap,
                       "stats": dec_stats(stats_c)}
                if len(base) > 5 and base[5]:
                    rec.update(base[5])
                recs.append(rec)
            seasons[yr] = recs
        hist[pid] = seasons
    out["history"] = hist

    # ---- nflverse -------------------------------------------------------------
    nc = c["nflverse"]; rt = nc["rt"]

    def dec_routekeyed(dct):
        return {rt[int(i)]: v for i, v in dct.items()} if isinstance(dct, dict) else dct

    nv = {}
    for yr, node in nc["years"].items():
        n2 = dict(node)
        if isinstance(node.get("routes"), dict):
            r2 = {}
            for pname, rec in node["routes"].items():
                rr = dict(rec)
                for kk in ("tree", "route_tds", "route_rec", "route_yds"):
                    if kk in rr:
                        rr[kk] = dec_routekeyed(rr[kk])
                r2[pname] = rr
            n2["routes"] = r2
        nv[yr] = n2
    out["nflverse"] = nv
    return out

START = "// ═══ TRIPLECROWN_SEED_START ═══"
END   = "// ═══ TRIPLECROWN_SEED_END ═══"

def main():
    ap = argparse.ArgumentParser(description="Embed a seed JSON into the TripleCrown app HTML.")
    ap.add_argument("--seed", default="triplecrown_seed.json", help="seed JSON from build_seed.py")
    ap.add_argument("--html", default="index.html", help="the app HTML to bake into")
    ap.add_argument("--out",  default=None, help="output file (default: <html>_baked.html)")
    args = ap.parse_args()

    if not os.path.exists(args.seed):
        sys.exit(f"ERROR: seed file not found: {args.seed}\n"
                 f"Run build_seed.py first to produce triplecrown_seed.json.")
    if not os.path.exists(args.html):
        sys.exit(f"ERROR: HTML file not found: {args.html}")

    with open(args.seed, encoding="utf-8") as f:
        seed = _decode_fantasy(json.load(f))
    with open(args.html, encoding="utf-8") as f:
        html = f.read()

    season  = seed.get("season", 2026)
    data    = seed.get("seed", {})
    history = seed.get("history", {})
    hseas   = seed.get("history_seasons", [])
    ecr     = seed.get("ecr", {})
    contracts = seed.get("contracts", {})
    sharp = seed.get("sharp", {})
    sos = seed.get("sos", {})
    team_names = seed.get("team_names", {})
    coordinators = seed.get("coordinators", {})
    hc_playcallers = seed.get("hc_playcallers", {})
    hc_history = seed.get("hc_history", {})
    additions = seed.get("additions", {})
    sharp_season = seed.get("sharp_season", "")
    sumer = seed.get("sumer", {})
    sumer_seasons = seed.get("sumer_seasons", [])
    ktc = seed.get("ktc", {})
    nflverse = seed.get("nflverse", {})

    # Heavy nflverse sections live in sidecar files (build_seed.py splits them out so the hosted
    # app can lazy-load them). For a self-contained offline/baked file we re-embed them, since
    # file:// can't fetch. Read them next to the main seed if present.
    def _sidecar(path):
        try:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return {}

    seed_dir = os.path.dirname(os.path.abspath(args.seed))
    nflverse_def_weekly = _decode_defweekly(_sidecar(os.path.join(seed_dir, "triplecrown_seed.def_weekly.json")))
    # Coaching scheme now ships as per-season sidecars (triplecrown_seed.coaching.<season>.json);
    # re-embed every season for the offline/baked file. Fall back to the old combined file.
    import glob as _glob
    nflverse_coaching = {}
    for _p in _glob.glob(os.path.join(seed_dir, "triplecrown_seed.coaching.*.json")):
        _seas = os.path.basename(_p)[len("triplecrown_seed.coaching."):-len(".json")]
        if _seas.isdigit():
            _blk = _decode_coaching(_sidecar(_p))
            if _blk:
                nflverse_coaching[_seas] = _blk
    if not nflverse_coaching:
        nflverse_coaching = _sidecar(os.path.join(seed_dir, "triplecrown_seed.coaching.json"))
    # Fallback: if an older single-file seed still carries these inline, lift them out.
    if not nflverse_def_weekly or not nflverse_coaching:
        for _s, _blk in (nflverse.items() if isinstance(nflverse, dict) else []):
            if isinstance(_blk, dict):
                if not nflverse_def_weekly and "def_weekly" in _blk:
                    nflverse_def_weekly.setdefault(_s, _blk.get("def_weekly"))
                if not nflverse_coaching and "coaching_scheme" in _blk:
                    nflverse_coaching.setdefault(_s, _blk.get("coaching_scheme"))

    # Build the replacement block. Compact JSON keeps the file smaller.
    j = lambda o: json.dumps(o, separators=(",", ":"), ensure_ascii=False)
    block = (
        f"{START} (baked by bake_seed.py — self-contained, no fetch needed)\n"
        f"const SEED_SEASON = {season};\n"
        f"const SEED_DATA = {j(data)};\n"
        f"const SEED_HISTORY = {j(history)};\n"
        f"const SEED_HISTORY_SEASONS = {j(hseas)};\n"
        f"const SEED_ECR = {j(ecr)};\n"
        f"const SEED_CONTRACTS = {j(contracts)};\n"
        f"const SEED_SHARP = {j(sharp)};\n"
        f"const SEED_SOS = {j(sos)};\n"
        f"const SEED_TEAM_NAMES = {j(team_names)};\n"
        f"const SEED_COORDINATORS = {j(coordinators)};\n"
        f"const SEED_HC_PLAYCALLERS = {j(hc_playcallers)};\n"
        f"const SEED_HC_HISTORY = {j(hc_history)};\n"
        f"const SEED_ADDITIONS = {j(additions)};\n"
        f"const SEED_SHARP_SEASON = {sharp_season or 0};\n"
        f"const SEED_SUMER = {j(sumer)};\n"
        f"const SEED_SUMER_SEASONS = {j(sumer_seasons)};\n"
        f"const SEED_KTC = {j(ktc)};\n"
        f"const SEED_NFLVERSE = {j(nflverse)};\n"
        f"const SEED_NFLVERSE_DEF_WEEKLY = {j(nflverse_def_weekly)};\n"
        f"const SEED_NFLVERSE_COACHING = {j(nflverse_coaching)};\n"
        f"{END}"
    )

    if START not in html or END not in html:
        sys.exit("ERROR: could not find the TRIPLECROWN_SEED markers in the HTML.\n"
                 "Make sure you're using a current index.html (the one with the\n"
                 "// ═══ TRIPLECROWN_SEED_START ═══ block near the top of its <script>).")

    pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.DOTALL)
    baked = pattern.sub(lambda m: block, html, count=1)

    out = args.out or (os.path.splitext(args.html)[0] + "_baked.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(baked)

    # Report what got baked in.
    nplayers = sum(len(v.get(p, [])) for v in data.values() for p in ("QB", "RB", "WR", "TE")) if data else 0
    ecr_counts = {fmt: len(tbl) for fmt, tbl in ecr.items()} if ecr else {}
    size_mb = os.path.getsize(out) / (1024 * 1024)
    print(f"✓ Baked seed into {out}  ({size_mb:.2f} MB)")
    print(f"  • projections: {nplayers} players across {len(data)} teams" if nplayers else "  • projections: (none — app will pull live from Sleeper)")
    print(f"  • history seasons: {', '.join(hseas) if hseas else '(none)'}")
    if ecr_counts:
        print(f"  • ECR ranks: " + ", ".join(f"{f}={n}" for f, n in ecr_counts.items()))
    else:
        print("  • ECR ranks: (none)")
    print(f"  • contracts (dynasty Age/APY/FA): {len(contracts)} players" if contracts else "  • contracts: (none)")
    print(f"  • Sharp advanced stats: {len(sharp)} tables" if sharp else "  • Sharp advanced stats: (none)")
    print(f"  • Strength of schedule: {len(sos)} teams" if sos else "  • Strength of schedule: (none)")
    print(f"  • Coordinators: {len(coordinators)} teams" if coordinators else "  • Coordinators: (none)")
    print(f"  • Head-coach history: {len(hc_history)} coaches" if hc_history else "  • Head-coach history: (none)")
    print(f"  • Roster changes (Spotrac): {len(additions)} teams" if additions else "  • Roster changes: (none)")
    print(f"\nOpen {out} on your phone — double-click or AirDrop/email it. No server, no CORS.")

if __name__ == "__main__":
    main()
