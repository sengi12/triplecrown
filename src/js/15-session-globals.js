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
if(typeof window!=='undefined' && window.addEventListener){
  window.addEventListener('pagehide', ()=>{ try{
    if(_persistTimer){ clearTimeout(_persistTimer); _saveSessionNow(); }
  }catch(e){} });
}
let _persistReady = false;   // becomes true after boot restore, so we don't save during load
let playerNotes = {};        // player-note state keyed by canonical player key
const NOTE_TEXT_MAX = 20000; // hard cap on a single note body (chars); matches cloud-save sanitizer
// How many undo snapshots per team get PERSISTED. In-session undo stays UNDO_LIMIT (40) deep;
// only the newest few are written to localStorage. Each snapshot deep-copies the team's working
// set AND its proj-seed roster row, so a full 40-deep stack across ~8 edited teams serialises to
// >5MB — past the localStorage quota, at which point setItem throws and the user's PROJECTIONS
// stop being saved. Undo depth is a nice-to-have; the projections are the actual data.
const UNDO_PERSIST_LIMIT = 5;
// persistAvailable() does a real setItem+removeItem round-trip. It used to run on every
// saveSession() call — i.e. on every slider `oninput` tick, ~60x/sec during a drag, so two
// blocking storage syscalls per frame sat in the input-to-paint path. The answer cannot change
// within a session, so probe once and remember it.
let _persistOk = null;
function persistAvailable(){
  if(_persistOk !== null) return _persistOk;
  try{ const k='__tc_test__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); _persistOk = true; }
  catch(e){ _persistOk = false; }
  return _persistOk;
}
// Trim undo stacks to the persisted depth without touching the live in-session stacks.
function _undoStacksForPersist(){
  const out = {};
  for(const team in undoStacks){
    const s = undoStacks[team];
    if(s && s.length) out[team] = s.length>UNDO_PERSIST_LIMIT ? s.slice(-UNDO_PERSIST_LIMIT) : s;
  }
  return out;
}
let _persistWarned = false;   // only nag about a degraded save once per session
function saveSession(){
  if(!_persistReady) return;
  if(!persistAvailable()) return;
  // Debounce: edits fire rapidly (sliders), so coalesce writes. pagehide flushes the
  // pending write synchronously so an edit made moments before closing isn't lost.
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(_saveSessionNow, 400);
}
function _saveSessionNow(){
    _persistTimer = null;
    const base = {
      v: 2,
      season: PROJ_SEASON,          // guard: only restore onto a matching-season seed
      savedAt: Date.now(),
      workingProj: workingProj,
      projBaseline: projBaseline,
      playerNotes: playerNotes,
      scoringSettings: scoringSettings,
      rankFormat: rankFormat,
      scoringAxis: scoringAxis,
      rankingsSearchOpen: rankingsSearchOpen,
      rankingsSearchQuery: rankingsSearchQuery,
      scoringPanelOpen: scoringPanelOpen,
      leagueSnapshot: leagueSnapshot,
      // Live-draft follow: id + seat + hide toggle, so a mid-draft reload (or the mobile
      // discarded-tab reload in installResumeRecovery) re-arms instead of dropping the
      // follow mid-clock. draftedIds are NOT stored — the first poll rebuilds them.
      draftFollow: (typeof draftId!=='undefined' && draftId)
        ? { id:String(draftId), slot:(typeof mySlot!=='undefined'?mySlot:null),
            hide:(typeof hideDrafted!=='undefined'?!!hideDrafted:false), at:Date.now() }
        : null,
    };
    // Write the richest payload that fits. If the quota rejects it, shed the OPTIONAL state
    // (undo history first, then the league snapshot) and retry — the working projections and
    // player notes are the last things to go. Previously a single over-quota write threw, the
    // error was swallowed, and every subsequent edit silently went unsaved until the tab died.
    const attempts = [
      Object.assign({}, base, {undoStacks: _undoStacksForPersist()}),
      base,                                              // drop undo history
      Object.assign({}, base, {leagueSnapshot: null}),   // drop the league snapshot too
    ];
    for(let i=0;i<attempts.length;i++){
      try{
        const serialized = JSON.stringify(attempts[i]);
        localStorage.setItem(TC_STORE_KEY, serialized);
        if(typeof TC_DEV_MODE!=='undefined' && TC_DEV_MODE)
          try{ console.debug('[saveSession] wrote '+Math.round(serialized.length/1024)+'KB (tier '+i+')'); }catch(_e){}
        if(i>0 && !_persistWarned){
          _persistWarned = true;
          if(typeof toast==='function')
            toast('Browser storage is nearly full — undo history won’t survive a refresh. Your projections are still being saved.');
        }
        return;
      }catch(e){
        if(typeof TC_DEV_MODE!=='undefined' && TC_DEV_MODE)
          try{ console.warn('[saveSession] tier '+i+' failed:', e); }catch(_e){}
      }
    }
    // Every tier failed — the projections themselves could not be written. Say so out loud;
    // silently losing someone's work is the worst outcome available here.
    if(!_persistWarned){
      _persistWarned = true;
      if(typeof toast==='function')
        toast('Could not save this session to your browser (storage full or blocked) — use Download to keep a copy.','err');
    }
}

function loadSession(){
  if(!persistAvailable()) return null;
  try{
    const raw = localStorage.getItem(TC_STORE_KEY);
    if(!raw) return null;
    const p = JSON.parse(raw);
    if(!p || (p.v!==1 && p.v!==2)) return null;
    return p;
  }catch(e){ return null; }
}
function clearSession(){
  try{ localStorage.removeItem(TC_STORE_KEY); }catch(e){}
}
// Apply a saved session over the freshly-loaded seed. Returns true if anything was restored.
// Only restores the working projections when the saved season matches the current seed,
// so prior-season edits never land on a newer projection seed. Scoring/format restore regardless (harmless).
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
  if(typeof p.rankingsSearchOpen==='boolean') rankingsSearchOpen = p.rankingsSearchOpen;
  if(typeof p.rankingsSearchQuery==='string') rankingsSearchQuery = p.rankingsSearchQuery;
  if(typeof p.scoringPanelOpen==='boolean') scoringPanelOpen = p.scoringPanelOpen;
  if(p.leagueSnapshot && p.leagueSnapshot.teams){
    leagueSnapshot = p.leagueSnapshot;
    // The roster shape VOR is valued against was never persisted, so a reload fell back to
    // the generic 12-team / 2-WR lineup until the next re-sync. Rebuild it from the snapshot.
    try{
      const rp = leagueSnapshot.rosterPositions;
      if(Array.isArray(rp) && rp.length && typeof lineupFromRosterPositions==='function'){
        const shape = lineupFromRosterPositions(rp);
        leagueShape = { teams: leagueSnapshot.teams, lineup: shape.lineup, bench: shape.bench };
        draftLineup = shape.lineup; draftBenchCount = shape.bench;
      }
    }catch(e){}
  }
  if(p.playerNotes && typeof p.playerNotes==='object') playerNotes = p.playerNotes;
  // Re-arm a fresh draft follow (drafts run hours, not days — 24h cap keeps a stale id from
  // polling forever after the fact).
  if(p.draftFollow && p.draftFollow.id && (Date.now()-(p.draftFollow.at||0)) < 24*3600*1000
     && typeof startDraftFollow==='function'){
    try{
      draftId=String(p.draftFollow.id);
      if(p.draftFollow.slot!=null) mySlot=p.draftFollow.slot;
      hideDrafted=!!p.draftFollow.hide;
      setTimeout(()=>{ try{ startDraftFollow(false).catch(()=>{}); }catch(e){} }, 0);
      restored=true;
    }catch(e){}
  }
  if(p.season===PROJ_SEASON && p.workingProj && Object.keys(p.workingProj).length){
    workingProj = p.workingProj;
    if(activeSeason==='proj') userProj = workingProj;
    if(p.undoStacks && typeof p.undoStacks==='object') undoStacks = p.undoStacks;
    // The change-tracking baseline only means something alongside the working set it was
    // taken against, so it rides with (and only with) a restored workingProj.
    projBaseline = (p.projBaseline && typeof p.projBaseline==='object' && p.projBaseline.name)
      ? { name:String(p.projBaseline.name), loadedAt:Number(p.projBaseline.loadedAt)||0 } : null;
    restored = true;
  }
  // A restored session can carry ghost rosters saved before the roster-truth filter existed —
  // scrub immediately (no-op until the Sleeper player DB has loaded; the DB-load path calls
  // the scrub again, so whichever lands second does the real work).
  if(typeof scrubGhostRosters==='function') scrubGhostRosters();
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
// Projection-season Strength of Schedule: {CODE:{rank, win_total, name}}
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
// when viewing a season that has data, never on projections or seasons without data.
let SUMER = (typeof SEED_SUMER!=='undefined') ? SEED_SUMER : {};
let SUMER_SEASONS = (typeof SEED_SUMER_SEASONS!=='undefined') ? SEED_SUMER_SEASONS : [];
// KeepTradeCut dynasty player-page slugs (player-card links): {nameKey:{slug,pos}}
let KTC = (typeof SEED_KTC!=='undefined') ? SEED_KTC : {};
let DYNASTY_VALUES = (typeof SEED_DYNASTY_VALUES!=='undefined') ? SEED_DYNASTY_VALUES : {};
// League Analyzer snapshot: a deliberate point-in-time capture of a synced Sleeper league
// (rosters, owners, picks, settings). Deliberately NOT auto-refreshed — dynasty rosters move
// slowly and stable numbers matter during a week of trade talks — so it only changes when the
// user hits Re-sync. Persisted with the session; takenAt carries the timestamp shown in the UI.
let leagueSnapshot = null;
// nflverse-computed advanced metrics (opt-in A/B source): {season:{team:{...}, players:{QB,RB}}}
let NFLVERSE = (typeof SEED_NFLVERSE!=='undefined') ? SEED_NFLVERSE : {};
// College rookie profiles + their lazily-fetched per-game logs (see 70b-cfb-prospect.js).
let CFB = (typeof SEED_CFB!=='undefined') ? SEED_CFB : {};
let CFB_LOGS = (typeof SEED_CFB_LOGS!=='undefined') ? SEED_CFB_LOGS : {};
// Head coaches fetched live from ESPN this session: {CODE:{name,headshot,experience}|null}
let headCoaches = {};
let hcInFlight = {};
let sharpCategory = 'offense';   // 'offense' | 'defense' — which side to show in league-wide view
let sharpTable = null;      // which Sharp table is active in the league-wide view (set on first render)
let sharpSortCol = null;    // active sort column in league-wide view
let sharpSortDir = 1;       // 1 = best-first (rank asc), -1 = worst-first
let activeSeason = 'proj';
let rankFiltersOpen = false;  // rankings toolbar: league/scoring/stat filters row (mobile collapses it)
function toggleRankFilters(){
  rankFiltersOpen=!rankFiltersOpen;
  // Toggle in place — this is a pure show/hide of an already-rendered row. A full
  // renderRankings() here rebuilt ~17k table cells on a phone just to open the drawer.
  const row = (typeof document!=='undefined' && document.querySelector) ? document.querySelector('#content .rank-toolbar .rank-filters') : null;
  if(row && row.classList && typeof row.classList.toggle==='function'){
    row.classList.toggle('open', rankFiltersOpen);
    const btn = document.querySelector('#content .rank-filters-toggle');
    if(btn && btn.classList) btn.classList.toggle('active', rankFiltersOpen);
    return;
  }
  if(typeof renderRankings==='function' && currentPhase==='Rankings') renderRankings(); }   // 'proj' = working projections, or a year string for read-only reference
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
let trackerMax = false;      // ...and stretched to most of the window (drag-up on the bar)?
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
  // TE Premium: EXTRA points per reception, TEs only, ON TOP of `receptions`.
  // A "1.5 PPR TE" league in full PPR is receptions:1 + receptions_te_bonus:0.5.
  // Mirrors Sleeper's own model, where scoring_settings.bonus_rec_te is a bonus, not a total.
  receptions_te_bonus:0,
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
    // Roster truth: Sleeper's DB still lists some long-retired players on a team
    // (Roethlisberger shows team=PIT years after retiring), so without this check the merge
    // re-injects ghosts into the projections view even when the seed itself is clean.
    if(typeof sleeperProjectableRoster==='function' && !sleeperProjectableRoster(sp)) continue;
    if(have.has(pid) || have.has(normName(sp.name))) continue;
    if(!Array.isArray(SEED[team][sp.pos])) continue;
    // add a zeroed-out entry so the player is selectable with sliders at 0
    SEED[team][sp.pos].push({
      name:sp.name, player_id:pid, pos:sp.pos, team:team, slug:null, headshot:null, age:sp.age||null,
      passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
      rushing_yards:0,rushing_tds:0,rushing_attempts:0,
      receiving_targets:0,receptions:0,receiving_yards:0,receiving_tds:0,
      adp:999,adp_ppr:999,adp_half_ppr:999,adp_2qb:999,games_played:0,
      // Marks a camp-body / practice-squad fill (no projection anywhere). Selectable in the
      // editors, but the rankings skip it until someone actually dials it up — otherwise every
      // team built after the player DB arrives dumps ~9 zero-point WR/TEs into the board.
      roster_fill:true,
    });
  }
  rosterMergedTeams.add(team);
}

