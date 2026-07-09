import importlib.util, os, sys
test_dir = os.path.dirname(os.path.abspath(__file__))
build_path = os.path.join(test_dir, "..", "build_seed.py")
if not os.path.exists(build_path):
    print("SKIP: build_seed.py not found"); sys.exit(0)
spec = importlib.util.spec_from_file_location("build_seed", build_path)
bs = importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

# A trimmed stand-in for KeepTradeCut's embedded `var playersArray = [...]`. Includes a skill
# player, an apostrophe name, and a rookie draft pick (RDP) that must be filtered out.
html = '''
<script>
var playersArray = [
  {"playerName":"Bijan Robinson","playerID":1414,"slug":"bijan-robinson-1414","position":"RB","team":"ATL"},
  {"playerName":"Ja'Marr Chase","playerID":1004,"slug":"ja-marr-chase-1004","position":"WR","team":"CIN"},
  {"playerName":"Josh Allen","playerID":365,"slug":"josh-allen-365","position":"QB","team":"BUF"},
  {"playerName":"2027 Early 1st","playerID":1702,"slug":"2027-early-1st-1702","position":"RDP","team":"FA"}
];
var somethingElse = 5;
</script>
'''

passes = 0
fails = 0
def check(cond, msg):
    global passes, fails
    if cond:
        print("  PASS", msg); passes += 1
    else:
        print("  FAIL", msg); fails += 1

out = bs.parse_ktc_players(html)
print("Parsed:", out)

check("bijan robinson" in out, "Bijan Robinson parsed")
check(out.get("bijan robinson", {}).get("slug") == "bijan-robinson-1414", "Bijan slug captured")
check(out.get("bijan robinson", {}).get("pos") == "RB", "Bijan position captured")
# apostrophe name must normalize the same way ecrNormName does in the app (strip punctuation)
check("jamarr chase" in out, "Ja'Marr Chase normalized to 'jamarr chase'")
check(out.get("jamarr chase", {}).get("slug") == "ja-marr-chase-1004", "Chase slug captured")
check("josh allen" in out, "Josh Allen (QB) parsed")
# draft picks (RDP) are not players — must be excluded
check(all(v.get("pos") != "RDP" for v in out.values()), "rookie draft picks (RDP) excluded")
check(len(out) == 3, "exactly 3 skill players kept (pick dropped)")

# bracket-counting extractor should also handle brackets/quotes inside the data
tricky = 'var playersArray = [{"playerName":"A [x]","slug":"a-1","position":"WR"}];'
t = bs.parse_ktc_players(tricky)
check(t.get("a x", {}).get("slug") == "a-1" or "a x" in t or len(t) == 1, "handles nested-bracket string in data")

print(f"\nRESULT: {'PASS' if fails==0 else 'FAIL'} ({passes} checks)" if fails==0 else f"\nRESULT: FAIL ({passes} pass, {fails} bad)")
sys.exit(0 if fails == 0 else 1)
