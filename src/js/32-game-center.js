// ═════════════════════════════════════════════════════════════════════════════
// Game Center — the right sidebar, maximised: every game of the week with its score, and
// for the picked game each side's players by position with their fantasy points and stat
// line, the way Sleeper's Game Center reads.
// ═════════════════════════════════════════════════════════════════════════════
// The sidebar has three sizes: MIN (a rail with one button), NORMAL (the Leaders list) and
// MAX (this). Games come from ESPN's scoreboard for the picked week (the week board's own
// parser); player lines from Sleeper's week rows for every position — offense, kickers,
// defenders, D/ST — scored with the synced league's scoring table verbatim (Σ stat × setting),
// so the number is the league's number; without a synced league the app's scoring stands in
// for offense and Sleeper's half-PPR for the rest. A player's fantasy owner rides under his
// name when the league rosters him.
var _gc = { mode:'normal', week:'current', game:null, pos:'ALL', boards:{}, rows:{}, busy:{}, dragW:0, league:null, view:'games' };
const GC_MODES = ['min','normal','max'];
const GC_POS = ['ALL','QB','RB','WR','TE','K','DEF','IDP','RK'];   // the Rankings page's filters, plus the defensive groups
const GC_GROUPS = [['QB','Quarterback',['QB']],['RB','Running back',['RB','FB']],['WR','Wide receiver',['WR']],['TE','Tight end',['TE']],['K','Kicker',['K']],['DEF','Defense / ST',['DEF']],['IDP','Defenders',['DL','DE','DT','NT','LB','OLB','ILB','MLB','DB','CB','S','SS','FS']]];

function gcLoadMode(){ try{ const m=localStorage.getItem('tc_rsb'); if(GC_MODES.includes(m)) _gc.mode=m; }catch(e){} }
function gcSetMode(m){
  if(!GC_MODES.includes(m)) return;
  _gc.mode=m;
  // the panel the rail reopens to: whichever of the two was up last
  if(m!=='min'){ _gc.lastOpen=m; try{ localStorage.setItem('tc_rsb_open', m); }catch(e){} }
  try{ localStorage.setItem('tc_rsb', m); }catch(e){}
  renderRightSidebar();
}
function gcOpenLast(){
  let m=_gc.lastOpen; if(!m){ try{ m=localStorage.getItem('tc_rsb_open'); }catch(e){} }
  gcSetMode(m==='max' ? 'max' : 'normal');
}
function gcSetWeek(v){ _gc.week = v==='current' ? 'current' : Number(v); _gc.game=null; renderRightSidebar(); }
// Picking a game from the phone's half-open sheet also pulls the sheet up: the game list is
// the half state's point, the picked game's lines are the full state's.
function gcPick(id){ _gc.game=id; if(!gcInGamesView() && typeof _gcm!=='undefined' && _gcm.open==='half') _gcm.open='full'; renderRightSidebar(); }
// "Now" is the tracker's week: the finished week holds through Tuesday and until Wednesday
// 06:00 Eastern (tcTrackerWeek), so Tuesday's look still opens on everything that happened.
function gcCurWeek(){ return (typeof tcTrackerWeek==='function') ? tcTrackerWeek() : Math.max(1, Number(TC_SEASON.week||1)); }
// Any week of the season: the ones played, the one in progress, and every one ahead (the
// scoreboard knows the whole schedule; the next few weeks carry projected lines). The
// playoff rounds ride on as weeks 19-22 (92b's TC_PLAYOFF_WEEKS).
function gcLastWeek(){ return (typeof TC_LAST_WEEK!=='undefined') ? TC_LAST_WEEK : 18; }
function gcWeek(){ const cur=gcCurWeek(); return _gc.week==='current' ? cur : Math.max(1, Math.min(gcLastWeek(), _gc.week)); }
function gcWeekLabel(w){ return (typeof tcWeekLabel==='function') ? tcWeekLabel(w) : `Week ${w}`; }
function gcWeekOptions(cur){
  // In order, week 1 through the Super Bowl — the current week is marked, not moved.
  const out=[]; for(let w=1; w<=gcLastWeek(); w++) out.push(w);
  return out;
}

