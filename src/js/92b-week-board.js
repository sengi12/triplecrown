// ═════════════════════════════════════════════════════════════════════════════
// This week's board — game state + record for every team, from ONE request
// ═════════════════════════════════════════════════════════════════════════════
// ESPN's scoreboard for the current week carries, per game, both sides' overall record and
// the game's state (pre / in / post) with its clock. In the Live view that feeds two things:
// a dot on each team's logo in the sidebar (played · playing) and the big record in the team
// header — without 32 per-team record fetches. Refreshes on its own while a game is on.
var _tcBoard = { season:null, week:null, at:0, teams:{}, busy:false, live:false };
// Weeks 1-18 are the regular season (ESPN season type 2); 19-22 are the playoff rounds
// (type 3: Wild Card 1, Divisional 2, Conference Championship 3, Super Bowl 5 — 4 is the
// Pro Bowl), the same 19-22 the tracker and its week picker use everywhere.
const TC_PLAYOFF_WEEKS = { 19:['Wild Card',1], 20:['Divisional',2], 21:['Conf. Championship',3], 22:['Super Bowl',5] };
function tcEspnWeek(week){ const w=Number(week); return TC_PLAYOFF_WEEKS[w] ? {type:3, week:TC_PLAYOFF_WEEKS[w][1]} : {type:2, week:w}; }
function tcWeekLabel(week){ const w=Number(week); return TC_PLAYOFF_WEEKS[w] ? TC_PLAYOFF_WEEKS[w][0] : `Week ${w}`; }
// TC_LAST_WEEK (22, the Super Bowl) is declared in 15-session-globals.js: boot renders the
// season tabs from 85-import-export.js, before this file has run, and a `const` read before
// its line throws — every page load used to die inside boot right there.
const TC_BOARD_URL = (season, week)=>{ const e=tcEspnWeek(week); return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${e.type}&week=${e.week}&dates=${season}`; };
const TC_BOARD_ABBR = { WSH:'WAS' };          // ESPN spells one club differently
const TC_BOARD_TTL_LIVE = 4*1000, TC_BOARD_TTL_IDLE = 5*60*1000;   // live: the Game Center's poll re-reads it every 5 s (one small request)

function tcBoardWeek(){
  // The tracker's week: the finished week holds through Tuesday and until Wednesday morning
  // (tcTrackerWeek), so the dots and records keep showing the week just played.
  const w=(typeof tcTrackerWeek==='function') ? tcTrackerWeek() : ((typeof TC_SEASON!=='undefined')?Number(TC_SEASON.week||0):0);
  return Math.min(TC_LAST_WEEK, Math.max(1, w||1));
}
// Parse one scoreboard payload → {CODE: {state, rec, opp, home, score, oppScore, detail}}.
function tcParseBoard(board){
  const out={};
  const events=(board&&Array.isArray(board.events))?board.events:[];
  events.forEach(ev=>{
    const comp=ev.competitions&&ev.competitions[0]; if(!comp) return;
    const st=(comp.status||ev.status||{}), type=st.type||{};
    const state=type.state==='post'?'post':type.state==='in'?'in':'pre';
    const detail=String(type.shortDetail||type.detail||'')
    // The situation while a game is on: the ball's spot, the down, the last play (its id is
    // the change signal the Game Center's live poll watches), the clock.
    const teamById={}; (comp.competitors||[]).forEach(c=>{ const ab=c.team&&c.team.abbreviation; if(c.team&&ab) teamById[String(c.team.id)]=TC_BOARD_ABBR[ab]||ab; });
    const sit=comp.situation||null; const lp=sit&&sit.lastPlay;
    const situation = sit ? {
      down:Number(sit.down||0), distance:Number(sit.distance||0), ddt:String(sit.shortDownDistanceText||sit.downDistanceText||''), spot:String(sit.possessionText||''),
      rz:!!sit.isRedZone, poss:sit.possession?(teamById[String(sit.possession)]||''):'',
      period:Number(st.period||0), clock:String(st.displayClock||''),
      // the pause between plays that is not a play: halftime, the end of a quarter
      phase: type.name==='STATUS_HALFTIME' ? 'Halftime' : (type.name==='STATUS_END_PERIOD' ? `End of Q${Number(st.period||0)||''}` : ''),
      to:{ home:(sit.homeTimeouts!=null?Number(sit.homeTimeouts):null), away:(sit.awayTimeouts!=null?Number(sit.awayTimeouts):null) },   // timeouts left
      lastPlayId: lp ? String(lp.id||'') : '',
      lastPlay: lp ? { id:String(lp.id||''), text:String(lp.text||''), type:String((lp.type&&lp.type.text)||''), scoreValue:Number(lp.scoreValue||0), yds:Number(lp.statYardage||0),
        at:lp.wallclock ? Date.parse(lp.wallclock)||0 : 0,
        team: lp.team ? (teamById[String(lp.team.id)]||'') : '',
        athletes:(Array.isArray(lp.athletesInvolved)?lp.athletesInvolved:[]).map(a=>({id:String(a.id||''), name:String(a.displayName||a.fullName||''), pos:String(a.position||''), team:a.team?(teamById[String(a.team.id)]||''):''})),
        down:Number((lp.start&&lp.start.down)||0), ddt:String((lp.start&&lp.start.shortDownDistanceText)||''), spot:String((lp.start&&lp.start.possessionText)||''), yte:(lp.start&&lp.start.yardsToEndzone!=null)?Number(lp.start.yardsToEndzone):null } : null,
    } : null;
    const sides=(comp.competitors||[]).map(c=>{
      const ab=c.team&&c.team.abbreviation; const code=ab?(TC_BOARD_ABBR[ab]||ab):'';
      const recs=Array.isArray(c.records)?c.records:[];
      const tot=recs.find(r=>r.type==='total'||r.name==='overall')||recs[0];
      const sc=c.score!=null?Number(c.score.value!=null?c.score.value:c.score):null;
      // the quarter line rides along for the Game Center's stats view
      const ls=Array.isArray(c.linescores)?c.linescores.map(l=>(l&&l.value!=null)?Number(l.value):null):[];
      return { code, home:c.homeAway==='home', rec:tot&&tot.summary?String(tot.summary):'', score:Number.isFinite(sc)?sc:null, ls };
    }).filter(s=>s.code);
    sides.forEach(s=>{
      const o=sides.find(x=>x!==s)||{};
      // eid: ESPN's event id — the key to the game summary (plays, box score)
      out[s.code]={ state, rec:s.rec, opp:o.code||'', home:s.home, score:s.score, oppScore:o.score!=null?o.score:null, detail, date:String(ev.date||comp.date||''), eid:String(ev.id||''), ls:s.ls, sit:situation };
    });
  });
  return out;
}
// The board for the current week (possibly stale), refreshing in the background when due.
function tcWeekBoard(){
  if(typeof TC_SEASON==='undefined' || typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return null;
  const season=String(TC_SEASON.year), week=tcBoardWeek();
  if(_tcBoard.season!==season || _tcBoard.week!==week){ _tcBoard={ season, week, at:0, teams:{}, busy:false, live:false }; }
  const ttl=_tcBoard.live?TC_BOARD_TTL_LIVE:TC_BOARD_TTL_IDLE;
  if(!_tcBoard.busy && Date.now()-_tcBoard.at>ttl && typeof sleeperFetch==='function'){
    _tcBoard.busy=true;
    sleeperFetch(TC_BOARD_URL(season, week), {fresh:true}).then(board=>{
      const teams=tcParseBoard(board);
      if(!Object.keys(teams).length) return;
      _tcBoard.teams=teams; _tcBoard.at=Date.now();
      _tcBoard.live=Object.values(teams).some(t=>t.state==='in');
      // Records ride along: every team the board knows fills the header's cache.
      if(typeof espnRecordCache!=='undefined' && espnRecordCache){
        Object.keys(teams).forEach(code=>{ if(teams[code].rec) espnRecordCache[`${season}:${code}`]=teams[code].rec; });
      }
      tcBoardLanded();
    }).catch(()=>{}).finally(()=>{ _tcBoard.busy=false; _tcBoard.at=_tcBoard.at||Date.now(); });   // an empty/failed look still waits out the TTL
  }
  return _tcBoard.teams;
}
function tcTeamGameState(team){
  const b=tcWeekBoard(); if(!b) return null;
  return b[String(team||'').toUpperCase()]||null;
}
// A landed board repaints what shows it: the sidebar dots, and the record in any header
// already on screen (patched in place — a full re-render would reset sliders mid-edit).
function tcBoardLanded(){
  _tcFresh.busy=false; tcFreshPaint();
  try{ if(typeof gcStreamOnBoard==='function') gcStreamOnBoard(_tcBoard.teams); }catch(e){}   // the Game Center's live poll: a new play?
  try{ if(typeof lfOnBoard==='function') lfOnBoard(_tcBoard.teams); }catch(e){}                 // the live feed: every game's last play
  // the left sidebar's dots change only when a game's STATE changes — not every 5-second read
  try{
    const sig=Object.keys(_tcBoard.teams).sort().map(c=>c+':'+_tcBoard.teams[c].state).join(',');
    if(sig!==_tcBoard.sig){
      const first=!_tcBoard.sig; _tcBoard.sig=sig;
      if(typeof renderSidebar==='function') tcRepaintWhenIdle('sidebar', renderSidebar);
      // a game kicked off or went final: the Live view's week sliders, "thru wk" chip and
      // games-played counts follow the games as they happen — redraw the page (idle-guarded)
      if(!first && typeof tcLiveViewOn==='function' && tcLiveViewOn() && typeof renderContent==='function') tcRepaintWhenIdle('content', renderContent);
    }
  }catch(e){}
  try{
    if(typeof document==='undefined' || !document.querySelectorAll) return;
    document.querySelectorAll('.team-rec-hero[data-team]').forEach(el=>{
      const t=el.getAttribute('data-team'); const g=_tcBoard.teams[t];
      if(g && g.rec) el.textContent=g.rec;
    });
  }catch(e){}
}
// ── Freshness: when ESPN was last read, ticking; tap to read again now ───────
// One stamp at the right of a live game's situation line and beside the feed's live count:
// the refresh mark and "4s ago" for the newest read of the board or the picked game's
// summary, ticking once a second (one timer, gone when no stamp is on screen) — the
// heartbeat that says the polls are running. A tap stales the board, every cached summary
// and the feed's seeding, reads the board (and the picked game's summary) at once, and
// spins until the read lands; the busy flags mean ten taps cost one request. It cannot beat
// ESPN's own delay (a play posts 10-20 s after it happens, the summary 10-20 s after that).
var _tcFresh = { timer:null, busy:false };
function tcFreshAt(eid){
  let at=_tcBoard.at||0;
  const s=(eid && typeof _gcd!=='undefined' && _gcd && _gcd.sum) ? _gcd.sum[String(eid)] : null;
  if(s && s.at>at) at=s.at;
  return at;
}
function tcFreshLabel(at){
  if(!at) return 'reading…';
  const s=Math.max(0, Math.round((Date.now()-at)/1000));
  return s<1 ? 'just now' : `${s}s ago`;
}
function tcFreshHTML(eid){
  const at=tcFreshAt(eid);
  tcFreshTick();
  return `<button class="tc-fresh${_tcFresh.busy?' busy':''}" data-eid="${escAttr(String(eid||''))}" onclick="tcRefreshNow(event)" title="When ESPN was last read — tap to read again now">${(typeof TC_ICON==='function')?TC_ICON('refresh'):'↻'}<span class="tc-fresh-t">${tcFreshLabel(at)}</span></button>`;
}
// The stamps on screen tick once a second — the text only, nothing else repaints.
function tcFreshTick(){
  if(_tcFresh.timer || typeof window==='undefined' || typeof window.setInterval!=='function' || typeof document==='undefined' || !document.querySelectorAll) return;
  _tcFresh.timer=window.setInterval(()=>{
    const els=document.querySelectorAll('.tc-fresh');
    if(!els.length){ clearInterval(_tcFresh.timer); _tcFresh.timer=null; return; }
    if(_tcFresh.busy && !_tcBoard.busy && _tcBoard.at) _tcFresh.busy=false;   // the read came back (or failed and waited out)
    els.forEach(el=>{
      const t=el.querySelector('.tc-fresh-t'); if(t) t.textContent=tcFreshLabel(tcFreshAt(el.getAttribute('data-eid')));
      if(el.classList) el.classList.toggle('busy', !!_tcFresh.busy);
    });
  }, 1000);
}
function tcFreshPaint(){
  if(typeof document==='undefined' || !document.querySelectorAll) return;
  try{ document.querySelectorAll('.tc-fresh').forEach(el=>{ if(el.classList) el.classList.toggle('busy', !!_tcFresh.busy); const t=el.querySelector('.tc-fresh-t'); if(t && _tcFresh.busy) t.textContent='reading…'; }); }catch(e){}
}
function tcRefreshNow(ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  _tcFresh.busy=true; tcFreshPaint();
  _tcBoard.at=0;
  if(typeof _gcd!=='undefined' && _gcd && _gcd.sum) Object.keys(_gcd.sum).forEach(eid=>{ if(_gcd.sum[eid]) _gcd.sum[eid].at=0; });
  if(typeof _lf!=='undefined' && _lf) _lf.seedAt={};
  try{
    if(typeof _gc!=='undefined' && _gc && _gc.game && typeof gcBoard==='function' && typeof gcGames==='function' && typeof gcWeek==='function' && typeof gcSummary==='function'){
      const g=(gcGames(gcBoard(gcWeek())||{})||[]).find(x=>x.id===_gc.game);
      if(g && g.state==='in') gcSummary(g);
    }
  }catch(e){}
  try{ tcWeekBoard(); }catch(e){}
  return true;
}
// ── Repaints wait for the hand to lift ───────────────────────────────────────
// A live read lands every few seconds. Re-rendering the sidebar under an open week picker
// closes it; under a finger it kills the swipe; under a focused field it drops the edit.
// So a repaint asked for while the user is mid-gesture, mid-pick or away is queued (one
// per key, the newest wins) and runs once the pointer lifts, the field blurs, the pick
// changes or the tab comes back — never on the poll's clock.
var _tcIdle = { down:false, queue:{}, timer:null };
function tcUiBusy(){
  if(_tcIdle.down) return true;
  if(typeof _gcm!=='undefined' && _gcm && _gcm.swiping) return true;
  if(typeof document!=='undefined' && document){
    if(document.visibilityState==='hidden') return true;
    const a=document.activeElement; const tag=a && a.tagName;
    if(tag==='SELECT' || tag==='INPUT' || tag==='TEXTAREA') return true;
  }
  return false;
}
function tcRepaintWhenIdle(key, fn){
  if(!tcUiBusy()){ fn(); return true; }
  _tcIdle.queue[key]=fn;
  return false;
}
function tcIdleFlush(){
  if(_tcIdle.timer) clearTimeout(_tcIdle.timer);
  _tcIdle.timer=setTimeout(()=>{
    _tcIdle.timer=null;
    if(tcUiBusy()) return;
    const q=_tcIdle.queue; _tcIdle.queue={};
    Object.keys(q).forEach(k=>{ try{ q[k](); }catch(e){} });
  }, 180);
}
if(typeof document!=='undefined' && document && typeof document.addEventListener==='function'){
  const dn=()=>{ _tcIdle.down=true; }, up=()=>{ _tcIdle.down=false; tcIdleFlush(); };
  document.addEventListener('pointerdown', dn, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  document.addEventListener('touchstart', dn, {capture:true, passive:true});
  document.addEventListener('touchend', up, {capture:true, passive:true});
  document.addEventListener('touchcancel', up, {capture:true, passive:true});
  document.addEventListener('focusout', ()=>tcIdleFlush(), true);
  document.addEventListener('change', ()=>tcIdleFlush(), true);
  document.addEventListener('visibilitychange', ()=>tcIdleFlush());
}
// Is the app showing the season in progress (the Live view)?
function tcLiveViewOn(){
  return typeof currentProjViewMode==='function' && currentProjViewMode()==='live';
}
// The dot beside a logo: green once the game is final, pulsing red while it is on, nothing
// before kickoff or on a bye. Title carries the score line.
function tcGameDotHTML(team){
  if(!tcLiveViewOn()) return '';
  const g=tcTeamGameState(team); if(!g || g.state==='pre') return '';
  const score=(g.score!=null && g.oppScore!=null)?` ${g.score}–${g.oppScore}`:'';
  const tip=`${g.state==='post'?'Final':'Live'}: ${g.home?'vs':'@'} ${g.opp}${score}${g.detail?` · ${g.detail}`:''}`;
  return `<span class="team-gs team-gs-${g.state}" title="${escAttr(tip)}"></span>`;
}
// The record for the header: the board's first (one request for all 32), the per-team
// ESPN record second. Empty until either lands; the span stays in the DOM to be patched.
function tcTeamRecordHTML(team, recStr){
  if(!tcLiveViewOn()) return '';
  const g=tcTeamGameState(team);
  const rec=(g&&g.rec)||recStr||'';
  return `<span class="team-rec-hero" data-team="${escAttr(team)}" title="${escAttr(`${TC_SEASON.year} record`)}">${escHtml(rec)}</span>`;
}

function tcSidebarSeason(){
  if(typeof activeSeason!=='undefined' && /^\d{4}$/.test(String(activeSeason))) return String(activeSeason);
  return typeof TC_SEASON!=='undefined' ? String(TC_SEASON.year) : '';
}

// ── Standings order ───────────────────────────────────────────────────────────
// In season (either projection tab) the sidebar's divisions sort by record — the leader
// first — so the picker doubles as the standings. Off-season: the fixed order. Win percentage (ties count half), then wins, then the
// division's fixed order for anything level or unknown. A division with no records yet
// keeps its fixed order.
function tcParseRecord(rec){
  const m=/^(\d+)-(\d+)(?:-(\d+))?$/.exec(String(rec||'').trim()); if(!m) return null;
  const w=+m[1], l=+m[2], t=+(m[3]||0), g=w+l+t;
  return { w, l, t, g, pct: g ? (w+0.5*t)/g : 0 };
}
function tcTeamRecord(team){
  const g=(typeof tcTeamGameState==='function')?tcTeamGameState(team):null;
  if(tcLiveViewOn() && g && g.rec) return g.rec;
  const season=tcSidebarSeason();
  if(typeof espnRecordCache!=='undefined' && espnRecordCache) return espnRecordCache[`${season}:${team}`]||'';
  return '';
}
// A team off this week's board (its bye) has no record on it: ask ESPN for that team once
// and repaint the sidebar when it lands, so a bye never drops a leader.
var _tcRecAsked = {};
var _tcHistoricalResults = {};
var _tcHistoricalAsked = {};
function tcHistoricalResults(season, teams){
  const cached=_tcHistoricalResults[season];
  if(cached) return cached;
  if(!_tcHistoricalAsked[season] && typeof sleeperFetch==='function' && typeof ESPN_SCHEDULE_URL==='function'){
    _tcHistoricalAsked[season]=true;
    Promise.all((teams||[]).map(async tm=>{
      const tid=typeof ESPN_TEAM_ID!=='undefined'&&ESPN_TEAM_ID[tm]; if(!tid) return [tm,[]];
      try{
        const data=await sleeperFetch(ESPN_SCHEDULE_URL(tid,season)); const games=[];
        for(const ev of ((data&&data.events)||[])){
          const st=ev.seasonType&&ev.seasonType.type; if(st!=null&&st!==2) continue;
          const comp=ev.competitions&&ev.competitions[0], cs=comp&&comp.competitors||[];
          const me=cs.find(c=>c.team&&String(c.team.abbreviation||'').toUpperCase()===tm);
          const opp=cs.find(c=>c!==me); if(!me||!opp) continue;
          const state=ev.status&&ev.status.type&&ev.status.type.state; if(state!=='post') continue;
          const pf=Number(me.score&&((me.score.value!=null)?me.score.value:me.score));
          const pa=Number(opp.score&&((opp.score.value!=null)?opp.score.value:opp.score));
          if(!Number.isFinite(pf)||!Number.isFinite(pa)) continue;
          games.push({wk:Number(ev.week&&ev.week.number)||games.length+1,opp:String(opp.team.abbreviation||'').toUpperCase(),pf,pa,home:me.homeAway==='home'});
        }
        return [tm,games];
      }catch(e){ return [tm,[]]; }
    })).then(rows=>{ const out={}; rows.forEach(([tm,g])=>{out[tm]=g;}); _tcHistoricalResults[season]=out; if(typeof renderSidebar==='function') renderSidebar(); });
  }
  return cached||{};
}
function tcStandingsOrder(teams){
  const season=tcSidebarSeason();
  const historical=typeof activeSeason!=='undefined' && /^\d{4}$/.test(String(activeSeason)) && String(activeSeason)!==String(TC_SEASON&&TC_SEASON.year);
  if(!historical && (typeof hasSeasonStarted!=='function' || !hasSeasonStarted())) return teams;
  const recs=teams.map(t=>tcParseRecord(tcTeamRecord(t)));
  if(!recs.some(r=>r && r.g>0)) return teams;
  if(typeof fetchTeamRecord==='function' && typeof TC_SEASON!=='undefined'){
    teams.forEach((t,i)=>{
      const key=`${season}:${t}`;
      if(recs[i] || _tcRecAsked[key]) return;
      _tcRecAsked[key]=true;
      Promise.resolve().then(()=>fetchTeamRecord(season, t)).then(r=>{ if(r && typeof renderSidebar==='function') renderSidebar(); }).catch(()=>{});
    });
  }
  // Known records first, by winning percentage; a tie goes to the NFL's division tiebreakers
  // (below) over the season's results. Unknown records keep their fixed order at the bottom.
  // A club yet to play (0-0, its bye in week 1) sits between the winners and the losers, as
  // every standings page lists it — not level with 0-1 at .000.
  const sortPct=r=>(r.g>0 ? r.pct : 0.5);
  const known=teams.map((t,i)=>({t, i, r:recs[i]})).filter(x=>x.r).sort((a,b)=>(sortPct(b.r)-sortPct(a.r)) || (a.i-b.i));
  const unknown=teams.filter((t,i)=>!recs[i]);
  const R=historical ? tcHistoricalResults(season, teams) : ((typeof tcSeasonResults==='function') ? tcSeasonResults() : {});
  const recOf=(tm)=>{ const r=tcParseRecord(tcTeamRecord(tm)); if(r) return r; return tcRecordFrom(R[tm]||[]); };
  const out=[];
  for(let i=0; i<known.length;){
    let j=i+1; while(j<known.length && Math.abs(sortPct(known[j].r)-sortPct(known[i].r))<1e-9) j++;
    const group=known.slice(i,j).map(x=>x.t);
    out.push(...(group.length>1 ? tcBreakTie(group, R, recOf) : group));
    i=j;
  }
  return out.concat(unknown);
}

// ═════════════════════════════════════════════════════════════════════════════
// Standings by the book — the NFL's division tiebreakers
// ═════════════════════════════════════════════════════════════════════════════
// Records order a division; a tie goes to the rule book, in order: head-to-head, division
// record, common games, conference record, strength of victory, strength of schedule, the
// combined points-scored / points-allowed ranking among conference clubs, the same among all
// clubs, net points in common games, net points in all games. With three or more tied, a
// step that separates one club ranks it and the others go back to step one (a separated
// subset restarts among itself too) — the NFL's own procedure.
// Results come from the in-season sidecar (real points per week plus the schedule); ESPN's
// boards fill any completed week nflverse has not posted in full, and the week in play.
var _tcResults = { season:null, weeks:{}, asked:{} };
var _tcDivMap = null;
function tcTeamDivInfo(tm){
  if(!_tcDivMap){
    _tcDivMap={};
    (typeof SIDEBAR_DIVISIONS!=='undefined' && Array.isArray(SIDEBAR_DIVISIONS) ? SIDEBAR_DIVISIONS : []).forEach(d=>{
      (d.teams||[]).forEach(t=>{ _tcDivMap[t]={div:String(d.title||''), conf:String(d.title||'').split(' ')[0]}; });
    });
  }
  return _tcDivMap[tm]||{div:'',conf:''};
}
function tcRecordFrom(games){
  let w=0,l=0,t=0;
  (games||[]).forEach(g=>{ if(g.pf>g.pa) w++; else if(g.pf<g.pa) l++; else t++; });
  const g=w+l+t; return {w,l,t,g,pct:g?(w+0.5*t)/g:0};
}
// Every completed game of the season: {TEAM: [{wk, opp, pf, pa, home}]}.
function tcSeasonResults(){
  if(typeof TC_SEASON==='undefined' || typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return {};
  const season=String(TC_SEASON.year), cur=tcBoardWeek();
  if(_tcResults.season!==season) _tcResults={season, weeks:{}, asked:{}};
  const out={}, have={};
  const push=(tm,g)=>{ (out[tm]=out[tm]||[]).push(g); };
  const pack=(typeof NFLVERSE!=='undefined' && NFLVERSE && NFLVERSE[season] && NFLVERSE[season].adv_weekly)||null;
  const ins=(typeof TC_INSEASON!=='undefined' && TC_INSEASON)?TC_INSEASON:null;
  const sch=ins&&ins.schedule, meta=ins&&ins.schedule_meta;
  if(pack && Array.isArray(pack.weeks) && Array.isArray(pack.cols) && pack.teams && sch){
    const ci=pack.cols.indexOf('off_pts'), ca=pack.cols.indexOf('def_pts_allowed');
    if(ci>=0 && ca>=0) pack.weeks.forEach((w,i)=>{
      w=Number(w); if(!(w>=1) || w>=cur) return;              // the week in play comes from the live board
      const rows=[];
      Object.keys(pack.teams).forEach(tm=>{
        const r=Array.isArray(pack.teams[tm])?pack.teams[tm][i]:null; if(!r) return;
        const pf=r[ci], pa=r[ca]; if(pf==null || pa==null) return;
        const opp=sch[tm]&&sch[tm][String(w)]; if(!opp) return;
        const m=meta&&meta[tm]&&meta[tm][String(w)];
        rows.push([tm,{wk:w, opp:String(opp), pf:Number(pf), pa:Number(pa), home:m?!!m[1]:null}]);
      });
      // A week counts as posted only when every scheduled club has its row; a half-posted
      // week (Monday night still to come on nflverse) is left to the board instead.
      const scheduled=Object.keys(sch).filter(tm=>sch[tm]&&sch[tm][String(w)]).length;
      if(rows.length && rows.length>=scheduled){ rows.forEach(([tm,g])=>push(tm,g)); have[w]=true; }
    });
  }
  for(let w=1; w<=cur; w++){
    if(have[w]) continue;
    let b=null;
    if(w===cur) b=tcWeekBoard();
    else {
      b=_tcResults.weeks[w]||null;
      if(!b && !_tcResults.asked[w] && typeof sleeperFetch==='function'){
        _tcResults.asked[w]=true;
        sleeperFetch(TC_BOARD_URL(season, w)).then(raw=>{
          const t=tcParseBoard(raw);
          if(Object.keys(t).length){ _tcResults.weeks[w]=t; if(typeof renderSidebar==='function') renderSidebar(); }
        }).catch(()=>{});
      }
    }
    if(!b) continue;
    Object.keys(b).forEach(tm=>{
      const g=b[tm]; if(!g || g.state!=='post' || g.score==null || g.oppScore==null || !g.opp) return;
      push(tm,{wk:w, opp:g.opp, pf:g.score, pa:g.oppScore, home:!!g.home});
    });
  }
  return out;
}
function _tcPct(w,l,t){ const g=w+l+t; return g ? (w+0.5*t)/g : null; }
function _tcPctIn(games, filter){
  let w=0,l=0,t=0;
  (games||[]).forEach(g=>{ if(filter && !filter(g)) return; if(g.pf>g.pa) w++; else if(g.pf<g.pa) l++; else t++; });
  return _tcPct(w,l,t);
}
// Order a set of clubs tied on percentage. R: the season's results; recOf(tm) → {w,l,t}.
function tcBreakTie(teams, R, recOf){
  if(!teams || teams.length<=1) return (teams||[]).slice();
  const G=tm=>(R&&R[tm])||[];
  if(!teams.some(tm=>G(tm).length)) return teams.slice();
  const set=new Set(teams);
  const conf=tcTeamDivInfo(teams[0]).conf, div=tcTeamDivInfo(teams[0]).div;
  let common=null;
  teams.forEach(tm=>{ const s=new Set(G(tm).map(g=>g.opp)); common = common ? new Set([...common].filter(x=>s.has(x))) : s; });
  common=common||new Set();
  const oppPct=(tm, onlyWins)=>{
    let w=0,l=0,t=0,n=0;
    G(tm).forEach(g=>{ if(onlyWins && !(g.pf>g.pa)) return; const r=recOf(g.opp); if(!r) return; w+=r.w; l+=r.l; t+=r.t; n++; });
    return n ? _tcPct(w,l,t) : null;
  };
  const pointsRank=(scope)=>{
    const pool=Object.keys(R||{}).filter(tm=>scope==='conf' ? tcTeamDivInfo(tm).conf===conf : true);
    const pf={}, pa={};
    pool.forEach(tm=>{ pf[tm]=G(tm).reduce((s,g)=>s+g.pf,0); pa[tm]=G(tm).reduce((s,g)=>s+g.pa,0); });
    const rank=(vals, desc)=>{ const rk={}; pool.slice().sort((a,b)=>desc?vals[b]-vals[a]:vals[a]-vals[b]).forEach((tm,i)=>{ rk[tm]=i+1; }); return rk; };
    const rf=rank(pf,true), ra=rank(pa,false);
    return tm=> pool.length ? -((rf[tm]||pool.length)+(ra[tm]||pool.length)) : null;   // a lower combined rank wins
  };
  const net=(tm, filter)=>G(tm).reduce((s,g)=>(!filter||filter(g)) ? s+(g.pf-g.pa) : s, 0);
  const steps=[
    tm=>_tcPctIn(G(tm), g=>set.has(g.opp)),                          // 1 head-to-head
    tm=>_tcPctIn(G(tm), g=>tcTeamDivInfo(g.opp).div===div),          // 2 division record
    tm=>common.size ? _tcPctIn(G(tm), g=>common.has(g.opp)) : null,   // 3 common games
    tm=>_tcPctIn(G(tm), g=>tcTeamDivInfo(g.opp).conf===conf),        // 4 conference record
    tm=>oppPct(tm, true),                                            // 5 strength of victory
    tm=>oppPct(tm, false),                                           // 6 strength of schedule
    pointsRank('conf'),                                              // 7 points ranking, conference
    pointsRank('all'),                                               // 8 points ranking, league
    tm=>common.size ? net(tm, g=>common.has(g.opp)) : null,          // 9 net points, common games
    tm=>net(tm),                                                     // 10 net points, all games
  ];
  for(const step of steps){
    const v={}; teams.forEach(tm=>{ v[tm]=step(tm); });
    // A step some club has no game in says nothing yet — on to the next one.
    if(teams.some(tm=>v[tm]==null)) continue;
    const best=Math.max(...teams.map(tm=>v[tm]));
    const win=teams.filter(tm=>Math.abs(v[tm]-best)<1e-9);
    if(win.length===teams.length) continue;
    const rest=teams.filter(tm=>!win.includes(tm));
    return tcBreakTie(win, R, recOf).concat(tcBreakTie(rest, R, recOf));
  }
  return teams.slice();   // still tied after the book: the fixed order
}

// Are games being played right now? True while this week's board shows a game in progress
// and the board is fresh enough to trust (it refreshes every 45s while one is on).
function tcGamesLive(){
  const b=tcWeekBoard(); if(!b) return false;
  return !!_tcBoard.live && (Date.now()-_tcBoard.at) < 10*60*1000;
}
function tcLiveUpdatedText(){
  const at=(typeof _liveSeasonAt!=='undefined')?_liveSeasonAt:0; if(!at) return '';
  try{ return new Date(at).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }catch(e){ return ''; }
}
