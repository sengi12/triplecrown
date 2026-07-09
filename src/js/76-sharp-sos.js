async function showSharpLeague(target){
  rankScope='all'; currentPhase='AdvancedLeague';
  if(target==='sos'){ sharpTable='__sos__'; sharpSortCol=null; sharpSortDir=1; }
  if(sharpTable==='__sos__' && !_sosSchedLoaded && !_sosSchedLoading){
    _sosSchedLoading = true;
    try {
      await Promise.all(Object.keys(SOS).map(code => fetchTeamSchedule(code)));
      _sosSchedLoaded = true;
    } finally {
      _sosSchedLoading = false;
    }
  }
  renderContent();
}
function setSharpTable(key){ sharpTable=key; sharpSortCol=null; renderSharpLeague(); }
function setSharpCategory(cat){
  sharpCategory=cat;
  // Jump to the first table in the newly selected category.
  const keys=Object.keys(SHARP).filter(k=>(SHARP[k].category||'offense')===cat);
  if(keys.length){ sharpTable=keys[0]; sharpSortCol=null; }
  renderSharpLeague();
}
function sortSharpBy(col){
  if(sharpSortCol===col){ sharpSortDir*=-1; } else { sharpSortCol=col; sharpSortDir=1; }
  renderSharpLeague();
}
function renderSharpLeague(){
  const host=document.getElementById('content'); if(!host) return;
  const hasSharp=sharpHasData(), hasSOS=SOS&&Object.keys(SOS).length>0;
  if(!hasSharp && !hasSOS){
    host.innerHTML=`<div class="phase-tabs">${tabBar()}</div>
      <div class="empty"><div class="empty-icon">📊</div><div class="empty-title">No advanced stats loaded</div>
      <div class="empty-body">Run <code>build_seed.py</code> and load the 📦 seed.</div></div>`;
    return;
  }
  const headerBar=`
    <div class="team-header sr-league-header">
      <div><div class="team-abbr">📊 Advanced Stats — League-Wide</div>
        <div class="team-qb-name">Warren Sharp · <b>${SHARP_SEASON} season</b> · click any column to sort (best→worst)</div></div>
      <div class="team-nav">
        ${currentTeam?`<button class="btn btn-ghost" onclick="setPhase('Advanced')">← ${teamDisplayName(currentTeam)} card</button>`:''}
        <button class="btn btn-ghost" onclick="setPhase('Rankings')">🏆 Rankings</button></div>
    </div>
    <div class="phase-tabs">${tabBar()}</div>`;

  // The SOS view is its own "table" selection.
  if(sharpTable==='__sos__' && hasSOS){
    host.innerHTML = headerBar + renderCategoryTabs() + renderSOSView();
    return;
  }

  const keys=Object.keys(SHARP).filter(k=>(SHARP[k].category||'offense')===sharpCategory);
  if(!sharpTable || sharpTable==='__sos__' || !SHARP[sharpTable] || (SHARP[sharpTable].category||'offense')!==sharpCategory){
    sharpTable = keys[0];
  }
  if(!sharpTable){ // no tables in this category
    host.innerHTML = headerBar + renderCategoryTabs() + `<div class="sr-desc">No tables in this category.</div>`;
    return;
  }
  const tbl=SHARP[sharpTable];
  const cols=tbl.columns;
  let rows=Object.keys(tbl.teams).map(code=>({code, ...tbl.teams[code]}));
  const sortCol = sharpSortCol || cols[0];
  rows.sort((a,b)=>{
    const ra=a.ranks?a.ranks[sortCol]:null, rb=b.ranks?b.ranks[sortCol]:null;
    if(ra==null && rb==null) return 0;
    if(ra==null) return 1;
    if(rb==null) return -1;
    return (ra-rb)*sharpSortDir;
  });
  const tableTabs = keys.map(k=>`<button class="sr-tab ${k===sharpTable?'active':''}" onclick="setSharpTable('${k}')">${SHARP[k].title||k}</button>`).join('');
  const head = `<th class="sr-th-team">TEAM</th>`+cols.map(c=>{
    const active = c===sortCol;
    const arrow = active ? (sharpSortDir>0?' ▲':' ▼') : '';
    return `<th class="sr-th ${active?'active':''}" onclick="sortSharpBy('${c.replace(/'/g,"\\'")}')" title="Sort by ${c}">${c}${arrow}</th>`;
  }).join('');
  const body = rows.map(r=>{
    const cells = cols.map(c=>{
      const v=r.values?r.values[c]:null, rk=r.ranks?r.ranks[c]:null;
      return `<td class="sr-td ${sharpRankClass(rk)}"><span class="sr-td-val">${fmtSharpVal(v, sharpColIsPct(tbl,c))}</span><span class="sr-td-rank">${rk!=null?rk:''}</span></td>`;
    }).join('');
    return `<tr><td class="sr-td-team"><span class="sr-td-team-inner"><img src="${NFL_LOGO(r.code)}" class="sr-logo" onerror="this.style.display='none'">${r.code}</span></td>${cells}</tr>`;
  }).join('');
  host.innerHTML = headerBar + renderCategoryTabs() + `
    <div class="sr-league-tabs">${tableTabs}</div>
    <div class="sr-desc">${tbl.title} · <b>${SHARP_SEASON} season</b> — all 32 teams. Cell shows the stat value with its league rank; color = quartile (green best → red worst).</div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="sr-league-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
    <div class="sr-source">Source: sharpfootballanalysis.com — for informational use.</div>`;
}

