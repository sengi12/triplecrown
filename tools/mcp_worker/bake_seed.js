#!/usr/bin/env node
// Bake the ENTIRE seed — the fantasy seed plus every sidecar — into the small JSON shards
// the Worker's seed_ls / seed_get / player_data tools read (see shards.js for the layout).
//
//   node tools/mcp_worker/bake_seed.js _site/mcp
//
// The seeds are decoded with the app's own decoder (src/js/15b-nflverse-lazy.js), so a path
// here is the same shape the browser sees; the few positional tables the app keeps as arrays
// (advanced-stat rows against a columns list, weekly rows against cols) are zipped into
// {column: value} objects so a model reads them without a legend. Runs at deploy in
// .github/workflows/pages.yml after tools/tc_mcp.py --bake; stdlib only.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { LIMIT, SEP, chunkIndex, dirOf, ecrNorm } from "./shards.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const { decodeAnySeed } = createRequire(import.meta.url)(path.join(ROOT, "src", "js", "15b-nflverse-lazy.js"));

// What each top-level section is — shown by seed_ls at the root so a model knows where to look.
export const DOC = {
  seed: "projection rows: seed/{TEAM}/{QB|RB|WR|TE} → players with season projections (passing/rushing/receiving), games, ADP per format (adp_ppr, adp_half_ppr, adp_std, adp_2qb), age, risk/upside 1-5, tc = TC model {fpg, base, in:{yr,g,fpg,xfpg,tdoe,age}}",
  ecr: "expert consensus ranks per format (half_ppr, ppr, std, superflex, superflex_ppr, dynasty, dynasty_superflex) keyed by normalized name → {rank_ecr, tier, age, team, pos}",
  history: "history/{sleeper_id} → {season: [stints {team, games_played, games_started, snap_pct, stats{receptions, receiving_yards, rushing_attempts, passing_yards, off_snaps, team_off_snaps…}}]}, 2021-2025, ~8.7k players",
  nflverse: "nflverse/{season}/… team (offense/defense/tendencies/pace/personnel/coverage/offensive_line_pass|run: per-team values + ranks), players/{POS}/players/{name} (advanced stats; …/refinements/{1st_down…pressured}/players/{name} by situation), routes (route tree per receiver), qb_passing (passer rating by field zone), qb_charting (on-target/bad-throw/pressure %), rb_fan (rush lanes + line grades), ol_players (line grades), head_coaches, rosters/{TEAM} (season roster with snaps)",
  cfb: "college profiles: cfb/players/{sleeper_id} → {name, pos, college, final, seasons:{yr:{dominator, tgt_share, epa_play, ypr…}}}; classes (pool sizes), prospect_meta (hit-rate model), labels",
  cfb_logs: "college game logs: cfb_logs/{sleeper_id}/{season} → [{wk, opp, opp_elo, tgt, n, yds, epa}]",
  contracts: "contracts/{normalized name} → {age, apy ($/yr), fa (free-agent year), total, gtd, pos}",
  additions: "additions/{TEAM} → offseason free_agents, draft, trades, free_agents_lost (all positions, $M)",
  ktc: "KeepTradeCut slug per player (dynasty value pages)",
  dynasty_values: "dynasty trade value chart: players/{normalized name} → {v: 1QB value, sf: superflex value, pos, team}; picks/{year}; asof, source",
  sharp: "team metrics for sharp_season: offense, tendencies, pace, defensive, defensive_line, defensive_tendencies, coverage_schemes, coverage_by_position, offensive_line → teams/{TEAM} {values, ranks}",
  coordinators: "coordinators/{TEAM} → offense/defense {name, since, prev_role, prev_team_name, is_new}",
  hc_history: "head coach per team {name, since, prev_role, prev_team_name, is_new}",
  hc_playcallers: "teams whose head coach calls the offensive plays",
  sos: "strength of schedule per team {rank (1 = easiest), win_total (Vegas), opp_win_total, opp_games}",
  team_names: "team code → full name",
  market_model: "the draft-sim market model fit (drafts, eps, tau, Brier, QB round-1 behaviour by format)",
  state: "season, season_type, week, asof of this seed",
  inseason: "current-season sidecar: schedule/{TEAM} → {week: opponent}; schedule_meta/{TEAM}/{week} → [opp, home(1)/away(0), day, time, date]; weekly blocks once the season runs",
  adv_weekly: "team advanced box scores by week: adv_weekly/{season}/teams/{TEAM}/{week} → {off_plays, off_epa, …} (95 columns, listed at adv_weekly/{season}/cols)",
  def_weekly: "individual defenders: def_weekly/{season}/{normalized name} → {name, team, pos, group, totals, weeks:[…]} (coverage targets, yards allowed, pressures, tackles)",
  ol_weekly: "offensive line by week: ol_weekly/{season}/teams/{TEAM}/{pass|run}/{week} → {dropbacks, pressures, stuffed…}",
  coaching: "coaching/{season}/{TEAM} → formations (personnel/alignment, route assignments per slot) and views (usage, pass rate, EPA and run lanes by formation group)",
  roster_moves_baseline: "frozen Spotrac capture of the offseason's moves, kept as a verification baseline",
  season: "the season these projections are for",
  builder_version: "version of the seed builder that wrote this file",
  history_seasons: "seasons covered by history and nflverse",
  sharp_season: "the season the sharp team metrics describe",
  sumer: "legacy SumerSports block (empty in current seeds)",
  sumer_seasons: "seasons the legacy sumer block covered",
};

