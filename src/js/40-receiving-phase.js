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
  const [lo,hi]=state.weekFilter||[1,18];
  const active=isWeekFilterActive(state);
  const loPct=(lo-1)/17*100, hiPct=(18-hi)/17*100;
  return `<div class="week-range-card">
    <div class="week-range-label">
      <span>📅 Filter weeks: <b id="wr-lo-${team}">${lo}</b> – <b id="wr-hi-${team}">${hi}</b>${state.weekFilterLoading?' <span class="week-range-loading">loading…</span>':''}</span>
      ${active?`<span class="week-range-reset" onclick="resetWeekRange('${team}')">↺ Reset to full season</span>`:'<span class="week-range-hint">drag either end to zoom into a stretch of games</span>'}
    </div>
    <div class="dual-slider">
      <div class="dual-slider-track"></div>
      <div class="dual-slider-fill" id="wr-fill-${team}" style="left:${loPct}%;right:${hiPct}%"></div>
      <input type="range" min="1" max="18" step="1" value="${lo}" class="dual-range dual-range-lo"
        oninput="weekRangeDrag('${team}','lo',this.value)" onchange="weekRangeCommit('${team}')">
      <input type="range" min="1" max="18" step="1" value="${hi}" class="dual-range dual-range-hi"
        oninput="weekRangeDrag('${team}','hi',this.value)" onchange="weekRangeCommit('${team}')">
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
function vacatedNote(team){
  const v=vacatedProduction(team);
  if(!v) return '';
  const names = v.players.length>3 ? v.players.slice(0,3).join(', ')+` +${v.players.length-3} more` : v.players.join(', ');
  return `<div class="vacated-note">
    <span class="vacated-icon">📤</span>
    <div><b>Vacated from ${v.season}:</b> ${v.tgt} targets · ${v.rec} rec · ${v.yds.toLocaleString()} yds · ${v.td} TD
    <span style="color:var(--muted)"> — left by ${names}.</span>
    <span style="color:var(--muted)">This production is up for grabs among the current roster.</span></div></div>`;
}

// Receptions / Receiving-Yards share view — editable, mirrors the target-share tab.
// Colors are keyed to each player's ORIGINAL index (PCOLORS[i]) so the pie slices and
// the rows always line up. Each player has a rec_share / recyds_share that rebalances the
// others exactly like target share. A discrepancy banner flags when the receivers' summed
// production doesn't match what the QBs are projected to throw for, with a one-click fix.
function renderPassDerived(team,state,subTabs,metric){
  ensureDerivedShares(state,metric);
  const totalTgts=teamTargetPool(state);
  const isYds = metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const key=isYds?'recyds':'rec';
  const label=isYds?'rec yds':'rec';
  // The "available" pool from the QBs vs. what the receivers actually add up to right now.
  const qbPool = isYds ? teamRecYardsPool(state) : teamRecPool(state);
  const receiverSum = state.passing_shares.reduce((s,p)=>{
    const tg=p.share*totalTgts; return s + (isYds ? tg*(p.ypt||9) : tg*(p.catch_rate||0.65));
  },0);
  const diff = Math.round(qbPool - receiverSum);
  const order=state.passing_shares.map((p,i)=>i).sort((a,b)=>(state.passing_shares[b][field]||0)-(state.passing_shares[a][field]||0));
  const rows=order.map(i=>{
    const p=state.passing_shares[i]; const col=PCOLORS[i%PCOLORS.length];
    const sh=p[field]||0; const pct=(sh*100).toFixed(1);
    const v=Math.round(sh*qbPool);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span><span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>${weekFilterPaceButton(state,p.player_id,'rec')}
        <span class="share-pct" id="dp-${i}">${pct}%</span>
        <span class="share-vol" id="dv-${i}">${v.toLocaleString()} ${label}</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="0.5" value="${pct}"
          data-key="${key}_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Tgts <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editTargets(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-tgt-${i}">${projTgts}</span></span>
        <span class="share-stat">Rec <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRec(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-rec-${i}">${projRec}</span></span>
        <span class="share-stat">Catch% <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCatchPct(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="cr-${i}">${(p.catch_rate*100).toFixed(0)}</span>%</span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="yd-${i}">${projYds}</span></span>
        <span class="share-stat">Y/Tgt <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpt(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ypt-${i}">${(p.ypt||9).toFixed(1)}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtd-${i}">${(p.td_share*teamPassTDs(state)).toFixed(1)}</span></span>
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
      <span class="vacated-icon">${diff>0?'⚠️':'❗'}</span>
      <div><b>${Math.abs(diff).toLocaleString()} ${unit} ${sign} the QB total.</b>
      The QBs are projected for <b>${qbPool.toLocaleString()} ${unit}</b>, but the receivers currently add up to
      <b>${Math.round(receiverSum).toLocaleString()}</b>. ${diff>0
        ? 'That production is unclaimed — distribute it across the receiving corps.'
        : 'The receivers exceed the QBs\' output — trim it down to reconcile.'}
      <button class="btn btn-accent btn-sm" style="margin-top:6px" onclick="reconcileDerived('${team}','${metric}')">
        ${diff>0?'Distribute':'Reconcile'} the ${diff>0?'difference':'overage'} →</button></div></div>`;
  } else {
    banner = `<div class="reconciled-note">✅ Receivers match the QBs' projected ${unit} (${qbPool.toLocaleString()}).</div>`;
  }
  return `<div class="card"><div class="card-title">${title}</div>${subTabs}
    ${vacatedNote(team)}
    ${banner}
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="derivedPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="derivedSub">${Math.round(qbPool).toLocaleString()} ${isYds?'yds':'rec'}</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}

// Distribute (or trim) the gap between the QBs' projected output and the receivers' sum,
// spread proportionally across the existing receiving corps by their current share.
function reconcileDerived(team,metric){
  const state=userProj[team]; if(!state) return;
  pushUndo(team,"reconcileDerived:"+metric); markDirty();
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
  const order=sortedIdx(state.passing_shares,'share');
  const rows=order.map(i=>{
    const p=state.passing_shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.share*100).toFixed(1);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row">
        <div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span>
        <span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>${weekFilterPaceButton(state,p.player_id,'rec')}
        <span class="share-pct" id="pp-${i}">${pct}%</span>
        <span class="share-vol" id="pt-${i}">${projTgts} tgt</span>
        ${activeSeason!=='proj'&&p.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${p.player_id}','${p.pos}')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
      </div>
      <div class="slider-track">
        <div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="0.5" value="${pct}"
          data-key="ps_${i}" data-team="${team}" data-col="${col}" style="--col:${col}">
      </div>
      <div class="share-stats">
        <span class="share-stat">Tgts <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editTargets(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-tgt-${i}">${projTgts}</span></span>
        <span class="share-stat">Rec <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRec(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-rec-${i}">${projRec}</span></span>
        <span class="share-stat">Catch% <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCatchPct(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="cr-${i}">${(p.catch_rate*100).toFixed(0)}</span>%</span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="yd-${i}">${projYds}</span></span>
        <span class="share-stat">Y/Tgt <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpt(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ypt-${i}">${(p.ypt||9).toFixed(1)}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtd-${i}">${projTDs}</span></span>
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
      <button class="btn btn-accent btn-sm" style="margin-top:6px" onclick="reconcileTargets('${team}')">${tgtDiff>0?'Distribute':'Reconcile'} the difference →</button></div></div>`;
  }
  return `<div class="card"><div class="card-title">Receiver Target Share</div>${subTabs}
    ${vacatedNote(team)}
    ${tgtBanner}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTgts} total targets (${teamPassAtt(state)} att × ${TARGET_RATE}) · ${teamRecYardsPool(state).toLocaleString()} receiving yards available · ${totalTDs} pass TDs.
      Drag a share to 100% and others rebalance. Or edit <b>Tgts</b>/<b>Rec</b> directly — shares recompute.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="pieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="pieSub">${totalTgts} targets</div></div>
      <div class="pie-controls" id="shareControls">${rows}</div></div></div>`;
}

// Scale the receiver target pool up/down to match the QBs' attempts × target rate, holding
// each receiver's share. Then reanchor team_targets so the per-player targets reflect it.
function reconcileTargets(team){
  const state=userProj[team]; if(!state) return;
  pushUndo(team,"reconcileTargets"); markDirty();
  const expectTgts=Math.round(teamPassAtt(state)*TARGET_RATE);
  // re-anchor: set each player's baseline so share×pool = their new target count
  state.team_targets=expectTgts;
  state.base_pass_att=teamPassAtt(state);
  renderContent();
  toast(`Targets reconciled to ${expectTgts} (QB attempts × ${TARGET_RATE}) ✓`,'ok');
}

function renderPassTDs(team,state,totalTDs,subTabs){
  const order=sortedIdx(state.passing_shares,'td_share');
  const rows=order.map(i=>{
    const p=state.passing_shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.td_share*100).toFixed(1);
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="pblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span><span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>
        <span class="share-pct" id="tdp-${i}">${pct}%</span>
        <span class="share-vol">proj TDs</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="tds_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Rec TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRecTDsAbs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="tdt-${i}">${projTDs}</span></span>
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


