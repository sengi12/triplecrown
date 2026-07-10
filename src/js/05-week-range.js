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

// QB version of sumWeeklyRange: passing + rushing totals over the requested window, restricted
// to the same team so a traded player's split doesn't blend multiple rosters together.
function sumWeeklyRangeQB(weekly, team, fromWk, toWk){
  const out = {pass_yards:0, pass_att:0, pass_td:0, comp:0, pass_int:0,
               rush_att:0, rush_yards:0, rush_td:0, games_played:0};
  for(const wk in (weekly||{})){
    const wn = parseInt(wk);
    if(isNaN(wn) || wn<fromWk || wn>toWk) continue;
    const row = weekly[wk];
    if(!row || typeof row!=='object' || row.team!==team) continue;
    const s = row.stats||{};
    if(s.gp) out.games_played += s.gp;
    out.pass_yards += s.pass_yd||0;
    out.pass_att   += s.pass_att||0;
    out.pass_td    += s.pass_td||0;
    out.comp       += s.pass_cmp||0;
    out.pass_int   += s.pass_int||0;
    out.rush_att   += s.rush_att||0;
    out.rush_yards += s.rush_yd||0;
    out.rush_td    += s.rush_td||0;
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

// Per-QB filtered totals for the active week window. The passing/rushing tabs already use the
// aggregated QB pool; this finer map powers the QB phase itself and the 17-game pace tooltip.
async function buildWeekFilterQBData(team, season, fromWk, toWk){
  const qbs=getBase(team,'QB').filter(p=>p.player_id);
  const results = await Promise.allSettled(
    qbs.map(p=>fetchPlayerWeekly(p.player_id, season).then(w=>({pid:p.player_id, weekly:w})))
  );
  const data={};
  for(const r of results){
    if(r.status!=='fulfilled'||!r.value||!r.value.weekly) continue;
    data[r.value.pid]=sumWeeklyRangeQB(r.value.weekly, team, fromWk, toWk);
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

// HTML-escape a string that is going into a title="..." attribute.
function escAttr(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// Close any open 17-game pace popovers.
function closeWeekFilterPacePops(){
  if(!document || !document.querySelectorAll) return;
  document.querySelectorAll('.pace-info-pop').forEach(el=>el.remove());
}
// Toggle a persistent, selectable popover containing the 17-game pace text so the user can
// copy it without racing a hover tooltip.
function toggleWeekFilterPace(btn, text){
  if(!btn || !btn.parentNode) return;
  const wrap = btn.parentNode;
  const existing = wrap.querySelector ? wrap.querySelector('.pace-info-pop') : null;
  if(existing){ existing.remove(); return; }
  closeWeekFilterPacePops();
  const pop = document.createElement('div');
  pop.className='pace-info-pop';
  pop.onclick=(e)=>e.stopPropagation();
  pop.innerHTML = `<div class="pace-info-pop-head">
      <span class="pace-info-pop-lbl">17-game pace</span>
      <button class="pace-info-pop-close" onclick="this.closest('.pace-info-pop').remove()" aria-label="Close">✕</button>
    </div>
    <div class="pace-info-pop-body">${escAttr(text)}</div>`;
  wrap.appendChild(pop);
  // Position as viewport-fixed and clamp so it never runs off-screen (mobile or narrow desktop).
  // Prefer right-aligned to the button and below it; flip above / clamp to the edges as needed.
  try{
    const M=8, vw=window.innerWidth, vh=window.innerHeight;
    const br=btn.getBoundingClientRect(), pr=pop.getBoundingClientRect();
    let left=br.right-pr.width;
    if(left+pr.width>vw-M) left=vw-M-pr.width;
    if(left<M) left=M;
    let top=br.bottom+6;
    if(top+pr.height>vh-M) top=br.top-pr.height-6;   // flip above when no room below
    if(top<M) top=M;
    pop.style.position='fixed'; pop.style.left=left+'px'; pop.style.top=top+'px'; pop.style.right='auto';
  }catch(e){ /* positioning is best-effort; CSS fallback still shows it */ }
}
if(document && document.addEventListener){
  document.addEventListener('click', e=>{
    const t=e.target;
    if(t && t.closest && t.closest('.pace-info-wrap')) return;
    closeWeekFilterPacePops();
  });
  // The popover is viewport-fixed, so close it on scroll to avoid it detaching from its button.
  if(typeof window!=='undefined' && window.addEventListener) window.addEventListener('scroll', closeWeekFilterPacePops, true);
}
// 17-game pace helper shown beside a player's name when a historical week window is active.
// Scale from GAMES PLAYED in the filtered sample, not week span, so missed games/injuries are
// represented realistically. Returns '' when no filtered sample is available.
function weekFilterPaceText(state, pid, mode){
  if(activeSeason==='proj' || !state || !isWeekFilterActive(state) || !pid) return '';
  const src = (mode==='qb') ? (state.weekFilterQBData && state.weekFilterQBData[pid])
                            : (state.weekFilterData && state.weekFilterData[pid]);
  if(!src || !src.games_played) return '';
  const [lo,hi]=state.weekFilter||[1,18];
  const gp=src.games_played;
  const scale=v=>Math.round((v||0)/gp*SEASON_GAMES);
  let parts=[];
  if(mode==='qb'){
    parts=[`${scale(src.pass_yards).toLocaleString()} pass yds`, `${scale(src.pass_td)} pass TD`, `${scale(src.pass_att)} att`,
           `${scale(src.rush_att)} rush att`, `${scale(src.rush_yards)} rush yds`, `${scale(src.rush_td)} rush TD`];
  } else if(mode==='rush'){
    parts=[`${scale(src.rushing_attempts)} att`, `${scale(src.rushing_yards).toLocaleString()} rush yds`, `${scale(src.rushing_tds)} rush TD`];
  } else {
    parts=[`${scale(src.receiving_targets)} tgt`, `${scale(src.receptions)} rec`, `${scale(src.receiving_yards).toLocaleString()} rec yds`, `${scale(src.receiving_tds)} rec TD`];
  }
  return `17-game pace from weeks ${lo}-${hi} (${gp} game${gp===1?'':'s'}): ${parts.join(' · ')}`;
}
function weekFilterPaceButton(state, pid, mode){
  const text = weekFilterPaceText(state, pid, mode);
  if(!text) return '';
  return `<span class="pace-info-wrap"><button class="pace-info-btn" onclick="toggleWeekFilterPace(this, ${pcardArg(text)})" aria-label="Show 17-game pace">i</button></span>`;
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
    const [skillData, qbPool, qbData] = await Promise.all([
      buildWeekFilterData(team, activeSeason, fromWk, toWk),
      buildWeekFilterQBPool(team, activeSeason, fromWk, toWk),
      buildWeekFilterQBData(team, activeSeason, fromWk, toWk),
    ]);
    state.weekFilterData=skillData;
    state.weekFilterQBPool=qbPool;
    state.weekFilterQBData=qbData;
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
  state.weekFilter=null; state.weekFilterData=null; state.weekFilterQBPool=null; state.weekFilterQBData=null;
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

