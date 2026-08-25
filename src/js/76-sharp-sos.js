// ── Advanced Stats (nflverse "Sharp") data helpers ──────────────────────────
// Read-only reference feeding both the per-team Advanced card and the league-wide sortable
// table below. None of this touches projections. (Named "Sharp" for historical reasons — the
// Warren Sharp source is gone; every table here is computed from the nflverse seed.)
function sharpHasData(){ return activeSharp() && Object.keys(activeSharp()).length>0; }
// Which season the Advanced Stats tables describe. Follows the season tabs: on a completed
// season the nflverse seed carries team data for, the tables show THAT season; on the
// projection view (or a season with no team data) it falls back to the seed's reference season
// (SHARP_SEASON, the newest completed year). Single hook for the whole feature — every renderer
// reads activeSharp(), which reads this.
function advTeamSeason(){
  const s = String(activeSeason);
  if(activeSeason!=='proj' && NFLVERSE && NFLVERSE[s] && NFLVERSE[s].team) return s;
  // In-season, the projection view's Advanced tab is about THIS season to date (the live
  // sidecar merges the current year's team tables). Before the sidecar lands — or in the
  // offseason — it stays on the last completed season.
  if(typeof tcIsLiveSeason==='function' && typeof TC_SEASON!=='undefined'){
    const yr=String(TC_SEASON.year);
    if(tcIsLiveSeason(yr) && NFLVERSE && NFLVERSE[yr] && NFLVERSE[yr].team) return yr;
  }
  return String(SHARP_SEASON);
}
// Adapt the nflverse team tables for the ACTIVE season into the dict the league view renders
// (adds title/category/pct_cols). Returns {} when there's no nflverse team data for it.
function nflverseSharpTables(){
  const t=(NFLVERSE && NFLVERSE[advTeamSeason()] && NFLVERSE[advTeamSeason()].team) || null;
  if(!t) return {};
  const HIDE_LAST5 = new Set(['Y/PL Last 5','Neutral DB Rate Last 5','Sec/Play Last 5']);
  const META={
    offense:{title:'Offensive Metrics',category:'offense'},
    defense:{title:'Defensive Metrics',category:'defense'},
    tendencies:{title:'Tendencies',category:'offense'},
    offensive_line_pass:{title:'O-Line: Pass Protection',category:'offense'},
    offensive_line_run:{title:'O-Line: Run Blocking',category:'offense'},
    pace:{title:'Pace',category:'offense'},
    personnel:{title:'Personnel',category:'offense'},
    coverage:{title:'Coverage (man/zone)',category:'defense'},
    def_tendencies:{title:'Defensive Tendencies',category:'defense'},
    defensive_line:{title:'Pass Rush & Run D',category:'defense'},
  };
  const PCT=['Explosive Play Rate','Down Conversion Rate','Shotgun Rate','NoHuddle Rate','3WR Rate','Multi TE Rate','Man Rate','Zone Rate',
    'Motion Rate','Play Action Rate','RPO Rate','Screen Rate','Trick Play Rate','Drop Rate','Blitz Rate',
    'Pressure Rate Allowed','Rush Stuff Rate','Pressure Rate','No Blitz Pressure Rate',
    'Hit Rate','Hurry Rate','Sack Rate','Non-QB Sack Rate','Last 5 Sack Rate',
    'Stuff Rate','Explosive Run Rate','Rush 1D Rate','Broken Tackle Rate','8+ Box Rate',
    '11 Personnel','12 Personnel','13 Personnel','21 Personnel','Multi RB Rate','Sub Package Rate','Nickel Rate','Dime+ Rate',
    'Neutral DB Rate','Neutral DB Rate Last 5','Middle Closed Rate','Middle Open Rate','Cover 1','Cover 2','Cover 3'];
  const out={};
  for(const k in t){
    const m=META[k]||{title:k,category:'offense'};
    const cols=(t[k].columns||[]).filter(c=>!HIDE_LAST5.has(c));
    out[k]={columns:cols, title:m.title, category:m.category,
            pct_cols:cols.filter(c=>PCT.includes(c)), teams:t[k].teams};
  }
  return out;
}
// The active source for the league-wide Advanced Stats tables (nflverse-computed).
function activeSharp(){
  return nflverseSharpTables();
}
// League-rank → quartile color class (top 8 = best, bottom 8 = worst).
function sharpRankClass(rank){
  if(rank==null) return '';
  if(rank<=8)  return 'sr-good';    // top quarter
  if(rank<=16) return 'sr-okhi';
  if(rank<=24) return 'sr-oklo';
  return 'sr-bad';                  // bottom quarter
}
function sharpRankBadge(rank){
  if(rank==null) return '';
  return `<span class="sr-badge ${sharpRankClass(rank)}">${ordinal(rank)}</span>`;
}
function fmtSharpVal(v, isPct){
  if(v==null) return '—';
  if(typeof v!=='number') return v;
  let s;
  if(Number.isInteger(v)){
    s = String(v);
  } else {
    // Small-magnitude metrics (e.g. EPA/Play, ~ -0.25..0.25) need 2 decimals — 1 decimal
    // collapses meaningful differences (0.19 → 0.2). Larger stats read fine at 1 decimal.
    const dp = (Math.abs(v) < 1 && !isPct) ? 2 : 1;
    s = v.toFixed(dp);
  }
  return isPct ? s+'%' : s;
}
// Is a column a percentage in the given table? (build_seed flags these in pct_cols.)
function sharpColIsPct(tbl, col){
  return !!(tbl && Array.isArray(tbl.pct_cols) && tbl.pct_cols.includes(col));
}

