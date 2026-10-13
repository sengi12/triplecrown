// ═════════════════════════════════════════════════════════════════════════════
// Matchup swing chart — how the week's win chance moved, play by play.
//
// The hero card's win bar says where the matchup stands NOW. This says how it got there:
// one line, my side's chance to win from the first kickoff to the final whistle, with the
// plays that swung it most pinned to the line by the man who made them. The weekend is
// replayed from ESPN's game summaries (every play carries a wall-clock stamp), each play
// typed and scored the way the Live feed scores it (lfReadPlay → tcSleeperPoints under the
// league's own table), and each side's projected total is live points plus the unplayed
// share of every starter's projection — the card's own laWinProb, point by point.
//
// Two honest limits. A D/ST's points cannot be read off the plays, and a two-point try is
// typed as nothing, so those arrive when the game goes final: the line snaps to Sleeper's
// own totals for everyone whose game is over, which is also what makes the last point of
// the chart equal the scoreboard. And a game whose summary has not landed yet draws as
// "not started" until it does — the chart says so rather than guessing.
// ═════════════════════════════════════════════════════════════════════════════
var _laSwing = { memo:{}, busy:{} };
const LA_SWING_WINDOW_GAP = 2*60*60*1000;   // idle longer than this between plays = a new window (Thursday → Sunday)
const LA_SWING_KEY_MIN = 0.03;              // a play has to move the chance three points to be pinned
const LA_SWING_KEYS = 6;
const LA_SWING_TTL_LIVE = 45*1000, LA_SWING_TTL_FINAL = 6*60*60*1000;

// How much of a game is played at a given quarter and clock (the clock reads what is LEFT
// in the quarter). Overtime counts as the whole game played: the projection has nothing to
// say about it.
function laSwingGameFrac(q, clock){
  q=Number(q||0); if(!q) return 0; if(q>4) return 1;
  const m=/^(\d+):(\d+)$/.exec(String(clock||'').trim());
  const left = m ? Number(m[1])*60+Number(m[2]) : 0;
  return Math.min(1, Math.max(0, ((q-1)*900 + (900-Math.min(900,left)))/3600));
}
// One game summary → the plays as events: when, how far into the game, what the play did
// in fantasy stats (by Sleeper id), and the game's end.
function laSwingPlayEvents(sum, eid){
  const plays=(typeof gcPlays==='function') ? gcPlays(sum) : [];
  const out=[];
  plays.forEach(p=>{
    if(p.kind==='final'){ out.push({eid:String(eid), at:p.at||0, q:p.q, clock:p.clock, kind:'final', title:'Final', stats:{}, roles:{}}); return; }
    if(typeof GC_PAUSE_KINDS!=='undefined' && GC_PAUSE_KINDS.has(p.kind)) return;
    const read=(typeof lfReadPlay==='function') ? lfReadPlay({id:p.id, type:p.type, text:p.text, yds:p.yds, team:p.team, athletes:[]}) : {kind:'other', title:p.text, stats:{}, roles:{}};
    out.push({eid:String(eid), at:p.at||0, q:p.q, clock:p.clock, kind:read.kind, title:read.title, stats:read.stats||{}, roles:read.roles||{}, team:p.team||'', text:p.text||''});
  });
  return out;
}
// The windows the weekend was played in: plays closer together than the gap share one.
// Each window is drawn as wide as it ran (never thinner than half an hour) and the idle
// stretches between them collapse to a fixed sliver, so Thursday night does not push the
// Sunday slate into a corner.
function laSwingWindows(times){
  const ts=(times||[]).filter(t=>t>0).sort((a,b)=>a-b);
  const out=[];
  ts.forEach(t=>{
    const w=out[out.length-1];
    if(w && t-w.t1<=LA_SWING_WINDOW_GAP) w.t1=t; else out.push({t0:t, t1:t});
  });
  const MIN=30*60*1000;
  let span=0; out.forEach(w=>{ w.dur=Math.max(MIN, w.t1-w.t0); span+=w.dur; });
  const gap = out.length>1 ? 0.035 : 0;
  const usable = 1 - gap*(out.length-1);
  let x=0;
  out.forEach(w=>{ w.x0=x; w.w=usable*(w.dur/span); x+=w.w+gap; });
  return out;
}
function laSwingX(windows, t){
  if(!windows.length) return 0;
  for(const w of windows){
    if(t<=w.t1 || w===windows[windows.length-1]){
      const f=Math.min(1, Math.max(0, (t-w.t0)/w.dur));
      return w.x0 + f*w.w;
    }
  }
  return 1;
}
// "Sun 1pm", in the viewer's own clock.
function laSwingTickLabel(t){
  const d=new Date(t);
  const day=d.toLocaleDateString([], {weekday:'short'});
  const h=d.getHours()%12||12, mi=d.getMinutes();
  // the quarter past the hour of a 4:25 or 8:20 kickoff is noise on an axis; 9:30 is not
  const m = (mi>=30) ? ':30' : '';
  return `${day} ${h}${m}${d.getHours()>=12?'pm':'am'}`;
}

