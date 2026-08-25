// ═════════════════════════════════════════════════════════════════════════════
// League Analyzer — in-season tools (Matchup · Lineup · DvP · Trends)
//
// Four tabs that exist only once the season starts (hasSeasonStarted()). All
// state that must survive a re-render lives on laState (99-league-analyzer.js);
// everything transient (matchup cache, poll timer, sidecar status) is module-
// level here and never persisted. Data comes from three places, all shared with
// the rest of the app: live Sleeper (matchups per week), the pace machinery
// (58-pace.js / 17-pace-baseline.js), and the in-season nflverse sidecar
// (TC_INSEASON via ensureInseasonSidecar()).
// ═════════════════════════════════════════════════════════════════════════════

const LA_MATCHUPS_URL = (lid, wk)=>`https://api.sleeper.app/v1/league/${lid}/matchups/${wk}`;

// Transient matchup state: per-week rows cache + poll bookkeeping.
var _laMu = { byWeek:{}, fetching:{}, pollTimer:null, lastSig:'' };
var _laInsRerenderQueued = false;

function laCurrentWeek(){
  const w = (typeof TC_SEASON!=='undefined') ? Number(TC_SEASON.week||0) : 0;
  return Math.min(18, Math.max(1, w||1));
}
function laMuWeek(){ return laState.muWeek!=null ? laState.muWeek : laCurrentWeek(); }
function laSetMuWeek(w){ laState.muWeek = (Number(w)===laCurrentWeek()) ? null : Number(w); laState.muFocus=null; laRerenderKeepScroll(); }

// ── The Season tab: four panes behind one tab ────────────────────────────────
// The in-season tools are PANES inside a single "Season" tab (icon chips), not four more
// top-level tabs — one tap deep, and the analyzer bar stays six tabs wide.
function laActivePane(){
  const t=laState.laTab;
  if(t==='season') return laState.seasonPane||'matchup';
  return (t==='matchup'||t==='lineup'||t==='dvp'||t==='trends') ? t : null;
}
function laSetPane(k){
  laState.laTab='season'; laState.seasonPane=k;
  laRerenderKeepScroll();
}
function laSeasonView(s, paneOverride){
  const pane=paneOverride||laActivePane()||'matchup';
  const panes=[['matchup','Matchup','versus'],['lineup','Lineup','clipboard'],['dvp','Defense','shield'],['trends','Trends','chart']];
  // phase-tabs + data-swipe-primary: within the Season tab, left/right swipes slide between
  // these PANES (the outer icon bar stays tappable); swiping back past Matchup continues to
  // the Trades tab (data-swipe-prev). Touches inside the matchup hero are claimed by the
  // hero's own matchup pager first.
  const bar=`<div class="phase-tabs la-pane-tabs" data-swipe-primary data-swipe-prev="trade">${panes.map(([k,l,ic])=>
    `<button class="phase-tab pane-tab ${pane===k?'active':''}" onclick="laSetPane('${k}')" title="${l}">${TC_ICON(ic)}<span class="tab-lbl">${l}</span></button>`).join('')}</div>`;
  const body = pane==='lineup'?laLineupView(s) : pane==='dvp'?laDvpView(s)
             : pane==='trends'?laTrendsView(s) : laMatchupView(s);
  return bar+body;
}

// ── Dispatch (99's render calls this; also the swipe-preview entry point) ────
function laTabViewHTML(key, s){
  laLivePollSync();
  // Off-season (or a stale restored session): the in-season tab doesn't exist — fall back.
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return null;
  switch(key){
    case 'season': return laSeasonView(s);
    case 'matchup':               // legacy keys render their pane, chrome included —
    case 'lineup':                // no state mutation here (previews call this too)
    case 'dvp':
    case 'trends': return laSeasonView(s, key);
    default: return null;
  }
}

// Re-render the analyzer once, next tick — used by async data arrivals so three parallel
// loads don't paint three times.
function _laInsRerender(){
  if(_laInsRerenderQueued) return;
  _laInsRerenderQueued = true;
  setTimeout(()=>{ _laInsRerenderQueued=false;
    if(currentPhase==='League') renderLeagueAnalyzer(); }, 0);
}

// Player meta from the snapshot (pid → {name,pos,team}); K/DEF starters fall back to the
// Sleeper player DB when it's loaded.
function _laRosterMeta(s){
  const m={};
  (s.teamList||[]).forEach(t=>(t.players||[]).forEach(p=>{ m[p.id]=p; }));
  return m;
}
function _laPidMeta(metaMap, pid){
  if(metaMap[pid]) return metaMap[pid];
  const sp = (typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers[pid] : null;
  if(sp) return {id:pid, name:sp.name||`${sp.first_name||''} ${sp.last_name||''}`.trim(), pos:sp.pos||sp.position, team:sp.team};
  return {id:pid, name:String(pid), pos:'', team:''};
}
function _laMyTeamRow(s){
  return (s.myUserId && (s.teamList||[]).find(t=>t.ownerId===s.myUserId)) || (s.teamList||[])[0] || null;
}

// ── Matchups: fetch + poll ───────────────────────────────────────────────────
async function laFetchMatchups(week, silent){
  const s=leagueSnapshot;
  if(!s || s.provider==='espn' || _laMu.fetching[week]) return;
  _laMu.fetching[week]=true;
  // Snapshot identity guard: if the user switches leagues while this request is in flight,
  // league A's late rows must not repopulate the cache under league B.
  const ref=(typeof laSnapshotRef==='function')?laSnapshotRef(s):null;
  try{
    const rows = await sleeperFetch(LA_MATCHUPS_URL(s.leagueId, week));
    if(ref && typeof laSnapshotRef==='function' && laSnapshotRef()!==ref) return;
    if(Array.isArray(rows) && rows.length){
      const sig = rows.map(r=>`${r.roster_id}:${r.points}`).sort().join('|');
      const prev = _laMu.byWeek[week];
      _laMu.byWeek[week] = { rows, fetchedAt: Date.now(), sig };
      // Re-render only when something actually moved (poll ticks would otherwise reset scroll).
      if(!silent || !prev || prev.sig!==sig) _laInsRerender();
    } else if(!silent){
      _laMu.byWeek[week] = { rows:[], fetchedAt: Date.now(), sig:'' };
      _laInsRerender();
    }
  }catch(e){ /* offline — the view keeps its loading/empty state */ }
  finally{ _laMu.fetching[week]=false; }
}

// Start/stop the 45s score poll. Runs ONLY while: on the Matchup tab of the League view,
// viewing the current week, season running, tab visible, Sleeper league. Anything else
// clears the timer; a stray tick self-heals by calling this first.
function laLivePollSync(){
  const want = typeof currentPhase!=='undefined' && currentPhase==='League'
    && leagueSnapshot && leagueSnapshot.provider!=='espn'
    && laActivePane()==='matchup' && laMuWeek()===laCurrentWeek()
    && (typeof TC_SEASON!=='undefined' && (TC_SEASON.phase==='regular'||TC_SEASON.phase==='post'))
    && (typeof document==='undefined' || document.visibilityState==='visible');
  if(want && !_laMu.pollTimer){
    _laMu.pollTimer = setInterval(()=>{ laLivePollSync(); if(_laMu.pollTimer) laFetchMatchups(laCurrentWeek(), true); }, 45000);
  } else if(!want && _laMu.pollTimer){
    clearInterval(_laMu.pollTimer); _laMu.pollTimer=null;
  }
}
if(typeof document!=='undefined' && document.addEventListener)
  document.addEventListener('visibilitychange', ()=>{ try{ laLivePollSync(); }catch(e){} });

// ── Matchup / Scoreboard view ────────────────────────────────────────────────

// ── Shared in-season helpers ─────────────────────────────────────────────────
// Schedule line for a team-week: "Sun 1:00 PM vs TB" / "@ HOU" / "BYE". schedule_meta rides
// in the sidecar ([opp, home, weekday, kickoff ET, date]); the plain schedule is the fallback.
function laGameInfo(team, wk){
  const ins=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON)||null;
  const tm=String(team||'').toUpperCase();
  if(!ins || !tm) return null;
  const m=ins.schedule_meta && ins.schedule_meta[tm];
  if(m){
    const row=m[String(wk)];
    if(!row) return (ins.schedule&&ins.schedule[tm]) ? {bye:true} : null;
    return {opp:row[0], home:!!row[1], day:row[2]||'', time:row[3]||'', date:row[4]||'', bye:false};
  }
  const sch=ins.schedule && ins.schedule[tm];
  if(!sch) return null;
  const opp=sch[String(wk)];
  return opp ? {opp, home:null, day:'', time:'', date:'', bye:false} : {bye:true};
}
// Has this team's game for the week kicked off (ET kickoff vs now)? null = unknown.
function laGameStarted(team, wk){
  const g=laGameInfo(team, wk);
  if(!g || g.bye || !g.date) return null;
  try{
    // date is YYYY-MM-DD, time "1:00 PM" in ET; build the instant (ET ≈ UTC-4/-5 by month).
    const m=/^(\d+):(\d+)\s*(AM|PM)$/i.exec(g.time||'');
    let h=m?Number(m[1])%12+(m[3].toUpperCase()==='PM'?12:0):13, mi=m?Number(m[2]):0;
    const [y,mo,d]=g.date.split('-').map(Number);
    const off=(mo>=11||mo<=3)?5:4;   // EST Nov–Mar, EDT otherwise (close enough for "has it started")
    const t=Date.UTC(y,mo-1,d,h+off,mi,0);
    return Date.now()>=t;
  }catch(e){ return null; }
}
function laGameLineHTML(p, wk, dvp){
  const g=laGameInfo(p.team, wk);
  if(!g) return '';
  if(g.bye) return `<span class="la-gm la-gm-bye">BYE</span>`;
  const rk=(dvp&&dvp.ranks[g.opp]&&dvp.ranks[g.opp][p.pos])||null;
  const n=(dvp&&dvp.codes.length)||32;
  const rkCls=rk?(rk<=Math.ceil(n/4)?'la-gm-soft':rk>Math.ceil(3*n/4)?'la-gm-hard':''):'';
  const when=[g.day,g.time].filter(Boolean).join(' ');
  return `<span class="la-gm">${when?`<span class="la-gm-when">${escHtml(when)}</span> `:''}<span class="la-gm-opp ${rkCls}">${g.home===false?'@':'vs'} ${escHtml(g.opp)}${rk?` <span class="la-gm-rk" title="${escAttr(g.opp)} allows the #${rk} most fantasy points to ${p.pos}s (of ${n}) — ${rk<=Math.ceil(n/4)?'a matchup to attack':rk>Math.ceil(3*n/4)?'a tough draw':'middle of the pack'}">(${ordinal(rk)})</span>`:''}</span></span>`;
}
// Normal CDF (Abramowitz–Stegun) for win probability.
function _laNormCdf(z){ const t=1/(1+0.2316419*Math.abs(z)); const d=0.3989423*Math.exp(-z*z/2);
  let p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274)))); return z>0?1-p:p; }
