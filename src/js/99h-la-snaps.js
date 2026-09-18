// ═════════════════════════════════════════════════════════════════════════════
// League Analyzer — Trends · Snaps (the snap tracker)
// ═════════════════════════════════════════════════════════════════════════════
// Snap share week over week for every QB/RB/WR/TE, from the Sleeper weekly stat rows the
// Leaders sidebar already caches per completed week (off_snp / tm_off_snp). Two fill-ins:
//   * the in-season sidecar's nflverse snap counts (snaps / snap_pct columns, PFR's numbers)
//     cover any player-week Sleeper left blank — they land with the weekly sidecar rebuild;
//   * last season's snap share from the seed's history is the baseline when the season is
//     one week old and there is nothing earlier to compare against.
// A trend is the latest completed week's share against the average of up to three earlier
// weeks with data. Missing data is unknown, never zero: a player without a snap pair in a
// week simply has no point that week, so a data gap can never read as a benching.
const LA_SNAP_TIERS = [[0.75, 'every-down'], [0.55, 'lead'], [0.35, 'committee'], [0, 'rotational']];
const LA_SNAP_MIN_DELTA = 0.08;   // share points that count as a move
const LA_SNAP_MIN_SHARE = 0.25;   // the larger of latest / baseline must reach this to be listed
function laSnapTier(sh){ for(const [lo,l] of LA_SNAP_TIERS) if(sh>=lo) return l; return 'rotational'; }

