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

// Format one weekly cell. `dp` = decimal places. `pct:true` means the SEED stores the value
// as a 0-1 fraction (nflverse ships missed_tackle_pct as 0.125, i.e. 12.5%) so we scale it to
// a human percentage here — the seed is NOT changed, only the display.
function _dwNum(v, dp=1, pct=false){
  if(v==null || Number.isNaN(v)) return '–';
  const n = pct ? Number(v)*100 : Number(v);
  return n.toFixed(dp) + (pct ? '%' : '');
}

// ═══════════════════════════════════════════════════════════════════════════
// COLOR THRESHOLDS FOR THE DEFENSIVE WEEKLY CARD — EDIT THESE
// ═══════════════════════════════════════════════════════════════════════════
// One line per stat. Two helpers, and the argument order differs between them:
//   _tri(v, good, ok)     → HIGHER is better.  v >= good = green, v >= ok = yellow, else red
//   _triLow(v, good, ok)  → LOWER is better.   v <= good = green, v <= ok = yellow, else red
// All values are PER GAME (one row = one week). `missed_tackle_pct` is compared AFTER the
// 0-1 → 0-100 scaling below, so its thresholds are on a 0-100 scale like a human would read.
// ═══════════════════════════════════════════════════════════════════════════
function _dwCellClass(key, v){
  if(v==null || Number.isNaN(v)) return '';
  // missed_tackle_pct arrives as a fraction (0.125); compare on the same 0-100 scale we show.
  if(key==='missed_tackle_pct') return _triLow(v*100, 8, 16);
  // snap share is a FRACTION from the seed too; higher = more on the field = better.
  if(key==='snap_pct') return _tri(v*100, 70, 40);   // 70%+ green, 40%+ yellow
  if(key==='tackles') return _tri(v,7,4);                 // tackles/game: 7+ green, 4+ yellow
  if(key==='sacks') return _tri(v,1,0.5);                 // sacks/game
  if(key==='pressures') return _tri(v,4,2);               // pressures/game
  if(key==='hurries') return _tri(v,3,1);                 // hurries/game
  if(key==='qb_hits') return _tri(v,2,1);                 // QB hits/game
  if(key==='blitzes') return _tri(v,4,1);                 // blitzes/game
  if(key==='ints') return _tri(v,1,0.5);                  // INTs/game
  if(key==='td_allowed') return _triLow(v,0,1);           // TDs allowed in coverage/game
  if(key==='rating_allowed') return _triLow(v,75,105);    // passer rating when targeted (0-158.3)
  // NOTE: one shared rule for three very different stats — 5/8 is sensible for targets and
  // completions allowed, but 5/8 YARDS allowed is far too strict. Split these if you want
  // yds_allowed to read sensibly (e.g. _triLow(v,25,50)).
  if(key==='cmp_allowed' || key==='targets') return _triLow(v,5,8);
  if(key==='yds_allowed') return _triLow(v,5,8);           // ← almost certainly wants its own scale
  return '';
}

// Column spec for one defensive group's weekly table. Each entry is:
//   k    = key into the week object from the seed (e.g. w.missed_tackle_pct)
//   l    = the <th> label shown to the user
//   d    = decimal places for display
//   pct  = seed stores a 0-1 fraction; multiply by 100 and append '%' when rendering
// `group` is the seed's own DL/LB/DB bucket (rec.group), NOT the roster position — a 3-4 OLB
// is grouped LB even though its position code is OLB. Anything unrecognised falls to the DB
// table at the bottom.
function _dwCols(group){
  if(group==='DL'){
    return [
      {k:'snap_pct', l:'SNP%', d:0, pct:true},
      {k:'tackles', l:'TKL', d:0}, {k:'sacks', l:'SACK', d:1}, {k:'pressures', l:'PRS', d:1},
      {k:'hurries', l:'HUR', d:1}, {k:'qb_hits', l:'HIT', d:1}, {k:'blitzes', l:'BLZ', d:1},
      {k:'missed_tackles', l:'MTKL', d:1}, {k:'missed_tackle_pct', l:'MISS%', d:1, pct:true},
    ];
  }
  if(group==='LB'){
    return [
      {k:'snap_pct', l:'SNP%', d:0, pct:true},
      {k:'tackles', l:'TKL', d:0}, {k:'sacks', l:'SACK', d:1}, {k:'pressures', l:'PRS', d:1},
      {k:'blitzes', l:'BLZ', d:1}, {k:'targets', l:'TGT', d:1}, {k:'cmp_allowed', l:'CMPA', d:1},
      {k:'yds_allowed', l:'YDSA', d:1}, {k:'ints', l:'INT', d:1}, {k:'rating_allowed', l:'RTG A', d:1},
      {k:'missed_tackles', l:'MTKL', d:1}, {k:'missed_tackle_pct', l:'MISS%', d:1, pct:true},
    ];
  }
  return [
    {k:'snap_pct', l:'SNP%', d:0, pct:true},
    {k:'targets', l:'TGT', d:1}, {k:'cmp_allowed', l:'CMPA', d:1}, {k:'yds_allowed', l:'YDSA', d:1},
    {k:'td_allowed', l:'TDA', d:1}, {k:'ints', l:'INT', d:1}, {k:'rating_allowed', l:'RTG A', d:1},
    {k:'adot', l:'aDOT', d:1}, {k:'yac_allowed', l:'YAC A', d:1}, {k:'tackles', l:'TKL', d:0},
    // DBs miss tackles too — the seed has 100% coverage for DB/LB/DL, it just wasn't surfaced.
    {k:'missed_tackles', l:'MTKL', d:1}, {k:'missed_tackle_pct', l:'MISS%', d:1, pct:true},
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
        return `<td class="pcard-cell ${cls}">${v==null?'–':_dwNum(v, c.d, c.pct)}</td>`;
      }).join('');
      return `<tr><td class="pcard-wk">${w.week||''}</td><td class="pcard-opp home">${opp}</td>${cells}</tr>`;
    }).join('');
    const totals = rec.totals||{};
    const totCells = cols.map(c=>{
      const v=totals[c.k];
      return `<td class="pcard-cell pcard-total-cell">${v==null?'–':_dwNum(v,c.d,c.pct)}</td>`;
    }).join('');
    // games = weeks PFR charted; gp = weeks he actually took a snap. When they differ, say so:
    // "9/16g" is honest where a bare "16g" would imply every row carries stats.
    const gp = totals.gp!=null ? totals.gp : rec.weeks.length;
    const ch = totals.games!=null ? totals.games : rec.weeks.length;
    const gLbl = (gp && ch && gp!==ch) ? `${ch}/${gp}g` : `${ch||gp}g`;
    const gTip = (gp && ch && gp!==ch)
      ? `Played ${gp} games; PFR charted advanced stats in ${ch}. Uncharted weeks still appear (snap share proves he played) but their stat cells are blank.`
      : `${ch||gp} games played`;
    const totalRow = `<tr class="pcard-total-row"><td class="pcard-wk">TOT</td><td class="pcard-opp" title="${gTip}">${gLbl}</td>${totCells}</tr>`;
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
