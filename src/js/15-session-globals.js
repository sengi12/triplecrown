// ═════════════════════════════════════════════════════════════════════════════
// Session persistence (localStorage) — auto-saves your working projections so they
// survive a refresh/close. Only the EDITABLE state is stored (working projections,
// custom scoring, selected format, undo stacks); the seed/history/ECR reload fresh
// from the seed each time. Silently restores on load; the Reset button clears it.
// (Requires a real http(s)/file origin; wrapped in try/catch so a blocked localStorage
// — e.g. private-mode quirks — degrades gracefully to in-memory-only behavior.)
// ═════════════════════════════════════════════════════════════════════════════
const TC_STORE_KEY = 'triplecrown.session.v1';
let _persistTimer = null;
let _persistReady = false;   // becomes true after boot restore, so we don't save during load
function persistAvailable(){
  try{ const k='__tc_test__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }
  catch(e){ return false; }
}
function saveSession(){
  if(!_persistReady) return;
  if(!persistAvailable()) return;
  // Debounce: edits fire rapidly (sliders), so coalesce writes.
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(()=>{
    try{
      const payload = {
        v: 1,
        season: PROJ_SEASON,          // guard: only restore onto a matching-season seed
        savedAt: Date.now(),
        workingProj: workingProj,
        scoringSettings: scoringSettings,
        rankFormat: rankFormat,
        scoringAxis: scoringAxis,
        scoringPanelOpen: scoringPanelOpen,
        undoStacks: undoStacks,
      };
      localStorage.setItem(TC_STORE_KEY, JSON.stringify(payload));
    }catch(e){ /* quota or serialization issue — skip silently */ }
  }, 400);
}
function loadSession(){
  if(!persistAvailable()) return null;
  try{
    const raw = localStorage.getItem(TC_STORE_KEY);
    if(!raw) return null;
    const p = JSON.parse(raw);
    if(!p || p.v!==1) return null;
    return p;
  }catch(e){ return null; }
}
function clearSession(){
  try{ localStorage.removeItem(TC_STORE_KEY); }catch(e){}
}
// Apply a saved session over the freshly-loaded seed. Returns true if anything was restored.
// Only restores the working projections when the saved season matches the current seed,
// so 2025 edits never land on a 2026 seed. Scoring/format restore regardless (harmless).
function restoreSession(){
  const p = loadSession();
  if(!p) return false;
  let restored = false;
  if(p.scoringSettings && typeof p.scoringSettings==='object'){
    scoringSettings = Object.assign({}, scoringSettings, p.scoringSettings); restored = true;
  }
  if(p.rankFormat){ rankFormat = p.rankFormat; restored = true; }
  // Restore the scoring axis if saved; otherwise derive it from the restored rankFormat so
  // older sessions (pre-scoringAxis) still light up the correct scoring button.
  scoringAxis = p.scoringAxis || scoringAxisOf(rankFormat);
  if(typeof p.scoringPanelOpen==='boolean') scoringPanelOpen = p.scoringPanelOpen;
  if(p.season===PROJ_SEASON && p.workingProj && Object.keys(p.workingProj).length){
    workingProj = p.workingProj;
    if(activeSeason==='proj') userProj = workingProj;
    if(p.undoStacks && typeof p.undoStacks==='object') undoStacks = p.undoStacks;
    restored = true;
  }
  return restored;
}
// Live seed (starts from embedded SEED_DATA; can be replaced by a live Sleeper pull)
let SEED = (typeof SEED_DATA!=='undefined') ? SEED_DATA : {};
let HISTORY = (typeof SEED_HISTORY!=='undefined') ? SEED_HISTORY : {};
let HISTORY_SEASONS = (typeof SEED_HISTORY_SEASONS!=='undefined') ? SEED_HISTORY_SEASONS : [];
// FantasyPros Expert Consensus Rankings (replaces ADP). Shape: {format:{nameKey:{rank_ecr,tier,age}}}
let ECR = (typeof SEED_ECR!=='undefined') ? SEED_ECR : {};
// OverTheCap contracts (dynasty only): {nameKey:{age,apy,fa,pos}}
let CONTRACTS = (typeof SEED_CONTRACTS!=='undefined') ? SEED_CONTRACTS : {};
// Warren Sharp advanced offensive stats (read-only reference): {tableKey:{columns,title,teams:{CODE:{values,ranks}}}}
let SHARP = (typeof SEED_SHARP!=='undefined') ? SEED_SHARP : {};
// 2026 Strength of Schedule: {CODE:{rank, win_total, name}}
let SOS = (typeof SEED_SOS!=='undefined') ? SEED_SOS : {};
let _sosSchedLoading=false, _sosSchedLoaded=false;   // opponent-schedule fetch state (SOS arc)
// Full team display names: {CODE:"Cincinnati Bengals"}
let TEAM_NAMES = (typeof SEED_TEAM_NAMES!=='undefined') ? SEED_TEAM_NAMES : {};
// Coordinators (from Wikipedia via seed): {CODE:{offense:{...},defense:{...}}}
let COORDINATORS = (typeof SEED_COORDINATORS!=='undefined') ? SEED_COORDINATORS : {};
// Head coaches who call their own plays: {CODE:"Name"}
let HC_PLAYCALLERS = (typeof SEED_HC_PLAYCALLERS!=='undefined') ? SEED_HC_PLAYCALLERS : {};
// Head-coach history (Wikipedia via seed): {CODE:{name,since,prev_code,prev_role,prev_years,is_new}}
// Used so a playcalling HC who's new this season carries over their FORMER team's scheme.
let HC_HISTORY = (typeof SEED_HC_HISTORY!=='undefined') ? SEED_HC_HISTORY : {};
// Roster Changes (Spotrac via seed): {CODE:{free_agents,draft,trades,free_agents_lost}}
// (var kept as ADDITIONS to match the seed key; the UI tab is labeled "Roster Changes").
let ADDITIONS = (typeof SEED_ADDITIONS!=='undefined') ? SEED_ADDITIONS : {};
// Which season the Sharp advanced stats describe (projection season − 1).
let SHARP_SEASON = (typeof SEED_SHARP_SEASON!=='undefined') ? SEED_SHARP_SEASON : (PROJ_SEASON-1);
// SumerSports advanced per-player stats: {season:{POS:{columns,pct_cols,players:{nameKey:{values,team,rank}}}}}.
// Reference-season only — shown on the rankings page via the "Advanced (SumerSports)" toggle
// when viewing a season that has data (2022-2025), never on projections or seasons without data.
let SUMER = (typeof SEED_SUMER!=='undefined') ? SEED_SUMER : {};
let SUMER_SEASONS = (typeof SEED_SUMER_SEASONS!=='undefined') ? SEED_SUMER_SEASONS : [];
// KeepTradeCut dynasty player-page slugs (player-card links): {nameKey:{slug,pos}}
let KTC = (typeof SEED_KTC!=='undefined') ? SEED_KTC : {};
// nflverse-computed advanced metrics (opt-in A/B source): {season:{team:{...}, players:{QB,RB}}}
let NFLVERSE = (typeof SEED_NFLVERSE!=='undefined') ? SEED_NFLVERSE : {};
// Advanced team tables are now nflverse-only (the old curated toggle was retired).
let advSource = 'nflverse';
// Head coaches fetched live from ESPN this session: {CODE:{name,headshot,experience}|null}
let headCoaches = {};
let hcInFlight = {};
let sharpCategory = 'offense';   // 'offense' | 'defense' — which side to show in league-wide view
let sharpTable = null;      // which Sharp table is active in the league-wide view (set on first render)
let sharpSortCol = null;    // active sort column in league-wide view
let sharpSortDir = 1;       // 1 = best-first (rank asc), -1 = worst-first
let activeSeason = 'proj';   // 'proj' = working projections, or a year string for read-only reference
let sleeperPlayers = null;   // cached Sleeper player DB (id → meta), fetched once
let sleeperPlayersPromise = null;   // shared in-flight promise so concurrent callers dedupe
let seasonStatsCache = {};   // season → seed-shaped data built from Sleeper stats
let espnRecordCache = {};    // 'season:TEAM' → record string (from ESPN)
let seasonLoading = false;   // guard for loadSeason to prevent concurrent loads
let seasonStatsFetching = {};// per-season guard for background ensureSeasonStats
// Live draft follow
let draftId = null;
let draftedIds = {};         // player_id → true
let draftTimer = null;
let hideDrafted = false;     // toggle: strike-through vs hide
// ── Roster tracker ──────────────────────────────────────────────────────────
// Built from the live draft: buckets every pick into per-slot rosters, ties each slot
// to its Sleeper username, and slots players into a lineup (real league settings when a
// league is linked, else a generic default). "My slot" is auto-detected from a linked
// league's draft_order, or tapped once for a pasted mock draft.
const DEFAULT_LINEUP = ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF'];
const DEFAULT_BENCH = 5;   // generic default bench size (synced to real league/draft when linked)
const FLEX_ELIGIBLE = { FLEX:['RB','WR','TE'], WRRB_FLEX:['RB','WR'], REC_FLEX:['WR','TE'], SUPER_FLEX:['QB','RB','WR','TE'] };
let draftMeta = null;        // the Sleeper draft object (draft_order, slot_to_roster_id, settings, metadata)
let draftLineup = DEFAULT_LINEUP.slice();  // starter slots (+bench) for this draft
let draftBenchCount = DEFAULT_BENCH;     // number of BN slots
let draftUsers = {};         // user_id → display_name
let draftPicksBySlot = {};   // slot number → [ {player_id, name, pos, team, pick_no}, ... ]
let mySlot = null;           // which draft slot is "mine"
let trackerOpen = false;     // is the expanded tracker panel showing?
let trackerViewSlot = null;  // which slot's roster is being viewed in the panel (null = mine)
let rosterBarVisible = false;// is the pinned bar shown at all?
let _trackerNeedsSlotPick = false;  // mock draft: waiting for the user to tap their seat
let _lastPickCount = -1;            // last seen pick count (skip redundant bar re-renders)
let scoringSettings = {
  passing_yards_points:1, passing_yards_yardage:25,
  passing_touchdowns:6, interceptions_thrown:-2,
  passing_attempts:0, passing_completions:0,
  receiving_yards_points:1, receiving_yards_yardage:10,
  receiving_touchdowns:6, receptions:0.5,
  rushing_yards_points:1, rushing_yards_yardage:10,
  rushing_touchdowns:6, rushing_attempts:0,
  fumbles_lost:-2,
};

function getBase(team,pos){ return (SEED[team]||{})[pos]||[]; }

// Ensure every skill player Sleeper lists on this team's CURRENT roster appears in the
// projection seed, even with zero stats — so a user can dial up a player like Erick All Jr
// who has no baseline projection. Only runs for the projection season (not historical).
// We track which teams have been merged in a SEPARATE Set (not a flag stored inside
// SEED[team]) so the position object never contains anything but QB/RB/WR/TE arrays —
// otherwise a `for(pos in SEED[team])` elsewhere would trip over the flag.
let rosterMergedTeams = new Set();
function mergeRosterPlayers(team){
  if(activeSeason!=='proj') return;
  if(!sleeperPlayers || !SEED[team]) return;
  if(rosterMergedTeams.has(team)) return;          // once per team is enough
  const have=new Set();
  ['QB','RB','WR','TE'].forEach(pos=>(SEED[team][pos]||[]).forEach(p=>{
    if(p.player_id) have.add(p.player_id);
    have.add(normName(p.name));
  }));
  for(const pid in sleeperPlayers){
    const sp=sleeperPlayers[pid];
    if(sp.team!==team) continue;
    if(!POS_KEEP[sp.pos]) continue;
    if(have.has(pid) || have.has(normName(sp.name))) continue;
    if(!Array.isArray(SEED[team][sp.pos])) continue;
    // add a zeroed-out entry so the player is selectable with sliders at 0
    SEED[team][sp.pos].push({
      name:sp.name, player_id:pid, pos:sp.pos, team:team, slug:null, headshot:null, age:sp.age||null,
      passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
      rushing_yards:0,rushing_tds:0,rushing_attempts:0,
      receiving_targets:0,receptions:0,receiving_yards:0,receiving_tds:0,
      adp:999,adp_ppr:999,adp_half_ppr:999,adp_2qb:999,games_played:0,
    });
  }
  rosterMergedTeams.add(team);
}
function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }
function markDirty(){ if(importedSnapshot) dirtySinceImport = true; saveSession(); }

