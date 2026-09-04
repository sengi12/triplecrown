#!/usr/bin/env python3
"""Tests for tools/tc_mcp.py — the MCP server over TripleCrown's data.

Runs on a small synthetic seed (no network), plus one guarded smoke check on
the real seed when it is present. Covers: name normalisation, lookup (exact /
id / substring / fuzzy / position), the grounding sheet, head-to-head deltas,
compare/rankings/team tools, format-awareness (superflex board), and the
JSON-RPC/MCP transport itself (initialize, notifications, tools/list,
tools/call, errors, resources, lazy data loading).
"""
import io
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import tc_mcp as M  # noqa: E402

RESULTS = []


def check(name, ok, detail=""):
    ok = bool(ok)
    RESULTS.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}: {name}{'' if ok else ' — ' + str(detail)[:300]}")


def row(name, pid, pos, team, adp, **st):
    r = {"name": name, "player_id": pid, "pos": pos, "team": team, "age": 26,
         "adp": adp, "adp_ppr": adp, "adp_half_ppr": adp, "adp_2qb": adp, "adp_std": adp,
         "games_played": 17, "risk": 3, "upside": 4,
         "passing_yards": 0, "passing_touchdowns": 0, "passing_attempts": 0, "interceptions_thrown": 0,
         "rushing_yards": 0, "rushing_tds": 0, "rushing_attempts": 0,
         "receiving_targets": 0, "receptions": 0, "receiving_yards": 0, "receiving_tds": 0}
    r.update(st)
    return r