// ── Ghost scrub: self-heal rosters that were saved before the roster-truth filter ────────────
// Ghosts (players Sleeper's DB still lists on a team years after they left — Roethlisberger,
// Haskins et al) can arrive from THREE stores, and blocking new ones isn't enough because two
// of the stores are persisted: (1) a seed built before the filter, (2) the user's saved
// session — workingProj[team].qbs is the exact list the projection-season QB tab renders, and
// restoreSession() faithfully puts an old ghost-laden copy back over a perfectly clean seed
// on every boot. This scrub removes ghost entries from the projection seed AND every restored
// working team, judged against the live Sleeper DB via sleeperProjectableRoster. Players the
// DB doesn't know are left alone (could be custom/manual additions). Historical season caches
// are never touched — departed players belong on their historical teams.
// Idempotent and cheap; called after the player DB loads and after each session restore
// (whichever lands second does the real work).
function scrubGhostRosters(){
  if(typeof sleeperPlayers!=='object' || !sleeperPlayers) return 0;
  if(typeof sleeperProjectableRoster!=='function') return 0;
  const isGhost = e => {
    if(!e || e.player_id==null) return false;
    const meta = sleeperPlayers[e.player_id];
    return !!(meta && !sleeperProjectableRoster(meta));
  };
  let removed = 0;
  // 1. The projection seed (covers a seed built before the filter). projSeed is the canonical
  //    reference for the projection season regardless of which season tab is active.
  const ps = (typeof projSeed!=='undefined' && projSeed) ? projSeed
           : (typeof activeSeason!=='undefined' && activeSeason==='proj' ? SEED : null);
  if(ps){
    for(const t in ps){
      ['QB','RB','WR','TE'].forEach(pos=>{
        const lst = ps[t] && ps[t][pos];
        if(!Array.isArray(lst)) return;
        for(let i=lst.length-1;i>=0;i--){ if(isGhost(lst[i])){ lst.splice(i,1); removed++; } }
      });
    }
  }
  // 2. Restored working teams — the store the QB projections tab actually renders from.
  if(typeof workingProj==='object' && workingProj){
    for(const t in workingProj){
      const wp = workingProj[t];
      if(wp && Array.isArray(wp.qbs)){
        const before = wp.qbs.length;
        wp.qbs = wp.qbs.filter(q=>!isGhost(q));
        removed += before - wp.qbs.length;
        if(wp.activeQB!=null && wp.activeQB >= wp.qbs.length) wp.activeQB = 0;
      }
    }
  }
  if(removed>0){
    try{
      if(typeof saveSession==='function') if(typeof invalidateBuildPlayerCache==='function') invalidateBuildPlayerCache();
    saveSession();   // persist the healed session
      if(typeof currentTeam!=='undefined' && currentTeam && typeof renderContent==='function') renderContent();
    }catch(e){}
  }
  return removed;
}
function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }
// A team counts as "worked on" once the user has changed something in its working set —
// not once its state has merely been built. ensureTeam/initPassingShares/initRushingShares
// materialise a team's default state whenever a tab (or the Rankings page, for all 32) is
// opened, which is what the progress bar used to count: it jumped to 32/32 on the first
// Rankings visit and dropped to near zero on a reference-season tab. The flag lives inside
// the team's working state so it persists, is snapshotted by undo, and is cleared with it.
function markTeamEdited(team){
  if(!team || activeSeason!=='proj') return;
  const st = workingProj && workingProj[team];
  if(st && !st.edited){ st.edited = true; queueSidebarRefresh(); }
}
// The progress bar / team dots live in the sidebar, which only re-rendered on a team switch —
// so the first edit to a team showed up in the bar only when you moved to another team, which
// is what made the bar look like it changed "on its own". Repaint on the next frame instead
// (coalesced: a slider drag fires dozens of edits per second, one repaint is plenty).
let _sidebarRefreshQueued = false;
function queueSidebarRefresh(){
  if(_sidebarRefreshQueued || typeof renderSidebar!=='function') return;
  _sidebarRefreshQueued = true;
  const run = ()=>{ _sidebarRefreshQueued=false; try{ renderSidebar(); }catch(e){} };
  if(window.requestAnimationFrame) window.requestAnimationFrame(run); else setTimeout(run,0);
}
function teamEdited(team){
  const st = workingProj && workingProj[team];
  return !!(st && st.edited);
}
// Re-baseline change tracking on a saved projection set (Projections Manager → Load, and
// every successful cloud Save — "vs saved" always means since the last load OR save).
// loadProjections() flags every imported team as edited (correct for a one-off file import:
// the file IS the work). For a set you saved yourself that is noise — what you want to see is
// what has moved since you loaded it. So: clear every working team's flag, remember which set
// is the baseline, and let the normal markTeamEdited path light teams up again from here.
function setProjBaseline(name){
  projBaseline = { name: String(name||'Saved projections'), loadedAt: Date.now() };
  if(workingProj) for(const t in workingProj){ const st=workingProj[t]; if(st) st.edited=false; }
  // The undo history predates this baseline: a snapshot still carrying edited:true would
  // re-light a team on undo. Scrub the flag inside the snapshots instead of dropping them —
  // a Save must not cost you your undo history.
  if(undoStacks) for(const t in undoStacks){
    (undoStacks[t]||[]).forEach(e=>{ if(e && e.working) e.working.edited=false; });
  }
  saveSession();
}
function clearProjBaseline(){ projBaseline = null; }
function projBaselineActive(){ return !!(projBaseline && projBaseline.name); }
function markDirty(team){
  if(team) markTeamEdited(team);
  if(importedSnapshot) dirtySinceImport = true;
  if(typeof invalidateBuildPlayerCache==='function') invalidateBuildPlayerCache();
  saveSession();
}

