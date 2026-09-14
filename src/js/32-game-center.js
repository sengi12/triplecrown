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
function gcPick(id){ _gc.game=id; renderRightSidebar(); }
function gcWeek(){ const cur=Math.max(1, Number(TC_SEASON.week||1)); return _gc.week==='current' ? cur : Math.min(cur, _gc.week); }

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
    if(_gc.mode==='normal' && !_gc.raf && typeof requestAnimationFrame==='function'){ _gc.raf=requestAnimationFrame(()=>{ _gc.raf=0; if(_gc.dragW) renderRightSidebar(); }); } };
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
  const groups=GC_GROUPS.filter(g=>pick==='ALL'||pick==='RK'||g[0]===pick).map(g=>{
    const lim=(pick==='ALL'||pick==='RK') ? (g[0]==='IDP'?5:4) : 20;
    const away=gcSide(rows, game.away, g, lim), home=gcSide(rows, game.home, g, lim);
    if(!away.length && !home.length) return '';
    const n=Math.max(away.length, home.length);
    const rowsHtml=Array.from({length:n},(_,i)=>`<div class="gc-row">${away[i]?gcPlayerHTML(away[i],'away'):'<div class="gc-p gc-p-empty"></div>'}${home[i]?gcPlayerHTML(home[i],'home'):'<div class="gc-p gc-p-empty"></div>'}</div>`).join('');
    return `<div class="gc-group"><div class="gc-gh">${g[1]}</div>${rowsHtml}</div>`;
  }).join('');
  const st=game.state==='post'?'FINAL':game.state==='in'?(game.detail||'LIVE'):(game.detail||'');
  return `<div class="gc-hero">
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
function gcHTML(){
  const cur=Math.max(1, Number(TC_SEASON.week||1)), wk=gcWeek();
  const board=gcBoard(wk);
  const games=board ? gcGames(board) : null;
  if(games && games.length && !games.some(g=>g.id===_gc.game)) _gc.game=gcDefaultGame(games);
  const game=games ? games.find(g=>g.id===_gc.game) : null;
  const rows=gcRows(wk);
  const sel=`<select class="ld-sel" onchange="gcSetWeek(this.value)">${Array.from({length:cur},(_,i)=>cur-i).map(w=>`<option value="${w===cur?'current':w}" ${wk===w?'selected':''}>Week ${w}${w===cur?' · now':''}</option>`).join('')}</select>`;
  const fmt=gcScoring() ? escHtml((leagueSnapshot&&leagueSnapshot.name)||'league scoring') : 'app scoring · Sleeper for K/DEF/IDP';
  const pick=_gc.pos||'ALL';
  const posBtns=GC_POS.map(p=>`<button class="ld-pos ${pick===p?'active':''}" onclick="gcSetPos('${p}')">${p}</button>`).join('');
  return `<div class="gc">
    <div class="gc-head"><div class="sidebar-section ld-title">Game Center</div>${sel}${rsbButtonsHTML()}</div>
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
// The one entry point: the sidebar in its current size.
function renderRightSidebar(){
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
