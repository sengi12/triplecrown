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
var _gc = { mode:'normal', week:'current', game:null, pos:'ALL', boards:{}, rows:{}, busy:{}, dragW:0 };
const GC_MODES = ['min','normal','max'];
const GC_POS = ['ALL','QB','RB','WR','TE','K','DEF','IDP','RK'];   // the Rankings page's filters, plus the defensive groups
const GC_GROUPS = [['QB','Quarterback',['QB']],['RB','Running back',['RB','FB']],['WR','Wide receiver',['WR']],['TE','Tight end',['TE']],['K','Kicker',['K']],['DEF','Defense / ST',['DEF']],['IDP','Defenders',['DL','DE','DT','NT','LB','OLB','ILB','MLB','DB','CB','S','SS','FS']]];

function gcLoadMode(){ try{ const m=localStorage.getItem('tc_rsb'); if(GC_MODES.includes(m)) _gc.mode=m; }catch(e){} }
function gcSetMode(m){ if(!GC_MODES.includes(m)) return; _gc.mode=m; try{ localStorage.setItem('tc_rsb', m); }catch(e){} renderRightSidebar(); }
function gcSetWeek(v){ _gc.week = v==='current' ? 'current' : Number(v); _gc.game=null; renderRightSidebar(); }
// Picking a game from the phone's half-open sheet also pulls the sheet up: the game list is
// the half state's point, the picked game's lines are the full state's.
function gcPick(id){ _gc.game=id; if(typeof _gcm!=='undefined' && _gcm.open==='half') _gcm.open='full'; renderRightSidebar(); }
// "Now" is the tracker's week: the finished week holds through Tuesday and until Wednesday
// 06:00 Eastern (tcTrackerWeek), so Tuesday's look still opens on everything that happened.
function gcCurWeek(){ return (typeof tcTrackerWeek==='function') ? tcTrackerWeek() : Math.max(1, Number(TC_SEASON.week||1)); }
function gcWeek(){ const cur=gcCurWeek(); return _gc.week==='current' ? cur : Math.min(cur, _gc.week); }