// Exact Sleeper scoring: Σ stat × the league's setting over the keys both carry.
function tcSleeperPoints(stats, sc){
  if(!stats || !sc) return null;
  let f=0, n=0;
  for(const k in sc){ const v=stats[k]; if(typeof v==='number' && typeof sc[k]==='number' && v){ f+=v*sc[k]; n++; } }
  return Math.round(f*100)/100;
}
// The scoring the pane runs under: the Analyzer's league, any synced league picked in the
// fantasy pane (32b-game-detail.js), or the app's own.
function gcScoring(){
  const id=(typeof gcLeague==='function') ? gcLeague() : 'snap';
  if(id==='app') return null;
  if(id==='snap') return (typeof leagueSnapshot!=='undefined' && leagueSnapshot && leagueSnapshot.scoringRaw) || null;
  const L=(typeof gcLeagueEntry==='function') ? gcLeagueEntry() : null;
  return (L && L.scoring) || null;
}
function gcPoints(row){
  const sc=gcScoring(), st=row.stats||{};
  if(sc) return tcSleeperPoints(st, sc);
  const pos=gcPos(row)||String(row.pos||'').toUpperCase();
  if(['QB','RB','WR','TE'].includes(pos) && typeof ldPoints==='function') return ldPoints({pos, stats:st});
  return st.pts_half_ppr!=null ? +st.pts_half_ppr : (st.pts_std!=null ? +st.pts_std : null);
}
// ── Where the points came from ───────────────────────────────────────────────
// Sleeper's score-breakdown sheet: each stat the scoring pays for, what it pays, what it
// paid. Built the SAME way the number was — the league's own table (tcSleeperPoints: every
// stat key the table prices) or the app's model (calcFpts, row by row) — so the rows always
// sum to the figure on the card.
const TC_STAT_LABELS = {
  pass_yd:'Passing yards', pass_td:'Passing TD', pass_int:'Interception', pass_att:'Pass attempt', pass_cmp:'Completion', pass_2pt:'2-pt pass', pass_sack:'Sacked',
  pass_fd:'Passing first down', pass_inc:'Incompletion', pass_cmp_40p:'40+ yd completion', pass_td_40p:'40+ yd passing TD', pass_td_50p:'50+ yd passing TD',
  rush_yd:'Rushing yards', rush_td:'Rushing TD', rush_att:'Carry', rush_2pt:'2-pt run', rush_fd:'Rushing first down', rush_40p:'40+ yd run', rush_td_40p:'40+ yd rushing TD', rush_td_50p:'50+ yd rushing TD',
  rec:'Reception', rec_yd:'Receiving yards', rec_td:'Receiving TD', rec_tgt:'Target', rec_2pt:'2-pt catch', rec_fd:'Receiving first down', rec_40p:'40+ yd catch', rec_td_40p:'40+ yd receiving TD', rec_td_50p:'50+ yd receiving TD',
  bonus_rec_te:'TE reception bonus', bonus_rec_rb:'RB reception bonus', bonus_rec_wr:'WR reception bonus',
  bonus_pass_yd_300:'300-yd passing game', bonus_pass_yd_400:'400-yd passing game', bonus_rush_yd_100:'100-yd rushing game', bonus_rush_yd_200:'200-yd rushing game', bonus_rec_yd_100:'100-yd receiving game', bonus_rec_yd_200:'200-yd receiving game',
  fum:'Fumble', fum_lost:'Fumble lost', fum_rec_td:'Fumble recovery TD', kr_yd:'Kick return yards', pr_yd:'Punt return yards', kr_td:'Kick return TD', pr_td:'Punt return TD', st_td:'Special teams TD', st_fum_rec:'Special teams fumble recovery', st_ff:'Special teams forced fumble',
  xpm:'Extra point', xpmiss:'Missed extra point', fgm:'Field goal', fgmiss:'Missed field goal', fgm_0_19:'FG 0–19', fgm_20_29:'FG 20–29', fgm_30_39:'FG 30–39', fgm_40_49:'FG 40–49', fgm_50p:'FG 50+', fgm_50_59:'FG 50–59', fgm_60p:'FG 60+', fgm_yds:'FG yards', fgmiss_0_19:'Missed FG 0–19', fgmiss_20_29:'Missed FG 20–29', fgmiss_30_39:'Missed FG 30–39', fgmiss_40_49:'Missed FG 40–49', fgmiss_50p:'Missed FG 50+',
  sack:'Sack', int:'Interception', ff:'Forced fumble', fum_rec:'Fumble recovery', safe:'Safety', blk_kick:'Blocked kick', def_td:'Defensive TD', def_st_td:'Defense / ST TD', def_st_ff:'Defense / ST forced fumble', def_st_fum_rec:'Defense / ST fumble recovery', def_kr_yd:'Kick return yards', def_pr_yd:'Punt return yards', def_2pt:'Defensive 2-pt', def_4_and_stop:'4th-down stop', def_3_and_out:'Three and out',
  pts_allow_0:'0 points allowed', pts_allow_1_6:'1–6 points allowed', pts_allow_7_13:'7–13 points allowed', pts_allow_14_20:'14–20 points allowed', pts_allow_21_27:'21–27 points allowed', pts_allow_28_34:'28–34 points allowed', pts_allow_35p:'35+ points allowed', pts_allow:'Points allowed',
  yds_allow_0_100:'0–100 yards allowed', yds_allow_100_199:'100–199 yards allowed', yds_allow_200_299:'200–299 yards allowed', yds_allow_300_349:'300–349 yards allowed', yds_allow_350_399:'350–399 yards allowed', yds_allow_400_449:'400–449 yards allowed', yds_allow_450_499:'450–499 yards allowed', yds_allow_500_549:'500–549 yards allowed', yds_allow_550p:'550+ yards allowed', yds_allow:'Yards allowed',
  idp_tkl:'Tackle', idp_tkl_solo:'Solo tackle', idp_tkl_ast:'Assisted tackle', idp_tkl_loss:'Tackle for loss', idp_sack:'Sack', idp_int:'Interception', idp_ff:'Forced fumble', idp_fum_rec:'Fumble recovery', idp_pass_def:'Pass defended', idp_qb_hit:'QB hit', idp_def_td:'Defensive TD', idp_safe:'Safety', idp_blk_kick:'Blocked kick',
};
function tcStatLabel(k){
  if(TC_STAT_LABELS[k]) return TC_STAT_LABELS[k];
  return String(k||'').replace(/_/g,' ').replace(/^./, c=>c.toUpperCase());
}
// → {rows:[{key,label,stat,per,pts}], total, source}; rows in the order they matter (biggest first).
function tcPointsBreakdown(stats, pos, scRaw, srcName){
  stats=stats||{}; pos=String(pos||'').toUpperCase();
  const r2=(v)=>Math.round(v*100)/100;
  const rows=[];
  if(scRaw){
    for(const k in scRaw){
      const v=stats[k], per=scRaw[k];
      if(typeof v!=='number' || typeof per!=='number' || !v) continue;
      rows.push({key:k, label:tcStatLabel(k), stat:v, per, pts:v*per});
    }
    rows.sort((a,b)=>Math.abs(b.pts)-Math.abs(a.pts));
    return {rows, total:r2(rows.reduce((a,r)=>a+r.pts,0)), source:srcName||'league scoring'};
  }
  const sc=(typeof scoringSettings!=='undefined' && scoringSettings) ? scoringSettings : {};
  const s=stats;
  if(['QB','RB','WR','TE'].includes(pos)){
    const yd=(key, label, ydg, mult)=>{ const v=s[key]||0; if(!v || !(ydg>0)) return; const per=(mult!=null?mult:1)/ydg; rows.push({key, label, stat:v, per, pts:v*per}); };
    const ct=(key, label, per)=>{ const v=s[key]||0; if(!v || !per) return; rows.push({key, label, stat:v, per, pts:v*per}); };
    yd('pass_yd','Passing yards', sc.passing_yards_yardage, sc.passing_yards_points);
    ct('pass_td','Passing TD', sc.passing_touchdowns); ct('pass_int','Interception', sc.interceptions_thrown);
    ct('pass_att','Pass attempt', sc.passing_attempts); ct('pass_cmp','Completion', sc.passing_completions);
    yd('rec_yd','Receiving yards', sc.receiving_yards_yardage, sc.receiving_yards_points);
    ct('rec_td','Receiving TD', sc.receiving_touchdowns);
    ct('rec','Reception', (sc.receptions||0) + (pos==='TE' ? (sc.receptions_te_bonus||0) : 0));
    yd('rush_yd','Rushing yards', sc.rushing_yards_yardage, sc.rushing_yards_points);
    ct('rush_td','Rushing TD', sc.rushing_touchdowns); ct('rush_att','Carry', sc.rushing_attempts);
    ct('fum_lost','Fumble lost', sc.fumbles_lost); ct('fum','Fumble', sc.fumbles);
    const tp=(s.pass_2pt||0)+(s.rush_2pt||0)+(s.rec_2pt||0);
    if(tp && sc.two_point_conversions) rows.push({key:'2pt', label:'2-pt conversion', stat:tp, per:sc.two_point_conversions, pts:tp*sc.two_point_conversions});
    rows.sort((a,b)=>Math.abs(b.pts)-Math.abs(a.pts));
    return {rows, total:r2(rows.reduce((a,r)=>a+r.pts,0)), source:srcName||'app scoring'};
  }
  // kickers and defenses under the app's scoring: Sleeper's own total, one line
  const rec=Number(sc.receptions||0); const k = rec>=1 ? 'pts_ppr' : rec>0 ? 'pts_half_ppr' : 'pts_std';
  const v = s[k]!=null ? +s[k] : (s.pts_half_ppr!=null ? +s.pts_half_ppr : null);
  if(v!=null) rows.push({key:k, label:`Sleeper ${k==='pts_ppr'?'PPR':k==='pts_std'?'standard':'half-PPR'} points`, stat:1, per:v, pts:v});
  return {rows, total:r2(rows.reduce((a,r)=>a+r.pts,0)), source:srcName||'Sleeper'};
}
function tcBreakdownHTML(b){
  const f=(v)=>(Math.round(v*100)/100).toFixed(2);
  const per=(v)=>{ const a=Math.abs(v); return a<0.1 ? v.toFixed(3) : f(v); };
  if(!b.rows.length) return `<div class="tc-brk-none">Nothing the scoring pays for yet.</div>`;
  return `<table class="tc-brk"><thead><tr><th>Stat</th><th class="n">#</th><th class="n">Pts per</th><th class="n">Points</th></tr></thead><tbody>${
    b.rows.map(r=>`<tr class="${r.pts<0?'neg':''}"><td>${escHtml(r.label)}</td><td class="n">${Number.isInteger(r.stat)?r.stat:r.stat}</td><td class="n">${per(r.per)}</td><td class="n"><b>${f(r.pts)}</b></td></tr>`).join('')
  }</tbody><tfoot><tr><td>Total</td><td></td><td></td><td class="n"><b>${f(b.total)}</b></td></tr></tfoot></table>
  <div class="tc-brk-src">${escHtml(b.source)}</div>`;
}
// The pane's rows, by player, for the tap on a number.
var _gcBrk = {};
function gcPtsPop(ev, pid){
  const r=_gcBrk[String(pid)]; if(!r) return;
  const sc=gcScoring(); const lgE=(typeof gcLeagueEntry==='function') ? gcLeagueEntry() : null;
  const src = sc ? ((lgE && lgE.name) || (typeof leagueSnapshot!=='undefined' && leagueSnapshot && leagueSnapshot.name) || 'league scoring') : 'TripleCrown scoring';
  const b=tcPointsBreakdown(r.stats||{}, gcPos(r), sc, src);
  tcPopShow(ev, 'brk:'+pid, `${escHtml(gcName(r))} · ${b.total.toFixed(2)}`, tcBreakdownHTML(b));
}
// Who rosters him in the synced league.
function gcOwnerOf(pid){
  const L=(typeof gcLeagueEntry==='function') ? gcLeagueEntry() : null;
  if(L){ const st=L.byPid && L.byPid[String(pid)]; return st ? '@'+st.owner : ''; }
  if(typeof gcLeague==='function' && gcLeague()==='app') return '';
  const s=(typeof leagueSnapshot!=='undefined')?leagueSnapshot:null; if(!s || !s.teamList) return '';
  for(const t of s.teamList){ if((t.players||[]).some(p=>String(p.id)===String(pid))) return t.owner ? '@'+t.owner : (t.teamName||''); }
  return '';
}
// The board for any week (the current week reuses the live board).
function gcBoard(wk){
  // the live board is the TRACKER's week (the finished week holds through Tuesday); another
  // week — the coming one, asked for on a Tuesday — reads its own board, never that one
  const cur=(typeof tcBoardWeek==='function') ? tcBoardWeek() : Math.max(1, Number(TC_SEASON.week||1));
  if(wk===cur && typeof tcWeekBoard==='function'){ const b=tcWeekBoard(); if(b && Object.keys(b).length) return b; }
  const key=`${TC_SEASON.year}|${wk}`;
  if(_gc.boards[key]) return _gc.boards[key];
  if(!_gc.busy[key] && typeof sleeperFetch==='function' && typeof TC_BOARD_URL==='function'){
    _gc.busy[key]=true;
    sleeperFetch(TC_BOARD_URL(TC_SEASON.year, wk)).then(b=>{ const t=tcParseBoard(b); if(Object.keys(t).length){ _gc.boards[key]=t; renderRightSidebar(); } }).catch(()=>{}).finally(()=>{ _gc.busy[key]=false; });
  }
  return null;
}
// Games of the week from a board: one entry per game, away@home, sorted live → upcoming → final.
function gcGames(board){
  const seen=new Set(), games=[];
  Object.keys(board||{}).forEach(code=>{
    const g=board[code]; if(!g || !g.opp) return;
    const home=g.home?code:g.opp, away=g.home?g.opp:code; const id=`${away}@${home}`;
    if(seen.has(id)) return; seen.add(id);
    const h=board[home]||{}, a=board[away]||{};
    games.push({ id, home, away, state:g.state, detail:g.detail, date:String(g.date||''), hs:h.score!=null?h.score:(g.home?g.score:g.oppScore), as:a.score!=null?a.score:(g.home?g.oppScore:g.score), hrec:h.rec||'', arec:a.rec||'',
      eid:String(g.eid||h.eid||a.eid||''), hls:h.ls||[], als:a.ls||[], sit:g.sit||h.sit||a.sit||null, hodds:h.odds||null, aodds:a.odds||null });   // ESPN's event id opens the game summary (plays, box score); sit = the live situation; odds = Vegas line
  });
  // In the order they are played: Thursday night, the Sunday early window, the late window,
  // Sunday night, Monday night (the board's kickoff stamps); same kickoff → by matchup.
  return games.sort((x,y)=>(x.date||'').localeCompare(y.date||'') || x.id.localeCompare(y.id));
}
// The game the panel opens on: the one being played, else the first of the week.
function gcDefaultGame(games){ return (games.find(g=>g.state==='in')||games[0]).id; }
// The size buttons: − narrower, + wider (rail → Leaders → Game Center).
function gcStep(d){ const i=GC_MODES.indexOf(_gc.mode); gcSetMode(GC_MODES[Math.max(0, Math.min(GC_MODES.length-1, i+d))]); }
function gcSetPos(p){ _gc.pos=p; renderRightSidebar(); }
// Games (one game at a time) or the Live feed (every game at once, filtered to your
// leagues — 33-live-feed.js). One switch, both homes.
function gcSetView(v){ _gc.view = v==='feed' ? 'feed' : 'games'; renderRightSidebar(); }
function gcViewRowHTML(){
  if(typeof lfBodyHTML!=='function') return '';
  const on=_gc.view==='feed';
  // the badge: plays that matter since the feed was last on screen (none while it is showing)
  const unseen=(!on && typeof lfUnseen==='function') ? lfUnseen() : 0;
  return `<div class="gc-viewrow"><button class="gc-vt ${on?'':'active'}" onclick="gcSetView('games')">Games</button><button class="gc-vt ${on?'active':''}" onclick="gcSetView('feed')" title="${unseen?`${unseen} new play${unseen===1?'':'s'} since you looked`:'Every game at once'}">Live feed${unseen?`<span class="gc-vt-live">${unseen>99?'99+':unseen}</span>`:''}</button></div>`;
}
// ── Drag the sidebar wider (or narrower) by its left edge; the width is remembered per size ──
function gcWidthKey(){ return 'tc_rsb_w_'+_gc.mode; }
function gcStoredWidth(){ try{ const v=Number(localStorage.getItem(gcWidthKey())); return v>0?v:null; }catch(e){ return null; } }
function gcApplyWidth(el){
  const w=(_gc.mode==='min')?null:(_gc.dragW||gcStoredWidth());
  el.style.width=el.style.minWidth=el.style.maxWidth=(w?w+'px':'');
}
function gcMaxWidth(){
  const main=(typeof document!=='undefined' && document.querySelector)?document.querySelector('.main'):null;
  const left=(typeof document!=='undefined')?document.getElementById('sidebar'):null;
  const mw=(main&&main.getBoundingClientRect)?main.getBoundingClientRect().width:((typeof window!=='undefined'&&window.innerWidth)||1400);
  const lw=(left&&left.getBoundingClientRect)?left.getBoundingClientRect().width:0;
  return Math.max(260, Math.round(mw-lw));   // as wide as the whole content area, at most
}
function gcGripDown(ev){
  const el=(typeof ldHost==='function')?ldHost():null; if(!el || !el.getBoundingClientRect) return;
  if(ev && ev.preventDefault) ev.preventDefault();
  const right=el.getBoundingClientRect().right, maxW=gcMaxWidth();
  // The Leaders list fills in as it widens (full names, then stat columns): repaint as the
  // pointer moves, one frame at a time.
  const move=(e)=>{ const w=Math.round(Math.max(200, Math.min(maxW, right-e.clientX))); el.style.width=el.style.minWidth=el.style.maxWidth=w+'px'; _gc.dragW=w;
    if(_gc.mode==='normal' && !_gc.raf && typeof window!=='undefined' && window.requestAnimationFrame){ _gc.raf=window.requestAnimationFrame(()=>{ _gc.raf=0; if(_gc.dragW) renderRightSidebar(); }); } };
  const up=()=>{ window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if(_gc.dragW){ try{ localStorage.setItem(gcWidthKey(), String(_gc.dragW)); }catch(e){} _gc.dragW=0; renderRightSidebar(); } };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function rsbGripHTML(){ return `<div class="rsb-grip" title="Drag to resize" onpointerdown="gcGripDown(event)"></div>`; }
// Players on the user's own roster in the synced league (their names light up).
function gcMineSet(){
  const s=(typeof leagueSnapshot!=='undefined')?leagueSnapshot:null;
  if(!s || !s.teamList || !s.myUserId) return new Set();
  const mine=s.teamList.find(t=>t.ownerId===s.myUserId || (t.coOwners||[]).includes(s.myUserId));
  return new Set(((mine&&mine.players)||[]).map(p=>String(p.id)));
}
// Your matchup in a league for a WEEK: your starters and your opponent's, from that
// week's matchups (one small read per league × week, kept for the session). Before it
// lands the sets are empty and the paint follows when it does.
var _gcMu = { cache:{}, busy:{} };
const GC_EMPTY_MU = { mine:new Set(), opp:new Set(), oppName:'', pending:true };
function gcMatchupFor(lid, wk){
  lid=String(lid||''); wk=Number(wk||0); if(!lid || !wk) return null;
  const key=`${lid}|${wk}`;
  if(_gcMu.cache[key]) return _gcMu.cache[key];
  const L=(typeof _pcardLg!=='undefined' && _pcardLg && _pcardLg.byLeague) ? _pcardLg.byLeague[lid] : null;
  if(!L || L.myRosterId==null || !L.rosters) return null;          // the league's rosters have not loaded (or I am not in it)
  if(!_gcMu.busy[key] && typeof sleeperFetch==='function' && typeof LA_MATCHUPS_URL==='function'){
    _gcMu.busy[key]=true;
    sleeperFetch(LA_MATCHUPS_URL(lid, wk)).then(rows=>{
      const list=Array.isArray(rows)?rows:[];
      const me=list.find(m=>String(m.roster_id)===String(L.myRosterId));
      const opp=me ? list.find(m=>m.matchup_id!=null && m.matchup_id===me.matchup_id && String(m.roster_id)!==String(me.roster_id)) : null;
      const pids=(arr)=>(Array.isArray(arr)?arr:[]).filter(x=>x&&x!=='0').map(String);
      const oppR=opp ? L.rosters[String(opp.roster_id)] : null;
      _gcMu.cache[key]={ mine:new Set(pids(me&&me.starters).length?pids(me.starters):(L.rosters[String(L.myRosterId)]||{}).starters||[]),
        opp:new Set(pids(opp&&opp.starters)), oppName:oppR?oppR.owner:'', pending:false };
      _gc._mu=null;
      if(typeof gcDetailRepaint==='function') gcDetailRepaint(); else if(typeof renderRightSidebar==='function') renderRightSidebar();
    }).catch(()=>{ _gcMu.cache[key]={ mine:new Set(), opp:new Set(), oppName:'', pending:false, failed:true }; }).finally(()=>{ _gcMu.busy[key]=false; });
  }
  return null;
}
// The pane's league and week → the two line-ups. Falls back to the hub's current-week
// matchup while the read is out (or when the league is the hub's alone).
function gcMatchupSets(){
  const id=(typeof gcLeague==='function') ? gcLeague() : 'snap';
  const wk=(typeof gcWeek==='function') ? gcWeek() : 0;
  const hub=(typeof hubState!=='undefined' && hubState) ? hubState : null;
  const stamp=`${id}|${wk}|${hub?hub.loadedAt:0}|${Object.keys(_gcMu.cache).length}`;
  if(_gc._muAt===stamp && _gc._mu) return _gc._mu;
  let lid=id;
  if(id==='snap') lid=(typeof leagueSnapshot!=='undefined' && leagueSnapshot) ? String(leagueSnapshot.leagueId||'') : '';
  let out=null;
  if(id!=='app' && lid){
    const m=gcMatchupFor(lid, wk);
    if(m && !m.pending) out={ mine:m.mine, opp:m.opp };
    else if(hub && hub.results && hub.results[lid] && (typeof gcCurWeek!=='function' || wk===gcCurWeek())){
      const lu=hub.results[lid].lineup;
      out={ mine:new Set(((lu&&lu.starters)||[]).map(String)), opp:new Set(((lu&&lu.oppStarters)||[]).map(String)) };
    }
  }
  _gc._mu=out||{ mine:new Set(), opp:new Set() };
  _gc._muAt=stamp;
  return _gc._mu;
}
function gcIsOpp(pid){ return gcMatchupSets().opp.has(String(pid)); }
// The class a name wears: blue for your team, red for the one you are playing this week.
function gcSideClass(pid){ return gcIsMine(pid) ? ' gc-mine' : (gcIsOpp(pid) ? ' gc-opp' : ''); }
function gcIsMine(pid){
  const L=(typeof gcLeagueEntry==='function') ? gcLeagueEntry() : null;
  if(L){ const st=L.byPid && L.byPid[String(pid)]; return !!(st && st.mine); }
  if(typeof gcLeague==='function' && gcLeague()==='app') return false;
  return gcMineSet().has(String(pid));
}
// Sleeper's rows for the week, every position (one pull; the week in progress re-reads on
// the week cache's live TTL).
function gcRows(wk){
  const key=`${TC_SEASON.year}|${wk}`;
  if(_gc.rows[key] && (Date.now()-_gc.rows[key].at<60*1000 || wk<Math.max(1,Number(TC_SEASON.week||1)))) return _gc.rows[key].rows;
  if(wk>Math.max(1,Number(TC_SEASON.week||1))) return null;      // a week ahead has no stat lines yet
  if(!_gc.busy['rows'+key] && typeof fetchWeekStats==='function'){
    _gc.busy['rows'+key]=true;
    fetchWeekStats(String(TC_SEASON.year), wk, null).then(rows=>{ if(Array.isArray(rows) && rows.length){ _gc.rows[key]={rows, at:Date.now()}; (typeof tcRepaintWhenIdle==='function'?tcRepaintWhenIdle('rsb', renderRightSidebar):renderRightSidebar()); } }).catch(()=>{}).finally(()=>{ _gc.busy['rows'+key]=false; });
  }
  return _gc.rows[key] ? _gc.rows[key].rows : null;
}
// The unfiltered week pull carries the position under `player`; a filtered pull at the top.
function gcPos(r){ return String((r && (r.position || (r.player && r.player.position)))||'').toUpperCase(); }
function gcStatLine(row){
  const s=row.stats||{}, pos=gcPos(row);
  if(['QB','RB','WR','TE'].includes(pos) && typeof laBaflStatLine==='function'){ const l=laBaflStatLine(s, pos, false); if(l) return l; }
  const parts=[];
  if(pos==='K'){ if(s.fga!=null||s.fgm) parts.push(`${s.fgm||0}/${s.fga||0} FG`); if(s.xpa!=null||s.xpm) parts.push(`${s.xpm||0}/${s.xpa||0} XP`); return parts.join(', '); }
  if(pos==='DEF'){ if(s.pts_allow!=null) parts.push(`${s.pts_allow} PA`); if(s.sack) parts.push(`${s.sack} sack${s.sack===1?'':'s'}`); if(s.int) parts.push(`${s.int} INT`); if(s.ff||s.fum_rec) parts.push(`${s.fum_rec||0} FR`); if(s.def_td||s.td) parts.push(`${s.def_td||s.td} TD`); return parts.join(', '); }
  if(s.idp_tkl) parts.push(`${s.idp_tkl} tkl${s.idp_tkl_solo?` (${s.idp_tkl_solo} solo)`:''}`);
  if(s.idp_sack) parts.push(`${s.idp_sack} sack${s.idp_sack===1?'':'s'}`);
  if(s.idp_tkl_loss) parts.push(`${s.idp_tkl_loss} TFL`);
  if(s.idp_qb_hit) parts.push(`${s.idp_qb_hit} QB hit${s.idp_qb_hit===1?'':'s'}`);
  if(s.idp_pass_def) parts.push(`${s.idp_pass_def} PD`);
  if(s.idp_int) parts.push(`${s.idp_int} INT`);
  if(s.idp_ff) parts.push(`${s.idp_ff} FF`);
  if(s.idp_fum_rec) parts.push(`${s.idp_fum_rec} FR`);
  if(s.idp_def_td) parts.push(`${s.idp_def_td} TD`);
  return parts.join(', ');
}
function gcName(row){
  const p=row.player||{}; const n=`${p.first_name||''} ${p.last_name||''}`.trim() || (gcPos(row)==='DEF' ? `${row.player_id} D/ST` : String(row.player_id));
  if(gcPos(row)==='DEF') return n;
  return (typeof ldShortName==='function') ? ldShortName(n) : n;
}
// One side's players in one group, by points; the top few per group keep the panel short.
function gcSide(rows, team, group, limit){
  const posSet=new Set(group[2]);
  const rookiesOnly=_gc.pos==='RK' && typeof ldRookie==='function';
  return rows.filter(r=>String(r.team||(r.player&&r.player.team)||'').toUpperCase()===team && posSet.has(gcPos(r)) && r.stats && Object.keys(r.stats).length && (!rookiesOnly || ldRookie(r.player_id)))
    // A player with a stat line stays even when the loaded scoring has no number for him
    // (defenders under app scoring) — the line is the point; the points column shows "–".
    // the projection rides under the actual points (a game ahead IS the projection: none twice)
    .map(r=>({r, pts:gcPoints(r), line:gcStatLine(r), proj:(r.proj || typeof gcProjPts!=='function') ? null : gcProjPts(r.player_id, gcWeek())})).filter(x=>(x.pts!=null && x.pts!==0) || x.line)
    .sort((a,b)=>(b.pts||0)-(a.pts||0) || ((b.r.stats||{}).idp_tkl||0)-((a.r.stats||{}).idp_tkl||0)).slice(0, limit);
}
function gcPlayerHTML(x, side){
  const r=x.r; const owner=gcOwnerOf(r.player_id);
  const pid=String(r.player_id||''); const pos=gcPos(r);
  // a D/ST row opens the team defense's card (its id is the team code)
  const click = pos==='DEF' ? ` onclick="${pcardOnclick(String(r.team||pid).toUpperCase(), 'DEF', String(r.team||pid).toUpperCase())}"` : ` onclick="${pcardOnclick(pid, pos, r.team||'')}"`;
  // the number is a tap: where the points came from (Sleeper's score breakdown)
  _gcBrk[pid]=r;
  const tap = (x.pts!=null && !r.proj) ? ` onclick="gcPtsPop(event,'${escAttr(pid)}')" title="How the points add up"` : '';
  return `<div class="gc-p gc-p-${side}${r.proj?' gc-p-proj':''}"${click}>
    <div class="gc-pinfo">${owner?`<span class="gc-owner">${escHtml(owner)}</span>`:''}<span class="gc-pname${gcSideClass(pid)}">${escHtml(gcName(r))}</span>${x.line?`<span class="gc-line">${escHtml(x.line)}</span>`:''}</div>
    <span class="gc-ptsbox${tap?' gc-ptsbox-tap':''}"${tap}><b class="gc-pts">${x.pts!=null?x.pts.toFixed(2):'–'}</b>${x.proj!=null?`<small class="gc-proj" title="projected">${x.proj.toFixed(2)}</small>`:''}</span>
  </div>`;
}
// A game not yet played shows each side's players with the week's PROJECTED line — Sleeper's
// weekly projection (99b laWeekProjFeed) shaped like a stat row, scored the same way the
// week's actual rows are (the league's table, or the app's scoring and Sleeper's K/DEF points).
function gcProjRows(wk){
  const feed=(typeof laWeekProjFeed==='function') ? laWeekProjFeed(wk) : null;
  if(!feed) return null;
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers : {};
  const out=[];
  for(const pid in feed){
    const r=feed[pid]; if(!r || !r.stats) continue;
    const pos=String(r.pos||'').toUpperCase();
    if(pos==='DEF'){ out.push({player_id:pid, team:pid, position:'DEF', player:{first_name:'', last_name:'', position:'DEF', team:pid}, stats:r.stats, proj:true}); continue; }
    const p=sp[pid]; const name=(p&&p.name)||''; if(!name) continue;
    const i=name.lastIndexOf(' ');
    out.push({player_id:pid, team:String(r.team||p.team||'').toUpperCase(), position:pos||p.pos, player:{first_name:i>0?name.slice(0,i):'', last_name:i>0?name.slice(i+1):name, position:pos||p.pos, team:r.team||p.team}, stats:r.stats, proj:true});
  }
  return out;
}
function gcGameHTML(game, rows, wk){
  // A game still ahead: the projected lines stand in for the stat lines.
  const proj = game.state==='pre';
  if(proj) rows = gcProjRows(wk||gcWeek());
  // A game on now: the box score's lines (moving with the plays) over Sleeper's rows.
  if(!proj && game.state==='in' && typeof gcLiveRows==='function') rows = gcLiveRows(rows, game);
  // A position filter shows that group alone, in full; ALL and Rookies show every group.
  const pick=_gc.pos||'ALL';
  // Before the week's rows land there is nothing to group (the first paint of a fresh load;
  // the sidebar's try/catch used to swallow the throw and the rows' own re-render hid it).
  const groups=!rows ? '' : GC_GROUPS.filter(g=>pick==='ALL'||pick==='RK'||g[0]===pick).map(g=>{
    const lim=(pick==='ALL'||pick==='RK') ? (g[0]==='IDP'?5:4) : 20;
    const away=gcSide(rows, game.away, g, lim), home=gcSide(rows, game.home, g, lim);
    if(!away.length && !home.length) return '';
    const n=Math.max(away.length, home.length);
    const rowsHtml=Array.from({length:n},(_,i)=>`<div class="gc-row">${away[i]?gcPlayerHTML(away[i],'away'):'<div class="gc-p gc-p-empty"></div>'}${home[i]?gcPlayerHTML(home[i],'home'):'<div class="gc-p gc-p-empty"></div>'}</div>`).join('');
    return `<div class="gc-group"><div class="gc-gh gc-gh-${escAttr(g[0].toLowerCase())}"><span class="gc-gh-badge" title="${escAttr(g[1])}">${g[0]}</span></div>${rowsHtml}</div>`;
  }).join('');
  const st=game.state==='post'?'FINAL':game.state==='in'?(game.detail||'LIVE'):(game.detail||'');
  // The banner wears both clubs: the away colour from the left, the home colour from the
  // right, meeting in the middle (a translucent wash over the surface so the type holds),
  // the codes as faded wordmarks behind. Live, it carries the situation: the quarter and
  // clock in the middle with the down and spot beneath, a ball beside the score of the side
  // in possession, and each side's timeouts as three dots under its record.
  const col=(t)=>(typeof pwTeamColor==='function' ? pwTeamColor(t) : '#888');
  const sit=game.state==='in' ? (game.sit||null) : null;
  const dots=(n)=> (sit && sit.to && n!=null) ? `<span class="gc-to" title="${n} timeout${n===1?'':'s'} left">${[0,1,2].map(i=>`<i class="${i<n?'on':''}"></i>`).join('')}</span>` : '';
  const ball=(team)=> (sit && sit.poss===team) ? `<i class="gc-ball" title="${team} ball">${typeof TC_ICON==='function'?TC_ICON('football'):'●'}</i>` : '';
  const spot = sit ? (sit.phase ? '' : `${sit.ddt||''}${sit.spot?` @ ${sit.spot}`:''}${sit.rz?' <span class="gcf-rz">RZ</span>':''}`) : '';
  // While a game is ON the spot line is always in the DOM, empty or not. It used to come and
  // go with the down and distance — between plays, at a score, at a change of possession —
  // and the whole last-play / drive / win-probability block under the hero hopped each time.
  const mid = sit && sit.phase ? escHtml(sit.phase) : escHtml(st);
  // the club's nickname ("Falcons") when the seed names it, the code otherwise; the code
  // stays as the faded wordmark behind
  const nick=(t)=>{ const n=(typeof TEAM_NAMES!=='undefined' && TEAM_NAMES && TEAM_NAMES[t]) ? String(TEAM_NAMES[t]) : ''; const i=n.lastIndexOf(' '); return i>0 ? n.slice(i+1) : t; };
  const src = game.state==='pre' ? '' : `<div class="gc-src">ESPN</div>`;
  const won = game.state==='post' && game.as!=null && game.hs!=null && game.as!==game.hs ? (game.as>game.hs?'away':'home') : '';
  const hero=`<div class="gc-herowrap"><div class="gc-hero" style="--ga:${escAttr(col(game.away))};--gh:${escAttr(col(game.home))}">
      <img src="${(typeof NFL_LOGO_HI==='function'?NFL_LOGO_HI:NFL_LOGO)(game.away)}" class="gc-hero-wm gc-hero-wm-a" alt="" aria-hidden="true" onerror="this.style.display='none'"><img src="${(typeof NFL_LOGO_HI==='function'?NFL_LOGO_HI:NFL_LOGO)(game.home)}" class="gc-hero-wm gc-hero-wm-h" alt="" aria-hidden="true" onerror="this.style.display='none'">
      <div class="gc-side gc-side-away"><img src="${NFL_LOGO(game.away)}" class="gc-logo" onerror="this.style.display='none'"><span class="gc-team">${escHtml(nick(game.away))}</span><span class="gc-rec">${escHtml(game.arec)}</span>${dots(sit&&sit.to?sit.to.away:null)}</div>
      <b class="gc-score gc-score-a">${game.state==='pre'?'':(game.as!=null?game.as:'–')}${ball(game.away)}</b>
      <div class="gc-mid"><div class="gc-status ${game.state==='in'?'gc-live':''}${won?' gc-won-'+won:''}">${mid}</div>${(spot||game.state==='in')?`<div class="gc-spot">${spot}</div>`:''}${src}</div>
      <b class="gc-score gc-score-h">${game.state==='pre'?'':(game.hs!=null?game.hs:'–')}${ball(game.home)}</b>
      <div class="gc-side gc-side-home"><img src="${NFL_LOGO(game.home)}" class="gc-logo" onerror="this.style.display='none'"><span class="gc-team">${escHtml(nick(game.home))}</span><span class="gc-rec">${escHtml(game.hrec)}</span>${dots(sit&&sit.to?sit.to.home:null)}</div>
    </div></div>`;
  // The Vegas line under the banner: spread, over/under, each side's implied point total.
  const oddsHtml=(typeof gcOddsHTML==='function') ? gcOddsHTML(game) : '';
  // The fantasy pane: the league switcher, then the week's rows by position.
  const fantasy=`${typeof gcLeagueSelectHTML==='function' ? gcLeagueSelectHTML() : ''}
    ${proj ? `<div class="gc-projnote">projected · Sleeper's week ${wk||gcWeek()} line under this scoring</div>` : ''}
    ${rows ? (groups || `<div class="ld-empty">${proj?'no projections yet for this game':'no stat lines yet'}</div>`) : `<div class="ld-empty">${proj?'loading the week\'s projections…':'loading the week\'s stat lines…'}</div>`}`;
  if(typeof gcdTab!=='function') return hero+oddsHtml+fantasy;
  // Feed | Stats (32b-game-detail.js): the play feed, or the quarter line with Away | Fantasy | Home.
  const sum=(typeof gcSummary==='function') ? gcSummary(game) : null;
  if(game.state==='in' && typeof gcLiveTick==='function') gcLiveTick(game);   // a game on: the feed polls on its own clock
  const tab=gcdTab(game), side=_gcd.side||'fantasy';
  const tabs=`<div class="gc-tabs"><button class="gc-tab ${tab==='feed'?'active':''}" onclick="gcdSetTab('feed')">Feed</button><button class="gc-tab ${tab==='stats'?'active':''}" onclick="gcdSetTab('stats')">Stats</button></div>`;
  // Under the hero: the last play, the drive on the field, the win probability (32b).
  const top=(typeof gcTopHTML==='function') ? gcTopHTML(game, sum) : '';
  // Feed: on the desktop sidebar the hero, the field and the tabs stay put while the plays
  // scroll in their own window — so a play tapped for replay keeps animating in view (CSS
  // turns this off inside the phone's bottom sheet, where the whole sheet scrolls).
  const winbar=(typeof gcWinBarHTML==='function') ? gcWinBarHTML(game, sum) : '';
  if(tab==='feed') return `<div class="gc-feedview${_gcd.condensed?' gc-condensed':''}"><div class="gc-feedview-head">${hero}${oddsHtml}${top}${tabs}</div><div class="gc-feedview-feed" onscroll="gcFeedScrolled(this)">${gcFeedHTML(game, sum)}${winbar}</div></div>`;
  const seg=`<div class="gc-seg"><button class="${side==='away'?'active':''}" onclick="gcdSetSide('away')"><img src="${NFL_LOGO(game.away)}" class="gc-glogo" onerror="this.style.display='none'">${escHtml(nick(game.away))}</button><button class="${side==='fantasy'?'active':''}" onclick="gcdSetSide('fantasy')">Fantasy</button><button class="${side==='home'?'active':''}" onclick="gcdSetSide('home')"><img src="${NFL_LOGO(game.home)}" class="gc-glogo" onerror="this.style.display='none'">${escHtml(nick(game.home))}</button></div>`;
  const pane = side==='fantasy' ? fantasy : gcBoxHTML(game, sum, side==='home'?game.home:game.away);
  return hero+oddsHtml+top+tabs+(game.state==='pre'?'':gcLinescoreHTML(game, sum))+seg+pane;
}
// The Vegas line under the hero: the spread (stated from the favourite laying points), the
// over/under, and each team's implied point total — the market's forecast of how much each
// side scores. Rides the board's own poll, so it tracks the line as it moves; nothing shows
// until ESPN posts a line.
function gcOddsHTML(game){
  const a=game.aodds, h=game.hodds;
  if(!a && !h) return '';
  const total=(h&&h.total!=null)?h.total:(a&&a.total!=null?a.total:null);
  const book=(h&&h.book)||(a&&a.book)||'';
  let fav='';
  if(a && a.spread!=null && a.spread<0) fav=`${game.away} ${a.spread}`;
  else if(h && h.spread!=null && h.spread<0) fav=`${game.home} ${h.spread}`;
  const pk = !fav && ((a&&a.spread===0)||(h&&h.spread===0));
  const line = fav || (pk?'Pick’em':'');
  const imp=(o,code)=> (o&&o.implied!=null)?`<span class="gc-odds-imp"><b>${code}</b> ${o.implied.toFixed(1)}</span>`:'';
  if(!line && total==null && !(a&&a.implied!=null) && !(h&&h.implied!=null)) return '';
  return `<div class="gc-odds" title="Vegas line${book?` · ${escAttr(book)}`:''} — implied team total = the over/under split by the spread, the market's forecast of each team's points">
    <span class="gc-odds-mkt">${line?`<span class="gc-odds-spread">${escHtml(line)}</span>`:''}${total!=null?`<span class="gc-odds-ou">O/U ${total}</span>`:''}</span>
    <span class="gc-odds-imps" title="Implied team totals"><span class="gc-odds-tag">Implied</span>${imp(a,game.away)}${imp(h,game.home)}</span>
  </div>`;
}
function gcListHTML(games, picked){
  if(!games) return '<div class="ld-empty">loading games…</div>';
  // Pills: logo, score, the state in the middle (a red dot and the quarter while it is on,
  // FINAL, or the kickoff), score, logo — twice as many games in view as the old cards.
  const when=(g)=>{ const d=g.date?new Date(g.date):null; if(!d || isNaN(d)) return escHtml(g.detail||''); const day=d.toLocaleDateString('en-US',{month:'short',day:'numeric'}).toUpperCase(); const t=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).replace(' ',''); return `<span class="gc-pday">${day}</span><span class="gc-ptime">${t}</span>`; };
  const midOf=(g)=> g.state==='post' ? '<span class="gc-pfin">FINAL</span>'
    : g.state==='in' ? `<span class="gc-plive"><i class="gc-pdot"></i>${escHtml(String(g.detail||'LIVE').replace(/^(\d+:\d+) - (\d)(st|nd|rd|th)$/i,'Q$2'))}</span>`
    : when(g);
  return games.map(g=>`<div class="gc-game gc-pill ${g.id===picked?'gc-on':''} gc-${g.state}" data-key="${escAttr(g.id)}" onclick="gcPick('${g.id}')" title="${g.away} @ ${g.home}${g.state==='in'?' · '+escAttr(g.detail||'live'):''}">
    <span class="gc-pl"><img src="${NFL_LOGO(g.away)}" class="gc-glogo" onerror="this.style.display='none'">${g.state==='pre'?'':`<b class="${g.state==='post'&&g.as>g.hs?'gc-won':''}">${g.as!=null?g.as:'–'}</b>`}</span>
    <span class="gc-pmid">${midOf(g)}</span>
    <span class="gc-pr">${g.state==='pre'?'':`<b class="${g.state==='post'&&g.hs>g.as?'gc-won':''}">${g.hs!=null?g.hs:'–'}</b>`}<img src="${NFL_LOGO(g.home)}" class="gc-glogo" onerror="this.style.display='none'"></span>
  </div>`).join('');
}
// Phone Game Center week navigator — a horizontal rail of week pills (Sleeper's week slider):
// the viewed week filled accent, the live week marked with a dot. Tapping jumps the board.
function gcWeekRailHTML(){
  const cur=gcCurWeek(), wk=gcWeek(), last=gcLastWeek();
  let out='';
  for(let w=1; w<=last; w++){
    const lbl = w<=18 ? String(w) : String(gcWeekLabel(w)||('W'+w)).replace(/^Week\s*/,'');
    const on = w===wk, isCur = w===cur;
    out += `<button class="gc-wk${on?' gc-wk-on':''}${isCur?' gc-wk-cur':''}" onclick="gcSetWeek(${w===cur?"'current'":w})"${on?' aria-current="true"':''} title="${escAttr(gcWeekLabel(w))}">${escHtml(lbl)}${isCur?'<span class="gc-wk-dot"></span>':''}</button>`;
  }
  return `<div class="gc-wkrail">${out}</div>`;
}
// The panel. `phone` swaps the sidebar's size buttons for the sheet's close button; the
// markup is otherwise the same in both homes (the sheet's CSS turns the list into a rail).
function gcHTML(phone){
  const cur=gcCurWeek(), wk=gcWeek();
  const board=gcBoard(wk);
  const games=board ? gcGames(board) : null;
  if(games && games.length && !games.some(g=>g.id===_gc.game)) _gc.game=gcDefaultGame(games);
  const game=games ? games.find(g=>g.id===_gc.game) : null;
  const rows=gcRows(wk);
  const sel=`<select class="ld-sel" onchange="gcSetWeek(this.value)">${gcWeekOptions(cur).map(w=>`<option value="${w===cur?'current':w}" ${wk===w?'selected':''}>${gcWeekLabel(w)}${w===cur?' · now':w===cur+1?' · next':w>cur?' · upcoming':''}</option>`).join('')}</select>`;
  const weekNav = phone ? gcWeekRailHTML() : '';
  const lgE=(typeof gcLeagueEntry==='function') ? gcLeagueEntry() : null;
  const fmt=gcScoring() ? escHtml((lgE && lgE.name) || (typeof leagueSnapshot!=='undefined' && leagueSnapshot && leagueSnapshot.name) || 'league scoring') : 'TripleCrown · Sleeper for K/DEF/IDP';
  // No position filter row here: the fantasy pane already groups every position, and a
  // game's two rosters are short enough to read whole (the Rankings page keeps its filters).
  const btns=phone ? '' : rsbButtonsHTML();   // the sheet closes by its handle or the scrim
  // The live feed takes the whole panel: its own filters, no week or position rows.
  if(_gc.view==='feed' && typeof lfBodyHTML==='function'){
    return `<div class="gc lf">
      <div class="gc-head"><div class="sidebar-section ld-title">Game Center</div>${btns}</div>
      ${gcViewRowHTML()}
      ${lfBodyHTML()}
    </div>`;
  }
  return `<div class="gc">
    <div class="gc-head"><div class="sidebar-section ld-title">Game Center</div>${phone?'':sel}${btns}</div>
    ${gcViewRowHTML()}
    ${weekNav}
    <div class="ld-fmt" title="Points under this scoring">${fmt}</div>
    <div class="gc-body"><div class="gc-list">${gcListHTML(games, _gc.game)}</div><div class="gc-detail">${game ? gcGameHTML(game, rows, wk) : (games && !games.length ? '<div class="ld-empty">no games this week</div>' : '')}</div></div>
  </div>`;
}
// The size buttons every state carries.
// The sidebar's controls, each saying what it does: the two panels as a pair — Leaders
// (the week's top scorers) and Game Center (one game at a time) — with the one that is up
// lit, and a chevron that tucks the sidebar away. (They were − and +, which stepped through
// rail → Leaders → Game Center and read as a size, not a choice.)
function rsbButtonsHTML(){
  const ico=(k)=>(typeof TC_ICON==='function')?TC_ICON(k):'';
  const on=(m)=>_gc.mode===m?' active':'';
  return `<span class="rsb-btns"><span class="rsb-seg" role="tablist" aria-label="Sidebar panel">`
    + `<button class="rsb-btn rsb-seg-btn${on('normal')}" role="tab" aria-selected="${_gc.mode==='normal'}" onclick="gcSetMode('normal')" title="Leaders — the week's top scorers">${ico('trophy')}</button>`
    + `<button class="rsb-btn rsb-seg-btn${on('max')}" role="tab" aria-selected="${_gc.mode==='max'}" onclick="gcSetMode('max')" title="Game Center — one game at a time">${ico('scoreboard')}</button>`
    + `</span><button class="rsb-btn rsb-hide" onclick="gcSetMode('min')" title="Hide the sidebar" aria-label="Hide the sidebar">${ico('chevr')}</button></span>`;
}
function _rsbButtonsLegacy(){
  const i=GC_MODES.indexOf(_gc.mode);
  const dis=(on)=>on?'':' disabled';
  return `<span class="rsb-btns"><button class="rsb-btn" onclick="gcStep(-1)" title="Narrower"${dis(i>0)}>−</button><button class="rsb-btn" onclick="gcStep(1)" title="Wider"${dis(i<GC_MODES.length-1)}>+</button></span>`;
}
// The one entry point: the sidebar in its current size — and, on a phone, the Games sheet
// instead (every repaint funnels through here, the live timers included, so both homes stay
// current from one place).
function renderRightSidebar(){
  if(gcInGamesView()){ renderGamesView(); return; }
  try{ renderGamesPhone(); }catch(e){}
  const el=(typeof ldHost==='function')?ldHost():null; if(!el) return;
  if(typeof ldOn==='function' && !ldOn()){ el.hidden=true; return; }
  el.hidden=false;
  el.classList.remove('rsb-min','rsb-max');
  gcApplyWidth(el);
  if(_gc.mode==='min'){ el.classList.add('rsb-min'); el.innerHTML=`<div class="rsb-rail"><button class="rsb-btn rsb-show" onclick="gcOpenLast()" title="Show the sidebar" aria-label="Show the sidebar">${(typeof TC_ICON==='function')?TC_ICON('chevl'):'‹'}</button><span class="rsb-vert">LEADERS · GAMES</span></div>`; return; }
  if(_gc.mode==='max'){ el.classList.add('rsb-max'); tcMorph(el, rsbGripHTML()+gcHTML()); return; }
  if(typeof renderLeaders==='function') renderLeaders();
  if(el.querySelector && el.querySelector('.rsb-grip')) return;   // the grip persists across in-place repaints
  if(el.insertAdjacentHTML) el.insertAdjacentHTML('afterbegin', rsbGripHTML()); else el.innerHTML=rsbGripHTML()+el.innerHTML;
}
gcLoadMode();

// ═════════════════════════════════════════════════════════════════════════════
// The Games sheet — the Game Center on a phone
// ═════════════════════════════════════════════════════════════════════════════
// A phone has no room for a sidebar, so the Game Center takes the corner and the drawer the
// draft follow uses in the pre-season: a pill bottom-right (the draft's LIVE pill, red and
// glowing while a game is on, quiet between games) and a bottom sheet with two heights —
// half is the week's games as a rail of chips in kickoff order with the picked game's
// banner; full is every position group. Nothing in the page moves: the sheet overlays and
// reserves no height, and off-season (or while a draft is being followed, which owns the
// same corner) nothing renders at all. Same gcHTML() as the sidebar; the CSS does the rest.
var _gcm = { open:'closed', timer:null, drag:null, seen:null };
const GCM_OPEN = ['closed','half','full'];
function gcPhoneOn(){
  return typeof hasSeasonStarted==='function' && hasSeasonStarted()
    && typeof TC_SEASON!=='undefined' && TC_SEASON.week>=1
    && typeof isMobileTeamPickerLayout==='function' && isMobileTeamPickerLayout()
    && !(typeof rosterBarVisible!=='undefined' && rosterBarVisible);   // a draft in progress keeps its drawer
}
function gcmHost(){
  let el=document.getElementById('gamesSheet');
  if(!el){
    if(!document.body || !document.createElement) return null;
    el=document.createElement('div'); el.id='gamesSheet'; el.className='gcm-host';
    document.body.appendChild(el);
  }
  return el;
}
function gcmSet(v){ if(!GCM_OPEN.includes(v)) return; _gcm.open=v; renderGamesPhone(); }
// A horizontal swipe across the sheet: on the Games page it turns to the next or previous
// game in kickoff order (past the last game → the Leaders page); on the Leaders page a
// swipe right returns to the games. The rail (a scroller) and the grab handle keep their
// own gestures. Pure: what the swipe does, so it can be tested without a touch.
function gcmSwipeAction(dx, tab){
  if(Math.abs(dx)<60) return null;
  if(tab==='leaders') return dx>0 ? {tab:'games'} : null;
  const games=gcmCurrentGames()||[];
  if(!games.length) return dx<0 ? {tab:'leaders'} : null;
  const i=games.findIndex(g=>g.id===_gc.game);
  if(i<0) return null;                                   // the board has not caught up: stay put
  if(dx<0) return i<games.length-1 ? {game:games[i+1].id} : {tab:'leaders'};
  return i>0 ? {game:games[i-1].id} : null;
}
function gcmApplySwipe(act){ if(!act) return; if(act.tab) gcmSetTab(act.tab); else if(act.game) gcPick(act.game); }
// The page a swipe is heading for, rendered for the underlay: the neighbouring game's
// panel (its own hero and lines) so it slides in under the finger like the app's tabs do.
function gcmSwipePreviewHTML(act){
  if(!act || !act.game) return '';
  const wk=gcWeek(); const games=gcmCurrentGames()||[]; const g=games.find(x=>x.id===act.game);
  return g ? gcGameHTML(g, gcRows(wk), wk) : '';
}
// The panel's children move as one layer: wrap them once per gesture (a repaint replaces
// the panel's markup, so the wrapper never outlives the gesture).
function gcmSwipeLayer(host){
  if(!host || !host.querySelector) return null;
  let top=host.querySelector(':scope > .ts-swipe-top');
  if(top) return top;
  top=document.createElement('div'); top.className='ts-swipe-top';
  while(host.firstChild) top.appendChild(host.firstChild);
  host.appendChild(top);
  return top;
}
function gcmBindSwipe(sheet){
  if(!sheet || !sheet.addEventListener || sheet._gcmSwipe) return; sheet._gcmSwipe=true;
  let x0=null, y0=null, axis=null, claimed=false, host=null, act=null, dx=0;
  const start=e=>{ const t=e.touches&&e.touches[0]; if(!t) return; x0=t.clientX; y0=t.clientY; axis=null; dx=0; act=null;
    claimed=!!(e.target && e.target.closest && e.target.closest('.gc-list,.gcm-grab,select,.ld-sel'));
    host=(_gcm.tab==='leaders') ? sheet.querySelector('.gcm-leaders') : sheet.querySelector('.gc-detail'); };
  const move=e=>{ if(x0==null || claimed || !host) return; const t=e.touches&&e.touches[0]; if(!t) return;
    const ddx=t.clientX-x0, ddy=t.clientY-y0;
    if(!axis){
      if(Math.abs(ddx)<10 && Math.abs(ddy)<10) return;
      axis = Math.abs(ddx)>Math.abs(ddy) ? 'x' : 'y';
      if(axis==='x'){
        act=gcmSwipeAction(Math.sign(ddx)*100, _gcm.tab||'games');
        if(act){ _gcm.swiping=true; gcmSwipeLayer(host); host.classList.add('ts-swipe-dragging');   // no repaint under the finger
          if(act.game && typeof tsSwipeUnder==='function'){ const under=tsSwipeUnder(host); under.style.transition=''; under.innerHTML=gcmSwipePreviewHTML(act); } }
      }
    }
    if(axis!=='x') return;
    e.stopPropagation(); if(e.cancelable) e.preventDefault();          // the sheet owns this swipe, not the page's tabs
    dx=ddx; if(!act) return;
    const w=(typeof tsHostWidth==='function')?tsHostWidth(host):320;
    const shift=Math.sign(dx)*Math.min(w, Math.abs(dx)*0.9);
    const top=gcmSwipeLayer(host); top.style.transition='';
    if(act.game && typeof tsPlacePair==='function') tsPlacePair(host, shift, dx<0?-1:1);
    else top.style.transform=`translateX(${shift.toFixed(1)}px)`;
  };
  const end=e=>{ if(x0==null) return; const wasX=axis==='x', fdx=dx, a=act, h=host; x0=null; axis=null;
    if(!wasX || claimed || !h){ if(_gcm.swiping){ _gcm.swiping=false; } return; }
    e.stopPropagation();
    const w=(typeof tsHostWidth==='function')?tsHostWidth(h):320;
    const top=gcmSwipeLayer(h), under=h.querySelector(':scope > .ts-swipe-under');
    if(a && Math.abs(fdx)>=60){
      top.style.transition='transform .18s ease-out'; top.style.transform=`translateX(${fdx<0?-w:w}px)`;
      if(under){ under.style.transition='transform .18s ease-out'; under.style.transform='translateX(0px)'; }
      setTimeout(()=>{ h.classList.remove('ts-swipe-dragging'); _gcm.swiping=false; gcmApplySwipe(a); }, 170);
    } else {
      top.style.transition='transform .16s ease-out'; top.style.transform='translateX(0px)';
      if(under){ under.style.transition='transform .16s ease-out'; under.style.transform=`translateX(${fdx<0?w:-w}px)`; }
      setTimeout(()=>{ h.classList.remove('ts-swipe-dragging'); if(under) under.innerHTML=''; top.style.transition=''; _gcm.swiping=false; renderGamesPhone(); }, 170);
    }
  };
  sheet.addEventListener('touchstart', start, {passive:true});
  sheet.addEventListener('touchmove', move, {passive:false});
  sheet.addEventListener('touchend', end, {passive:true});
  sheet.addEventListener('touchcancel', end, {passive:true});
}
// The picker bar's live line and the pill both open straight to a game.
function gcOpenGame(id){ _gc.week='current'; if(id) _gc.game=id; if(gcInGamesView()){ renderGamesView(); return; } _gcm.open='full'; renderGamesPhone(); }
// The mobile bottom bar's Games tab is a full top-level VIEW (like Projections / Rankings /
// Leagues), rendered into #content — not the old slide-up sheet. These drive it.
function gcInGamesView(){ return typeof currentPhase!=='undefined' && currentPhase==='Games'; }
function showGamesView(e){
  if(e && e.stopPropagation) e.stopPropagation();
  if(typeof currentPhase==='undefined') return;
  currentPhase='Games';
  if(typeof renderContent==='function') renderContent();
  if(typeof syncAppChrome==='function') syncAppChrome();
}
// Render the Game Center into the main content area. Same panel the sheet used (gcHTML(true))
// plus the Games/Leaders tab row; the live timer keeps it fresh in place, as the sheet did.
function renderGamesView(){
  const host=(typeof document!=='undefined' && document.getElementById) ? document.getElementById('content') : null;
  if(!host) return;
  if(_gcm.timer){ clearTimeout(_gcm.timer); _gcm.timer=null; }
  // The retired slide-up sheet must never also be up (nor its page lock).
  const sheet=document.getElementById('gamesSheet'); if(sheet){ sheet.hidden=true; sheet.innerHTML=''; }
  try{ document.documentElement.classList.remove('gcm-locked'); }catch(e){}
  if(document.body && document.body.classList) document.body.classList.remove('gcm-open');
  tcSyncGamesTab();
  const body0=host.querySelector?host.querySelector('.gc-body'):null, rail0=host.querySelector?host.querySelector('.gc-list'):null;
  const keep={ body:body0?body0.scrollTop:0, rail:rail0?rail0.scrollLeft:0 };
  const tab=_gcm.tab||'games';
  // Subtract the content padding so the leaders panel sizes its columns to the real width —
  // on a phone an over-counted width added a stat column and squeezed the names to an ellipsis.
  const width=Math.max(240, ((typeof window!=='undefined' && window.innerWidth) ? window.innerWidth : 390) - 28);
  const page = tab==='leaders' && typeof ldPanelHTML==='function'
    ? `<div class="gc gcm-leaders">${ldPanelHTML(width, '', false, true)}</div>`
    : gcHTML(true);
  tcMorph(host, `<div class="games-view">${gcmTabsHTML()}${page}</div>`);   // in place: only what moved repaints
  const body=host.querySelector('.gc-body'), rail=host.querySelector('.gc-list');
  if(body) body.scrollTop=keep.body;
  if(rail){ const on=rail.querySelector('.gc-on'); if(on && on.scrollIntoView && !rail0) on.scrollIntoView({block:'nearest', inline:'center'}); else rail.scrollLeft=keep.rail; }
  const wkOn=host.querySelector('.gc-wk-on'); if(wkOn && wkOn.scrollIntoView) wkOn.scrollIntoView({block:'nearest', inline:'center'});
  if(gcWeek()===gcCurWeek() && typeof window!=='undefined' && typeof window.setTimeout==='function'
     && (typeof document==='undefined' || document.visibilityState!=='hidden')){
    _gcm.timer=window.setTimeout(()=>{ _gcm.timer=null; if(gcInGamesView()){ if(typeof tcRepaintWhenIdle==='function') tcRepaintWhenIdle('rsb', renderGamesView); else renderGamesView(); } }, 61*1000);
  }
}
// Repaint whichever Game-Center surface is live: the full view, or (legacy) the sheet.
function gcSheetRepaint(){ if(gcInGamesView()) renderGamesView(); else if(typeof renderGamesPhone==='function') renderGamesPhone(); }
// Keep the Games tab's live dot in sync with the board — the at-a-glance signal the floating
// pill used to carry (now hidden on mobile). Safe to call any time; no-ops without the tab.
function tcSyncGamesTab(){
  if(typeof document==='undefined' || !document.getElementById) return;
  const btn=document.getElementById('tabGames'); if(!btn) return;
  const on = typeof gcPhoneOn==='function' && gcPhoneOn();
  const games = (on && typeof gcmCurrentGames==='function') ? (gcmCurrentGames()||[]) : [];
  const live = games.filter(g=>g && g.state==='in').length;
  btn.classList.toggle('tc-tab-live', live>0);
}// The current week's games, whatever week the sheet is showing — the pill reads the present.
function gcmCurrentGames(){
  // The week the sheet is SHOWING — reading the current week here sent every swipe on a
  // past week to that week's first game, since the picked game was never in the list.
  const board=gcBoard(gcWeek());
  return board ? gcGames(board) : null;
}
// The sheet's two pages: the week's games, and the Leaders — the same ranked list the
// desktop sidebar shows (weekly high scores by position, sortable), in the phone's drawer.
const GCM_TABS=[['games','Games'],['leaders','Leaders']];
function gcmSetTab(t){ if(!GCM_TABS.some(x=>x[0]===t)) return; _gcm.tab=t; if(!gcInGamesView() && _gcm.open==='closed') _gcm.open='half'; gcSheetRepaint(); }
function gcmTabsHTML(){
  const cur=_gcm.tab||'games';
  return `<div class="ld-posrow gcm-tabs">${GCM_TABS.map(([k,l])=>`<button class="ld-pos ${cur===k?'active':''}" onclick="gcmSetTab('${k}')">${l}</button>`).join('')}</div>`;
}
// The pill's words: how many games are on (and how many are done), the next kickoff when
// none is, or just the week's final tally.
function gcmPillHTML(games){
  const live=(games||[]).filter(g=>g.state==='in').length;
  const done=(games||[]).filter(g=>g.state==='post').length;
  const next=(games||[]).find(g=>g.state==='pre');
  let cls='gcm-pill', body;
  if(live){ cls+=' gcm-live'; body=`<span class="gcm-dot"></span><b class="gcm-n">${live}</b> LIVE${done?`<span class="gcm-idle"> · ${done} final</span>`:''}`; }
  else if(!games) body='Games';
  else if(next) body=`Games<span class="gcm-idle"> · ${escHtml(next.detail||'')}</span>`;
  else body=`Games<span class="gcm-idle"> · Week ${gcWeek()} final</span>`;
  return `<button class="${cls}" onclick="gcmSet('half')" aria-label="Open Game Center">${body}</button>`;
}
// The selected team's line for the mobile team picker's toggle: score and clock while its
// game is on (the phone's version of the sidebar's red dot and record); tapping it opens the
// sheet on that game. Empty otherwise — the bar keeps its usual width.
function gcPickerLineHTML(team){
  if(!gcPhoneOn() || typeof tcTeamGameState!=='function') return '';
  const g=tcTeamGameState(team); if(!g || g.state!=='in') return '';
  const t=String(team||'').toUpperCase(), home=g.home?t:g.opp, away=g.home?g.opp:t;
  const line=`${t} ${g.score!=null?g.score:'–'}–${g.oppScore!=null?g.oppScore:'–'} ${g.opp}`;
  return `<span class="team-picker-live" role="button" onclick="event.stopPropagation();gcOpenGame('${escAttr(`${away}@${home}`)}')" title="Open in the Game Center"><span class="gcm-dot"></span>${escHtml(line)} <span class="team-picker-clock">${escHtml(g.detail||'LIVE')}</span></span>`;
}
// Drag the handle: the sheet's height follows the finger, then settles — a quick flick
// advances one state in its direction (down closes from anywhere), a slow drag lands on the
// nearest. The sheet body keeps its own scroll; gestures start only on the handle and head.
function gcmDragStart(ev){
  const host=gcmHost(); const sh=host&&host.querySelector?host.querySelector('.gcm-sheet'):null; if(!sh) return;
  if(ev && ev.preventDefault) ev.preventDefault();
  const vh=(typeof window!=='undefined'&&window.innerHeight)||640;
  _gcm.drag={ y:ev.clientY, h0:sh.getBoundingClientRect().height, t0:Date.now(), moved:false, half:Math.round(vh*0.46), max:vh-96, sh };
  sh.classList.add('gcm-dragging');
  const move=(e)=>{ const d=_gcm.drag; if(!d) return; const dy=e.clientY-d.y; if(!d.moved && Math.abs(dy)<6) return; d.moved=true;
    d.sh.style.height=Math.max(0, Math.min(d.max, d.h0-dy))+'px'; };
  const up=(e)=>{ window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    const d=_gcm.drag; _gcm.drag=null; if(!d) return;
    d.sh.classList.remove('gcm-dragging'); d.sh.style.height='';
    if(!d.moved) return;
    const dy=e.clientY-d.y, h=Math.max(0, Math.min(d.max, d.h0-dy));
    const flick=(Date.now()-d.t0)<280 && Math.abs(dy)>30;
    let to;
    if(flick) to = dy<0 ? 'full' : 'closed';
    else to = h<d.half*0.5 ? 'closed' : (h<(d.half+d.max)/2 ? 'half' : 'full');
    gcmSet(to); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
function renderGamesPhone(fromLoad){
  const host=(typeof document!=='undefined' && document.getElementById) ? gcmHost() : null; if(!host) return;
  if(_gcm.timer){ clearTimeout(_gcm.timer); _gcm.timer=null; }
  tcSyncGamesTab();
  if(!gcPhoneOn()){ host.innerHTML=''; host.hidden=true; if(document.body&&document.body.classList) document.body.classList.remove('gcm-open'); try{ document.documentElement.classList.remove('gcm-locked'); }catch(e){} return; }
  if(_gcm.drag || _gcm.swiping) return;       // mid-gesture (a height drag or a page swipe): the markup is already there
  host.hidden=false;
  const games=gcmCurrentGames();
  const open=_gcm.open;
  // Keep the reader's place across the minute repaint: the rail's scroll and the body's.
  const body0=host.querySelector?host.querySelector('.gc-body'):null, rail0=host.querySelector?host.querySelector('.gc-list'):null;
  const keep={ body:body0?body0.scrollTop:0, rail:rail0?rail0.scrollLeft:0, game:_gc.game };
  const tab=_gcm.tab||'games';
  const width=(typeof window!=='undefined' && window.innerWidth) ? window.innerWidth : 390;
  const closeBtn='';   // the sheet closes by its handle or the scrim, not a button
  const page = open==='closed' ? ''
    : tab==='leaders' && typeof ldPanelHTML==='function'
      ? `<div class="gc gcm-leaders">${ldPanelHTML(width, closeBtn, fromLoad, true)}</div>`
      : gcHTML(true);
  // Patched in place (tcMorph): a live repaint lands as the few nodes that changed, not a
  // fresh 200 KB subtree — the sheet element, its scroll and its swipe binding all persist.
  tcMorph(host, `${gcmPillHTML(games)}
    <div class="gcm-scrim" onclick="gcmSet('closed')"></div>
    <div class="gcm-sheet gcm-${open}" aria-label="Game Center" aria-hidden="${open==='closed'}">
      <div class="gcm-grab" onpointerdown="gcmDragStart(event)"></div>
      ${open==='closed' ? '' : gcmTabsHTML()}
      ${page}
    </div>`);
  if(document.body&&document.body.classList) document.body.classList.toggle('gcm-open', open!=='closed');
  // An open sheet locks the page behind it, like the player card does (html.pcard-locked):
  // nothing under an overlay scrolls, on any platform.
  try{ document.documentElement.classList.toggle('gcm-locked', open!=='closed'); }catch(e){}
  if(open!=='closed' && host.querySelector) gcmBindSwipe(host.querySelector('.gcm-sheet'));
  if(open!=='closed' && host.querySelector){
    const body=host.querySelector('.gc-body'), rail=host.querySelector('.gc-list');
    if(body) body.scrollTop=keep.body;
    // The picked game's chip is in view on open and whenever the pick changes; otherwise the
    // rail stays where the finger left it.
    const on=rail?rail.querySelector('.gc-on'):null;
    if(rail && on && (_gcm.seen!==_gc.game || !rail0)){ if(on.scrollIntoView) on.scrollIntoView({block:'nearest', inline:'center'}); _gcm.seen=_gc.game; }
    else if(rail) rail.scrollLeft=keep.rail;
  }
  // The week in progress keeps up: a repaint a minute from now re-reads the board and rows.
  if(gcWeek()===gcCurWeek() && typeof window!=='undefined' && typeof window.setTimeout==='function'
     && (typeof document==='undefined' || document.visibilityState!=='hidden')){
    _gcm.timer=window.setTimeout(()=>{ _gcm.timer=null; if(typeof tcRepaintWhenIdle==='function') tcRepaintWhenIdle('rsb', renderGamesPhone); else renderGamesPhone(); }, 61*1000);
  }
}

// ── The balance between the pinned field and the scrolling plays ───────────────────
// On the sidebar's feed the hero, the field and the win probability stay put while the plays
// scroll underneath. Pinned at full height they left the plays two rows of room. So the
// block CONDENSES the moment the feed is scrolled — the hero to one slim line, the last-play
// text, the odds, the drive sentence and the win-probability chart folded away, the field
// kept — and opens back up at the top of the feed. A pane too short to give the plays a fair
// window starts condensed. The flag lives in _gcd so a repaint keeps the state; the class is
// toggled in place so a scroll never costs a repaint.
const GC_FEED_MIN_SHARE=0.42;   // the plays deserve at least this much of the pane when open
function gcFeedScrolled(el){
  try{
    if(!el) return;
    const y=el.scrollTop||0;
    if(y>28 && !_gcd.condensed) gcFeedCondense(true, el);
    else if(y<6 && _gcd.condensed && !_gcd.condensedShort) gcFeedCondense(false, el);
  }catch(e){}
}
function gcFeedCondense(on, feedEl){
  _gcd.condensed=!!on;
  const fv=feedEl ? feedEl.closest('.gc-feedview') : document.querySelector('.gc-feedview');
  if(fv && fv.classList) fv.classList.toggle('gc-condensed', !!on);
}
// After a paint: if the open block leaves the plays under their share of the pane, condense
// from the start (and remember it was the pane's height, not a scroll, that did it).
function gcFeedBalance(){
  try{
    const fv=document.querySelector('.gc-detail .gc-feedview'); if(!fv) return;
    const feed=fv.querySelector('.gc-feedview-feed'), det=fv.closest('.gc-detail'); if(!feed || !det) return;
    if(window.getComputedStyle && window.getComputedStyle(feed).overflowY!=='auto') return;   // the phone sheet scrolls as one page
    const share=feed.clientHeight/Math.max(1, det.clientHeight);
    if(!_gcd.condensed && share<GC_FEED_MIN_SHARE){ _gcd.condensedShort=true; gcFeedCondense(true, feed); }
    else if(_gcd.condensedShort && _gcd.condensed && feed.scrollTop<6){
      // would there be room if it opened? measure by opening for a frame
      fv.classList.remove('gc-condensed');
      const openShare=feed.clientHeight/Math.max(1, det.clientHeight);
      if(openShare>=GC_FEED_MIN_SHARE){ _gcd.condensedShort=false; _gcd.condensed=false; }
      else fv.classList.add('gc-condensed');
    }
  }catch(e){}
}
// The phone: the whole page (or the sheet's body) scrolls and the block is sticky, so the
// scroll to watch is that scroller's. The signal is the feed view's own top passing the
// scroller's top — not an inner scrollTop — which holds whatever sits above it.
function gcFeedWatchScroll(scroller){
  try{
    const fv=document.querySelector('.gc-feedview'); if(!fv) return;
    const feed=fv.querySelector('.gc-feedview-feed');
    if(feed && window.getComputedStyle && window.getComputedStyle(feed).overflowY==='auto') return;   // the desktop window has its own handler
    const isWin=(scroller===window || !scroller || !scroller.getBoundingClientRect);
    const top0=isWin ? 0 : scroller.getBoundingClientRect().top;
    const y=top0 - fv.getBoundingClientRect().top;
    if(y>28 && !_gcd.condensed){ gcFeedCondense(true, feed); if(isWin) gcFeedPin(fv, true); }
    else if(y<6 && _gcd.condensed){ _gcd.condensedShort=false; gcFeedCondense(false, feed); if(isWin) gcFeedPin(fv, false); }
    else if(isWin && _gcd.condensed) gcFeedPin(fv, true);   // a repaint dropped the inline pin: put it back
  }catch(e){}
}
// The full-page Games view scrolls the window, but the page's content column is an
// overflow:auto box that never scrolls itself — which is exactly the ancestor that breaks
// position:sticky. So on the window the block is pinned by hand: fixed to the top, the
// feed view padded by the block's height so the plays do not jump up under it.
function gcFeedPin(fv, on){
  const head=fv.querySelector('.gc-feedview-head'); if(!head) return;
  if(!on){ head.style.position=''; head.style.top=''; head.style.left=''; head.style.width=''; head.style.zIndex=''; fv.style.paddingTop=''; fv.style.transition=''; fv.classList.remove('gc-pinned'); if(_gcd.pinT){ clearTimeout(_gcd.pinT); _gcd.pinT=null; } return; }
  if(fv.classList.contains('gc-pinned') && head.style.position==='fixed') return;
  const r=fv.getBoundingClientRect();
  fv.classList.add('gc-pinned');
  head.style.position='fixed'; head.style.top='0px'; head.style.left=r.left+'px'; head.style.width=r.width+'px'; head.style.zIndex='30';
  // the block is mid-transition when it pins: hold the plays where they are now, then ease
  // the placeholder down to the block's settled height once it has shrunk
  fv.style.paddingTop=head.getBoundingClientRect().height+'px';
  fv.style.transition='padding-top .26s ease';
  if(_gcd.pinT) clearTimeout(_gcd.pinT);
  _gcd.pinT=setTimeout(()=>{ try{ if(fv.classList.contains('gc-pinned')) fv.style.paddingTop=head.getBoundingClientRect().height+'px'; }catch(e){} }, 340);
}
if(typeof window!=='undefined' && window.addEventListener){
  window.addEventListener('resize', ()=>{ try{ if(window.requestAnimationFrame) window.requestAnimationFrame(gcFeedBalance); else gcFeedBalance(); }catch(e){} });
  window.addEventListener('scroll', ()=>gcFeedWatchScroll(window), {passive:true});
}
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('scroll', (e)=>{ const t=e.target; if(t && t.classList && t.classList.contains('gc-body')) gcFeedWatchScroll(t); }, true);
}
