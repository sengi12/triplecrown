"""Market-data archive: ADP + ECR snapshots, appended at seed-build time.

Market numbers are the one data source that already digests coaching news, injuries,
holdouts and scheme chatter — and the one source that CANNOT be backfilled. Each seed
build appends a dated snapshot so that, a few seasons from now, "does the TC model beat
the market / should it ensemble with it" becomes a testable question instead of a wish.

Format: archives/market/market_<season>.jsonl.gz — one gzip member per snapshot (gzip
concatenation is valid, so appends never rewrite history). Each line:
  {"d": "YYYY-MM-DD", "adp": {sleeper_pid: [ppr, half, std, 2qb]},
   "ecr": {format: {normalized_name: rank}}}
Cadence: a new line only when the newest entry is MIN_GAP_DAYS old — ADP granularity
finer than a few days is noise, and the file rides the repo, so lean matters.
"""
import gzip, json, os, time

MIN_GAP_DAYS = 3
STATE = "state.json"   # {"last": "YYYY-MM-DD"} beside the archive


def _round(v):
    try:
        f = float(v)
        return round(f, 1) if f < 999 else None
    except (TypeError, ValueError):
        return None


def append_snapshot(seed, ecr, season, root="archives/market", today=None):
    """Append today's snapshot unless one landed within MIN_GAP_DAYS. Returns a short
    status string for the build log. Fail-soft by contract: raises nothing the caller
    must handle beyond a generic except."""
    today = today or time.strftime("%Y-%m-%d", time.gmtime())
    os.makedirs(root, exist_ok=True)
    spath = os.path.join(root, STATE)
    try:
        with open(spath) as f:
            last = (json.load(f) or {}).get("last")
    except Exception:
        last = None
    if last:
        try:
            gap = (time.mktime(time.strptime(today, "%Y-%m-%d"))
                   - time.mktime(time.strptime(last, "%Y-%m-%d"))) / 86400
            if gap < MIN_GAP_DAYS:
                return f"archive current (last {last})"
        except Exception:
            pass

    adp = {}
    for team in (seed or {}).values():
        for rows in team.values():
            for p in rows:
                pid = p.get("player_id")
                if pid is None:
                    continue
                vals = [_round(p.get(k)) for k in ("adp_ppr", "adp_half_ppr", "adp_std", "adp_2qb")]
                if any(v is not None for v in vals):
                    adp[str(pid)] = vals
    ranks = {}
    for fmt, table in (ecr or {}).items():
        if isinstance(table, dict):
            ranks[fmt] = {name: row.get("rank_ecr") for name, row in table.items()
                          if isinstance(row, dict) and row.get("rank_ecr") is not None}
    line = json.dumps({"d": today, "adp": adp, "ecr": ranks},
                      separators=(",", ":")) + "\n"
    path = os.path.join(root, f"market_{season}.jsonl.gz")
    with open(path, "ab") as f:   # a fresh gzip member per snapshot — append-only history
        f.write(gzip.compress(line.encode("utf-8"), 9))
    with open(spath, "w") as f:
        json.dump({"last": today}, f)
    return f"archived {len(adp)} ADP rows + {sum(len(v) for v in ranks.values())} ECR ranks → {path}"


def read_archive(path):
    """Read every snapshot line from a .jsonl.gz archive (concatenated gzip members)."""
    out = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out
