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
function laSetMuWeek(w){ laState.muWeek = (w===laCurrentWeek()) ? null : w; renderLeagueAnalyzer(); }

// ── Dispatch (99's render calls this; also the swipe-preview entry point) ────
function laTabViewHTML(key, s){
  laLivePollSync();
  // Off-season (or a stale restored session): the in-season tabs don't exist — fall back.
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return null;
  switch(key){
    case 'matchup': return laMatchupView(s);
    case 'lineup':  return laLineupView(s);
    case 'dvp':     return laDvpView(s);
    case 'trends':  return laTrendsView(s);
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
  try{
    const rows = await sleeperFetch(LA_MATCHUPS_URL(s.leagueId, week));
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
    && laState.laTab==='matchup' && laMuWeek()===laCurrentWeek()
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
function _laEspnInseasonNote(){
  return `<div class="card la-ins-empty">
    <div class="empty-title">Live scoring for ESPN leagues is coming</div>
    <div class="empty-body">Sleeper leagues get the live scoreboard today; the Lineup, DvP and Trends tabs work for every league.</div></div>`;
}
function laMatchupView(s){
  if(s.provider==='espn') return _laEspnInseasonNote();
  const wk=laMuWeek(), cur=laCurrentWeek();
  const weekChips = Array.from({length:cur},(_,i)=>i+1).map(w=>
    `<button class="format-btn ${w===wk?'active':''}" onclick="laSetMuWeek(${w})">Wk ${w}</button>`).join('');
  const head = `<div class="la-ins-bar"><span class="la-ins-lbl">WEEK</span><div class="format-toggle la-wk-chips">${weekChips}</div></div>`;
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
  const wkProj=(pid)=>{ const p=_laPidMeta(meta,pid);
    const f=pm.get(ecrNormName(p.name)+'|'+p.pos); return f?f/17:0; };
  const pairs={};
  data.rows.forEach(r=>{ (pairs[r.matchup_id||('solo'+r.roster_id)]=pairs[r.matchup_id||('solo'+r.roster_id)]||[]).push(r); });
  const my=_laMyTeamRow(s);
  const myRow = my && data.rows.find(r=>r.roster_id===my.rosterId);
  const myPair = myRow && pairs[myRow.matchup_id];

  const starterRows=(row)=>{
    const starters=row.starters||[], pts=row.starters_points||[];
    return starters.map((pid,i)=>{
      if(!pid || pid==='0') return '';
      const p=_laPidMeta(meta,pid);
      const proj=wkProj(pid);
      return `<div class="la-mu-prow">
        <span class="clickable-player" onclick="${pcardOnclick(p.id||p.name,p.pos,p.team||'')}">${laPlayerImg(p)}</span>
        <span class="pos-badge pos-${p.pos}">${p.pos||''}</span>
        <span class="la-mu-pname">${escHtml(p.name)}</span>
        <span class="la-mu-ppts"><b>${(pts[i]!=null?pts[i]:0).toFixed(1)}</b>${proj?`<span class="la-mu-pproj">/ ${proj.toFixed(1)}</span>`:''}</span>
      </div>`;
    }).join('');
  };
  const teamTotal=(row)=>{ const t=teamBy[row.roster_id]||{};
    const proj=(row.starters||[]).reduce((a,pid)=>a+wkProj(pid),0);
    return {name:t.teamName||`Roster ${row.roster_id}`, rec:`${t.wins!=null?t.wins:'–'}-${t.losses!=null?t.losses:'–'}`,
      pts:Number(row.points||0), proj}; };

  let featured='';
  if(myPair && myPair.length===2){
    const [a,b] = myPair[0].roster_id===my.rosterId ? [myPair[0],myPair[1]] : [myPair[1],myPair[0]];
    const ta=teamTotal(a), tb=teamTotal(b);
    featured = `<div class="card la-mu-featured">
      <div class="la-mu-fhead"><span class="la-ins-lbl">MY MATCHUP · WEEK ${wk}</span>
        ${wk===cur?`<span class="draft-live">LIVE</span>`:''}</div>
      <div class="la-mu-fscore">
        <div class="la-mu-fteam"><b>${escHtml(ta.name)}</b><span class="la-mu-frec">${ta.rec}</span></div>
        <div class="la-mu-fnums"><span class="la-mu-fpts">${ta.pts.toFixed(1)}</span>
          <span class="la-mu-fvs">vs</span><span class="la-mu-fpts">${tb.pts.toFixed(1)}</span></div>
        <div class="la-mu-fteam la-mu-away"><b>${escHtml(tb.name)}</b><span class="la-mu-frec">${tb.rec}</span></div>
      </div>
      <div class="la-mu-fproj">projected ${ta.proj.toFixed(1)} · ${tb.proj.toFixed(1)}</div>
      <div class="la-mu-cols">
        <div class="la-mu-col">${starterRows(a)}</div>
        <div class="la-mu-col">${starterRows(b)}</div>
      </div></div>`;
  }
  const board = Object.keys(pairs).map(k=>{
    const pr=pairs[k]; if(pr.length<2) return '';
    const [a,b]=pr; const ta=teamTotal(a), tb=teamTotal(b);
    const mine = my && (a.roster_id===my.rosterId||b.roster_id===my.rosterId);
    const lead = ta.pts===tb.pts ? 0 : (ta.pts>tb.pts?1:-1);
    return `<div class="la-mu-game ${mine?'la-mu-mine':''}">
      <div class="la-mu-grow ${lead>0?'la-mu-lead':''}"><span>${escHtml(ta.name)}</span><b>${ta.pts.toFixed(1)}</b></div>
      <div class="la-mu-grow ${lead<0?'la-mu-lead':''}"><span>${escHtml(tb.name)}</span><b>${tb.pts.toFixed(1)}</b></div>
    </div>`;
  }).join('');
  const asof = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : '';
  return `${head}${featured}
    <div class="la-ins-bar"><span class="la-ins-lbl">SCOREBOARD</span>${asof?`<span class="la-ins-sub">updated ${asof}${wk===cur?' · refreshes every 45s while you watch':''}</span>`:''}</div>
    <div class="la-mu-board">${board}</div>`;
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
    POS.forEach(pos=>{
      const wkMap=(dv.teams[code]||{})[pos]||{};
      const weeks=Object.keys(wkMap);
      const sum=(c)=>weeks.reduce((a,w)=>a+((wkMap[w]||[])[ci[c]]||0),0);
      const row={pos, receiving_targets:sum('tgt'), receptions:sum('rec'),
        receiving_yards:sum('rec_yd'), receiving_tds:sum('rec_td'),
        rushing_attempts:sum('carry'), rushing_yards:sum('rush_yd'), rushing_tds:sum('rush_td'),
        passing_attempts:sum('pass_att'), passing_yards:sum('pass_yd'),
        passing_tds:sum('pass_td'), interceptions_thrown:sum('pass_int')};
      const g=weeks.length||1;
      teams[code][pos]={fppg: calcFpts(row)/g, games:weeks.length};
    });
  }
  const codes=Object.keys(teams);
  const ranks={};
  POS.forEach(pos=>{
    const order=[...codes].sort((a,b)=>teams[a][pos].fppg-teams[b][pos].fppg);  // fewest allowed = rank 1
    order.forEach((c,i)=>{ (ranks[c]=ranks[c]||{})[pos]=i+1; });
  });
  _laDvpMemo={teams, ranks, codes:codes.sort()};
  _laDvpSig=sig;
  return _laDvpMemo;
}
function laSetDvpSort(col){
  const s=laState.dvpSort||{col:'QB',dir:1};
  laState.dvpSort = (s.col===col) ? {col, dir:-s.dir} : {col, dir:1};
  renderLeagueAnalyzer();
}
function laSetDvpPos(p){ laState.dvpPos=p; renderLeagueAnalyzer(); }
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
    return (t.teams[a][col].fppg-t.teams[b][col].fppg)*(pos1?1:sort.dir);
  });
  const n=t.codes.length;
  const wk=(typeof completedWeeks==='function')?completedWeeks():0;
  const small = wk>0 && wk<=4
    ? `<div class="discrepancy-note">${TC_ICON("warning")} ${wk} game${wk===1?'':'s'} is a small sample — these ranks move a lot early in the season.</div>` : '';
  const chips = ['ALL',...POS].map(p=>`<button class="pos-filter-btn ${((laState.dvpPos||'ALL')===p)?'active':''}" onclick="laSetDvpPos('${p}')">${p}</button>`).join('');
  const posCols = pos1?[pos1]:POS;
  const header = `<tr><th>DEFENSE</th>${posCols.map(p=>`<th onclick="laSetDvpSort('${p}')" class="la-dvp-th ${(!pos1&&sort.col===p)?'active':''}">vs ${p}${!pos1&&sort.col===p?(sort.dir<0?' ↓':' ↑'):''}</th>`).join('')}</tr>`;
  const rows = codes.map(c=>{
    const cells=posCols.map(p=>{
      const cell=t.teams[c][p];
      return `<td class="${laQuartile(t.ranks[c][p], n)}"><b>${cell.fppg.toFixed(1)}</b><span class="la-rk">#${t.ranks[c][p]}</span></td>`;
    }).join('');
    return `<tr><td class="la-dvp-team"><img src="${NFL_LOGO(c)}" class="rank-logo" loading="lazy" onerror="this.style.display='none'"> ${c}</td>${cells}</tr>`;
  }).join('');
  return `${small}
    <div class="la-ins-bar"><span class="la-ins-lbl">FANTASY POINTS ALLOWED / GAME</span>
      <div class="pos-filter">${chips}</div>
      <span class="la-ins-sub">your league's scoring · thru wk ${wk} · rank #1 = stingiest</span></div>
    <div class="card" style="padding:0;overflow:hidden"><div class="la-dvp-wrap">
      <table class="la-dvp-table"><thead>${header}</thead><tbody>${rows}</tbody></table></div></div>`;
}