// The replay. Pure: everything it needs arrives in `inp`.
//   mine, opp   starter ids (Sleeper), in slot order
//   proj        {pid: projected points for the week, under the league's scoring}
//   teamOf      {pid: NFL team code}        pos  {pid: position}
//   games       {TEAM: {eid, kick(ms), state:'pre'|'in'|'post', loaded:bool}}
//   plays       the events of every loaded game (laSwingPlayEvents), any order
//   scoring     the league's raw Sleeper table, or null for the app's own
//   actualFinal {pid: Sleeper's points for the week} — snapped to when his game ends
// Returns {series:[{t, p, mine, opp, pid, side, dp, delta, title}], keys:[…], windows, decided}.
function laSwingBuild(inp){
  const clean=(a)=>(a||[]).filter(x=>x&&x!=='0').map(String);
  const mine=clean(inp.mine), opp=clean(inp.opp);
  const side={}; mine.forEach(p=>side[p]='mine'); opp.forEach(p=>side[p]='opp');
  const proj=inp.proj||{}, teamOf=inp.teamOf||{}, games=inp.games||{}, scoring=inp.scoring||null, posOf=inp.pos||{}, finals=inp.actualFinal||{};
  const gameOf=(pid)=>{ const g=games[String(teamOf[pid]||'').toUpperCase()]; return (g && g.eid) ? String(g.eid) : null; };
  const pts=(pid, st)=>{
    if(scoring && typeof tcSleeperPoints==='function'){ const v=tcSleeperPoints(st, scoring); return v!=null?v:0; }
    return (typeof ldPoints==='function') ? ldPoints({pos:posOf[pid]||'', stats:st}) : 0;
  };
  // every play in time order; a play without a wall clock rides 20 s after the one before it
  // in its game (the plays arrive in game order, so that is its true neighbour)
  const evs=(inp.plays||[]).map(e=>Object.assign({}, e));
  const kickOf={}; Object.keys(games).forEach(tm=>{ const g=games[tm]; if(g && g.eid && g.kick>0) kickOf[String(g.eid)]=Number(g.kick); });
  const lastAt={};
  evs.forEach(e=>{
    // never before its kickoff, never before the play before it (a stray stamp cannot
    // drag a play back into the previous window)
    if(!(e.at>0)) e.at=(lastAt[e.eid]||kickOf[e.eid]||inp.t0||0)+20000;
    e.at=Math.max(e.at, kickOf[e.eid]||0, lastAt[e.eid]||0);
    lastAt[e.eid]=e.at;
  });
  evs.sort((a,b)=>a.at-b.at);
  const kicks=Object.keys(games).map(k=>Number(games[k].kick||0)).filter(t=>t>0);
  const t0 = inp.t0 || (kicks.length ? Math.min.apply(null, kicks) : (evs.length ? evs[0].at : Date.now()));
  const actual={}, progress={};
  // a game the board already calls final whose plays never came (or never will): all played,
  // and Sleeper's totals stand in for the plays
  Object.keys(games).forEach(tm=>{ const g=games[tm]; if(g && g.eid && g.state==='post' && !g.loaded) progress[String(g.eid)]=1; });
  const snapFinals=(eid)=>{ for(const pid in side){ if(gameOf(pid)===eid && finals[pid]!=null) actual[pid]=Number(finals[pid])||0; } };
  Object.keys(progress).forEach(snapFinals);
  const totals=()=>{
    const T={minePts:0, mineRem:0, oppPts:0, oppRem:0, decided:true};
    for(const pid in side){
      const eid=gameOf(pid);
      const g=games[String(teamOf[pid]||'').toUpperCase()];
      const prog = eid ? (progress[eid]||0) : (g && g.state==='pre' ? 0 : 1);   // no game this week: nothing left to play
      const a=actual[pid]||0, r=Math.max(0, Number(proj[pid]||0))*(1-prog);
      if(prog<1) T.decided=false;
      if(side[pid]==='mine'){ T.minePts+=a; T.mineRem+=r; } else { T.oppPts+=a; T.oppRem+=r; }
    }
    return T;
  };
  const pOf=(T)=>{
    if(T.decided) return T.minePts>T.oppPts?1:T.minePts<T.oppPts?0:.5;
    return (typeof laWinProb==='function') ? laWinProb(T.minePts,T.mineRem,T.oppPts,T.oppRem) : .5;
  };
  const series=[];
  let T=totals(), p=pOf(T);
  series.push({t:t0, p, mine:T.minePts+T.mineRem, opp:T.oppPts+T.oppRem, pts:{mine:T.minePts, opp:T.oppPts}});
  evs.forEach(e=>{
    // the clock first: the projection a player has not cashed burns off as his game runs,
    // and that drift is not the play's doing — a swing is measured from the chance AFTER
    // the clock moved to the chance after the points landed
    if(e.kind==='final'){ progress[e.eid]=1; snapFinals(e.eid); }
    else progress[e.eid]=Math.max(progress[e.eid]||0, laSwingGameFrac(e.q, e.clock));
    const pClock=pOf(totals());
    let pid=null, delta=0;
    for(const id in (e.stats||{})){
      if(!side[id]) continue;
      const d=pts(id, e.stats[id]); actual[id]=(actual[id]||0)+d;
      if(Math.abs(d)>Math.abs(delta)){ delta=d; pid=id; }
    }
    T=totals(); const np=pOf(T);
    const pt={t:e.at, p:np, dp:np-pClock, mine:T.minePts+T.mineRem, opp:T.oppPts+T.oppRem, pts:{mine:T.minePts, opp:T.oppPts}};
    if(pid){ pt.pid=pid; pt.side=side[pid]; pt.delta=Math.round(delta*100)/100; pt.title=e.title||''; pt.kind=e.kind; }
    else if(e.kind==='final'){ pt.final=e.eid; }
    series.push(pt); p=np;
  });
  const decided=T.decided;
  // the swings: the plays that moved the chance most, pinned to the line
  const keys=series.filter(s=>s.pid && Math.abs(s.dp)>=LA_SWING_KEY_MIN)
    .sort((a,b)=>Math.abs(b.dp)-Math.abs(a.dp)).slice(0, LA_SWING_KEYS).sort((a,b)=>a.t-b.t);
  const windows=laSwingWindows(series.map(s=>s.t));
  // the kickoff slates, for the axis: Thu 8pm · Sun 1pm · Sun 4pm · Sun 8pm · Mon 8pm
  const lastT=series[series.length-1].t;
  const slates=Array.from(new Set(kicks)).sort((a,b)=>a-b).filter(t=>t<=lastT);
  return {series, keys, windows, slates, decided, t0, final:{mine:T.minePts, opp:T.oppPts, p}};
}

