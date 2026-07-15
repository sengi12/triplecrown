// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let userProj = {};             // the state the render code reads (working set OR reference)
let workingProj = userProj;    // THE working set (2026 projections in progress) — preserved across season views
let referenceProj = {};        // read-only per-team state for the currently-viewed historical season
let referenceSeed = null;      // the SEED for the active reference season (proj SEED stays in projSeed)
let projSeed = null;           // snapshot of the projection-season SEED (working baseline)
let importedSnapshot = null;   // deep copy of last-imported state (for 2-stage reset)
let dirtySinceImport = false;  // have edits happened since import/last reset-to-import?
let currentTeam = null;
let currentPhase = 'QB';
let passingSubTab = 'targets';
let rushingSubTab = 'carries';
let pieChart = null;
let rankSortKey = 'ecr';
let VOR_BASELINE = {};   // {QB,RB,WR,TE} replacement-level fpts from the last VOR computation
let rankSortDir = -1;
let rankFormat = 'half_ppr';   // std | ppr | half_ppr | superflex | dynasty (matches default 0.5 PPR scoring)
// Source of truth for the SCORING axis buttons (std | half_ppr | ppr | superflex). Kept
// independent of rankFormat so Dynasty — whose non-SF ECR table is identical regardless of
// std/half/ppr — can still show and apply the chosen scoring format instead of feeling dead.
let scoringAxis = 'half_ppr';
// Scoring panel starts COLLAPSED so the rankings table owns the screen. Once you've dialled
// scoring in (or linked a league that sets it), you rarely touch it again — the collapsed
// header shows a live summary so you can confirm at a glance without expanding.
let scoringPanelOpen = false;

// The linked league's real shape — roster slots + team count — held INDEPENDENTLY of any
// draft. A league whose draft is already complete still describes a real lineup, and VOR
// baselines depend on it. Keeping this off the draft-follow lifecycle is what makes syncing
// a finished league actually move VOR instead of silently using a generic 12-team 2-WR board.
let leagueShape = null;   // {teams, lineup:[slots], bench}
let rankPosFilter = 'ALL';
let rankScope = 'all';   // 'all' = full league rankings, 'team' = current team only
let rankAdvanced = false; // rankings "Adv. Metrics" (SumerSports) view — swaps stat columns for advanced metrics
// Per-position minimum-volume filter for the Adv. Metrics view (0 = no filter). Rate stats
// like YPRR / EPADrop are noisy on tiny samples, so a floor keeps the board meaningful.
let sumerMin = { QB:0, WRTE:0, RB:0 };   // QB→min Plays, WRTE→min Routes Run, RB→min Rushes
// "Situational" split for the Adv. Metrics view (null = Standard/overall). When set to a
// SumerSports refinement value (e.g. 'red_zone'), the stat columns read that game-situation
// split instead of the overall season table. Only ever applied on the Adv. Metrics view.
let sumerRefinement = null;