const readJson = (p) => {
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  if (fs.existsSync(p + ".gz")) return JSON.parse(zlib.gunzipSync(fs.readFileSync(p + ".gz")).toString("utf8"));
  return null;
};
const zip = (cols, row) => { const o = {}; cols.forEach((c, i) => { if (row && row[i] !== undefined) o[c] = row[i]; }); return o; };
const ROSTER_COLS = ["name", "pos", "jersey", "yrs_exp", "age", "sleeper_id", "status", "snaps"];

// The positional tables the app leaves as arrays, made self-describing.
export function readable(root) {
  for (const yr of Object.keys(root.nflverse || {})) {
    const y = root.nflverse[yr];
    for (const pos of Object.keys(y.players || {})) {
      const blk = y.players[pos];
      if (!blk || !Array.isArray(blk.columns)) continue;
      const cols = blk.columns;
      const fix = tbl => { for (const n of Object.keys(tbl.players || {})) { const v = tbl.players[n]; if (v && Array.isArray(v.values)) tbl.players[n] = zip(cols, v.values); } delete tbl.columns; };
      fix(blk);
      for (const ref of Object.keys(blk.refinements || {})) fix(blk.refinements[ref]);
    }
    for (const tm of Object.keys(y.rosters || {})) y.rosters[tm] = (y.rosters[tm] || []).map(r => Array.isArray(r) ? zip(ROSTER_COLS, r) : r);
  }
  for (const yr of Object.keys(root.adv_weekly || {})) {
    const y = root.adv_weekly[yr];
    if (!y || !Array.isArray(y.cols)) continue;
    for (const tm of Object.keys(y.teams || {})) {
      const o = {}; (y.teams[tm] || []).forEach((row, i) => { if (row) o[String((y.weeks || [])[i] ?? i + 1)] = zip(y.cols, row); });
      y.teams[tm] = o;
    }
  }
  for (const yr of Object.keys(root.ol_weekly || {})) {
    const y = root.ol_weekly[yr];
    if (!y || !y.teams) continue;
    for (const tm of Object.keys(y.teams)) {
      const t = y.teams[tm] || {};
      for (const [side, cols] of [["pass", y.pass_cols], ["run", y.run_cols]]) {
        if (!Array.isArray(t[side]) || !Array.isArray(cols)) continue;
        const o = {}; t[side].forEach((row, i) => { if (row) o[String((y.weeks || [])[i] ?? i + 1)] = zip(cols, row); });
        t[side] = o;
      }
    }
  }
  return root;
}

// Everything TripleCrown ships, decoded, as one tree.
export function loadAll(seedDir) {
  const fantasy = readJson(path.join(seedDir, "triplecrown_seed.json"));
  if (!fantasy) throw new Error(`no seed in ${seedDir}`);
  const root = decodeAnySeed(fantasy);
  delete root.__codec;
  for (const side of ["inseason", "adv_weekly", "def_weekly", "ol_weekly", "cfb_logs"]) {
    const v = readJson(path.join(seedDir, `triplecrown_seed.${side}.json`));
    if (v) root[side] = decodeAnySeed(v);
  }
  const coaching = {};
  for (const f of fs.readdirSync(seedDir)) {
    const m = f.match(/^triplecrown_seed\.coaching\.(\d{4})\.json(\.gz)?$/);
    if (m && !coaching[m[1]]) coaching[m[1]] = decodeAnySeed(readJson(path.join(seedDir, `triplecrown_seed.coaching.${m[1]}.json`)));
  }
  if (Object.keys(coaching).length) root.coaching = coaching;
  const rm = readJson(path.join(seedDir, "roster_moves_baseline.json"));
  if (rm) root.roster_moves_baseline = rm;
  if (!root.market_model) { const mm = readJson(path.join(seedDir, "market_model.json")); if (mm) root.market_model = mm; }
  return readable(root);
}

const dump = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); };
const size = v => Buffer.byteLength(JSON.stringify(v === undefined ? null : v));