async function showSharpLeague(target){
  rankScope='all'; currentPhase='AdvancedLeague';
  if(target==='sos'){ sharpTable='__sos__'; sharpSortCol=null; sharpSortDir=1; }
  // Render immediately. Opponent win totals are baked into the seed; when they aren't (older
  // seed), renderSOSView() itself kicks off the schedule fetch in the background and re-renders
  // on arrival — so we never block the SOS view on a network round-trip.
  renderContent();
}
function setSharpTable(key){ sharpTable=key; sharpSortCol=null; renderSharpLeague(); }
function setSharpCategory(cat){
  sharpCategory=cat;
  // Jump to the first table in the newly selected category.
  const SRC=activeSharp();
  const keys=Object.keys(SRC).filter(k=>(SRC[k].category||'offense')===cat);
  if(keys.length){ sharpTable=keys[0]; sharpSortCol=null; }
  renderSharpLeague();
}
function sortSharpBy(col){
  if(sharpSortCol===col){ sharpSortDir*=-1; } else { sharpSortCol=col; sharpSortDir=1; }
  if(typeof tcPreserveViewScroll==='function') tcPreserveViewScroll(()=>renderSharpLeague(), ['.sr-table-wrap']);
  else renderSharpLeague();
}
function renderSharpLeague(){
  const host=document.getElementById('content'); if(!host) return;
  const SRC=activeSharp();
  const hasSharp=sharpHasData(), hasSOS=SOS&&Object.keys(SOS).length>0;
  if(!hasSharp && !hasSOS){
    host.innerHTML=`<div class="empty"><div class="empty-icon">${TC_ICON("chart","tc-ico-lg")}</div><div class="empty-title">No advanced stats loaded</div>
      <div class="empty-body">Run <code>build_seed.py</code> and load the 📦 seed.</div></div>`;
    return;
  }
  const srcLabel = `nflverse (computed)`;
  const leagueWeekRange = (typeof renderAdvLeagueWeekRange==='function') ? renderAdvLeagueWeekRange() : '';
  const headerBar=`
    <div class="team-header sr-league-header">
      <div><div class="team-abbr">${TC_ICON("chart")} Advanced Stats — League-Wide</div>
        <div class="team-qb-name">${srcLabel} · <b>${advTeamSeason()} season</b> · click any column to sort (best→worst)</div></div>
      <div class="team-nav">
        ${currentTeam?`<button class="btn btn-ghost" onclick="showCurrentTeamAdvanced()">← ${teamDisplayName(currentTeam)} card</button>`:''}
        <button class="btn btn-ghost" onclick="setPhase('Rankings')">Rankings</button></div>
    </div>`;

  // The SOS view is its own "table" selection.
  if(sharpTable==='__sos__' && hasSOS){
    host.innerHTML = headerBar + leagueWeekRange + renderCategoryTabs() + renderSOSView();
    return;
  }

  const keys=Object.keys(SRC).filter(k=>(SRC[k].category||'offense')===sharpCategory);
  if(!sharpTable || sharpTable==='__sos__' || !SRC[sharpTable] || (SRC[sharpTable].category||'offense')!==sharpCategory){
    sharpTable = keys[0];
  }
  if(!sharpTable){ // no tables in this category
    host.innerHTML = headerBar + renderCategoryTabs() + `<div class="sr-desc">No tables in this category.</div>`;
    return;
  }
  const baseTbl=SRC[sharpTable];
  const tbl=(typeof _advTableForRange==='function') ? _advTableForRange(sharpTable, baseTbl, '__LEAGUE__') : baseTbl;
  const isProjTable = (sharpTable==='offensive_line_pass' || sharpTable==='offensive_line_run');
  const projWhich = sharpTable==='offensive_line_pass' ? 'pass' : (sharpTable==='offensive_line_run' ? 'run' : null);
  const projSeason = String((typeof PROJ_SEASON!=='undefined' && PROJ_SEASON) ? PROJ_SEASON : new Date().getFullYear());
  const baseSeason = String(advTeamSeason());
  const projCol = `Proj ${projSeason}`;
  const overallLabel = `Overall (${baseSeason})`;
  const showProjCol = isProjTable;
  const baseCols = (tbl.columns||[]).slice();
  let cols = baseCols;
  let colSource = {};
  baseCols.forEach(c=>{ colSource[c]=c; });
  if(showProjCol){
    const rest = baseCols.filter(c=>c!=='Overall Score');
    cols = [projCol, overallLabel, ...rest];
    colSource = {[projCol]:'__proj__', [overallLabel]:'Overall Score'};
    rest.forEach(c=>{ colSource[c]=c; });
  }
  let rows=Object.keys(tbl.teams).map(code=>{
    const base={code, ...tbl.teams[code]};
    if(!showProjCol || !projWhich || typeof projectedOlScore!=='function') return base;
    const p=projectedOlScore(code, projWhich);
    base._projScore=(p && p.score!=null && !Number.isNaN(Number(p.score))) ? Number(p.score) : null;
    base._projRank=(p && p.rank!=null && !Number.isNaN(Number(p.rank))) ? Number(p.rank) : null;
    return base;
  });

  if(!sharpSortCol && showProjCol) sharpSortCol = projCol;
  const sortCol = sharpSortCol || cols[0];
  rows.sort((a,b)=>{
    let ra=null, rb=null;
    if(sortCol===projCol){
      ra=a._projRank; rb=b._projRank;
    }else{
      const srcCol=colSource[sortCol]||sortCol;
      ra=a.ranks?a.ranks[srcCol]:null;
      rb=b.ranks?b.ranks[srcCol]:null;
    }
    if(ra==null && rb==null) return 0;
    if(ra==null) return 1;
    if(rb==null) return -1;
    return (ra-rb)*sharpSortDir;
  });

  const tableTabs = keys.map(k=>`<button class="sr-tab ${k===sharpTable?'active':''}" onclick="setSharpTable('${k}')">${SRC[k].title||k}</button>`).join('');
  const head = `<th class="sr-th-team">TEAM</th>`+cols.map(c=>{
    const active = c===sortCol;
    const arrow = active ? (sharpSortDir>0?' ▲':' ▼') : '';
    const title = c===projCol ? `Projected ${projSeason} OL ${projWhich==='pass'?'pass-protection':'run-blocking'} overall score` : `Sort by ${c}`;
    return `<th class="sr-th ${active?'active':''}" onclick="sortSharpBy('${c.replace(/'/g,"\\'")}')" title="${title}">${c}${arrow}</th>`;
  }).join('');

  const body = rows.map(r=>{
    const cells = cols.map(c=>{
      if(c===projCol){
        const v=r._projScore, rk=r._projRank;
        const txt = v!=null?Number(v).toFixed(1):'—';
        return `<td class="sr-td ${sharpRankClass(rk)}"><span class="sr-td-val">${noteWrapHtml(escHtml(txt), {
          label: c,
          value: txt,
          source: 'league_advanced',
          statKey: sharpTable,
          context: `${teamDisplayName(r.code)} · ${tbl.title} · ${advTeamSeason()} season`,
          team: r.code,
          relevance: noteRelevanceForTableKey(sharpTable),
        }, 'note-tag-hit')}</span><span class="sr-td-rank">${rk!=null?rk:''}</span></td>`;
      }
      const srcCol=colSource[c]||c;
      const v=r.values?r.values[srcCol]:null, rk=r.ranks?r.ranks[srcCol]:null;
      const txt = fmtSharpVal(v, sharpColIsPct(tbl,c));
      return `<td class="sr-td ${sharpRankClass(rk)}"><span class="sr-td-val">${noteWrapHtml(escHtml(txt), {
        label: c,
        value: txt,
        source: 'league_advanced',
        statKey: sharpTable,
        context: `${teamDisplayName(r.code)} · ${tbl.title} · ${advTeamSeason()} season`,
        team: r.code,
        relevance: noteRelevanceForTableKey(sharpTable),
      }, 'note-tag-hit')}</span><span class="sr-td-rank">${rk!=null?rk:''}</span></td>`;
    }).join('');
    return `<tr><td class="sr-td-team"><span class="sr-td-team-inner"><img src="${NFL_LOGO(r.code)}" class="sr-logo" onerror="this.style.display='none'">${r.code}</span></td>${cells}</tr>`;
  }).join('');
  host.innerHTML = headerBar + leagueWeekRange + renderCategoryTabs() + `
    <div class="sr-league-tabs">${tableTabs}</div>
    <div class="sr-desc">${tbl.title} · <b>${advTeamSeason()} season</b> — all 32 teams. Cell shows the stat value with its league rank; color = quartile (green best → red worst).</div>
    <div class="card sr-table-wrap" style="padding:0;overflow-x:auto">
      <table class="sr-league-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
    <div class="sr-source">Computed from nflverse play-by-play (nflfastR).</div>`;
}