def synthetic_seed():
    teams = {"DET": {"QB": [], "RB": [], "WR": [], "TE": []}, "BAL": {"QB": [], "RB": [], "WR": [], "TE": []}}
    # Enough depth that replacement level exists at every position.
    adp = 1
    teams["DET"]["RB"].append(row("Jahmyr Gibbs", "9221", "RB", "DET", adp, rushing_attempts=255, rushing_yards=1251,
                                  rushing_tds=12, receiving_targets=97, receptions=63, receiving_yards=533, receiving_tds=3,
                                  tc={"fpg": 21.4, "base": 19.5, "in": {"yr": 2025, "g": 17, "fpg": 21.6, "xfpg": 18.0, "tdoe": 7.3}}))
    teams["BAL"]["RB"].append(row("Derrick Henry", "4199", "RB", "BAL", 30, rushing_attempts=281, rushing_yards=1406,
                                  rushing_tds=12, receiving_targets=26, receptions=17, receiving_yards=133, receiving_tds=1,
                                  tc={"fpg": 16.4, "base": 14.9}))
    teams["DET"]["QB"].append(row("Jared Goff", "4037", "QB", "DET", 90, passing_yards=4300, passing_touchdowns=30,
                                  passing_attempts=560, interceptions_thrown=10, rushing_yards=40))
    teams["BAL"]["QB"].append(row("Lamar Jackson", "4881", "QB", "BAL", 12, passing_yards=3900, passing_touchdowns=36,
                                  passing_attempts=480, interceptions_thrown=6, rushing_yards=800, rushing_tds=5))
    teams["DET"]["WR"].append(row("Amon-Ra St. Brown", "7547", "WR", "DET", 9, receiving_targets=150, receptions=110,
                                  receiving_yards=1250, receiving_tds=9))
    teams["DET"]["TE"].append(row("Sam LaPorta", "11596", "TE", "DET", 59, receiving_targets=100, receptions=70,
                                  receiving_yards=780, receiving_tds=6))
    teams["BAL"]["WR"].append(row("Zay Flowers", "10850", "WR", "BAL", 48, receiving_targets=120, receptions=80,
                                  receiving_yards=1050, receiving_tds=5))
    # Filler so the 12-team replacement level is defined at each position.
    for i in range(40):
        for pos, tm in (("RB", "DET"), ("WR", "BAL"), ("QB", "BAL"), ("TE", "BAL")):
            a = 100 + i * 4 + {"RB": 0, "WR": 1, "QB": 2, "TE": 3}[pos]
            st = ({"rushing_attempts": 120 - i * 2, "rushing_yards": 500 - i * 10, "rushing_tds": 3, "receptions": 20,
                   "receiving_targets": 25, "receiving_yards": 150} if pos == "RB" else
                  {"receiving_targets": 80 - i, "receptions": 50 - i, "receiving_yards": 600 - i * 10, "receiving_tds": 3} if pos in ("WR", "TE") else
                  {"passing_yards": 3000 - i * 30, "passing_touchdowns": 18, "passing_attempts": 450, "interceptions_thrown": 10})
            teams[tm][pos].append(row(f"Filler {pos}{i}", f"f{pos}{i}", pos, tm, a, **st))
    return {
        "season": 2026, "builder_version": "test", "state": {"season": 2026, "season_type": "regular", "week": 3, "asof": "x"},
        "seed": teams,
        "ecr": {"ppr": {"jahmyr gibbs": {"rank_ecr": 2, "tier": 1}, "derrick henry": {"rank_ecr": 20, "tier": 4},
                        "amonra st brown": {"rank_ecr": 5, "tier": 1}, "lamar jackson": {"rank_ecr": 30, "tier": 5}},
                "superflex": {"lamar jackson": {"rank_ecr": 2, "tier": 1}, "jahmyr gibbs": {"rank_ecr": 3, "tier": 1}},
                "dynasty": {"jahmyr gibbs": {"rank_ecr": 1, "tier": 1}, "lamar jackson": {"rank_ecr": 9, "tier": 2}}},
        "contracts": {"derrick henry": {"apy": 15000000, "fa": 2028}, "lamar jackson": {"apy": 52000000, "fa": 2028}},
        "sos": {"DET": {"rank": 1, "win_total": 10.5, "name": "Detroit Lions"},
                "BAL": {"rank": 7, "win_total": 11.5, "name": "Baltimore Ravens"}},
        "team_names": {"DET": "Detroit Lions", "BAL": "Baltimore Ravens"},
        "coordinators": {"BAL": {"offense": {"name": "Declan Doyle", "since": 2026, "is_new": True,
                                             "prev_role": "offensive coordinator", "prev_team_name": "Chicago Bears"}},
                         "DET": {"offense": {"name": "Drew Petzing", "since": 2026, "is_new": False}}},
        "hc_history": {"DET": {"name": "Dan Campbell", "since": 2021, "is_new": False}},
        "hc_playcallers": {},
        "additions": {"DET": {"free_agents": [{"player": "Isiah Pacheco", "pos": "RB", "kind": "free_agent"}],
                              "trades": [{"player": "David Montgomery", "pos": "RB", "detail": "Traded to HOU from DET for x"},
                                         {"player": "Juice Scruggs", "pos": "G", "detail": "Traded to DET from HOU"}],
                              "draft": [], "free_agents_lost": [{"player": "David Montgomery", "pos": "RB", "to_team": "HOU"}]}},
        "dynasty_values": {"players": {"jahmyr gibbs": {"v": 60, "sf": None}, "lamar jackson": {"v": 40, "sf": 90}}},
        "history": {"sf": ["games_played", "games_started", "off_snaps", "team_off_snaps", "receptions", "receiving_yards",
                           "receiving_touchdowns", "receiving_targets", "rushing_yards", "rushing_attempts", "rushing_touchdowns"],
                    "players": {"9221": ["Jahmyr Gibbs", "RB", {"2025": [["DET", 17, 17, None,
                                                                          [17, 17, 700, 1100, 60, 500, 3, 80, 1200, 240, 11]]],
                                                                "2024": [["DET", 17, 12, None, [17, 12, 600, 1100, 52, 517, 4, 63, 1412, 250, 16]]],
                                                                "2021": [["DET", 0, 0, None, []]]}]}},
        "nflverse": {"rt": [], "years": {"2025": {"qb_charting": {"players": {"jaredgoff": {"on_tgt_pct": 80.1, "bad_throw_pct": 12.3,
                                                                                            "intw_pct": 2.1, "pressure_pct": 20.0}}}}}},
    }


