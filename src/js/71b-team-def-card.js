// ─────────────────────────────────────────────────────────────────────────────
// Team defense (D/ST) player card. Team defenses aren't in the Sleeper player DB and have
// no ESPN athlete id, so the normal gamelog paths don't apply. Instead we pull Sleeper's
// per-week DEF stats for the team and render a gamelog of what Sleeper actually tracks,
// scored with its base (std) fantasy points. Quick + self-contained: fetch → cache → table.
// ─────────────────────────────────────────────────────────────────────────────

// A player card "pid" that is a bare team abbreviation (PIT, SF, JAX…) is a team defense.
function pcardIsTeamDef(pid, posc){
  return posc==='DEF' && /^[A-Z]{2,4}$/.test(String(pid||''));
}

// Compact hero for a team defense — team name + logo, one stats tab. Mirrors the pcard shell
// markup so all the existing overlay CSS applies, minus the person-only meta grid.
function renderTeamDefShell(pid){
  const team = String(pid).toUpperCase();
  const full = (typeof teamDisplayName==='function' ? teamDisplayName(team) : team);
  let tc = (typeof teamColor==='function') ? teamColor(team) : 'var(--surface2)';
  if(typeof _hexLum==='function' && typeof _darken==='function' && _hexLum(tc) > 0.4) tc = _darken(tc, 0.45);
  const heroStyle = `background:linear-gradient(135deg, ${tc} 0%, ${tc} 42%, var(--surface) 100%);`;
  const html = `
    <div class="pcard" onclick="event.stopPropagation()">
      <div class="pcard-hero" style="${heroStyle}">
        <div class="pcard-hero-logo" style="background-image:url('${NFL_LOGO(team)}')"></div>
        <img src="${NFL_LOGO(team)}" class="pcard-hero-img pcard-hero-dst" onerror="this.style.display='none'">
        <div class="pcard-hero-main">
          <div class="pcard-name">${full}</div>
          <div class="pcard-sub"><span class="pos-badge pos-DEF">D/ST</span><span class="pcard-team">Team Defense</span></div>
        </div>
        <button class="pcard-close" onclick="closePlayerCard()" aria-label="Close">${typeof TC_ICON==='function'?TC_ICON('close'):'\u2715'}</button>
      </div>
      <div class="pcard-tabs" id="pcardTabs"></div>
      <div class="pcard-body" id="pcardBody">
        <div class="pcard-loading">Loading defensive game logs…</div>
      </div>
    </div>`;
  const overlay = document.getElementById('pcardOverlay');
  if(overlay){ overlay.innerHTML = html; }
  else {
    const div = document.createElement('div');
    div.id='pcardOverlay'; div.className='pcard-overlay';
    div.onclick = closePlayerCard;
    div.innerHTML = html;
    document.body.appendChild(div);
  }
}

// season → { [TEAM]: [{week, opp, stats}] }, fetched once per season and cached. Sleeper's
// grouping=week endpoint actually returns a single season-aggregate row, so we pull each week
// individually (1–18) and assemble the gamelog. Weeks are fetched in parallel; missing weeks
// (bye, or not yet played) simply don't appear.
const _dstWeekCache = {};
async function pcardFetchDstSeason(season){
  if(_dstWeekCache[season]) return _dstWeekCache[season];
  const WEEKS = 18;
  const reqs = [];
  for(let w=1; w<=WEEKS; w++){
    const url = `https://api.sleeper.com/stats/nfl/${season}/${w}?season_type=regular&position[]=DEF`;
    reqs.push(sleeperFetch(url).then(rows=>({w, rows})).catch(()=>({w, rows:null})));
  }
  const results = await Promise.all(reqs);
  const byTeam = {};
  results.forEach(({w, rows})=>{
    (Array.isArray(rows)?rows:[]).forEach(r=>{
      const tm = r.player_id || r.team || (r.player&&r.player.team);
      if(!tm || !r.stats) return;
      // A defense only has a row in a week it actually played; skip empty stat blobs.
      if(r.stats.gp==null && r.stats.pts_std==null && r.stats.sack==null) return;
      (byTeam[tm] = byTeam[tm] || []).push({ week:w, opp:r.opponent||null, stats:r.stats });
    });
  });
  Object.values(byTeam).forEach(list=>list.sort((a,b)=>(a.week||0)-(b.week||0)));
  _dstWeekCache[season] = byTeam;
  return byTeam;
}

