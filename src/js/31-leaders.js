// ═════════════════════════════════════════════════════════════════════════════
// Leaders — the right-hand sidebar (desktop): this week's top fantasy finishes
// ═════════════════════════════════════════════════════════════════════════════
// The mirror of the team picker on the other side of the screen: every player ranked by
// fantasy points under the loaded scoring (the synced league's), straight from Sleeper's
// week stats — the current week by default, any week or the season to date from a small
// dropdown, a position filter like the rankings page (QB / RB / WR / TE / Rookie). Each row:
// headshot, a shortened name, the points in bold. Desktop only; in season only. The week
// in progress re-reads on the same cadence as the Live view (fetchWeekStats' 45s TTL).
var _ld = { week:'current', pos:'ALL', rows:null, key:'', busy:false, timer:null, at:0, sort:'pts' };
const LD_POS = ['ALL','QB','RB','WR','TE','ROOKIE'];
const LD_TOP = 40;
// ── The list grows with the sidebar ─────────────────────────────────────────
// Drag the sidebar out and the line fills in: past LD_FULL_W the names go from "C. Williams"
// to "Caleb Williams"; every LD_COL_W beyond that adds one of the position's own stat
// columns, in this order, and any column header sorts the list by it (PTS brings it back).
const LD_FULL_W = 280, LD_COL_W = 64;
const LD_COLS = {
  QB:  [['pass_yd','PASS YD'],['pass_td','PASS TD'],['pass_int','INT'],['cmp_att','CMP/ATT'],['rush_yd','RUSH YD'],['rush_td','RUSH TD']],
  RB:  [['rush_att','ATT'],['rush_yd','RUSH YD'],['rush_td','RUSH TD'],['rec','REC'],['rec_yd','REC YD'],['rec_td','REC TD'],['rec_tgt','TGT']],
  WR:  [['rec_tgt','TGT'],['rec','REC'],['rec_yd','REC YD'],['rec_td','REC TD'],['rush_yd','RUSH YD']],
  TE:  [['rec_tgt','TGT'],['rec','REC'],['rec_yd','REC YD'],['rec_td','REC TD'],['rush_yd','RUSH YD']],
  ALL: [['tot_yd','TOT YD'],['tot_td','TOT TD'],['pass_yd','PASS YD'],['rush_yd','RUSH YD'],['rec','REC'],['rec_yd','REC YD']],
};
function ldStat(r, k){
  const s=(r&&r.stats)||{};
  const g=(a,b)=>{ const v=s[a]!=null?s[a]:s[b]; return Number(v)||0; };
  switch(k){
    case 'pass_yd': return g('pass_yd','passing_yards');
    case 'pass_td': return g('pass_td','passing_touchdowns');
    case 'pass_int': return g('pass_int','interceptions_thrown');
    case 'cmp_att': return g('pass_cmp','passing_completions');
    case 'rush_att': return g('rush_att','rushing_attempts');
    case 'rush_yd': return g('rush_yd','rushing_yards');
    case 'rush_td': return g('rush_td','rushing_touchdowns');
    case 'rec': return g('rec','receptions');
    case 'rec_yd': return g('rec_yd','receiving_yards');
    case 'rec_td': return g('rec_td','receiving_touchdowns');
    case 'rec_tgt': return g('rec_tgt','receiving_targets');
    case 'tot_yd': return ldStat(r,'pass_yd')+ldStat(r,'rush_yd')+ldStat(r,'rec_yd');
    case 'tot_td': return ldStat(r,'pass_td')+ldStat(r,'rush_td')+ldStat(r,'rec_td');
    default: return 0;
  }
}
function ldStatText(r, k){
  if(k==='cmp_att'){ const s=r.stats||{}; const att=Number(s.pass_att!=null?s.pass_att:s.passing_attempts)||0; return `${ldStat(r,'cmp_att')}/${att}`; }
  const v=ldStat(r,k); return Number.isInteger(v)?String(v):v.toFixed(1);
}
// The sidebar's width as rendered (an inline width while it is being dragged, its CSS width otherwise).
function ldWidth(el){
  if(!el) return 200;
  const cw=el.clientWidth||(el.getBoundingClientRect?el.getBoundingClientRect().width:0);
  if(cw>0) return cw;
  const sw=parseFloat(el.style&&el.style.width); return sw>0?sw:200;
}
function ldColsFor(width){
  const spec=LD_COLS[_ld.pos==='ROOKIE'?'ALL':_ld.pos]||LD_COLS.ALL;
  const n=Math.max(0, Math.floor((width-LD_FULL_W)/LD_COL_W));
  return spec.slice(0, Math.min(spec.length, n));
}
function ldSort(k){ _ld.sort=(k && k!=='pts' && _ld.sort!==k) ? k : 'pts'; renderLeaders(true); }