// Offense / Defense / SOS category selector row for the league-wide view.
function renderCategoryTabs(){
  const SRC=activeSharp();
  const hasOff=Object.keys(SRC).some(k=>(SRC[k].category||'offense')==='offense');
  const hasDef=Object.keys(SRC).some(k=>SRC[k].category==='defense');
  const hasSOS=SOS&&Object.keys(SOS).length>0;
  const isSOS = sharpTable==='__sos__';
  const btn=(cat,label,active,onclick)=>`<button class="sr-cat ${active?'active':''}" onclick="${onclick}">${label}</button>`;
  let out='<div class="sr-cat-row">';
  if(hasOff) out+=btn('offense','Offense', !isSOS && sharpCategory==='offense', "setSharpCategory('offense')");
  if(hasDef) out+=btn('defense','Defense', !isSOS && sharpCategory==='defense', "setSharpCategory('defense')");
  if(hasSOS) out+=btn('sos','Strength of Schedule', isSOS, "showSharpLeague('sos')");
  out+='</div>';
  return out;
}

// The Strength-of-Schedule view: a recreation of Sharp's descending-diagonal chart
// (easiest at top-left → hardest at bottom-right, split by the league-average line),
// plus the full sortable table beneath it.
function renderSOSView(){
  const entries=Object.keys(SOS).map(code=>({code, ...SOS[code]})).filter(e=>e.rank!=null||SOS[code].opp_win_total!=null);
  const n=entries.length||32;

  // Opponent win-total sum drives OUR ranking. Prefer the value baked into the seed; only when it
  // is absent (older seed) do we fetch each team's schedule live and sum it in the browser.
  const baked = entries.length>0 && entries.every(e=>e.opp_win_total!=null);
  if(!baked && !_sosSchedLoading && !_sosSchedLoaded){
    _sosSchedLoading=true;
    Promise.all(entries.map(e=>fetchTeamSchedule(e.code))).then(()=>{
      _sosSchedLoaded=true; _sosSchedLoading=false;
      if(currentPhase==='AdvancedLeague' && sharpTable==='sos') renderContent();
    }).catch(()=>{ _sosSchedLoading=false; });
  }

  // Attach each team's summed-opponent-win-total (baked, else live).
  let haveOppData=false, minT=Infinity, maxT=-Infinity;
  entries.forEach(e=>{
    if(e.opp_win_total!=null){ e.oppTotal=e.opp_win_total; e.oppGames=e.opp_games||17; }
    else { const o=opponentWinTotal(e.code); e.oppTotal=o?o.total:null; e.oppGames=o?o.games:0; }
    if(e.oppTotal!=null){ haveOppData=true; if(e.oppTotal<minT)minT=e.oppTotal; if(e.oppTotal>maxT)maxT=e.oppTotal; }
  });
  // OUR ranking: sort by summed opponent win total ascending (1 = easiest slate). Overrides any
  // scraped rank once every team has an opponent total; until then the existing order stands.
  if(entries.every(e=>e.oppTotal!=null)){
    entries.slice().sort((a,b)=>a.oppTotal-b.oppTotal).forEach((e,i)=>{ e.rank=i+1; });
  }
  entries.sort((a,b)=>a.rank-b.rank);

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
    return `<image href="${NFL_LOGO(e.code)}" x="${cx-13}" y="${cy-13}" width="26" height="26"
        class="sr-sos-dot" onclick="tcGotoTeamProjections('${e.code}')">
      <title>${e.name||e.code} — SOS ${ordinal(e.rank)}, Vegas win total ${e.win_total}${oppNote} · tap for their projections</title></image>
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
    else if(sortCol==='opp'){ av=a.oppTotal; bv=b.oppTotal; }
    else { av=a.rank; bv=b.rank; }
    if(av==null&&bv==null)return 0; if(av==null)return 1; if(bv==null)return -1;
    return (av-bv)*sortDir;
  });
  const th=(col,label)=>{
    const active=sortCol===col; const arrow=active?(sortDir>0?' ▲':' ▼'):'';
    return `<th class="sr-th ${active?'active':''}" onclick="sortSOSBy('${col}')">${label}${arrow}</th>`;
  };
  const body=rows.map(e=>`<tr>
    <td class="sr-td-team"><span class="sr-td-team-inner sr-team-jump" onclick="tcGotoTeamProjections('${e.code}')" title="Open ${teamDisplayName(e.code)}'s projections"><img src="${NFL_LOGO(e.code)}" class="sr-logo" onerror="this.style.display='none'">${teamDisplayName(e.code)}</span></td>
    <td class="sr-td ${sharpRankClass(e.rank)}"><span class="sr-td-val">${ordinal(e.rank)}</span></td>
    <td class="sr-td"><span class="sr-td-val">${e.oppTotal!=null?e.oppTotal.toFixed(1):'—'}</span></td>
    <td class="sr-td"><span class="sr-td-val">${e.win_total!=null?e.win_total:'—'}</span></td>
  </tr>`).join('');
  return `<div class="sr-desc">${PROJ_SEASON} strength of schedule — our own ranking by the <b>sum of each team's opponents' Vegas win totals</b>. Rank 1 = easiest slate, ${n} = hardest.</div>
    <div class="card sos-card">${chart}</div>
    <div class="card sr-table-wrap" style="padding:0;overflow-x:auto;margin-top:12px">
      <table class="sr-league-table sos-table"><thead><tr>
        <th class="sr-th-team">TEAM</th>${th('rank',PROJ_SEASON+' SOS RANK')}${th('opp','OPP WIN TOTAL')}${th('win_total','VEGAS WIN TOTAL')}
      </tr></thead><tbody>${body}</tbody></table>
    </div>
    <div class="sr-source">Rank = sum of opponents' ${PROJ_SEASON} Vegas win totals · schedule via nflverse — for informational use.</div>`;
}
function sortSOSBy(col){
  if(sharpSortCol===col){ sharpSortDir*=-1; } else { sharpSortCol=col; sharpSortDir=1; }
  if(typeof tcPreserveViewScroll==='function') tcPreserveViewScroll(()=>renderSharpLeague(), ['.sr-table-wrap']);
  else renderSharpLeague();
}



