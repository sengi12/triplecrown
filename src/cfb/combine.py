"""Combine percentiles + the fantasy-relevance model for college prospects.

Data: nflverse `combine.csv` (official combine results, 2000->present, with the player's
draft slot attached) and `draft_picks.csv` (pick + age at draft). Joined to the college
profiles by normalized name + position + draft-class year, school as tiebreaker.

The model is NOT trained here. `prospect_model.json` carries frozen artifacts — per
position: feature medians, standardizer, logistic coefficients, and isotonic calibration
knots — trained offline on the 2000-2022 drafted cohort (HIT = a top-12 QB/TE / top-24
RB/WR PPR season within the player's first three years; calibration verified against
held-out classes). Scoring is pure math, so this stays deployable from the stdlib-shaped
seed pipeline (pandas is already required by the cfb block this rides in).

Honesty rules: an undrafted player is scored at pick 263 (below the last real pick), a
missing drill uses the trained median WITH its missing-flag set (skipping a drill was
itself a signal in training), and the popup copy in the app owns the caveats.
"""
import json
import math
import os

from . import link
# pandas is imported lazily inside the data-touching functions so the pure-math scoring
# (score, _percentile, _ht_inches) stays importable from the stdlib-only test runner.

COMBINE_URL = "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv"
DRAFT_URL = "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv"

POSITIONS = ("QB", "RB", "WR", "TE")
# stat -> lower_is_better
STATS = {
    "forty": True, "cone": True, "shuttle": True,
    "vertical": False, "broad_jump": False, "bench": False,
    "wt": False, "ht_in": False,
}
UNDRAFTED_PICK = 263

_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        with open(os.path.join(os.path.dirname(__file__), "prospect_model.json")) as f:
            _MODEL = json.load(f)
    return _MODEL


