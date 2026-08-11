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

// Shared week-range state across ALL week sliders (QB/RB/WR and Advanced OL).
// Keyed by season+team so every surface in that team/season stays synchronized.
let _sharedWeekRangeByTeam = {};  // `${season}:${TEAM}` -> [lo,hi]
function _sharedWeekRangeKey(team, season){
  return `${String(season||activeSeason)}:${String(team||'').toUpperCase()}`;
}
function getSharedWeekRange(team, season){
  const key=_sharedWeekRangeKey(team, season);
  return _sharedWeekRangeByTeam[key] || [1,18];
}
function setSharedWeekRange(team, season, lo, hi){
  const key=_sharedWeekRangeKey(team, season);
  const a=Math.max(1, Math.min(18, Number(lo)||1));
  const b=Math.max(1, Math.min(18, Number(hi)||18));
  _sharedWeekRangeByTeam[key] = [Math.min(a,b), Math.max(a,b)];
  return _sharedWeekRangeByTeam[key];
}

// ── Weekly schedule lookup for slider opponent rails ───────────────────────
// Runtime-only (no seed change): fetch nflverse schedule CSV once per season and build
// team -> week -> {opp, home} so sliders can show @/vs + opponent logo chips.
const WEEKLY_SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const _SCHED_TEAM_FIX = {LA:'LAR', OAK:'LV', SD:'LAC', STL:'LAR'};
let _weeklyOppBySeason = {};      // season -> { TEAM -> { week -> {opp, home} } }
let _weeklyOppPromise = {};       // season -> Promise<boolean>

function _schedTeamCode(code){
  const t=String(code||'').toUpperCase();
  return _SCHED_TEAM_FIX[t] || t;
}
function _csvRow(line){
  const out=[];
  let cur='';
  let q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(q && line[i+1]==='"'){ cur+='"'; i++; }
      else q=!q;
      continue;
    }
    if(ch===',' && !q){ out.push(cur); cur=''; continue; }
    cur+=ch;
  }
  out.push(cur);
  return out;
}
async function ensureWeeklyOppSchedule(season){
  const s=String(season||'');
  if(!/^\d{4}$/.test(s)) return false;
  if(_weeklyOppBySeason[s]) return true;
  if(_weeklyOppPromise[s]) return _weeklyOppPromise[s];
  _weeklyOppPromise[s] = (async()=>{
    try{
      const r = await fetch(WEEKLY_SCHEDULE_URL, {cache:'force-cache'});
      if(!r.ok) return false;
      const txt = await r.text();
      const lines = txt.split(/\r?\n/).filter(Boolean);
      if(!lines.length) return false;
      const hdr = _csvRow(lines[0]);
      const ix={}; hdr.forEach((h,i)=>{ ix[h]=i; });
      const need=['season','game_type','week','home_team','away_team'];
      if(need.some(k=>ix[k]==null)) return false;

      const map={};
      for(let i=1;i<lines.length;i++){
        const row=_csvRow(lines[i]);
        if(String(row[ix.season])!==s) continue;
        if(String(row[ix.game_type]||'').toUpperCase()!=='REG') continue;
        const wk=parseInt(row[ix.week],10);
        if(!Number.isFinite(wk) || wk<1 || wk>18) continue;
        const home=_schedTeamCode(row[ix.home_team]);
        const away=_schedTeamCode(row[ix.away_team]);
        if(!home || !away) continue;
        (map[home]=map[home]||{})[wk]={opp:away, home:true};
        (map[away]=map[away]||{})[wk]={opp:home, home:false};
      }
      _weeklyOppBySeason[s]=map;
      if(typeof renderContent==='function') renderContent();
      return true;
    }catch(e){
      return false;
    }
  })();
  return _weeklyOppPromise[s];
}
function weekOpponentMap(team, season){
  const s=String(season||'');
  const tm=String(team||'').toUpperCase();
  const byS=_weeklyOppBySeason[s];
  return (byS && byS[tm]) ? byS[tm] : null;
}
function renderWeekOpponentRail(team, season, className=''){ 
  const s=String(season||'');
  if(!/^\d{4}$/.test(s)) return '';
  const tm=String(team||'').toUpperCase();
  const byWeek=weekOpponentMap(tm, s);
  if(!byWeek){
    ensureWeeklyOppSchedule(s);
    return `<div class="wr-opp-rail ${className}"><div class="wr-opp-loading">Loading weekly opponents…</div></div>`;
  }
  const cells=[];
  for(let wk=1; wk<=18; wk++){
    const m=byWeek[wk];
    const ratio=((wk-1)/17).toFixed(6);
    const pos=`calc(var(--wr-pad, 0px) + (100% - (2 * var(--wr-pad, 0px))) * ${ratio})`;
    const laneCls = (wk%2===0) ? ' wr-opp-top' : ' wr-opp-bottom';
    if(!m || !m.opp){
      cells.push(`<div class="wr-opp-cell wr-opp-bye${laneCls}" style="left:${pos}" title="Week ${wk}: bye"><span class="wr-opp-stem"></span>—</div>`);
      continue;
    }
    const opp=String(m.opp).toUpperCase();
    const logo=(typeof NFL_LOGO==='function') ? NFL_LOGO(opp) : '';
    const ha=m.home?'vs':'@';
    cells.push(`<div class="wr-opp-cell${laneCls}" style="left:${pos}" title="Week ${wk}: ${ha} ${opp}">
      <span class="wr-opp-stem"></span>
      ${logo?`<img src="${logo}" class="wr-opp-logo" alt="${opp}" onerror="this.style.display='none'">`:`<span class="wr-opp-fallback">${opp}</span>`}
    </div>`);
  }
  return `<div class="wr-opp-rail ${className}">${cells.join('')}</div>`;
}