// ── Lineup Helper ────────────────────────────────────────────────────────────
// Adjusted week projection = season proj/17 × defense multiplier × pace multiplier, each
// clamped and each degrading to 1 when its data source is missing (footnoted).
function laAdjWeekProj(p, wk, pm, dvp){
  const base=(pm.get(ecrNormName(p.name)+'|'+p.pos)||0)/17;
  if(!base) return {adj:0, base:0, defMult:1, paceMult:1, opp:null};
  let defMult=1, opp=null;
  const sched=(typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.schedule)||null;
  if(dvp && sched && p.team && sched[p.team]) opp=sched[p.team][String(wk)]||null;
  if(dvp && opp && dvp.ranks[opp] && dvp.ranks[opp][p.pos]){
    // rank 1 (stingiest) → 0.90, rank 32 (most generous) → 1.10, linear between.
    const r=dvp.ranks[opp][p.pos], n=dvp.codes.length||32;
    defMult=0.90 + 0.20*((r-1)/Math.max(1,n-1));
  }
  let paceMult=1;
  const pace=(typeof paceForPlayer==='function')?paceForPlayer(p.name,p.pos,p.id):null;
  if(pace && pace.gp>=1 && pace.base>0){
    // 50% blend toward the player's actual pace ratio, clamped to ±20%.
    const ratio=Math.max(0.8, Math.min(1.2, pace.pace17/pace.base));
    paceMult=1+(ratio-1)*0.5;
  }
  return {adj: base*defMult*paceMult, base, defMult, paceMult, opp,
    thin: !!(pace && pace.gp>0 && pace.gp<3)};
}
function laToggleLhShowAll(){ laState.lhShowAll=!laState.lhShowAll; renderLeagueAnalyzer(); }
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
  const rows=optimal.map(f=>{
    const p=f.player;
    if(!p) return `<tr class="la-lh-empty-slot"><td>${f.slot}</td><td colspan="3">— no eligible player —</td></tr>`;
    const a=p._a;
    const inCur=currentSet.has(p.id);
    const swap=haveCurrent && !inCur;
    const flags=[];
    if(swap) flags.push('<span class="la-lh-flag la-lh-start">START</span>');
    if(a.thin) flags.push('<span class="la-lh-flag la-lh-thin" title="Fewer than 3 games of live data behind the pace adjustment">THIN</span>');
    return `<tr class="${swap?'la-lh-swap':''}">
      <td class="la-lh-slot">${f.slot}</td>
      <td class="la-lh-p"><span class="clickable-player" onclick="${pcardOnclick(p.id||p.name,p.pos,p.team||'')}">${laPlayerImg(p)}</span>
        <span class="pos-badge pos-${p.pos}">${p.pos}</span> ${escHtml(p.name)}${a.opp?`<span class="la-lh-opp">@ ${a.opp}${dvp&&dvp.ranks[a.opp]&&dvp.ranks[a.opp][p.pos]?` (#${dvp.ranks[a.opp][p.pos]} vs ${p.pos})`:''}</span>`:''}</td>
      <td class="la-lh-proj"><b>${a.adj.toFixed(1)}</b>${(a.defMult!==1||a.paceMult!==1)?`<span class="la-lh-base">base ${a.base.toFixed(1)}</span>`:''}</td>
      <td class="la-lh-flags">${flags.join('')}</td></tr>`;
  }).join('');
  // Bench sits: currently-started players who did NOT make the optimal lineup.
  const sits=haveCurrent ? scored.filter(p=>currentSet.has(p.id)&&!optimalSet.has(p.id)) : [];
  const sitRows=sits.map(p=>`<tr class="la-lh-sitrow">
      <td class="la-lh-slot">—</td>
      <td class="la-lh-p"><span class="pos-badge pos-${p.pos}">${p.pos}</span> ${escHtml(p.name)}</td>
      <td class="la-lh-proj"><b>${p._a.adj.toFixed(1)}</b></td>
      <td class="la-lh-flags"><span class="la-lh-flag la-lh-sit">SIT?</span></td></tr>`).join('');
  const bench=laState.lhShowAll ? scored.filter(p=>!optimalSet.has(p.id)&&!sits.includes(p)).map(p=>`<tr class="la-lh-benchrow">
      <td class="la-lh-slot">BN</td>
      <td class="la-lh-p"><span class="pos-badge pos-${p.pos}">${p.pos}</span> ${escHtml(p.name)}</td>
      <td class="la-lh-proj">${p._a.adj.toFixed(1)}</td><td></td></tr>`).join('') : '';
  const notes=[];
  notes.push(dvp?'matchup: opponent defense-vs-position (±10%)':'matchup adjustment off — defensive splits not loaded yet');
  notes.push((typeof loadPaceBaseline==='function'&&loadPaceBaseline())?'pace: 50% blend toward each player’s live pace (±10%)':'pace adjustment off — no kickoff baseline');
  if(!haveCurrent) notes.push(s.provider==='espn'?'ESPN league: optimal lineup only (no live starters feed)':'your set starters load with the week’s matchups');
  return `
    <div class="la-ins-bar"><span class="la-ins-lbl">OPTIMAL LINEUP · WEEK ${wk}</span>
      <span class="la-ins-sub">${haveCurrent?'rows highlighted = start over your current lineup':'suggested from your projections + matchup context'}</span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="laToggleLhShowAll()">${laState.lhShowAll?'Hide bench':'Show full bench'}</button></div>
    <div class="card" style="padding:0;overflow:hidden"><div class="la-dvp-wrap">
      <table class="la-lh-table"><thead><tr><th>SLOT</th><th>PLAYER</th><th>ADJ&nbsp;PROJ</th><th></th></tr></thead>
      <tbody>${rows}${sitRows}${bench}</tbody></table></div></div>
    <div class="la-note">${notes.join(' · ')}</div>`;
}

