// ─────────────────────────────────────────────────────────────────────────────
// Receiving Phase
// ─────────────────────────────────────────────────────────────────────────────
function teamPassAtt(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return state.weekFilterQBPool.pass_att;
  return state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+q.passing_attempts,0);
}
function teamPassTDs(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return state.weekFilterQBPool.pass_tds;
  return state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+q.passing_tds,0);
}

// The team's target pool. Anchored to the ACTUAL sum of receiver targets in the data
// (so historical seasons and untouched projections reproduce real numbers exactly).
// When the user changes QB pass attempts in projection mode, the pool scales from its
// baseline so receiver volume still cascades. Falls back to teamPassAtt×TARGET_RATE.
function teamTargetPool(state){
  const baseTargets = state.team_targets;
  if(!baseTargets){ return Math.round(teamPassAtt(state)*TARGET_RATE); }
  // baseline QB attempts captured the first time shares were built
  if(state.base_pass_att==null){ state.base_pass_att = teamPassAtt(state); }
  const curAtt = teamPassAtt(state);
  if(state.base_pass_att>0 && curAtt>0){
    return Math.round(baseTargets * (curAtt/state.base_pass_att));
  }
  return Math.round(baseTargets);
}

function renderReceiving(team,state){
  const totalTgts=teamTargetPool(state);
  const totalTDs=teamPassTDs(state);
  const subTabs=`<div class="sub-tabs">
    <button class="sub-tab ${passingSubTab==='targets'?'active':''}" onclick="setPassSub('targets')">Targets</button>
    <button class="sub-tab ${passingSubTab==='rec'?'active':''}" onclick="setPassSub('rec')">Receptions</button>
    <button class="sub-tab ${passingSubTab==='recyds'?'active':''}" onclick="setPassSub('recyds')">Receiving Yards</button>
    <button class="sub-tab ${passingSubTab==='rec_tds'?'active':''}" onclick="setPassSub('rec_tds')">TD Share</button></div>`;
  const weekSlider=weekRangeSliderHTML(team,state);
  const body = passingSubTab==='targets' ? renderPassTargets(team,state,totalTgts,totalTDs,subTabs)
    : passingSubTab==='rec' ? renderPassDerived(team,state,subTabs,'rec')
    : passingSubTab==='recyds' ? renderPassDerived(team,state,subTabs,'recyds')
    : renderPassTDs(team,state,totalTDs,subTabs);
  return weekSlider + body;
}
// Dual-handle week-range slider, shown only in reference mode. Lets the user filter the
// Targets/Rushing tabs down to a stretch of weeks (e.g. a player's hot streak before injury).
function weekRangeSliderHTML(team,state){
  if(activeSeason==='proj') return '';
  const shared = (typeof getSharedWeekRange==='function') ? getSharedWeekRange(team, activeSeason) : (state.weekFilter||[1,18]);
  const [lo,hi]=shared;
  state.weekFilter=[lo,hi];
  const active=isWeekFilterActive(state);
  // The shared range outlives the per-state filtered data: switching 2025 → 2024 → 2025
  // rebuilds the reference state, so the slider said "weeks 3–10 · Reset" over full-season
  // numbers. If the range is narrowed but this state has no filtered data, re-apply it.
  if(active && !state.weekFilterData && !state.weekFilterLoading && typeof applyWeekRange==='function'){
    state.weekFilterLoading=true;   // mark before the async kick so this render shows "loading…"
    setTimeout(()=>{ try{ applyWeekRange(team, lo, hi); }catch(e){} }, 0);
  }
  const loPct=(lo-1)/17*100, hiPct=(18-hi)/17*100;
  const oppRail = (typeof renderWeekOpponentRail==='function')
    ? renderWeekOpponentRail(team, activeSeason, 'wr-opp-main')
    : '';
  return `<div class="week-range-card">
    <div class="week-range-label">
      <span>${TC_ICON("calendar")} Filter weeks: <b id="wr-lo-${team}">${lo}</b> – <b id="wr-hi-${team}">${hi}</b>${state.weekFilterLoading?' <span class="week-range-loading">loading…</span>':''}</span>
      ${active?`<span class="week-range-reset" onclick="resetWeekRange('${team}')">↺ Reset to full season</span>`:'<span class="week-range-hint">drag either end to zoom into a stretch of games</span>'}
    </div>
    <div class="dual-slider">
      <div class="dual-slider-track"></div>
      <div class="dual-slider-fill" id="wr-fill-${team}" style="left:${loPct}%;right:${hiPct}%"></div>
      <input type="range" min="1" max="18" step="1" value="${lo}" class="dual-range dual-range-lo"
        oninput="weekRangeDrag('${team}','lo',this.value)" onchange="weekRangeCommit('${team}')">
      <input type="range" min="1" max="18" step="1" value="${hi}" class="dual-range dual-range-hi"
        oninput="weekRangeDrag('${team}','hi',this.value)" onchange="weekRangeCommit('${team}')">
      ${oppRail}
    </div>
  </div>`;
}
function setPassSub(t){passingSubTab=t;renderContent();}

