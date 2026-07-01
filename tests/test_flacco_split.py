import importlib.util, json, os

# Find build_seed.py (one level up from this test directory)
test_dir = os.path.dirname(os.path.abspath(__file__))
build_path = os.path.join(test_dir, "..", "build_seed.py")
if not os.path.exists(build_path):
    print("SKIP: build_seed.py not found at", build_path)
    exit(0)

spec = importlib.util.spec_from_file_location("build_seed", build_path)
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)

# Real Flacco 2025 weekly data
flacco_path = os.path.join(test_dir, "flacco_real.json")
weekly = json.load(open(flacco_path))
split = bs.aggregate_weeks_by_team(weekly, "2025")

print("Flacco 2025 per-team split (Python builder):")
for r in split:
    print(f"  {r['team']}: games={r['games_played']}, snap%={r['snap_pct']}, "
          f"pass_yd={r['stats'].get('passing_yards',0):.0f}")

cle = next((r for r in split if r['team']=='CLE'), None)
cin = next((r for r in split if r['team']=='CIN'), None)

print(f"\nCLE games (expect 4): {cle['games_played'] if cle else 'MISSING'}")
print(f"CIN games (expect 7, snap fallback for wk18): {cin['games_played'] if cin else 'MISSING'}")

ok = (cle and cin
      and cle['games_played'] == 4
      and cin['games_played'] == 7
      and abs(cin['stats']['passing_yards'] - 1664) < 1)
print("RESULT:", "PASS" if ok else "FAIL")
