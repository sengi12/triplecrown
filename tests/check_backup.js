






// ═══ FFFORGE_SEED_START ═══ (build_seed.py / bake_seed.py replace this whole block)
// SEED_DATA intentionally empty — FFForge pulls 2026 projections live from Sleeper
// on first load (or load a prebuilt ffforge_seed.json via the 📦 Seed button, or bake
// a seed straight into this file with bake_seed.py for a phone-friendly offline copy).
const SEED_SEASON = 2026;
const SEED_DATA = {};
const SEED_HISTORY = {};
const SEED_HISTORY_SEASONS = [];
const SEED_ECR = {};
const SEED_CONTRACTS = {};
// ═══ FFFORGE_SEED_END ═══


// ─────────────────────────────────────────────────────────────────────────────
// Constants & URLs
// ─────────────────────────────────────────────────────────────────────────────
const NFL_LOGO = t => `https://static.www.nfl.com/t_headshot_desktop/f_auto/league/api/clubs/logos/${t==='JAX'?'JAC':t}`;
// Sleeper APIs (browser can reach these directly; container cannot)
const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';
const SLEEPER_PROJ_URL = (season)=>`https://api.sleeper.com/projections/nfl/${season}?season_type=regular&grouping=season`;
const SLEEPER_STATS_URL = (season)=>`https://api.sleeper.com/stats/nfl/${season}?season_type=regular&grouping=season`;
const SLEEPER_WEEKLY_URL = (pid,season)=>`https://api.sleeper.com/stats/nfl/player/${pid}?season_type=regular&season=${season}&grouping=week`;
const SLEEPER_PICKS_URL = (draftId)=>`https://api.sleeper.app/v1/draft/${draftId}/picks`;
const SLEEPER_DRAFT_URL = (draftId)=>`https://api.sleeper.app/v1/draft/${draftId}`;
const SLEEPER_HEADSHOT = (pid)=>`https://sleepercdn.com/content/nfl/players/${pid}.jpg`;

// ═════════════════════════════════════════════════════════════════════════════
// Week-range filtering (reference seasons only) — lets the user drag a dual
// slider to see what a WR/RB/TE put up over just a stretch of weeks (e.g. Tucker
// Kraft's hot weeks 1-9 before injury), instead of only the full-season total.
// Weekly data is fetched lazily (only for the team being viewed) and cached.
// ═════════════════════════════════════════════════════════════════════════════
let weeklySkillCache = {};   // `${season}:${pid}` -> raw weekly json from Sleeper
async function fetchPlayerWeekly(pid, season){
  const key = `${season}:${pid}`;
  if(weeklySkillCache[key]) return weeklySkillCache[key];
  const data = await sleeperFetch(SLEEPER_WEEKLY_URL(pid, season));
  weeklySkillCache[key] = data;
  return data;
}

// Sum one player's weekly rows between fromWk..toWk (inclusive), restricted to the
// given team (so a trade mid-window doesn't blend two teams' stats together).
function sumWeeklyRange(weekly, team, fromWk, toWk){
  const out = {receiving_targets:0, receptions:0, receiving_yards:0, receiving_tds:0,
               rushing_attempts:0, rushing_yards:0, rushing_tds:0, games_played:0};
  for(const wk in (weekly||{})){
    const wn = parseInt(wk);
    if(isNaN(wn) || wn<fromWk || wn>toWk) continue;
    const row = weekly[wk];
    if(!row || typeof row!=='object' || row.team!==team) continue;
    const s = row.stats||{};
    if(s.gp) out.games_played += s.gp;
    out.receiving_targets += s.rec_tgt||0;
    out.receptions        += s.rec||0;
    out.receiving_yards   += s.rec_yd||0;
    out.receiving_tds     += s.rec_td||0;
    out.rushing_attempts  += s.rush_att||0;
    out.rushing_yards     += s.rush_yd||0;
    out.rushing_tds       += s.rush_td||0;
  }
  return out;
}

// Fetch + cache weekly data for every WR/RB/TE on a team's roster (reference season),
// then build {player_id -> filtered totals} for the given week window. Players whose
// fetch fails just fall back to season totals (handled by the caller).
async function buildWeekFilterData(team, season, fromWk, toWk){
  const roster=[...getBase(team,'WR'),...getBase(team,'TE'),...getBase(team,'RB')]
    .filter(p=>p.player_id);
  const results = await Promise.allSettled(
    roster.map(p=>fetchPlayerWeekly(p.player_id, season).then(w=>({pid:p.player_id, weekly:w})))
  );
  const data={};
  for(const r of results){
    if(r.status!=='fulfilled'||!r.value||!r.value.weekly) continue;
    data[r.value.pid]=sumWeeklyRange(r.value.weekly, team, fromWk, toWk);
  }
  return data;
}

// Same idea for the team's QB(s) — used ONLY to keep the receiving-yards-available pool
// sane while a week window is active (does not touch the QB tab/editing state at all).
async function buildWeekFilterQBPool(team, season, fromWk, toWk){
  const qbs=getBase(team,'QB').filter(p=>p.player_id);
  const results = await Promise.allSettled(
    qbs.map(p=>fetchPlayerWeekly(p.player_id, season).then(w=>({pid:p.player_id, weekly:w})))
  );
  let pass_yards=0, pass_att=0, pass_tds=0, comp=0;
  for(const r of results){
    if(r.status!=='fulfilled'||!r.value||!r.value.weekly) continue;
    for(const wk in r.value.weekly){
      const wn=parseInt(wk); if(isNaN(wn)||wn<fromWk||wn>toWk) continue;
      const row=r.value.weekly[wk];
      if(!row||typeof row!=='object'||row.team!==team) continue;
      const s=row.stats||{};
      pass_yards+=s.pass_yd||0; pass_att+=s.pass_att||0; pass_tds+=s.pass_td||0; comp+=s.pass_cmp||0;
    }
  }
  return {pass_yards, pass_att, pass_tds, comp};
}

// Overlay week-filtered totals onto a roster list (used by initPassingShares /
// initRushingShares). Players with no filtered data (fetch still pending or failed)
// keep their season totals so the tab doesn't silently go blank.
function applyWeekFilterOverrides(list, filterData){
  if(!filterData) return list;
  return list.map(p=>{
    const f = p.player_id && filterData[p.player_id];
    if(!f) return p;
    return Object.assign({}, p, {
      receiving_targets:f.receiving_targets, receptions:f.receptions,
      receiving_yards:f.receiving_yards, receiving_tds:f.receiving_tds,
      rushing_attempts:f.rushing_attempts, rushing_yards:f.rushing_yards,
      rushing_tds:f.rushing_tds, games_played:f.games_played,
    });
  });
}

function isWeekFilterActive(state){
  return !!(state.weekFilter && (state.weekFilter[0]>1 || state.weekFilter[1]<18));
}

// Kick off a week-range fetch+recompute+rerender. Called when the slider is released.
async function applyWeekRange(team, fromWk, toWk){
  const state=userProj[team]; if(!state) return;
  state.weekFilter=[fromWk,toWk];
  state.weekFilterLoading=true;
  renderContent();
  try{
    const [skillData, qbPool] = await Promise.all([
      buildWeekFilterData(team, activeSeason, fromWk, toWk),
      buildWeekFilterQBPool(team, activeSeason, fromWk, toWk),
    ]);
    state.weekFilterData=skillData;
    state.weekFilterQBPool=qbPool;
    state.weekFilterLoading=false;
    state.passing_shares=null; state.rushing.shares=null;  // force rebuild from filtered data
    initPassingShares(team); initRushingShares(team);
    renderContent();
  }catch(e){
    state.weekFilterLoading=false;
    toast('Could not load weekly data for that range','err');
    renderContent();
  }
}
function resetWeekRange(team){
  const state=userProj[team]; if(!state) return;
  state.weekFilter=null; state.weekFilterData=null; state.weekFilterQBPool=null;
  state.passing_shares=null; state.rushing.shares=null;
  initPassingShares(team); initRushingShares(team);
  renderContent();
}
// Live label update while dragging (cheap — no fetch until release).
function weekRangeDrag(team, which, val){
  const state=userProj[team]; if(!state) return;
  const cur = state.weekFilter || [1,18];
  let [lo,hi]=cur;
  val=parseInt(val);
  if(which==='lo'){ lo=Math.min(val,hi); } else { hi=Math.max(val,lo); }
  const loEl=document.getElementById(`wr-lo-${team}`); if(loEl) loEl.textContent=lo;
  const hiEl=document.getElementById(`wr-hi-${team}`); if(hiEl) hiEl.textContent=hi;
  const fill=document.getElementById(`wr-fill-${team}`);
  if(fill){ fill.style.left=((lo-1)/17*100)+'%'; fill.style.right=((18-hi)/17*100)+'%'; }
  state._weekDragPending=[lo,hi];
}
function weekRangeCommit(team){
  const state=userProj[team]; if(!state||!state._weekDragPending) return;
  const [lo,hi]=state._weekDragPending;
  applyWeekRange(team, lo, hi);
}
const TEAMS = ['CIN','PIT','BAL','CLE','HOU','JAX','TEN','IND','BUF','NE',
  'MIA','NYJ','KC','LAC','LV','DEN','GB','DET','MIN','CHI','TB','CAR',
  'ATL','NO','PHI','DAL','WAS','NYG','LAR','SF','SEA','ARI'];
const PCOLORS = ['#4a9eff','#00d4aa','#ff6b35','#c084fc','#fbbf24','#f472b6',
  '#34d399','#a78bfa','#fb923c','#60a5fa','#e879f9','#38bdf8','#f97316','#86efac'];
const SEASON_GAMES = 17;
const TARGET_RATE = 0.95; // targets ≈ pass attempts × this
const PROJ_SEASON = (typeof SEED_SEASON!=='undefined') ? SEED_SEASON : 2026;

function hsURL(p){
  if(!p) return '';
  // Prefer Sleeper's headshot by player_id (most reliable, auto-updates with roster moves).
  if(p.player_id) return SLEEPER_HEADSHOT(p.player_id);
  // No id (e.g. imported from another site) — try to resolve one by name so we still get
  // a Sleeper headshot rather than a broken third-party URL.
  if(typeof resolvePlayerId==='function'){
    const rid=resolvePlayerId(p.name,p.pos);
    if(rid){ p.player_id=rid; return SLEEPER_HEADSHOT(rid); }
  }
  const h=p.headshot||'';
  if(h) return h.startsWith('http') ? h : TFF+h;
  if(p.slug) return TFF+'headshots/'+p.slug+'.jpg';
  return '';
}
function imgTag(src,cls,fb='🏈'){
  if(!src) return `<div class="${cls} ph-err">${fb}</div>`;
  return `<img src="${src}" class="${cls}" alt="" onerror="this.outerHTML='<div class=\\'${cls} ph-err\\'>${fb}</div>'">`;
}
function imgSm(src,cls='share-hs',fb='🏈'){
  if(!src) return `<div class="${cls}-err">${fb}</div>`.replace(cls+'-err',cls.replace('share-hs','share-hs')+'-err');
  return `<img src="${src}" class="${cls}" alt="" onerror="this.outerHTML='<div class=\\'share-hs-err\\'>${fb}</div>'">`;
}

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
let rankSortDir = -1;
let rankFormat = 'half_ppr';   // std | ppr | half_ppr | superflex | dynasty (matches default 0.5 PPR scoring)
let rankPosFilter = 'ALL';
let rankScope = 'all';   // 'all' = full league rankings, 'team' = current team only
// Live seed (starts from embedded SEED_DATA; can be replaced by a live Sleeper pull)
let SEED = (typeof SEED_DATA!=='undefined') ? SEED_DATA : {};
let HISTORY = (typeof SEED_HISTORY!=='undefined') ? SEED_HISTORY : {};
let HISTORY_SEASONS = (typeof SEED_HISTORY_SEASONS!=='undefined') ? SEED_HISTORY_SEASONS : [];
// FantasyPros Expert Consensus Rankings (replaces ADP). Shape: {format:{nameKey:{rank_ecr,tier,age}}}
let ECR = (typeof SEED_ECR!=='undefined') ? SEED_ECR : {};
// OverTheCap contracts (dynasty only): {nameKey:{age,apy,fa,pos}}
let CONTRACTS = (typeof SEED_CONTRACTS!=='undefined') ? SEED_CONTRACTS : {};
let activeSeason = 'proj';   // 'proj' = working projections, or a year string for read-only reference
let sleeperPlayers = null;   // cached Sleeper player DB (id → meta), fetched once
let seasonStatsCache = {};   // season → seed-shaped data built from Sleeper stats
let espnRecordCache = {};    // 'season:TEAM' → record string (from ESPN)
let seasonLoading = false;   // guard for loadSeason to prevent concurrent loads
let seasonStatsFetching = {};// per-season guard for background ensureSeasonStats
// Live draft follow
let draftId = null;
let draftedIds = {};         // player_id → true
let draftTimer = null;
let hideDrafted = false;     // toggle: strike-through vs hide
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
function mergeRosterPlayers(team){
  if(activeSeason!=='proj') return;
  if(!sleeperPlayers || !SEED[team]) return;
  if(SEED[team]._rosterMerged) return;          // once per team is enough
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
    // add a zeroed-out entry so the player is selectable with sliders at 0
    SEED[team][sp.pos].push({
      name:sp.name, player_id:pid, pos:sp.pos, team:team, slug:null, headshot:null, age:sp.age||null,
      passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
      rushing_yards:0,rushing_tds:0,rushing_attempts:0,
      receiving_targets:0,receptions:0,receiving_yards:0,receiving_tds:0,
      adp:999,adp_ppr:999,adp_half_ppr:999,adp_2qb:999,games_played:0,
    });
  }
  SEED[team]._rosterMerged=true;
}
function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }
function markDirty(){ if(importedSnapshot) dirtySinceImport = true; }

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

// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.style.borderColor=type==='ok'?'var(--success)':type==='err'?'var(--danger)':'var(--border)';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),2800);
}

