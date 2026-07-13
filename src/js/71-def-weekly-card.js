// ── Defensive weekly card (DL/LB/DB), ESPN-style table layout ─────────────
// Seed payload: NFLVERSE[season].def_weekly[normName] = {
//   name,team,pos,group,totals:{...},weeks:[{week,opp,tackles,sacks,pressures,...}]
// }

const DEF_CARD_POS = new Set(['DE','DT','NT','DL','LB','MLB','OLB','ILB','WLB','SLB','DB','CB','S','FS','SS']);

function _pcardDefNorm(pid){
  const p=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[pid])||{};
  return ecrNormName(p.name||'');
}

function pcardDefWeeklySeasons(normName){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE)
    .filter(s=>{ const d=NFLVERSE[s]&&NFLVERSE[s].def_weekly; return d && d[normName]; })
    .sort((a,b)=>b-a);
}

function pcardDefWeeklyAvailable(pid){
  return pcardDefWeeklySeasons(_pcardDefNorm(pid)).length>0;
}

function _dwNum(v, dp=1){
  if(v==null || Number.isNaN(v)) return '–';
  return Number(v).toFixed(dp);
}

function _dwCellClass(key, v){
  if(v==null || Number.isNaN(v)) return '';
  if(key==='tackles') return _tri(v,7,4);
  if(key==='sacks') return _tri(v,1,0.5);
  if(key==='pressures') return _tri(v,4,2);
  if(key==='hurries') return _tri(v,3,1);
  if(key==='qb_hits') return _tri(v,2,1);
  if(key==='blitzes') return _tri(v,4,1);
  if(key==='ints') return _tri(v,1,0.5);
  if(key==='td_allowed') return _triLow(v,0,1);
  if(key==='rating_allowed') return _triLow(v,75,105);
  if(key==='missed_tackle_pct') return _triLow(v,8,16);
  if(key==='cmp_allowed' || key==='yds_allowed' || key==='targets') return _triLow(v,5,8);
  return '';
}

function _dwCols(group){
  if(group==='DL'){
    return [
      {k:'tackles', l:'TKL', d:0}, {k:'sacks', l:'SACK', d:1}, {k:'pressures', l:'PRS', d:1},
      {k:'hurries', l:'HUR', d:1}, {k:'qb_hits', l:'HIT', d:1}, {k:'blitzes', l:'BLZ', d:1},
      {k:'missed_tackle_pct', l:'MISS%', d:1},
    ];
  }
  if(group==='LB'){
    return [
      {k:'tackles', l:'TKL', d:0}, {k:'sacks', l:'SACK', d:1}, {k:'pressures', l:'PRS', d:1},
      {k:'blitzes', l:'BLZ', d:1}, {k:'targets', l:'TGT', d:1}, {k:'cmp_allowed', l:'CMPA', d:1},
      {k:'yds_allowed', l:'YDSA', d:1}, {k:'ints', l:'INT', d:1}, {k:'rating_allowed', l:'RTG A', d:1},
    ];
  }
  return [
    {k:'targets', l:'TGT', d:1}, {k:'cmp_allowed', l:'CMPA', d:1}, {k:'yds_allowed', l:'YDSA', d:1},
    {k:'td_allowed', l:'TDA', d:1}, {k:'ints', l:'INT', d:1}, {k:'rating_allowed', l:'RTG A', d:1},
    {k:'adot', l:'aDOT', d:1}, {k:'yac_allowed', l:'YAC A', d:1}, {k:'tackles', l:'TKL', d:0},
  ];
}

function _dwTitleForSeason(season, rec){
  const tm = rec && rec.team ? rec.team : '';
  const lg = tm ? NFL_LOGO(tm) : '';
  const teamTag = tm ? ` <span class="pcard-season-team">· ${lg?`<img src="${lg}" class="pcard-season-logo" onerror="this.style.display='none'">`:''}${tm}</span>` : '';
  return `<div class="pcard-season-title">${season}${teamTag}</div>`;
}

function renderPcardDefWeekly(pid){
  const norm=_pcardDefNorm(pid);
  const seasons=pcardDefWeeklySeasons(norm);
  if(!seasons.length) return '<div class="pcard-loading">No nflverse defensive weekly data for this player.</div>';
  const seasonBlocks = [];
  for(const season of seasons){
    const rec=NFLVERSE[season]&&NFLVERSE[season].def_weekly&&NFLVERSE[season].def_weekly[norm];
    if(!rec || !Array.isArray(rec.weeks) || !rec.weeks.length) continue;
    const cols=_dwCols(rec.group||'DB');
    const colHead = cols.map(c=>`<th>${c.l}</th>`).join('');
    const bodyRows = rec.weeks.map(w=>{
      const ol = w.opp ? NFL_LOGO(w.opp) : '';
      const opp = w.opp
        ? `<span class="pcard-opp-inner"><span class="pcard-vs">vs</span>${ol?`<img src="${ol}" class="pcard-opp-logo" onerror="this.style.display='none'">`:''}<span>${w.opp}</span></span>`
        : '–';
      const cells = cols.map(c=>{
        const v = w[c.k];
        const cls = _dwCellClass(c.k, v);
        return `<td class="pcard-cell ${cls}">${v==null?'–':_dwNum(v, c.d)}</td>`;
      }).join('');
      return `<tr><td class="pcard-wk">${w.week||''}</td><td class="pcard-opp home">${opp}</td>${cells}</tr>`;
    }).join('');
    const totals = rec.totals||{};
    const totCells = cols.map(c=>{
      const v=totals[c.k];
      return `<td class="pcard-cell pcard-total-cell">${v==null?'–':_dwNum(v,c.d)}</td>`;
    }).join('');
    const totalRow = `<tr class="pcard-total-row"><td class="pcard-wk">TOT</td><td class="pcard-opp">${totals.games||rec.weeks.length}g</td>${totCells}</tr>`;
    seasonBlocks.push(`<div class="pcard-season">
      ${_dwTitleForSeason(season, rec)}
      <div class="pcard-table-scroll"><table class="pcard-table">
        <thead><tr><th class="pcard-th-wk">WK</th><th>OPP</th>${colHead}</tr></thead>
        <tbody>${bodyRows}${totalRow}</tbody>
      </table></div>
    </div>`);
  }
  if(!seasonBlocks.length) return '<div class="pcard-loading">No defensive weekly rows for this player.</div>';
  return `<div class="dw-wrap">${seasonBlocks.join('')}<div class="pcard-src">Defensive weekly stats from nflverse PFR advanced-defense + participation/pbp enrichment.</div></div>`;
}