function ldOn(){
  return typeof hasSeasonStarted==='function' && hasSeasonStarted()
    && typeof TC_SEASON!=='undefined' && TC_SEASON.week>=1
    && !(typeof isMobileTeamPickerLayout==='function' && isMobileTeamPickerLayout());
}
function ldWeek(){ return (_ld.week==='current'||_ld.week==='season') ? Math.max(1, Number(TC_SEASON.week||1)) : _ld.week; }
function ldHost(){
  let el=document.getElementById('leaders');
  if(!el){
    const main=document.querySelector('.main'); if(!main) return null;
    el=document.createElement('div'); el.id='leaders'; el.className='sidebar leaders';
    main.appendChild(el);
  }
  return el;
}
function ldSetWeek(v){ _ld.week = v==='season' ? 'season' : v==='current' ? 'current' : Number(v); _ld.rows=null; renderLeaders(); }
function ldSetPos(p){ _ld.pos=p; renderLeaders(); }
function ldShortName(name){
  if(typeof abbrevName==='function') return abbrevName(name||'');
  const parts=String(name||'').trim().split(/\s+/); if(parts.length<2) return name||'';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}
// Fantasy points under the loaded scoring for one Sleeper record. The record's stats carry
// Sleeper's names (pass_td, rush_td…) plus the app's long names for yards/attempts; calcFpts
// wants the projection row's names, so the touchdown and fumble fields are spelled out here.
function ldPoints(rec){
  const s=rec.stats||{};
  const row={ pos:rec.pos,
    passing_yards:s.passing_yards||s.pass_yd||0, passing_tds:s.pass_td||s.passing_touchdowns||0, interceptions_thrown:s.interceptions_thrown||s.pass_int||0,
    passing_attempts:s.passing_attempts||s.pass_att||0, passing_completions:s.passing_completions||s.pass_cmp||0,
    rushing_yards:s.rushing_yards||s.rush_yd||0, rushing_tds:s.rush_td||s.rushing_touchdowns||0, rushing_attempts:s.rushing_attempts||s.rush_att||0,
    receptions:s.receptions||s.rec||0, receiving_yards:s.receiving_yards||s.rec_yd||0, receiving_tds:s.rec_td||s.receiving_touchdowns||0,
    receiving_targets:s.receiving_targets||s.rec_tgt||0, fumbles_lost:s.fumbles_lost||s.fum_lost||0 };
  try{ return (typeof calcFpts==='function') ? Number(calcFpts(row)||0) : 0; }catch(e){ return 0; }
}
function ldRookie(pid){
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers[String(pid)] : null;
  return !!(sp && Number(sp.years_exp)===0);
}
// Pull the rows for the picked window (cached per window; the current week re-reads via the
// week cache's own live TTL), then re-render when they land.
async function ldLoad(){
  const season=String(TC_SEASON.year), wk=ldWeek();
  const key=`${season}|${_ld.week==='season'?'season':wk}`;
  if(_ld.busy) return;
  _ld.busy=true;
  try{
    let rows=null;
    if(_ld.week==='season'){
      rows = (typeof liveSeasonRowsThroughWeek==='function') ? await liveSeasonRowsThroughWeek(season, wk, {optional:[wk]}) : null;
    } else if(typeof fetchWeekStats==='function'){
      const parts = await Promise.all(['QB','RB','WR','TE'].map(pos=>fetchWeekStats(season, wk, pos).catch(()=>null)));
      rows = [].concat(...parts.map(p=>Array.isArray(p)?p:[]));
    }
    if(rows && rows.length){
      _ld.rows=(typeof liveSeasonRecordsFromRows==='function') ? liveSeasonRecordsFromRows(rows) : [];
      _ld.key=key; _ld.at=Date.now();
    } else if(rows && !rows.length){ _ld.rows=[]; _ld.key=key; _ld.at=Date.now(); }
  }catch(e){ /* offline — keep what we have */ }
  finally{ _ld.busy=false; }
  // The rows landed: paint them — unless the sidebar has since grown into the Game Center
  // or shrunk to the rail, which this paint must not overwrite.
  if(typeof _gc!=='undefined' && _gc && _gc.mode && _gc.mode!=='normal') return;
  renderLeaders(true);
}
function ldRowsHTML(width){
  const recs=_ld.rows||[];
  const pos=_ld.pos;
  width=width||200;
  const cols=ldColsFor(width), full=width>=LD_FULL_W;
  const sortKey=(_ld.sort!=='pts' && cols.some(c=>c[0]===_ld.sort)) ? _ld.sort : 'pts';
  const list=recs.filter(r=> pos==='ALL' ? true : pos==='ROOKIE' ? ldRookie(r.pid) : r.pos===pos)
    .map(r=>({r, pts:ldPoints(r)})).filter(x=>x.pts>0)
    .sort((a,b)=> sortKey==='pts' ? (b.pts-a.pts) : ((ldStat(b.r,sortKey)-ldStat(a.r,sortKey)) || (b.pts-a.pts)))
    .slice(0, LD_TOP);
  if(!list.length) return `<div class="ld-empty">${_ld.rows?'nothing yet this week':'loading…'}</div>`;
  const bafl=(typeof scoringSettings!=='undefined' && scoringSettings.baflMode);
  const head = cols.length ? `<div class="ld-row ld-hdr"><span class="ld-rank"></span><span class="ld-hs-sp"></span><span class="ld-name">Player</span>
    ${cols.map(c=>`<button class="ld-col ld-colh ${sortKey===c[0]?'active':''}" onclick="event.stopPropagation();ldSort('${c[0]}')" title="Sort by ${escAttr(c[1])}">${escHtml(c[1])}</button>`).join('')}
    <button class="ld-pts ld-colh ${sortKey==='pts'?'active':''}" onclick="event.stopPropagation();ldSort('pts')" title="Sort by points">PTS</button></div>` : '';
  return head + list.map((x,i)=>`<div class="ld-row" onclick="${pcardOnclick(x.r.pid, x.r.pos, x.r.team||'')}" title="${escAttr(`${x.r.name} · ${x.r.pos} · ${x.r.team||'FA'}`)}">
    <span class="ld-rank">${i+1}</span>
    <img class="ld-hs" src="${SLEEPER_HEADSHOT(x.r.pid)}" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
    <span class="ld-name"><span class="ld-nm${(typeof gcIsMine==='function' && gcIsMine(x.r.pid))?' ld-mine':''}">${escHtml(full?x.r.name:ldShortName(x.r.name))}</span><span class="ld-sub"><span class="la-pos-${escAttr(x.r.pos)}">${escHtml(x.r.pos)}</span> ${escHtml(x.r.team||'FA')}</span></span>
    ${cols.map(c=>`<span class="ld-col ${sortKey===c[0]?'active':''}">${escHtml(ldStatText(x.r, c[0]))}</span>`).join('')}
    <b class="ld-pts">${bafl?x.pts.toFixed(1):x.pts.toFixed(2)}</b>
  </div>`).join('');
}
function renderLeaders(fromLoad){
  const el=ldHost(); if(!el) return;
  if(!ldOn()){ el.hidden=true; if(_ld.timer){ clearTimeout(_ld.timer); _ld.timer=null; } return; }
  el.hidden=false;
  const season=String(TC_SEASON.year), cur=Math.max(1, Number(TC_SEASON.week||1)), wk=ldWeek();
  const key=`${season}|${_ld.week==='season'?'season':wk}`;
  const stale = _ld.key!==key || !_ld.rows || (_ld.week!=='season' && wk===cur && Date.now()-_ld.at>60*1000);
  if(stale && !fromLoad) ldLoad();
  const weeks=Array.from({length:cur},(_,i)=>cur-i);
  const sel=`<select class="ld-sel" onchange="ldSetWeek(this.value)" title="Which week">
    ${weeks.map(w=>`<option value="${w===cur?'current':w}" ${(_ld.week==='current'&&w===cur)||_ld.week===w?'selected':''}>Week ${w}${w===cur?' · now':''}</option>`).join('')}
    <option value="season" ${_ld.week==='season'?'selected':''}>Season</option></select>`;
  const posBtns=LD_POS.map(p=>`<button class="ld-pos ${_ld.pos===p?'active':''}" onclick="ldSetPos('${p}')">${p==='ROOKIE'?'RK':p}</button>`).join('');
  const fmt=(typeof scoringSettings!=='undefined' && scoringSettings.baflMode) ? 'BAFL lens' : ((typeof leagueSnapshot!=='undefined' && leagueSnapshot && leagueSnapshot.name) ? escHtml(leagueSnapshot.name) : 'loaded scoring');
  const btns=(typeof rsbButtonsHTML==='function')?rsbButtonsHTML():'';
  el.innerHTML=`<div class="ld-head"><div class="sidebar-section ld-title">Leaders</div>${sel}</div>
    <div class="ld-posrow">${posBtns}</div>
    <div class="ld-fmt"><span title="Points under the loaded scoring">${fmt}${_ld.week!=='season'&&wk===cur?' · live':''}</span>${btns}</div>
    <div class="ld-list">${ldRowsHTML(ldWidth(el))}</div>`;
  // The week in progress keeps up: a re-render a minute from now re-reads it.
  if(_ld.timer){ clearTimeout(_ld.timer); _ld.timer=null; }
  if(_ld.week!=='season' && wk===cur && typeof window!=='undefined' && typeof window.setTimeout==='function'
     && (typeof document==='undefined' || document.visibilityState!=='hidden')){
    _ld.timer=window.setTimeout(()=>{ _ld.timer=null; (typeof renderRightSidebar==='function'?renderRightSidebar:renderLeaders)(); }, 61*1000);
  }
}