// Live win probability for side A: margin now + remaining projections, spread by what's left.
function laWinProb(aPts,aRem,bPts,bRem){
  const margin=(aPts+aRem)-(bPts+bRem);
  const sd=Math.sqrt(aRem*aRem+bRem*bRem)*0.45+1.5;
  return _laNormCdf(margin/sd);
}
function laOwnerHandle(t){ return t&&t.owner?`@${escHtml(t.owner)}`:''; }
function laTeamAvatar(t,cls){ return laTeamIcon(t, cls||'la-mu-av'); }
function _laPosOf(p){ return String(p.pos||'').toUpperCase(); }
// Display name: "J. Burrow" on phones, full on desktop — the CSS hides one of the two.
function laNameHTML(p, cls){
  const full=escHtml(p.name||'');
  const short=escHtml(typeof abbrevName==='function'?abbrevName(p.name||''):p.name||'');
  return `<span class="la-nm ${cls||''} clickable-player" onclick="${pcardOnclick(p.id||p.name,p.pos,p.team||'')}" title="${escAttr(p.name||'')}"><span class="la-nm-full">${full}</span><span class="la-nm-short">${short}</span></span>`;
}
// gsis → Sleeper id (for sidecar-keyed rows), built once per player DB.
var _laGsisMap=null, _laGsisSrc=null;
function laPidFromGsis(g){
  if(typeof sleeperPlayers==='undefined' || !sleeperPlayers) return null;
  if(_laGsisSrc!==sleeperPlayers){ _laGsisMap={}; for(const pid in sleeperPlayers){ const x=sleeperPlayers[pid]; if(x&&x.gsis_id) _laGsisMap[String(x.gsis_id).trim()]=pid; } _laGsisSrc=sleeperPlayers; }
  return _laGsisMap[String(g||'').trim()]||null;
}
function laPidFromName(name,pos){
  if(typeof resolvePlayerId==='function'){ try{ return resolvePlayerId(name,pos)||null; }catch(e){} }
  return null;
}

