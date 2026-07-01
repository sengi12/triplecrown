import importlib.util, json, os, sys
test_dir = os.path.dirname(os.path.abspath(__file__))
build_path = os.path.join(test_dir, "..", "build_seed.py")
if not os.path.exists(build_path):
    print("SKIP: build_seed.py not found"); sys.exit(0)
spec = importlib.util.spec_from_file_location("build_seed", build_path)
bs = importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

# Adversarial: nested objects and a '};' sequence inside a string (breaks naive regex)
cases = [
  ('var ecrData = {"meta":{"note":"end};here"},"players":[{"player_name":"Test","rank_ecr":1,"tier":1}]};', 1),
  ('ecrData = {"filters":{"a":{"b":2}},"players":[{"player_name":"A","rank_ecr":3,"tier":1},{"player_name":"B","rank_ecr":4,"tier":1}]};', 2),
]
allok = True
for html, expect in cases:
    snippet = bs._extract_ecr_json(html)
    try:
        d = json.loads(snippet); n = len(d.get("players", []))
        ok = n == expect
        print(f"  extracted {n} players (expect {expect}): {'OK' if ok else 'FAIL'}")
        allok = allok and ok
    except Exception as e:
        print(f"  parse failed: {e}"); allok = False
print("RESULT:", "PASS" if allok else "FAIL")
