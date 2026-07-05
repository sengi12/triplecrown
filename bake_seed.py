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
        seed = json.load(f)
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