// Total receiving yardage available = the QBs' combined passing yards (identity: team
// passing yards == team receiving yards). Used as the rec-yards pool/denominator.
function teamRecYardsPool(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool) return Math.round(state.weekFilterQBPool.pass_yards);
  return Math.round(state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+(q.passing_yards||0),0));
}
// Total receptions available = the QBs' combined completions (identity: completions ==
// receptions at the team level). This is what the receivers' catches should sum to.
function teamRecPool(state){
  if(isWeekFilterActive(state) && state.weekFilterQBPool && state.weekFilterQBPool.comp>0) return Math.round(state.weekFilterQBPool.comp);
  const comp=state.qbs.filter(q=> (q.games||0) > 0).reduce((s,q)=>s+(q.passing_completions||0),0);
  if(comp>0) return Math.round(comp);
  // fall back to targets × league-avg catch rate if completions aren't populated
  return Math.round((state.passing_shares||[]).reduce((s,p)=>{
    const tgts=p.share*teamTargetPool(state); return s+tgts*(p.catch_rate||0.65);
  },0));
}

// Compute production "vacated" by players who were on the team last season but are no
// longer on the current roster (free agency, retirement, trade). Helps see how much
// target/reception/yard/TD volume needs to be absorbed by the remaining roster.
function vacatedProduction(team){
  if(activeSeason!=='proj') return null;       // only meaningful for the upcoming season
  const lastYear = (HISTORY_SEASONS&&HISTORY_SEASONS.length)?HISTORY_SEASONS[0]:String(PROJ_SEASON-1);
  // Build last year's roster for this team. Prefer embedded HISTORY; if that's empty
  // (e.g. running off a live Sleeper pull with no prebuilt seed), fetch it in the
  // background and re-render when it lands so the note appears without a prebuilt seed.
  if(!seasonStatsCache[lastYear]){
    if(HISTORY && Object.keys(HISTORY).length){
      const built=buildSeedFromHistory(lastYear); if(built) seasonStatsCache[lastYear]=built;
    } else {
      ensureSeasonStats(lastYear);   // async; re-renders on arrival
    }
  }
  const prev=seasonStatsCache[lastYear] && seasonStatsCache[lastYear][team];
  if(!prev) return null;
  // Build the set of player_ids CURRENTLY on this team. Use the full Sleeper player DB
  // (not just projected players) so someone still rostered but projected for 0 stats
  // (e.g. Charlie Jones) is NOT counted as vacated.
  const curIds=new Set();
  const ps=projSeed||seasonStatsCache['proj']||{};
  ['QB','RB','WR','TE'].forEach(pos=>(ps[team]&&ps[team][pos]||[]).forEach(p=>p.player_id&&curIds.add(p.player_id)));
  if(sleeperPlayers){
    for(const pid in sleeperPlayers){ if(sleeperPlayers[pid].team===team) curIds.add(pid); }
  }
  let tgt=0,rec=0,yds=0,td=0; const gone=[];
  ['WR','TE','RB'].forEach(pos=>(prev[pos]||[]).forEach(p=>{
    if(p.player_id && !curIds.has(p.player_id) && (p.receiving_targets>0||p.receptions>0)){
      tgt+=p.receiving_targets||0; rec+=p.receptions||0; yds+=p.receiving_yards||0; td+=p.receiving_tds||0;
      gone.push({name:p.name, tgt:p.receiving_targets||0});
    }
  }));
  if(!gone.length) return null;
  // most-targeted (most impactful) players first
  gone.sort((a,b)=>b.tgt-a.tgt);
  return {season:lastYear, tgt:Math.round(tgt), rec:Math.round(rec), yds:Math.round(yds), td:Math.round(td), players:gone.map(g=>g.name)};
}
function vacatedOrdinal(n){
  const v=Math.max(1, parseInt(n,10)||1);
  const mod100=v%100;
  if(mod100>=11 && mod100<=13) return `${v}th`;
  const mod10=v%10;
  if(mod10===1) return `${v}st`;
  if(mod10===2) return `${v}nd`;
  if(mod10===3) return `${v}rd`;
  return `${v}th`;
}
function vacatedTargetsLeagueRank(team){
  if(activeSeason!=='proj') return null;
  const tms=(typeof TEAMS!=='undefined' && Array.isArray(TEAMS) && TEAMS.length)
    ? TEAMS
    : ['CIN','PIT','BAL','CLE','HOU','JAX','TEN','IND','BUF','NE','MIA','NYJ','KC','LAC','LV','DEN','GB','DET','MIN','CHI','TB','CAR','ATL','NO','PHI','DAL','WAS','NYG','LAR','SF','SEA','ARI'];
  const rows=tms.map(tm=>({team:tm, v:vacatedProduction(tm)})).filter(x=>x.v && x.v.tgt>0);
  if(!rows.length) return null;
  rows.sort((a,b)=>((b.v.tgt||0)-(a.v.tgt||0)) || a.team.localeCompare(b.team));
  const idx=rows.findIndex(x=>x.team===team);
  if(idx<0) return null;
  return {rank:idx+1,total:rows.length};
}
function vacatedNote(team){
  const v=vacatedProduction(team);
  if(!v) return '';
  const noteTeam=String(team||currentTeam||'').toUpperCase();
  const ctx=activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} vacated production`
    : historicalTagContext(`${activeSeason} vacated production`, noteTeam, activeSeason);
  const rk=vacatedTargetsLeagueRank(noteTeam);
  const rankText=rk?`${vacatedOrdinal(rk.rank)} most vacated targets in ${PROJ_SEASON}`:'';
  const tagValue=`${v.tgt} targets · ${v.rec} rec · ${v.yds.toLocaleString()} yds · ${v.td} TD${rankText?` · ${rankText}`:''}`;
  const rankLead=rk?`${vacatedOrdinal(rk.rank)}`:'Rank N/A';
  const lineHtml=`<b>${escHtml(rankLead)}: Vacated Targets from ${v.season}:</b> ${escHtml(`${v.tgt} targets · ${v.rec} rec · ${v.yds.toLocaleString()} yds · ${v.td} TD`)}`;
  const names = escHtml(v.players.length>3 ? v.players.slice(0,3).join(', ')+` +${v.players.length-3} more` : v.players.join(', '));
  return `<div class="vacated-note">
    <span class="vacated-icon">${TC_ICON("export")}</span>
    <div> ${noteWrapHtml(lineHtml, { label:'Vacated Targets', value:tagValue, source:'projection_builder_vacated', statKey:'vacated_targets', context:ctx, team:noteTeam, relevance:'WR,TE,RB' }, 'note-tag-hit')}
    <span style="color:var(--muted)"> — left by ${names}.</span>
    <span style="color:var(--muted)">This production is up for grabs among the current roster.</span></div></div>`;
}

// Receptions / Receiving-Yards share view — editable, mirrors the target-share tab.
// Colors are keyed to each player's ORIGINAL index (PCOLORS[i]) so the pie slices and
// the rows always line up. Each player has a rec_share / recyds_share that rebalances the
// others exactly like target share. A discrepancy banner flags when the receivers' summed
// production doesn't match what the QBs are projected to throw for, with a one-click fix.
function renderPassDerived(team,state,subTabs,metric){
  const lockStats = activeSeason!=='proj';
  ensureDerivedShares(state,metric);
  const totalTgts=teamTargetPool(state);
  const isYds = metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const key=isYds?'recyds':'rec';
  const label=isYds?'rec yds':'rec';
  const qbPool = isYds ? teamRecYardsPool(state) : teamRecPool(state);
  const receiverSum = state.passing_shares.reduce((s,p)=>{
    const tg=p.share*totalTgts; return s + (isYds ? tg*(p.ypt||9) : tg*(p.catch_rate||0.65));
  },0);
  const diff = Math.round(qbPool - receiverSum);
  const order=state.passing_shares.map((p,i)=>i).sort((a,b)=>(state.passing_shares[b][field]||0)-(state.passing_shares[a][field]||0));
  const rows=order.map(i=>{
    const p=state.passing_shares[i]; const col=PCOLORS[i%PCOLORS.length];
    const nameAttr = escAttr(p.name);
    const nameText = escHtml(p.name);
    const noteTeam=String((p&&p.team)||team||currentTeam||'').toUpperCase();
    const notePlayer=noteTargetFromArgs((p&&((p.player_id)||p.name))||'', (p&&p.pos)||'', noteTeam);
    const noteCtx=activeSeason==='proj'
      ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} receiving shares`
      : historicalTagContext(`${activeSeason} receiving shares`, noteTeam, activeSeason);
    const tagVal=(display,labelTxt,statKey)=>noteWrapHtml(`<span class="share-stat-val">${escHtml(String(display))}</span>`, {
      label:labelTxt, value:String(display), source:'projection_builder_receiving', statKey,
      context:noteCtx, player:notePlayer, team:noteTeam, relevance:'WR,TE,RB'
    }, 'note-tag-hit');
    const sh=p[field]||0; const pct=(sh*100).toFixed(1);
    const sharePct = tagVal(`${pct}%`, isYds?'Receiving Yard Share':'Reception Share', isYds?'receiving_yard_share_pct':'reception_share_pct');
    const v=Math.round(sh*qbPool);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    const tdVal=(p.td_share*teamPassTDs(state)).toFixed(1);
    const tgtsCell = lockStats
      ? tagVal(projTgts,'Targets','receiving_targets')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editTargets(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-tgt-${i}">${projTgts}</span>`;
    const recCell = lockStats
      ? tagVal(projRec,'Receptions','receptions')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRec(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-rec-${i}">${projRec}</span>`;
    const ydsCell = lockStats
      ? tagVal(projYds,'Receiving Yards','receiving_yards')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRecYds(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="yd-${i}">${projYds}</span>`;
    const catchCell = lockStats
      ? tagVal((p.catch_rate*100).toFixed(0)+'%','Catch Percentage','catch_rate_pct')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editCatchPct(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="cr-${i}">${(p.catch_rate*100).toFixed(0)}</span>%`;
    const yptCell = lockStats
      ? tagVal((p.ypt||9).toFixed(1),'Yards Per Target','yards_per_target')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editYpt(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ypt-${i}">${(p.ypt||9).toFixed(1)}</span>`;
    const tdCell = lockStats
      ? tagVal(tdVal,'Receiving TDs','receiving_tds')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRecTDs(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtd-${i}">${tdVal}</span>`;
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsPack(p))}</span><span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${nameAttr}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${ nameText}</span>${typeof tcOwnerPill==='function'?tcOwnerPill(p.player_id,p.name):''}${projPaceChip(p.name,p.pos,p.player_id)}${weekFilterPaceButton(state,p.player_id,'rec')}${sidebarFptsTag(p,'rec')}
        <span class="share-pct" id="dp-${i}">${sharePct}</span>
        <span class="share-vol" id="dv-${i}">${tagVal(v.toLocaleString()+' '+label, isYds?'Receiving Yards':'Receptions', isYds?'receiving_yards':'receptions')}</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="0.5" value="${pct}" data-key="${key}_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"${lockStats?' disabled':''}></div>
      <div class="share-stats">
        <span class="share-stat">Tgts ${tgtsCell}</span>
        <span class="share-stat">Rec ${recCell}</span>
        <span class="share-stat">Catch% ${catchCell}</span>
        <span class="share-stat">Yds ${ydsCell}</span>
        <span class="share-stat">Y/Tgt ${yptCell}</span>
        <span class="share-stat">TDs ${tdCell}</span>
      </div></div>`;
  }).join('');
  const unit=isYds?'receiving yards':'receptions';
  const title = isYds ? 'Receiving Yardage Share' : 'Receptions Share';
  // Discrepancy banner: only meaningful when the gap is non-trivial (>2% of the pool).
  const threshold = isYds ? Math.max(40, qbPool*0.02) : Math.max(3, qbPool*0.02);
  let banner;
  if(Math.abs(diff) > threshold){
    const sign = diff>0?'short of':'over';
    banner = `<div class="discrepancy-note">
      <span class="vacated-icon">${TC_ICON("warning")}</span>
      <div><b>${Math.abs(diff).toLocaleString()} ${unit} ${sign} the QB total.</b>
      The QBs are projected for <b>${qbPool.toLocaleString()} ${unit}</b>, but the receivers currently add up to
      <b>${Math.round(receiverSum).toLocaleString()}</b>. ${diff>0
        ? 'That production is unclaimed — distribute it across the receiving corps.'
        : 'The receivers exceed the QBs\' output — trim it down to reconcile.'}
      ${lockStats?'':`<button class="btn btn-accent btn-sm" style="margin-top:6px" onclick="reconcileDerived('${team}','${metric}')">
        ${diff>0?'Distribute':'Reconcile'} the ${diff>0?'difference':'overage'} →</button>`}</div></div>`;
  } else {
    banner = `<div class="reconciled-note">${TC_ICON("check")} Receivers match the QBs' projected ${unit} (${qbPool.toLocaleString()}).</div>`;
  }
  return `<div class="card"><div class="card-title">${title}</div>${subTabs}
    ${vacatedNote(team)}
    ${banner}
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="derivedPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="derivedSub">${passDerivedSubHtml(state, metric, team)}</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}

function passPieSubHtml(state,totalTgts,team){
  const noteTeam=String(team||currentTeam||'').toUpperCase();
  const shown=String(totalTgts)+' targets';
  const ctx=activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} target pool`
    : historicalTagContext(`${activeSeason} target pool`, noteTeam, activeSeason);
  return `${noteWrapHtml(escHtml(shown), { label:'Team Target Pool', value:shown, source:'projection_builder_receiving', statKey:'target_pool', context:ctx, team:noteTeam, relevance:'WR,TE,RB' }, 'note-tag-hit')}`;
}

function passDerivedSubHtml(state,metric,team){
  const isYds=metric==='recyds';
  const pool=isYds?teamRecYardsPool(state):teamRecPool(state);
  const noteTeam=String(team||currentTeam||'').toUpperCase();
  const shown=isYds?`${Math.round(pool).toLocaleString()} yds`:`${Math.round(pool)} rec`;
  const ctx=activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} receiving pool`
    : historicalTagContext(`${activeSeason} receiving pool`, noteTeam, activeSeason);
  return `${noteWrapHtml(escHtml(shown), { label:isYds?'Team Receiving Yards Pool':'Team Receptions Pool', value:shown, source:'projection_builder_receiving', statKey:isYds?'receiving_yards_pool':'receptions_pool', context:ctx, team:noteTeam, relevance:'WR,TE,RB' }, 'note-tag-hit')}`;
}

// Distribute (or trim) the gap between the QBs' projected output and the receivers' sum,
// spread proportionally across the existing receiving corps by their current share.
function reconcileDerived(team,metric){
  const state=userProj[team]; if(!state) return;
  pushUndo(team,"reconcileDerived:"+metric); markDirty(team);
  const isYds=metric==='recyds';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const qbPool=isYds?teamRecYardsPool(state):teamRecPool(state);
  const shares=state.passing_shares;
  const valOf=p=>{const tg=p.share*totalTgts;return isYds?tg*(p.ypt||9):tg*(p.catch_rate||0.65);};
  const receiverSum=shares.reduce((s,p)=>s+valOf(p),0)||1;
  // scale every receiver's rate so their summed production equals the QB pool
  const k=qbPool/receiverSum;
  shares.forEach(p=>{
    if(isYds) p.ypt=Math.max(0,Math.min(40,(p.ypt||9)*k));
    else p.catch_rate=Math.max(0,Math.min(1.5,(p.catch_rate||0.65)*k));
  });
  // refresh derived share fields to reflect the reconciled values
  shares.forEach(p=>{ delete p.rec_share; delete p.recyds_share; });
  ensureDerivedShares(state,metric);
  renderContent();
  toast(`Reconciled ${isYds?'receiving yards':'receptions'} to the QB total ✓`,'ok');
}

// Sort shares descending by the active metric so the leader floats to top
function sortedIdx(shares,field){
  return shares.map((p,i)=>i).sort((a,b)=>shares[b][field]-shares[a][field]);
}

function renderPassTargets(team,state,totalTgts,totalTDs,subTabs){
  const lockStats = activeSeason!=='proj';
  const order=sortedIdx(state.passing_shares,'share');
  const rows=order.map(i=>{
    const p=state.passing_shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const nameAttr = escAttr(p.name);
    const nameText = escHtml(p.name);
    const noteTeam=String((p&&p.team)||team||currentTeam||'').toUpperCase();
    const notePlayer=noteTargetFromArgs((p&&((p.player_id)||p.name))||'', (p&&p.pos)||'', noteTeam);
    const noteCtx=activeSeason==='proj'
      ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} receiving shares`
      : historicalTagContext(`${activeSeason} receiving shares`, noteTeam, activeSeason);
    const tagVal=(display,labelTxt,statKey)=>noteWrapHtml(`<span class="share-stat-val">${escHtml(String(display))}</span>`, {
      label:labelTxt, value:String(display), source:'projection_builder_receiving', statKey,
      context:noteCtx, player:notePlayer, team:noteTeam, relevance:'WR,TE,RB'
    }, 'note-tag-hit');
    const pct=(p.share*100).toFixed(1);
    const sharePct = tagVal(`${pct}%`,'Target Share','target_share_pct');
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    const tgtsCell = lockStats
      ? tagVal(projTgts,'Targets','receiving_targets')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editTargets(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-tgt-${i}">${projTgts}</span>`;
    const recCell = lockStats
      ? tagVal(projRec,'Receptions','receptions')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRec(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-rec-${i}">${projRec}</span>`;
    const ydsCell = lockStats
      ? tagVal(projYds,'Receiving Yards','receiving_yards')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRecYds(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="yd-${i}">${projYds}</span>`;
    const catchCell = lockStats
      ? tagVal((p.catch_rate*100).toFixed(0)+'%','Catch Percentage','catch_rate_pct')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editCatchPct(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="cr-${i}">${(p.catch_rate*100).toFixed(0)}</span>%`;
    const yptCell = lockStats
      ? tagVal((p.ypt||9).toFixed(1),'Yards Per Target','yards_per_target')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editYpt(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ypt-${i}">${(p.ypt||9).toFixed(1)}</span>`;
    const tdCell = lockStats
      ? tagVal(projTDs,'Receiving TDs','receiving_tds')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRecTDs(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtd-${i}">${projTDs}</span>`;
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row">
        <div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsPack(p))}</span>
        <span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${nameAttr}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${nameText}</span>${typeof tcOwnerPill==='function'?tcOwnerPill(p.player_id,p.name):''}${weekFilterPaceButton(state,p.player_id,'rec')}${sidebarFptsTag(p,'rec')}
        <span class="share-pct" id="pp-${i}">${sharePct}</span>
        <span class="share-vol" id="pt-${i}">${tagVal(projTgts+' tgt','Targets','receiving_targets')}</span>
        ${activeSeason!=='proj'&&p.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking(${pcardArg(p.player_id)},${pcardArg(p.pos)})" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
      </div>
      <div class="slider-track">
        <div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="0.5" value="${pct}" data-key="ps_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"${lockStats?' disabled':''}>
      </div>
      <div class="share-stats">
        <span class="share-stat">Tgts ${tgtsCell}</span>
        <span class="share-stat">Rec ${recCell}</span>
        <span class="share-stat">Catch% ${catchCell}</span>
        <span class="share-stat">Yds ${ydsCell}</span>
        <span class="share-stat">Y/Tgt ${yptCell}</span>
        <span class="share-stat">TDs ${tdCell}</span>
      </div></div>`;
  }).join('');
  // Discrepancy: the team's pass attempts imply ~att×TARGET_RATE targets, but the
  // receivers' targets sum to state.team_targets. Flag a meaningful gap and offer a fix.
  const expectTgts=Math.round(teamPassAtt(state)*TARGET_RATE);
  const tgtDiff=expectTgts-Math.round(totalTgts);
  const tThresh=Math.max(8, expectTgts*0.03);
  let tgtBanner='';
  if(Math.abs(tgtDiff)>tThresh){
    tgtBanner=`<div class="discrepancy-note"><span class="vacated-icon">${tgtDiff>0?'⚠️':'❗'}</span>
      <div><b>${Math.abs(tgtDiff)} targets ${tgtDiff>0?'unaccounted for':'over the QB total'}.</b>
      The QBs' ${teamPassAtt(state)} attempts imply about <b>${expectTgts} targets</b>, but the receivers add up to <b>${Math.round(totalTgts)}</b>.
      ${lockStats?'':`<button class="btn btn-accent btn-sm" style="margin-top:6px" onclick="reconcileTargets('${team}')">${tgtDiff>0?'Distribute':'Reconcile'} the difference →</button>`}</div></div>`;
  }
  return `<div class="card"><div class="card-title">Receiver Target Share</div>${subTabs}
    ${vacatedNote(team)}
    ${tgtBanner}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTgts} total targets (${teamPassAtt(state)} att × ${TARGET_RATE}) · ${teamRecYardsPool(state).toLocaleString()} receiving yards available · ${totalTDs} pass TDs.
      Drag a share to 100% and others rebalance. Or edit <b>Tgts</b>/<b>Rec</b> directly — shares recompute.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="pieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="pieSub">${passPieSubHtml(state,totalTgts,team)}</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}

// Scale the receiver target pool up/down to match the QBs' attempts × target rate, holding
// each receiver's share. Then reanchor team_targets so the per-player targets reflect it.
function reconcileTargets(team){
  const state=userProj[team]; if(!state) return;
  pushUndo(team,"reconcileTargets"); markDirty(team);
  const expectTgts=Math.round(teamPassAtt(state)*TARGET_RATE);
  // re-anchor: set each player's baseline so share×pool = their new target count
  state.team_targets=expectTgts;
  state.base_pass_att=teamPassAtt(state);
  renderContent();
  toast(`Targets reconciled to ${expectTgts} (QB attempts × ${TARGET_RATE}) ✓`,'ok');
}

function renderPassTDs(team,state,totalTDs,subTabs){
  const lockStats = activeSeason!=='proj';
  const order=sortedIdx(state.passing_shares,'td_share');
  const rows=order.map(i=>{
    const p=state.passing_shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const nameAttr = escAttr(p.name);
    const nameText = escHtml(p.name);
    const noteTeam=String((p&&p.team)||team||currentTeam||'').toUpperCase();
    const notePlayer=noteTargetFromArgs((p&&((p.player_id)||p.name))||'', (p&&p.pos)||'', noteTeam);
    const noteCtx=activeSeason==='proj'
      ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} receiving shares`
      : historicalTagContext(`${activeSeason} receiving shares`, noteTeam, activeSeason);
    const tagVal=(display,labelTxt,statKey)=>noteWrapHtml(`<span class="share-stat-val">${escHtml(String(display))}</span>`, {
      label:labelTxt, value:String(display), source:'projection_builder_receiving', statKey,
      context:noteCtx, player:notePlayer, team:noteTeam, relevance:'WR,TE,RB'
    }, 'note-tag-hit');
    const pct=(p.td_share*100).toFixed(1);
    const sharePct = tagVal(`${pct}%`,'Receiving TD Share','receiving_td_share_pct');
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    const tdCell = lockStats
      ? tagVal(projTDs,'Receiving TDs','receiving_tds')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRecTDsAbs(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="tdt-${i}">${projTDs}</span>`;
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsPack(p))}</span><span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${nameAttr}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${nameText}</span>${typeof tcOwnerPill==='function'?tcOwnerPill(p.player_id,p.name):''}
        <span class="share-pct" id="tdp-${i}">${sharePct}</span>
        <span class="share-vol">${tagVal(projTDs+' TD','Receiving TDs','receiving_tds')}</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}" data-key="tds_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"${lockStats?' disabled':''}></div>
      <div class="share-stats">
        <span class="share-stat">Rec TDs ${tdCell}</span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Receiving TD Share</div>${subTabs}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTDs} total passing TDs (from the QB tab). Each player's projected receiving TDs = share × ${totalTDs}.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="pieChart" width="150" height="150"></canvas>
        <div class="pie-sub">${totalTDs} rec TDs</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}