// ── The picture ──────────────────────────────────────────────────────────────
// One line — my chance to win — on a 0–100% field with the half-way mark drawn. Above it
// is tinted my colour, below it the other side's, so the eye reads who was ahead without
// a second line. The swings carry the player's headshot, up for mine, down for theirs.
// The drawing's frame: a phone gets the tall card, a wide screen a flatter, wider one — the
// text and the headshots are drawn in viewBox units, so a 640-wide picture stretched across a
// desktop card scaled everything up with it; 960 wide keeps the labels the size they are.
function laSwingGeom(W){
  W=Number(W)||640;
  const H = W>=900 ? 220 : 250;
  const L=34, R=14, T=34, B=28;
  return {W, H, L, R, T, B, pw:W-L-R, ph:H-T-B};
}
function laSwingDrawWidth(){
  const vw=(typeof window!=='undefined' && window.innerWidth) ? window.innerWidth : 390;
  return vw>=900 ? 960 : 640;
}
function laSwingSVG(built, ctx){
  ctx=ctx||{};
  const G=laSwingGeom(ctx.w||640);
  const {W, H, L, R, T, B, pw, ph}=G;
  const x=(t)=>L+laSwingX(built.windows, t)*pw;
  const y=(p)=>T+(1-p)*ph;
  const pts=built.series;
  if(!pts.length) return '';
  // the line; two points under a pixel apart are one point (a full weekend is ~2,000 plays)
  let d='', lastX=-9;
  pts.forEach((s,i)=>{ const px=x(s.t), py=y(s.p); if(i && px-lastX<0.6 && i<pts.length-1 && !s.pid) return; d+=`${d?'L':'M'}${px.toFixed(1)} ${py.toFixed(1)}`; lastX=px; });
  const endX=x(pts[pts.length-1].t), mid=y(.5);
  const area=`${d}L${endX.toFixed(1)} ${mid.toFixed(1)}L${x(pts[0].t).toFixed(1)} ${mid.toFixed(1)}Z`;
  // one label per kickoff slate (the windows when there are none), never two on top of each other
  const slates=(built.slates && built.slates.length) ? built.slates : built.windows.map(w=>w.t0);
  let lastTx=-99; const ticks=slates.map(t=>{ const tx=x(t); if(tx-lastTx<pw*0.11) return ''; lastTx=tx; return `<text class="la-swing-tick" x="${tx.toFixed(1)}" y="${H-8}">${escHtml(laSwingTickLabel(t))}</text>`; }).join('');
  const finalTick = built.decided ? `<text class="la-swing-tick la-swing-tick-end" x="${endX.toFixed(1)}" y="${H-8}">Final</text>` : '';
  const grid=[0,.25,.5,.75,1].map(v=>`<line class="la-swing-grid${v===.5?' la-swing-mid':''}" x1="${L}" x2="${W-R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="la-swing-ylab" x="${L-6}" y="${(y(v)+3.5).toFixed(1)}">${Math.round(v*100)}%</text>`).join('');
  const hs=(pid)=> (typeof SLEEPER_HEADSHOT==='function') ? SLEEPER_HEADSHOT(pid) : '';
  // two swings minutes apart would sit on top of each other: the second steps further out
  const lastMark={up:-99, dn:-99};
  const marks=built.keys.map((k,i)=>{
    const cx=x(k.t), cy=y(k.p), up=k.dp>0, my=k.side==='mine';
    const dir=up?'up':'dn'; const crowd = (cx-lastMark[dir]<40) ? 34 : 0; lastMark[dir]=crowd?-99:cx;
    const ry=up ? Math.max(T-16, cy-44-crowd) : Math.min(H-B-4, cy+44+crowd);
    const sign=(k.dp>0?'+':'−')+Math.round(Math.abs(k.dp)*100)+'%';
    const tip=`${k.title||'Play'} · ${k.delta>0?'+':''}${k.delta} pts · ${sign} to win`;
    const id=`laswc${i}`;
    return `<g class="la-swing-mark ${my?'la-swing-mine':'la-swing-opp'} ${up?'la-swing-up':'la-swing-dn'}" data-x="${cx.toFixed(1)}" ${k.pid?`onclick="pcardOnclick(${JSON.stringify(k.pid)},'','')"`:''}>
      <title>${escHtml(tip)}</title>
      <line class="la-swing-stem" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" y2="${ry.toFixed(1)}"/>
      <circle class="la-swing-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4"/>
      <clipPath id="${id}"><circle cx="${cx.toFixed(1)}" cy="${ry.toFixed(1)}" r="15"/></clipPath>
      <circle class="la-swing-ring" cx="${cx.toFixed(1)}" cy="${ry.toFixed(1)}" r="16"/>
      <image href="${escAttr(hs(k.pid))}" x="${(cx-15).toFixed(1)}" y="${(ry-15).toFixed(1)}" width="30" height="30" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>
      <text class="la-swing-sign" x="${(cx+19).toFixed(1)}" y="${(ry+4).toFixed(1)}">${sign}</text>
    </g>`;
  }).join('');
  const last=pts[pts.length-1];
  const now=`<circle class="la-swing-now${built.decided?' la-swing-final':''}" cx="${endX.toFixed(1)}" cy="${y(last.p).toFixed(1)}" r="5"/>`;
  // the reveal: a clip the replay widens from the first kickoff; at rest it shows the whole week
  return `<svg class="la-swing-svg" viewBox="0 0 ${W} ${H}" data-w="${W}" role="img" aria-label="${escAttr(ctx.label||'How the chance to win moved')}">
    <defs><clipPath id="laswup"><rect x="0" y="0" width="${W}" height="${mid.toFixed(1)}"/></clipPath><clipPath id="laswdn"><rect x="0" y="${mid.toFixed(1)}" width="${W}" height="${H}"/></clipPath>
      <clipPath id="laswrev"><rect class="la-swing-reveal" x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>
    ${grid}
    <g clip-path="url(#laswrev)">
      <path class="la-swing-area la-swing-area-up" d="${area}" clip-path="url(#laswup)"/>
      <path class="la-swing-area la-swing-area-dn" d="${area}" clip-path="url(#laswdn)"/>
      <path class="la-swing-line" d="${d}"/>
    </g>
    ${marks}${now}
    <circle class="la-swing-now la-swing-cursor" cx="0" cy="0" r="5" style="display:none"/>
    ${ticks}${finalTick}
  </svg>`;
}
// The recap under the picture: the swings in the order they happened.
function laSwingRecapHTML(built, names){
  if(!built.keys.length) return `<div class="la-swing-none">${built.series.length>1?'No single play moved the chance three points — a steady weekend.':'Nothing has happened yet.'}</div>`;
  return `<div class="la-swing-recap">${built.keys.map(k=>{
    const nm=(names && names[k.pid]) || '';
    const when=laSwingTickLabel(k.t);
    const sign=(k.dp>0?'+':'−')+Math.round(Math.abs(k.dp)*100);
    return `<div class="la-swing-row ${k.side==='mine'?'la-swing-mine':'la-swing-opp'} ${k.dp>0?'la-swing-up':'la-swing-dn'}">
      <span class="clickable-player la-swing-hs" onclick="pcardOnclick(${JSON.stringify(k.pid)},'','')"><img class="la-swing-hsimg" src="${escAttr((typeof SLEEPER_HEADSHOT==='function')?SLEEPER_HEADSHOT(k.pid):'')}" alt="" onerror="this.style.visibility='hidden'"></span>
      <div class="la-swing-rtext"><b>${escHtml(k.title||nm||'Play')}</b><span class="la-swing-rsub">${escHtml(when)}${nm?` · ${escHtml(nm)}`:''} · ${k.delta>0?'+':''}${k.delta} pts</span></div>
      <span class="la-swing-dp">${sign}%</span>
    </div>`;
  }).join('')}</div>`;
}

