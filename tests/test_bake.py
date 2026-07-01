import json, os, subprocess, sys, tempfile, re

test_dir = os.path.dirname(os.path.abspath(__file__))
bake = os.path.join(test_dir, "..", "bake_seed.py")
html = os.path.join(test_dir, "..", "triplecrown.html")

if not os.path.exists(bake) or not os.path.exists(html):
    print("SKIP: bake_seed.py or triplecrown.html not found")
    sys.exit(0)

# Build a tiny seed
seed = {
    "season": 2026,
    "seed": {"CIN": {"QB": [{"name": "Joe Burrow", "player_id": "6770", "pos": "QB",
                             "team": "CIN", "passing_yards": 4800, "passing_attempts": 620,
                             "passing_touchdowns": 38, "games_played": 17}],
                     "WR": [], "RB": [], "TE": []}},
    "history": {}, "history_seasons": ["2025"],
    "ecr": {"half_ppr": {"joe burrow": {"rank_ecr": 40, "tier": 5, "age": 29}}},
    "contracts": {"joe burrow": {"age": 29, "apy": 55000000, "fa": 2030, "pos": "QB"}},
}

with tempfile.TemporaryDirectory() as d:
    seed_path = os.path.join(d, "seed.json")
    out_path = os.path.join(d, "baked.html")
    with open(seed_path, "w") as f:
        json.dump(seed, f)
    r = subprocess.run([sys.executable, bake, "--seed", seed_path, "--html", html, "--out", out_path],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("bake failed:", r.stderr)
        print("RESULT: FAIL")
        sys.exit(0)
    baked = open(out_path, encoding="utf-8").read()

    # The baked HTML must contain the embedded data and NOT the empty placeholder.
    has_data = '"passing_yards":4800' in baked
    has_ecr = '"rank_ecr":40' in baked
    has_contracts = '"apy":55000000' in baked and 'SEED_CONTRACTS' in baked
    # markers still present (so it can be re-baked)
    has_markers = "TRIPLECROWN_SEED_START" in baked and "TRIPLECROWN_SEED_END" in baked
    # only ONE seed block (no duplicate)
    one_block = baked.count("TRIPLECROWN_SEED_START") == 1

    print(f"Embedded projections: {has_data}")
    print(f"Embedded ECR: {has_ecr}")
    print(f"Markers preserved: {has_markers}")
    print(f"Single seed block: {one_block}")
    print(f"Embedded contracts: {has_contracts}")
    ok = has_data and has_ecr and has_contracts and has_markers and one_block
    print("RESULT:", "PASS" if ok else "FAIL")