// Columns to show — the meaningful subset of what Sleeper tracks for a defense, in the order
// a fantasy manager reads them. `pts` is Sleeper's own base (std) scoring for the unit.
const _DST_COLS = [
  {k:'sack',        l:'SACK', d:0},
  {k:'int',         l:'INT',  d:0},
  {k:'fum_rec',     l:'FR',   d:0},
  {k:'ff',          l:'FF',   d:0},
  {k:'def_td',      l:'DEF TD', d:0},
  {k:'def_st_td',   l:'ST TD', d:0},
  {k:'safe',        l:'SAF',  d:0},
  {k:'blk_kick',    l:'BLK',  d:0},
  {k:'pts_allow',   l:'PA',   d:0},
  {k:'yds_allow',   l:'YA',   d:0},
  {k:'pts_std',     l:'FPTS', d:1},
];

function _dstNum(v, d){
  if(v==null) return '–';
  const n = +v;
  if(!isFinite(n)) return '–';
  return d ? n.toFixed(d) : String(Math.round(n));
}

// Which seasons to offer. Sleeper has DEF weekly stats back many years; we show the last few
// completed seasons so the card isn't a wall. Uses the projection season as the anchor.
function _dstSeasons(){
  const proj = (typeof PROJ_SEASON!=='undefined') ? parseInt(PROJ_SEASON,10) : new Date().getFullYear();
  const out = [];
  for(let y=proj-1; y>=proj-4; y--) out.push(String(y));
  return out;
}

// Render entry: kicks off async fetches for each season, shows a loading note, fills in as
// data arrives. Mirrors the def-weekly card's table styling so it feels native.
function renderPcardTeamDef(pid){
  const team = String(pid).toUpperCase();
  const seasons = _dstSeasons();
  const host = 'dstBody_' + team;
  // Fire the fetches; each re-renders its own season block on arrival.
  seasons.forEach(season=>{
    pcardFetchDstSeason(season).then(byTeam=>{
      if(!pcardOpen) return;
      const cell = document.getElementById(`dst_${team}_${season}`);
      if(!cell) return;
      cell.innerHTML = _dstSeasonBlock(byTeam[team], season, team);
    }).catch(()=>{});
  });
  const blocks = seasons.map(season=>
    `<div id="dst_${team}_${season}" class="pcard-season"><div class="pcard-loading">Loading ${season}…</div></div>`
  ).join('');
  return `<div class="dw-wrap" id="${host}">${blocks}
    <div class="pcard-src">Team defense weekly stats from Sleeper · base (std) scoring.</div></div>`;
}

function _dstSeasonBlock(weeks, season, team){
  if(!weeks || !weeks.length) return `<div class="pcard-mini-note">No ${season} defensive weeks.</div>`;
  const colHead = _DST_COLS.map(c=>`<th>${c.l}</th>`).join('');
  const tot = {};
  const bodyRows = weeks.map(w=>{
    const ol = w.opp ? NFL_LOGO(w.opp) : '';
    const opp = w.opp
      ? `<span class="pcard-opp-inner"><span class="pcard-vs">vs</span>${ol?`<img src="${ol}" class="pcard-opp-logo" onerror="this.style.display='none'">`:''}<span>${w.opp}</span></span>`
      : '–';
    const cells = _DST_COLS.map(c=>{
      const v = w.stats[c.k];
      if(v!=null && isFinite(+v)) tot[c.k] = (tot[c.k]||0) + (+v);
      return `<td class="pcard-cell">${_dstNum(v, c.d)}</td>`;
    }).join('');
    return `<tr><td class="pcard-wk">${w.week||''}</td><td class="pcard-opp home">${opp}</td>${cells}</tr>`;
  }).join('');
  // PA/YA total as an average reads better than a sum over a season.
  const gp = weeks.length;
  const totCells = _DST_COLS.map(c=>{
    let v = tot[c.k];
    if(v!=null && (c.k==='pts_allow' || c.k==='yds_allow')) v = v/gp;   // per-game average
    return `<td class="pcard-cell pcard-total-cell">${v==null?'–':_dstNum(v, (c.k==='pts_allow'||c.k==='yds_allow')?1:c.d)}</td>`;
  }).join('');
  const totalRow = `<tr class="pcard-total-row"><td class="pcard-wk">TOT</td><td class="pcard-opp" title="${gp} games (PA/YA shown per game)">${gp}g</td>${totCells}</tr>`;
  const full = (typeof teamDisplayName==='function' ? teamDisplayName(team) : team);
  return `<div class="pcard-season-title"><img src="${NFL_LOGO(team)}" class="pcard-dst-logo" onerror="this.style.display='none'"> ${full} D/ST · ${season}</div>
    <div class="pcard-table-scroll"><table class="pcard-table">
      <thead><tr><th class="pcard-th-wk">WK</th><th>OPP</th>${colHead}</tr></thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table></div>`;
}