// ── Feeding it from the analyzer ─────────────────────────────────────────────
// The two line-ups, the week's board (which game each starter is in, and its state), the
// summaries of the games that have started, the card's projections and the league's
// table. Summaries share the Game Center's cache (_gcd.sum) so a game is never read twice.
function laSwingSummary(eid, state){
  eid=String(eid||''); if(!eid) return null;
  const cache=(typeof _gcd!=='undefined' && _gcd && _gcd.sum) ? _gcd.sum : null;
  const c=cache ? cache[eid] : null;
  const ttl = state==='post' ? LA_SWING_TTL_FINAL : LA_SWING_TTL_LIVE;
  if(c && Date.now()-c.at<ttl) return c.data;
  if(!_laSwing.busy[eid] && typeof sleeperFetch==='function' && typeof GC_SUMMARY_URL==='function'){
    _laSwing.busy[eid]=true;
    sleeperFetch(GC_SUMMARY_URL(eid), {fresh: state==='in'}).then(d=>{
      if(d && (d.drives||d.boxscore||d.header)){ if(cache) cache[eid]={data:d, at:Date.now()}; _laSwing.memo={}; if(typeof _laInsRerender==='function') _laInsRerender(); }
    }).catch(()=>{}).finally(()=>{ _laSwing.busy[eid]=false; });
  }
  return c ? c.data : null;
}
function laSwingInputs(wk, a, b, o){
  const board=(typeof gcBoard==='function') ? gcBoard(wk) : null;
  if(!board) return {loading:'board'};
  const meta=o.meta, pm=o.pm, dvp=o.dvp;
  const starters=(row)=>(row.starters||[]).filter(x=>x&&x!=='0').map(String);
  const mine=starters(a), opp=starters(b);
  const proj={}, teamOf={}, pos={}, games={}, actualFinal={}, names={};
  const plays=[]; let pending=0;
  const pidPts=(row)=>{ const m={}; (row.starters||[]).forEach((pid,i)=>{ if(pid&&pid!=='0') m[String(pid)]=Number((row.starters_points||[])[i]||0); }); return m; };
  const ptsA=pidPts(a), ptsB=pidPts(b);
  [[mine,ptsA],[opp,ptsB]].forEach(([ids,pm2])=>ids.forEach(pid=>{
    const p=(typeof _laPidMeta==='function') ? _laPidMeta(meta, pid) : {id:pid};
    const adj=(typeof laAdjWeekProj==='function') ? laAdjWeekProj(p, wk, pm, dvp) : {adj:0};
    proj[pid]=Number(adj.adj||0); teamOf[pid]=String(p.team||'').toUpperCase(); pos[pid]=String(p.pos||'').toUpperCase(); names[pid]=p.name||'';
    const tm=teamOf[pid]; const g=tm ? board[tm] : null;
    if(g && g.eid && !games[tm]){
      games[tm]={eid:String(g.eid), kick:g.date?Date.parse(g.date)||0:0, state:g.state, loaded:false};
    }
    if(g && g.state==='post') actualFinal[pid]=pm2[pid]||0;
  }));
  const seen={};
  Object.keys(games).forEach(tm=>{
    const g=games[tm]; if(g.state==='pre' || seen[g.eid]) { if(seen[g.eid]) g.loaded=seen[g.eid].loaded; return; }
    const sum=laSwingSummary(g.eid, g.state);
    if(sum){ g.loaded=true; plays.push.apply(plays, laSwingPlayEvents(sum, g.eid)); }
    else pending++;
    seen[g.eid]=g;
  });
  const scoring=(typeof leagueSnapshot!=='undefined' && leagueSnapshot && leagueSnapshot.scoringRaw) || null;
  return {mine, opp, proj, teamOf, pos, games, plays, scoring, actualFinal, names, pending};
}
// The block inside the hero card. Memoised on the matchup read and the summaries' stamps,
// so the 45-second poll only rebuilds when a play has landed.
function laSwingSectionHTML(wk, a, b, o){
  if(laState.swingHide) return `<div class="la-swing la-swing-closed"><button class="btn btn-ghost btn-sm" onclick="laSwingToggle()">Show how the win chance moved</button></div>`;
  const inp=laSwingInputs(wk, a, b, o||{});
  const head=(sub)=>`<div class="la-swing-head"><span class="la-ins-lbl">WIN CHANCE · HOW IT MOVED</span>${sub?`<span class="la-ins-sub">${sub}</span>`:''}<button class="la-swing-x" onclick="laSwingToggle()" title="Hide">×</button></div>`;
  if(inp.loading){
    // the board lands on the Game Center's own repaint, not the analyzer's: wait for it here,
    // a look every second and a half for half a minute, and repaint once it is in
    if(!_laSwing.boardWait && typeof setTimeout==='function'){
      let tries=0;
      const look=()=>{ _laSwing.boardWait=null; const b=(typeof gcBoard==='function') ? gcBoard(wk) : null;
        if(b){ if(typeof _laInsRerender==='function') _laInsRerender(); return; }
        if(++tries<20) _laSwing.boardWait=setTimeout(look, 1500); };
      _laSwing.boardWait=setTimeout(look, 1500);
    }
    return `<div class="la-swing">${head('')}<div class="la-swing-wait">reading the week's board…</div></div>`;
  }
  const stamps=Object.keys(inp.games).map(k=>{ const c=(typeof _gcd!=='undefined'&&_gcd&&_gcd.sum)?_gcd.sum[inp.games[k].eid]:null; return c?c.at:0; }).join(',');
  const sig=`${wk}|${a.roster_id}|${b.roster_id}|${a.points}|${b.points}|${stamps}|${inp.plays.length}`;
  let built=_laSwing.memo[sig];
  if(!built){ built=laSwingBuild(inp); _laSwing.memo={}; _laSwing.memo[sig]=built; }
  const last=built.series[built.series.length-1];
  const pct=Math.round(last.p*100);
  const state = built.decided ? (last.p>.5?'<b class="la-swing-won">Won</b>':last.p<.5?'<b class="la-swing-lost">Lost</b>':'<b>Tied</b>')
    : `<b>${Math.min(99,Math.max(1,pct))}%</b> to win`;
  const sub = inp.pending ? `${inp.pending} game${inp.pending>1?'s':''} still loading` : (built.decided ? 'final' : (wk===laCurrentWeek()?'live':''));
  const myName=(o&&o.names&&o.names.mine)||'';
  _laSwing.last=built; _laSwing.names=inp.names;
  const n=built.series.length;
  return `<div class="la-swing">${head(sub)}
    <div class="la-swing-body">
      <div class="la-swing-chart">
        <div class="la-swing-state"><span class="la-swing-rest">${myName?`<span class="la-swing-who">${escHtml(myName)}</span> `:''}${state}</span><span class="la-swing-live"></span></div>
        ${laSwingSVG(built, {w:laSwingDrawWidth(), label:`${myName||'My'} chance to win across the week`})}
        ${n>1?`<div class="la-swing-ctl"><button class="btn btn-ghost btn-sm la-swing-play" onclick="laSwingReplay(event)" title="Replay the week from the first kickoff">▶ Replay</button><input type="range" class="la-swing-scrub" min="0" max="${n-1}" value="${n-1}" aria-label="Scrub through the week" oninput="laSwingScrub(this.value)"></div>`:''}
      </div>
      ${laSwingRecapHTML(built, inp.names)}
    </div>
  </div>`;
}