var _laSnapMem = { sig:null, index:null, loading:false, failed:false };
function _laSnapSig(){
  const cw=(typeof completedWeeks==='function')?completedWeeks():0;
  const asof=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON&&TC_INSEASON.asof)||'';
  return `${TC_SEASON.year}|${cw}|${asof}`;
}
// Sidecar fill-in: pid → {wks:{wk:{share,snaps,src}}, name, pos, team}. Sidecars built before
// the snap columns existed have no snap_pct column and contribute nothing.
function _laSnapSidecar(){
  const pw=(typeof TC_INSEASON!=='undefined'&&TC_INSEASON&&TC_INSEASON.player_weekly)||null;
  if(!pw || !pw.cols || pw.cols.indexOf('snap_pct')<0) return null;
  const ci={}; pw.cols.forEach((c,i)=>{ ci[c]=i; });
  const m=new Map();
  for(const g in pw.players){
    const pl=pw.players[g]; const pid=laPidFromGsis(g); if(!pid) continue;
    const wks={};
    for(const wk in pl.w){ const r=pl.w[wk]||[]; const pct=r[ci.snap_pct];
      if(pct!=null) wks[wk]={share:pct/100, snaps:r[ci.snaps]||0, src:'nflverse'}; }
    if(Object.keys(wks).length) m.set(String(pid), {wks, name:pl.n, pos:pl.p, team:pl.t});
  }
  return m;
}
// Last season's share for a player from the seed's history. The builder only pre-computes
// snap_pct for players with starter games; everyone else carries raw off_snaps and
// team_off_snaps (the team's snaps in the games he played) in the stats block, so the share
// is summed across team stints from those, and the pre-computed percent is the fallback.
function _laSnapPrior(pid, season){
  const h=(typeof HISTORY!=='undefined'&&HISTORY&&HISTORY[pid])||null; if(!h) return null;
  const rec=h[String(season)]; if(!rec) return null;
  const list=(Array.isArray(rec)?rec:[rec]).filter(Boolean);
  let off=0, tm=0;
  list.forEach(r=>{ const st=r.stats||{}; if(st.off_snaps>0 && st.team_off_snaps>0){ off+=st.off_snaps; tm+=st.team_off_snaps; } });
  if(tm>0) return off/tm;
  const pct=list.filter(r=>r.snap_pct!=null).sort((a,b)=>(b.games_played||0)-(a.games_played||0))[0];
  return pct ? pct.snap_pct/100 : null;
}
// The index for the completed weeks: ready → returned; otherwise the fetch is kicked (every
// completed week × four positions through the shared three-wide pool; completed weeks cache
// forever) and null comes back until the re-render it triggers.
function laSnapIndex(){
  const sig=_laSnapSig();
  if(_laSnapMem.sig===sig && _laSnapMem.index) return _laSnapMem.index;
  const cw=(typeof completedWeeks==='function')?completedWeeks():0;
  if(!cw || typeof fetchWeekStats!=='function') return null;
  if(_laSnapMem.sig===sig && (_laSnapMem.loading || _laSnapMem.failed)) return null;
  _laSnapMem={sig, index:null, loading:true, failed:false};
  const season=TC_SEASON.year, weeks=Array.from({length:cw},(_,i)=>i+1);
  const tasks=[];
  weeks.forEach(w=>['QB','RB','WR','TE'].forEach(pos=>tasks.push(()=>fetchWeekStats(season,w,pos).then(rows=>({w,pos,rows})))));
  const run=(typeof _tcPool==='function')?_tcPool(tasks,3):Promise.all(tasks.map(t=>t().catch(()=>null)));
  run.then(parts=>{
    if(_laSnapMem.sig!==sig) return;
    const idx=_laSnapBuild(parts, season, weeks);
    _laSnapMem={sig, index:idx, loading:false, failed:!idx};
    if(idx && typeof _laInsRerender==='function') _laInsRerender();
  }).catch(()=>{ if(_laSnapMem.sig===sig) _laSnapMem={sig, index:null, loading:false, failed:true}; });
  return null;
}
function _laSnapName(row, pid){
  const pl=row.player||null;
  if(pl && (pl.first_name||pl.last_name)) return `${pl.first_name||''} ${pl.last_name||''}`.trim();
  const sp=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers)?sleeperPlayers[pid]:null;
  return sp ? (sp.name||`${sp.first_name||''} ${sp.last_name||''}`.trim()) : String(pid);
}
function _laSnapBuild(parts, season, weeks){
  const players=new Map(); let any=false, gotRows=false;
  (parts||[]).forEach(part=>{
    if(!part || !Array.isArray(part.rows)) return;
    gotRows=true;
    part.rows.forEach(row=>{
      const st=row.stats||{}; const pid=String(row.player_id||''); if(!pid||pid==='undefined') return;
      const pos=String(row.position||(row.player&&row.player.position)||part.pos||'').toUpperCase();
      if(['QB','RB','WR','TE'].indexOf(pos)<0) return;
      const sp=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers)?sleeperPlayers[pid]:null;
      const p=players.get(pid)||{pid, name:_laSnapName(row,pid), pos, team:row.team||(sp&&sp.team)||null, wks:{}};
      if(row.team) p.team=row.team;
      if(st.off_snp!=null && Number(st.tm_off_snp)>0){
        p.wks[part.w]={share:Number(st.off_snp)/Number(st.tm_off_snp), snaps:Number(st.off_snp), src:'sleeper'}; any=true;
      }
      players.set(pid,p);
    });
  });
  // Every Sleeper fetch failing is an outage, not a quiet week: say so rather than draw
  // the board from the sidecar's partial numbers alone.
  if(!gotRows) return null;
  // The sidecar's numbers only where Sleeper has none for that player-week.
  const side=_laSnapSidecar();
  if(side) side.forEach((v,pid)=>{
    const p=players.get(pid)||{pid, name:v.name, pos:String(v.pos||'').toUpperCase(), team:v.team||null, wks:{}};
    for(const wk in v.wks){ if(!p.wks[wk] && weeks.indexOf(Number(wk))>=0){ p.wks[wk]=v.wks[wk]; any=true; } }
    players.set(pid,p);
  });
  if(!any) return null;
  const out=[]; players.forEach(p=>{ if(Object.keys(p.wks).length) out.push(p); });
  return {season, weeks, cw:weeks[weeks.length-1], players:out};
}
// One player's read: latest completed week against the prior three weeks with data, or
// last season when this is the first data point. null = nothing to say (no latest week).
function laSnapTrend(p, cw, season){
  const wks=Object.keys(p.wks).map(Number).sort((a,b)=>a-b);
  if(!wks.length || wks[wks.length-1]!==cw) return null;
  const latest=p.wks[cw];
  const earlier=wks.filter(w=>w<cw).slice(-3);
  const prior=_laSnapPrior(p.pid, season-1);
  let base, baseLbl;
  if(earlier.length){
    base=earlier.reduce((a,w)=>a+p.wks[w].share,0)/earlier.length;
    baseLbl = earlier.length===1 ? `wk ${earlier[0]}` : `wks ${earlier[0]}–${earlier[earlier.length-1]}`;
  } else {
    if(prior==null) return null;
    base=prior; baseLbl=`${season-1} avg`;
  }
  const seasonHi = wks.length>=3 && wks.every(w=>p.wks[w].share<=latest.share+1e-9);
  const seasonLo = wks.length>=3 && wks.every(w=>p.wks[w].share>=latest.share-1e-9);
  return { p, cw, latest, base, baseLbl, delta:latest.share-base, prior, priorUsed:!earlier.length,
           tierNow:laSnapTier(latest.share), tierWas:laSnapTier(base), seasonHi, seasonLo };
}
// Position pick for the board. FLEX (RB/WR/TE) leads: a quarterback's share is all or
// nothing, so the QB list is mostly injuries and benchings — real, but a tap away.
const LA_SNAP_POS=[['FLEX','Flex'],['RB','RB'],['WR','WR'],['TE','TE'],['QB','QB']];
function laSnapPosPick(){ const v=laState.snapPos; return LA_SNAP_POS.some(x=>x[0]===v)?v:'FLEX'; }
function laSetSnapPos(v){ laState.snapPos=v; laRerenderKeepScroll(); }
function _laSnapPosKeeps(pick){ return pos => pick==='FLEX' ? (pos==='RB'||pos==='WR'||pos==='TE') : pos===pick; }
// The board: two columns, rising and falling, in the Trends tab's own row format.
function laSnapsBoardHTML(s, keeps, mineMark, two){
  const empty=(msg)=>`<div class="card la-ins-empty"><div class="empty-body">${msg}</div></div>`;
  const cw=(typeof completedWeeks==='function')?completedWeeks():0;
  if(!cw) return empty('Snap shares light up once week 1 completes.');
  const idx=laSnapIndex();
  if(!idx) return _laSnapMem.failed
    ? empty('Couldn’t reach Sleeper for the weekly snap counts — try again in a moment.')
    : empty(`Loading snap counts for weeks 1–${cw}…`);
  const pick=laSnapPosPick(), posOk=_laSnapPosKeeps(pick);
  const pills=`<div class="pos-filter la-snp-pos">${LA_SNAP_POS.map(([k,l])=>`<button class="pos-filter-btn ${pick===k?'active':''}" onclick="laSetSnapPos('${k}')">${l}</button>`).join('')}</div>`;
  const rows=[];
  idx.players.forEach(p=>{
    if(!posOk(p.pos) || !keeps(p.name,p.pos)) return;
    const t=laSnapTrend(p, idx.cw, idx.season); if(!t) return;
    if(Math.max(t.latest.share, t.base)<LA_SNAP_MIN_SHARE) return;
    rows.push(t);
  });
  rows.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  const pct=v=>`${Math.round(v*100)}%`;
  const row=(t,i)=>{
    const tier = t.tierNow!==t.tierWas ? `<span class="la-snp-tier">${t.tierWas} → <b>${t.tierNow}</b></span>` : `<span class="la-snp-tier">${t.tierNow}</span>`;
    const mark = t.seasonHi ? ' · season high' : t.seasonLo ? ' · season low' : '';
    const last = (!t.priorUsed && t.prior!=null) ? ` · ${idx.season-1}: ${pct(t.prior)}` : '';
    const src = t.latest.src==='nflverse' ? ' · <span class="la-snp-src" title="Sleeper had no snap count for this week; nflverse (PFR) fills it">nflverse</span>' : '';
    const detail=`${pct(t.base)} (${t.baseLbl}) → <b>${pct(t.latest.share)}</b> wk ${t.cw} · ${tier}${mark}${last}${src}`;
    const big=`${t.delta>=0?'+':'−'}${Math.round(Math.abs(t.delta)*100)}`;
    const pp={id:t.p.pid, name:t.p.name, pos:t.p.pos, team:t.p.team};
    return _laTrendRow(pp, detail, _laVerdict(big, 'share pts', t.delta>=0?'la-trnd-up':'la-trnd-dn')+mineMark(t.p.name,t.p.pos),
      t.delta>=0?'pace-ahead':'pace-behind', i+1);
  };
  const up=rows.filter(t=>t.delta>=LA_SNAP_MIN_DELTA).slice(0,15), dn=rows.filter(t=>t.delta<=-LA_SNAP_MIN_DELTA).slice(0,15);
  const sub=`week ${idx.cw} against the prior three weeks (last season when there are none) · Sleeper’s snap counts, nflverse where Sleeper is blank`;
  return pills + two('SNAP SHARE', sub, '▲ RISING', up.map(row).join(''), '▼ FALLING', dn.map(row).join(''));
}