// ── Trends: pace vs baseline, regression candidates, weekly trending ─────────
var _laSidecarState='cold';
function _laSidecarKick(){
  if(_laSidecarState==='ready'||_laSidecarState==='loading') return _laSidecarState;
  if(typeof ensureInseasonSidecar!=='function'){ _laSidecarState='error'; return _laSidecarState; }
  _laSidecarState='loading';
  ensureInseasonSidecar().then(ok=>{ _laSidecarState=ok?'ready':'error'; if(ok) _laInsRerender(); });
  return _laSidecarState;
}
function laSetTrndScope(sc){ laState.trndScope=sc; renderLeagueAnalyzer(); }
// Names rostered in this league, for the 'rostered' scope filter.
function _laLeagueNameSet(s){
  const set=new Set();
  (s.teamList||[]).forEach(t=>(t.players||[]).forEach(p=>set.add(ecrNormName(p.name)+'|'+p.pos)));
  return set;
}
function laTrendsView(s){
  const wk=(typeof completedWeeks==='function')?completedWeeks():0;
  const idx=(typeof buildPaceIndex==='function')?buildPaceIndex():null;
  const scope=laState.trndScope||'rostered';
  // Card 1 — pace vs the kickoff baseline.
  let paceCard;
  if(!idx){
    paceCard=`<div class="card la-ins-empty"><div class="empty-title">No pace data yet</div>
      <div class="empty-body">Pace compares live stats to your projections frozen at kickoff — it lights up once week 1 completes${(typeof loadPaceBaseline==='function'&&loadPaceBaseline())?'':' (open the projections view once so the baseline can freeze)'}.</div></div>`;
  } else {
    const my=_laMyTeamRow(s);
    const mySet=new Set(((my&&my.players)||[]).map(p=>ecrNormName(p.name)+'|'+p.pos));
    const lgSet=_laLeagueNameSet(s);
    const seen=new Set();
    let rows=[];
    idx.forEach((e,key)=>{
      if(key.indexOf('|')<0) return;              // use only the name|pos keys (deduped view)
      if(seen.has(key)) return; seen.add(key);
      if(!(e.base>0)||!(e.gp>0)) return;
      if(scope==='myteam' && !mySet.has(key)) return;
      if(scope==='rostered' && !lgSet.has(key)) return;
      rows.push(e);
    });
    rows.sort((a,b)=>b.pct-a.pct);
    if(scope==='league') rows=rows.slice(0,60);
    const half=(list)=>list.map(e=>`<div class="la-trnd-row ${e.cls}">
        <span class="pos-badge pos-${e.pos}">${e.pos}</span><span class="la-trnd-name">${escHtml(e.name)}</span>
        <span class="la-trnd-nums">${e.pace17.toFixed(0)} <span class="la-trnd-vs">vs ${e.base.toFixed(0)}</span></span>
        <b class="la-trnd-pct">${e.pct>=0?'+':'−'}${Math.round(Math.abs(e.pct)*100)}%</b></div>`).join('');
    const chips=['rostered','myteam','league'].map(sc=>`<button class="format-btn ${scope===sc?'active':''}" onclick="laSetTrndScope('${sc}')">${sc==='rostered'?'Rostered':sc==='myteam'?'My Team':'League'}</button>`).join('');
    paceCard=`<div class="la-ins-bar"><span class="la-ins-lbl">PACE VS YOUR PROJECTIONS</span>
        <div class="format-toggle">${chips}</div><span class="la-ins-sub">17-game pace vs kickoff baseline · thru wk ${wk}</span></div>
      <div class="card la-trnd-card"><div class="la-trnd-cols">
        <div><div class="la-trnd-h la-trnd-up">▲ AHEAD</div>${half(rows.filter(e=>e.pct>0).slice(0,15))||'<div class="la-ins-sub">nobody yet</div>'}</div>
        <div><div class="la-trnd-h la-trnd-dn">▼ BEHIND</div>${half(rows.filter(e=>e.pct<0).reverse().slice(0,15))||'<div class="la-ins-sub">nobody yet</div>'}</div>
      </div></div>`;
  }
  // Cards 2+3 need the sidecar's per-player weekly lines.
  const pw=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON&&TC_INSEASON.player_weekly)||null;
  let regCard='', trndCard='';
  if(!pw){
    const st=_laSidecarKick();
    regCard=`<div class="card la-ins-empty"><div class="empty-body">${st==='loading'?'Loading weekly usage data…':'Regression + weekly trends build from the weekly nflverse sidecar (appears after week 1 on a hosted seed).'}</div></div>`;
  } else {
    const ci={}; (pw.cols||[]).forEach((c,i)=>ci[c]=i);
    const players=Object.keys(pw.players).map(g=>{
      const p=pw.players[g]; const weeks=Object.keys(p.w).map(Number).sort((a,b)=>a-b);
      const sum=(c)=>weeks.reduce((a,w)=>a+((p.w[String(w)]||[])[ci[c]]||0),0);
      return {g, name:p.n, pos:p.p, team:p.t, weeks,
        tgt:sum('tgt'), rec_td:sum('rec_td'), carry:sum('carry'), rush_td:sum('rush_td'),
        air:sum('air_yd')};
    });
    // Percentile helper within a position group.
    const pctl=(arr,v)=>{ if(!arr.length) return 0; let c=0; arr.forEach(x=>{ if(x<=v) c++; }); return 100*c/arr.length; };
    const reg={pos:[],neg:[]};
    ['WR','TE','RB'].forEach(pos=>{
      const grp=players.filter(p=>p.pos===pos && (p.tgt+p.carry)>=Math.max(10, wk*3));
      const vols=grp.map(p=>p.tgt+p.carry);
      const tdRates=grp.map(p=>(p.rec_td+p.rush_td)/Math.max(1,p.tgt+p.carry));
      grp.forEach((p,i)=>{
        const vPct=pctl(vols, vols[i]), tPct=pctl(tdRates, tdRates[i]);
        if(vPct-tPct>30) reg.pos.push({p, gap:vPct-tPct});
        else if(tPct-vPct>30) reg.neg.push({p, gap:tPct-vPct});
      });
    });
    reg.pos.sort((a,b)=>b.gap-a.gap); reg.neg.sort((a,b)=>b.gap-a.gap);
    const regRow=(x,up)=>`<div class="la-trnd-row">
      <span class="pos-badge pos-${x.p.pos}">${x.p.pos}</span><span class="la-trnd-name">${escHtml(x.p.name)}</span>
      <span class="la-ins-sub">${x.p.tgt?`${x.p.tgt} tgt`:''}${x.p.tgt&&x.p.carry?' · ':''}${x.p.carry?`${x.p.carry} car`:''} · ${x.p.rec_td+x.p.rush_td} TD</span>
      <b class="la-trnd-pct ${up?'la-trnd-up':'la-trnd-dn'}">${up?'＋TD due':'−TD due'}</b></div>`;
    regCard=`<div class="la-ins-bar"><span class="la-ins-lbl">TD REGRESSION CANDIDATES</span>
        <span class="la-ins-sub">high volume + few TDs (or the reverse) — touchdown luck evens out</span></div>
      <div class="card la-trnd-card"><div class="la-trnd-cols">
        <div><div class="la-trnd-h la-trnd-up">POSITIVE (TDs coming)</div>${reg.pos.slice(0,12).map(x=>regRow(x,true)).join('')||'<div class="la-ins-sub">none stand out yet</div>'}</div>
        <div><div class="la-trnd-h la-trnd-dn">NEGATIVE (TD-dependent)</div>${reg.neg.slice(0,12).map(x=>regRow(x,false)).join('')||'<div class="la-ins-sub">none stand out yet</div>'}</div>
      </div></div>`;
    // Weekly trending: last-3 vs prior-3 target share / carries.
    if(wk>=4){
      const trend=[];
      players.forEach(p=>{
        const wks=p.weeks; if(wks.length<4) return;
        const recent=wks.slice(-3), prior=wks.slice(0,-3).slice(-3);
        if(prior.length<2) return;
        const rowOf=(w)=>pw.players[p.g].w[String(w)]||[];
        const avg=(set,fn)=>set.reduce((a,w)=>a+fn(rowOf(w)),0)/set.length;
        const tgtShare=(r)=>{ const tt=r[ci['team_tgt']]||0; return tt?100*(r[ci['tgt']]||0)/tt:0; };
        const touches=(r)=>(r[ci['tgt']]||0)+(r[ci['carry']]||0);
        const dShare=avg(recent,tgtShare)-avg(prior,tgtShare);
        const dTouch=avg(recent,touches)-avg(prior,touches);
        const score=(p.pos==='RB'?dTouch:dShare);
        if(Math.abs(score)>= (p.pos==='RB'?3:3)) trend.push({p, dShare, dTouch, score});
      });
      trend.sort((a,b)=>b.score-a.score);
      const tRow=(x)=>`<div class="la-trnd-row">
        <span class="pos-badge pos-${x.p.pos}">${x.p.pos}</span><span class="la-trnd-name">${escHtml(x.p.name)}</span>
        <span class="la-ins-sub">${x.p.pos==='RB'?`${x.dTouch>=0?'+':''}${x.dTouch.toFixed(1)} touches/gm`:`${x.dShare>=0?'+':''}${x.dShare.toFixed(1)}% tgt share`}</span>
        <b class="la-trnd-pct ${x.score>=0?'la-trnd-up':'la-trnd-dn'}">${x.score>=0?'▲':'▼'}</b></div>`;
      trndCard=`<div class="la-ins-bar"><span class="la-ins-lbl">TRENDING · LAST 3 WEEKS VS PRIOR</span></div>
        <div class="card la-trnd-card"><div class="la-trnd-cols">
          <div><div class="la-trnd-h la-trnd-up">▲ TRENDING UP</div>${trend.filter(x=>x.score>0).slice(0,12).map(tRow).join('')||'<div class="la-ins-sub">quiet week</div>'}</div>
          <div><div class="la-trnd-h la-trnd-dn">▼ TRENDING DOWN</div>${trend.filter(x=>x.score<0).reverse().slice(0,12).map(tRow).join('')||'<div class="la-ins-sub">quiet week</div>'}</div>
        </div></div>`;
    } else {
      trndCard=`<div class="card la-ins-empty"><div class="empty-body">Week-over-week trending needs at least 4 completed weeks — check back at week ${Math.max(5, wk+1)}.</div></div>`;
    }
  }
  return `${paceCard}${regCard}${trndCard}`;
}