// ── The replay ───────────────────────────────────────────────────────────────
// A ten-second sweep from the first kickoff: the reveal clip widens along the axis (evenly
// along the x-axis, not the play count, so Thursday night takes its slice and Sunday its
// own), the swings appear as the line passes them, a cursor rides the line and the readout
// says where things stood. The scrubber stops it and steps to any play.
var _laSwingPlay = { raf:null, t0:0, dur:10000 };
function laSwingShow(i, atEnd){
  const b=_laSwing.last; if(!b || !b.series.length) return;
  const svg=document.querySelector('.la-swing-svg'); if(!svg) return;
  const G=laSwingGeom(svg.getAttribute('data-w'));
  i=Math.max(0, Math.min(b.series.length-1, Number(i)||0));
  const s=b.series[i];
  const px=G.L+laSwingX(b.windows, s.t)*G.pw, py=G.T+(1-s.p)*G.ph;
  const rect=svg.querySelector('.la-swing-reveal'); if(rect) rect.setAttribute('width', atEnd?G.W:px.toFixed(1));
  svg.querySelectorAll('.la-swing-mark').forEach(g=>{ g.style.opacity = (atEnd || Number(g.getAttribute('data-x'))<=px+0.5) ? '1' : '0'; });
  const cur=svg.querySelector('.la-swing-cursor'); const end=svg.querySelector('.la-swing-now:not(.la-swing-cursor)');
  if(cur){ cur.style.display=atEnd?'none':''; cur.setAttribute('cx', px.toFixed(1)); cur.setAttribute('cy', py.toFixed(1)); }
  if(end) end.style.opacity=atEnd?'1':'0';
  const live=document.querySelector('.la-swing-live'), rest=document.querySelector('.la-swing-rest');
  if(live && rest){
    if(atEnd){ live.textContent=''; rest.style.display=''; }
    else { rest.style.display='none'; const pct=Math.min(99, Math.max(1, Math.round(s.p*100))); live.innerHTML=`${escHtml(laSwingTickLabel(s.t))} · <b>${pct}%</b> to win · ${s.pts.mine.toFixed(1)} <span class="la-ins-sub">(proj ${s.mine.toFixed(1)})</span> vs ${s.pts.opp.toFixed(1)} <span class="la-ins-sub">(proj ${s.opp.toFixed(1)})</span>`; }
  }
  const scrub=document.querySelector('.la-swing-scrub'); if(scrub) scrub.value=i;
}
function laSwingStop(){
  if(_laSwingPlay.raf && typeof window!=='undefined' && window.cancelAnimationFrame) window.cancelAnimationFrame(_laSwingPlay.raf);
  _laSwingPlay.raf=null;
  const btn=document.querySelector('.la-swing-play'); if(btn) btn.textContent='▶ Replay';
}
function laSwingReplay(ev){
  try{ ev.stopPropagation(); }catch(e){}
  const b=_laSwing.last; if(!b || b.series.length<2) return;
  if(_laSwingPlay.raf){ laSwingStop(); laSwingShow(b.series.length-1, true); return; }   // a second tap skips to now
  const btn=document.querySelector('.la-swing-play'); if(btn) btn.textContent='■ Skip to now';
  const reduce = typeof window!=='undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  _laSwingPlay.t0=performance.now(); const dur = reduce ? 1 : _laSwingPlay.dur;
  const frame=(now)=>{
    if(!document.querySelector('.la-swing-svg')){ laSwingStop(); return; }   // the card repainted under us
    const f=Math.min(1, (now-_laSwingPlay.t0)/dur);
    let lo=0, hi=b.series.length-1;
    while(lo<hi){ const mid=(lo+hi)>>1; if(laSwingX(b.windows, b.series[mid].t)<f) lo=mid+1; else hi=mid; }
    laSwingShow(lo, f>=1);
    if(f<1) _laSwingPlay.raf=requestAnimationFrame(frame); else laSwingStop();
  };
  _laSwingPlay.raf=requestAnimationFrame(frame);
}
function laSwingScrub(v){
  laSwingStop();
  const b=_laSwing.last; if(!b) return;
  const i=Number(v)||0; laSwingShow(i, i>=b.series.length-1);
}
function laSwingToggle(){ laState.swingHide=!laState.swingHide; if(typeof _laInsRerender==='function') _laInsRerender(); }