// ── Per-team undo history ──────────────────────────────────────────────────
// Each team keeps its own stack of state snapshots so you can step back through
// just that team's edits without touching any other team's projections. Snapshots
// always capture the WORKING set for that team (workingProj[team]) — not whatever
// view is currently on screen — so this also covers actions triggered from a
// reference-season page, like "copy team to working set" or "copy player to working
// set" (e.g. copying Michael Pittman's 2025 Colts season onto his new Steelers slot).
// A snapshot is taken right before a mutation begins (slider drag start, an editable-
// field commit, or a copy-to-working action). We cap the stack so memory stays bounded.
const UNDO_LIMIT = 40;
let undoStacks = {};   // team -> [snapshot|null, ...] (oldest first; null = "didn't exist yet")
// Snapshot the given team's working-set state (AND the underlying proj-seed roster row,
// since copy-to-working actions mutate both — see copyTeamToWorking/copyPlayerToWorking)
// before it's about to change. `coalesceKey` lets a continuous interaction (one slider
// drag) push only a single snapshot instead of one per tick. Discrete one-shot actions
// (copy-to-working) should omit coalesceKey so every call attempts a fresh snapshot (true
// no-ops are still caught by the dedup check).
let _lastUndoKey = null;
function pushUndo(team, coalesceKey){
  if(!team) return;
  if(coalesceKey && coalesceKey===_lastUndoKey) return;  // same interaction, already snapped
  _lastUndoKey = coalesceKey || null;
  const stack = undoStacks[team] || (undoStacks[team]=[]);
  const curWorking = workingProj[team];
  const curSeed = projSeed && projSeed[team];
  const snap = {
    working: curWorking ? deepCopy(curWorking) : null,   // null = team had no working state yet
    seed: curSeed ? deepCopy(curSeed) : null,             // null = team had no proj-seed roster row yet
  };
  const snapStr = JSON.stringify(snap);
  // Skip if identical to the most recent snapshot (e.g. focus+blur with no real change,
  // or clicking "copy" twice with nothing different to copy).
  if(stack.length && JSON.stringify(stack[stack.length-1])===snapStr) return;
  stack.push(snap);
  if(stack.length>UNDO_LIMIT) stack.shift();
  updateUndoButton();
}
function clearUndoCoalesce(){ _lastUndoKey=null; }
function canUndo(team){ return !!(team && undoStacks[team] && undoStacks[team].length); }
function undoTeam(team){
  if(!canUndo(team)) return;
  const prev = undoStacks[team].pop();
  if(prev.working===null) delete workingProj[team];   // reverts to "never copied/edited"
  else workingProj[team] = prev.working;
  // Also revert the underlying proj-seed roster row (copy-to-working mutates the seed
  // roster, not just the working set) — otherwise a later rebuild for this team would
  // still start from the copied-in stat line even after "undoing" it.
  if(projSeed){
    if(prev.seed===null) delete projSeed[team];
    else projSeed[team] = prev.seed;
  }
  markDirty();
  // If the working (proj) view is on screen, refresh immediately so the change is visible.
  // (userProj IS workingProj in proj mode.) If undo fully deleted the team (reverted to
  // "never existed"), rebuild a valid default via ensureTeam first — otherwise rendering
  // the currently-displayed team would crash on an undefined state.
  if(activeSeason==='proj'){
    if(currentTeam) ensureTeam(currentTeam);
    renderContent();
  } else {
    updateUndoButton();   // viewing a reference season: nothing on screen changes, just the button
  }
  const n=undoStacks[team].length;
  toast(`Undid last working-set change to ${team}${n?` · ${n} more step${n===1?'':'s'} available`:''}`,'ok');
}
function updateUndoButton(){
  const btn=document.getElementById('undoBtn');
  if(!btn) return;
  const team=currentTeam;
  const n = team && undoStacks[team] ? undoStacks[team].length : 0;
  btn.disabled = !n;
  btn.classList.toggle('disabled', !n);
  btn.title = n ? `Undo last working-set change to ${team} (${n} step${n===1?'':'s'} available)` : `Nothing to undo for ${team}'s working set`;
  const cnt=document.getElementById('undoCount');
  if(cnt) cnt.textContent = n? ` ${n}`:'';
}

