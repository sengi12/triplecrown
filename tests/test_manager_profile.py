#!/usr/bin/env python3
"""Unit tests for tools/manager_profile.py — the pure parts only (no network)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import manager_profile as mp  # noqa: E402

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}: {name}{'' if ok else ' — ' + str(detail)}")


def _draft(did, lid, season, teams, picks_by_slot, fmt="ppr"):
    """picks_by_slot: list of (pid, pos, by) in overall pick order."""
    picks = [{"no": i + 1, "pid": pid, "pos": pos, "by": by}
             for i, (pid, pos, by) in enumerate(picks_by_slot)]
    return {"draft": did, "league": str(lid), "season": str(season),
            "teams": teams, "rounds": max(1, len(picks) // teams),
            "format": fmt, "picks": picks}


def test_norm_round():
    check("pick 1 is round 1.0", mp.norm_round(1, 12) == 1.0)
    check("pick 13 of a 12-teamer opens round 2", mp.norm_round(13, 12) == 2.0)
    check("pick 11 of a 10-teamer closes round 1", abs(mp.norm_round(11, 10) - 2.0) < 1e-9)
    check("10- and 12-team rooms land on the same scale",
          abs(mp.norm_round(25, 12) - mp.norm_round(21, 10)) < 1e-9)


def _snake_order(teams, rounds):
    order = []
    for r in range(rounds):
        slots = range(1, teams + 1) if r % 2 == 0 else range(teams, 0, -1)
        order.extend(f"u{s}" for s in slots)
    return order


def _uniform_draft(did, lid, season, teams=4, rounds=6, shift=0):
    """Every room drafts p1..pN in the same order; `shift` rotates who picks."""
    order = _snake_order(teams, rounds)
    picks = []
    for i, by in enumerate(order):
        pos = ["RB", "WR", "QB", "TE"][i % 4]
        picks.append((f"p{(i + shift) % (teams * rounds)}", pos, by))
    return _draft(did, lid, season, teams, picks)


def test_consensus_and_reach():
    ds = [_uniform_draft(f"d{i}", 100 + i, 2025) for i in range(4)]
    cons = mp.build_consensus(ds)
    key = ("2025", "ppr")
    check("consensus keyed by season+format", key in cons)
    m, n = cons[key]["p0"]
    check("a player always taken 1.01 has consensus round 1.0", abs(m - 1.0) < 1e-9 and n == 4)
    f = mp.draft_features(ds[0], "u1", cons)
    check("a pure-consensus draft has ~zero reach", f is not None and abs(f["reach"]) < 1e-9)
    check("and is flagged as autodraft (default-queue suspect)", f["autodraft"] is True)


def test_reacher_is_measured_and_not_autodraft():
    ds = [_uniform_draft(f"d{i}", 100 + i, 2025) for i in range(4)]
    # u1 in a fifth draft reaches: takes later players (higher index) early.
    reach = _uniform_draft("d9", 900, 2025, shift=6)
    ds.append(reach)
    cons = mp.build_consensus(ds[:4])
    f = mp.draft_features(reach, "u2", cons)
    check("reaching for later-consensus players yields positive reach",
          f is not None and f["reach"] is not None and f["reach"] >= 0.5)
    check("a real reacher is NOT flagged autodraft", f["autodraft"] is False)


def test_features_shape():
    ds = [_uniform_draft("d0", 100, 2025)]
    cons = mp.build_consensus(ds)
    f = mp.draft_features(ds[0], "u2", cons)
    check("open pair reads the first two picks (snake: pick 2 then pick 7)",
          f["open_pair"] == "WR-QB")
    check("first QB round recorded", f["first_qb"] == 2.5)
    check("a manager with no picks yields None",
          mp.draft_features(ds[0], "ghost", cons) is None)


def test_spearman():
    check("perfect order is +1", abs(mp.spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9)
    check("reversed order is -1", abs(mp.spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9)
    check("constant input is 0 not a crash", mp.spearman([1, 1, 1], [1, 2, 3]) == 0.0)


def test_transfer_rows_and_study():
    # 14 managers, each: one target-league draft + two other-league drafts.
    feats = {}
    for i in range(14):
        uid = f"m{i}"
        r = (i - 7) / 10.0            # stable personal reach, -0.7 .. +0.6
        mk = lambda lid, rr: {"draft": f"x{lid}{uid}", "league": str(lid),
                              "season": "2025", "format": "ppr",
                              "open_pair": "RB-RB" if i % 2 else "WR-WR",
                              "first_qb": 4.0 + r, "first_te": 6.0,
                              "rb_share8": 0.5 + r / 4.0,
                              "reach": rr, "n_reach_obs": 8, "autodraft": False}
        feats[uid] = [mk(1, r), mk(2, r + 0.02), mk(999, r - 0.01)]
    rows = mp.transfer_rows(feats, {"999"})
    check("every manager-season with a target draft + 2 others is a row", len(rows) == 14)
    v = mp.run_study(rows)
    check("stable reach transfers (spearman ~1, PASSES)",
          v["reach"]["pass"] is True and v["reach"]["spearman"] > 0.9)
    check("a stable RB-early habit beats the format baseline",
          v["rb_share8"]["pass"] is True)
    # Now scramble: reach in the target is noise — transfer must FAIL, not flatter us.
    for i, (uid, fs) in enumerate(feats.items()):
        fs[2]["reach"] = ((i * 7919) % 14 - 7) / 10.0
    v2 = mp.run_study(mp.transfer_rows(feats, {"999"}))
    check("noise in the target league does not pass the reach gate",
          v2["reach"]["pass"] is False)


def test_format_matching():
    mk = lambda lid, fmt: {"draft": f"f{lid}", "league": str(lid), "season": "2025",
                           "format": fmt, "open_pair": "RB-RB", "first_qb": 4.0,
                           "first_te": 6.0, "rb_share8": 0.5, "reach": 0.3,
                           "n_reach_obs": 8, "autodraft": False}
    feats = {"m1": [mk(1, "superflex"), mk(2, "superflex"), mk(999, "ppr")]}
    check("other-format drafts never vouch for a different market (v1's confound)",
          mp.transfer_rows(feats, {"999"}) == [])
    feats["m1"][0]["format"] = feats["m1"][1]["format"] = "ppr"
    check("same-format drafts do", len(mp.transfer_rows(feats, {"999"})) == 1)


def test_splithalf():
    import random
    rnd = random.Random(7)
    mk = lambda i, uid, fmt, r: {"draft": f"s{uid}{i}", "league": str(i), "season": str(2021 + i % 5),
                                 "format": fmt, "open_pair": "RB-RB", "first_qb": 3.0 + r,
                                 "first_te": 6.0, "rb_share8": 0.4 + r / 5.0,
                                 "reach": r, "n_reach_obs": 8, "autodraft": False}
    stable = {f"m{j}": [mk(i, f"m{j}", "ppr", (j - 7) / 10.0 + rnd.gauss(0, 0.02))
                        for i in range(6)] for j in range(14)}
    units = mp.splithalf_units(stable)
    check("every manager with >= 4 same-format drafts is a unit", len(units) == 14)
    v = mp.run_splithalf(units)
    check("stable traits pass all three split-half gates",
          all(v[k]["pass"] for k in ("reach", "first_qb", "rb_share8")))
    noisy = {f"m{j}": [mk(i, f"m{j}", "ppr", rnd.gauss(0, 0.5)) for i in range(6)]
             for j in range(14)}
    v2 = mp.run_splithalf(mp.splithalf_units(noisy))
    check("pure noise does not pass (the baseline is exactly r=0)",
          not v2["reach"]["pass"])
    thin = {"m1": [mk(i, "m1", "ppr", 0.3) for i in range(3)]}
    check("fewer than 4 drafts in a format is no unit", mp.splithalf_units(thin) == [])


def test_build_profiles():
    # 4 uniform + 3 shifted drafts: the shifted trio drags every pid's consensus
    # off both camps, so no draft sits exactly on it and none flags autodraft.
    ds = [_uniform_draft(f"d{i}", 100 + i, 2025) for i in range(4)]
    ds += [_uniform_draft(f"r{i}", 200 + i, 2025, shift=6) for i in range(3)]
    data = {"target_league_ids": ["100"], "managers": {"u2": "Bob", "u9": "Ghost"},
            "drafts": ds}
    out = mp.build_profiles(data)
    check("profiles carry the format means the deltas need",
          out["format_means"]["ppr"]["first_qb"] is not None)
    prof = out["managers"]["u2"]["ppr"]
    check("a manager's per-format entry carries n + all three traits",
          prof["n"] == 7 and prof["first_qb"] == 2.5 and prof["rb_share8"] is not None)
    check("a manager with no drafts is absent, not zeroed", "u9" not in out["managers"])


def test_autodrafts_excluded_from_transfer():
    feats = {"m1": [
        {"draft": "a", "league": "1", "season": "2025", "format": "ppr",
         "open_pair": "RB-RB", "first_qb": 4.0, "first_te": 6.0,
         "reach": 0.0, "n_reach_obs": 8, "autodraft": True},
        {"draft": "b", "league": "2", "season": "2025", "format": "ppr",
         "open_pair": "RB-RB", "first_qb": 4.0, "first_te": 6.0,
         "reach": 0.3, "n_reach_obs": 8, "autodraft": False},
        {"draft": "t", "league": "999", "season": "2025", "format": "ppr",
         "open_pair": "RB-RB", "first_qb": 4.0, "first_te": 6.0,
         "reach": 0.3, "n_reach_obs": 8, "autodraft": False},
    ]}
    check("autodraft evidence never counts toward a profile",
          mp.transfer_rows(feats, {"999"}) == [])


def main():
    test_norm_round()
    test_consensus_and_reach()
    test_reacher_is_measured_and_not_autodraft()
    test_features_shape()
    test_spearman()
    test_transfer_rows_and_study()
    test_format_matching()
    test_splithalf()
    test_build_profiles()
    test_autodrafts_excluded_from_transfer()
    total, passed = len(RESULTS), sum(RESULTS)
    print(f"\nRESULT: {passed}/{total} {'ALL PASS' if passed == total else 'SOME FAILED'}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
