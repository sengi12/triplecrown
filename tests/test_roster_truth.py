import importlib.util, os, sys
here=os.path.dirname(os.path.abspath(__file__))
bp=os.path.join(here,"..","build_seed.py")
if not os.path.exists(bp): bp="/mnt/user-data/outputs/build_seed.py"
if not os.path.exists(bp):
    print("SKIP: build_seed.py not found"); sys.exit(0)
spec=importlib.util.spec_from_file_location("build_seed",bp); bs=importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)

ok=True
# Projections feed lists stale/departed/retired players on PIT; player DB is roster-truth.
proj_idx = {
  'rodgers': {'stats':{'passing_yards':3800,'passing_attempts':520}, 'team':'NYJ', 'pos':'QB', 'name':'Aaron Rodgers'},
  'rudolph': {'stats':{'passing_yards':600,'passing_attempts':90},  'team':'PIT', 'pos':'QB', 'name':'Mason Rudolph'},
  'allar':   {'stats':{'passing_yards':200,'passing_attempts':30},  'team':'PIT', 'pos':'QB', 'name':'Drew Allar'},
  'howard':  {'stats':{'passing_yards':150,'passing_attempts':25},  'team':'PIT', 'pos':'QB', 'name':'Will Howard'},
  'departed':{'stats':{'passing_yards':300,'passing_attempts':40},  'team':'PIT', 'pos':'QB', 'name':'Departed Arm'},
  'retired': {'stats':{'passing_yards':200,'passing_attempts':25},  'team':'PIT', 'pos':'QB', 'name':'Retired Arm'},
  'fa':      {'stats':{'passing_yards':150,'passing_attempts':20},  'team':'PIT', 'pos':'QB', 'name':'FA Arm'},
}
players = {
  'rodgers': {'team':'PIT','pos':'QB','name':'Aaron Rodgers','active':True,'status':'Active'},
  'rudolph': {'team':'PIT','pos':'QB','name':'Mason Rudolph','active':True,'status':'Active'},
  'allar':   {'team':'PIT','pos':'QB','name':'Drew Allar','active':True,'status':'Active'},
  'howard':  {'team':'PIT','pos':'QB','name':'Will Howard','active':True,'status':'Active'},
  'departed':{'team':'LV', 'pos':'QB','name':'Departed Arm','active':True,'status':'Active'},
  'retired': {'team':None, 'pos':'QB','name':'Retired Arm','active':False,'status':'Retired'},
  'fa':      {'team':None, 'pos':'QB','name':'FA Arm','active':True,'status':'Active'},
}
seed,_ = bs.assemble(players, proj_idx, {}, {}, 2026)
pit = set(q['name'] for q in seed['PIT']['QB'])
lv  = set(q['name'] for q in seed['LV']['QB'])
ok &= pit == {'Aaron Rodgers','Mason Rudolph','Drew Allar','Will Howard'}   # exactly the real 4
ok &= 'Aaron Rodgers' in pit          # kept despite proj feed lagging at NYJ
ok &= 'Departed Arm' not in pit and 'Departed Arm' in lv   # moved to current team
ok &= 'Retired Arm' not in pit        # retired → dropped everywhere
ok &= 'FA Arm' not in pit             # free agent (no team) → dropped
print(f"PIT QBs after roster-truth filter: {sorted(pit)}")
print("RESULT:", "PASS" if ok else "FAIL")
