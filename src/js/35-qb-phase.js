// ─────────────────────────────────────────────────────────────────────────────
// Passing Phase
// ─────────────────────────────────────────────────────────────────────────────
function renderPassing(team,state){
  if(!state.qbs||!state.qbs.length){
    return `<div class="card"><div class="card-title">Passing Attack</div>
      <div class="alert alert-warn"><span class="alert-icon">⚠️</span>
      <div>No projected QB found for ${team} in this dataset. This can happen with historical
      seasons or sparse projections. Switch seasons or pull live ${PROJ_SEASON} projections.</div></div></div>`;
  }
  // Historical week-window active? Render a filtered QB view (totals + gp) without touching the
  // underlying projection state. This lets hurt/partial-season QB stretches be explored like the
  // WR/RB/TE tabs while keeping the working set intact.
  const qbs = (activeSeason!=='proj' && isWeekFilterActive(state) && state.weekFilterQBData)
    ? state.qbs.map(q=>{
        const f=q.player_id && state.weekFilterQBData[q.player_id];
        // Important: a QB can legitimately have ZERO games in the filtered window (injury / bye /
        // benching). In that case we must show a zeroed filtered slice, not fall back to the full-
        // season line, or the UI falsely claims he played his season-long total during the stretch.
        if(!f) return q;
        return Object.assign({}, q, {
          passing_yards:f.pass_yards, passing_tds:f.pass_td, passing_attempts:f.pass_att,
          passing_completions:f.comp, interceptions_thrown:f.pass_int,
          qb_rush_yards:f.rush_yards, qb_rush_tds:f.rush_td, qb_rush_attempts:f.rush_att,
          games_played:(f.games_played||0), games:(f.games_played||0), base_games:(f.games_played||1),
        });
      })
    : state.qbs;
  const isMulti=qbs.length>1;
  const idx=Math.min(state.activeQB||0, qbs.length-1);
  const qb=qbs[idx];
  const seed=getBase(team,'QB').find(q=>q.name===qb.name)||getBase(team,'QB')[0]||{};
  const compPct=qb.passing_attempts>0?(qb.passing_completions/qb.passing_attempts*100).toFixed(1):'0';
  const ypa=qb.passing_attempts>0?(qb.passing_yards/qb.passing_attempts).toFixed(2):'-';
  const teamGames=qbs.reduce((s,q)=>s+(q.games||0),0);
  const overBudget = teamGames > SEASON_GAMES + 0.5;
  const weekSlider=weekRangeSliderHTML(team,state);
  // Workload card: per-QB Games (0–17) slider. Drives pace extrapolation. A QB at 0
  // games contributes nothing to team totals but keeps his per-game pace for later.
  const workloadCard = `
    <div class="card">
      <div class="card-title">QB Workload ${isMulti?'<span class="split-badge">SPLIT SQUAD</span>':''}</div>
      ${qbs.map((q,i)=>{
        const gms=Math.round(q.games||0);
        const active = i===idx;
        return `<div class="snap-row" style="${active?'border:1px solid var(--qb)':''}">
          <span class="clickable-player" onclick="${pcardOnclick(q.player_id||q.name,'QB',currentTeam||'')}">${imgTag(hsURL(q),'player-headshot')}</span>
          <div class="snap-info" style="flex:1">
            <div style="font-size:12px;font-weight:700"><span class="clickable-player" onclick="${pcardOnclick(q.player_id||q.name,'QB',currentTeam||'')}">${q.name}</span>${weekFilterPaceButton(state,q.player_id,'qb')}
              ${q.games_played?`<span style="font-size:9px;color:var(--muted);font-weight:500">· actually played ${Math.round(q.games_played)}</span>`:''}</div>
            <div style="font-size:10px;color:var(--muted)" id="wl-sub-${i}">${gms} games · ${perGame(q,'passing_yards').toFixed(1)} pass yds/gm</div>
          </div>
          ${!active?`<button class="btn btn-ghost btn-sm" onclick="setActiveQB(${i})">edit</button>`:''}
          ${activeSeason!=='proj'&&q.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${q.player_id}','QB')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
        </div>
        ${sRow('games_'+i,'Games Played',gms,Math.round(q.games_played||q.games||0),0,SEASON_GAMES,1,'var(--qb)')}`;
      }).join('')}
      <div class="derived-note" id="qbWorkloadNote" style="${overBudget?'color:var(--warn)':''}">
        Team QB-games: ${teamGames.toFixed(0)} of ${SEASON_GAMES}${overBudget?' ⚠️ over a full season — combined QB workload exceeds 17 games':''}
      </div>
    </div>`;
  const games=Math.round(qb.games||0);
  return `${weekSlider}${workloadCard}<div class="card">
    <div class="card-title">${qb.name} — Passing ${isMulti?`<span style="font-size:9px;color:var(--muted)">(editing QB${idx+1} of ${state.qbs.length})</span>`:''}</div>
    ${isMulti?`<div class="qb-tab-bar">${state.qbs.map((q,i)=>
      `<button class="qb-tab ${i===idx?'active':''}" onclick="setActiveQB(${i})">${q.name.split(' ').pop()}</button>`).join('')}</div>`:''}
    <div class="player-row"><span class="clickable-player" onclick="${pcardOnclick(qb.player_id||qb.name,'QB',currentTeam||'')}">${imgTag(hsURL(qb),'player-headshot')}</span>
      <span class="pos-badge pos-QB">QB${idx+1}</span>
      <div class="player-name-block"><div class="player-name clickable-player" onclick="${pcardOnclick(qb.player_id||qb.name,'QB',currentTeam||'')}">${qb.name}</div>
        ${weekFilterPaceButton(state,qb.player_id,'qb')}
        <div class="player-sub">${(()=>{const e=ecrEntry({name:qb.name});return e&&e.rank_ecr!=null?`ECR ${e.rank_ecr}`:'';})()}${(()=>{const e=ecrEntry({name:qb.name});return e&&e.rank_ecr!=null?' · ':'';})()}<span id="qb-games-sub">${games}</span> games projected</div></div></div>
    <div class="alert alert-info" style="margin-bottom:11px"><span class="alert-icon">📈</span>
      <div>These are this QB's totals across <b>${games} games</b>. Adjust <b>Games Played</b> above to extrapolate a full-season pace (e.g. an 8-game stint scaled to 17), and the stats below scale with it.</div></div>
    ${sRow('py','Passing Yards',Math.round(qb.passing_yards),Math.round(seed.passing_yards||4000),0,7500,50)}
    ${sRow('ptd','Passing TDs',Math.round(qb.passing_tds),Math.round(seed.passing_tds||25),0,65,1)}
    ${sRow('patt','Pass Attempts',Math.round(qb.passing_attempts),Math.round(seed.passing_attempts||560),0,800,5)}
    ${sRow('pcomp','Completions',Math.round(qb.passing_completions),Math.round(seed.passing_completions||360),0,680,5)}
    ${sRow('int','Interceptions',Math.round(qb.interceptions_thrown),Math.round(seed.interceptions_thrown||10),0,40,1,'var(--danger)',true)}
    <div class="derived-note" id="qbDerived">Comp%: ${compPct}% · YPA: ${ypa} · Yds/TD: ${qb.passing_tds>0?Math.round(qb.passing_yards/qb.passing_tds):'-'} · per game: ${perGame(qb,'passing_yards').toFixed(1)} yds</div>
    <div style="margin-top:13px;padding-top:11px;border-top:1px solid var(--border)">
      <div class="card-title">QB Rushing</div>
      ${sRow('qbry','Rush Yards',Math.round(qb.qb_rush_yards),Math.round(seed.rushing_yards||0),0,1400,10,'var(--rb)')}
      ${sRow('qbrtd','Rush TDs',Math.round(qb.qb_rush_tds),Math.round(seed.rushing_tds||0),0,22,1,'var(--rb)')}
      ${sRow('qbratt','Rush Attempts',Math.round(qb.qb_rush_attempts),Math.round(seed.rushing_attempts||0),0,200,5,'var(--rb)')}
    </div>
    ${isMulti?`<div class="derived-note" id="qbTeamTotals" style="margin-top:10px">${qbTotalsText(state)}</div>`:''}
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-box-label">Pass Yds</div><div class="stat-box-val" style="color:var(--qb)" id="sb-py">${Math.round(qb.passing_yards).toLocaleString()}</div></div>
      <div class="stat-box"><div class="stat-box-label">Pass TDs</div><div class="stat-box-val" style="color:var(--qb)" id="sb-ptd">${Math.round(qb.passing_tds)}</div></div>
      <div class="stat-box"><div class="stat-box-label">INTs</div><div class="stat-box-val" style="color:var(--danger)" id="sb-int">${Math.round(qb.interceptions_thrown)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Rush Yds</div><div class="stat-box-val" style="color:var(--rb)" id="sb-ry">${Math.round(qb.qb_rush_yards)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Rush TDs</div><div class="stat-box-val" style="color:var(--rb)" id="sb-rtd">${Math.round(qb.qb_rush_tds)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Attempts</div><div class="stat-box-val" id="sb-att">${Math.round(qb.passing_attempts)}</div></div>
    </div></div>`;
}
function qbTotalsText(state){
  const qbs = state.qbs.filter(q=> (q.games||0) > 0);
  const y=qbs.reduce((s,q)=>s+q.passing_yards,0);
  const t=qbs.reduce((s,q)=>s+q.passing_tds,0);
  const a=qbs.reduce((s,q)=>s+q.passing_attempts,0);
  const i=qbs.reduce((s,q)=>s+q.interceptions_thrown,0);
  return `All QBs combined: ${Math.round(y).toLocaleString()} yds · ${Math.round(t)} TDs · ${Math.round(a)} att · ${Math.round(i)} INTs`;
}
function setActiveQB(idx){userProj[currentTeam].activeQB=idx;saveSession();renderContent();}