def synthetic_inseason():
    det = {str(w): "OPP" for w in range(1, 19)}
    del det["6"]
    bal = {str(w): "OPP" for w in range(1, 19)}
    del bal["13"]
    det["3"], det["4"] = "NYJ", "CAR"
    return {"schedule": {"DET": det, "BAL": bal}}


def make(fmt="ppr"):
    return M.TripleCrown(seed=synthetic_seed(), inseason=synthetic_inseason(), fmt=fmt)


def test_norm():
    check("ecr_norm apostrophe", M.ecr_norm("Ja'Marr Chase") == "jamarr chase")
    check("ecr_norm suffix + periods", M.ecr_norm("Marvin Harrison Jr.") == "marvin harrison")
    check("ecr_norm initials", M.ecr_norm("A.J. Brown") == "aj brown")
    check("ecr_norm hyphen", M.ecr_norm("Amon-Ra St. Brown") == "amonra st brown")
    byes = M.byes_from_schedule(synthetic_inseason()["schedule"])
    check("byes from schedule", byes == {"DET": 6, "BAL": 13}, byes)


def test_lookup():
    d = make()
    check("exact name", d.one("Jahmyr Gibbs")["player_id"] == "9221")
    check("by id", d.one("4199")["name"] == "Derrick Henry")
    check("substring", d.one("henry")["name"] == "Derrick Henry")
    check("misspelling", (d.one("Jamir Gibs") or {}).get("name") == "Jahmyr Gibbs", d.one("Jamir Gibs"))
    check("pos filter", d.one("Filler", pos="TE")["pos"] == "TE")
    check("empty query", d.find("") == [] and d.find(None) == [])
    check("limit honoured", len(d.find("Filler", limit=3)) == 3)
    check("search text", "VOR" in d.t_search("gibbs") and "id 9221" in d.t_search("gibbs"))
    check("search miss", "No player" in d.t_search("zzzz"))


def test_sheet():
    d = make()
    s = d.sheet(d.one("Jahmyr Gibbs"))
    for frag in ("Jahmyr Gibbs (RB, DET; age 26)", "expert consensus rank 2", "market ADP 1", "tier 1",
                 "TC model", "SOS rank 1 of 32", "bye: week 6", "255 carries", "97 targets", "FP/gm",
                 "TC model inputs: 2025", "2025 DET: 17 gm", "2024 DET: 17 gm", "schedule: wk3 NYJ, wk4 CAR",
                 "dynasty value: 60 (1QB)", "risk 3/5"):
        check(f"sheet has {frag!r}", frag in s, s)
    check("sheet skips seasons with no games", "2021" not in s)
    check("sheet hides None dynasty sf", "None" not in s, s)
    h = d.sheet(d.one("Derrick Henry"))
    check("sheet contract", "$15M/yr through 2027 (FA 2028)" in h, h)
    check("sheet new OC", "new offensive coordinator: Declan Doyle" in h, h)
    g = d.sheet(d.one("Jared Goff"))
    check("QB stat line", "4300 pass yds" in g and "30 pass TD" in g and "10 INT" in g, g)
    check("QB charting", "2025 charting: on-target 80.1%" in g, g)
    check("no OC line when not new", "new offensive coordinator" not in g)