function mkDelta(cur,base,invert){
  const d=+cur-+base;
  if(Math.abs(d)<0.05) return '';
  const s=d>0?'+':'',v=Math.abs(d)<10?d.toFixed(1):Math.round(d);
  // For "bad" stats (interceptions, fumbles) an increase should read RED, not green.
  const good = invert ? (d<0) : (d>0);
  return `<span class="${good?'delta-up':'delta-dn'}">${s}${v}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider fill (div overlay, pixel-perfect)
// ─────────────────────────────────────────────────────────────────────────────
function setFill(el,color){
  const min=parseFloat(el.min)||0,max=parseFloat(el.max)||100,v=parseFloat(el.value)||0;
  const pct=Math.max(0,Math.min(100,(v-min)/(max-min)*100));
  const fill=el.previousElementSibling;
  if(fill&&fill.classList.contains('slider-fill')){
    fill.style.width=pct+'%';
    if(color) fill.style.background=color;
  }
}
function initSliders(){
  document.querySelectorAll('input.sl').forEach(el=>{
    setFill(el,el.dataset.col||null);
    el.oninput=function(){ setFill(this,this.dataset.col||null); handleSlider(this); };
    // Resort the player list only when the user releases the slider (avoids glitchy
    // reordering mid-drag). 'change' fires on pointer-up / keyboard commit.
    el.onchange=function(){ resortAfterRelease(this); };
  });
}
// Set true while a share slider is mid-drag so live updaters skip the DOM reorder.
let sliderDragging=false;
function resortAfterRelease(el){
  sliderDragging=false;
  clearUndoCoalesce();   // next drag starts a fresh undo step
  const key=el.dataset.key||'';
  const state=userProj[el.dataset.team]; if(!state) return;
  if(key.startsWith('ps_')) reorderShareBlocks('shareControls','pblk-',state.passing_shares,'share');
  else if(key.startsWith('tds_')) reorderShareBlocks('shareControls','pblk-',state.passing_shares,'td_share');
  else if(key.startsWith('rs_')) reorderShareBlocks('rushShareControls','rblk-',state.rushing.shares,'share');
  else if(key.startsWith('rtds_')) reorderShareBlocks('rushShareControls','rblk-',state.rushing.shares,'td_share');
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider row builders
// ─────────────────────────────────────────────────────────────────────────────
function sRow(key,label,cur,base,min,max,step,col,invert){
  col=col||'var(--accent)';
  const pct=Math.max(0,Math.min(100,(cur-min)/(max-min)*100));
  const disp=(step<1&&cur%1!==0)?(+cur).toFixed(2):Math.round(cur*10)/10;
  const bDisp=(step<1&&base%1!==0)?(+base).toFixed(2):Math.round(+base);
  return `<div class="stat-row" id="row-${key}" data-invert="${invert?1:0}">
    <div class="stat-header">
      <span class="stat-label">${label}</span>
      <div class="stat-val-group">
        <span class="stat-current" id="sv-${key}" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="manualEdit('${key}',this.textContent,${min},${max})"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">${disp}</span>
        <span class="stat-baseline">/ ${bDisp}</span>
        <span id="sd-${key}">${mkDelta(cur,base,invert)}</span>
      </div>
    </div>
    <div class="slider-track">
      <div class="slider-fill" style="width:${pct}%;background:${col}"></div>
      <input class="sl" type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
        data-key="${key}" data-team="${currentTeam}" data-col="${col}" style="--col:${col}">
    </div>
    <div class="slider-labels"><span>${min}</span><span>${max}</span></div>
  </div>`;
}
function selAll(el){
  // Snapshot the team before this field is edited, so a single edit is one undo step.
  // Coalesced per element so re-selecting the same field doesn't stack duplicates.
  pushUndo(currentTeam, 'edit:'+(el.id||el.getAttribute('onblur')||'field'));
  setTimeout(()=>{ const r=document.createRange();r.selectNodeContents(el);
    const s=window.getSelection();s.removeAllRanges();s.addRange(r);},0);
}
function manualEdit(key,raw,min,max){
  const v=parseFloat(raw);
  if(isNaN(v)){ renderContent(); return; }
  const clamped=Math.max(min,Math.min(max,v));
  const sl=document.querySelector(`input.sl[data-key="${key}"]`);
  if(sl){ sl.value=clamped; setFill(sl,sl.dataset.col||null); handleSliderKey(key,clamped,currentTeam,true); }
  else { handleSliderKey(key,clamped,currentTeam,true); }
}


// ─────────────────────────────────────────────────────────────────────────────
// State init
// ─────────────────────────────────────────────────────────────────────────────
function ensureTeam(team,qbsFromData){
  if(userProj[team]) return userProj[team];
  mergeRosterPlayers(team);   // add zero-stat rostered players so they're selectable
  const seedQBs=getBase(team,'QB');
  const src=qbsFromData||seedQBs;
  userProj[team]={
    qbs:src.map((qb,i)=>{
      const gp=parseFloat(qb.games_played)||0;
      // Prefer the seed's projected `games` (set by projectQBGames from yard share);
      // fall back to real gp, then to a sensible default (starter full season, backups 0).
      let games;
      if(qb.games!=null) games=parseFloat(qb.games)||0;
      else if(gp>0 && gp<=SEASON_GAMES) games=gp;  // real historical gp (≤17)
      else games = (i===0?SEASON_GAMES:0);
      const baseStats = (games>0?games:1);
      const o={
        name:qb.name,headshot:qb.headshot||null,slug:qb.slug||null,player_id:qb.player_id||null,
        adp:parseFloat(qb.adp)||999,adp_ppr:parseFloat(qb.adp_ppr)||999,
        adp_half_ppr:parseFloat(qb.adp_half_ppr)||999,adp_2qb:parseFloat(qb.adp_2qb)||999,
        passing_yards:parseFloat(qb.passing_yards)||0,
        passing_tds:parseFloat(qb.passing_touchdowns||qb.passing_tds)||0,
        passing_attempts:parseFloat(qb.passing_attempts)||0,
        passing_completions:parseFloat(qb.passing_completions)||0,
        interceptions_thrown:parseFloat(qb.interceptions_thrown)||0,
        qb_rush_yards:parseFloat(qb.rushing_yards)||0,
        qb_rush_tds:parseFloat(qb.rushing_touchdowns||qb.rushing_tds)||0,
        qb_rush_attempts:parseFloat(qb.rushing_attempts)||0,
        games_played:(gp<=SEASON_GAMES?gp:0),
        games:games,
        base_games:baseStats,
        snap_pct:(qb.snap_pct!=null)?qb.snap_pct:100,
        snap_share:(typeof qb.snap_share==='number')?qb.snap_share:1/src.length,
      };
      return o;
    }),
    activeQB:0, passing_shares:null,
    rushing:{mode:'carries',total_attempts:null,total_yards:null,ypa:null,shares:null}
  };
  return userProj[team];
}

// Per-game rate for a QB stat. Prefers the stored rate snapshot (survives 0 games),
// else derives from current totals / base_games.
function perGame(qb,key){
  if(qb._rate && qb._rate[key]!=null) return qb._rate[key];
  const bg=qb.base_games||1; return (qb[key]||0)/bg;
}
// Stat projected to the QB's current `games` setting (pace × games).
function pace(qb,key){ return perGame(qb,key)*(qb.games||0); }

function initPassingShares(team){
  const state=ensureTeam(team);
  if(state.passing_shares) return;
  // Include ALL WR/TE on the roster (even zero-stat, so upside picks like a buried TE are
  // selectable), plus RBs with meaningful receiving work.
  let all=[...getBase(team,'WR'),...getBase(team,'TE'),
    ...getBase(team,'RB').filter(p=>(p.receiving_targets>5)||(p.receptions>5))];
  // Reference-season week-range filter active? Overlay windowed totals onto the roster
  // before computing shares — everything downstream (pies, edits) just works on it.
  if(isWeekFilterActive(state) && state.weekFilterData) all=applyWeekFilterOverrides(all, state.weekFilterData);
  // If targets are missing entirely, fall back to receptions for the share denominator.
  const hasTargets = all.some(p=>p.receiving_targets>0);
  const weightOf = p => hasTargets ? (p.receiving_targets||0) : (p.receptions||0);
  const total=all.reduce((s,p)=>s+weightOf(p),0)||1;
  const totalTDs=all.reduce((s,p)=>s+(p.receiving_tds||0),0)||0;
  // Anchor the team target pool to the ACTUAL sum of receiver targets in the data,
  // so share×pool reproduces each player's real targets exactly (no inflation).
  // teamPassAtt×TARGET_RATE is only used as a fallback if no receiver data exists.
  state.team_targets = total;
  state.base_pass_att = teamPassAtt(state); // QB attempts at the moment shares were built
  state.passing_shares=all.map(p=>{
    // If targets are missing, estimate them from receptions so per-player math works.
    const cr = p.pos==='TE' ? 0.68 : 0.65;
    const tgts = p.receiving_targets>0 ? p.receiving_targets
               : (p.receptions>0 ? Math.round(p.receptions/cr) : 0);
    return {
      name:p.name,pos:p.pos,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
      baseline_targets:tgts,baseline_yards:p.receiving_yards,
      baseline_tds:p.receiving_tds||0,baseline_rec:p.receptions,
      share:weightOf(p)/total,
      td_share:totalTDs>0?(p.receiving_tds||0)/totalTDs:1/all.length,
      ypt:tgts>0?p.receiving_yards/tgts:9,
      catch_rate:tgts>0?p.receptions/tgts:cr,
      adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999,
    };
  });
  // team_targets should reflect derived targets when actuals are missing
  state.team_targets = state.passing_shares.reduce((s,p)=>s+p.baseline_targets,0)||total;
}

function initRushingShares(team){
  const state=ensureTeam(team);
  if(state.rushing.shares) return;
  let rbs=getBase(team,'RB');
  if(isWeekFilterActive(state) && state.weekFilterData) rbs=applyWeekFilterOverrides(rbs, state.weekFilterData);
  const elig=rbs.filter(p=>p.rushing_attempts>0||p.adp<300);
  const src=elig.length?elig:rbs.slice(0,2);
  const totalAtt=src.reduce((s,p)=>s+p.rushing_attempts,0)||200;
  const totalYds=src.reduce((s,p)=>s+p.rushing_yards,0)||1600;
  const totalTDs=src.reduce((s,p)=>s+(p.rushing_tds||0),0)||0;
  state.rushing.total_attempts=totalAtt;
  state.rushing.total_yards=totalYds;
  state.rushing.ypa=totalAtt>0?totalYds/totalAtt:4.0;
  state.rushing.total_rush_tds=totalTDs;
  state.rushing.shares=src.map(p=>({
    name:p.name,pos:'RB',headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
    baseline_att:p.rushing_attempts,baseline_yards:p.rushing_yards,baseline_tds:p.rushing_tds||0,
    share:totalAtt>0?p.rushing_attempts/totalAtt:1/src.length,
    td_share:totalTDs>0?(p.rushing_tds||0)/totalTDs:1/src.length,
    ypc:p.rushing_attempts>0?p.rushing_yards/p.rushing_attempts:4.0,
    adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999,
  }));
  recomputeTeamRushYards(state); // sync total yards to sum of per-player (att×ypc)
}

// Team rush TD total — held in state so editing a player's absolute TDs can grow/shrink it.
function teamRushTDs(state){
  const r=state.rushing;
  if(r&&typeof r.total_rush_tds==='number') return r.total_rush_tds;
  return r&&r.shares ? r.shares.reduce((s,p)=>s+(p.baseline_tds||0),0)||0 : 0;
}

// Team rush yards = sum of each RB's (carries × their ypc). Keeps pie + total in sync.
function recomputeTeamRushYards(state){
  const r=state.rushing;
  if(!r.shares) return;
  let total=0;
  r.shares.forEach(p=>{ total += Math.round(p.share*r.total_attempts)*(p.ypc||r.ypa||4); });
  r.total_yards=Math.round(total);
  if(r.total_attempts>0) r.ypa=r.total_yards/r.total_attempts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────
function renderSidebar(){
  const sb=document.getElementById('sidebar');
  let done=0,html='<div class="sidebar-section">Teams</div>';
  TEAMS.forEach(t=>{
    const st=userProj[t];let cls='';
    if(st){
      const a=st.qbs&&st.qbs[0]&&st.qbs[0].passing_yards>0;
      const b=!!st.passing_shares;const c=!!st.rushing.shares;
      if(a&&b&&c){cls='done';done++;}else if(a||b||c)cls='partial';
    }
    html+=`<div class="team-item ${t===currentTeam?'active':''}" onclick="selectTeam('${t}')">
      <img src="${NFL_LOGO(t)}" class="team-logo-sm" alt="${t}" onerror="this.style.display='none'">
      <div class="team-dot ${cls}"></div><span class="team-name">${t}</span></div>`;
  });
  sb.innerHTML=html;
  document.getElementById('progressText').textContent=`${done}/32 teams`;
  document.getElementById('progressFill').style.width=`${done/32*100}%`;
}

function selectTeam(t){
  currentTeam=t;
  // Keep whatever phase the user was on (Targets stays Targets across teams). Only the
  // global Rankings view falls back to a per-team phase since it isn't team-scoped here.
  if(currentPhase==='Rankings') currentPhase='Passing';
  ensureTeam(t);
  // make sure shares exist so the targets/rushing tab is populated as if previously opened
  if(currentPhase==='Passing') initPassingShares(t);
  else if(currentPhase==='Rushing') initRushingShares(t);
  renderSidebar();renderContent();
}
function setPhase(p){
  // The per-team "Rankings" phase tab is team-scoped; the header 🏆 button is league-wide.
  if(p==='Rankings') rankScope='team';
  currentPhase=p;renderContent();
}
function showFullRankings(){ rankScope='all'; currentPhase='Rankings'; renderContent(); }

function renderContent(){
  if(currentPhase==='Rankings'){renderRankings();return;}
  if(!currentTeam){document.getElementById('content').innerHTML=emptyHTML();return;}
  const t=currentTeam,state=userProj[t];
  const tabs=tabBar();
  let body='';
  if(currentPhase==='QB') body=renderQB(t,state);
  else if(currentPhase==='Passing'){initPassingShares(t);body=renderPassing(t,state);}
  else if(currentPhase==='Rushing'){initRushingShares(t);body=renderRushing(t,state);}
  const prev=TEAMS[TEAMS.indexOf(t)-1],next=TEAMS[TEAMS.indexOf(t)+1];
  const isRef = activeSeason!=='proj';
  const recKey = `${activeSeason}:${t}`;
  // In reference mode, fetch this team's record if we don't have it yet (covers switching
  // teams while already viewing a past season — not just entering the season first).
  if(isRef && espnRecordCache[recKey]==null) fetchTeamRecord(activeSeason,t);
  const recStr = isRef ? (espnRecordCache[recKey]||'') : '';
  const seasonBanner = isRef
    ? `<div class="season-readonly">📅 <b>${activeSeason} actual stats</b>${recStr?` · <b>${recStr}</b> record`:''} — read-only reference. Your ${PROJ_SEASON} working projections are untouched.
       ${canUndo(t)?`<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="undoTeam('${t}')" title="Undo the last working-set change for ${t}">↶ Undo last copy</button>`:''}
       <button class="btn btn-accent btn-sm" ${canUndo(t)?'':'style="margin-left:auto"'} onclick="copyTeamToWorking('${t}')">⤵ Copy team to ${PROJ_SEASON} working set</button></div>`
    : '';
  document.getElementById('content').innerHTML=`
    <div class="team-header">
      <img src="${NFL_LOGO(t)}" class="team-logo-lg" alt="${t}" onerror="this.style.opacity='.25'">
      <div><div class="team-abbr">${t} ${isRef?`<span class="ref-year">${activeSeason}</span>`:''}</div>
        <div class="team-qb-name">${(state.qbs&&state.qbs.length)?state.qbs.map(q=>q.name).join(' / '):'No projected QB'}${recStr?` · ${recStr}`:''}</div></div>
      <div class="team-nav">
        <button id="undoBtn" class="btn btn-ghost undo-btn ${canUndo(t)?'':'disabled'}" ${canUndo(t)?'':'disabled'} onclick="undoTeam('${t}')" title="Undo last working-set change to ${t}">↶ ${isRef?'Undo working-set change':'Undo'}<span id="undoCount">${canUndo(t)?' '+undoStacks[t].length:''}</span></button>
        ${prev?`<button class="btn btn-ghost" onclick="selectTeam('${prev}')">← ${prev}</button>`:''}
        ${next?`<button class="btn btn-accent" onclick="selectTeam('${next}')">${next} →</button>`:''}
      </div>
    </div>
    ${seasonBanner}
    <div class="phase-tabs">${tabs}</div>${body}`;
  if(currentPhase==='Passing') initPie(t,'pass');
  else if(currentPhase==='Rushing') initPie(t,'rush');
  initSliders();
  updateUndoButton();
}
function tabBar(){
  return [['QB','⚡ QB'],['Passing','🎯 Targets'],['Rushing','💨 Rushing'],['Rankings','🏆 Rankings']]
    .map(([p,l])=>`<button class="phase-tab ${currentPhase===p?'active':''}" onclick="setPhase('${p}')">${l}</button>`).join('');
}
function emptyHTML(){return`<div class="empty"><div class="empty-icon">🏈</div>
  <div class="empty-title">Select a team to begin</div>
  <div class="empty-body">Work through each team's QB output, receiver target &amp; TD share,
  and RB rushing distribution. Click 🏆 Rankings any time to see fantasy scores.</div></div>`;}


// ─────────────────────────────────────────────────────────────────────────────
// QB Phase
// ─────────────────────────────────────────────────────────────────────────────
function renderQB(team,state){
  if(!state.qbs||!state.qbs.length){
    return `<div class="card"><div class="card-title">Passing Attack</div>
      <div class="alert alert-warn"><span class="alert-icon">⚠️</span>
      <div>No projected QB found for ${team} in this dataset. This can happen with historical
      seasons or sparse projections. Switch seasons or pull live ${PROJ_SEASON} projections.</div></div></div>`;
  }
  const isMulti=state.qbs.length>1;
  const idx=Math.min(state.activeQB||0, state.qbs.length-1);
  const qb=state.qbs[idx];
  const seed=getBase(team,'QB').find(q=>q.name===qb.name)||getBase(team,'QB')[0]||{};
  const compPct=qb.passing_attempts>0?(qb.passing_completions/qb.passing_attempts*100).toFixed(1):'0';
  const ypa=qb.passing_attempts>0?(qb.passing_yards/qb.passing_attempts).toFixed(2):'-';
  const teamGames=state.qbs.reduce((s,q)=>s+(q.games||0),0);
  const overBudget = teamGames > SEASON_GAMES + 0.5;
  // Workload card: per-QB Games (0–17) slider. Drives pace extrapolation. A QB at 0
  // games contributes nothing to team totals but keeps his per-game pace for later.
  const workloadCard = `
    <div class="card">
      <div class="card-title">QB Workload ${isMulti?'<span class="split-badge">SPLIT SQUAD</span>':''}</div>
      ${state.qbs.map((q,i)=>{
        const gms=Math.round(q.games||0);
        const active = i===idx;
        return `<div class="snap-row" style="${active?'border:1px solid var(--qb)':''}">
          ${imgTag(hsURL(q),'player-headshot')}
          <div class="snap-info" style="flex:1">
            <div style="font-size:12px;font-weight:700">${q.name}
              ${q.games_played?`<span style="font-size:9px;color:var(--muted);font-weight:500">· actually played ${Math.round(q.games_played)}</span>`:''}</div>
            <div style="font-size:10px;color:var(--muted)" id="wl-sub-${i}">${gms} games · ${perGame(q,'passing_yards').toFixed(1)} pass yds/gm</div>
          </div>
          ${!active?`<button class="btn btn-ghost btn-sm" onclick="setActiveQB(${i})">edit</button>`:''}
          ${activeSeason!=='proj'&&q.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${q.player_id}','QB')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
        </div>
        ${sRow('games_'+i,'Games Played',gms,Math.round(q.games_played||q.games||0),0,SEASON_GAMES,1,'var(--qb)')}`;
      }).join('')}
      <div class="derived-note" id="qbWorkloadNote" style="${overBudget?'color:var(--warn)':''}">
        Team QB-games: ${teamGames.toFixed(0)} of ${SEASON_GAMES}${overBudget?' ⚠️ over a full season — combined QB workload exceeds 17 games':''}
      </div>
    </div>`;
  const games=Math.round(qb.games||0);
  return `${workloadCard}<div class="card">
    <div class="card-title">${qb.name} — Passing ${isMulti?`<span style="font-size:9px;color:var(--muted)">(editing QB${idx+1} of ${state.qbs.length})</span>`:''}</div>
    ${isMulti?`<div class="qb-tab-bar">${state.qbs.map((q,i)=>
      `<button class="qb-tab ${i===idx?'active':''}" onclick="setActiveQB(${i})">${q.name.split(' ').pop()}</button>`).join('')}</div>`:''}
    <div class="player-row">${imgTag(hsURL(qb),'player-headshot')}
      <span class="pos-badge pos-QB">QB${idx+1}</span>
      <div class="player-name-block"><div class="player-name">${qb.name}</div>
        <div class="player-sub">${(()=>{const e=ecrEntry({name:qb.name});return e&&e.rank_ecr!=null?`ECR ${e.rank_ecr}`:'';})()}${(()=>{const e=ecrEntry({name:qb.name});return e&&e.rank_ecr!=null?' · ':'';})()}<span id="qb-games-sub">${games}</span> games projected</div></div></div>
    <div class="alert alert-info" style="margin-bottom:11px"><span class="alert-icon">📈</span>
      <div>These are this QB's totals across <b>${games} games</b>. Adjust <b>Games Played</b> above to extrapolate a full-season pace (e.g. an 8-game stint scaled to 17), and the stats below scale with it.</div></div>
    ${sRow('py','Passing Yards',Math.round(qb.passing_yards),Math.round(seed.passing_yards||4000),0,7500,50)}
    ${sRow('ptd','Passing TDs',Math.round(qb.passing_tds),Math.round(seed.passing_tds||25),0,65,1)}
    ${sRow('patt','Pass Attempts',Math.round(qb.passing_attempts),Math.round(seed.passing_attempts||560),0,800,5)}
    ${sRow('pcomp','Completions',Math.round(qb.passing_completions),Math.round(seed.passing_completions||360),0,680,5)}
    ${sRow('int','Interceptions',Math.round(qb.interceptions_thrown),Math.round(seed.interceptions_thrown||10),0,40,1,'var(--danger)',true)}
    <div class="derived-note" id="qbDerived">Comp%: ${compPct}% · YPA: ${ypa} · Yds/TD: ${qb.passing_tds>0?Math.round(qb.passing_yards/qb.passing_tds):'-'} · per game: ${perGame(qb,'passing_yards').toFixed(1)} yds</div>
    <div style="margin-top:13px;padding-top:11px;border-top:1px solid var(--border)">
      <div class="card-title">QB Rushing</div>
      ${sRow('qbry','Rush Yards',Math.round(qb.qb_rush_yards),Math.round(seed.rushing_yards||0),0,1400,10,'var(--rb)')}
      ${sRow('qbrtd','Rush TDs',Math.round(qb.qb_rush_tds),Math.round(seed.rushing_tds||0),0,22,1,'var(--rb)')}
      ${sRow('qbratt','Rush Attempts',Math.round(qb.qb_rush_attempts),Math.round(seed.rushing_attempts||0),0,200,5,'var(--rb)')}
    </div>
    ${isMulti?`<div class="derived-note" id="qbTeamTotals" style="margin-top:10px">${qbTotalsText(state)}</div>`:''}
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-box-label">Pass Yds</div><div class="stat-box-val" style="color:var(--qb)" id="sb-py">${Math.round(qb.passing_yards).toLocaleString()}</div></div>
      <div class="stat-box"><div class="stat-box-label">Pass TDs</div><div class="stat-box-val" style="color:var(--qb)" id="sb-ptd">${Math.round(qb.passing_tds)}</div></div>
      <div class="stat-box"><div class="stat-box-label">INTs</div><div class="stat-box-val" style="color:var(--danger)" id="sb-int">${Math.round(qb.interceptions_thrown)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Rush Yds</div><div class="stat-box-val" style="color:var(--rb)" id="sb-ry">${Math.round(qb.qb_rush_yards)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Rush TDs</div><div class="stat-box-val" style="color:var(--rb)" id="sb-rtd">${Math.round(qb.qb_rush_tds)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Attempts</div><div class="stat-box-val" id="sb-att">${Math.round(qb.passing_attempts)}</div></div>
    </div></div>`;
}
function qbTotalsText(state){
  const qbs = state.qbs.filter(q=> (q.games||0) > 0);
  const y=qbs.reduce((s,q)=>s+q.passing_yards,0);
  const t=qbs.reduce((s,q)=>s+q.passing_tds,0);
  const a=qbs.reduce((s,q)=>s+q.passing_attempts,0);
  const i=qbs.reduce((s,q)=>s+q.interceptions_thrown,0);
  return `All QBs combined: ${Math.round(y).toLocaleString()} yds · ${Math.round(t)} TDs · ${Math.round(a)} att · ${Math.round(i)} INTs`;
}
function setActiveQB(idx){userProj[currentTeam].activeQB=idx;renderContent();}

// ─────────────────────────────────────────────────────────────────────────────
// Passing Phase
// ─────────────────────────────────────────────────────────────────────────────
function teamPassAtt(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return state.weekFilterQBPool.pass_att;
  return state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+q.passing_attempts,0);
}
function teamPassTDs(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return state.weekFilterQBPool.pass_tds;
  return state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+q.passing_tds,0);
}

// The team's target pool. Anchored to the ACTUAL sum of receiver targets in the data
// (so historical seasons and untouched projections reproduce real numbers exactly).
// When the user changes QB pass attempts in projection mode, the pool scales from its
// baseline so receiver volume still cascades. Falls back to teamPassAtt×TARGET_RATE.
function teamTargetPool(state){
  const baseTargets = state.team_targets;
  if(!baseTargets){ return Math.round(teamPassAtt(state)*TARGET_RATE); }
  // baseline QB attempts captured the first time shares were built
  if(state.base_pass_att==null){ state.base_pass_att = teamPassAtt(state); }
  const curAtt = teamPassAtt(state);
  if(state.base_pass_att>0 && curAtt>0){
    return Math.round(baseTargets * (curAtt/state.base_pass_att));
  }
  return Math.round(baseTargets);
}

function renderPassing(team,state){
  const totalTgts=teamTargetPool(state);
  const totalTDs=teamPassTDs(state);
  const subTabs=`<div class="sub-tabs">
    <button class="sub-tab ${passingSubTab==='targets'?'active':''}" onclick="setPassSub('targets')">📊 Targets</button>
    <button class="sub-tab ${passingSubTab==='rec'?'active':''}" onclick="setPassSub('rec')">🧤 Receptions</button>
    <button class="sub-tab ${passingSubTab==='recyds'?'active':''}" onclick="setPassSub('recyds')">📏 Rec Yards</button>
    <button class="sub-tab ${passingSubTab==='rec_tds'?'active':''}" onclick="setPassSub('rec_tds')">🎯 TD Share</button></div>`;
  const weekSlider=weekRangeSliderHTML(team,state);
  const body = passingSubTab==='targets' ? renderPassTargets(team,state,totalTgts,totalTDs,subTabs)
    : passingSubTab==='rec' ? renderPassDerived(team,state,subTabs,'rec')
    : passingSubTab==='recyds' ? renderPassDerived(team,state,subTabs,'recyds')
    : renderPassTDs(team,state,totalTDs,subTabs);
  return weekSlider + body;
}
// Dual-handle week-range slider, shown only in reference mode. Lets the user filter the
// Targets/Rushing tabs down to a stretch of weeks (e.g. a player's hot streak before injury).
function weekRangeSliderHTML(team,state){
  if(activeSeason==='proj') return '';
  const [lo,hi]=state.weekFilter||[1,18];
  const active=isWeekFilterActive(state);
  const loPct=(lo-1)/17*100, hiPct=(18-hi)/17*100;
  return `<div class="week-range-card">
    <div class="week-range-label">
      <span>📅 Filter weeks: <b id="wr-lo-${team}">${lo}</b> – <b id="wr-hi-${team}">${hi}</b>${state.weekFilterLoading?' <span class="week-range-loading">loading…</span>':''}</span>
      ${active?`<span class="week-range-reset" onclick="resetWeekRange('${team}')">↺ Reset to full season</span>`:'<span class="week-range-hint">drag either end to zoom into a stretch of games</span>'}
    </div>
    <div class="dual-slider">
      <div class="dual-slider-track"></div>
      <div class="dual-slider-fill" id="wr-fill-${team}" style="left:${loPct}%;right:${hiPct}%"></div>
      <input type="range" min="1" max="18" step="1" value="${lo}" class="dual-range dual-range-lo"
        oninput="weekRangeDrag('${team}','lo',this.value)" onchange="weekRangeCommit('${team}')">
      <input type="range" min="1" max="18" step="1" value="${hi}" class="dual-range dual-range-hi"
        oninput="weekRangeDrag('${team}','hi',this.value)" onchange="weekRangeCommit('${team}')">
    </div>
  </div>`;
}
function setPassSub(t){passingSubTab=t;renderContent();}

// Total receiving yardage available = the QBs' combined passing yards (identity: team
// passing yards == team receiving yards). Used as the rec-yards pool/denominator.
function teamRecYardsPool(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return Math.round(state.weekFilterQBPool.pass_yards);
  return Math.round(state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+(q.passing_yards||0),0));
}
// Total receptions available = the QBs' combined completions (identity: completions ==
// receptions at the team level). This is what the receivers' catches should sum to.
function teamRecPool(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool && state.weekFilterQBPool.comp>0) return Math.round(state.weekFilterQBPool.comp);
  const comp=state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+(q.passing_completions||0),0);
  if(comp>0) return Math.round(comp);
  // fall back to targets × league-avg catch rate if completions aren't populated
  return Math.round((state.passing_shares||[]).reduce((s,p)=>{
    const tgts=p.share*teamTargetPool(state); return s+tgts*(p.catch_rate||0.65);
  },0));
}

// Compute production "vacated" by players who were on the team last season but are no
// longer on the current roster (free agency, retirement, trade). Helps see how much
// target/reception/yard/TD volume needs to be absorbed by the remaining roster.
function vacatedProduction(team){
  if(activeSeason!=='proj') return null;       // only meaningful for the upcoming season
  const lastYear = (HISTORY_SEASONS&&HISTORY_SEASONS.length)?HISTORY_SEASONS[0]:String(PROJ_SEASON-1);
  // Build last year's roster for this team. Prefer embedded HISTORY; if that's empty
  // (e.g. running off a live Sleeper pull with no prebuilt seed), fetch it in the
  // background and re-render when it lands so the note appears without a prebuilt seed.
  if(!seasonStatsCache[lastYear]){
    if(HISTORY && Object.keys(HISTORY).length){
      const built=buildSeedFromHistory(lastYear); if(built) seasonStatsCache[lastYear]=built;
    } else {
      ensureSeasonStats(lastYear);   // async; re-renders on arrival
    }
  }
  const prev=seasonStatsCache[lastYear] && seasonStatsCache[lastYear][team];
  if(!prev) return null;
  // Build the set of player_ids CURRENTLY on this team. Use the full Sleeper player DB
  // (not just projected players) so someone still rostered but projected for 0 stats
  // (e.g. Charlie Jones) is NOT counted as vacated.
  const curIds=new Set();
  const ps=projSeed||seasonStatsCache['proj']||{};
  ['QB','RB','WR','TE'].forEach(pos=>(ps[team]&&ps[team][pos]||[]).forEach(p=>p.player_id&&curIds.add(p.player_id)));
  if(sleeperPlayers){
    for(const pid in sleeperPlayers){ if(sleeperPlayers[pid].team===team) curIds.add(pid); }
  }
  let tgt=0,rec=0,yds=0,td=0; const gone=[];
  ['WR','TE','RB'].forEach(pos=>(prev[pos]||[]).forEach(p=>{
    if(p.player_id && !curIds.has(p.player_id) && (p.receiving_targets>0||p.receptions>0)){
      tgt+=p.receiving_targets||0; rec+=p.receptions||0; yds+=p.receiving_yards||0; td+=p.receiving_tds||0;
      gone.push({name:p.name, tgt:p.receiving_targets||0});
    }
  }));
  if(!gone.length) return null;
  // most-targeted (most impactful) players first
  gone.sort((a,b)=>b.tgt-a.tgt);
  return {season:lastYear, tgt:Math.round(tgt), rec:Math.round(rec), yds:Math.round(yds), td:Math.round(td), players:gone.map(g=>g.name)};
}
function vacatedNote(team){
  const v=vacatedProduction(team);
  if(!v) return '';
  const names = v.players.length>3 ? v.players.slice(0,3).join(', ')+` +${v.players.length-3} more` : v.players.join(', ');
  return `<div class="vacated-note">
    <span class="vacated-icon">📤</span>
    <div><b>Vacated from ${v.season}:</b> ${v.tgt} targets · ${v.rec} rec · ${v.yds.toLocaleString()} yds · ${v.td} TD
    <span style="color:var(--muted)"> — left by ${names}.</span>
    <span style="color:var(--muted)">This production is up for grabs among the current roster.</span></div></div>`;
}
// Receptions / Receiving-Yards share view — editable, mirrors the target-share tab.
// Colors are keyed to each player's ORIGINAL index (PCOLORS[i]) so the pie slices and
// the rows always line up. Each player has a rec_share / recyds_share that rebalances the
// others exactly like target share. A discrepancy banner flags when the receivers' summed
// production doesn't match what the QBs are projected to throw for, with a one-click fix.
function renderPassDerived(team,state,subTabs,metric){
  ensureDerivedShares(state,metric);
  const totalTgts=teamTargetPool(state);
  const isYds = metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const key=isYds?'recyds':'rec';
  const label=isYds?'rec yds':'rec';
  // The "available" pool from the QBs vs. what the receivers actually add up to right now.
  const qbPool = isYds ? teamRecYardsPool(state) : teamRecPool(state);
  const receiverSum = state.passing_shares.reduce((s,p)=>{
    const tg=p.share*totalTgts; return s + (isYds ? tg*(p.ypt||9) : tg*(p.catch_rate||0.65));
  },0);
  const diff = Math.round(qbPool - receiverSum);
  const order=state.passing_shares.map((p,i)=>i).sort((a,b)=>(state.passing_shares[b][field]||0)-(state.passing_shares[a][field]||0));
  const rows=order.map(i=>{
    const p=state.passing_shares[i]; const col=PCOLORS[i%PCOLORS.length];
    const sh=p[field]||0; const pct=(sh*100).toFixed(1);
    const v=Math.round(sh*qbPool);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        ${imgSm(hsURL(p))}<span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name" title="${p.name}">${p.name}</span>
        <span class="share-pct" id="dp-${i}">${pct}%</span>
        <span class="share-vol" id="dv-${i}">${v.toLocaleString()} ${label}</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="0.5" value="${pct}"
          data-key="${key}_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Tgts <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editTargets(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-tgt-${i}">${projTgts}</span></span>
        <span class="share-stat">Rec <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRec(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-rec-${i}">${projRec}</span></span>
        <span class="share-stat">Catch% <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCatchPct(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="cr-${i}">${(p.catch_rate*100).toFixed(0)}</span>%</span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="yd-${i}">${projYds}</span></span>
        <span class="share-stat">Y/Tgt <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpt(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ypt-${i}">${(p.ypt||9).toFixed(1)}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtd-${i}">${(p.td_share*teamPassTDs(state)).toFixed(1)}</span></span>
      </div></div>`;
  }).join('');
  const unit=isYds?'receiving yards':'receptions';
  const title = isYds ? 'Receiving Yardage Share' : 'Receptions Share';
  // Discrepancy banner: only meaningful when the gap is non-trivial (>2% of the pool).
  const threshold = isYds ? Math.max(40, qbPool*0.02) : Math.max(3, qbPool*0.02);
  let banner;
  if(Math.abs(diff) > threshold){
    const sign = diff>0?'short of':'over';
    banner = `<div class="discrepancy-note">
      <span class="vacated-icon">${diff>0?'⚠️':'❗'}</span>
      <div><b>${Math.abs(diff).toLocaleString()} ${unit} ${sign} the QB total.</b>
      The QBs are projected for <b>${qbPool.toLocaleString()} ${unit}</b>, but the receivers currently add up to
      <b>${Math.round(receiverSum).toLocaleString()}</b>. ${diff>0
        ? 'That production is unclaimed — distribute it across the receiving corps.'
        : 'The receivers exceed the QBs\' output — trim it down to reconcile.'}
      <button class="btn btn-accent btn-sm" style="margin-top:6px" onclick="reconcileDerived('${team}','${metric}')">
        ${diff>0?'Distribute':'Reconcile'} the ${diff>0?'difference':'overage'} →</button></div></div>`;
  } else {
    banner = `<div class="reconciled-note">✅ Receivers match the QBs' projected ${unit} (${qbPool.toLocaleString()}).</div>`;
  }
  return `<div class="card"><div class="card-title">${title}</div>${subTabs}
    ${vacatedNote(team)}
    ${banner}
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="derivedPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="derivedSub">${Math.round(qbPool).toLocaleString()} ${isYds?'yds':'rec'}</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}

// Distribute (or trim) the gap between the QBs' projected output and the receivers' sum,
// spread proportionally across the existing receiving corps by their current share.
function reconcileDerived(team,metric){
  const state=userProj[team]; if(!state) return;
  pushUndo(team,"reconcileDerived:"+metric); markDirty();
  const isYds=metric==='recyds';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const qbPool=isYds?teamRecYardsPool(state):teamRecPool(state);
  const shares=state.passing_shares;
  const valOf=p=>{const tg=p.share*totalTgts;return isYds?tg*(p.ypt||9):tg*(p.catch_rate||0.65);};
  const receiverSum=shares.reduce((s,p)=>s+valOf(p),0)||1;
  // scale every receiver's rate so their summed production equals the QB pool
  const k=qbPool/receiverSum;
  shares.forEach(p=>{
    if(isYds) p.ypt=Math.max(0,Math.min(40,(p.ypt||9)*k));
    else p.catch_rate=Math.max(0,Math.min(1.5,(p.catch_rate||0.65)*k));
  });
  // refresh derived share fields to reflect the reconciled values
  shares.forEach(p=>{ delete p.rec_share; delete p.recyds_share; });
  ensureDerivedShares(state,metric);
  renderContent();
  toast(`Reconciled ${isYds?'receiving yards':'receptions'} to the QB total ✓`,'ok');
}

// Sort shares descending by the active metric so the leader floats to top
function sortedIdx(shares,field){
  return shares.map((p,i)=>i).sort((a,b)=>shares[b][field]-shares[a][field]);
}

function renderPassTargets(team,state,totalTgts,totalTDs,subTabs){
  const order=sortedIdx(state.passing_shares,'share');
  const rows=order.map(i=>{
    const p=state.passing_shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.share*100).toFixed(1);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row">
        <div class="share-dot" style="background:${col}"></div>
        ${imgSm(hsURL(p))}
        <span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name" title="${p.name}">${p.name}</span>
        <span class="share-pct" id="pp-${i}">${pct}%</span>
        <span class="share-vol" id="pt-${i}">${projTgts} tgt</span>
        ${activeSeason!=='proj'&&p.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${p.player_id}','${p.pos}')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
      </div>
      <div class="slider-track">
        <div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="0.5" value="${pct}"
          data-key="ps_${i}" data-team="${team}" data-col="${col}" style="--col:${col}">
      </div>
      <div class="share-stats">
        <span class="share-stat">Tgts <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editTargets(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-tgt-${i}">${projTgts}</span></span>
        <span class="share-stat">Rec <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRec(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-rec-${i}">${projRec}</span></span>
        <span class="share-stat">Catch% <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCatchPct(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="cr-${i}">${(p.catch_rate*100).toFixed(0)}</span>%</span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="yd-${i}">${projYds}</span></span>
        <span class="share-stat">Y/Tgt <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpt(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ypt-${i}">${(p.ypt||9).toFixed(1)}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtd-${i}">${projTDs}</span></span>
      </div></div>`;
  }).join('');
  // Discrepancy: the team's pass attempts imply ~att×TARGET_RATE targets, but the
  // receivers' targets sum to state.team_targets. Flag a meaningful gap and offer a fix.
  const expectTgts=Math.round(teamPassAtt(state)*TARGET_RATE);
  const tgtDiff=expectTgts-Math.round(totalTgts);
  const tThresh=Math.max(8, expectTgts*0.03);
  let tgtBanner='';
  if(Math.abs(tgtDiff)>tThresh){
    tgtBanner=`<div class="discrepancy-note"><span class="vacated-icon">${tgtDiff>0?'⚠️':'❗'}</span>
      <div><b>${Math.abs(tgtDiff)} targets ${tgtDiff>0?'unaccounted for':'over the QB total'}.</b>
      The QBs' ${teamPassAtt(state)} attempts imply about <b>${expectTgts} targets</b>, but the receivers add up to <b>${Math.round(totalTgts)}</b>.
      <button class="btn btn-accent btn-sm" style="margin-top:6px" onclick="reconcileTargets('${team}')">${tgtDiff>0?'Distribute':'Reconcile'} the difference →</button></div></div>`;
  }
  return `<div class="card"><div class="card-title">Receiver Target Share</div>${subTabs}
    ${vacatedNote(team)}
    ${tgtBanner}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTgts} total targets (${teamPassAtt(state)} att × ${TARGET_RATE}) · ${teamRecYardsPool(state).toLocaleString()} receiving yards available · ${totalTDs} pass TDs.
      Drag a share to 100% and others rebalance. Or edit <b>Tgts</b>/<b>Rec</b> directly — shares recompute.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="pieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="pieSub">${totalTgts} targets</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}

// Scale the receiver target pool up/down to match the QBs' attempts × target rate, holding
// each receiver's share. Then reanchor team_targets so the per-player targets reflect it.
function reconcileTargets(team){
  const state=userProj[team]; if(!state) return;
  pushUndo(team,"reconcileTargets"); markDirty();
  const expectTgts=Math.round(teamPassAtt(state)*TARGET_RATE);
  // re-anchor: set each player's baseline so share×pool = their new target count
  state.team_targets=expectTgts;
  state.base_pass_att=teamPassAtt(state);
  renderContent();
  toast(`Targets reconciled to ${expectTgts} (QB attempts × ${TARGET_RATE}) ✓`,'ok');
}

function renderPassTDs(team,state,totalTDs,subTabs){
  const order=sortedIdx(state.passing_shares,'td_share');
  const rows=order.map(i=>{
    const p=state.passing_shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.td_share*100).toFixed(1);
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        ${imgSm(hsURL(p))}<span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name" title="${p.name}">${p.name}</span>
        <span class="share-pct" id="tdp-${i}">${pct}%</span>
        <span class="share-vol">proj TDs</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="tds_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Rec TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDsAbs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="tdt-${i}">${projTDs}</span></span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Receiving TD Share</div>${subTabs}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTDs} total passing TDs (from the QB tab). Each player's projected receiving TDs = share × ${totalTDs}.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="pieChart" width="150" height="150"></canvas>
        <div class="pie-sub">${totalTDs} rec TDs</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}


// ─────────────────────────────────────────────────────────────────────────────
// Rushing Phase
// ─────────────────────────────────────────────────────────────────────────────
function renderRushing(team,state){
  const r=state.rushing;
  const baseAtt=getBase(team,'RB').reduce((s,p)=>s+p.rushing_attempts,0)||200;
  const baseYds=getBase(team,'RB').reduce((s,p)=>s+p.rushing_yards,0)||1600;
  const subTabs=`<div class="sub-tabs">
    <button class="sub-tab ${rushingSubTab==='carries'?'active':''}" onclick="setRushSub('carries')">🏃 Carry Share</button>
    <button class="sub-tab ${rushingSubTab==='rush_tds'?'active':''}" onclick="setRushSub('rush_tds')">🏆 Rush TD Share</button></div>`;
  const weekSlider=weekRangeSliderHTML(team,state);
  const body = rushingSubTab==='carries' ? renderRushCarries(team,state,baseAtt,baseYds,subTabs) : renderRushTDs(team,state,subTabs);
  return weekSlider + body;
}
function setRushSub(t){rushingSubTab=t;renderContent();}

function renderRushCarries(team,state,baseAtt,baseYds,subTabs){
  const r=state.rushing;
  const qbRushAtt=state.qbs.reduce((s,q)=>s+q.qb_rush_attempts,0);
  const totalIncQB=(r.total_attempts||0)+qbRushAtt;
  const totalTDs=teamRushTDs(state);
  const order=sortedIdx(r.shares,'share');
  const rows=order.map(i=>{
    const p=r.shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.share*100).toFixed(1);
    const att=Math.round(p.share*r.total_attempts);
    const yds=Math.round(att*(p.ypc||r.ypa||4));
    const tds=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="rblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        ${imgSm(hsURL(p))}<span class="pos-badge pos-RB">RB</span>
        <span class="share-name" title="${p.name}">${p.name}</span>
        <span class="share-pct" id="rp-${i}">${pct}%</span>
        <span class="share-vol" id="ra-${i}">${att} att</span>
        ${activeSeason!=='proj'&&p.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${p.player_id}','RB')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
        </div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="rs_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Att <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCarries(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-att-${i}">${att}</span></span>
        <span class="share-stat">Y/Carry <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpc(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-ypc-${i}">${(p.ypc||r.ypa||4).toFixed(2)}</span></span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ryd-${i}">${yds}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushTDsCarry(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtdv-${i}">${tds}</span></span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Team Rushing Volume</div>
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>Set total RB carries and total rushing yards. Each RB's yards = their carries × their Y/Carry;
      changing the team total scales every RB's efficiency proportionally.</div></div>
    ${sRow('rush_total_att','RB Carries (excl QB)',r.total_attempts,baseAtt,0,600,5,'var(--rb)')}
    ${sRow('rush_total_yds','Total RB Rush Yards',r.total_yards,baseYds,0,3500,25,'var(--rb)')}
    <div class="derived-note" id="rushDerived">${rushNote(state)}</div></div>
  <div class="card"><div class="card-title">RB Carry Share</div>${subTabs}
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="rushPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="rushTotalLbl">${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds</div></div>
      <div class="pie-controls" id="rushShareControls">${rows}</div></div></div>`;
}

