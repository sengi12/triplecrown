

// ═══ TRIPLECROWN_SEED_START ═══ (build_seed.py / bake_seed.py replace this whole block)
// SEED_DATA intentionally empty — TripleCrown pulls the current projections live from Sleeper
// on first load (or load a prebuilt triplecrown_seed.json via the 📦 Seed button, or bake
// a seed straight into this file with bake_seed.py for a phone-friendly offline copy).
// Jan/Feb still belong to the previous league year (the season that just played its playoffs).
const _SEED_NOW = new Date();
const _SEED_YEAR_GUESS = Number(_SEED_NOW.getFullYear()) - (_SEED_NOW.getMonth() < 2 ? 1 : 0);
const SEED_SEASON = Number.isFinite(_SEED_YEAR_GUESS) ? _SEED_YEAR_GUESS : Number(new Date().getUTCFullYear());
// NFL state as of the seed build: {season, season_type, week, asof}. Lets a baked/offline copy
// know its season phase without a network probe. Empty by default.
const SEED_STATE = {};
const SEED_DATA = {};
const SEED_HISTORY = {};
const SEED_HISTORY_SEASONS = [];
const SEED_ECR = {};
const SEED_CONTRACTS = {};
const SEED_SHARP = {};
const SEED_SOS = {};
const SEED_TEAM_NAMES = {};
const SEED_COORDINATORS = {};
const SEED_HC_PLAYCALLERS = {};
const SEED_HC_HISTORY = {};
const SEED_ADDITIONS = {};
const SEED_SHARP_SEASON = SEED_SEASON - 1;
// SumerSports advanced per-player stats, per completed season (2022+). Empty by default —
// baked in by build_seed.py / loaded from triplecrown_seed.json.
const SEED_SUMER = {};
const SEED_SUMER_SEASONS = [];
// KeepTradeCut dynasty player-page slugs, {nameKey:{slug,pos}} — baked in / loaded from seed.
// Used to link a player card straight to their KTC dynasty page. Empty by default.
const SEED_KTC = {};
// FantasyPros dynasty trade values: {asof, source, players:{nameKey:{pos,team,v,sf?,tep?}},
// picks:{season:[[label,v1qb,vSF],...]}}. Powers the League Analyzer. Empty by default.
const SEED_DYNASTY_VALUES = {};
// nflverse-computed advanced metrics (opt-in `build_seed.py --nflverse`): a parallel A/B source
// shaped like Sharp (team tables) + Sumer (QB/RB player tables). Empty unless built with --nflverse.
const SEED_NFLVERSE = {};
// Heavy nflverse sections split into lazy-loaded sidecars (def_weekly, coaching_scheme). Empty in
// the shipped/online build (fetched on demand from triplecrown_seed.def_weekly.json /
// triplecrown_seed.coaching.json); re-embedded by bake_seed.py for the offline/baked file.
const SEED_NFLVERSE_DEF_WEEKLY = {};
const SEED_NFLVERSE_OL_WEEKLY = {};
const SEED_NFLVERSE_ADV_WEEKLY = {};
const SEED_NFLVERSE_COACHING = {};
// Current-season weekly sidecar (in-season only): weekly team aggregates, per-player weekly
// usage, defense-vs-position and the season schedule. Empty in the offseason and online
// (fetched lazily from triplecrown_seed.inseason.json); re-embedded by bake_seed.py.
const SEED_NFLVERSE_INSEASON = {};
// College production profiles for the incoming rookie class (build_seed.py --cfb): season
// lines + percentiles against past draft classes, keyed by Sleeper player id. Rookies have no
// NFL snaps to show, so this is the only production evidence their card can offer.
const SEED_CFB = {};
// Per-game college logs, split into a lazy sidecar (they're ~60% of the college payload and
// only read when one rookie's card is open). Re-embedded by bake_seed.py for the offline file.
const SEED_CFB_LOGS = {};
// ═══ TRIPLECROWN_SEED_END ═══