def test_deltas_and_compare():
    d = make()
    a, b = d.one("Jahmyr Gibbs"), d.one("Derrick Henry")
    lines, close = d.deltas(a, b)
    txt = "\n".join(lines)
    check("deltas: targets to Gibbs", "targets: Jahmyr Gibbs by 71" in txt, txt)
    check("deltas: carries to Henry", "carries: Derrick Henry by 26" in txt, txt)
    check("deltas: market", "drafters take Jahmyr Gibbs 29 picks earlier" in txt, txt)
    check("deltas: schedule", "easier season schedule: Jahmyr Gibbs (SOS 1 vs 7)" in txt, txt)
    check("deltas: board value line present", any(l.startswith("board value") for l in lines), txt)
    check("deltas: tc model", "TC model: Jahmyr Gibbs by" in txt, txt)
    c = d.t_compare("gibbs", "henry", "Round 1?")
    for frag in ("League: 12-team ppr", "PLAYER A", "PLAYER B", "COMPUTED HEAD-TO-HEAD DIFFERENCES",
                 "How to answer", "Question: Round 1?", "PICK:"):
        check(f"compare has {frag!r}", frag in c, c)
    check("compare default question", "Question: Who should I take?" in d.t_compare("gibbs", "henry"))
    check("compare missing player", "No player matches 'nobody'" in d.t_compare("gibbs", "nobody"))
    # Two near-identical players read as tied.
    e = synthetic_seed()
    twin = dict(e["seed"]["DET"]["RB"][0], name="Twin Gibbs", player_id="9999", adp=2, adp_ppr=2, adp_2qb=2)
    e["seed"]["DET"]["RB"].append(twin)
    d2 = M.TripleCrown(seed=e, inseason=synthetic_inseason())
    lines2, close2 = d2.deltas(d2.one("Jahmyr Gibbs"), d2.one("Twin Gibbs"))
    check("tie detected", close2 and "EFFECTIVELY TIED" in lines2[0], lines2)
    check("tie framing in compare", "CANNOT be the answer" in d2.t_compare("Jahmyr Gibbs", "Twin Gibbs"))


def test_rankings_and_formats():
    d = make()
    r = d.t_rankings(limit=5)
    rows = [l for l in r.splitlines()[1:-1]]
    check("rankings 5 rows", len(rows) == 5, r)
    check("rankings top is Gibbs by VOR", "Jahmyr Gibbs" in rows[0], r)
    check("rankings ECR/tier filled", "  2 1" in rows[0], rows[0])
    check("rankings footer", "replacement level per week" in r)
    check("rankings pos filter", all("QB" in l for l in d.t_rankings(pos="qb", limit=3).splitlines()[1:-1]))
    adp = d.t_rankings(sort="adp", limit=3).splitlines()[1:-1]
    check("rankings sort=adp", "Jahmyr Gibbs" in adp[0] and "Amon-Ra" in adp[1], adp)
    check("rankings bad sort", "unknown sort" in d.t_rankings(sort="zzz"))
    sf = make("superflex")
    qb_ppr = d.board["4881"].vor
    qb_sf = sf.board["4881"].vor
    check("superflex lifts QB VOR", qb_sf > qb_ppr, (qb_ppr, qb_sf))
    check("superflex ECR table", "expert consensus rank 2" in sf.sheet(sf.one("Lamar Jackson")))
    check("superflex ADP board", sf.fmt == "superflex" and "SUPER_FLEX1" in sf.t_state(), sf.t_state())
    check("state lists gaps", "not in this server" in d.t_state())
    # dynasty is the app's other league type: half-PPR board, dynasty ECR, sortable by trade value
    dy = make("dynasty")
    check("dynasty: half-PPR ADP board, no superflex slot", dy.fmt == "dynasty" and dy.adp_fmt == "half_ppr"
          and "ADP board: half_ppr" in dy.t_state() and "SUPER_FLEX" not in dy.t_state(), dy.t_state())
    check("dynasty ECR table", "expert consensus rank 1" in dy.sheet(dy.one("Jahmyr Gibbs")))
    dyn = dy.t_rankings(sort="dynasty", limit=3)
    rows = dyn.splitlines()[1:-1]
    check("dynasty sort: 1QB trade value leads", "Jahmyr Gibbs" in rows[0] and rows[0].rstrip().endswith("60")
          and "Lamar Jackson" in rows[1] and "1QB)" in dyn, dyn)
    dsf = make("dynasty_superflex")
    dsf_rows = dsf.t_rankings(sort="dynasty", limit=3).splitlines()
    check("dynasty superflex: superflex values, QB first", "SUPER_FLEX1" in dsf.t_state() and "ADP board: superflex" in dsf.t_state()
          and "Lamar Jackson" in dsf_rows[1] and dsf_rows[1].rstrip().endswith("90") and "superflex)" in dsf_rows[-1], dsf_rows)
    check("dynasty superflex ECR falls back to dynasty", "expert consensus rank 9" in dsf.sheet(dsf.one("Lamar Jackson")))
    check("every app format is a league", set(M.FORMATS) == {"ppr", "half_ppr", "std", "superflex", "dynasty", "dynasty_superflex"})
    try:
        M.synthetic_league("bestball")
        check("bad format rejected", False)
    except ValueError:
        check("bad format rejected", True)