// Offense / Defense / SOS category selector row for the league-wide view.
function renderCategoryTabs(){
  const hasOff=Object.keys(SHARP).some(k=>(SHARP[k].category||'offense')==='offense');
  const hasDef=Object.keys(SHARP).some(k=>SHARP[k].category==='defense');
  const hasSOS=SOS&&Object.keys(SOS).length>0;
  const isSOS = sharpTable==='__sos__';
  const btn=(cat,label,active,onclick)=>`<button class="sr-cat ${active?'active':''}" onclick="${onclick}">${label}</button>`;
  let out='<div class="sr-cat-row">';
  if(hasOff) out+=btn('offense','🏈 Offense', !isSOS && sharpCategory==='offense', "setSharpCategory('offense')");
  if(hasDef) out+=btn('defense','🛡️ Defense', !isSOS && sharpCategory==='defense', "setSharpCategory('defense')");
  if(hasSOS) out+=btn('sos','📅 Strength of Schedule', isSOS, "showSharpLeague('sos')");
  out+='</div>';
  return out;
}

// The Strength-of-Schedule view: a recreation of Sharp's descending-diagonal chart
// (easiest at top-left → hardest at bottom-right, split by the league-average line),
// plus the full sortable table beneath it.
function renderSOSView(){
  const entries=Object.keys(SOS).map(code=>({code, ...SOS[code]})).filter(e=>e.rank!=null);
  entries.sort((a,b)=>a.rank-b.rank);
  const n=entries.length||32;

  // Kick off schedule fetches (once) so we can sum each team's opponents' win totals.
  // When they land we re-render into the arc; until then we show the rank diagonal.
  if(!_sosSchedLoading && !_sosSchedLoaded){
    _sosSchedLoading=true;
    Promise.all(entries.map(e=>fetchTeamSchedule(e.code))).then(()=>{
      _sosSchedLoaded=true; _sosSchedLoading=false;
      if(currentPhase==='AdvancedLeague' && sharpTable==='sos') renderContent();
    }).catch(()=>{ _sosSchedLoading=false; });
  }

  // Attach each team's summed-opponent-win-total (the schedule-difficulty metric).
  let haveOppData=false, minT=Infinity, maxT=-Infinity;
  entries.forEach(e=>{
    const o=opponentWinTotal(e.code);
    e.oppTotal = o ? o.total : null;
    e.oppGames = o ? o.games : 0;
    if(e.oppTotal!=null){ haveOppData=true; if(e.oppTotal<minT)minT=e.oppTotal; if(e.oppTotal>maxT)maxT=e.oppTotal; }
  });

  // Chart geometry
  const W=920, H=430, padL=30, padR=30, padT=52, padB=30;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const x=(rank)=> padL + (plotW*(rank-1)/(n-1));
  // Y by rank (fallback, straight diagonal) until opponent sums are in.
  const yByRank=(rank)=> padT + (plotH*(rank-1)/(n-1));
  // Y by summed opponent win total: HIGHEST total (hardest) at the BOTTOM, lowest at top.
  // Falls back to the rank position for any team missing opponent data (keeps it where the
  // straight-line placement would have put it, per design).
  const span = (maxT>minT) ? (maxT-minT) : 1;
  // Y by summed opponent win total: hardest (max total) at the BOTTOM, easiest at top.
  // Teams missing opponent data fall back to their rank-diagonal position (kept in place).
  const yHard=(e)=> (e.oppTotal==null) ? yByRank(e.rank)
                   : padT + plotH*( (e.oppTotal - minT) / span );
  const useArc = haveOppData;
  const y=(e)=> useArc ? yHard(e) : yByRank(e.rank);

  const midY = padT + plotH/2;
  const logos=entries.map(e=>{
    const cx=x(e.rank), cy=y(e);
    const oppNote = e.oppTotal!=null ? ` · opp win total ${e.oppTotal.toFixed(1)}${e.oppGames<17?` (${e.oppGames} tracked)`:''}` : '';
    return `<image href="${NFL_LOGO(e.code)}" x="${cx-13}" y="${cy-13}" width="26" height="26">
      <title>${e.name||e.code} — SOS ${ordinal(e.rank)}, Vegas win total ${e.win_total}${oppNote}</title></image>
      <text x="${cx}" y="${cy+22}" class="sos-rank-lbl" text-anchor="middle">${e.rank}</text>`;
  }).join('');
  const subline = useArc
    ? `Height = sum of opponents' Vegas win totals · easier slate (top) → harder slate (bottom)`
    : (_sosSchedLoading ? `Loading opponent schedules…` : `Based on Vegas Forecasted Win Totals · easiest (1) → hardest (${n})`);
  const chart=`<svg viewBox="0 0 ${W} ${H}" class="sos-chart" preserveAspectRatio="xMidYMid meet">
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${midY-padT}" class="sos-band-easy"/>
    <rect x="${padL}" y="${midY}" width="${plotW}" height="${padT+plotH-midY}" class="sos-band-hard"/>
    <line x1="${padL}" y1="${midY}" x2="${padL+plotW}" y2="${midY}" class="sos-midline"/>
    <text x="${padL+plotW-4}" y="${midY-6}" class="sos-band-lbl" text-anchor="end">EASIER SLATE ▲</text>
    <text x="${padL+plotW-4}" y="${midY+16}" class="sos-band-lbl" text-anchor="end">HARDER SLATE ▼</text>
    <text x="${padL}" y="34" class="sos-title">${PROJ_SEASON} NFL Strength of Schedule</text>
    <text x="${padL}" y="48" class="sos-sub">${subline}</text>
    ${logos}
  </svg>`;
  // Table beneath
  let sortDir=sharpSortDir;
  const sortCol=sharpSortCol||'rank';
  const rows=entries.slice().sort((a,b)=>{
    let av,bv;
    if(sortCol==='win_total'){ av=a.win_total; bv=b.win_total; }
    else { av=a.rank; bv=b.rank; }
    if(av==null&&bv==null)return 0; if(av==null)return 1; if(bv==null)return -1;
    return (av-bv)*sortDir;
  });
  const th=(col,label)=>{
    const active=sortCol===col; const arrow=active?(sortDir>0?' ▲':' ▼'):'';
    return `<th class="sr-th ${active?'active':''}" onclick="sortSOSBy('${col}')">${label}${arrow}</th>`;
  };
  const body=rows.map(e=>`<tr>
    <td class="sr-td-team"><span class="sr-td-team-inner"><img src="${NFL_LOGO(e.code)}" class="sr-logo" onerror="this.style.display='none'">${teamDisplayName(e.code)}</span></td>
    <td class="sr-td ${sharpRankClass(e.rank)}"><span class="sr-td-val">${ordinal(e.rank)}</span></td>
    <td class="sr-td"><span class="sr-td-val">${e.win_total!=null?e.win_total:'—'}</span></td>
  </tr>`).join('');
  return `<div class="sr-desc">${PROJ_SEASON} strength of schedule, based on Vegas win totals. Rank 1 = easiest slate, ${n} = hardest.</div>
    <div class="card sos-card">${chart}</div>
    <div class="card" style="padding:0;overflow-x:auto;margin-top:12px">
      <table class="sr-league-table sos-table"><thead><tr>
        <th class="sr-th-team">TEAM</th>${th('rank',PROJ_SEASON+' SOS RANK')}${th('win_total','VEGAS WIN TOTAL')}
      </tr></thead><tbody>${body}</tbody></table>
    </div>
    <div class="sr-source">Source: sharpfootballanalysis.com — for informational use.</div>`;
}
function sortSOSBy(col){
  if(sharpSortCol===col){ sharpSortDir*=-1; } else { sharpSortCol=col; sharpSortDir=1; }
  renderSharpLeague();
}