function renderRushTDs(team,state,subTabs){
  const r=state.rushing;
  const totalTDs=teamRushTDs(state);
  const order=sortedIdx(r.shares,'td_share');
  const rows=order.map(i=>{
    const p=r.shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.td_share*100).toFixed(1);
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="rblk-${i}"><div class="share-row">
        <div class="share-dot" style="background:${col}"></div>
        ${imgSm(hsURL(p))}<span class="pos-badge pos-RB">RB</span>
        <span class="share-name" title="${p.name}">${p.name}</span>
        <span class="share-pct" id="rtdp-${i}">${pct}%</span>
        <span class="share-vol">proj TDs</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="rtds_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Rush TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushTDsAbs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtdt-${i}">${projTDs}</span></span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Team Rushing TDs</div>
    ${sRow('rush_total_tds','Total RB Rush TDs',totalTDs,Math.round(totalTDs),0,40,1,'var(--rb)')}
    <div class="derived-note">Set the team's total RB rushing TDs; each back's share below splits this total.</div></div>
  <div class="card"><div class="card-title">Rushing TD Share</div>${subTabs}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTDs.toFixed(0)} projected RB rushing TDs. QB rushing TDs are set separately on the QB tab.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="rushPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="rushTDLbl">${totalTDs.toFixed(0)} rush TDs</div></div>
      <div class="pie-controls" id="rushShareControls">${rows}</div></div></div>`;
}
function rushNote(state){
  const r=state.rushing;
  const qbRushAtt=state.qbs.reduce((s,q)=>s+q.qb_rush_attempts,0);
  const totalIncQB=(r.total_attempts||0)+qbRushAtt;
  return `RB carries: ${r.total_attempts} · team YPA: ${(r.ypa||0).toFixed(2)} · RB yards: ${(r.total_yards||0).toLocaleString()} · incl QB: ~${totalIncQB} carries`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pie charts
// ─────────────────────────────────────────────────────────────────────────────
function initPie(team,kind){
  const state=userProj[team];
  if(kind==='pass'){
    // Receptions / Rec-Yards tabs: a separate canvas. Build pie data in ORIGINAL player
    // order (same index basis as PCOLORS[i] used by the rows) so slice colors line up.
    if(passingSubTab==='rec'||passingSubTab==='recyds'){
      const ctx=document.getElementById('derivedPieChart');if(!ctx)return;
      if(pieChart){pieChart.destroy();pieChart=null;}
      if(!state.passing_shares) return;
      const totalTgts=teamTargetPool(state);
      const isYds=passingSubTab==='recyds';
      const value=p=>{const tgts=p.share*totalTgts;return isYds?tgts*(p.ypt||9):tgts*(p.catch_rate||0.65);};
      const vals=state.passing_shares.map(value);
      const pool=vals.reduce((s,v)=>s+v,0)||1;
      const data=vals.map(v=>v/pool); // original order → matches PCOLORS[i] in the rows
      const labels=state.passing_shares.map(p=>p.name.split(' ').pop());
      pieChart=mkDoughnut(ctx,labels,data);
      return;
    }
    if(!state.passing_shares) return;
    const ctx=document.getElementById('pieChart');if(!ctx)return;
    if(pieChart){pieChart.destroy();pieChart=null;}
    const data=passingSubTab==='targets'?state.passing_shares.map(p=>p.share):state.passing_shares.map(p=>p.td_share);
    pieChart=mkDoughnut(ctx,state.passing_shares.map(p=>p.name.split(' ').pop()),data);
  } else {
    if(!state.rushing.shares) return;
    const ctx=document.getElementById('rushPieChart');if(!ctx)return;
    if(pieChart){pieChart.destroy();pieChart=null;}
    const data=rushingSubTab==='carries'?state.rushing.shares.map(p=>p.share):state.rushing.shares.map(p=>p.td_share);
    pieChart=mkDoughnut(ctx,state.rushing.shares.map(p=>p.name.split(' ').pop()),data);
  }
}
function mkDoughnut(ctx,labels,data){
  return new Chart(ctx,{type:'doughnut',data:{labels,
    datasets:[{data,backgroundColor:PCOLORS.slice(0,data.length),borderWidth:0,hoverOffset:3}]},
    options:{cutout:'55%',plugins:{legend:{display:false},
      tooltip:{callbacks:{label:c=>` ${(c.raw*100).toFixed(1)}%`}}},animation:{duration:150}}});
}
function updatePie(data){ if(pieChart){pieChart.data.datasets[0].data=data;pieChart.update('none');} }

function normalizeShares(shares,idx,field){
  field=field||'share';
  const v=shares[idx][field];
  const rest=shares.filter((_,i)=>i!==idx);
  const restTotal=rest.reduce((s,p)=>s+p[field],0);
  const rem=Math.max(0,1-v);
  if(restTotal>0) rest.forEach(p=>{p[field]=p[field]/restTotal*rem;});
  else rest.forEach(p=>{p[field]=rem/rest.length;});
}


// ─────────────────────────────────────────────────────────────────────────────
// Slider / edit handlers
// ─────────────────────────────────────────────────────────────────────────────
function handleSlider(el){
  // Snapshot once at the start of a drag (coalesced by the slider's key so a continuous
  // drag pushes a single undo step, not one per tick).
  if(!sliderDragging) pushUndo(el.dataset.team, 'slider:'+(el.dataset.key||''));
  sliderDragging=true;
  handleSliderKey(el.dataset.key,parseFloat(el.value),el.dataset.team,false);
}

function handleSliderKey(key,val,team,fromManual){
  const state=userProj[team]; if(!state) return;
  markDirty();
  // mirror numeric into the editable display (unless user is editing it)
  const svEl=document.getElementById(`sv-${key}`);
  if(svEl&&document.activeElement!==svEl) svEl.textContent=(val%1!==0&&val<200)?(+val).toFixed(2):Math.round(val);

  // ── QB stats ──
  const QB_MAP={py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',
    pcomp:'passing_completions',int:'interceptions_thrown',
    qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'};
  if(key in QB_MAP){
    const idx=state.activeQB||0;
    state.qbs[idx][QB_MAP[key]]=val;
    liveQB(state,idx,team,key);
    if(key==='patt') livePassDependents(state,team); // attempts drive the target pool
    return;
  }
  // ── QB Games Played (drives pace extrapolation) ──
  if(key.startsWith('games_')){
    const qi=parseInt(key.slice(6));
    const q=state.qbs[qi];
    const newGames=Math.max(0,Math.round(val));
    const STATK=['passing_yards','passing_tds','passing_attempts','passing_completions',
      'interceptions_thrown','qb_rush_yards','qb_rush_tds','qb_rush_attempts'];
    // Capture per-game rates from the CURRENT totals/games before changing games, so the
    // pace survives even a trip to 0 games (totals→0 but rates remembered on q._rate).
    const fromGames = q.games||0;
    if(fromGames>0){
      q._rate = {}; STATK.forEach(k=>{ q._rate[k]=(q[k]||0)/fromGames; });
    } else if(!q._rate){
      // never had recorded games and no stored rate: treat current totals as a 1-game rate
      q._rate = {}; STATK.forEach(k=>{ q._rate[k]=(q[k]||0); });
    }
    // else: coming back from 0 games — keep the previously stored q._rate.
    // Apply rate × newGames (newGames may be 0 → zero contribution, rates kept on q._rate)
    STATK.forEach(k=>{ q[k]=(q._rate[k]||0)*newGames; });
    q.games=newGames;
    q.base_games=newGames||1;
    updateWorkloadUI(state,qi,team);
    liveQB(state,qi,team,null);
    refreshQBStatSliders(state,qi);
    livePassDependents(state,team);
    return;
  }
  // ── Target share ──
  if(key.startsWith('ps_')){
    const i=parseInt(key.slice(3));
    state.passing_shares[i].share=val/100;
    normalizeShares(state.passing_shares,i,'share');
    if(passingSubTab==='targets') updatePie(state.passing_shares.map(p=>p.share));
    livePassTargets(state,team);
    return;
  }
  // ── Rec TD share ──
  if(key.startsWith('tds_')){
    const i=parseInt(key.slice(4));
    state.passing_shares[i].td_share=val/100;
    normalizeShares(state.passing_shares,i,'td_share');
    if(passingSubTab==='rec_tds') updatePie(state.passing_shares.map(p=>p.td_share));
    liveTDRows('tdp','tdt',state.passing_shares,teamPassTDs(state),'tds_',true);
    return;
  }
  // ── Receptions share (edit catch rates so each player hits the new rec share) ──
  if(key.startsWith('recyds_')){
    const i=parseInt(key.slice(7));
    setDerivedShare(state,team,i,val/100,'recyds');
    return;
  }
  if(key.startsWith('rec_')){
    const i=parseInt(key.slice(4));
    setDerivedShare(state,team,i,val/100,'rec');
    return;
  }
  // ── Team rush carries ──
  if(key==='rush_total_att'){
    state.rushing.total_attempts=val;
    recomputeTeamRushYards(state);
    liveRush(state,team);
    // keep the yards slider in sync (carries change → yards recompute)
    const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
    if(ys){ys.value=state.rushing.total_yards;setFill(ys,'var(--rb)');
      const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=state.rushing.total_yards;}
    return;
  }
  // ── Team total rush yards: scale each RB's Y/Carry to hit the target ──
  if(key==='rush_total_yds'){
    scaleTeamRushYards(state,val);
    liveRush(state,team);
    return;
  }
  // ── Team total RB rushing TDs ──
  if(key==='rush_total_tds'){
    state.rushing.total_rush_tds=Math.max(0,val);
    const lbl=document.getElementById('rushTDLbl'); if(lbl) lbl.textContent=`${Math.round(val)} rush TDs`;
    if(rushingSubTab==='rush_tds'){
      liveTDRows('rtdp','rtdt',state.rushing.shares,teamRushTDs(state),'rtds_',true);
    }
    return;
  }
  // ── RB carry share ──
  if(key.startsWith('rs_')){
    const i=parseInt(key.slice(3));
    state.rushing.shares[i].share=val/100;
    normalizeShares(state.rushing.shares,i,'share');
    recomputeTeamRushYards(state);
    if(rushingSubTab==='carries') updatePie(state.rushing.shares.map(p=>p.share));
    liveRushRows(state,team);
    return;
  }
  // ── Rush TD share ──
  if(key.startsWith('rtds_')){
    const i=parseInt(key.slice(5));
    state.rushing.shares[i].td_share=val/100;
    normalizeShares(state.rushing.shares,i,'td_share');
    if(rushingSubTab==='rush_tds') updatePie(state.rushing.shares.map(p=>p.td_share));
    const totalTDs=teamRushTDs(state);
    liveTDRows('rtdp','rtdt',state.rushing.shares,totalTDs,'rtds_',true);
    return;
  }
}

// ── Editable stat fields (targets, receptions, carries, ypc) ──
function editTargets(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  state.passing_shares[i].share=Math.max(0,Math.min(1,v/totalTgts));
  normalizeShares(state.passing_shares,i,'share');
  if(passingSubTab==='targets') updatePie(state.passing_shares.map(p=>p.share));
  livePassTargets(state,currentTeam);
}
function editRec(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  const projTgts=Math.max(1,Math.round(state.passing_shares[i].share*totalTgts));
  // set catch rate = rec / projected targets
  state.passing_shares[i].catch_rate=Math.max(0,Math.min(1.2,v/projTgts));
  livePassTargets(state,currentTeam);
}
function editCarries(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const tot=Math.max(1,state.rushing.total_attempts);
  state.rushing.shares[i].share=Math.max(0,Math.min(1,v/tot));
  normalizeShares(state.rushing.shares,i,'share');
  recomputeTeamRushYards(state);
  if(rushingSubTab==='carries') updatePie(state.rushing.shares.map(p=>p.share));
  liveRushRows(state,currentTeam);
  // update the team total label/derived
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
}
function editYpc(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  state.rushing.shares[i].ypc=Math.max(0,Math.min(15,v));
  recomputeTeamRushYards(state);
  liveRushRows(state,currentTeam);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  syncRushYdsSlider(state);
}
// Edit a player's absolute rushing yards → back out Y/Carry so att×ypc = entered, feeds team total
function editRushYds(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const r=state.rushing;
  const att=Math.max(1,Math.round(r.shares[i].share*r.total_attempts));
  r.shares[i].ypc=Math.max(0,Math.min(15,v/att));
  recomputeTeamRushYards(state);
  liveRushRows(state,currentTeam);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  syncRushYdsSlider(state);
}
// Edit a player's absolute rushing TDs from the carry view → grows/shrinks team rush-TD total
function editRushTDsCarry(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw);
  const totalTDs=teamRushTDs(state);
  if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const others=state.rushing.shares.filter((_,j)=>j!==i).reduce((s,p)=>s+p.td_share*totalTDs,0);
  const newTotal=Math.max(0.1,others+Math.max(0,v));
  state.rushing.total_rush_tds=newTotal;
  state.rushing.shares.forEach((p,j)=>{ p.td_share=(j===i?Math.max(0,v):p.td_share*totalTDs)/newTotal; });
  liveRushRows(state,currentTeam);
}

// Scale every RB's Y/Carry proportionally so team yards = target.
function scaleTeamRushYards(state,targetYds){
  const r=state.rushing;
  markDirty();
  const cur=r.total_yards||0;
  if(cur>0){
    const factor=targetYds/cur;
    r.shares.forEach(p=>{ p.ypc=Math.max(0,Math.min(15,(p.ypc||r.ypa||4)*factor)); });
  } else if(r.total_attempts>0){
    const flat=targetYds/r.total_attempts;
    r.shares.forEach(p=>{ p.ypc=Math.max(0,Math.min(15,flat)); });
  }
  recomputeTeamRushYards(state);
}
function syncRushYdsSlider(state){
  const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
  if(ys){ys.value=state.rushing.total_yards;setFill(ys,'var(--rb)');
    const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=state.rushing.total_yards;}
}

// ── Passing: editable Catch%, Receiving Yards, Y/Tgt, Receiving TDs ──
function editCatchPct(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  state.passing_shares[i].catch_rate=Math.max(0,Math.min(1.2,v/100));
  livePassTargets(state,currentTeam);
}
function editRecYds(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  const projTgts=Math.max(1,Math.round(state.passing_shares[i].share*totalTgts));
  // back out Y/Tgt so projected yards = entered value
  state.passing_shares[i].ypt=Math.max(0,Math.min(25,v/projTgts));
  livePassTargets(state,currentTeam);
}
function editYpt(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  state.passing_shares[i].ypt=Math.max(0,Math.min(25,v));
  livePassTargets(state,currentTeam);
}

// Set player i's share of receptions ('rec') or receiving yards ('recyds'). Works exactly
// like the target-share tab: the dragged player gets the new share, the others rebalance
// proportionally to fill the remainder. The share is stored on its own field (rec_share /
// recyds_share) and the per-player rate (catch_rate / ypt) is back-solved so totals match.
function setDerivedShare(state,team,i,share,metric){
  markDirty();
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const shares=state.passing_shares;
  ensureDerivedShares(state,metric);            // make sure the share field is populated
  shares[i][field]=Math.max(0,Math.min(1,share));
  normalizeShares(shares,i,field);              // rebalance the others (same as targets)
  // back-solve the per-player rate so the pool distributes by the new shares
  applyDerivedShares(state,metric);
  liveDerivedRows(state,team,metric);
}

// Populate rec_share / recyds_share from the current per-player values if not present.
function ensureDerivedShares(state,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const shares=state.passing_shares;
  const valOf=p=>{const tg=p.share*totalTgts;return isYds?tg*(p.ypt||9):tg*(p.catch_rate||0.65);};
  const pool=shares.reduce((s,p)=>s+valOf(p),0)||1;
  let needs=false;
  shares.forEach(p=>{ if(typeof p[field]!=='number') needs=true; });
  if(needs) shares.forEach(p=>{ p[field]=valOf(p)/pool; });
}

// Convert rec_share / recyds_share back into per-player catch_rate / ypt against the pool.
function applyDerivedShares(state,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const shares=state.passing_shares;
  // pool stays anchored to the team's available receptions / receiving yards
  const pool=isYds?teamRecYardsPool(state):teamRecPool(state);
  shares.forEach(p=>{
    const tg=Math.max(1,p.share*totalTgts);
    const target=(p[field]||0)*pool;
    if(isYds) p.ypt=Math.max(0,Math.min(40,target/tg));
    else p.catch_rate=Math.max(0,Math.min(1.5,target/tg));
  });
}

// Update the receptions/rec-yards rows + pie in place after a share edit. Mirrors
// livePassTargets: ALL sibling sliders update live (not gated by sliderDragging).
function liveDerivedRows(state,team,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const pool=isYds?teamRecYardsPool(state):teamRecPool(state);
  const shares=state.passing_shares;
  shares.forEach((p,i)=>{
    const sh=p[field]||0;
    const v=Math.round(sh*pool);
    const pctEl=document.getElementById(`dp-${i}`); if(pctEl) pctEl.textContent=(sh*100).toFixed(1)+'%';
    const volEl=document.getElementById(`dv-${i}`); if(volEl) volEl.textContent=`${v.toLocaleString()} ${isYds?'rec yds':'rec'}`;
    const projTgts=Math.round(p.share*totalTgts);
    const crEl=document.getElementById(`cr-${i}`); if(crEl&&document.activeElement!==crEl) crEl.textContent=((p.catch_rate||0.65)*100).toFixed(0);
    const ydEl=document.getElementById(`yd-${i}`); if(ydEl&&document.activeElement!==ydEl) ydEl.textContent=Math.round(projTgts*(p.ypt||9));
    const yptEl=document.getElementById(`ypt-${i}`); if(yptEl&&document.activeElement!==yptEl) yptEl.textContent=(p.ypt||9).toFixed(1);
    const recEl=document.getElementById(`ed-rec-${i}`); if(recEl&&document.activeElement!==recEl) recEl.textContent=Math.round(projTgts*(p.catch_rate||0.65));
    // Update ALL sliders' fill/value (including siblings) — but never fight the one being dragged.
    const sl=document.querySelector(`input.sl[data-key="${isYds?'recyds':'rec'}_${i}"]`);
    if(sl && document.activeElement!==sl){ sl.value=(sh*100).toFixed(1); setFill(sl,sl.dataset.col||PCOLORS[i%PCOLORS.length]); }
  });
  if(pieChart) updatePie(shares.map(p=>p[field]||0));
  const sub=document.getElementById('derivedSub');
  if(sub) sub.textContent=isYds?Math.round(pool).toLocaleString()+' yds':Math.round(pool)+' rec';
}
// Edit a player's absolute receiving TDs (from the Targets view) → set td_share of team passing TDs
function editRecTDs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTDs=teamPassTDs(state);
  if(totalTDs>0){
    state.passing_shares[i].td_share=Math.max(0,Math.min(1,v/totalTDs));
    normalizeShares(state.passing_shares,i,'td_share');
  }
  livePassTargets(state,currentTeam);
}
// Edit absolute receiving TDs from the TD-share view (same logic, refreshes that view)
function editRecTDsAbs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveTDRows('tdp','tdt',state.passing_shares,teamPassTDs(state),'tds_',true);return;}
  markDirty();
  const totalTDs=teamPassTDs(state);
  if(totalTDs>0){
    state.passing_shares[i].td_share=Math.max(0,Math.min(1,v/totalTDs));
    normalizeShares(state.passing_shares,i,'td_share');
  }
  if(passingSubTab==='rec_tds') updatePie(state.passing_shares.map(p=>p.td_share));
  liveTDRows('tdp','tdt',state.passing_shares,totalTDs,'tds_',true);
}
// Edit absolute rushing TDs → adjusts that player's share AND the team total grows/shrinks
function editRushTDsAbs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw);
  const totalTDs=teamRushTDs(state);
  if(isNaN(v)){liveTDRows('rtdp','rtdt',state.rushing.shares,totalTDs,'rtds_',true);return;}
  markDirty();
  const others=state.rushing.shares.filter((_,j)=>j!==i)
    .reduce((s,p)=>s+p.td_share*totalTDs,0);
  const newTotal=Math.max(0.1,others+Math.max(0,v));
  state.rushing.total_rush_tds=newTotal;
  state.rushing.shares.forEach((p,j)=>{ p.td_share=(j===i?Math.max(0,v):p.td_share*totalTDs)/newTotal; });
  if(rushingSubTab==='rush_tds') updatePie(state.rushing.shares.map(p=>p.td_share));
  liveTDRows('rtdp','rtdt',state.rushing.shares,newTotal,'rtds_',true);
  // refresh the "X rush TDs" pie subtitle
  const sub=document.querySelector('#rushPieChart')&&document.querySelector('.pie-sub');
}

// ─────────────────────────────────────────────────────────────────────────────
// Live DOM updaters
// ─────────────────────────────────────────────────────────────────────────────
function liveQB(state,idx,team,changedKey){
  const q=state.qbs[idx];
  const cp=q.passing_attempts>0?(q.passing_completions/q.passing_attempts*100).toFixed(1):'0';
  const ypa=q.passing_attempts>0?(q.passing_yards/q.passing_attempts).toFixed(2):'-';
  const ytd=q.passing_tds>0?Math.round(q.passing_yards/q.passing_tds):'-';
  const d=document.getElementById('qbDerived'); if(d) d.textContent=`Comp%: ${cp}% · YPA: ${ypa} · Yds/TD: ${ytd} · per game: ${perGame(q,'passing_yards').toFixed(1)} yds`;
  const m={'sb-py':Math.round(q.passing_yards).toLocaleString(),'sb-ptd':Math.round(q.passing_tds),'sb-int':Math.round(q.interceptions_thrown),
    'sb-ry':Math.round(q.qb_rush_yards),'sb-rtd':Math.round(q.qb_rush_tds),'sb-att':Math.round(q.passing_attempts)};
  Object.entries(m).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=v;});
  const seed=getBase(team,'QB').find(qq=>qq.name===q.name)||getBase(team,'QB')[0]||{};
  const bases={py:seed.passing_yards||4000,ptd:seed.passing_tds||25,patt:seed.passing_attempts||560,
    pcomp:seed.passing_completions||360,int:seed.interceptions_thrown||10,
    qbry:seed.rushing_yards||0,qbrtd:seed.rushing_tds||0,qbratt:seed.rushing_attempts||0};
  if(changedKey){const sd=document.getElementById(`sd-${changedKey}`);if(sd)sd.innerHTML=mkDelta(state.qbs[idx][({py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',pcomp:'passing_completions',int:'interceptions_thrown',qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'})[changedKey]],bases[changedKey]||0,changedKey==='int');}
  const tot=document.getElementById('qbTeamTotals'); if(tot) tot.textContent=qbTotalsText(state);
}

// Update the workload card text (per-QB sub line, team-games budget, the active QB's
// games/snap sub spans) without a full re-render, so dragging stays smooth.
function updateWorkloadUI(state,qi,team){
  const q=state.qbs[qi];
  const sub=document.getElementById(`wl-sub-${qi}`);
  if(sub) sub.textContent=`${Math.round(q.games||0)} games · ${perGame(q,'passing_yards').toFixed(1)} pass yds/gm`;
  const gv=document.getElementById(`sv-games_${qi}`); if(gv&&document.activeElement!==gv) gv.textContent=Math.round(q.games||0);
  if((state.activeQB||0)===qi){
    const gsub=document.getElementById('qb-games-sub'); if(gsub) gsub.textContent=Math.round(q.games||0);
  }
  const teamGames=state.qbs.reduce((s,x)=>s+(x.games||0),0);
  const over=teamGames>SEASON_GAMES+0.5;
  const note=document.getElementById('qbWorkloadNote');
  if(note){
    note.style.color = over?'var(--warn)':'';
    note.textContent=`Team QB-games: ${teamGames.toFixed(0)} of ${SEASON_GAMES}`+(over?' ⚠️ over a full season — combined QB workload exceeds 17 games':'');
  }
}

// After a games-pace rescale, move the QB stat sliders + value badges to the new totals.
function refreshQBStatSliders(state,qi){
  if((state.activeQB||0)!==qi) return; // only the visible QB has stat sliders rendered
  const q=state.qbs[qi];
  const map={py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',
    pcomp:'passing_completions',int:'interceptions_thrown',
    qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'};
  Object.entries(map).forEach(([k,prop])=>{
    const v=Math.round(q[prop]||0);
    const sl=document.querySelector(`input.sl[data-key="${k}"]`);
    if(sl){ sl.value=v; setFill(sl,sl.dataset.col||null); }
    const sv=document.getElementById(`sv-${k}`); if(sv&&document.activeElement!==sv) sv.textContent=v;
  });
}

// Receivers/rushing depend on QB pass attempts (via teamTargetPool). Refresh whatever
// passing/rushing view is currently shown so volume cascades from QB workload changes.
function livePassDependents(state,team){
  if(currentPhase!=='Passing') return;
  if(passingSubTab==='targets') livePassTargets(state,team);
  else liveTDRows('tdp','tdt',state.passing_shares||[],teamPassTDs(state),'tds_',true);
}

function livePassTargets(state,team){
  const totalTgts=teamTargetPool(state);
  const totalTDs=teamPassTDs(state);
  state.passing_shares.forEach((p,i)=>{
    const pct=(p.share*100).toFixed(1);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    setTxt(`pp-${i}`,`${pct}%`); setTxt(`pt-${i}`,`${projTgts} tgt`);
    setEditTxt(`yd-${i}`,projYds); setEditTxt(`ypt-${i}`,(p.ypt||9).toFixed(1));
    setEditTxt(`cr-${i}`,((p.catch_rate||0.65)*100).toFixed(0)); setEditTxt(`rtd-${i}`,projTDs);
    setEditTxt(`ed-tgt-${i}`,projTgts); setEditTxt(`ed-rec-${i}`,projRec);
    const sl=document.querySelector(`input.sl[data-key="ps_${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  const sub=document.getElementById('pieSub'); if(sub) sub.textContent=`${totalTgts} targets`;
  reorderShareBlocks('shareControls','pblk-',state.passing_shares,'share');
}

// Reorder share-block DOM nodes so the category leader floats to the top.
// Skipped during an active slider drag — resortAfterRelease() handles that on pointer-up,
// which keeps the drag from feeling glitchy. Manual text edits still reorder immediately.
function reorderShareBlocks(containerId,prefix,shares,field){
  if(sliderDragging) return;
  const host=document.getElementById(containerId); if(!host||!host.children) return;
  const order=shares.map((p,i)=>i).sort((a,b)=>shares[b][field]-shares[a][field]);
  const cur=Array.from(host.children).map(c=>c.id);
  const want=order.map(i=>`${prefix}${i}`);
  if(cur.join(',')===want.join(',')) return;
  order.forEach(i=>{ const el=document.getElementById(`${prefix}${i}`); if(el) host.appendChild(el); });
}

function liveTDRows(pctId,volId,shares,totalTDs,keyPrefix,editable){
  shares.forEach((p,i)=>{
    const pct=(p.td_share*100).toFixed(1);
    const proj=(p.td_share*totalTDs).toFixed(1);
    setTxt(`${pctId}-${i}`,`${pct}%`);
    if(editable) setEditTxt(`${volId}-${i}`,proj);
    else setTxt(`${volId}-${i}`,`${proj} TD`);
    const sl=document.querySelector(`input.sl[data-key="${keyPrefix}${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  // resort by TD share (on release / manual edit, not mid-drag)
  if(keyPrefix==='tds_') reorderShareBlocks('shareControls','pblk-',shares,'td_share');
  else if(keyPrefix==='rtds_') reorderShareBlocks('rushShareControls','rblk-',shares,'td_share');
}

function liveRush(state,team){
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  liveRushRows(state,team);
}

function liveRushRows(state,team){
  const r=state.rushing;
  const totalTDs=teamRushTDs(state);
  r.shares.forEach((p,i)=>{
    const att=Math.round(p.share*r.total_attempts);
    const yds=Math.round(att*(p.ypc||r.ypa||4));
    const pct=(p.share*100).toFixed(1);
    const tds=(p.td_share*totalTDs).toFixed(1);
    setTxt(`rp-${i}`,`${pct}%`); setTxt(`ra-${i}`,`${att} att`);
    setEditTxt(`ryd-${i}`,yds); setEditTxt(`rtdv-${i}`,tds);
    setEditTxt(`ed-att-${i}`,att); setEditTxt(`ed-ypc-${i}`,(p.ypc||r.ypa||4).toFixed(2));
    const sl=document.querySelector(`input.sl[data-key="rs_${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds`;
  if(rushingSubTab==='carries') updatePie(r.shares.map(p=>p.share));
  reorderShareBlocks('rushShareControls','rblk-',r.shares,'share');
  // keep the team total-yards slider in sync (carries/ypc edits change the sum)
  const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
  if(ys){ys.value=r.total_yards;setFill(ys,'var(--rb)');
    const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=r.total_yards;}
}

function setTxt(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function setEditTxt(id,v){const e=document.getElementById(id);if(e&&document.activeElement!==e)e.textContent=v;}


// ─────────────────────────────────────────────────────────────────────────────
// Rankings
// ─────────────────────────────────────────────────────────────────────────────
function calcFpts(p){
  const sc=scoringSettings;let f=0;
  f+=(p.passing_yards||0)/sc.passing_yards_yardage*sc.passing_yards_points;
  f+=(p.passing_tds||0)*sc.passing_touchdowns;
  f+=(p.interceptions_thrown||0)*sc.interceptions_thrown;
  f+=(p.passing_attempts||0)*sc.passing_attempts;
  f+=(p.passing_completions||0)*sc.passing_completions;
  f+=(p.receiving_yards||0)/sc.receiving_yards_yardage*sc.receiving_yards_points;
  f+=(p.receiving_tds||0)*sc.receiving_touchdowns;
  f+=(p.receptions||0)*sc.receptions;
  f+=(p.rushing_yards||0)/sc.rushing_yards_yardage*sc.rushing_yards_points;
  f+=(p.rushing_tds||0)*sc.rushing_touchdowns;
  f+=(p.rushing_attempts||0)*sc.rushing_attempts;
  f+=(p.fumbles_lost||0)*sc.fumbles_lost;
  return f;
}
// ── FantasyPros ECR lookup (replaces ADP) ──
// Normalize a name to match the ECR keys built by build_seed.py.
function ecrNormName(s){
  return (s||'').toLowerCase().replace(/[.'\-]/g,'').replace(/\s+(jr|sr|ii|iii|iv|v)$/,'').replace(/\s+/g,' ').trim();
}
// Which ECR table to read for the current format. Superflex uses the half-PPR superflex
// page by default; dynasty/std/ppr/half each have their own.
function ecrTableFor(fmt){
  if(fmt==='superflex') return ECR.superflex || ECR.superflex_ppr || {};
  if(fmt==='dynasty')   return ECR.dynasty || {};
  if(fmt==='std')       return ECR.std || {};
  if(fmt==='ppr')       return ECR.ppr || {};
  return ECR.half_ppr || {};  // half_ppr default
}
// Look up a player's ECR entry for the active format. Returns {rank_ecr, tier, age} or null.
function ecrEntry(p){
  const tbl=ecrTableFor(rankFormat);
  return tbl[ecrNormName(p.name)] || null;
}
function ecrFor(p){ const e=ecrEntry(p); return e&&e.rank_ecr!=null ? e.rank_ecr : null; }
function ecrTierFor(p){ const e=ecrEntry(p); return e&&e.tier!=null ? e.tier : null; }
function hasECR(){ const t=ecrTableFor(rankFormat); return t && Object.keys(t).length>0; }

// ── OverTheCap contract lookup (Dynasty tab only: Age / APY / Free-Agency year) ──
// Reuses the same name-normalization as ECR so the keys line up with build_seed.py.
function contractEntry(p){ return CONTRACTS[ecrNormName(p.name)] || null; }
function hasContracts(){ return CONTRACTS && Object.keys(CONTRACTS).length>0; }
// Format an APY (annual salary in dollars) compactly, e.g. 40250000 → "$40.3M".
function fmtAPY(v){
  if(v==null || isNaN(v)) return '';
  if(v>=1e6) return '$'+(v/1e6).toFixed(1).replace(/\.0$/,'')+'M';
  if(v>=1e3) return '$'+Math.round(v/1e3)+'K';
  return '$'+v;
}

function buildPlayerList(){
  const list=[];
  // Auto-populate: make sure every team with seed data is initialized so all players
  // appear in the rankings without the user opening each team first.
  TEAMS.forEach(team=>{
    if(!userProj[team] && SEED[team] &&
       (SEED[team].QB.length||SEED[team].RB.length||SEED[team].WR.length||SEED[team].TE.length)){
      ensureTeam(team);
    }
  });
  TEAMS.forEach(team=>{
    const state=userProj[team]; if(!state) return;
    // Ensure receiver/rusher shares exist so every player auto-populates in the rankings.
    if(!state.passing_shares) initPassingShares(team);
    if(!state.rushing||!state.rushing.shares) initRushingShares(team);
    const totalTgts=teamTargetPool(state);
    const totalPassTDs=teamPassTDs(state);
    state.qbs.forEach(qb=>{
      list.push({name:qb.name,team,pos:'QB',headshot:qb.headshot,slug:qb.slug,player_id:qb.player_id||null,
        passing_yards:qb.passing_yards,passing_tds:qb.passing_tds,passing_attempts:qb.passing_attempts,
        passing_completions:qb.passing_completions,interceptions_thrown:qb.interceptions_thrown,
        rushing_yards:qb.qb_rush_yards,rushing_tds:qb.qb_rush_tds,rushing_attempts:qb.qb_rush_attempts,
        receiving_yards:0,receiving_tds:0,receptions:0,receiving_targets:0,fumbles_lost:0});
    });
    if(state.passing_shares){
      state.passing_shares.forEach(p=>{
        const projTgts=Math.round(p.share*totalTgts);
        const projRec=Math.round(projTgts*(p.catch_rate||0.65));
        const projYds=Math.round(projTgts*(p.ypt||9));
        const projTDs=parseFloat((p.td_share*totalPassTDs).toFixed(1));
        const bp=[...getBase(team,'WR'),...getBase(team,'TE'),...getBase(team,'RB')].find(x=>x.name===p.name)||{};
        const ex=list.findIndex(x=>x.name===p.name&&x.team===team);
        if(ex>=0){list[ex].receiving_yards=projYds;list[ex].receiving_tds=projTDs;list[ex].receptions=projRec;list[ex].receiving_targets=projTgts;
          if(p.player_id&&!list[ex].player_id)list[ex].player_id=p.player_id;}
        else list.push({name:p.name,team,pos:p.pos,headshot:p.headshot,slug:p.slug,player_id:p.player_id||null,
          passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          rushing_yards:bp.rushing_yards||0,rushing_tds:0,rushing_attempts:bp.rushing_attempts||0,
          receiving_yards:projYds,receiving_tds:projTDs,receptions:projRec,receiving_targets:projTgts,fumbles_lost:0});
      });
    }
    if(state.rushing.shares){
      const r=state.rushing;
      const totalRushTDs=teamRushTDs(state);
      r.shares.forEach(p=>{
        const att=Math.round(p.share*r.total_attempts);
        const yds=Math.round(att*(p.ypc||r.ypa||4));
        const tds=parseFloat((p.td_share*totalRushTDs).toFixed(1));
        const ex=list.findIndex(x=>x.name===p.name&&x.team===team);
        if(ex>=0){list[ex].rushing_yards=yds;list[ex].rushing_tds=tds;list[ex].rushing_attempts=att;
          if(p.player_id&&!list[ex].player_id)list[ex].player_id=p.player_id;}
        else{
          list.push({name:p.name,team,pos:'RB',headshot:p.headshot,slug:p.slug,player_id:p.player_id||null,
            passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
            rushing_yards:yds,rushing_tds:tds,rushing_attempts:att,
            receiving_yards:0,receiving_tds:0,receptions:0,receiving_targets:0,fumbles_lost:0});}
      });
    }
  });
  // Fantasy points + ECR rank/tier + YPC + (dynasty) contract age/APY/FA for each player.
  list.forEach(p=>{
    p.fpts=calcFpts(p);
    p.ecr=ecrFor(p);
    p.ecr_tier=ecrTierFor(p);
    p.ypc = (p.rushing_attempts>0) ? p.rushing_yards/p.rushing_attempts : 0;
    const c=contractEntry(p);
    p.age = c && c.age!=null ? c.age : null;
    p.apy = c && c.apy!=null ? c.apy : null;
    p.fa  = c && c.fa!=null ? c.fa : null;
  });
  return list;
}

function renderRankings(){
  let all=buildPlayerList();
  // Team-scoped rankings (from a team's Rankings tab) show only that team's players.
  const teamScoped = (rankScope==='team' && currentTeam);
  if(teamScoped) all=all.filter(p=>p.team===currentTeam);
  if(!all.length){document.getElementById('content').innerHTML=
    `<div class="phase-tabs">${tabBar()}</div><div class="empty"><div class="empty-icon">🏆</div>
     <div class="empty-title">No projections yet</div><div class="empty-body">Set at least one team's stats to see rankings.</div></div>`;return;}
  // Overall order is by fantasy points (your projections). ECR/tier come from FantasyPros.
  all.sort((a,b)=>b.fpts-a.fpts);
  all.forEach((p,i)=>{ p.overall=i+1; });
  // live draft: mark drafted players
  const following = !!draftId;
  all.forEach(p=>{ p.drafted = following && !!draftedIds[p.player_id]; });
  let view=rankPosFilter==='ALL'?all
    :rankPosFilter==='FLEX'?all.filter(p=>p.pos!=='QB')
    :all.filter(p=>p.pos===rankPosFilter);
  if(following && hideDrafted) view=view.filter(p=>!p.drafted);
  view=[...view].sort((a,b)=>{
    if(rankSortKey==='ecr'){
      // Unranked players sort to the bottom regardless of direction.
      const av=a.ecr==null?99999:a.ecr, bv=b.ecr==null?99999:b.ecr;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    if(rankSortKey==='name') return a.name.localeCompare(b.name)*(rankSortDir<0?1:-1);
    if(rankSortKey==='team') return a.team.localeCompare(b.team)*(rankSortDir<0?1:-1);
    if(rankSortKey==='pos') return (({QB:1,RB:2,WR:3,TE:4})[a.pos]-({QB:1,RB:2,WR:3,TE:4})[b.pos])*(rankSortDir<0?1:-1)||b.fpts-a.fpts;
    // Contract columns: players with no contract data always sort to the bottom.
    if(rankSortKey==='age'||rankSortKey==='apy'||rankSortKey==='fa'){
      const av=a[rankSortKey], bv=b[rankSortKey];
      if(av==null && bv==null) return b.fpts-a.fpts;
      if(av==null) return 1;
      if(bv==null) return -1;
      return (av-bv)*(rankSortDir<0?1:-1);
    }
    return ((b[rankSortKey]||0)-(a[rankSortKey]||0))*(rankSortDir<0?1:-1);
  });
  const tierC=['','var(--accent)','var(--info)','var(--warn)','var(--danger)','var(--muted)','#8b7cff','#6ad1c4'];
  const tierColor=t=>t?tierC[Math.min(t,7)]:'var(--border)';
  // Two-line header helper. `grp` adds a left border to mark a stat group's start.
  const th=(k,l1,l2,cls,grp)=>{const a=rankSortKey===k;
    return `<th onclick="rankSort('${k}')" class="${cls||''} ${grp?'grp-start':''}" style="${a?'color:var(--accent)':''}">
      <div class="th-stack">${l1}${l2?`<br>${l2}`:''}${a?(rankSortDir<0?' ↓':' ↑'):''}</div></th>`;};
  // Dynasty tab only: three extra columns (Age / APY / Free-Agency year) right after TM.
  // FA is highlighted red when it's the very next season (contracts expiring soonest).
  const isDynasty = rankFormat==='dynasty';
  const nextYear = PROJ_SEASON + 1;
  const rows=view.map(p=>{
    const ecrTxt = p.ecr!=null ? p.ecr : '—';
    const tier = p.ecr_tier;
    const ypc = p.ypc>0 ? p.ypc.toFixed(1) : '';
    let contractCells='';
    if(isDynasty){
      const ageTxt = p.age!=null ? p.age : '';
      const apyTxt = p.apy!=null ? fmtAPY(p.apy) : '';
      const faTxt = p.fa!=null ? p.fa : '';
      const faSoon = p.fa!=null && p.fa===nextYear;   // hits free agency next season
      contractCells =
        `<td class="c-age">${ageTxt?`<span class="num">${ageTxt}</span>`:''}</td>`+
        `<td class="c-apy">${apyTxt?`<span class="num">${apyTxt}</span>`:''}</td>`+
        `<td class="c-fa ${faSoon?'fa-soon':''}">${faTxt?`<span class="num">${faTxt}</span>`:''}</td>`;
    }
    return `<tr class="${p.drafted?'drafted':''}">
    <td class="c-ecr">${ecrTxt}</td>
    <td class="c-tier">${tier!=null?`<span class="tier-pill" style="background:${tierColor(tier)}">${tier}</span>`:''}</td>
    <td class="fpts">${p.fpts.toFixed(1)}</td>
    <td><span class="pos-badge pos-${p.pos}">${p.pos}</span></td>
    <td class="c-player"><div style="display:flex;align-items:center;gap:6px">${imgTag(hsURL(p),'rank-hs','🏈')}<span class="rank-name">${p.name}</span></div></td>
    <td class="c-team"><img src="${NFL_LOGO(p.team)}" class="rank-logo" onerror="this.style.display='none'"> ${p.team}</td>
    ${contractCells}
    <td class="grp-rush">${cell(p.rushing_attempts)}</td><td class="grp-rush-mid">${cell(p.rushing_yards)}</td><td class="grp-rush-mid">${ypc?`<span class="num">${ypc}</span>`:''}</td><td class="grp-rush-end">${cell(p.rushing_tds)}</td>
    <td class="grp-rec">${cell(p.receiving_targets)}</td><td class="grp-rec-mid">${cell(p.receptions)}</td><td class="grp-rec-mid">${cell(p.receiving_yards)}</td><td class="grp-rec-end">${cell(p.receiving_tds)}</td>
    <td class="grp-pass">${cell(p.passing_attempts)}</td><td class="grp-pass-mid">${cell(p.passing_yards)}</td><td class="grp-pass-mid">${cell(p.passing_tds)}</td><td class="grp-pass-end">${cell(p.interceptions_thrown)}</td>
  </tr>`}).join('');
  const fmtBtns=[['ppr','Full PPR'],['half_ppr','Half PPR'],['std','Standard'],['superflex','Superflex'],['dynasty','Dynasty']]
    .map(([f,l])=>`<button class="format-btn ${rankFormat===f?'active':''}" onclick="setRankFormat('${f}')">${l}</button>`).join('');
  const posBtns=['ALL','QB','RB','WR','TE','FLEX'].map(pos=>
    `<button class="pos-filter-btn ${rankPosFilter===pos?'active':''}" onclick="setPosFilter('${pos}')">${pos}</button>`).join('');
  const ecrNote = hasECR() ? '' : `<span class="ecr-missing">⚠ No FantasyPros ECR loaded — run build_seed.py and load the 📦 seed to populate ECR/Tier</span>`;
  document.getElementById('content').innerHTML=`
    <div class="phase-tabs">${tabBar()}</div>
    <div class="rankings-scope-bar">
      ${teamScoped
        ? `<span class="scope-title">🏆 ${currentTeam} Rankings</span><span class="scope-sub">this team only</span>
           <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="showFullRankings()">View full league →</button>`
        : `<span class="scope-title">🏆 Full League Rankings</span><span class="scope-sub">all ${all.length} players</span>`}
    </div>
    <div class="card" style="margin-bottom:12px">
      <div class="card-title" style="margin-bottom:10px">Scoring Settings
        <button class="btn btn-accent btn-sm" style="margin-left:auto" onclick="recalcRankings()">Recalculate</button></div>
      <div class="scoring-grid">
        <div class="scoring-field"><label>PASS YDS / POINT</label><input id="sc_pass_yds_ydg" type="number" value="${scoringSettings.passing_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>PASS TD PTS</label><input id="sc_pass_td" type="number" value="${scoringSettings.passing_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>INT PTS</label><input id="sc_int" type="number" value="${scoringSettings.interceptions_thrown}" step="0.5"></div>
        <div class="scoring-field"><label>RUSH YDS / POINT</label><input id="sc_rush_yds_ydg" type="number" value="${scoringSettings.rushing_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>RUSH TD PTS</label><input id="sc_rush_td" type="number" value="${scoringSettings.rushing_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>REC YDS / POINT</label><input id="sc_rec_yds_ydg" type="number" value="${scoringSettings.receiving_yards_yardage}" step="1"></div>
        <div class="scoring-field"><label>REC TD PTS</label><input id="sc_rec_td" type="number" value="${scoringSettings.receiving_touchdowns}" step="0.5"></div>
        <div class="scoring-field"><label>RECEPTION PTS (PPR)</label><input id="sc_rec" type="number" value="${scoringSettings.receptions}" step="0.25"></div>
        <div class="scoring-field"><label>FUMBLE LOST PTS</label><input id="sc_fum" type="number" value="${scoringSettings.fumbles_lost}" step="0.5"></div>
        <div class="scoring-field"><label>PASS ATT PTS</label><input id="sc_pass_att" type="number" value="${scoringSettings.passing_attempts}" step="0.1"></div>
        <div class="scoring-field"><label>PASS COMP PTS</label><input id="sc_pass_comp" type="number" value="${scoringSettings.passing_completions}" step="0.1"></div>
        <div class="scoring-field"><label>RUSH ATT PTS</label><input id="sc_rush_att" type="number" value="${scoringSettings.rushing_attempts}" step="0.1"></div>
      </div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      ${following ? `<div style="padding:8px 14px;border-bottom:1px solid var(--border)">
        <div class="draft-banner">
          <span class="draft-live">LIVE</span>
          <span>Following draft <b>${draftId}</b> · ${Object.keys(draftedIds).length} picks made</span>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer;margin-left:8px">
            <input type="checkbox" ${hideDrafted?'checked':''} onchange="toggleHideDrafted()"> hide drafted</label>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="stopDraftFollow()">Stop</button>
        </div></div>` : ''}
      <div style="padding:11px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border);flex-wrap:wrap">
        <span style="font-size:11px;color:var(--muted);font-weight:700">FORMAT (ECR)</span>
        <div class="format-toggle">${fmtBtns}</div>
        <span style="font-size:11px;color:var(--muted);font-weight:700;margin-left:8px">POSITION</span>
        <div class="pos-filter">${posBtns}</div>
        ${ecrNote}
        <span style="font-size:11px;font-weight:700;margin-left:auto">${view.length} players</span>
        ${following?'':`<button class="btn btn-ghost btn-sm" onclick="promptDraftFollow()">📡 Follow Draft</button>`}
        <button class="btn btn-ghost btn-sm" onclick="exportRankingsCSV()">⬇ CSV</button>
      </div>
      <div class="rank-table-wrap" style="max-height:calc(100vh - 320px)">
      <table class="rankings-table grouped"><thead><tr>
        ${th('ecr','ECR','','c-ecr')}${th('ecr_tier','TIER','','c-tier')}${th('fpts','FPTS','')}
        ${th('pos','POS','')}${th('name','PLAYER','','c-player')}${th('team','TM','','c-team')}
        ${isDynasty?`${th('age','AGE','','c-age',true)}${th('apy','APY','','c-apy')}${th('fa','FA','','c-fa')}`:''}
        ${th('rushing_attempts','RUSH','ATT','grp-rush',true)}${th('rushing_yards','RUSH','YDS','grp-rush-mid')}${th('ypc','YPC','','grp-rush-mid')}${th('rushing_tds','RUSH','TDS','grp-rush-end')}
        ${th('receiving_targets','TGTS','','grp-rec',true)}${th('receptions','REC','','grp-rec-mid')}${th('receiving_yards','REC','YDS','grp-rec-mid')}${th('receiving_tds','REC','TDS','grp-rec-end')}
        ${th('passing_attempts','PASS','ATT','grp-pass',true)}${th('passing_yards','PASS','YDS','grp-pass-mid')}${th('passing_tds','PASS','TDS','grp-pass-mid')}${th('interceptions_thrown','PASS','INTS','grp-pass-end')}
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}
function cell(v){return v&&v>0?`<span class="num">${(+v)%1!==0?(+v).toFixed(1):(+v).toLocaleString()}</span>`:'';}
function rankSort(k){if(rankSortKey===k)rankSortDir*=-1;else{rankSortKey=k;rankSortDir=k==='ecr'?-1:-1;}renderRankings();}
// Scoring presets per format. The reception value is what distinguishes PPR / Half / Standard.
const FORMAT_PRESETS={
  ppr:      {receptions:1.0},
  half_ppr: {receptions:0.5},
  std:      {receptions:0.0},
  superflex:{receptions:0.5},  // half-PPR superflex by default (matches the FantasyPros page we pull)
  dynasty:  {receptions:0.5},  // dynasty half-PPR overall
};
// Selecting a format applies its scoring and re-sorts by ECR (the FantasyPros rank for that format).
function setRankFormat(f){
  rankFormat=f;
  const preset=FORMAT_PRESETS[f];
  if(preset){ Object.assign(scoringSettings,preset); }
  rankSortKey='ecr'; rankSortDir=-1;
  renderRankings();
  toast(`${({ppr:'Full PPR',half_ppr:'Half PPR',std:'Standard',superflex:'Superflex',dynasty:'Dynasty'})[f]} — ECR + scoring applied`,'ok');
}
// When the user edits the reception value directly, keep the format label in sync so the
// ECR table matches: 1.0→Full PPR, 0.5→Half PPR, 0→Standard. (Superflex/Dynasty are only
// set via their buttons since they change the ranking pool, not just the reception value.)
function syncFormatFromScoring(){
  if(rankFormat==='superflex'||rankFormat==='dynasty') return; // these aren't pure reception-value formats
  const r=scoringSettings.receptions;
  let f = r>=1 ? 'ppr' : r>=0.25 ? 'half_ppr' : 'std';
  if(f!==rankFormat){ rankFormat=f;
    toast(`Reception value ${r} → switched to ${({ppr:'Full PPR',half_ppr:'Half PPR',std:'Standard'})[f]} (ECR follows)`,'ok'); }
}
function setPosFilter(p){rankPosFilter=p;renderRankings();}
function recalcRankings(){
  const g=(id,d)=>{const v=parseFloat(document.getElementById(id).value);return isNaN(v)?d:v;};
  scoringSettings.passing_yards_yardage=g('sc_pass_yds_ydg',25)||25;
  scoringSettings.passing_touchdowns=g('sc_pass_td',6);
  scoringSettings.interceptions_thrown=g('sc_int',-2);
  scoringSettings.rushing_yards_yardage=g('sc_rush_yds_ydg',10)||10;
  scoringSettings.rushing_touchdowns=g('sc_rush_td',6);
  scoringSettings.receiving_yards_yardage=g('sc_rec_yds_ydg',10)||10;
  scoringSettings.receiving_touchdowns=g('sc_rec_td',6);
  scoringSettings.receptions=g('sc_rec',0.5);
  scoringSettings.fumbles_lost=g('sc_fum',-2);
  scoringSettings.passing_attempts=g('sc_pass_att',0);
  scoringSettings.passing_completions=g('sc_pass_comp',0);
  scoringSettings.rushing_attempts=g('sc_rush_att',0);
  syncFormatFromScoring();  // 1.0/0.5/0 reception value keeps the format label + ECR in sync
  renderRankings();toast('Rankings recalculated ✓','ok');
}
function exportRankingsCSV(){
  let all=buildPlayerList();all.sort((a,b)=>b.fpts-a.fpts);
  const dyn = rankFormat==='dynasty';
  const keys=['ecr','tier','fpts','pos','name','team',
    ...(dyn?['age','apy','fa']:[]),
    'rushing_attempts','rushing_yards','ypc','rushing_tds',
    'receiving_targets','receptions','receiving_yards','receiving_tds',
    'passing_attempts','passing_yards','passing_tds','interceptions_thrown'];
  const csv=[keys.join(','),...all.map(p=>[
    p.ecr!=null?p.ecr:'', p.ecr_tier!=null?p.ecr_tier:'', p.fpts.toFixed(1), p.pos, p.name, p.team,
    ...(dyn?[p.age!=null?p.age:'', p.apy!=null?p.apy:'', p.fa!=null?p.fa:'']:[]),
    p.rushing_attempts, p.rushing_yards, p.ypc>0?p.ypc.toFixed(1):'', p.rushing_tds,
    p.receiving_targets, p.receptions, p.receiving_yards, p.receiving_tds,
    p.passing_attempts, p.passing_yards, p.passing_tds, p.interceptions_thrown
  ].join(','))].join('\n');
  dlFile(csv,'rankings.csv','text/csv');toast('Rankings exported ✓','ok');
}


// ─────────────────────────────────────────────────────────────────────────────
// Import — with corrected multi-analyst averaging
// ─────────────────────────────────────────────────────────────────────────────
function triggerImport(){document.getElementById('importFile').click();}
function handleImport(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const p=JSON.parse(ev.target.result);
      if(!p.projections||!Array.isArray(p.projections)) throw new Error('Expected {projections:[...]}');
      loadProjections(p);
    }catch(err){toast('Import failed: '+err.message,'err');}
  };
  r.readAsText(f); e.target.value='';
}

// Average a group of same-player rows across analysts.
// IMPORTANT: receiving_targets can be a string; parse defensively. Average each
// numeric field independently (true per-field mean) to match expectations.
function averageGroup(group){
  if(group.length===1) return {...group[0]};
  const out={...group[0]};
  const NUM=['passing_yards','passing_touchdowns','passing_completions','passing_attempts',
    'rushing_yards','rushing_touchdowns','rushing_attempts','rushing_yards_per_attempt',
    'receptions','receiving_yards','receiving_touchdowns','receiving_yards_per_reception',
    'receiving_targets','interceptions_thrown','fumbles_lost','risk','upside',
    'adp','adp_ppr','adp_half_ppr','adp_2qb'];
  NUM.forEach(k=>{
    let sum=0,cnt=0;
    group.forEach(p=>{
      let v=p[k];
      if(v===null||v===undefined||v==='') return;
      v=parseFloat(v);
      if(!isNaN(v)){sum+=v;cnt++;}
    });
    out[k]= cnt>0 ? sum/cnt : 0;
  });
  out.analyst_name=[...new Set(group.map(p=>p.analyst_name).filter(Boolean))].join('+');
  return out;
}

function loadProjections(data){
  const players=data.projections;
  // Group by player_id when present, else name+team. Only treat as "same player"
  // when BOTH id matches AND team matches (avoids merging a traded player's two teams).
  const useIds=players.some(p=>p.player_id!==undefined&&p.player_id!==null);
  const groupsMap={};
  players.forEach(p=>{
    const idPart=useIds?(p.player_id!=null?p.player_id:('name:'+p.name)):('name:'+p.name);
    const key=`${idPart}::${p.team||'FA'}::${p.fantasy_position||'?'}`;
    (groupsMap[key]=groupsMap[key]||[]).push(p);
  });
  const groups=Object.values(groupsMap);
  const multiAnalyst=groups.some(g=>g.length>1);
  const analysts=[...new Set(players.map(p=>p.analyst_name).filter(Boolean))];
  const merged=groups.map(averageGroup);

  const sn=multiAnalyst?`Avg: ${analysts.join('+')} ${merged[0]?.season||''}`
    :`${merged[0]?.analyst_name||'Imported'} ${merged[0]?.season||''}`;
  document.getElementById('scenarioName').value=sn.trim();

  const byTeam={};
  merged.forEach(p=>{if(p.team)(byTeam[p.team]=byTeam[p.team]||[]).push(p);});
  userProj={};
  TEAMS.forEach(team=>{
    const tp=byTeam[team]; if(!tp||!tp.length) return;
    const qbs=tp.filter(p=>p.fantasy_position==='QB'
      && (parseFloat(p.passing_attempts)>0 || parseFloat(p.passing_yards)>0 || parseFloat(p.games_played)>0))
      .sort((a,b)=>b.passing_yards-a.passing_yards);
    const wrs=tp.filter(p=>p.fantasy_position==='WR');
    const tes=tp.filter(p=>p.fantasy_position==='TE');
    const rbs=tp.filter(p=>p.fantasy_position==='RB');
    ensureTeam(team,qbs.length?qbs:null);
    const state=userProj[team];
    if(qbs.length){
      state.qbs=qbs.map((qb,i)=>({
        name:qb.name,headshot:qb.headshot||null,slug:qb.slug||null,player_id:qb.player_id||null,
        adp:parseFloat(qb.adp)||999,adp_ppr:parseFloat(qb.adp_ppr)||999,
        adp_half_ppr:parseFloat(qb.adp_half_ppr)||999,adp_2qb:parseFloat(qb.adp_2qb)||999,
        passing_yards:parseFloat(qb.passing_yards)||0,
        passing_tds:parseFloat(qb.passing_touchdowns)||0,
        passing_attempts:parseFloat(qb.passing_attempts)||0,
        passing_completions:parseFloat(qb.passing_completions)||0,
        interceptions_thrown:parseFloat(qb.interceptions_thrown)||0,
        qb_rush_yards:parseFloat(qb.rushing_yards)||0,
        qb_rush_tds:parseFloat(qb.rushing_touchdowns)||0,
        qb_rush_attempts:parseFloat(qb.rushing_attempts)||0,
        // games is what teamPassAtt/teamPassTDs/etc. now check (0-game QBs are excluded
        // from team totals). Imported data rarely carries games_played, so default the
        // primary (first/highest-yardage) QB to a full season — same rule ensureTeam uses.
        games_played:parseFloat(qb.games_played)||0,
        games:parseFloat(qb.games_played)>0?parseFloat(qb.games_played):(i===0?SEASON_GAMES:0),
        base_games:parseFloat(qb.games_played)>0?parseFloat(qb.games_played):(i===0?SEASON_GAMES:1),
        snap_share:1/qbs.length,
      }));
      assignQBSnapShares(state.qbs);
      state.activeQB=0;
    }
    const recv=[...wrs,...tes,...rbs.filter(p=>parseFloat(p.receiving_targets||0)>5)]
      .filter(p=>parseFloat(p.receiving_targets||0)>0)
      .sort((a,b)=>parseFloat(b.receiving_targets||0)-parseFloat(a.receiving_targets||0));
    if(recv.length){
      const tot=recv.reduce((s,p)=>s+parseFloat(p.receiving_targets||0),0)||1;
      const totTDs=recv.reduce((s,p)=>s+(parseFloat(p.receiving_touchdowns)||0),0)||0;
      state.passing_shares=recv.map(p=>{
        const tgts=parseFloat(p.receiving_targets)||0;
        const yds=parseFloat(p.receiving_yards)||0;
        const rec=parseFloat(p.receptions)||0;
        return {name:p.name,pos:p.fantasy_position,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
          baseline_targets:tgts,baseline_yards:yds,baseline_tds:parseFloat(p.receiving_touchdowns)||0,baseline_rec:rec,
          share:tgts/tot, td_share:totTDs>0?(parseFloat(p.receiving_touchdowns)||0)/totTDs:1/recv.length,
          ypt:tgts>0?yds/tgts:9, catch_rate:tgts>0?rec/tgts:0.65,
          adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999};
      });
    }
    const rushers=rbs.filter(p=>parseFloat(p.rushing_attempts||0)>0)
      .sort((a,b)=>parseFloat(b.rushing_attempts||0)-parseFloat(a.rushing_attempts||0));
    if(rushers.length){
      const tot=rushers.reduce((s,p)=>s+parseFloat(p.rushing_attempts||0),0)||1;
      const totYds=rushers.reduce((s,p)=>s+parseFloat(p.rushing_yards||0),0)||0;
      const totTDs=rushers.reduce((s,p)=>s+(parseFloat(p.rushing_touchdowns)||0),0)||0;
      state.rushing.total_attempts=tot;
      state.rushing.total_yards=totYds;
      state.rushing.ypa=tot>0?totYds/tot:4.0;
      state.rushing.total_rush_tds=totTDs;
      state.rushing.shares=rushers.map(p=>{
        const att=parseFloat(p.rushing_attempts)||0;
        const yds=parseFloat(p.rushing_yards)||0;
        return {name:p.name,pos:'RB',headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
          baseline_att:att,baseline_yards:yds,baseline_tds:parseFloat(p.rushing_touchdowns)||0,
          share:att/tot, td_share:totTDs>0?(parseFloat(p.rushing_touchdowns)||0)/totTDs:1/rushers.length,
          ypc:att>0?yds/att:4.0,
          adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999};
      });
    }
  });
  // Snapshot for two-stage reset
  importedSnapshot=deepCopy(userProj);
  dirtySinceImport=false;

  renderSidebar();
  if(multiAnalyst) toast(`⚠️ ${analysts.length} analysts averaged: ${analysts.join(', ')}`,'ok');
  else toast(`Loaded ${merged.length} players · ${Object.keys(byTeam).length} teams`,'ok');
  if(currentTeam&&userProj[currentTeam]) renderContent();
  else{currentTeam=null;document.getElementById('content').innerHTML=`<div class="empty">
    <div class="empty-icon">✅</div><div class="empty-title">Projections loaded${multiAnalyst?' (averaged)':''}</div>
    <div class="empty-body">${merged.length} players · ${analysts.length>1?analysts.join(', ')+' averaged':'analyst: '+(analysts[0]||'n/a')}<br>Select any team to review and edit.</div></div>`;}
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────
function buildOutput(){
  const analyst=document.getElementById('scenarioName').value||'Me';
  const out=[];
  TEAMS.forEach(team=>{
    const state=userProj[team]; if(!state) return;
    const totalTgts=teamTargetPool(state);
    const totalPassTDs=teamPassTDs(state);
    state.qbs.forEach(qb=>{
      const bp=getBase(team,'QB').find(x=>x.name===qb.name)||getBase(team,'QB')[0]||{};
      out.push({season:'2025',analyst_name:analyst,name:qb.name,fantasy_position:'QB',team,
        headshot:qb.headshot||null,slug:qb.slug||null,
        passing_yards:Math.round(qb.passing_yards),passing_touchdowns:Math.round(qb.passing_tds),
        passing_attempts:Math.round(qb.passing_attempts),passing_completions:Math.round(qb.passing_completions),
        interceptions_thrown:Math.round(qb.interceptions_thrown),
        rushing_yards:Math.round(qb.qb_rush_yards),rushing_touchdowns:Math.round(qb.qb_rush_tds),
        rushing_attempts:Math.round(qb.qb_rush_attempts),
        rushing_yards_per_attempt:qb.qb_rush_attempts>0?+(qb.qb_rush_yards/qb.qb_rush_attempts).toFixed(2):0,
        receptions:0,receiving_yards:0,receiving_touchdowns:0,receiving_targets:'0',receiving_yards_per_reception:0,
        fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
        bye_week:bp.bye_week||null,risk:bp.risk||5,upside:bp.upside||5});
    });
    if(state.passing_shares){
      state.passing_shares.forEach(p=>{
        const projTgts=Math.round(p.share*totalTgts);
        const projRec=Math.round(projTgts*(p.catch_rate||0.65));
        const projYds=Math.round(projTgts*(p.ypt||9));
        const projTDs=+(p.td_share*totalPassTDs).toFixed(1);
        const bp=[...getBase(team,'WR'),...getBase(team,'TE'),...getBase(team,'RB')].find(x=>x.name===p.name)||{};
        const ex=out.findIndex(x=>x.name===p.name&&x.team===team);
        const rec={receptions:projRec,receiving_yards:projYds,receiving_touchdowns:projTDs,
          receiving_targets:projTgts.toString(),receiving_yards_per_reception:projRec>0?+(projYds/projRec).toFixed(2):0};
        if(ex>=0) Object.assign(out[ex],rec);
        else out.push({season:'2025',analyst_name:analyst,name:p.name,fantasy_position:p.pos,team,
          headshot:p.headshot||null,slug:p.slug||null,
          passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          rushing_yards:bp.rushing_yards||0,rushing_touchdowns:0,rushing_attempts:bp.rushing_attempts||0,rushing_yards_per_attempt:0,
          ...rec,fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
          bye_week:bp.bye_week||null,risk:bp.risk||5,upside:bp.upside||5});
      });
    }
    if(state.rushing.shares){
      const r=state.rushing;
      const totRushTDs=teamRushTDs(state);
      r.shares.forEach(p=>{
        const att=Math.round(p.share*r.total_attempts);
        const yds=Math.round(att*(p.ypc||r.ypa||4));
        const tds=+(p.td_share*totRushTDs).toFixed(1);
        const bp=getBase(team,'RB').find(x=>x.name===p.name)||{};
        const ex=out.findIndex(x=>x.name===p.name&&x.team===team);
        const rush={rushing_yards:yds,rushing_touchdowns:tds,rushing_attempts:att,
          rushing_yards_per_attempt:att>0?+(yds/att).toFixed(2):0};
        if(ex>=0) Object.assign(out[ex],rush);
        else out.push({season:'2025',analyst_name:analyst,name:p.name,fantasy_position:'RB',team,
          headshot:p.headshot||null,slug:p.slug||null,
          passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          ...rush,receptions:0,receiving_yards:0,receiving_touchdowns:0,receiving_targets:'0',receiving_yards_per_reception:0,
          fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
          bye_week:bp.bye_week||null,risk:bp.risk||5,upside:bp.upside||5});
      });
    }
  });
  return {projections:out};
}
function dlFile(content,filename,mime){
  const b64=btoa(unescape(encodeURIComponent(content)));
  const a=document.createElement('a');
  a.href=`data:${mime};charset=utf-8;base64,${b64}`;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}
function exportJSON(){
  const d=buildOutput();
  if(!d.projections.length){toast('No projections to export','err');return;}
  const n=(document.getElementById('scenarioName').value||'projections').replace(/[^a-z0-9]/gi,'_');
  dlFile(JSON.stringify(d,null,2),`${n}.json`,'application/json');
  toast(`Exported ${d.projections.length} players ✓`,'ok');
}
function exportCSV(){
  const d=buildOutput();
  if(!d.projections.length){toast('No projections','err');return;}
  const keys=Object.keys(d.projections[0]);
  const csv=[keys.join(','),...d.projections.map(r=>keys.map(k=>{
    const v=r[k];return(v===null||v===undefined)?'':String(v).includes(',')?`"${v}"`:v;}).join(','))].join('\n');
  const n=(document.getElementById('scenarioName').value||'projections').replace(/[^a-z0-9]/gi,'_');
  dlFile(csv,`${n}.csv`,'text/csv');toast('CSV exported ✓','ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// Two-stage reset
// ─────────────────────────────────────────────────────────────────────────────
function resetAll(){
  if(importedSnapshot && dirtySinceImport){
    // Stage 1: revert to imported snapshot
    if(!confirm('Reset all edits back to the imported projection set?')) return;
    userProj=deepCopy(importedSnapshot);
    dirtySinceImport=false;
    renderSidebar();
    if(currentTeam&&userProj[currentTeam]) renderContent(); else renderContent();
    toast('Reverted to imported projections ✓','ok');
    return;
  }
  // Stage 2 (or no import): full reset to seed
  const msg=importedSnapshot?'Clear the imported set and reset everything to base seed data?':'Reset all projections to base seed data?';
  if(!confirm(msg)) return;
  userProj={}; importedSnapshot=null; dirtySinceImport=false; currentTeam=null;
  renderSidebar();
  document.getElementById('content').innerHTML=emptyHTML();
  toast('Reset to base seed ✓','ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
seasonStatsCache['proj'] = SEED;
projSeed = SEED;
renderSeasonTabs();
renderSidebar();

// If no seed is embedded (the default now — we pull live from Sleeper), fetch the
// current-season projections automatically on first load. A prebuilt ffforge_seed.json
// (via the 📦 Seed button) or ↻ Sleeper can refresh/replace it at any time.
//
// On boot we ALSO try to fetch ffforge_seed.json sitting next to the HTML, so the
// FantasyPros ECR (and any prebuilt projections/history) load automatically without a
// manual 📦 click. This works when the file is served over http(s); on a bare file://
// open the browser blocks it (CORS), and we silently fall back to the live Sleeper pull.
(function boot(){
  const hasEmbeddedProj = SEED && Object.keys(SEED).some(t=>SEED[t] && (SEED[t].QB.length||SEED[t].RB.length||SEED[t].WR.length||SEED[t].TE.length));
  const hasEmbeddedECR  = ECR && Object.keys(ECR).some(f=>ECR[f] && Object.keys(ECR[f]).length);
  // If a seed was baked into this file (bake_seed.py), everything is already in memory —
  // no fetch, so it works when opened directly from a phone (file://) with no CORS issue.
  if(hasEmbeddedProj){
    renderSeasonTabs(); renderSidebar(); document.getElementById('content').innerHTML=emptyHTML();
    toast(`Loaded embedded seed${hasEmbeddedECR?' · ECR ready':''} ✓`,'ok');
    return;
  }
  document.getElementById('content').innerHTML=`<div class="empty">
    <div class="empty-icon">📡</div><div class="empty-title">Loading ${PROJ_SEASON} data…</div>
    <div class="empty-body">Checking for a prebuilt seed, then pulling live from Sleeper if needed.</div></div>`;
  // No embedded projections. Try a local seed file (works when served over http), which at
  // minimum gives us ECR; then fall back to a live Sleeper pull for projections.
  tryAutoLoadSeed().then(loaded=>{
    const hasProj = SEED && Object.keys(SEED).some(t=>SEED[t] && (SEED[t].QB.length||SEED[t].RB.length||SEED[t].WR.length||SEED[t].TE.length));
    if(hasProj){ renderSeasonTabs(); renderSidebar(); document.getElementById('content').innerHTML=emptyHTML(); }
    else refreshFromSleeper();   // ECR (if any) already adopted by tryAutoLoadSeed
  });
})();

// Attempt to fetch ffforge_seed.json next to the page. Returns true if it loaded anything
// useful (at minimum ECR). Never throws — a file:// open or missing file just returns false.
async function tryAutoLoadSeed(){
  try{
    const res = await fetch('ffforge_seed.json', {cache:'no-store'});
    if(!res.ok) return false;
    const j = await res.json();
    let got=false;
    if(j.ecr){ ECR=j.ecr; got=true; }
    if(j.contracts){ CONTRACTS=j.contracts; got=true; }
    // Only adopt prebuilt projections/history if present and non-trivial.
    if(j.seed && Object.keys(j.seed).length){
      SEED=j.seed; projSeed=SEED; seasonStatsCache={proj:SEED};
      HISTORY=j.history||{}; HISTORY_SEASONS=j.history_seasons||[];
      workingProj={}; userProj=workingProj; activeSeason='proj';
      got=true;
    }
    if(got){
      const n=j.seed?Object.values(j.seed).reduce((s,t)=>s+(t.QB||[]).length+(t.RB||[]).length+(t.WR||[]).length+(t.TE||[]).length,0):0;
      const ecrN=j.ecr?Object.keys(ecrTableFor(rankFormat)||{}).length:0;
      toast(`Auto-loaded seed${ecrN?` · ${ecrN} ECR ranks`:''}${n?` · ${n} players`:''} ✓`,'ok');
    }
    return got;
  }catch(e){
    // CORS (file://) or network error — expected when opened directly; fall back silently.
    return false;
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// Sleeper live data integration
// ═════════════════════════════════════════════════════════════════════════════
const SLEEPER_STAT_MAP = {
  pass_yd:'passing_yards', pass_td:'passing_touchdowns', pass_att:'passing_attempts',
  pass_cmp:'passing_completions', pass_int:'interceptions_thrown',
  rush_yd:'rushing_yards', rush_td:'rushing_touchdowns', rush_att:'rushing_attempts',
  rec:'receptions', rec_yd:'receiving_yards', rec_td:'receiving_touchdowns',
  rec_tgt:'receiving_targets', fum_lost:'fumbles_lost', gp:'games_played',
  adp_std:'adp', adp_ppr:'adp_ppr', adp_half_ppr:'adp_half_ppr', adp_2qb:'adp_2qb',
};
const POS_KEEP = {QB:1,RB:1,WR:1,TE:1};

async function sleeperFetch(url){
  const res = await fetch(url, {headers:{'Accept':'application/json'}});
  if(!res.ok) throw new Error(`Sleeper ${res.status}`);
  return res.json();
}

// Load (and cache in-memory) the big Sleeper player DB — fetched at most once.
// Keep ALL skill players (even currently teamless / retired) so historical seasons
// can still resolve a player's name even if they're no longer rostered.
async function loadSleeperPlayers(){
  if(sleeperPlayers) return sleeperPlayers;
  toast('Fetching Sleeper player database…');
  const raw = await sleeperFetch(SLEEPER_PLAYERS_URL);
  const slim = {};
  for(const pid in raw){
    const p = raw[pid];
    if(!POS_KEEP[p.position]) continue;
    slim[pid] = {
      player_id:pid, name:`${p.first_name||''} ${p.last_name||''}`.trim(),
      pos:p.position, team:p.team||null, age:p.age||null, years_exp:p.years_exp,
    };
  }
  sleeperPlayers = slim;
  buildSleeperNameIndex();
  return slim;
}

// name(+pos) → player_id, so imported players (or any without an id) can be matched to a
// Sleeper player_id and therefore get a Sleeper headshot.
let sleeperNameIdx=null;
function normName(s){ return (s||'').toLowerCase().replace(/[.'\-]/g,'').replace(/\s+(jr|sr|ii|iii|iv|v)$/,'').replace(/\s+/g,' ').trim(); }
function buildSleeperNameIndex(){
  sleeperNameIdx={};
  if(!sleeperPlayers) return;
  for(const pid in sleeperPlayers){
    const p=sleeperPlayers[pid];
    sleeperNameIdx[normName(p.name)]=pid;
    if(p.pos) sleeperNameIdx[normName(p.name)+'|'+p.pos]=pid;
  }
}
// Resolve a player_id from a name (and optional position). Returns null if no match.
function resolvePlayerId(name,pos){
  if(!sleeperNameIdx) buildSleeperNameIndex();
  if(!sleeperNameIdx) return null;
  const n=normName(name);
  return (pos&&sleeperNameIdx[n+'|'+pos]) || sleeperNameIdx[n] || null;
}

// Pull season team + identity off the stat/projection row itself, since a player's
// team changes year to year. The row's `team` is the team they were on THAT season.
function normalizeSleeperRow(row){
  const s = row.stats||{}; const out={};
  for(const k in SLEEPER_STAT_MAP){ if(s[k]!=null) out[SLEEPER_STAT_MAP[k]] = s[k]; }
  return {
    stats:out, pid:String(row.player_id),
    team: row.team || null,
    pos: row.position || (row.player&&row.player.position) || null,
    name: (row.player && `${row.player.first_name||''} ${row.player.last_name||''}`.trim()) || null,
  };
}

// Build a SEED-shaped object {team:{QB/RB/WR/TE:[...]}} from a per-season index.
// The index is keyed by player_id; each value carries that SEASON's team/pos/name/stats,
// so a player lands on the team they actually played for that year (DJ Moore → CHI in
// 2024, BUF in 2026), and rotating backup QBs resolve correctly per season.
function buildSeedEntry(pid, row, meta){
  const team = row.team || meta.team;
  const pos  = row.pos  || meta.pos;
  const name = row.name || meta.name || 'Unknown';
  if(!team) return null;
  if(!POS_KEEP[pos]) return null;
  const st = row.stats || {};
  const entry={
    name, slug:null, player_id:pid, pos, team, headshot:null, age:meta.age||null,
    passing_yards:st.passing_yards||0, passing_touchdowns:st.passing_touchdowns||0,
    passing_tds:st.passing_touchdowns||0,
    passing_attempts:st.passing_attempts||0, passing_completions:st.passing_completions||0,
    interceptions_thrown:st.interceptions_thrown||0,
    rushing_yards:st.rushing_yards||0, rushing_tds:st.rushing_touchdowns||0,
    rushing_attempts:st.rushing_attempts||0,
    receiving_targets:st.receiving_targets||0, receptions:st.receptions||0,
    receiving_yards:st.receiving_yards||0, receiving_tds:st.receiving_touchdowns||0,
    adp:st.adp||999, adp_ppr:st.adp_ppr||999, adp_half_ppr:st.adp_half_ppr||999, adp_2qb:st.adp_2qb||999,
    bye_week:null, risk:5, upside:5,
    games_played: (row.games_played!=null?row.games_played:(st.games_played||0)),
    games_started: (row.games_started!=null?row.games_started:(st.games_started||0)),
    snap_pct: (row.snap_pct!=null?row.snap_pct:null),
  };
  if(!entry.receiving_targets && entry.receptions){
    const cr = pos==='TE' ? 0.68 : 0.65;
    entry.receiving_targets = Math.round(entry.receptions / cr);
  }
  const skillInvolved = entry.passing_yards||entry.rushing_attempts||entry.receiving_targets||entry.receptions;
  const qbInvolved = entry.passing_attempts>0 || entry.passing_yards>0 || (entry.games_played||0)>0;
  const include = pos==='QB' ? qbInvolved : skillInvolved;
  return include ? entry : null;
}

function finalizeSeed(seed, isProjection){
  for(const t in seed){
    ['RB','WR','TE'].forEach(pos=>{
      seed[t][pos].sort((a,b)=>(a.adp_ppr||999)-(b.adp_ppr||999)
        || -((b.passing_yards+b.rushing_yards+b.receiving_yards)-(a.passing_yards+a.rushing_yards+a.receiving_yards)));
    });
    // For projections, Sleeper sets gp=18 for everyone (useless). Derive projected games
    // from each QB's share of the team's projected passing yards instead.
    if(isProjection) projectQBGames(seed[t].QB);
    seed[t].QB.sort((a,b)=>
      (b.games||b.games_played||0)-(a.games||a.games_played||0)
      || (b.passing_attempts||0)-(a.passing_attempts||0)
      || (b.passing_yards||0)-(a.passing_yards||0));
    assignQBSnapShares(seed[t].QB);
    // For non-projection (historical) data, games come straight from real gp.
    if(!isProjection) seed[t].QB.forEach(q=>{ if(q.games==null) q.games=q.games_played||0; });
  }
  return seed;
}

// Project games played for a team's QBs from their share of projected passing yards.
// - A clear bell-cow (>=75% of team pass yards) → 17 games, everyone else → 0.
// - A genuine committee (e.g. ATL Tua 57% / Penix 40%) → games ∝ yard share, rounded up.
// - QBs with a tiny share (Sleeper padding so they aren't buried in ADP) → 0 games.
function projectQBGames(qbs){
  if(!qbs||!qbs.length) return;
  if(qbs.length===1){ qbs[0].games=SEASON_GAMES; qbs[0].games_played=SEASON_GAMES; return; }
  const total=qbs.reduce((s,q)=>s+(q.passing_yards||0),0);
  if(total<=0){ qbs.forEach((q,i)=>{ q.games=i===0?SEASON_GAMES:0; q.games_played=q.games; }); return; }
  const shares=qbs.map(q=>(q.passing_yards||0)/total);
  const top=Math.max(...shares);
  if(top>=0.75){
    // clear starter
    qbs.forEach((q,i)=>{ q.games=shares[i]===top?SEASON_GAMES:0; q.games_played=q.games; });
    return;
  }
  // committee: games proportional to yards, rounded up; cap each at 17; ignore <12% padding
  qbs.forEach((q,i)=>{
    const g = shares[i] < 0.12 ? 0 : Math.min(SEASON_GAMES, Math.ceil(shares[i]*SEASON_GAMES));
    q.games=g; q.games_played=g;
  });
}

function assembleSeed(players, idx, isProjection){
  const seed={}; TEAMS.forEach(t=>seed[t]={QB:[],RB:[],WR:[],TE:[]});
  for(const pid in idx){
    const entry=buildSeedEntry(pid, idx[pid], players[pid]||{});
    if(entry && seed[entry.team]) seed[entry.team][entry.pos].push(entry);
  }
  return finalizeSeed(seed, isProjection);
}

// Record-list variant: each record is one team-stint (a traded player yields 2+ records).
function assembleSeedFromRecords(players, records, isProjection){
  const seed={}; TEAMS.forEach(t=>seed[t]={QB:[],RB:[],WR:[],TE:[]});
  records.forEach(row=>{
    const entry=buildSeedEntry(row.pid, row, players[row.pid]||{});
    if(entry && seed[entry.team]) seed[entry.team][entry.pos].push(entry);
  });
  return finalizeSeed(seed, isProjection);
}

// Default snap share from games played (gp). The primary QB (most games) gets exactly
// gp/SEASON_GAMES (so Rodgers at 16 of 17 ≈ 94%). The remaining share is split among the
// other QBs in proportion to their own games. A lone QB gets 100%.
function assignQBSnapShares(qbs){
  if(!qbs||!qbs.length) return;
  if(qbs.length===1){ qbs[0].snap_share=1; return; }
  const anyGP = qbs.some(q=>(q.games_played||0)>0);
  if(!anyGP){ qbs.forEach(q=>{ q.snap_share=1/qbs.length; }); return; }
  const starter=qbs[0]; // already sorted by gp desc
  const starterShare=Math.min(1,(starter.games_played||0)/SEASON_GAMES);
  starter.snap_share=starterShare;
  const remainder=Math.max(0,1-starterShare);
  const others=qbs.slice(1);
  const othersGP=others.reduce((s,q)=>s+(q.games_played||0),0);
  if(othersGP>0){ others.forEach(q=>{ q.snap_share=remainder*((q.games_played||0)/othersGP); }); }
  else { others.forEach(q=>{ q.snap_share=remainder/others.length; }); }
}

// Pull current-season projections live and make them the working seed.
async function refreshFromSleeper(){
  try{
    const players=await loadSleeperPlayers();
    toast(`Fetching ${PROJ_SEASON} projections…`);
    const rows=await sleeperFetch(SLEEPER_PROJ_URL(PROJ_SEASON));
    const idx={}; rows.forEach(r=>{const n=normalizeSleeperRow(r);idx[n.pid]=n;});
    SEED=assembleSeed(players,idx,true);
    seasonStatsCache['proj']=SEED;
    projSeed=SEED;
    // reset the working set to the fresh seed
    workingProj={}; userProj=workingProj; importedSnapshot=null; dirtySinceImport=false;
    activeSeason='proj';
    renderSeasonTabs(); renderSidebar();
    if(currentTeam){ ensureTeam(currentTeam); renderContent(); }
    else document.getElementById('content').innerHTML=emptyHTML();
    toast(`Loaded live ${PROJ_SEASON} projections from Sleeper ✓`,'ok');
  }catch(e){
    toast('Sleeper fetch failed: '+e.message,'err');
    // If we have nothing loaded at all, show actionable guidance.
    const empty = !SEED || !Object.keys(SEED).some(t=>SEED[t]&&(SEED[t].QB.length||SEED[t].WR.length||SEED[t].RB.length||SEED[t].TE.length));
    if(empty){
      document.getElementById('content').innerHTML=`<div class="empty">
        <div class="empty-icon">⚠️</div><div class="empty-title">Couldn't reach Sleeper</div>
        <div class="empty-body">The live pull was blocked (often browser CORS when opening the file directly).
        Two easy fixes:<br><br>
        <b>1.</b> Run <code>python build_seed.py</code> locally, then click <b>📦 Seed</b> and load the generated
        <code>ffforge_seed.json</code>.<br>
        <b>2.</b> Or serve the file over http (e.g. <code>python -m http.server</code>) and click <b>↻ Sleeper</b> to retry.</div></div>`;
    }
  }
}

// App-side mirror of build_seed.py's weekly aggregation. Splits a QB's season by team
// using per-week snap share, so a live reference load (no prebuilt seed) still shows a
// traded QB on each team with snap-based games. STARTER threshold matches the builder.
const STARTER_SNAP_THRESHOLD = 0.50;
function aggregateWeeksByTeam(weekly){
  const byTeam={};
  for(const wk in (weekly||{})){
    const row=weekly[wk];
    if(!row || typeof row!=='object') continue;
    const s=row.stats||{}; const team=row.team;
    if(!team) continue;
    const b=byTeam[team]||(byTeam[team]={team,games_played:0,games_started:0,starter_games:0,
      off:0,tmoff:0,starterOff:0,starterTm:0,stats:{}});
    const off=s.off_snp||0, tmoff=s.tm_off_snp||0, gp=s.gp||0;
    const hasSnapData = ('off_snp' in s) && ('tm_off_snp' in s) && tmoff>0;
    const wkSnap = hasSnapData ? off/tmoff : 0;
    b.off+=off; b.tmoff+=tmoff; b.games_started+=s.gs||0;
    // Count as a starter game if snap share exceeds threshold, OR if snap data is missing
    // but the player had a recorded game (some weeks on Sleeper lack snap tracking).
    if(gp && (wkSnap>=STARTER_SNAP_THRESHOLD || !hasSnapData)){ b.starter_games++; b.starterOff+=off; b.starterTm+=tmoff; }
    for(const k in SLEEPER_STAT_MAP){
      if(['gp','gs','off_snp','tm_off_snp'].includes(k)) continue;
      if(s[k]!=null) b.stats[SLEEPER_STAT_MAP[k]]=(b.stats[SLEEPER_STAT_MAP[k]]||0)+s[k];
    }
  }
  const out=[];
  for(const team in byTeam){
    const b=byTeam[team];
    b.games_played=b.starter_games;
    const denom=b.starterTm||b.tmoff, num=b.starterOff||b.off;
    b.snap_pct=denom>0?Math.round(num/denom*1000)/10:null;
    b.stats.games_played=b.games_played; b.stats.games_started=b.games_started;
    out.push({team:b.team,games_played:b.games_played,games_started:b.games_started,snap_pct:b.snap_pct,stats:b.stats});
  }
  out.sort((a,b)=>(b.games_played-a.games_played)||(b.stats.passing_yards||0)-(a.stats.passing_yards||0));
  return out;
}

// Build a reference-season seed live from Sleeper, fetching weekly data for QODs (QBs with
// games) so traded QBs split by team. Falls back to season-grouping for everyone else.
async function buildLiveReferenceSeed(season, players, seasonIdx){
  // Identify QBs who played, to fetch their weekly splits.
  const qbPids=[];
  for(const pid in seasonIdx){
    const r=seasonIdx[pid];
    const isQB = r.pos==='QB' || (players[pid]&&players[pid].pos==='QB');
    const gp = (r.stats&&r.stats.games_played)||0;
    if(isQB && gp>0) qbPids.push(pid);
  }
  // Fetch weekly for those QBs (bounded; cached per session).
  const records=[];
  const handled=new Set();
  for(const pid of qbPids){
    try{
      const weekly=await sleeperFetch(SLEEPER_WEEKLY_URL(pid,season));
      const split=aggregateWeeksByTeam(weekly);
      if(split.length){
        const meta=players[pid]||{};
        split.forEach(r=>records.push({pid, team:r.team, pos:'QB', name:meta.name||(seasonIdx[pid]&&seasonIdx[pid].name),
          games_played:r.games_played, games_started:r.games_started, snap_pct:r.snap_pct, stats:r.stats}));
        handled.add(pid);
      }
    }catch(e){ /* skip this QB's split on error; falls back below */ }
  }
  // Everyone else (and any QB whose weekly failed) uses their season-grouping row.
  for(const pid in seasonIdx){
    if(handled.has(pid)) continue;
    const r=seasonIdx[pid];
    records.push({pid, team:r.team, pos:r.pos, name:r.name, stats:r.stats,
      games_played:(r.stats&&r.stats.games_played)||0});
  }
  const meta={};
  for(const pid in players) meta[pid]=players[pid];
  return assembleSeedFromRecords(meta, records);
}
// Background-enhance a season's seed with per-team QB splits from weekly data.
// Fetches all QBs in PARALLEL (not sequential) so it completes in ~1-2 seconds,
// then re-renders regardless of which tab the user is on.
async function enhanceQBSplits(season, players, seasonIdx){
  try{
    const qbPids=[];
    for(const pid in seasonIdx){
      const r=seasonIdx[pid];
      const isQB = r.pos==='QB' || (players[pid]&&players[pid].pos==='QB');
      const gp = (r.stats&&r.stats.games_played)||0;
      if(isQB && gp>0) qbPids.push(pid);
    }
    if(!qbPids.length) return;
    // Fetch weekly for all QBs in parallel — much faster than sequential.
    const results=await Promise.allSettled(
      qbPids.map(pid=>sleeperFetch(SLEEPER_WEEKLY_URL(pid,season)).then(w=>({pid,weekly:w})))
    );
    const records=[];
    const handled=new Set();
    for(const r of results){
      if(r.status!=='fulfilled'||!r.value) continue;
      const {pid,weekly}=r.value;
      const split=aggregateWeeksByTeam(weekly);
      if(split && split.length){
        const meta=players[pid]||{};
        split.forEach(s=>records.push({pid, team:s.team, pos:'QB',
          name:meta.name||(seasonIdx[pid]&&seasonIdx[pid].name),
          games_played:s.games_played, games_started:s.games_started,
          snap_pct:s.snap_pct, stats:s.stats}));
        handled.add(pid);
      }
    }
    if(!handled.size) return;
    // Everyone not handled uses their season-grouping row.
    for(const pid in seasonIdx){
      if(handled.has(pid)) continue;
      const r=seasonIdx[pid];
      records.push({pid, team:r.team, pos:r.pos, name:r.name, stats:r.stats,
        games_played:(r.stats&&r.stats.games_played)||0});
    }
    const meta={};
    for(const pid in players) meta[pid]=players[pid];
    seasonStatsCache[season]=assembleSeedFromRecords(meta, records);
    // Re-render if still viewing this season — works from ANY tab (QB, Passing, etc).
    if(activeSeason===season){
      SEED=seasonStatsCache[season];
      referenceProj={}; userProj=referenceProj;
      if(currentTeam){ ensureTeam(currentTeam); renderContent(); }
      toast(`QB team splits loaded for ${season} ✓`,'ok');
    }
  }catch(e){ /* background enhancement failed — season still works unsplit */ }
}
// re-render so things like the vacated-production note can appear once the data arrives.
// Used when running off a live Sleeper pull (no prebuilt HISTORY) and we need last year.
async function ensureSeasonStats(season){
  if(seasonStatsCache[season] || seasonStatsFetching[season]) return;
  seasonStatsFetching[season]=true;
  try{
    const players=await loadSleeperPlayers();
    const rows=await sleeperFetch(SLEEPER_STATS_URL(season));
    const idx={}; rows.forEach(r=>{const n=normalizeSleeperRow(r);idx[n.pid]=n;});
    seasonStatsCache[season]=assembleSeed(players,idx);
    // re-render the current view so the note/record now has data
    if(currentTeam) renderContent();
  }catch(e){ /* offline / CORS — silently skip; note just won't show */ }
  finally{ seasonStatsFetching[season]=false; }
}
async function loadSeason(season){
  if(seasonLoading) return;
  if(season===activeSeason) return;
  if(season==='proj'){
    activeSeason='proj';
    SEED = projSeed || seasonStatsCache['proj'] || SEED;
    userProj = workingProj;     // restore the editable working set
    afterSeasonSwitch();
    return;
  }
  // entering reference mode — build that season's seed if needed
  if(!seasonStatsCache[season] && HISTORY && Object.keys(HISTORY).length){
    const built=buildSeedFromHistory(season);
    if(built) seasonStatsCache[season]=built;
  }
  if(seasonStatsCache[season]){ enterReference(season); return; }
  // otherwise fetch live from Sleeper
  seasonLoading=true;
  const host=document.getElementById('seasonTabs');
  if(host){ const btns=host.querySelectorAll('.season-tab'); btns.forEach(b=>{if(b.textContent===season)b.textContent=season+' …';}); }
  try{
    const players=await loadSleeperPlayers();
    toast(`Fetching ${season} stats…`);
    const rows=await sleeperFetch(SLEEPER_STATS_URL(season));
    const idx={}; rows.forEach(r=>{const n=normalizeSleeperRow(r);idx[n.pid]=n;});
    // Load immediately with season-grouping data (fast, one call).
    seasonStatsCache[season]=assembleSeed(players,idx);
    seasonLoading=false;
    enterReference(season);
    toast(`Loaded ${season} actual stats ✓`,'ok');
    // Then enhance QB splits in the background (optional; traded QBs land on correct teams).
    enhanceQBSplits(season, players, idx);
  }catch(e){
    seasonLoading=false;
    renderSeasonTabs();
    toast(`Could not load ${season}: ${e.message} — this needs a live connection to Sleeper`,'err');
  }
}

// Enter read-only reference mode for a past season. Working set is preserved untouched.
function enterReference(season){
  if(activeSeason==='proj') workingProj = userProj;  // stash the working set
  activeSeason=season;
  SEED = seasonStatsCache[season];
  referenceProj = {};
  userProj = referenceProj;     // render code now reads the reference state
  afterSeasonSwitch();
  // fetch the team's record for that season (ESPN) in the background
  if(currentTeam) fetchTeamRecord(season,currentTeam);
}

// Build a seed from embedded HISTORY. New shape: player_id → { season: [ {team, pos,
// name, games_played, games_started, snap_pct, stats}, ... ] } — a LIST so a traded
// player (e.g. Flacco 2025: CLE + CIN) appears on each team with that stint's stats.
// Older builds stored a single object or flat stats; both are handled.
function buildSeedFromHistory(season){
  if(!HISTORY||!Object.keys(HISTORY).length) return null;
  const meta={};
  const base=seasonStatsCache['proj']|| (typeof SEED_DATA!=='undefined'?SEED_DATA:{});
  for(const t in base) for(const pos in base[t]) base[t][pos].forEach(p=>{
    if(p.player_id) meta[p.player_id]={player_id:p.player_id,name:p.name,pos:p.pos,team:p.team,age:p.age};
  });
  // Flatten to a list of normalized records (one per team-stint).
  const records=[];
  for(const pid in HISTORY){
    const rec=HISTORY[pid][season];
    if(!rec) continue;
    const list = Array.isArray(rec) ? rec : [rec];
    list.forEach(r=>{
      const stats = r.stats || (r.team?{}:r); // flat-stats fallback
      records.push({
        pid, stats,
        team: r.team||null, pos: r.pos||null, name: r.name||null,
        games_played: r.games_played!=null?r.games_played:(stats.games_played||0),
        games_started: r.games_started!=null?r.games_started:(stats.games_started||0),
        snap_pct: r.snap_pct!=null?r.snap_pct:null,
      });
    });
  }
  if(!records.length) return null;
  return assembleSeedFromRecords(meta, records);
}

function afterSeasonSwitch(){
  // We DON'T wipe the working set anymore — proj mode restores workingProj, reference mode
  // uses a fresh referenceProj. Just re-render for the active view.
  if(currentTeam && !(SEED[currentTeam])) currentTeam=null;
  renderSeasonTabs(); renderSidebar();
  if(currentTeam){ ensureTeam(currentTeam); renderContent(); }
  else document.getElementById('content').innerHTML=emptyHTML();
}

function renderSeasonTabs(){
  const host=document.getElementById('seasonTabs'); if(!host) return;
  // If a prebuilt seed bundled history, show exactly those seasons. Otherwise offer the
  // last 10 seasons (clickable; each fetches live from Sleeper on demand). This way you
  // always have reference years even when running off a live pull with no prebuilt seed.
  const hist = (HISTORY_SEASONS && HISTORY_SEASONS.length)
    ? HISTORY_SEASONS
    : Array.from({length:10},(_,n)=>String(PROJ_SEASON-1-n));
  const seasons=['proj', ...hist];
  host.innerHTML = seasons.map(s=>{
    const label = s==='proj' ? `${PROJ_SEASON} Proj` : s;
    return `<button class="season-tab ${activeSeason===s?'active':''}" onclick="loadSeason('${s}')">${label}</button>`;
  }).join('');
}

// ═════════════════════════════════════════════════════════════════════════════
// ESPN team records (per season) — shown when viewing a reference season
// ═════════════════════════════════════════════════════════════════════════════
const ESPN_TEAM_ID = {ATL:1,BUF:2,CHI:3,CIN:4,CLE:5,DAL:6,DEN:7,DET:8,GB:9,TEN:10,
  IND:11,KC:12,LV:13,LAR:14,MIA:15,MIN:16,NE:17,NO:18,NYG:19,NYJ:20,PHI:21,ARI:22,
  PIT:23,LAC:24,SF:25,SEA:26,TB:27,WAS:28,CAR:29,JAX:30,BAL:33,HOU:34};
const ESPN_RECORD_URL=(season,tid)=>`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/teams/${tid}/record?lang=en&region=us`;

async function fetchTeamRecord(season,team){
  const key=`${season}:${team}`;
  if(espnRecordCache[key]!=null) return espnRecordCache[key];
  const tid=ESPN_TEAM_ID[team]; if(!tid) return null;
  try{
    const data=await sleeperFetch(ESPN_RECORD_URL(season,tid));
    let rec=null;
    if(data && data.items){
      const overall=data.items.find(i=>i.type==='total'||i.name==='overall')||data.items[0];
      rec=overall && (overall.summary||overall.displayValue);
    }
    espnRecordCache[key]=rec||'';
    if(activeSeason===season && currentTeam===team) renderContent();
    return rec;
  }catch(e){ espnRecordCache[key]=''; return null; }
}

// ═════════════════════════════════════════════════════════════════════════════
// Copy reference-season stats into the working (projection) set
// ═════════════════════════════════════════════════════════════════════════════
// Copy a team's reference-season production into the working set, but ONLY for players
// who are still on that team in the projection season. Players who left (traded, retired,
// signed elsewhere) are skipped; brand-new players keep their existing 2026 projection.
function copyTeamToWorking(team){
  if(activeSeason==='proj') return;
  const refSeason=activeSeason;
  const refSeasonSeed=seasonStatsCache[activeSeason]||{};
  const ref=refSeasonSeed[team]; if(!ref){ toast('Nothing to copy','err'); return; }
  // Snapshot the team's CURRENT working state AND proj-seed roster row before we touch
  // either, so this whole copy can be undone in one step (e.g. you copy 2025 Colts stats
  // onto Michael Pittman's new Steelers slot, don't like it, and want it all back exactly
  // as it was — this must run before any mutation below, not after).
  pushUndo(team);
  const ps=projSeed||seasonStatsCache['proj']||{};
  ps[team]=ps[team]||{QB:[],RB:[],WR:[],TE:[]};
  // Build the set of player_ids currently on this team (projection roster + full Sleeper DB)
  const onTeam=new Set();
  ['QB','RB','WR','TE'].forEach(pos=>(ps[team][pos]||[]).forEach(p=>p.player_id&&onTeam.add(p.player_id)));
  if(sleeperPlayers){ for(const pid in sleeperPlayers){ if(sleeperPlayers[pid].team===team) onTeam.add(pid); } }
  let copied=0, skipped=0;
  ['QB','RB','WR','TE'].forEach(pos=>{
    (ref[pos]||[]).forEach(refp=>{
      if(!refp.player_id) return;
      if(!onTeam.has(refp.player_id)){ skipped++; return; }   // no longer a member → skip
      const arr=ps[team][pos]||(ps[team][pos]=[]);
      const copy=deepCopy(refp); copy.team=team;
      const ex=arr.findIndex(p=>p.player_id===refp.player_id);
      if(ex>=0) arr[ex]=copy; else arr.push(copy);
      copied++;
    });
  });
  delete workingProj[team];
  activeSeason='proj'; userProj=workingProj; SEED=ps; currentTeam=team;
  dirtySinceImport=true;
  ensureTeam(team);
  renderSeasonTabs(); renderSidebar(); renderContent();
  toast(`Copied ${copied} returning ${team} player${copied===1?'':'s'} from ${refSeason}${skipped?` · skipped ${skipped} no longer on roster`:''} ✓`,'ok');
}

// Copy a single player's reference line into the working set, on the team they're
// projected to play for THIS season (falls back to their historical team).
function copyPlayerToWorking(pid,pos){
  if(activeSeason==='proj') return;
  const refSeasonSeed=seasonStatsCache[activeSeason]||{};
  let src=null;
  const rt=currentTeam;
  for(const p of ['QB','RB','WR','TE']){
    const e=(refSeasonSeed[rt]&&refSeasonSeed[rt][p]||[]).find(x=>x.player_id===pid);
    if(e){ src=e; break; }
  }
  if(!src){ toast('Could not find that player','err'); return; }
  const ps=projSeed||seasonStatsCache['proj']||{};
  // find where they're projected this season
  let destTeam=rt;
  outer: for(const tm in ps){ for(const p of ['QB','RB','WR','TE']){
    if((ps[tm][p]||[]).some(x=>x.player_id===pid)){ destTeam=tm; break outer; }
  }}
  // Snapshot destTeam's working state AND proj-seed roster row before ANY mutation below
  // (including creating the roster skeleton if this team never had one), so a single undo
  // fully removes this copy.
  pushUndo(destTeam);
  ps[destTeam]=ps[destTeam]||{QB:[],RB:[],WR:[],TE:[]};
  const arr=ps[destTeam][src.pos]||(ps[destTeam][src.pos]=[]);
  const copy=deepCopy(src); copy.team=destTeam;
  const ex=arr.findIndex(p=>p.player_id===pid);
  if(ex>=0) arr[ex]=copy; else arr.push(copy);
  delete workingProj[destTeam];   // rebuild that working team to include the copied line
  dirtySinceImport=true;
  const sameTeam = destTeam===currentTeam;
  toast(`Copied ${src.name}'s ${activeSeason} line → ${destTeam} working set ✓${sameTeam?' · ↶ undo above':` · ↶ undo on ${destTeam}'s page`}`,'ok');
  updateUndoButton();
}

// ═════════════════════════════════════════════════════════════════════════════
// Load a prebuilt seed file (ffforge_seed.json from build_seed.py)
// This is the no-edit path: run the script, then load the JSON here.
// ═════════════════════════════════════════════════════════════════════════════
function triggerSeedLoad(){ document.getElementById('seedFile').click(); }
function handleSeedLoad(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const j=JSON.parse(ev.target.result);
      // Accept the file if it has EITHER projections or ECR (an ECR-only seed is valid —
      // it still populates the rankings ECR/Tier columns).
      const hasSeed = j.seed && Object.keys(j.seed).length;
      const hasECR  = j.ecr && Object.keys(j.ecr).some(k=>j.ecr[k] && Object.keys(j.ecr[k]).length);
      if(!hasSeed && !hasECR) throw new Error('Not an ffforge_seed.json (no "seed" projections or "ecr" data found)');
      if(j.ecr) ECR=j.ecr;   // FantasyPros ECR (replaces ADP) — set FIRST so it survives even if seed is empty
      if(j.contracts) CONTRACTS=j.contracts;   // OverTheCap contracts (dynasty Age/APY/FA)
      if(hasSeed){
        SEED=j.seed;
        HISTORY=j.history||{};
        HISTORY_SEASONS=j.history_seasons||[];
        seasonStatsCache={proj:SEED};
        projSeed=SEED;
        workingProj={}; userProj=workingProj; importedSnapshot=null; dirtySinceImport=false; activeSeason='proj';
        currentTeam=null;
      }
      renderSeasonTabs(); renderSidebar();
      // If the rankings page is open, re-render it so ECR/Tier appear immediately.
      if(currentPhase==='Rankings') renderRankings();
      else document.getElementById('content').innerHTML=emptyHTML();
      const n=hasSeed?Object.values(SEED).reduce((s,t)=>s+t.QB.length+t.RB.length+t.WR.length+t.TE.length,0):0;
      const ecrN=hasECR?Object.keys(ecrTableFor(rankFormat)||{}).length:0;
      toast(`Loaded seed${n?`: ${n} players, ${HISTORY_SEASONS.length} prior seasons`:''}${ecrN?` · ${ecrN} ECR ranks`:''} ✓`,'ok');
    }catch(err){ toast('Seed load failed: '+err.message,'err'); }
  };
  r.readAsText(f); e.target.value='';
}

// ═════════════════════════════════════════════════════════════════════════════
// Live draft follow (Sleeper draft picks)
// ═════════════════════════════════════════════════════════════════════════════
function promptDraftFollow(){
  const raw=prompt('Paste a Sleeper draft ID or draft URL to follow live:\n(e.g. 1234567890 or https://sleeper.com/draft/nfl/1234567890)');
  if(!raw) return;
  const m=String(raw).match(/(\d{6,})/);
  if(!m){ toast('Could not find a draft ID in that input','err'); return; }
  draftId=m[1];
  startDraftFollow();
}
async function startDraftFollow(){
  if(draftTimer) clearInterval(draftTimer);
  await pollDraft();
  draftTimer=setInterval(pollDraft, 4000); // poll every 4s like a live board
  toast(`Following draft ${draftId} ✓`,'ok');
  if(currentPhase==='Rankings') renderRankings();
}
function stopDraftFollow(){
  if(draftTimer){clearInterval(draftTimer);draftTimer=null;}
  draftId=null; draftedIds={};
  toast('Stopped following draft','ok');
  if(currentPhase==='Rankings') renderRankings();
}
async function pollDraft(){
  if(!draftId) return;
  try{
    const picks=await sleeperFetch(SLEEPER_PICKS_URL(draftId));
    const next={};
    (picks||[]).forEach(p=>{ if(p.player_id) next[String(p.player_id)]=true; });
    const changed = Object.keys(next).length!==Object.keys(draftedIds).length;
    draftedIds=next;
    if(changed && currentPhase==='Rankings') renderRankings();
  }catch(e){ /* keep polling quietly */ }
}
function toggleHideDrafted(){ hideDrafted=!hideDrafted; renderRankings(); }