// ─────────────────────────────────────────────────────────────────────────────
// Per-team schedule strip (Advanced tab → SOS block)
// Week-by-week opponents with their Vegas win totals, colored by difficulty. Collapsed it
// is a single rail of logos; tapping the block expands it into a bar chart (bar height =
// the opponent's win total), the same read Warren Sharp's SOS graphic gives.
// Schedule comes from the runtime nflverse games.csv map that already backs the slider
// opponent rails; win totals come from SOS[code].win_total.
// ─────────────────────────────────────────────────────────────────────────────
let _sosStripOpen = false;
var _sosStripSchedTried = false;
function toggleSosStrip(){
  _sosStripOpen = !_sosStripOpen;
  if(typeof renderContent==='function') renderContent();
}
// Jump straight to a team's projections page from any logo in the app.
function tcGotoTeamProjections(code){
  const t=String(code||'').toUpperCase();
  if(!t || typeof selectTeam!=='function') return;
  try{
    if(typeof currentPhase!=='undefined' && currentPhase==='League' && typeof leaveLeagueAnalyzer==='function') leaveLeagueAnalyzer();
    // League-wide views aren't team-scoped, so land on the team's main projections tab.
    if(typeof currentPhase!=='undefined' && (currentPhase==='AdvancedLeague'||currentPhase==='League'||
       (currentPhase==='Rankings' && typeof rankScope!=='undefined' && rankScope==='all'))) currentPhase='Receiving';
    selectTeam(t);
  }catch(e){}
}
// Difficulty bucket for an opponent's win total (Vegas). Mirrors the Sharp read:
// sub-7-win opponents are green, 9.5+ are red, the middle is neutral.
function sosDiffCls(wt){
  if(wt==null || !Number.isFinite(+wt)) return 'sos-na';
  const v=+wt;
  if(v < 7) return 'sos-easy';
  if(v >= 9.5) return 'sos-hard';
  return 'sos-mid';
}
function renderTeamScheduleStrip(team){
  const tm=String(team||'').toUpperCase();
  const season=String(PROJ_SEASON);
  const byWeek=(typeof weekOpponentMap==='function') ? weekOpponentMap(tm, season) : null;
  if(!byWeek){
    // Not fetched yet — kick the shared schedule load once and repaint when it lands.
    if(!_sosStripSchedTried && typeof ensureWeeklyOppSchedule==='function'){
      _sosStripSchedTried = true;
      ensureWeeklyOppSchedule(season).then(ok=>{
        if(ok && typeof renderContent==='function' && currentPhase==='Advanced') renderContent();
        if(!ok) _sosStripSchedTried = false;   // transient failure — allow a later retry
      }).catch(()=>{ _sosStripSchedTried = false; });
    }
    return '';
  }
  const wt=(code)=>{ const s=(typeof SOS!=='undefined' && SOS) ? SOS[code] : null; return (s && s.win_total!=null) ? +s.win_total : null; };
  const WEEKS=18;
  const cells=[];
  for(let w=1; w<=WEEKS; w++){
    const g=byWeek[w] || byWeek[String(w)];
    if(!g || !g.opp){ cells.push({w, bye:true}); continue; }
    const opp=String(g.opp).toUpperCase();
    cells.push({w, opp, home:!!g.home, wt:wt(opp), cls:sosDiffCls(wt(opp))});
  }
  const played=cells.filter(c=>!c.bye && c.wt!=null);
  if(!played.length) return '';
  // Bar geometry: a fixed 3–13 win domain keeps every team's chart directly comparable.
  const LO=3, HI=13;
  const pct=(v)=> Math.max(4, Math.min(100, ((v-LO)/(HI-LO))*100));
  const logo=(c)=>`<img src="${NFL_LOGO(c.opp)}" class="sos-wk-logo" alt="${c.opp}" loading="lazy" decoding="async" onerror="this.style.display='none'">`;
  const railCell=(c)=> c.bye
    ? `<div class="sos-wk sos-wk-bye" title="Week ${c.w} — bye"><span class="sos-wk-num">${c.w}</span><span class="sos-wk-bye-lbl">BYE</span></div>`
    : `<div class="sos-wk ${c.cls}" title="Week ${c.w} · ${c.home?'vs':'@'} ${c.opp}${c.wt!=null?` · Vegas win total ${c.wt}`:''} — tap for ${c.opp}'s projections"
         onclick="event.stopPropagation();tcGotoTeamProjections('${c.opp}')">
        <span class="sos-wk-num">${c.w}</span>${logo(c)}
        <span class="sos-wk-ha">${c.home?'vs':'@'}</span>
        <span class="sos-wk-wt">${c.wt!=null?c.wt:'—'}</span></div>`;
  const barCell=(c)=> c.bye
    ? `<div class="sos-bar-col sos-bar-bye"><div class="sos-bar-slot"></div><span class="sos-bar-lbl">BYE</span><span class="sos-bar-wk">${c.w}</span></div>`
    : `<div class="sos-bar-col" title="Week ${c.w} · ${c.home?'vs':'@'} ${c.opp}${c.wt!=null?` · ${c.wt} projected wins`:''} — tap for ${c.opp}'s projections"
         onclick="event.stopPropagation();tcGotoTeamProjections('${c.opp}')">
        <div class="sos-bar-slot">
          ${c.wt!=null?`<div class="sos-bar ${c.cls}" style="height:${pct(c.wt).toFixed(1)}%"><span class="sos-bar-val">${c.wt}</span></div>`:''}
          <div class="sos-bar-top">${logo(c)}<span class="sos-bar-ha">${c.home?'H':'A'}</span></div>
        </div>
        <span class="sos-bar-wk">${c.w}</span></div>`;
  const avg=(played.reduce((s,c)=>s+c.wt,0)/played.length);
  return `<div class="sos-sched ${_sosStripOpen?'open':''}">
    ${_sosStripOpen ? '' : `<div class="sos-sched-rail">${cells.map(railCell).join('')}</div>`}
    ${_sosStripOpen ? `<div class="sos-sched-chart">
      <div class="sos-bar-grid">${cells.map(barCell).join('')}</div>
      <div class="sos-sched-legend">
        <span class="sos-key sos-easy"></span> under 7 wins
        <span class="sos-key sos-mid"></span> 7–9.5
        <span class="sos-key sos-hard"></span> 9.5+
        <span class="sos-sched-avg">opponent average <b>${avg.toFixed(1)}</b> projected wins</span>
      </div></div>` : ''}
  </div>`;
}
