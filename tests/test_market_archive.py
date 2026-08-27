#!/usr/bin/env python3
"""Market archive (tools/market_archive.py): snapshot append, gzip-member concatenation,
cadence dedupe, and the read path — all against a temp dir, no network."""
import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from tools import market_archive as ma

passed = failed = 0
def chk(c, label):
    global passed, failed
    if c: passed += 1; print("  PASS:", label)
    else: failed += 1; print("  FAIL:", label)

seed = {"CIN": {"QB": [{"player_id": "96", "adp_ppr": 55.1, "adp_half_ppr": 57.2, "adp_std": 60.0, "adp_2qb": 20.4}],
                "WR": [{"player_id": "7564", "adp_ppr": 3.2}, {"player_id": None}, {"player_id": "9999", "adp_ppr": 999}]}}
ecr = {"ppr": {"ja'marr chase": {"rank_ecr": 3, "tier": 1}, "joe burrow": {"rank_ecr": 40}},
       "half_ppr": {"joe burrow": {"rank_ecr": 44}}, "junk": 7}

with tempfile.TemporaryDirectory() as td:
    msg = ma.append_snapshot(seed, ecr, 2026, root=td, today="2026-08-28")
    chk("archived" in msg and "2 ADP" in msg, f"first snapshot written ({msg})")
    msg2 = ma.append_snapshot(seed, ecr, 2026, root=td, today="2026-08-30")
    chk("current" in msg2, "a snapshot 2 days later is deduped (3-day cadence)")
    msg3 = ma.append_snapshot(seed, ecr, 2026, root=td, today="2026-09-04")
    chk("archived" in msg3, "past the gap a new snapshot appends")
    rows = ma.read_archive(os.path.join(td, "market_2026.jsonl.gz"))
    chk(len(rows) == 2 and rows[0]["d"] == "2026-08-28" and rows[1]["d"] == "2026-09-04",
        "concatenated gzip members read back as ordered history")
    chk(rows[0]["adp"]["96"] == [55.1, 57.2, 60.0, 20.4], "ADP formats stored in order")
    chk("9999" not in rows[0]["adp"], "unranked (999) players are dropped, not stored as noise")
    chk(rows[0]["ecr"]["ppr"]["joe burrow"] == 40 and "junk" not in rows[0]["ecr"],
        "ECR ranks stored per format; malformed blocks skipped")

print(f"\nRESULT: {passed}/{passed+failed} {'ALL PASS' if failed == 0 else 'SOME FAILED'}")
sys.exit(0 if failed == 0 else 1)