// ── Matchup / Scoreboard view ────────────────────────────────────────────────
function _laEspnInseasonNote(){
  return `<div class="card la-ins-empty">
    <div class="empty-title">Live scoring for ESPN leagues is coming</div>
    <div class="empty-body">Sleeper leagues get the live scoreboard today; the Lineup, DvP and Trends tabs work for every league.</div></div>`;
}
function laToggleMuBench(){ laState.muBench=!laState.muBench; laRerenderKeepScroll(); }
// Swipe left/right on the hero card to walk the league's other matchups; swipes anywhere
// else keep changing tabs like the rest of the app. Tapping a scoreboard card jumps to it.
function laMuFocus(i){ laState.muFocus=i; laRerenderKeepScroll(); }
function laMuFocusStep(d, total){
  const cur=laState.muFocus!=null?laState.muFocus:0;
  laMuFocus(((cur+d)%total+total)%total);
}
function _laBindMuHeroSwipe(host){
  const hero=host && host.querySelector ? host.querySelector('.la-mu-hero') : null;
  if(!hero || hero._muSwipeBound) return;
  hero._muSwipeBound=true;
  // Landing after a hero swipe: the fresh hero slides in from the side it was pulled toward.
  if(laState._muSlideIn){
    const dir=laState._muSlideIn; laState._muSlideIn=null;
    const w=hero.offsetWidth||320;
    hero.style.transition='none'; hero.style.transform=`translateX(${dir>0?w:-w}px)`;
    requestAnimationFrame(()=>{ hero.style.transition='transform .18s ease-out'; hero.style.transform='translateX(0px)'; });
  }
  const total=Number(hero.dataset.muTotal||0); if(total<2) return;
  let x0=null,y0=null,claimed=false;
  hero.addEventListener('touchstart',e=>{ const t=e.touches[0];
    // Only the SCORE HEADER pages between matchups (team names, score, win bars, pager dots).
    // A swipe starting on the starters/bench rows falls through to the pane-swipe engine, so
    // the roster area changes VIEWS left/right like everywhere else in the Season tab.
    const hdr = e.target && e.target.closest && e.target.closest('.la-mu-fhead,.la-mu-fscore,.la-mu-fproj,.la-mu-pager');
    if(!hdr){ x0=null; return; }
    x0=t.clientX; y0=t.clientY; claimed=false;
    hero.style.transition='none'; },{passive:true});
  hero.addEventListener('touchmove',e=>{
    if(x0==null) return; const t=e.touches[0];
    const dx=t.clientX-x0, dy=t.clientY-y0;
    if(!claimed && Math.abs(dx)>10 && Math.abs(dx)>Math.abs(dy)*1.4) claimed=true;
    if(claimed){
      e.stopPropagation();
      // Follow the finger with a little resistance, same feel as the tab swipe.
      hero.style.transform=`translateX(${Math.sign(dx)*Math.min(300,Math.abs(dx)*0.9)}px)`;
    }
  },{passive:true});
  const settle=(e)=>{
    if(x0==null) return; const t=e.changedTouches[0];
    const dx=t.clientX-x0, dy=t.clientY-y0; x0=null;
    if(claimed && Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.4){
      e.stopPropagation();
      const w=hero.offsetWidth||320;
      hero.style.transition='transform .16s ease-out';
      hero.style.transform=`translateX(${dx<0?-w:w}px)`;
      laState._muSlideIn = dx<0?1:-1;
      setTimeout(()=>{ laMuFocusStep(dx<0?1:-1, total); }, 130);
    } else {
      hero.style.transition='transform .16s ease-out';
      hero.style.transform='translateX(0px)';
    }
  };
  hero.addEventListener('touchend',settle,{passive:true});
  hero.addEventListener('touchcancel',settle,{passive:true});
}
function laMatchupView(s){
  if(s.provider==='espn') return _laEspnInseasonNote();
  const wk=laMuWeek(), cur=laCurrentWeek();
  const weekSel = `<select class="la-tc-sel la-wk-sel" onchange="laSetMuWeek(this.value)">
    ${Array.from({length:cur},(_,i)=>cur-i).map(w=>`<option value="${w}" ${w===wk?'selected':''}>Week ${w}${w===cur?' · current':''}</option>`).join('')}
  </select>`;
  const head = `<div class="la-ins-bar"><span class="la-ins-lbl">MATCHUPS</span>${weekSel}</div>`;
  const data=_laMu.byWeek[wk];
  if(!data){
    laFetchMatchups(wk);
    return `${head}<div class="card la-ins-empty"><div class="empty-body">Loading week ${wk} matchups…</div></div>`;
  }
  if(!data.rows.length)
    return `${head}<div class="card la-ins-empty"><div class="empty-body">No matchups for week ${wk} — Sleeper hasn't published this week yet.</div></div>`;
  const meta=_laRosterMeta(s);
  const teamBy={}; (s.teamList||[]).forEach(t=>{ teamBy[t.rosterId]=t; });
  const pm=laProjMap();
  const dvp=laDvpTable();
  if(!dvp) _laSidecarKick();
  const projOf=(pid)=>{ const p=_laPidMeta(meta,pid); const a=laAdjWeekProj(p,wk,pm,dvp); return a.adj; };
  const pairs={};
  data.rows.forEach(r=>{ (pairs[r.matchup_id||('solo'+r.roster_id)]=pairs[r.matchup_id||('solo'+r.roster_id)]||[]).push(r); });
  const my=_laMyTeamRow(s);
  const myRow = my && data.rows.find(r=>r.roster_id===my.rosterId);
  const myPair = myRow && pairs[myRow.matchup_id];

  // Per-team summary for a matchup row: points, projected, remaining, yet-to-play.
  const summarize=(row)=>{
    const t=teamBy[row.roster_id]||{};
    const starters=row.starters||[], pts=row.starters_points||[];
    let proj=0, rem=0, ytp=0;
    starters.forEach((pid,i)=>{
      if(!pid||pid==='0') return;
      const p=_laPidMeta(meta,pid); const pr=projOf(pid); proj+=pr;
      const started=laGameStarted(p.team, wk);
      const played = started===true || (started===null && (pts[i]||0)>0) || wk<cur;
      if(!played){ rem+=pr; ytp++; }
    });
    return {t, row, name:t.teamName||`Roster ${row.roster_id}`, rec:`${t.wins!=null?t.wins:'–'}-${t.losses!=null?t.losses:'–'}`,
      pts:Number(row.points||0), proj, rem, ytp, n:starters.filter(x=>x&&x!=='0').length};
  };
  const sideHTML=(S, side, wp)=>{
    const pct=Math.round(wp*100);
    const wcls=pct>=55?'la-wp-up':pct<=45?'la-wp-dn':'';
    const barPct=Math.max(2, Math.min(100, 100*S.pts/Math.max(S.pts+S.rem, S.proj, 1)));
    return `<div class="la-mu-side la-mu-${side}">
      <div class="la-mu-idrow">${laTeamAvatar(S.t,'la-mu-av')}<div class="la-mu-id"><b class="la-mu-tname" title="${escAttr(S.name)}">${escHtml(S.name)}</b><span class="la-mu-sub">${laOwnerHandle(S.t)} · ${S.rec}</span></div></div>
      <div class="la-mu-score"><span class="la-mu-pts">${S.pts.toFixed(2)}</span><span class="la-mu-projsm">proj ${(S.pts+S.rem).toFixed(1)}</span></div>
      <div class="la-mu-wp ${wcls}"><b>${pct}%</b> win</div>
      <div class="la-mu-bar"><div class="la-mu-barfill ${wcls}" style="width:${barPct.toFixed(0)}%"></div></div>
      <div class="la-mu-ytp">${S.ytp?`yet to play (${S.ytp}) · ${S.rem.toFixed(1)} proj left`:'all players done'}</div>
    </div>`;
  };
  const playerCell=(pid, pts, side)=>{
    if(!pid||pid==='0') return `<div class="la-mu-p la-mu-p-${side} la-mu-p-empty">— empty —</div>`;
    const p=_laPidMeta(meta,pid);
    const a=laAdjWeekProj(p,wk,pm,dvp);
    const started=laGameStarted(p.team, wk);
    const played = started===true || (started===null && (pts||0)>0) || wk<cur;
    return `<div class="la-mu-p la-mu-p-${side}">
      <span class="clickable-player la-mu-hs" onclick="${pcardOnclick(p.id||p.name,p.pos,p.team||'')}">${laPlayerImg(p,'la-mu-hsimg')}</span>
      <div class="la-mu-pinfo">${laNameHTML(p)}
        <div class="la-mu-pmeta"><span class="la-pos-${_laPosOf(p)}">${_laPosOf(p)}</span> · ${escHtml(p.team||'FA')}${a.out?` <span class="la-lh-flag la-lh-sit">${escHtml(String(a.status).toUpperCase())}</span>`:''}</div>
        <div class="la-mu-pgame">${laGameLineHTML(p, wk, dvp)}</div></div>
      <div class="la-mu-ppts ${played?'':'la-mu-ppts-pre'}"><b>${played?(pts!=null?pts:0).toFixed(2):'–'}</b><span class="la-mu-pproj">${a.bye?'BYE':a.adj.toFixed(2)}</span></div>
    </div>`;
  };
  const slotLabels=laSlotLabels(s.rosterPositions);
  const benchRows=(row)=>{
    const starters=new Set((row.starters||[]));
    return (row.players||[]).filter(pid=>!starters.has(pid)).map(pid=>{ const p=_laPidMeta(meta,pid); const pts=(row.players_points||{})[pid]; return {pid,p,pts:pts!=null?Number(pts):0}; })
      .sort((a,b)=>b.pts-a.pts);
  };
  // Every pairing, ordered with mine first — the hero card walks this list by swipe.
  const pairList=Object.keys(pairs).map(k=>pairs[k]).filter(pr=>pr.length===2);
  const myIdx=my ? pairList.findIndex(pr=>pr.some(r=>r.roster_id===my.rosterId)) : -1;
  if(myIdx>0){ const [mp]=pairList.splice(myIdx,1); pairList.unshift(mp); }
  let focus=Math.min(Math.max(0, laState.muFocus!=null?laState.muFocus:0), Math.max(0,pairList.length-1));
  let featured='';
  if(pairList.length){
    const pr=pairList[focus];
    const isMine = my && pr.some(r=>r.roster_id===my.rosterId);
    const [a,b] = (isMine && pr[1].roster_id===my.rosterId) ? [pr[1],pr[0]] : [pr[0],pr[1]];
    const A=summarize(a), B=summarize(b);
    const wpA=laWinProb(A.pts,A.rem,B.pts,B.rem), wpB=1-wpA;
    const rows=slotLabels.map((lbl,i)=>`<div class="la-mu-row">
        ${playerCell((a.starters||[])[i], (a.starters_points||[])[i], 'home')}
        <div class="la-mu-slot"><span class="la-slot la-slot-${lbl.replace(/[^A-Z]/g,'')||'X'}">${escHtml(lbl)}</span></div>
        ${playerCell((b.starters||[])[i], (b.starters_points||[])[i], 'away')}
      </div>`).join('');
    // Bench rows carry the full player cell — headshot, game line, points and projection —
    // exactly like the starters, so scrolling down never drops into a different design.
    const bench = laState.muBench ? (()=>{
      const ba=benchRows(a), bb=benchRows(b); const n=Math.max(ba.length,bb.length);
      const cell=(x,side)=> x ? playerCell(x.pid, x.pts, side) : `<div class="la-mu-p la-mu-p-${side} la-mu-p-empty"></div>`;
      return Array.from({length:n},(_,i)=>`<div class="la-mu-row la-mu-row-bn">${cell(ba[i],'home')}<div class="la-mu-slot"><span class="la-slot la-slot-BN">BN</span></div>${cell(bb[i],'away')}</div>`).join('');
    })() : '';
    const pager = pairList.length>1
      ? `<span class="la-mu-pager">${pairList.map((_,i)=>`<span class="la-mu-dot ${i===focus?'on':''}" onclick="laMuFocus(${i})"></span>`).join('')}</span>`
      : '';
    featured = `<div class="card la-mu-hero" data-mu-total="${pairList.length}">
      <div class="la-mu-fhead"><span class="la-ins-lbl">${isMine?'MY MATCHUP':'MATCHUP'} · WEEK ${wk}</span>${wk===cur?`<span class="draft-live">LIVE</span>`:''}${pager}</div>
      <div class="la-mu-fscore">${sideHTML(A,'home',wpA)}<div class="la-mu-vs">vs</div>${sideHTML(B,'away',wpB)}</div>
      <div class="la-mu-starters">
        <div class="la-mu-rowhead"><span>Starters</span><span class="la-ins-sub">points · projected</span></div>
        ${rows}
        ${bench}
        <button class="btn btn-ghost btn-sm la-mu-bnbtn" onclick="laToggleMuBench()">${laState.muBench?'Hide bench':'Show bench'}</button>
      </div>
      ${pairList.length>1?`<div class="la-mu-swipehint">swipe the scoreboard for the league's other matchups · swipe the rosters to change views</div>`:''}
    </div>`;
  }
  const board = pairList.map((pr,k)=>{
    const [a,b]=pr; const A=summarize(a), B=summarize(b);
    const wp=laWinProb(A.pts,A.rem,B.pts,B.rem);
    const mine = my && (a.roster_id===my.rosterId||b.roster_id===my.rosterId);
    const lead = A.pts===B.pts ? 0 : (A.pts>B.pts?1:-1);
    const line=(S,ld,w)=>`<div class="la-mu-grow ${ld?'la-mu-lead':''}">${laTeamAvatar(S.t,'la-mu-av-sm')}<span class="la-mu-gname"><span>${escHtml(S.name)}</span><span class="la-mu-gsub">${laOwnerHandle(S.t)} · ${S.rec}${S.ytp?` · ${S.ytp} to play`:''}</span></span><span class="la-mu-gwp">${Math.round(w*100)}%</span><b class="la-mu-gpts">${S.pts.toFixed(2)}</b></div>`;
    return `<div class="la-mu-game ${mine?'la-mu-mine':''} ${k===focus?'la-mu-focus':''}" onclick="laMuFocus(${k})" title="Show this matchup up top">${line(A,lead>0,wp)}${line(B,lead<0,1-wp)}</div>`;
  }).join('');
  const asof = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : '';
  return `${head}${featured}
    <div class="la-ins-bar"><span class="la-ins-lbl">SCOREBOARD</span>${asof?`<span class="la-ins-sub">updated ${asof}${wk===cur?' · refreshes every 45s while you watch':''}</span>`:''}</div>
    <div class="la-mu-board">${board}</div>
    <div class="la-note">win % = current points plus what's still projected to come, against the spread of what's left · projections are TripleCrown's, matchup- and form-adjusted</div>`;
}

// ── DvP: fantasy points allowed per game, by position ────────────────────────
// Built from the sidecar's raw allowed-production components and scored under the LEAGUE's
// own scoring, so a 6-pt-passing-TD league ranks defenses differently than a 4-pt one.
var _laDvpMemo=null, _laDvpSig='';
function laDvpTable(){
  if(typeof TC_INSEASON==='undefined' || !TC_INSEASON || !TC_INSEASON.def_vs_pos) return null;
  const dv=TC_INSEASON.def_vs_pos;
  const sig=`${TC_INSEASON.asof||''}~${buildPlayerScoringSig()}`;
  if(_laDvpMemo && _laDvpSig===sig) return _laDvpMemo;
  const ci={}; (dv.cols||[]).forEach((c,i)=>ci[c]=i);
  const POS=['QB','RB','WR','TE'];
  const teams={};
  for(const code in (dv.teams||{})){
    teams[code]={};
    // Divisor = games this defense actually played in the sidecar window (schedule-derived),
    // NOT weeks-with-rows: a positional shutout used to shrink the divisor and make the
    // defense's BEST performance read as an easier matchup.
    const schedGames=(()=>{ const sch=TC_INSEASON.schedule && TC_INSEASON.schedule[code];
      if(!sch || !Array.isArray(TC_INSEASON.weeks)) return null;
      return TC_INSEASON.weeks.filter(w=>sch[String(w)]).length || null; })();
    POS.forEach(pos=>{
      const wkMap=(dv.teams[code]||{})[pos]||{};
      const weeks=Object.keys(wkMap);
      const sum=(c)=>weeks.reduce((a,w)=>a+((wkMap[w]||[])[ci[c]]||0),0);
      const row={pos, receiving_targets:sum('tgt'), receptions:sum('rec'),
        receiving_yards:sum('rec_yd'), receiving_tds:sum('rec_td'),
        rushing_attempts:sum('carry'), rushing_yards:sum('rush_yd'), rushing_tds:sum('rush_td'),
        passing_attempts:sum('pass_att'), passing_yards:sum('pass_yd'),
        passing_tds:sum('pass_td'), interceptions_thrown:sum('pass_int')};
      const g=schedGames || weeks.length || 1;
      teams[code][pos]={fppg: calcFpts(row)/g, games:g};
    });
  }
  const codes=Object.keys(teams);
  const ranks={};
  POS.forEach(pos=>{
    // Rank 1 = MOST points allowed = the matchup you want. Fantasy asks "who do I pick on",
    // so the whole surface (colors, sorts, the "(3rd)" tags) reads easiest-first.
    const order=[...codes].sort((a,b)=>teams[b][pos].fppg-teams[a][pos].fppg);
    order.forEach((c,i)=>{ (ranks[c]=ranks[c]||{})[pos]=i+1; });
  });
  _laDvpMemo={teams, ranks, codes:codes.sort()};
  _laDvpSig=sig;
  return _laDvpMemo;
}
function laSetDvpSort(col){
  const s=laState.dvpSort||{col:'QB',dir:1};
  laState.dvpSort = (s.col===col) ? {col, dir:-s.dir} : {col, dir:1};
  laRerenderKeepScroll();
}
function laSetDvpPos(p){ laState.dvpPos=p; laRerenderKeepScroll(); }

function laDvpView(s){
  const t=laDvpTable();
  if(!t){
    if(typeof ensureInseasonSidecar==='function'){
      const st=_laSidecarKick();
      if(st==='loading') return `<div class="card la-ins-empty"><div class="empty-body">Loading defensive splits…</div></div>`;
    }
    return `<div class="card la-ins-empty"><div class="empty-title">No defensive data yet</div>
      <div class="empty-body">Defense-vs-position builds from the weekly nflverse sidecar — it appears once the first week of the season is in the books (and needs a hosted seed).</div></div>`;
  }
  const POS=['QB','RB','WR','TE'];
  const sort=laState.dvpSort||{col:'QB',dir:1};
  const pos1=laState.dvpPos&&laState.dvpPos!=='ALL'?laState.dvpPos:null;
  const codes=[...t.codes].sort((a,b)=>{
    const col=pos1||sort.col;
    return (t.teams[b][col].fppg-t.teams[a][col].fppg)*(pos1?1:sort.dir);   // easiest matchups first
  });
  const n=t.codes.length;
  const wk=(typeof completedWeeks==='function')?completedWeeks():0;
  const small = wk>0 && wk<=4
    ? `<div class="discrepancy-note">${TC_ICON("warning")} ${wk} game${wk===1?'':'s'} is a small sample — these ranks move a lot early in the season.</div>` : '';
  const chips = ['ALL',...POS].map(p=>`<button class="pos-filter-btn ${((laState.dvpPos||'ALL')===p)?'active':''}" onclick="laSetDvpPos('${p}')">${p}</button>`).join('');
  const posCols = pos1?[pos1]:POS;
  // League average per position, for the bar scale + the "vs avg" read.
  const avg={}; POS.forEach(p=>{ avg[p]=t.codes.reduce((a,c)=>a+t.teams[c][p].fppg,0)/Math.max(1,n); });
  const mx={}; POS.forEach(p=>{ mx[p]=Math.max(...t.codes.map(c=>t.teams[c][p].fppg))||1; });
  const header = `<tr><th class="la-dvp-th-team">DEFENSE</th>${posCols.map(p=>`<th onclick="laSetDvpSort('${p}')" class="la-dvp-th ${(!pos1&&sort.col===p)?'active':''}">vs ${p}${!pos1&&sort.col===p?(sort.dir<0?' ↓':' ↑'):''}</th>`).join('')}</tr>`;
  const nextOppOf=(code)=>{ const g=laGameInfo(code, laCurrentWeek()); return g? (g.bye?'BYE':`${g.home===false?'@':'vs'} ${g.opp}`) : ''; };
  const rows = codes.map(c=>{
    const cells=posCols.map(p=>{
      const cell=t.teams[c][p]; const rk=t.ranks[c][p];
      const d=cell.fppg-avg[p];
      return `<td class="la-dvp-cell ${laQuartile(rk, n)}">
        <div class="la-dvp-val"><b>${cell.fppg.toFixed(1)}</b><span class="la-rk">#${rk}</span></div>
        <div class="la-dvp-barwrap"><div class="la-dvp-bar" style="width:${Math.max(3,100*cell.fppg/mx[p]).toFixed(0)}%"></div></div>
        <div class="la-dvp-vs">${d>=0?'+':'−'}${Math.abs(d).toFixed(1)} vs avg</div></td>`;
    }).join('');
    const full=(typeof TEAM_NAMES!=='undefined'&&TEAM_NAMES&&TEAM_NAMES[c])||c;
    return `<tr><td class="la-dvp-team"><span class="la-dvp-open clickable-player" onclick="openPlayerCard('${c}','DEF','${c}')" title="${escHtml(String(full))} defense — season to date"><img src="${NFL_LOGO(c)}" class="la-dvp-logo" loading="lazy" onerror="this.style.display='none'"></span><div><b class="la-dvp-open" onclick="openPlayerCard('${c}','DEF','${c}')" title="Open the ${c} defense card">${c}</b><span class="la-dvp-tsub">${escHtml(String(full).replace(/^.*\s/,''))}${nextOppOf(c)?` · next ${escHtml(nextOppOf(c))}`:''}</span></div></td>${cells}</tr>`;
  }).join('');
  return `${small}
    <div class="la-ins-bar"><span class="la-ins-lbl">FANTASY POINTS ALLOWED / GAME</span>
      <div class="pos-filter">${chips}</div>
      <span class="la-ins-sub">your league's scoring · thru wk ${wk} · #1 = easiest matchup (most points allowed)</span></div>
    <div class="card card-flush"><div class="la-dvp-wrap">
      <table class="la-dvp-table ${pos1?'la-dvp-one':''}"><thead>${header}</thead><tbody>${rows}</tbody></table></div></div>
    <div class="la-note">green = easy matchup (allows the most points) · red = tough · tap a column to sort</div>`;
}

// ── Lineup (your team this week) ─────────────────────────────────────────────
// Injury designations that mean "will not play" — a zero for the week, whatever the pace.
const LA_OUT_STATUS = { Out:1, IR:1, PUP:1, Sus:1, Suspended:1, NA:1, DNR:1 };
function laWeekAvailability(p, wk){
  const sched=(typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.schedule)||null;
  const team=String(p.team||'').toUpperCase();
  // On a bye = the schedule knows the team and has no opponent that week. (No schedule, or
  // a team code it doesn't know → unknown, assume playing.)
  const bye = !!(sched && team && sched[team] && !sched[team][String(wk)]);
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers && p.id) ? sleeperPlayers[p.id] : null;
  const st=sp && sp.injury_status ? String(sp.injury_status) : '';
  const out=!!(st && LA_OUT_STATUS[st]);
  return { bye, out, status: st };
}
// Recent form: fantasy points per game over the last 3 PLAYED weeks, scored under the
// league's own settings, straight from the sidecar's per-player weekly usage lines.
var _laFormMemo=null, _laFormSig='';
function laWeeklyFormMap(){
  const pw=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON&&TC_INSEASON.player_weekly)||null;
  if(!pw) return null;
  const sig=`${TC_INSEASON.asof||''}~${buildPlayerScoringSig()}`;
  if(_laFormMemo && _laFormSig===sig) return _laFormMemo;
  const ci={}; (pw.cols||[]).forEach((c,i)=>ci[c]=i);
  const m=new Map();
  for(const g in pw.players){
    const pl=pw.players[g];
    const weeks=Object.keys(pl.w).map(Number).sort((a,b)=>a-b);
    if(!weeks.length) continue;
    const score=(r)=>calcFpts({pos:pl.p, receptions:r[ci['rec']]||0, receiving_yards:r[ci['rec_yd']]||0,
      receiving_tds:r[ci['rec_td']]||0, receiving_targets:r[ci['tgt']]||0,
      rushing_yards:r[ci['rush_yd']]||0, rushing_tds:r[ci['rush_td']]||0, rushing_attempts:r[ci['carry']]||0,
      passing_yards:r[ci['pass_yd']]||0, passing_tds:r[ci['pass_td']]||0, passing_attempts:r[ci['pass_att']]||0,
      interceptions_thrown:r[ci['pass_int']]||0, fumbles_lost:0});
    const last3=weeks.slice(-3);
    const f3=last3.reduce((a,w)=>a+score(pl.w[String(w)]||[]),0)/last3.length;
    const entry={f3, n3:last3.length, lastWk:weeks[weeks.length-1]};
    const pid=laPidFromGsis(g);
    if(pid) m.set(String(pid), entry);
    m.set(ecrNormName(pl.n||'')+'|'+(pl.p||''), entry);
  }
  _laFormMemo=m; _laFormSig=sig;
  return m;
}
// Weekly projection = OUR blend, not a flat season-projection ÷ 17:
//   35% season projection rate + 30% season-to-date FPPG + 35% last-3-weeks FPPG,
// then the opponent's defense-vs-position multiplier (±10%). A back who took over the
// backfield two weeks ago projects like the starter he now is (the old formula gave
// Kimani Vidal 0.15 the week he scored 17), and a faded role fades the number.
function laAdjWeekProj(p, wk, pm, dvp){
  const paceE=(typeof paceForPlayer==='function')?paceForPlayer(p.name,p.pos,p.id):null;
  const projG=(paceE && paceE.projGames>0)?paceE.projGames:17;
  const base=(pm.get(ecrNormName(p.name)+'|'+p.pos)||0)/projG;
  const avail=laWeekAvailability(p, wk);
  const zero={adj:0, base, baseRate:base, seas:null, rec3:null, defMult:1, opp:null, bye:avail.bye, out:avail.out, status:avail.status};
  // Bye week / ruled out: zero, so the optimizer never "starts" a player who cannot score.
  if(avail.bye || avail.out) return zero;
  const pace=(typeof paceForPlayer==='function')?paceForPlayer(p.name,p.pos,p.id):null;
  const gp=pace?pace.gp:0;
  const seas=(pace && gp>0)?pace.act/gp:null;
  const form=laWeeklyFormMap();
  const fe=form ? (form.get(String(p.id||''))||form.get(ecrNormName(p.name)+'|'+p.pos)) : null;
  const rec3=fe?fe.f3:null;
  let exp;
  if(!(base>0) && seas==null && rec3==null) return zero;
  if(seas!=null && rec3!=null && gp>=2)      exp=0.35*base+0.30*seas+0.35*rec3;
  else if(seas!=null)                        exp=0.55*base+0.45*seas;
  else                                       exp=base;
  let defMult=1, opp=null;
  const sched=(typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.schedule)||null;
  if(dvp && sched && p.team && sched[p.team]) opp=sched[p.team][String(wk)]||null;
  if(dvp && opp && dvp.ranks[opp] && dvp.ranks[opp][p.pos]){
    // rank 1 (most generous / easiest) → 1.10, last (stingiest) → 0.90, linear between.
    const r=dvp.ranks[opp][p.pos], n=dvp.codes.length||32;
    defMult=1.10 - 0.20*((r-1)/Math.max(1,n-1));
  }
  return {adj: exp*defMult, base, baseRate:base, seas, rec3, defMult, opp,
    thin: gp>0 && gp<3};
}
function laToggleLhShowAll(){ laState.lhShowAll=!laState.lhShowAll; laRerenderKeepScroll(); }
function laLineupView(s){
  const my=_laMyTeamRow(s);
  if(!my) return `<div class="card la-ins-empty"><div class="empty-body">No roster found in this snapshot.</div></div>`;
  const wk=laCurrentWeek();
  const pm=laProjMap();
  const dvp=laDvpTable();
  if(!dvp) _laSidecarKick();   // adjustments improve when it lands; render now regardless
  const meta=_laRosterMeta(s);
  const pool=(my.players||[]).filter(p=>p&&p.pos&&['QB','RB','WR','TE','K','DEF'].includes(p.pos));
  const scored=pool.map(p=>{ const a=laAdjWeekProj(p,wk,pm,dvp); return Object.assign({},p,{_a:a}); })
    .sort((a,b)=>b._a.adj-a._a.adj);
  const optimal=laFillStarters(scored, s.rosterPositions);
  // Current lineup: the week's matchup row carries the set starters.
  const mu=_laMu.byWeek[wk];
  if(!mu && s.provider!=='espn') laFetchMatchups(wk);
  const myRow=mu && mu.rows.find(r=>r.roster_id===my.rosterId);
  const currentSet=new Set((myRow&&myRow.starters||[]).filter(pid=>pid&&pid!=='0'));
  const optimalSet=new Set(optimal.filter(f=>f.player).map(f=>f.player.id));
  const haveCurrent=currentSet.size>0;
  const slotLabels=laSlotLabels(s.rosterPositions);
  const projTotal=optimal.reduce((a,f)=>a+(f.player?f.player._a.adj:0),0);
  // Only compare against the set lineup when every set starter is on the snapshot roster —
  // a starter who has since been dropped would read as a 0 and inflate the "gain".
  const allKnown = haveCurrent && [...currentSet].every(pid=>scored.some(p=>p.id===pid));
  const curTotal=allKnown ? scored.filter(p=>currentSet.has(p.id)).reduce((a,p)=>a+p._a.adj,0) : null;
  const gain = curTotal!=null ? projTotal-curTotal : 0;
  const paceTag=(p)=>{ const e=(typeof paceForPlayer==='function')?paceForPlayer(p.name,p.pos,p.id):null;
    if(!e||!(e.base>0)||!(e.gp>0)) return ''; return `<span class="pace-chip ${e.cls}" title="17-game pace ${e.pace17.toFixed(0)} vs proj ${e.base.toFixed(0)}">${e.cls==='pace-thin'?'':(e.delta>=0?'▲':'▼')}${e.pct>=0?'+':'−'}${Math.round(Math.abs(e.pct)*100)}%</span>`; };
  const playerRow=(p, slotLbl, kind)=>{
    const a=p._a;
    const inCur=currentSet.has(p.id);
    const swap = kind==='start' && haveCurrent && !inCur && !a.bye && !a.out && a.adj>0;
    const flags=[];
    if(a.bye) flags.push('<span class="la-lh-flag la-lh-sit" title="On a bye this week">BYE</span>');
    else if(a.out) flags.push(`<span class="la-lh-flag la-lh-sit" title="Sleeper injury status: ${escAttr(a.status)}">${escHtml(String(a.status).toUpperCase())}</span>`);
    if(swap) flags.push('<span class="la-lh-flag la-lh-start">START</span>');
    if(kind==='sit') flags.push('<span class="la-lh-flag la-lh-sit">SIT?</span>');
    if(a.thin) flags.push('<span class="la-lh-flag la-lh-thin" title="Fewer than 3 games of live data behind the pace adjustment">THIN</span>');
    const slotKey=String(slotLbl||'').replace(/[^A-Z]/g,'')||'BN';
    return `<div class="la-tm-row ${swap?'la-lh-swap':''} ${kind==='sit'?'la-lh-sitrow':''} ${kind==='bench'?'la-lh-benchrow':''}">
      <span class="la-slot la-slot-${slotKey}">${escHtml(slotLbl||'BN')}</span>
      <span class="clickable-player la-tm-hs" onclick="${pcardOnclick(p.id||p.name,p.pos,p.team||'')}">${laPlayerImg(p,'la-tm-hsimg')}</span>
      <div class="la-tm-main">
        <div class="la-tm-l1">${laNameHTML(p,'la-tm-nm')} <span class="la-tm-pos la-pos-${_laPosOf(p)}">${_laPosOf(p)}</span><span class="la-tm-team">· ${escHtml(p.team||'FA')}</span>${paceTag(p)}</div>
        <div class="la-tm-l2">${laGameLineHTML(p, wk, dvp)||'<span class="la-gm la-gm-none">schedule pending</span>'}</div>
        ${flags.length?`<div class="la-tm-l3">${flags.join('')}</div>`:''}
      </div>
      <div class="la-tm-proj"><b title="${escAttr(`${a.adj.toFixed(1)} = blend of the preseason projection (${(a.baseRate||0).toFixed(1)}/gm)${a.seas!=null?`, season ${a.seas.toFixed(1)} FPPG`:''}${a.rec3!=null?`, last 3 wks ${a.rec3.toFixed(1)} FPPG`:''}${a.defMult!==1?` × ${a.defMult.toFixed(2)} matchup`:''}`)}">${a.bye||a.out?'0.0':a.adj.toFixed(1)}</b>${(a.baseRate>0&&Math.abs(a.adj-a.baseRate)>0.05&&!a.bye&&!a.out)?`<span class="la-lh-base">proj ${a.baseRate.toFixed(1)}</span>`:''}</div>
    </div>`;
  };
  const rows=optimal.map((f,i)=>{
    const lbl=slotLabels[i]||f.slot;
    if(!f.player) return `<div class="la-tm-row la-lh-empty-slot"><span class="la-slot">${escHtml(lbl)}</span><span class="la-tm-main">— no eligible player —</span></div>`;
    return playerRow(f.player, lbl, 'start');
  }).join('');
  const sits=haveCurrent ? scored.filter(p=>currentSet.has(p.id)&&!optimalSet.has(p.id)) : [];
  const sitRows=sits.map(p=>playerRow(p,'—','sit')).join('');
  const benchList=scored.filter(p=>!optimalSet.has(p.id)&&!sits.includes(p));
  const bench=laState.lhShowAll ? benchList.map(p=>playerRow(p,'BN','bench')).join('') : '';
  const notes=[];
  notes.push('proj: 35% season projection + 30% season FPPG + 35% last-3-weeks FPPG');
  notes.push(dvp?'matchup: opponent defense-vs-position (±10%)':'matchup adjustment off — defensive splits not loaded yet');
  if(!haveCurrent) notes.push(s.provider==='espn'?'ESPN league: optimal lineup only (no live starters feed)':'your set starters load with the week’s matchups');
  const g=laGameInfo(null, wk);
  return `
    <div class="card la-tm-hero">
      <div class="la-tm-herorow">${laTeamAvatar(my,'la-mu-av')}<div class="la-mu-id"><b class="la-mu-tname">${escHtml(my.teamName||'My team')}</b><span class="la-mu-sub">${laOwnerHandle(my)} · ${my.wins!=null?my.wins:'–'}-${my.losses!=null?my.losses:'–'}</span></div>
        <div class="la-tm-herototal"><span class="la-mu-projsm">week ${wk} projected</span><b>${projTotal.toFixed(1)}</b>${curTotal!=null&&gain>0.05?`<span class="la-tm-gain">+${gain.toFixed(1)} with the swaps below</span>`:curTotal!=null?`<span class="la-tm-gain la-tm-gain-ok">lineup is set optimally</span>`:''}</div></div>
    </div>
    <div class="la-ins-bar"><span class="la-ins-lbl">OPTIMAL LINEUP · WEEK ${wk}</span>
      <span class="la-ins-sub">${haveCurrent?'highlighted rows = start over your current lineup':'projection-driven, adjusted for matchup and recent form'}</span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="laToggleLhShowAll()">${laState.lhShowAll?'Hide bench':`Show bench (${benchList.length})`}</button></div>
    <div class="card la-tm-card">${rows}${sitRows?`<div class="la-tm-sep">currently starting · not in the optimal lineup</div>${sitRows}`:''}${bench?`<div class="la-tm-sep">bench</div>${bench}`:''}</div>
    <div class="la-note">${notes.join(' · ')} · tap a name for the player card</div>`;
}