function playerNoteKey(nameOrId, pos, team){
  const posc = String(pos||'').toUpperCase();
  if(posc==='DEF'){
    const code = String(team||nameOrId||'').toUpperCase();
    return code ? `def:${code}` : '';
  }
  const raw = String(nameOrId||'').trim();
  if(/^\d+$/.test(raw)) return `pid:${raw}`;
  let pid = '';
  try{
    if(typeof resolvePlayerId==='function') pid = resolvePlayerId(raw, posc) || resolvePlayerId(raw) || '';
  }catch(e){}
  if(pid) return `pid:${pid}`;
  return `nm:${normName(raw)}|${posc}|${String(team||'').toUpperCase()}`;
}
function ensurePlayerNote(nameOrId, pos, team){
  const key = playerNoteKey(nameOrId, pos, team);
  if(!key) return null;
  const raw = String(nameOrId||'');
  const pid = /^pid:/.test(key) ? key.slice(4) : (/^\d+$/.test(raw) ? raw : '');
  const meta = (pid && typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[pid]) ? sleeperPlayers[pid] : null;
  const displayName = meta && meta.name ? meta.name : (String(pos||'').toUpperCase()==='DEF' && team ? `${teamDisplayName(team)} D/ST` : raw);
  if(!playerNotes[key]){
    playerNotes[key] = {
      key,
      pid,
      name: displayName,
      pos: String(pos||''),
      team: String(team||''),
      text: '',
      tags: [],
      updatedAt: Date.now(),
    };
  }
  const note = playerNotes[key];
  if(displayName && (!note.name || /^\d+$/.test(String(note.name)))) note.name = displayName;
  if(pid && !note.pid) note.pid = pid;
  if(pos && !note.pos) note.pos = String(pos);
  if(team && !note.team) note.team = String(team);
  return note;
}
function getPlayerNote(nameOrId, pos, team){
  const key = playerNoteKey(nameOrId, pos, team);
  return key ? (playerNotes[key] || null) : null;
}
function setPlayerNoteText(nameOrId, pos, team, text){
  const note = ensurePlayerNote(nameOrId, pos, team);
  if(!note) return null;
  // Hard cap the note body so a single note can't grow unbounded (matches the cloud-save
  // sanitizer's MAX_TEXT). Truncating here keeps session storage and any later save in sync.
  let t = String(text==null?'':text);
  if(t.length > NOTE_TEXT_MAX) t = t.slice(0, NOTE_TEXT_MAX);
  note.text = t;
  note.updatedAt = Date.now();
  markDirty();
  return note;
}
function addPlayerNoteTag(nameOrId, pos, team, tag){
  const note = ensurePlayerNote(nameOrId, pos, team);
  if(!note || !tag) return null;
  const clean = {
    id: String(tag.id || (`tag:${Date.now()}:${Math.random().toString(36).slice(2,8)}`)),
    label: String(tag.label||''),
    value: String(tag.value||''),
    source: String(tag.source||''),
    statKey: String(tag.statKey||''),
    context: String(tag.context||''),
    capturedAt: tag.capturedAt || Date.now(),
    nav: tag.nav && typeof tag.nav==='object' ? JSON.parse(JSON.stringify(tag.nav)) : null,
  };
  const dup = note.tags.find(t=>t.label===clean.label && t.value===clean.value && t.source===clean.source && t.statKey===clean.statKey);
  if(!dup) note.tags.unshift(clean);
  note.updatedAt = Date.now();
  markDirty();
  return note;
}
function removePlayerNoteTag(nameOrId, pos, team, tagId){
  const note = getPlayerNote(nameOrId, pos, team);
  if(!note || !tagId) return null;
  const before = note.tags.length;
  note.tags = note.tags.filter(t=>String(t.id)!==String(tagId));
  if(note.tags.length===before) return note;
  note.updatedAt = Date.now();
  markDirty();
  return note;
}

