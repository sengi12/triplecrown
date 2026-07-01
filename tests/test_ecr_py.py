import importlib.util, json, os
build_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build_seed.py")
spec = importlib.util.spec_from_file_location("build_seed", build_path)
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)

# Simulate a FantasyPros page with embedded ecrData (the real format)
fake_html = '''
<html><head><script>
var someOtherVar = 1;
ecrData = {"sport":"NFL","ranking_type":"half-point-ppr","players":[
  {"player_id":17240,"player_name":"Ja'Marr Chase","player_team_id":"CIN","player_position_id":"WR","rank_ecr":1,"tier":1,"player_age":25},
  {"player_id":18000,"player_name":"Bijan Robinson","player_team_id":"ATL","player_position_id":"RB","rank_ecr":2,"tier":1,"player_age":23},
  {"player_id":19000,"player_name":"A.J. Brown","player_team_id":"PHI","player_position_id":"WR","rank_ecr":15,"tier":3,"player_age":28}
]};
var more = 2;
</script></head></html>
'''
import re as _re
m = _re.search(r"ecrData\s*=\s*(\{.*?\});", fake_html, _re.DOTALL)
data = json.loads(m.group(1))
out = {}
for p in data.get("players", []):
    key = bs._norm_name(p.get("player_name"))
    out[key] = {"rank_ecr": int(p["rank_ecr"]), "tier": int(p["tier"]), "age": p.get("player_age"),
                "team": p.get("player_team_id"), "pos": _re.sub(r"\d+","",p.get("player_position_id") or "")}

print("Parsed ECR entries:")
for k,v in out.items():
    print(f"  {k}: rank={v['rank_ecr']}, tier={v['tier']}, team={v['team']}, pos={v['pos']}")

ok = (out.get('jamarr chase',{}).get('rank_ecr')==1 and
      out.get('aj brown',{}).get('rank_ecr')==15 and
      out.get('aj brown',{}).get('pos')=='WR' and
      out.get('bijan robinson',{}).get('tier')==1)
print("\nRESULT:", "PASS" if ok else "FAIL")