def test_team_schedule_sos():
    d = make()
    t = d.t_team("det")
    for frag in ("Detroit Lions (DET)", "SOS rank 1", "bye: week 6", "head coach: Dan Campbell", "RB: Jahmyr Gibbs",
                 "+Isiah Pacheco (RB, free_agent)", "-David Montgomery (RB → HOU, trade)", "schedule: wk1 OPP"):
        check(f"team has {frag!r}", frag in t, t)
    check("team dedupes departure", t.count("David Montgomery") == 1, t)
    check("team skips non-skill trade", "Scruggs" not in t)
    check("team by name", "Baltimore Ravens (BAL)" in d.t_team("ravens"))
    check("team unknown", "Unknown team" in d.t_team("XXX"))
    s = d.t_schedule("BAL", from_week=12)
    check("schedule from week", s.splitlines()[1].startswith("wk12") and "wk13 BYE" in s, s)
    check("schedule opp win total", "(opp win total" not in s or "OPP" in s)
    check("schedule unknown", "No schedule" in d.t_schedule("XXX"))
    so = d.t_sos()
    check("sos ordered", so.splitlines()[1].startswith(" 1 DET") and " 7 BAL" in so, so)


def test_call_tool_covers_every_tool():
    srv = M.Server(lambda: make())
    args = {"search_players": {"query": "gibbs"}, "get_player": {"name": "gibbs"},
            "compare": {"a": "gibbs", "b": "henry"}, "team": {"team": "DET"}, "schedule": {"team": "DET"}}
    for t in M.TOOLS:
        try:
            out = srv.call_tool(t["name"], args.get(t["name"], {}))
            check(f"tool {t['name']} dispatches", isinstance(out, str) and out, out)
        except Exception as e:
            check(f"tool {t['name']} dispatches", False, e)
        check(f"tool {t['name']} schema", t["inputSchema"]["type"] == "object" and t["description"])


