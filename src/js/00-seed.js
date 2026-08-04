

// ═══ TRIPLECROWN_SEED_START ═══ (build_seed.py / bake_seed.py replace this whole block)
// SEED_DATA intentionally empty — TripleCrown pulls the current projections live from Sleeper
// on first load (or load a prebuilt triplecrown_seed.json via the 📦 Seed button, or bake
// a seed straight into this file with bake_seed.py for a phone-friendly offline copy).
const _SEED_YEAR_GUESS = Number(new Date().getFullYear());
const SEED_SEASON = Number.isFinite(_SEED_YEAR_GUESS) ? _SEED_YEAR_GUESS : Number(new Date().getUTCFullYear());
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
// ═══ TRIPLECROWN_SEED_END ═══