function renderWeekNumberRail(className=''){
  const cells=[];
  for(let wk=1; wk<=18; wk++){
    const ratio=((wk-1)/17).toFixed(6);
    const pos=`calc(var(--wr-pad, 0px) + (100% - (2 * var(--wr-pad, 0px))) * ${ratio})`;
    const laneCls = (wk%2===0) ? ' wr-week-top' : ' wr-week-bottom';
    cells.push(`<div class="wr-week-cell${laneCls}" style="left:${pos}" title="Week ${wk}">
      <span class="wr-week-stem"></span>
      <span class="wr-week-num">${wk}</span>
    </div>`);
  }
  return `<div class="wr-week-rail ${className}">${cells.join('')}</div>`;
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

// HTML text-node escaping (safe for generic innerHTML interpolation in text content).
function escHtml(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// Escape for JS single-quoted string literals used inside inline event attributes.
function escJsSingle(s){
  return String(s==null?'':s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/\r/g,'\\r')
    .replace(/\n/g,'\\n')
    .replace(/\u2028/g,'\\u2028')
    .replace(/\u2029/g,'\\u2029');
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
// Compute per-game FPTS for a player entry from passing_shares / rushing.shares.
// Uses the baseline_* values which already reflect the active week-range window
// (initPassingShares/initRushingShares rebuild from filtered data when active).
// Excludes games where the player didn't play via p.games_played.
function sidebarFptsPerGame(p, mode){
  if(activeSeason==='proj' || typeof scoringSettings==='undefined') return null;
  const gp = p.games_played || 0;
  if(gp <= 0) return null;
  const sc = scoringSettings;
  let fpts = 0;
  if(mode==='rec'){
    fpts += (p.baseline_rec||0) * (sc.receptions||0);
    fpts += (p.baseline_yards||0) / (sc.receiving_yards_yardage||10);
    fpts += (p.baseline_tds||0) * (sc.receiving_touchdowns||6);
  } else if(mode==='rush'){
    fpts += (p.baseline_yards||0) / (sc.rushing_yards_yardage||10);
    fpts += (p.baseline_tds||0) * (sc.rushing_touchdowns||6);
  }
  return fpts / gp;
}
function sidebarFptsTag(p, mode){
  const v = sidebarFptsPerGame(p, mode);
  if(v==null) return '';
  return `<span class="share-fptsg">${v.toFixed(1)} <span class="share-fptsg-label">pts/g</span></span>`;
}
function qbFptsPerGame(qb){
  if(activeSeason==='proj' || typeof scoringSettings==='undefined') return null;
  const gp = qb.games_played || 0;
  if(gp <= 0) return null;
  const sc = scoringSettings;
  let fpts = 0;
  fpts += (qb.passing_yards||0) / (sc.passing_yards_yardage||25);
  fpts += (qb.passing_tds||0) * (sc.passing_touchdowns||4);
  fpts += (qb.interceptions_thrown||0) * (sc.interceptions_thrown||-2);
  fpts += (qb.qb_rush_yards||0) / (sc.rushing_yards_yardage||10);
  fpts += (qb.qb_rush_tds||0) * (sc.rushing_touchdowns||6);
  return fpts / gp;
}
function qbFptsTag(qb){
  const v = qbFptsPerGame(qb);
  if(v==null) return '';
  return `<span class="share-fptsg">${v.toFixed(1)} <span class="share-fptsg-label">pts/g</span></span>`;
}

function weekFilterPaceButton(state, pid, mode){
  const text = weekFilterPaceText(state, pid, mode);
  if(!text) return '';
  const target = noteTargetFromArgs(pid, '', currentTeam||'');
  return `<span class="pace-info-wrap"${noteTagAttrs({ label:'17-game pace', value:text, source:'week_range_pace', statKey:'pace', context:historicalTagContext(`${activeSeason} week range`, target&&target.team, activeSeason), player:target, team:target&&target.team })}><button class="pace-info-btn" onclick="toggleWeekFilterPace(this, ${pcardArg(text)})" aria-label="Show 17-game pace">i</button></span>`;
}

function isWeekFilterActive(state){
  return !!(state.weekFilter && (state.weekFilter[0]>1 || state.weekFilter[1]<18));
}

function noteWeekRangeSuffix(team, season){
  const s = String(season==null ? activeSeason : season);
  if(s==='proj') return '';
  const tm = String(team||currentTeam||'').toUpperCase();
  let range = (typeof getSharedWeekRange==='function') ? getSharedWeekRange(tm, s) : null;
  const localRange = (s===String(activeSeason) && userProj && userProj[tm] && Array.isArray(userProj[tm].weekFilter))
    ? userProj[tm].weekFilter
    : null;
  const sharedFullSeason = Array.isArray(range) && range.length>=2
    && (parseInt(range[0], 10) || 1)===1 && (parseInt(range[1], 10) || 18)===18;
  const localFiltered = Array.isArray(localRange) && localRange.length>=2
    && ((parseInt(localRange[0], 10) || 1)>1 || (parseInt(localRange[1], 10) || 18)<18);
  if((!Array.isArray(range) || range.length<2 || (sharedFullSeason && localFiltered)) && localRange){
    range = localRange;
  }
  if(!Array.isArray(range) || range.length<2) return '';
  const lo = Math.max(1, parseInt(range[0], 10) || 1);
  const hi = Math.max(lo, Math.min(18, parseInt(range[1], 10) || 18));
  if(lo===1 && hi===18) return '';
  return ` · weeks ${lo}-${hi}`;
}

function historicalTagContext(base, team, season){
  return `${String(base||'').trim()}${noteWeekRangeSuffix(team, season)}`;
}

// Kick off a week-range fetch+recompute+rerender. Called when the slider is released.
async function applyWeekRange(team, fromWk, toWk){
  const state=userProj[team]; if(!state) return;
  setSharedWeekRange(team, activeSeason, fromWk, toWk);
  state.weekFilter=[fromWk,toWk];
  state.weekFilterLoading=true;
  renderContent();
  try{
    const [skillData, qbPool, qbData] = await Promise.all([
      buildWeekFilterData(team, activeSeason, fromWk, toWk),
      buildWeekFilterQBPool(team, activeSeason, fromWk, toWk),
      buildWeekFilterQBData(team, activeSeason, fromWk, toWk),
    ]);
    // If all player fetches were blocked (CORS / offline), skillData will be empty.
    // Detect this and show a clear message rather than silently leaving stats unchanged.
    const hasData = skillData && Object.keys(skillData).length > 0;
    if(!hasData){
      state.weekFilterLoading=false;
      state.weekFilter=null;
      setSharedWeekRange(team, activeSeason, 1, 18);
      toast('Weekly data unavailable — open the app from a web server or GitHub Pages to use the week-range filter','err');
      renderContent();
      return;
    }
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
  setSharedWeekRange(team, activeSeason, 1, 18);
  state.weekFilter=null; state.weekFilterData=null; state.weekFilterQBPool=null; state.weekFilterQBData=null;
  state.passing_shares=null; state.rushing.shares=null;
  initPassingShares(team); initRushingShares(team);
  renderContent();
}
// Live label update while dragging (cheap — no fetch until release).
function weekRangeDrag(team, which, val){
  const state=userProj[team]; if(!state) return;
  const cur = getSharedWeekRange(team, activeSeason);
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
  setSharedWeekRange(team, activeSeason, lo, hi);
  applyWeekRange(team, lo, hi);
}
const TEAMS = ['CIN','PIT','BAL','CLE','HOU','JAX','TEN','IND','BUF','NE',
  'MIA','NYJ','KC','LAC','LV','DEN','GB','DET','MIN','CHI','TB','CAR',
  'ATL','NO','PHI','DAL','WAS','NYG','LAR','SF','SEA','ARI'];
const PCOLORS = ['#4a9eff','#00d4aa','#ff6b35','#c084fc','#fbbf24','#f472b6',
  '#34d399','#a78bfa','#fb923c','#60a5fa','#e879f9','#38bdf8','#f97316','#86efac'];
const SEASON_GAMES = 17;
const TARGET_RATE = 0.95; // targets ≈ pass attempts × this
let PROJ_SEASON = Number((typeof SEED_SEASON!=='undefined') ? SEED_SEASON : new Date().getFullYear());
if(!Number.isFinite(PROJ_SEASON)) PROJ_SEASON = new Date().getFullYear();
const _tcScenarioName = document.getElementById('scenarioName');
if(_tcScenarioName) _tcScenarioName.value = PROJ_SEASON + ' Projections';

function _tcApplyProjSeason(nextSeason){
  const next = Number(nextSeason);
  if(!Number.isFinite(next) || next<2000 || next>2100) return PROJ_SEASON;
  const prev = PROJ_SEASON;
  if(next===prev) return PROJ_SEASON;
  PROJ_SEASON = next;
  const nameEl = document.getElementById('scenarioName');
  if(nameEl){
    const prevDefault = `${prev} Projections`;
    if(!nameEl.value || nameEl.value===prevDefault) nameEl.value = `${PROJ_SEASON} Projections`;
  }
  if(typeof SHARP_SEASON!=='undefined'){
    const prevSharp = Number(prev)-1;
    if(!Number.isFinite(Number(SHARP_SEASON)) || Number(SHARP_SEASON)===prevSharp){
      SHARP_SEASON = PROJ_SEASON-1;
    }
  }
  return PROJ_SEASON;
}

async function syncProjSeasonFromSleeper(){
  if(typeof SLEEPER_STATE_URL==='undefined' || !SLEEPER_STATE_URL) return PROJ_SEASON;
  try{
    const ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(()=>ctrl.abort(), 5000) : null;
    const res = await fetch(SLEEPER_STATE_URL, {cache:'no-store', signal: ctrl?ctrl.signal:undefined});
    if(timer) clearTimeout(timer);
    if(!res || !res.ok) return PROJ_SEASON;
    const s = await res.json();
    const y = Number((s && (s.league_season || s.season)) || NaN);
    if(Number.isFinite(y)) _tcApplyProjSeason(y);
  }catch(e){ /* keep existing projection season fallback */ }
  return PROJ_SEASON;
}

function hsPack(p){
  if(!p) return {src:'', fallbacks:[]};
  const add=(arr,u)=>{ const s=String(u||'').trim(); if(s && !arr.includes(s)) arr.push(s); };
  const urls=[];
  const rawPos=String(p.pos||'').toUpperCase();
  const isOl=/^(LT|LG|C|RG|RT|OL|G|T|OT|OG)$/.test(rawPos);

  let rid = p.player_id ? String(p.player_id) : '';
  if(!rid && typeof resolvePlayerId==='function'){
    rid = resolvePlayerId(p.name, p.pos) || '';
    if(!rid && isOl) rid = resolvePlayerId(p.name, 'OL') || resolvePlayerId(p.name) || '';
    if(!rid) rid = resolvePlayerId(p.name) || '';
    if(rid) p.player_id=rid;
  }

  // Team/depth and explicit payload headshots are usually the most reliable for OL.
  if(isOl && p.team && typeof _olDepthHeadshot==='function') add(urls, _olDepthHeadshot(String(p.team).toUpperCase(), p.name));
  add(urls, p.headshot);

  // ESPN headshots (when we can resolve an athlete id) are a reliable fallback for missing/403 Sleeper images.
  if(rid && typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[rid] && sleeperPlayers[rid].espn_id && typeof ESPN_HEADSHOT==='function'){
    const aid=String(sleeperPlayers[rid].espn_id||'');
    if(aid){
      if(isOl){
        add(urls, ESPN_HEADSHOT('nfl', aid));
        add(urls, ESPN_HEADSHOT('college-football', aid));
      }
    }
  }

  // Sleeper remains the primary source for non-OL players.
  if(rid && typeof SLEEPER_HEADSHOT==='function') add(urls, SLEEPER_HEADSHOT(rid));

  if(rid && typeof sleeperPlayers!=='undefined' && sleeperPlayers && sleeperPlayers[rid] && sleeperPlayers[rid].espn_id && typeof ESPN_HEADSHOT==='function'){
    const aid=String(sleeperPlayers[rid].espn_id||'');
    if(aid){
      if(!isOl){
        add(urls, ESPN_HEADSHOT('nfl', aid));
        add(urls, ESPN_HEADSHOT('college-football', aid));
      }else if(!urls.length){
        add(urls, ESPN_HEADSHOT('nfl', aid));
        add(urls, ESPN_HEADSHOT('college-football', aid));
      }
    }
  }

  return {src:urls[0]||'', fallbacks:urls.slice(1)};
}
function hsURL(p){
  return hsPack(p).src || '';
}
// loading="lazy" is the single biggest win on the rankings page: it renders ~570 rows with
// two images each (headshot + team logo), so eager loading fired >1,100 image fetches the
// moment the table mounted — most for rows far below the fold. The browser now fetches them
// as they approach the viewport. decoding="async" keeps decode work off the main thread so
// it can't block the first paint.
function imgTag(src,cls,fb=''){
  let fallbacks=[];
  if(src && typeof src==='object'){ fallbacks=Array.isArray(src.fallbacks)?src.fallbacks:[]; src=src.src||''; }
  if(!src) return `<div class="${cls} ph-err">${fb}</div>`;
  const fbList=fallbacks.filter(Boolean).join('|');
  const onerr = `const l=(this.dataset.fallbacks||'').split('|').filter(Boolean);if(l.length){this.dataset.fallbacks=l.slice(1).join('|');this.src=l[0];}else{this.outerHTML='<div class=\\'${cls} ph-err\\'>${fb}</div>';}`;
  return `<img src="${src}" class="${cls}" alt="" data-fallbacks="${fbList}" loading="lazy" decoding="async" onerror="${onerr}">`;
}
function imgSm(src,cls='share-hs',fb=''){
  let fallbacks=[];
  if(src && typeof src==='object'){ fallbacks=Array.isArray(src.fallbacks)?src.fallbacks:[]; src=src.src||''; }
  if(!src) return `<div class="${cls}-err">${fb}</div>`.replace(cls+'-err',cls.replace('share-hs','share-hs')+'-err');
  const fbList=fallbacks.filter(Boolean).join('|');
  const onerr = `const l=(this.dataset.fallbacks||'').split('|').filter(Boolean);if(l.length){this.dataset.fallbacks=l.slice(1).join('|');this.src=l[0];}else{this.outerHTML='<div class=\\'share-hs-err\\'>${fb}</div>';}`;
  return `<img src="${src}" class="${cls}" alt="" data-fallbacks="${fbList}" onerror="${onerr}">`;
}

