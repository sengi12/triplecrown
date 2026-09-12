// ═════════════════════════════════════════════════════════════════════════════
// This week's board — game state + record for every team, from ONE request
// ═════════════════════════════════════════════════════════════════════════════
// ESPN's scoreboard for the current week carries, per game, both sides' overall record and
// the game's state (pre / in / post) with its clock. In the Live view that feeds two things:
// a dot on each team's logo in the sidebar (played · playing) and the big record in the team
// header — without 32 per-team record fetches. Refreshes on its own while a game is on.
var _tcBoard = { season:null, week:null, at:0, teams:{}, busy:false, live:false };
const TC_BOARD_URL = (season, week)=>`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`;
const TC_BOARD_ABBR = { WSH:'WAS' };          // ESPN spells one club differently
const TC_BOARD_TTL_LIVE = 45*1000, TC_BOARD_TTL_IDLE = 5*60*1000;

function tcBoardWeek(){
  const w=(typeof TC_SEASON!=='undefined')?Number(TC_SEASON.week||0):0;
  return Math.min(18, Math.max(1, w||1));
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
    const sides=(comp.competitors||[]).map(c=>{
      const ab=c.team&&c.team.abbreviation; const code=ab?(TC_BOARD_ABBR[ab]||ab):'';
      const recs=Array.isArray(c.records)?c.records:[];
      const tot=recs.find(r=>r.type==='total'||r.name==='overall')||recs[0];
      const sc=c.score!=null?Number(c.score.value!=null?c.score.value:c.score):null;
      return { code, home:c.homeAway==='home', rec:tot&&tot.summary?String(tot.summary):'', score:Number.isFinite(sc)?sc:null };
    }).filter(s=>s.code);
    sides.forEach(s=>{
      const o=sides.find(x=>x!==s)||{};
      out[s.code]={ state, rec:s.rec, opp:o.code||'', home:s.home, score:s.score, oppScore:o.score!=null?o.score:null, detail };
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
    sleeperFetch(TC_BOARD_URL(season, week)).then(board=>{
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
  try{ if(typeof renderSidebar==='function') renderSidebar(); }catch(e){}
  try{
    if(typeof document==='undefined' || !document.querySelectorAll) return;
    document.querySelectorAll('.team-rec-hero[data-team]').forEach(el=>{
      const t=el.getAttribute('data-team'); const g=_tcBoard.teams[t];
      if(g && g.rec) el.textContent=g.rec;
    });
  }catch(e){}
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
  if(g && g.rec) return g.rec;
  if(typeof espnRecordCache!=='undefined' && espnRecordCache && typeof TC_SEASON!=='undefined') return espnRecordCache[`${TC_SEASON.year}:${team}`]||'';
  return '';
}
// A team off this week's board (its bye) has no record on it: ask ESPN for that team once
// and repaint the sidebar when it lands, so a bye never drops a leader.
var _tcRecAsked = {};
function tcStandingsOrder(teams){
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return teams;
  const recs=teams.map(t=>tcParseRecord(tcTeamRecord(t)));
  if(!recs.some(r=>r && r.g>0)) return teams;
  if(typeof fetchTeamRecord==='function' && typeof TC_SEASON!=='undefined'){
    teams.forEach((t,i)=>{
      const key=`${TC_SEASON.year}:${t}`;
      if(recs[i] || _tcRecAsked[key]) return;
      _tcRecAsked[key]=true;
      Promise.resolve().then(()=>fetchTeamRecord(TC_SEASON.year, t)).then(r=>{ if(r && typeof renderSidebar==='function') renderSidebar(); }).catch(()=>{});
    });
  }
  // Known records first (win pct, then wins); unknown ones keep their fixed order below.
  return teams.map((t,i)=>({t, i, r:recs[i]}))
    .sort((a,b)=> (a.r?0:1)-(b.r?0:1) || (a.r&&b.r ? (b.r.pct-a.r.pct) || (b.r.w-a.r.w) : 0) || (a.i-b.i))
    .map(x=>x.t);
}