// Exact Sleeper scoring: Σ stat × the league's setting over the keys both carry.
function tcSleeperPoints(stats, sc){
  if(!stats || !sc) return null;
  let f=0, n=0;
  for(const k in sc){ const v=stats[k]; if(typeof v==='number' && typeof sc[k]==='number' && v){ f+=v*sc[k]; n++; } }
  return Math.round(f*100)/100;
}
function gcScoring(){ return (typeof leagueSnapshot!=='undefined' && leagueSnapshot && leagueSnapshot.scoringRaw) || null; }
function gcPoints(row){
  const sc=gcScoring(), st=row.stats||{};
  if(sc) return tcSleeperPoints(st, sc);
  const pos=gcPos(row)||String(row.pos||'').toUpperCase();
  if(['QB','RB','WR','TE'].includes(pos) && typeof ldPoints==='function') return ldPoints({pos, stats:st});
  return st.pts_half_ppr!=null ? +st.pts_half_ppr : (st.pts_std!=null ? +st.pts_std : null);
}
// Who rosters him in the synced league.
function gcOwnerOf(pid){
  const s=(typeof leagueSnapshot!=='undefined')?leagueSnapshot:null; if(!s || !s.teamList) return '';
  for(const t of s.teamList){ if((t.players||[]).some(p=>String(p.id)===String(pid))) return t.owner ? '@'+t.owner : (t.teamName||''); }
  return '';
}
// The board for any week (the current week reuses the live board).
function gcBoard(wk){
  const cur=Math.max(1, Number(TC_SEASON.week||1));
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
    games.push({ id, home, away, state:g.state, detail:g.detail, date:String(g.date||''), hs:h.score!=null?h.score:(g.home?g.score:g.oppScore), as:a.score!=null?a.score:(g.home?g.oppScore:g.score), hrec:h.rec||'', arec:a.rec||'' });
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
function gcIsMine(pid){ return gcMineSet().has(String(pid)); }
// Sleeper's rows for the week, every position (one pull; the week in progress re-reads on
// the week cache's live TTL).
function gcRows(wk){
  const key=`${TC_SEASON.year}|${wk}`;
  if(_gc.rows[key] && (Date.now()-_gc.rows[key].at<60*1000 || wk<Math.max(1,Number(TC_SEASON.week||1)))) return _gc.rows[key].rows;
  if(!_gc.busy['rows'+key] && typeof fetchWeekStats==='function'){
    _gc.busy['rows'+key]=true;
    fetchWeekStats(String(TC_SEASON.year), wk, null).then(rows=>{ if(Array.isArray(rows) && rows.length){ _gc.rows[key]={rows, at:Date.now()}; renderRightSidebar(); } }).catch(()=>{}).finally(()=>{ _gc.busy['rows'+key]=false; });
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
    .map(r=>({r, pts:gcPoints(r), line:gcStatLine(r)})).filter(x=>(x.pts!=null && x.pts!==0) || x.line)
    .sort((a,b)=>(b.pts||0)-(a.pts||0) || ((b.r.stats||{}).idp_tkl||0)-((a.r.stats||{}).idp_tkl||0)).slice(0, limit);
}
function gcPlayerHTML(x, side){
  const r=x.r; const owner=gcOwnerOf(r.player_id);
  const pid=String(r.player_id||''); const pos=gcPos(r);
  const click = pos==='DEF' ? '' : ` onclick="${pcardOnclick(pid, pos, r.team||'')}"`;
  return `<div class="gc-p gc-p-${side}"${click}>
    <div class="gc-pinfo">${owner?`<span class="gc-owner">${escHtml(owner)}</span>`:''}<span class="gc-pname${gcIsMine(pid)?' gc-mine':''}">${escHtml(gcName(r))}</span>${x.line?`<span class="gc-line">${escHtml(x.line)}</span>`:''}</div>
    <b class="gc-pts">${x.pts!=null?x.pts.toFixed(2):'–'}</b>
  </div>`;
}
function gcGameHTML(game, rows){
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
    return `<div class="gc-group"><div class="gc-gh">${g[1]}</div>${rowsHtml}</div>`;
  }).join('');
  const st=game.state==='post'?'FINAL':game.state==='in'?(game.detail||'LIVE'):(game.detail||'');
  // The banner wears both clubs: the away colour from the left, the home colour from the
  // right, meeting in the middle (a translucent wash over the surface so the type holds).
  const col=(t)=>(typeof pwTeamColor==='function' ? pwTeamColor(t) : '#888');
  return `<div class="gc-hero" style="--ga:${escAttr(col(game.away))};--gh:${escAttr(col(game.home))}">
      <div class="gc-side gc-side-away"><img src="${NFL_LOGO(game.away)}" class="gc-logo" onerror="this.style.display='none'"><span class="gc-team">${game.away}</span><span class="gc-rec">${escHtml(game.arec)}</span><b class="gc-score">${game.state==='pre'?'':(game.as!=null?game.as:'–')}</b></div>
      <div class="gc-status ${game.state==='in'?'gc-live':''}">${escHtml(st)}</div>
      <div class="gc-side gc-side-home"><b class="gc-score">${game.state==='pre'?'':(game.hs!=null?game.hs:'–')}</b><span class="gc-rec">${escHtml(game.hrec)}</span><span class="gc-team">${game.home}</span><img src="${NFL_LOGO(game.home)}" class="gc-logo" onerror="this.style.display='none'"></div>
    </div>
    ${rows ? (groups || '<div class="ld-empty">no stat lines yet</div>') : '<div class="ld-empty">loading the week\'s stat lines…</div>'}`;
}
function gcListHTML(games, picked){
  if(!games) return '<div class="ld-empty">loading games…</div>';
  return games.map(g=>`<div class="gc-game ${g.id===picked?'gc-on':''} gc-${g.state}" onclick="gcPick('${g.id}')">
    <div class="gc-gstate">${g.state==='post'?'FINAL':g.state==='in'?(g.detail||'LIVE'):escHtml(g.detail||'')}</div>
    <div class="gc-gline ${g.state==='post'&&g.as>g.hs?'gc-won':''}"><img src="${NFL_LOGO(g.away)}" class="gc-glogo" onerror="this.style.display='none'"><span>${g.away}</span><b>${g.state==='pre'?'':(g.as!=null?g.as:'–')}</b></div>
    <div class="gc-gline ${g.state==='post'&&g.hs>g.as?'gc-won':''}"><img src="${NFL_LOGO(g.home)}" class="gc-glogo" onerror="this.style.display='none'"><span>${g.home}</span><b>${g.state==='pre'?'':(g.hs!=null?g.hs:'–')}</b></div>
  </div>`).join('');
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
  const sel=`<select class="ld-sel" onchange="gcSetWeek(this.value)">${Array.from({length:cur},(_,i)=>cur-i).map(w=>`<option value="${w===cur?'current':w}" ${wk===w?'selected':''}>Week ${w}${w===cur?' · now':''}</option>`).join('')}</select>`;
  const fmt=gcScoring() ? escHtml((leagueSnapshot&&leagueSnapshot.name)||'league scoring') : 'app scoring · Sleeper for K/DEF/IDP';
  const pick=_gc.pos||'ALL';
  const posBtns=GC_POS.map(p=>`<button class="ld-pos ${pick===p?'active':''}" onclick="gcSetPos('${p}')">${p}</button>`).join('');
  const btns=phone ? `<button class="rsb-btn gcm-x" onclick="gcmSet('closed')" title="Close" aria-label="Close">×</button>` : rsbButtonsHTML();
  return `<div class="gc">
    <div class="gc-head"><div class="sidebar-section ld-title">Game Center</div>${sel}${btns}</div>
    <div class="ld-posrow gc-posrow">${posBtns}</div>
    <div class="ld-fmt" title="Points under this scoring">${fmt}</div>
    <div class="gc-body"><div class="gc-list">${gcListHTML(games, _gc.game)}</div><div class="gc-detail">${game ? gcGameHTML(game, rows) : (games && !games.length ? '<div class="ld-empty">no games this week</div>' : '')}</div></div>
  </div>`;
}
// The size buttons every state carries.
function rsbButtonsHTML(){
  const i=GC_MODES.indexOf(_gc.mode);
  const dis=(on)=>on?'':' disabled';
  return `<span class="rsb-btns"><button class="rsb-btn" onclick="gcStep(-1)" title="Narrower"${dis(i>0)}>−</button><button class="rsb-btn" onclick="gcStep(1)" title="Wider"${dis(i<GC_MODES.length-1)}>+</button></span>`;
}
// The one entry point: the sidebar in its current size — and, on a phone, the Games sheet
// instead (every repaint funnels through here, the live timers included, so both homes stay
// current from one place).
function renderRightSidebar(){
  try{ renderGamesPhone(); }catch(e){}
  const el=(typeof ldHost==='function')?ldHost():null; if(!el) return;
  if(typeof ldOn==='function' && !ldOn()){ el.hidden=true; return; }
  el.hidden=false;
  el.classList.remove('rsb-min','rsb-max');
  gcApplyWidth(el);
  if(_gc.mode==='min'){ el.classList.add('rsb-min'); el.innerHTML=`<div class="rsb-rail"><button class="rsb-btn" onclick="gcStep(1)" title="Wider">+</button><span class="rsb-vert">LEADERS · GAMES</span></div>`; return; }
  if(_gc.mode==='max'){ el.classList.add('rsb-max'); el.innerHTML=gcHTML(); }
  else if(typeof renderLeaders==='function') renderLeaders();
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
  const i=Math.max(0, games.findIndex(g=>g.id===_gc.game));
  if(dx<0) return i<games.length-1 ? {game:games[i+1].id} : {tab:'leaders'};
  return i>0 ? {game:games[i-1].id} : null;
}
function gcmApplySwipe(act){ if(!act) return; if(act.tab) gcmSetTab(act.tab); else if(act.game) gcPick(act.game); }
function gcmBindSwipe(sheet){
  if(!sheet || !sheet.addEventListener || sheet._gcmSwipe) return; sheet._gcmSwipe=true;
  let x0=null, y0=null, claimed=false;
  sheet.addEventListener('touchstart', e=>{ const t=e.touches&&e.touches[0]; if(!t) return; x0=t.clientX; y0=t.clientY;
    claimed=!!(e.target && e.target.closest && e.target.closest('.gc-list,.gcm-grab,select,.ld-sel')); }, {passive:true});
  sheet.addEventListener('touchend', e=>{ if(x0==null){ return; } const t=e.changedTouches&&e.changedTouches[0]; const sx=x0, sy=y0; x0=null; if(!t || claimed) return;
    const dx=t.clientX-sx, dy=t.clientY-sy; if(Math.abs(dx)<60 || Math.abs(dy)>Math.abs(dx)*0.7) return;
    gcmApplySwipe(gcmSwipeAction(dx, _gcm.tab||'games')); }, {passive:true});
}
// The picker bar's live line and the pill both open straight to a game.
function gcOpenGame(id){ _gc.week='current'; if(id) _gc.game=id; _gcm.open='full'; renderGamesPhone(); }
// The current week's games, whatever week the sheet is showing — the pill reads the present.
function gcmCurrentGames(){
  const board=gcBoard(gcCurWeek());
  return board ? gcGames(board) : null;
}
// The sheet's two pages: the week's games, and the Leaders — the same ranked list the
// desktop sidebar shows (weekly high scores by position, sortable), in the phone's drawer.
const GCM_TABS=[['games','Games'],['leaders','Leaders']];
function gcmSetTab(t){ if(!GCM_TABS.some(x=>x[0]===t)) return; _gcm.tab=t; if(_gcm.open==='closed') _gcm.open='half'; renderGamesPhone(); }
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
  if(!gcPhoneOn()){ host.innerHTML=''; host.hidden=true; if(document.body&&document.body.classList) document.body.classList.remove('gcm-open'); return; }
  if(_gcm.drag) return;                       // mid-gesture: the markup is already there
  host.hidden=false;
  const games=gcmCurrentGames();
  const open=_gcm.open;
  // Keep the reader's place across the minute repaint: the rail's scroll and the body's.
  const body0=host.querySelector?host.querySelector('.gc-body'):null, rail0=host.querySelector?host.querySelector('.gc-list'):null;
  const keep={ body:body0?body0.scrollTop:0, rail:rail0?rail0.scrollLeft:0, game:_gc.game };
  const tab=_gcm.tab||'games';
  const width=(typeof window!=='undefined' && window.innerWidth) ? window.innerWidth : 390;
  const closeBtn=`<button class="rsb-btn gcm-x" onclick="gcmSet('closed')" title="Close" aria-label="Close">×</button>`;
  const page = open==='closed' ? ''
    : tab==='leaders' && typeof ldPanelHTML==='function'
      ? `<div class="gc gcm-leaders">${ldPanelHTML(width, closeBtn, fromLoad, true)}</div>`
      : gcHTML(true);
  host.innerHTML=`${gcmPillHTML(games)}
    <div class="gcm-scrim" onclick="gcmSet('closed')"></div>
    <div class="gcm-sheet gcm-${open}" aria-label="Game Center" aria-hidden="${open==='closed'}">
      <div class="gcm-grab" onpointerdown="gcmDragStart(event)"></div>
      ${open==='closed' ? '' : gcmTabsHTML()}
      ${page}
    </div>`;
  if(document.body&&document.body.classList) document.body.classList.toggle('gcm-open', open!=='closed');
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
    _gcm.timer=window.setTimeout(()=>{ _gcm.timer=null; renderGamesPhone(); }, 61*1000);
  }
}