// ── Trends: pace vs baseline, regression candidates, weekly trending ─────────
var _laSidecarState='cold';
function _laSidecarKick(){
  // 'ready' is only believable while the payload is actually in memory — the week-advance
  // recheck (and seed reloads) null TC_INSEASON without touching this flag.
  if(_laSidecarState==='ready' && !(typeof TC_INSEASON!=='undefined' && TC_INSEASON)) _laSidecarState='cold';
  if(_laSidecarState==='ready'||_laSidecarState==='loading') return _laSidecarState;
  if(typeof ensureInseasonSidecar!=='function'){ _laSidecarState='error'; return _laSidecarState; }
  _laSidecarState='loading';
  ensureInseasonSidecar().then(ok=>{ _laSidecarState=ok?'ready':'error'; if(ok) _laInsRerender(); });
  return _laSidecarState;
}
function laSetTrndScope(sc){ laState.trndScope=sc; laRerenderKeepScroll(); }
function laSetTrndTab(t){ laState.trndTab=t; laRerenderKeepScroll(); }
// Names rostered in this league, for the scope filters.
function _laLeagueNameSet(s){
  const set=new Set();
  (s.teamList||[]).forEach(t=>(t.players||[]).forEach(p=>set.add(ecrNormName(p.name)+'|'+p.pos)));
  return set;
}
// Minimum kickoff-baseline (season fantasy points) for the pace board.
const LA_TRND_MIN_BASE = 60;
// Proper display name: the sidecar's weekly lines carry lowercased roster names — prefer the
// Sleeper DB's real name, fall back to title case, never print "jaxon smithnjigba".
function _laDisplayName(p, pid){
  const sp=(pid && typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers[pid] : null;
  if(sp && sp.name) return sp.name;
  return String(p.name||'').replace(/\b[a-z]/g, c=>c.toUpperCase());
}
// One trend row, Sleeper-style: rank · headshot · name over a pos–team sub-line · one big
// right-aligned value (with a small caption). Everything else rides in the sub-line.
function _laTrendRow(p, detail, verdict, cls, rank){
  const pid=p.id||p.pid||laPidFromName(p.name,p.pos);
  const pp={id:pid, name:_laDisplayName(p,pid), pos:p.pos, team:p.team};
  const inj=(typeof tcInjuryTag==='function')?tcInjuryTag(pid):'';
  // The on-your-roster ★ rides the NAME line, never the verdict column — boards append it
  // to the verdict string for convenience, so lift it out here to keep the numbers aligned.
  verdict=String(verdict||'');
  let star='';
  const sm=verdict.match(/<span class="la-trnd-mine"[^>]*>[^<]*<\/span>/);
  if(sm){ star=sm[0]; verdict=verdict.replace(sm[0],''); }
  return `<div class="la-trnd-row ${cls||''}">
    ${rank?`<span class="la-trnd-rank">${rank}</span>`:''}
    <span class="clickable-player la-trnd-hs" onclick="${pcardOnclick(pid||pp.name,p.pos,p.team||'')}">${laPlayerImg(pp,'la-trnd-hsimg')}</span>
    <div class="la-trnd-main"><span class="la-trnd-nmline">${laNameHTML(pp,'la-trnd-name')}${star}${inj}</span><div class="la-trnd-sub"><span class="la-pos-${_laPosOf(p)}">${_laPosOf(p)}</span> · ${escHtml(p.team||'FA')}${detail?` · ${detail}`:''}</div></div>
    <div class="la-trnd-verdict">${verdict}</div></div>`;
}
// Team-row variant: logo + full team name, same right-hand verdict.
function _laTeamRow(code, detail, verdict, cls, rank){
  const nm=(typeof teamDisplayName==='function')?teamDisplayName(code):code;
  return `<div class="la-trnd-row ${cls||''}">
    ${rank?`<span class="la-trnd-rank">${rank}</span>`:''}
    <span class="la-trnd-hs"><img src="${NFL_LOGO(code)}" class="la-trnd-hsimg la-trnd-logo" loading="lazy" decoding="async" onerror="this.style.display='none'"></span>
    <div class="la-trnd-main"><span class="la-nm la-trnd-name">${escHtml(nm)}</span><div class="la-trnd-sub">${detail||''}</div></div>
    <div class="la-trnd-verdict">${verdict}</div></div>`;
}
// Sleeper-style verdict block: one big colored number, one quiet caption under it.
function _laVerdict(big, cap, cls){
  return `<div class="la-trnd-bigwrap"><b class="la-trnd-big ${cls||''}">${big}</b>${cap?`<span class="la-trnd-cap">${cap}</span>`:''}</div>`;
}
// Scope filter: whose players a board shows. 'waiver' = unrostered in THIS league.
function _laScopeKeeps(scope, mySet, lgSet){
  return (name,pos)=>{
    const k=ecrNormName(name)+'|'+pos;
    if(scope==='myteam')   return mySet.has(k);
    if(scope==='rostered') return lgSet.has(k);
    if(scope==='waiver')   return !lgSet.has(k);
    return true;   // league
  };
}
// Sidecar per-player summaries the Usage/Regression/Trending boards share.
function _laUsagePlayers(){
  const pw=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON&&TC_INSEASON.player_weekly)||null;
  if(!pw) return null;
  const ci={}; (pw.cols||[]).forEach((c,i)=>ci[c]=i);
  const players=Object.keys(pw.players).map(g=>{
    const p=pw.players[g]; const weeks=Object.keys(p.w).map(Number).sort((a,b)=>a-b);
    const sum=(c,set)=> (set||weeks).reduce((a,w)=>a+((p.w[String(w)]||[])[ci[c]]||0),0);
    const last3=weeks.slice(-3);
    const shareOf=(set)=>{ let tg=0,tt=0; (set||weeks).forEach(w=>{ const r=p.w[String(w)]||[]; tg+=r[ci['tgt']]||0; tt+=r[ci['team_tgt']]||0; }); return tt?100*tg/tt:0; };
    return {g, id:laPidFromGsis(g), name:p.n, pos:p.p, team:p.t, weeks, last3,
      tgt:sum('tgt'), rec_td:sum('rec_td'), carry:sum('carry'), rush_td:sum('rush_td'),
      tgt3:sum('tgt',last3), carry3:sum('carry',last3),
      share:shareOf(), share3:shareOf(last3), gp:weeks.length, gp3:last3.length};
  });
  return {players, ci, pw};
}
function laTrendsView(s){
  const wk=(typeof completedWeeks==='function')?completedWeeks():0;
  const scope=laState.trndScope||'rostered';
  const tab=laState.trndTab||(wk>=4?'trending':'pace');
  const my=_laMyTeamRow(s);
  const mySet=new Set(((my&&my.players)||[]).map(p=>ecrNormName(p.name)+'|'+p.pos));
  const lgSet=_laLeagueNameSet(s);
  const keeps=_laScopeKeeps(scope, mySet, lgSet);
  const mineMark=(name,pos)=> mySet.has(ecrNormName(name)+'|'+pos) ? '<span class="la-trnd-mine" title="on your roster">★</span>' : '';
  const tabs=[['trending','Trending'],['pace','Pace'],['usage','Usage'],['regression','TDs'],['teams','Teams'],['ros','ROS']]
    .map(([k,l])=>`<button class="pane-tab ${tab===k?'active':''}" onclick="laSetTrndTab('${k}')">${l}</button>`).join('');
  const scopes=(tab==='teams')?'':`<div class="pos-filter la-trnd-scope">${[['rostered','Rostered'],['myteam','My Team'],['waiver','Waivers'],['league','League']]
    .map(([k,l])=>`<button class="pos-filter-btn ${scope===k?'active':''}" onclick="laSetTrndScope('${k}')">${l}</button>`).join('')}</div>`;
  const bar=`<div class="la-trnd-bar"><div class="la-pane-tabs la-trnd-tabs">${tabs}</div>
    ${scopes?`<div class="la-trnd-scoperow"><span class="tc-label">Scope</span>${scopes}</div>`:''}</div>`;
  const two=(title,sub,upLbl,upRows,dnLbl,dnRows)=>`
    <div class="la-ins-bar"><span class="la-ins-lbl">${title}</span><span class="la-ins-sub">${sub}</span></div>
    <div class="card la-trnd-card"><div class="la-trnd-cols">
      <div><div class="la-trnd-h la-trnd-up">${upLbl}</div>${upRows||'<div class="la-ins-sub">nobody in this scope yet</div>'}</div>
      <div><div class="la-trnd-h la-trnd-dn">${dnLbl}</div>${dnRows||'<div class="la-ins-sub">nobody in this scope yet</div>'}</div>
    </div></div>`;
  const needSidecar=()=>{
    const st=_laSidecarKick();
    return `<div class="card la-ins-empty"><div class="empty-body">${st==='loading'?'Loading weekly usage…':'Weekly usage needs the in-season nflverse sidecar (hosted seed, first week complete).'}</div></div>`;
  };
  let body='';
  if(tab==='pace'){
    const idx=(typeof buildPaceIndex==='function')?buildPaceIndex():null;
    if(!idx){
      body=`<div class="card la-ins-empty"><div class="empty-title">No pace data yet</div>
        <div class="empty-body">Pace compares live stats to the projections frozen at kickoff — it lights up once week 1 completes.</div></div>`;
    } else {
      const seen=new Set(); let rows=[];
      idx.forEach((e,key)=>{
        if(key.indexOf('|')<0 || seen.has(key)) return; seen.add(key);
        // gp >= 3: one big game extrapolates to a comical 17-game pace.
        if(!(e.base>=LA_TRND_MIN_BASE) || !(e.gp>=3)) return;
        if(!keeps(e.name,e.pos)) return;
        e.delta = e.pace17 - e.base;
        rows.push(e);
      });
      rows.sort((a,b)=>b.delta-a.delta);
      const half=(list)=>list.map((e,i)=>_laTrendRow(e, `${e.gp} gm${e.gp===1?'':'s'} · pace ${e.pace17.toFixed(0)} vs proj ${e.base.toFixed(0)}`,
        _laVerdict(`${e.pct>=0?'+':'−'}${Math.round(Math.abs(e.pct)*100)}%`, 'vs projection', e.pct>=0?'la-trnd-up':'la-trnd-dn')+mineMark(e.name,e.pos), e.cls, i+1)).join('');
      body=two('PACE VS PROJECTION',`17-game pace vs the kickoff baseline · thru wk ${wk} · 3+ games`,
        '▲ AHEAD',half(rows.filter(e=>e.delta>0).slice(0,15)),
        '▼ BEHIND',half(rows.filter(e=>e.delta<0).reverse().slice(0,15)));
    }
  } else if(tab==='usage'){
    const idx=(typeof buildPaceIndex==='function')?buildPaceIndex():null;
    if(!idx){
      body=`<div class="card la-ins-empty"><div class="empty-body">Opportunity vs projection needs the kickoff baseline — it lights up once week 1 completes.</div></div>`;
    } else {
      const seen=new Set(); const tgtRows=[], carRows=[];
      idx.forEach((e,key)=>{
        if(key.indexOf('|')<0 || seen.has(key)) return; seen.add(key);
        if(!(e.gp>=3) || !e.stats) return;
        if(!keeps(e.name,e.pos)) return;
        const tg=e.stats.receiving_targets, ca=e.stats.rushing_attempts;
        if(tg && tg.bRate>=2.5 && e.pos!=='QB') tgtRows.push({e, st:tg});
        if(ca && ca.bRate>=4 && e.pos==='RB') carRows.push({e, st:ca});
      });
      tgtRows.sort((a,b)=>b.st.pct-a.st.pct); carRows.sort((a,b)=>b.st.pct-a.st.pct);
      const uRow=(x,i,cap)=>_laTrendRow(x.e, `${x.st.aRate.toFixed(1)}/gm vs proj ${x.st.bRate.toFixed(1)} · ${x.e.gp} gm${x.e.gp===1?'':'s'}`,
        _laVerdict(`${x.st.pct>=0?'+':'−'}${Math.round(Math.abs(x.st.pct)*100)}%`, cap, x.st.pct>=0?'la-trnd-up':'la-trnd-dn')+mineMark(x.e.name,x.e.pos),
        x.st.pct>=0.1?'pace-ahead':x.st.pct<=-0.1?'pace-behind':'', i+1);
      body=two('TARGETS VS PROJECTION',`who's seeing more (or less) than the projection called for · thru wk ${wk}`,
          '▲ MORE THAN PROJECTED',tgtRows.filter(x=>x.st.pct>0).slice(0,12).map((x,i)=>uRow(x,i,'tgt volume')).join(''),
          '▼ LESS THAN PROJECTED',tgtRows.filter(x=>x.st.pct<0).reverse().slice(0,12).map((x,i)=>uRow(x,i,'tgt volume')).join(''))
        + two('CARRIES VS PROJECTION','rushing workload against the projected share (RB)',
          '▲ MORE THAN PROJECTED',carRows.filter(x=>x.st.pct>0).slice(0,12).map((x,i)=>uRow(x,i,'carry volume')).join(''),
          '▼ LESS THAN PROJECTED',carRows.filter(x=>x.st.pct<0).reverse().slice(0,12).map((x,i)=>uRow(x,i,'carry volume')).join(''));
    }
  } else if(tab==='regression'){
    const U=_laUsagePlayers();
    if(!U) body=needSidecar();
    else {
      const pctl=(arr,v)=>{ if(!arr.length) return 0; let c=0; arr.forEach(x=>{ if(x<=v) c++; }); return 100*c/arr.length; };
      const reg={pos:[],neg:[]};
      ['WR','TE','RB'].forEach(pos=>{
        const grp=U.players.filter(p=>p.pos===pos && (p.tgt+p.carry)>=Math.max(10, wk*3));
        // Real red-zone chances (live Sleeper aggregates) weigh double: scoring-position
        // volume is the strongest TD-regression signal in the building.
        const vols=grp.map(p=>{ const rz=_laRzOpp(p.id); return p.tgt+p.carry+(rz!=null?2*rz:0); });
        const tdRates=grp.map(p=>(p.rec_td+p.rush_td)/Math.max(1,p.tgt+p.carry));
        grp.forEach((p,i)=>{
          if(!keeps(_laDisplayName(p,p.id),p.pos)) return;
          const vPct=pctl(vols, vols[i]), tPct=pctl(tdRates, tdRates[i]);
          if(vPct-tPct>30) reg.pos.push({p, gap:vPct-tPct});
          else if(tPct-vPct>30) reg.neg.push({p, gap:tPct-vPct});
        });
      });
      reg.pos.sort((a,b)=>b.gap-a.gap); reg.neg.sort((a,b)=>b.gap-a.gap);
      const regRow=(x,up,i)=>{ const rz=_laRzOpp(x.p.id);
        return _laTrendRow(x.p, `${x.p.tgt?`${x.p.tgt} tgt`:''}${x.p.tgt&&x.p.carry?' · ':''}${x.p.carry?`${x.p.carry} car`:''}${rz!=null?` · ${rz} RZ chances`:''}`,
          _laVerdict(`${x.p.rec_td+x.p.rush_td} TD`, up?'TDs coming':'TD-dependent', up?'la-trnd-up':'la-trnd-dn')+mineMark(_laDisplayName(x.p,x.p.id),x.p.pos), '', i+1); };
      body=two('TD REGRESSION','heavy volume + few TDs (or the reverse) — touchdown luck evens out',
        'POSITIVE (TDs coming)',reg.pos.slice(0,12).map((x,i)=>regRow(x,true,i)).join(''),
        'NEGATIVE (TD-dependent)',reg.neg.slice(0,12).map((x,i)=>regRow(x,false,i)).join(''));
    }
  } else if(tab==='teams'){
    const T=_laTeamTrends();
    if(!T) body=needSidecar();
    else if(wk<3) body=`<div class="card la-ins-empty"><div class="empty-body">Team tendencies need at least 3 completed weeks — check back at week 4.</div></div>`;
    else {
      const byLean=[...T].sort((a,b)=>b.dRate-a.dRate);
      const leanRow=(t,i)=>_laTeamRow(t.tm, `${t.rateA.toFixed(0)}% pass season → <b>${t.rate3.toFixed(0)}%</b> last 3`,
        _laVerdict(`${t.dRate>=0?'+':'−'}${Math.abs(t.dRate).toFixed(1)}%`, t.dRate>=0?'more passing':'more rushing', t.dRate>=0?'la-trnd-up':'la-trnd-dn'),
        t.dRate>=3?'pace-ahead':t.dRate<=-3?'pace-behind':'', i+1);
      const byHeat=[...T].sort((a,b)=>b.dEpa-a.dEpa);
      const heatRow=(t,i)=>_laTeamRow(t.tm, `${t.epa3>=0?'+':'−'}${Math.abs(t.epa3).toFixed(2)} EPA/play last 3 · ${t.epaA>=0?'+':'−'}${Math.abs(t.epaA).toFixed(2)} season`,
        _laVerdict(`${t.dEpa>=0?'+':'−'}${Math.abs(t.dEpa).toFixed(2)}`, 'EPA/play swing', t.dEpa>=0?'la-trnd-up':'la-trnd-dn'),
        t.dEpa>=0.05?'pace-ahead':t.dEpa<=-0.05?'pace-behind':'', i+1);
      body=two('PASS ↔ RUN LEAN · LAST 3 WEEKS','who is throwing more than their season identity — and who is leaning on the ground game',
          'PASSING MORE',byLean.filter(t=>t.dRate>0).slice(0,10).map(leanRow).join(''),
          'RUN-HEAVY LATELY',byLean.filter(t=>t.dRate<0).reverse().slice(0,10).map(leanRow).join(''))
        + two('OFFENSES · HOT & COLD','efficiency last 3 weeks vs the season baseline (EPA per play)',
          '🔥 HEATING UP',byHeat.filter(t=>t.dEpa>0).slice(0,10).map(heatRow).join(''),
          '🧊 GOING COLD',byHeat.filter(t=>t.dEpa<0).reverse().slice(0,10).map(heatRow).join(''));
    }
  } else if(tab==='ros'){
    const idx=(typeof buildPaceIndex==='function')?buildPaceIndex():null;
    const dvp=laDvpTable();
    if(!idx) body=`<div class="card la-ins-empty"><div class="empty-body">The rest-of-season outlook needs the kickoff baseline — it lights up once week 1 completes.</div></div>`;
    else {
      const form=laWeeklyFormMap();
      const seen=new Set(); const rows=[];
      idx.forEach((e,key)=>{
        if(key.indexOf('|')<0 || seen.has(key)) return; seen.add(key);
        if(!(e.base>=LA_TRND_MIN_BASE)) return;
        if(!keeps(e.name,e.pos)) return;
        const baseR=e.base/(e.projGames||17);
        const seasR=e.gp>0 ? e.act/e.gp : null;
        const fe=form ? (form.get(String(e.id)) || form.get(`${ecrNormName(e.name)}|${e.pos}`)) : null;
        const rec3=(fe && fe.n3>=2) ? fe.f3 : null;
        let ros = (e.gp>=2 && rec3!=null && seasR!=null) ? 0.35*baseR+0.30*seasR+0.35*rec3
                : (seasR!=null) ? 0.55*baseR+0.45*seasR : baseR;
        const sched=_laRosSched(e.team, e.pos, dvp);
        if(sched) ros*=sched.mult;
        // Injury-aware: an active OUT/IR/PUP/SUS designation discounts the outlook by the
        // estimated missed share of the remaining schedule (a floor, user-visible, never a
        // silent projection rewrite).
        const inj=(typeof tcInjuryInfo==='function')?tcInjuryInfo(e.id):null;
        let injNote='';
        if(inj && inj.sev==='o' && typeof tcInjuryAbsenceWeeks==='function'){
          const remain=(sched&&sched.games)||Math.max(1, 19-laCurrentWeek());
          const miss=Math.min(remain, tcInjuryAbsenceWeeks(inj));
          ros*=(remain-miss)/remain;
          injNote=` · ${inj.code} ${miss>=remain?'likely out for the season':`est. ${miss}${miss>=4?'+':''} wk${miss===1?'':'s'} out`}`;
        }
        const pct=baseR>0?(ros-baseR)/baseR:0;
        rows.push({e, ros, baseR, pct, sched, inj, injNote});
      });
      rows.sort((a,b)=>b.pct-a.pct);
      const rosRow=(x,i)=>_laTrendRow(x.e,
        `${x.ros.toFixed(1)} proj/gm rest of season · ${x.baseR.toFixed(1)} preseason${x.sched?` · sched ${x.sched.mult>=1?'+':'−'}${Math.abs((x.sched.mult-1)*100).toFixed(0)}%`:''}${x.injNote||''}`,
        _laVerdict(`${x.pct>=0?'+':'−'}${Math.round(Math.abs(x.pct)*100)}%`, 'ROS vs projection', x.pct>=0?'la-trnd-up':'la-trnd-dn')+mineMark(x.e.name,x.e.pos),
        x.pct>=0.08?'pace-ahead':x.pct<=-0.08?'pace-behind':'', i+1);
      body=two('REST OF SEASON OUTLOOK','projection rate blended with season + recent form, adjusted for the remaining schedule and injuries',
        '▲ UPGRADED',rows.filter(x=>x.pct>0).slice(0,15).map(rosRow).join(''),
        '▼ DOWNGRADED',rows.filter(x=>x.pct<0).reverse().slice(0,15).map(rosRow).join(''));
    }
  } else { // trending — the Sleeper-style headline board
    const U=_laUsagePlayers();
    if(!U) body=needSidecar();
    else if(wk<4) body=`<div class="card la-ins-empty"><div class="empty-body">Week-over-week trending needs at least 4 completed weeks — check back at week ${Math.max(5, wk+1)}.</div></div>`;
    else {
      const trend=[];
      U.players.forEach(p=>{
        if(!keeps(_laDisplayName(p,p.id),p.pos)) return;
        const wks=p.weeks; if(wks.length<4) return;
        const recent=wks.slice(-3), prior=wks.slice(0,-3).slice(-3);
        if(prior.length<2) return;
        const rowOf=(w)=>U.pw.players[p.g].w[String(w)]||[];
        const avg=(set,fn)=>set.reduce((a,w)=>a+fn(rowOf(w)),0)/set.length;
        const tgtShare=(r)=>{ const tt=r[U.ci['team_tgt']]||0; return tt?100*(r[U.ci['tgt']]||0)/tt:0; };
        const touches=(r)=>(r[U.ci['tgt']]||0)+(r[U.ci['carry']]||0);
        const dShare=avg(recent,tgtShare)-avg(prior,tgtShare);
        const dTouch=avg(recent,touches)-avg(prior,touches);
        const score=(p.pos==='RB'?dTouch:dShare);
        if(Math.abs(score)>=3) trend.push({p, dShare, dTouch, score});
      });
      trend.sort((a,b)=>b.score-a.score);
      const tRow=(x,i)=>_laTrendRow(x.p, x.p.pos==='RB'?`${((x.p.carry3+x.p.tgt3)/Math.max(1,x.p.gp3)).toFixed(1)} touches/gm last 3`:`${x.p.share3.toFixed(1)}% tgt share last 3`,
        _laVerdict(`${x.score>=0?'+':'−'}${Math.abs(x.p.pos==='RB'?x.dTouch:x.dShare).toFixed(1)}${x.p.pos==='RB'?'':'%'}`, x.p.pos==='RB'?'touches vs prior 3':'share vs prior 3', x.score>=0?'la-trnd-up':'la-trnd-dn')+mineMark(_laDisplayName(x.p,x.p.id),x.p.pos),
        x.score>=0?'pace-ahead':'pace-behind', i+1);
      body=two('TRENDING · LAST 3 WEEKS VS THE 3 BEFORE','role changes show up here first',
        '▲ TRENDING UP',trend.filter(x=>x.score>0).slice(0,12).map(tRow).join(''),
        '▼ TRENDING DOWN',trend.filter(x=>x.score<0).reverse().slice(0,12).map(tRow).join(''));
    }
  }
  return `${bar}${body}<div class="la-note">★ = on your roster · tap a name for the player card</div>`;
}