def test_protocol():
    loads = []

    def factory():
        loads.append(1)
        return make()

    srv = M.Server(factory)
    r = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}}})
    check("initialize echoes known version", r["result"]["protocolVersion"] == "2025-06-18", r)
    check("initialize advertises tools", "tools" in r["result"]["capabilities"] and r["result"]["serverInfo"]["name"] == "triplecrown")
    check("initialize is lazy (no seed load)", loads == [], loads)
    r = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "1999-01-01"}})
    check("unknown version falls back", r["result"]["protocolVersion"] == "2024-11-05", r)
    check("notification gets no response", srv.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
          and srv.initialized)
    r = srv.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    names = [t["name"] for t in r["result"]["tools"]]
    check("tools/list", names == [t["name"] for t in M.TOOLS] and "compare" in names, names)
    check("tools/list still lazy", loads == [])
    r = srv.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                    "params": {"name": "get_player", "arguments": {"name": "henry"}}})
    check("tools/call text content", r["result"]["content"][0]["type"] == "text"
          and "Derrick Henry" in r["result"]["content"][0]["text"] and r["result"]["isError"] is False, r)
    check("data loaded once on first call", loads == [1])
    r = srv.handle({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "nope"}})
    check("unknown tool → -32602", r["error"]["code"] == -32602, r)
    r = srv.handle({"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                    "params": {"name": "rankings", "arguments": {"limit": "lots"}}})
    check("tool exception → isError result, not protocol error",
          "result" in r and r["result"]["isError"] is True and "ValueError" in r["result"]["content"][0]["text"], r)
    r = srv.handle({"jsonrpc": "2.0", "id": 6, "method": "bogus/method"})
    check("method not found → -32601", r["error"]["code"] == -32601, r)
    check("ping", srv.handle({"jsonrpc": "2.0", "id": 7, "method": "ping"})["result"] == {})
    r = srv.handle({"jsonrpc": "2.0", "id": 8, "method": "resources/list"})
    check("resources/list", r["result"]["resources"][0]["uri"] == "triplecrown://state")
    r = srv.handle({"jsonrpc": "2.0", "id": 9, "method": "resources/read", "params": {"uri": "triplecrown://state"}})
    check("resources/read", "TripleCrown seed" in r["result"]["contents"][0]["text"], r)
    r = srv.handle({"jsonrpc": "2.0", "id": 10, "method": "resources/read", "params": {"uri": "triplecrown://nope"}})
    check("resources/read unknown", "error" in r)
    check("data loaded once overall", loads == [1])

    # One server, every format: `format` rides the call, parity with the Worker.
    srv2 = M.Server(lambda fmt=None: make(fmt or "ppr"))
    tl = srv2.handle({"jsonrpc": "2.0", "id": 20, "method": "tools/list"})["result"]["tools"]
    check("every tool advertises the optional format",
          all(t["inputSchema"]["properties"].get("format", {}).get("enum") == sorted(M.FORMATS) for t in tl))
    base = srv2.handle({"jsonrpc": "2.0", "id": 21, "method": "tools/call",
                        "params": {"name": "rankings", "arguments": {"sort": "vor"}}})
    via = srv2.handle({"jsonrpc": "2.0", "id": 22, "method": "tools/call",
                       "params": {"name": "rankings", "arguments": {"sort": "vor", "format": "superflex"}}})
    sfd = M.Server(lambda fmt=None: make(fmt or "superflex"))
    path = sfd.handle({"jsonrpc": "2.0", "id": 23, "method": "tools/call",
                       "params": {"name": "rankings", "arguments": {"sort": "vor"}}})
    check("format-as-argument equals a server configured for that format",
          via["result"]["content"][0]["text"] == path["result"]["content"][0]["text"])
    check("and differs from the default format's answer",
          via["result"]["content"][0]["text"] != base["result"]["content"][0]["text"])
    bad = srv2.handle({"jsonrpc": "2.0", "id": 24, "method": "tools/call",
                       "params": {"name": "rankings", "arguments": {"format": "bestball"}}})
    check("a bad format names the real ones",
          bad["result"]["isError"] is True and "one of" in bad["result"]["content"][0]["text"])
    again = srv2.handle({"jsonrpc": "2.0", "id": 25, "method": "tools/call",
                         "params": {"name": "state", "arguments": {"format": "superflex"}}})
    check("a repeated format reuses its dataset", "result" in again and len(srv2._datasets) == 2)
    check("instructions teach the format argument", "optional format" in M.INSTRUCTIONS)
    # The stdio loop: one JSON per line, garbage answered with a parse error, output line-delimited.
    inp = io.StringIO('{"jsonrpc":"2.0","id":1,"method":"ping"}\n\nnot json\n'
                      '{"jsonrpc":"2.0","method":"notifications/cancelled"}\n'
                      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sos"}}\n')
    out = io.StringIO()
    M.Server(factory).serve(inp, out)
    lines = out.getvalue().splitlines()
    check("serve: one response per request line", len(lines) == 3, lines)
    check("serve: parse error", json.loads(lines[1])["error"]["code"] == -32700, lines[1])
    check("serve: tool result has no raw newlines", "\\n" in lines[2] and json.loads(lines[2])["id"] == 2, lines[2][:120])


def test_cli_kv():
    check("kv parse", M._parse_kv(["a=Chase Brown", "limit=5", "q=a=b"]) == {"a": "Chase Brown", "limit": 5, "q": "a=b"})


def test_real_seed_smoke():
    if not (os.path.exists(M.SEED_PATH) or os.path.exists(M.SEED_PATH + ".gz")):
        print("SKIP: real seed not present")
        return
    d = M.TripleCrown(fmt="superflex")
    check("real seed: board scored", len(d.board) >= 300, len(d.board))
    c = d.t_compare("Jahmyr Gibbs", "Bijan Robinson")
    check("real seed: compare grounded", "board value" in c and "expert consensus rank" in c, c[:400])
    check("real seed: ECR keyed on board", any(p.ecr for p in d.board.values()))


def test_bake():
    """--bake writes the shards the Cloudflare Worker serves; same answers, small files."""
    import tempfile
    with tempfile.TemporaryDirectory() as out:
        d = make("ppr")
        d.bake_shared(out)
        n = d.bake(out)
        man = M._load_json(os.path.join(out, "manifest.json"))
        check("bake: manifest tools/frame/instructions", man["tools"] == M.TOOLS and man["frame"] == M.ANALYST_FRAME
              and man["instructions"] == M.INSTRUCTIONS and man["teams"] == synthetic_seed()["team_names"])
        idx = M._load_json(os.path.join(out, "ppr", "index.json"))
        check("bake: one index row per player", n == len(idx) == len({r["id"] for r in idx}))
        g = next(r for r in idx if r["id"] == "9221")
        check("bake: index row = search line", g["line"] == d._row_line(d.one("9221")) and g["k"] == "jahmyrgibbs")
        pf = M._load_json(os.path.join(out, "p", "9221.json"))
        check("bake: player shard = sheet + facts", pf["by"]["ppr"]["sheet"] == d.sheet(d.one("9221"))
              and pf["by"]["ppr"]["f"]["vor"] == d.board["9221"].vor and pf["by"]["ppr"]["f"]["sos"] == 1)
        meta = M._load_json(os.path.join(out, "ppr", "meta.json"))
        check("bake: meta = state + league shape", meta["state"] == d.t_state() and meta["league"] == d.league.name)
        rk = M._load_json(os.path.join(out, "ppr", "rank", "RB.adp.json"))
        check("bake: rank table = t_rankings", "\n".join([rk["head"], *rk["rows"][:5], rk["foot"]]) == d.t_rankings("RB", 5, "adp"))
        check("bake: team shard", M._load_json(os.path.join(out, "ppr", "team", "DET.json"))["text"] == d.t_team("DET"))
        sch = M._load_json(os.path.join(out, "sched", "DET.json"))
        check("bake: schedule lines from week 1", sch["lines"][0][0] == 1 and sch["lines"][5][1].startswith("wk6  BYE"), sch["lines"][:6])
        check("bake: sos shard", M._load_json(os.path.join(out, "sos.json"))["text"] == d.t_sos())
        # a second format lands in the same player file
        make("superflex").bake(out)
        pf = M._load_json(os.path.join(out, "p", "9221.json"))
        check("bake: formats accumulate per player", set(pf["by"]) == {"ppr", "superflex"})


if __name__ == "__main__":
    test_norm()
    test_lookup()
    test_sheet()
    test_deltas_and_compare()
    test_rankings_and_formats()
    test_team_schedule_sos()
    test_call_tool_covers_every_tool()
    test_protocol()
    test_cli_kv()
    test_bake()
    test_real_seed_smoke()
    ok = all(RESULTS)
    print(f"RESULT: {'PASS' if ok else 'SOME FAILED'} ({sum(RESULTS)}/{len(RESULTS)})")