def _cached_csv(name, url, refresh):
    import pandas as pd
    path = os.path.join(link.CACHE_DIR, name)
    if refresh or not os.path.exists(path):
        import urllib.request
        os.makedirs(link.CACHE_DIR, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "triplecrown-seed"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    return pd.read_csv(path, low_memory=False)


def _ht_inches(h):
    try:
        if isinstance(h, str) and "-" in h:
            f, i = h.split("-")
            return int(f) * 12 + int(i)
        v = float(h)
        return v if v == v else None
    except Exception:
        return None


def _load(refresh=False):
    import pandas as pd
    comb = _cached_csv("combine.csv", COMBINE_URL, refresh)
    comb = comb[comb["pos"].isin(POSITIONS)].copy()
    comb["ht_in"] = comb["ht"].map(_ht_inches)
    comb["nm"] = comb["player_name"].map(link.norm_name)
    draft = _cached_csv("draft_picks.csv", DRAFT_URL, refresh)
    draft = draft[draft["position"].isin(POSITIONS)].copy()
    draft["nm"] = draft["pfr_player_name"].map(link.norm_name)
    return comb, draft


def _pct_tables(comb):
    import pandas as pd
    """Per position, per stat: a SORTED value array over the full 2000+ population."""
    tables = {}
    for pos in POSITIONS:
        sub = comb[comb["pos"] == pos]
        tables[pos] = {}
        for stat in STATS:
            vals = pd.to_numeric(sub[stat], errors="coerce").dropna().sort_values().tolist()
            if len(vals) >= 40:
                tables[pos][stat] = vals
    return tables


def _percentile(sorted_vals, v, lower_better):
    import bisect
    n = len(sorted_vals)
    if not n:
        return None
    lo = bisect.bisect_left(sorted_vals, v)
    hi = bisect.bisect_right(sorted_vals, v)
    frac = ((lo + hi) / 2) / n            # midrank fraction below/at v
    pct = (1 - frac) * 100 if lower_better else frac * 100
    return max(1, min(99, round(pct)))


def score(pos, pick, age, forty, wt, vertical, broad_jump, extras=None):
    """Calibrated hit probability from the frozen artifacts. Pure math.
    `extras` supplies any position-specific college signals the artifacts ask for
    (f_succ, f_comp_pct, f_yptpa, dom_teamadj); absent ones fall back to the
    training median with their missing-flag set."""
    a = _model().get(pos)
    if not a:
        return None
    speed = (wt * 200 / forty ** 4) if (forty and wt) else None
    burst = (vertical + broad_jump) if (vertical is not None and broad_jump is not None) else None
    raw = {"log_pick": math.log2(max(1, min(300, pick))) if pick else None,
           "age": age, "speed_score": speed, "burst": burst}
    for k, v in (extras or {}).items():
        raw[k] = v
    x = []
    for f in a["features"]:
        if f.endswith("_m"):
            x.append(1.0 if raw.get(f[:-2]) is None else 0.0)
        else:
            v = raw.get(f)
            x.append(a["median"][f] if v is None else float(v))
    z = a["intercept"]
    for xi, m, s, c in zip(x, a["mu"], a["sd"], a["coef"]):
        z += (xi - m) / s * c
    p = 1 / (1 + math.exp(-z))
    ks = a["iso"]
    out = ks[-1][1]
    for i in range(len(ks) - 1):
        if p <= ks[i + 1][0]:
            x0, y0 = ks[i]
            x1, y1 = ks[i + 1]
            t = (p - x0) / (x1 - x0) if x1 > x0 else 0
            out = y0 + (y1 - y0) * t
            break
    # Epistemic clamp: with cohorts this size the model never gets to claim (near-)certainty
    # in either direction, however clean a top bucket looks.
    return round(min(0.97, max(0.01, out)), 4)


def pctl_of(pos, prob):
    """Percentile of a calibrated probability vs the position's training cohort (1-99)."""
    a = _model().get(pos)
    q = (a or {}).get("pctl")
    if not q or prob is None:
        return None
    import bisect
    lo = bisect.bisect_left(q, prob)
    hi = bisect.bisect_right(q, prob)
    frac = ((lo + hi) / 2) / (len(q) - 1)
    return max(1, min(99, round(frac * 100)))


def college_extras(prof, teammate_cap):
    """Position-specific college signals for score(), read off a profile's final season."""
    fin = ((prof.get("seasons") or {}).get(str(prof.get("final"))) or {}) if prof else {}
    ex = {}
    if prof and prof.get("pos") == "QB":
        if isinstance(fin.get("succ"), (int, float)):
            ex["f_succ"] = fin["succ"]
        if isinstance(fin.get("comp_pct"), (int, float)):
            ex["f_comp_pct"] = fin["comp_pct"]
    if prof and prof.get("pos") == "TE":
        if isinstance(fin.get("yptpa"), (int, float)):
            ex["f_yptpa"] = fin["yptpa"]
        if isinstance(fin.get("dominator"), (int, float)):
            ex["dom_teamadj"] = fin["dominator"] * (1 + 0.5 * (teammate_cap or 0))
    return ex


def team_logo_map():
    """{normalized college name: espn ncaa team id} from the committed ESPN teams list
    (src/cfb/espn_college_teams.json — refresh by re-pulling ESPN's college-football teams
    API; the list changes ~never). Every name variant maps, plus a parenthetical-stripped
    alias so Sleeper's 'Miami (FL)' finds the same id as ESPN's 'Miami'. Stdlib only."""
    import re as _re
    import unicodedata as _u
    def _n(x):
        x = _u.normalize("NFKD", str(x or "")).encode("ascii", "ignore").decode()
        return _re.sub(r"[^a-z0-9]", "", x.lower())
    path = os.path.join(os.path.dirname(__file__), "espn_college_teams.json")
    with open(path) as f:
        teams = json.load(f)
    m = {}
    # Pass 1: EXACT name variants only. Pass 2: stripped aliases fill gaps but never
    # override an exact claim — otherwise Miami (OH)'s stripped alias steals 'miami'
    # from the Hurricanes, whose exact name it is.
    for t in teams:
        tid = t.get("id")
        for name in t.get("names") or []:
            k = _n(name)
            if k and k not in m:
                m[k] = tid
    for t in teams:
        tid = t.get("id")
        for name in t.get("names") or []:
            name = str(name)
            for variant in (_re.sub(r"\s*\(.*?\)", "", name), name.split(",")[0],
                            name.replace(" State", " St"),        # Sleeper's 'Utah St.' style
                            name.replace(" St", " State")):        # …and ESPN's clipped 'App State'
                k = _n(variant)
                if k and k not in m:
                    m[k] = tid
    # Curated Sleeper-isms that no mechanical rule reaches (alias -> the key ESPN answers to).
    for alias, target in {"northcarolinastate": "ncstate", "mcneesestate": "mcneese",
                          "appalachianstate": "appstate", "centralflorida": "ucf",
                          "louisianamonroe": "ulmonroe", "mississippi": "olemiss",
                          "southerncalifornia": "usc", "brighamyoung": "byu"}.items():
        if target in m and alias not in m:
            m[alias] = m[target]
    return m


def _match(rows, nm, college):
    """Best row for a normalized name: school agreement breaks ties."""
    cand = rows[rows["nm"] == nm]
    if len(cand) == 0:
        return None
    if len(cand) > 1 and college:
        nc = link.norm_college(college)
        col = "school" if "school" in cand.columns else "college"
        pref = cand[cand[col].map(lambda s: link.norm_college(s) == nc)]
        if len(pref):
            cand = pref
    return cand.iloc[0]


def build(profile_players, refresh=False, verbose=True):
    import pandas as pd
    """`profile_players`: the cfb block's {pid: profile} map. Returns (per_pid, meta)."""
    comb, draft = _load(refresh)
    tables = _pct_tables(comb)
    out = {}
    matched_comb = matched_draft = 0
    for pid, prof in profile_players.items():
        pos = prof.get("pos")
        cls = prof.get("class")
        if pos not in POSITIONS or not cls:
            continue
        nm = link.norm_name(prof.get("name"))
        c = _match(comb[(comb["draft_year"] == cls) & (comb["pos"] == pos)], nm, prof.get("college"))
        d = _match(draft[(draft["season"] == cls) & (draft["position"] == pos)], nm, prof.get("college"))
        pick = None
        age = None
        if d is not None:
            pick = int(d["pick"]) if pd.notna(d["pick"]) else None
            age = float(d["age"]) if pd.notna(d.get("age")) else None
            matched_draft += 1
        if pick is None and c is not None and pd.notna(c.get("draft_ovr")):
            pick = int(c["draft_ovr"])
        if pick is None:
            pick = UNDRAFTED_PICK
        stats = {}
        pct = {}
        if c is not None:
            matched_comb += 1
            for stat, lower in STATS.items():
                v = pd.to_numeric(pd.Series([c.get(stat)]), errors="coerce").iloc[0]
                if pd.isna(v):
                    continue
                stats[stat] = round(float(v), 2)
                tab = tables.get(pos, {}).get(stat)
                if tab:
                    pct[stat] = _percentile(tab, float(v), lower)
        near = draft[(draft["college"] == prof.get("college")) &
                     (draft["season"].between(cls - 1, cls + 1))]
        tcap = float(sum(1 / math.sqrt(max(1, p)) for n2, p in zip(near["nm"], near["pick"])
                         if n2 != nm and p == p))
        extras = college_extras(prof, tcap)
        prob = score(pos, pick, age,
                     stats.get("forty"), stats.get("wt"),
                     stats.get("vertical"), stats.get("broad_jump"), extras)
        out[pid] = {
            "pick": None if pick == UNDRAFTED_PICK else pick,
            "age": round(age, 1) if age is not None else None,
            "stats": stats, "pct": pct,
            "prob": prob, "pctl": pctl_of(pos, prob),
            "x": {k: round(float(v), 3) for k, v in extras.items()},
        }
    meta = {
        "schema": 1,
        "source": "nflverse combine + draft_picks (2000+)",
        "model": {p: {"n": a["n"], "base_rate": a["base_rate"], "cohort": a["cohort"]}
                  for p, a in _model().items() if not p.startswith("_")},
        "ref_n": {p: len(comb[comb["pos"] == p]) for p in POSITIONS},
    }
    if verbose:
        print(f"    prospect model: {len(out)} scored "
              f"({matched_draft} draft matches, {matched_comb} combine matches)")
    return out, meta
