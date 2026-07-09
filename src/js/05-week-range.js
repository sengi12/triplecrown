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
const TEAMS = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN',
  'DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE',
  'NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
const PCOLORS = ['#4a9eff','#00d4aa','#ff6b35','#c084fc','#fbbf24','#f472b6',
  '#34d399','#a78bfa','#fb923c','#60a5fa','#e879f9','#38bdf8','#f97316','#86efac'];
const SEASON_GAMES = 17;
const TARGET_RATE = 0.95; // targets ≈ pass attempts × this
const PROJ_SEASON = (typeof SEED_SEASON!=='undefined') ? SEED_SEASON : 2026;
document.getElementById('scenarioName').value = PROJ_SEASON + ' Projections';

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