// ── Trends data helpers ──────────────────────────────────────────────────────
// Team weekly pack (current season): {weeks, cols, teams:{CODE:[[…per week…]]}} — additive
// counts, so any week window is an exact recompute.
function _laTeamPack(){
  const yr=String(TC_SEASON.year);
  const pack=(typeof NFLVERSE!=='undefined'&&NFLVERSE&&NFLVERSE[yr]&&NFLVERSE[yr].adv_weekly)||null;
  return (pack && pack.teams && Array.isArray(pack.weeks) && Array.isArray(pack.cols)) ? pack : null;
}
function _laTeamTrends(){
  const pack=_laTeamPack(); if(!pack) return null;
  const ci={}; pack.cols.forEach((c,i)=>ci[c]=i);
  if(ci.off_pass_plays==null || ci.off_epa==null) return null;
  const n=pack.weeks.length;
  const idxAll=[...Array(n).keys()], idx3=idxAll.slice(-3);
  const get=(rows,set,c)=>set.reduce((a,i)=>a+((rows[i]||[])[ci[c]]||0),0);
  const out=[];
  for(const tm in pack.teams){
    const rows=pack.teams[tm];
    if(!Array.isArray(rows)) continue;
    const passA=get(rows,idxAll,'off_pass_plays'), runA=get(rows,idxAll,'off_run_plays');
    const pass3=get(rows,idx3,'off_pass_plays'), run3=get(rows,idx3,'off_run_plays');
    if(!(passA+runA)) continue;
    const rateA=100*passA/(passA+runA);
    const rate3=(pass3+run3)?100*pass3/(pass3+run3):rateA;
    const epaSumA=get(rows,idxAll,'off_epa'), playsA=get(rows,idxAll,'off_plays');
    const epaSum3=get(rows,idx3,'off_epa'), plays3=get(rows,idx3,'off_plays');
    const epaA=playsA?epaSumA/playsA:0, epa3=plays3?epaSum3/plays3:epaA;
    out.push({tm, rateA, rate3, dRate:rate3-rateA, epaA, epa3, dEpa:epa3-epaA});
  }
  return out.length?out:null;
}
// Real red-zone chances to date, from the live Sleeper season aggregates in HISTORY.
function _laRzOpp(pid){
  const yr=String(TC_SEASON.year);
  const rec=(pid && typeof HISTORY!=='undefined' && HISTORY[pid]) ? HISTORY[pid][yr] : null;
  if(!rec) return null;
  const list=Array.isArray(rec)?rec:[rec]; let opp=0, found=false;
  list.forEach(r=>{ const st=r.stats||{};
    if(st.rec_rz_tgt!=null||st.rush_rz_att!=null){ found=true; opp+=(st.rec_rz_tgt||0)+(st.rush_rz_att||0); } });
  return found?opp:null;
}
// Average remaining-schedule multiplier for a team+position (same 0.90–1.10 scale the
// Lineup Helper uses per week). null when the schedule or DvP table isn't loaded.
function _laRosSched(team, pos, dvp){
  const ins=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON)||null;
  if(!ins || !ins.schedule || !dvp || !team) return null;
  const sch=ins.schedule[String(team).toUpperCase()]; if(!sch) return null;
  const cur=laCurrentWeek(); let sum=0, ct=0;
  const nTeams=dvp.codes.length||32;
  for(let w=cur; w<=18; w++){
    const opp=sch[String(w)]; if(!opp) continue;               // bye
    const r=dvp.ranks[opp] && dvp.ranks[opp][pos]; if(!r) continue;
    sum += 1.10 - 0.20*((r-1)/Math.max(1,nTeams-1)); ct++;     // rank 1 = most generous
  }
  return ct ? {mult:sum/ct, games:ct} : null;
}