// ── Per-team undo history ──────────────────────────────────────────────────
// Each team keeps its own stack of state snapshots so you can step back through
// just that team's edits without touching any other team's projections. Snapshots
// always capture the WORKING set for that team (workingProj[team]) — not whatever
// view is currently on screen — so this also covers actions triggered from a
// reference-season page, like "copy team to working set" or "copy player to working
// set" (e.g. copying a prior Colts season onto his new Steelers slot).
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
function pushUndo(team, coalesceKey, label){
  if(!team) return;
  if(coalesceKey && coalesceKey===_lastUndoKey) return;  // same interaction, already snapped
  _lastUndoKey = coalesceKey || null;
  const stack = undoStacks[team] || (undoStacks[team]=[]);
  const curWorking = workingProj[team];
  const curSeed = projSeed && projSeed[team];
  const snap = {
    working: curWorking ? deepCopy(curWorking) : null,   // null = team had no working state yet
    seed: curSeed ? deepCopy(curSeed) : null,             // null = team had no proj-seed roster row yet
    label: label || null,                                 // what the NEXT mutation is (for the undo toast)
  };
  // Dedup on STATE only, never the label — focus+blur with no real change, or clicking
  // "copy" twice with nothing new, must not stack a phantom step.
  const stateStr = JSON.stringify([snap.working, snap.seed]);
  if(stack.length && JSON.stringify([stack[stack.length-1].working, stack[stack.length-1].seed])===stateStr) return;
  stack.push(snap);
  if(stack.length>UNDO_LIMIT) stack.shift();
  updateUndoButton();
}
function clearUndoCoalesce(){ _lastUndoKey=null; }
function canUndo(team){ return !!(team && undoStacks[team] && undoStacks[team].length); }
// Cmd+Z (mac) / Ctrl+Z (elsewhere) fires the team Undo button. Never while typing —
// inputs and the contenteditable stat fields keep their NATIVE text undo — and never
// while a modal/popup is up (its own context owns the keys there).
function tcUndoHotkey(e){
  if(!(e && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
      && String(e.key||'').toLowerCase()==='z')) return false;
  const t=e.target;
  if(t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName||''))) return false;
  try{
    const fl=document.querySelector('.pcard-overlay,.scheme-overlay,.ps-overlay,.note-picker-overlay,.note-info-overlay,.tc-modal-overlay');
    if(fl && (fl.offsetWidth||fl.offsetHeight)) return false;
  }catch(_e){}
  const teamViews=['Passing','Receiving','Rushing','Advanced','Additions'];
  if(typeof currentPhase==='undefined' || !teamViews.includes(currentPhase)) return false;
  if(typeof currentTeam==='undefined' || !currentTeam || !canUndo(currentTeam)) return false;
  if(e.preventDefault) e.preventDefault();
  undoTeam(currentTeam);
  return true;
}
try{ document.addEventListener('keydown', tcUndoHotkey); }catch(_e){}

function undoTeam(team){
  if(!canUndo(team)) return;
  const prev = undoStacks[team].pop();
  if(typeof toast==='function') toast(`Undid ${prev.label||'last change'} \u2713`,'ok');
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
  queueSidebarRefresh();   // the team's edited flag may have just flipped back to clean
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
  if(btn.classList){
    if(typeof btn.classList.toggle==='function') btn.classList.toggle('disabled', !n);
    else if(!n && typeof btn.classList.add==='function') btn.classList.add('disabled');
    else if(n && typeof btn.classList.remove==='function') btn.classList.remove('disabled');
  }
  btn.title = n ? `Undo last working-set change to ${team} (${n} step${n===1?'':'s'} available)` : `Nothing to undo for ${team}'s working set`;
  const cnt=document.getElementById('undoCount');
  if(cnt) cnt.textContent = n? ` ${n}`:'';
}