// Cut the tree into directories + chunks (layout in shards.js). Returns the tree map.
export function shard(root, outDir) {
  const tree = {};
  let files = 0;
  const visit = (node, parts) => {
    const isList = Array.isArray(node);
    const keys = isList ? node.map((_, i) => String(i)) : Object.keys(node);
    const sized = keys.map(k => { const v = isList ? node[+k] : node[k]; return [k, v, size(v)]; });
    const split = sized.filter(([, v, s]) => s > LIMIT && v && typeof v === "object").map(([k]) => k);
    const small = sized.reduce((a, [k, , s]) => a + (split.includes(k) ? 0 : s), 0);
    const rec = { t: isList ? "list" : "dict", n: keys.length, c: Math.max(1, Math.ceil(small / (LIMIT * 0.6))), split };
    tree[parts.join(SEP)] = rec;
    const chunks = Array.from({ length: rec.c }, () => ({}));
    for (const [k, v] of sized) {
      if (split.includes(k)) visit(v, [...parts, k]);
      else chunks[chunkIndex(rec, k)][k] = v;
    }
    const dir = path.join(outDir, dirOf(parts));
    dump(path.join(dir, "_ls.json"), { t: rec.t, n: rec.n, split, ...(isList ? {} : { keys }), ...(parts.length ? {} : { doc: DOC }) });
    chunks.forEach((ch, i) => dump(path.join(dir, `c${i}.json`), ch));
    files += 1 + rec.c;
  };
  visit(root, []);
  dump(path.join(outDir, "seed", "_tree.json"), tree);
  return { tree, files: files + 1 };
}

// One file per projected player with every table's entry for them, so player_data is a
// single read instead of a dozen.
export function playerData(root, outDir) {
  const byName = (tbl, n) => (tbl && tbl[n] !== undefined ? tbl[n] : undefined);
  let count = 0;
  for (const tm of Object.keys(root.seed || {})) {
    for (const pos of Object.keys(root.seed[tm] || {})) {
      for (const r of root.seed[tm][pos] || []) {
        const id = r && r.player_id != null ? String(r.player_id) : null;
        if (!id) continue;
        const n = ecrNorm(r.name);
        const sec = { projection: r };
        const ecr = {}; for (const f of Object.keys(root.ecr || {})) if (root.ecr[f] && root.ecr[f][n]) ecr[f] = root.ecr[f][n];
        if (Object.keys(ecr).length) sec.ecr = ecr;
        const put = (k, v) => { if (v !== undefined && v !== null) sec[k] = v; };
        put("contract", byName(root.contracts, n));
        put("ktc", byName(root.ktc, n));
        put("dynasty_value", byName(root.dynasty_values && root.dynasty_values.players, n));
        put("history", byName(root.history, id));
        const nv = {};
        for (const yr of Object.keys(root.nflverse || {})) {
          const y = root.nflverse[yr], o = {};
          const blk = y.players && y.players[r.pos];
          if (blk && blk.players && blk.players[n]) {
            o.stats = blk.players[n];
            const refs = {}; for (const ref of Object.keys(blk.refinements || {})) { const t = blk.refinements[ref]; if (t && t.players && t.players[n]) refs[ref] = t.players[n]; }
            if (Object.keys(refs).length) o.by_situation = refs;
          }
          for (const k of ["routes", "qb_passing", "rb_fan"]) if (y[k] && y[k][n]) o[k] = y[k][n];
          if (y.qb_charting && y.qb_charting.players && y.qb_charting.players[n]) o.qb_charting = y.qb_charting.players[n];
          for (const t of Object.keys(y.rosters || {})) { const row = (y.rosters[t] || []).find(x => x && String(x.sleeper_id) === id); if (row) { o.roster = { team: t, ...row }; break; } }
          if (Object.keys(o).length) nv[yr] = o;
        }
        if (Object.keys(nv).length) sec.nflverse = nv;
        put("cfb", byName(root.cfb && root.cfb.players, id));
        put("cfb_logs", byName(root.cfb_logs, id));
        dump(path.join(outDir, "pd", `${id}.json`), { n: r.name, pos: r.pos, team: r.team, sections: sec });
        count++;
      }
    }
  }
  return count;
}

export function bakeAll(outDir, seedDir = path.join(ROOT, "seeds")) {
  const root = loadAll(seedDir);
  fs.rmSync(path.join(outDir, "seed"), { recursive: true, force: true });
  fs.rmSync(path.join(outDir, "pd"), { recursive: true, force: true });
  const { tree, files } = shard(root, outDir);
  const players = playerData(root, outDir);
  return { sections: Object.keys(root).length, dirs: Object.keys(tree).length, files, players };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error("usage: bake_seed.js OUT_DIR [SEED_DIR]"); process.exit(2); }
  const r = bakeAll(out, process.argv[3]);
  console.error(`[bake_seed] ${r.sections} sections → ${r.dirs} directories, ${r.files} shard files, ${r.players} player files in ${out}`);
}
