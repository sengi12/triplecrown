// ─────────────────────────────────────────────────────────────────────────────
// Rushing Phase
// ─────────────────────────────────────────────────────────────────────────────
function renderRushing(team,state){
  const r=state.rushing;
  const baseAtt=getBase(team,'RB').reduce((s,p)=>s+p.rushing_attempts,0)||200;
  const baseYds=getBase(team,'RB').reduce((s,p)=>s+p.rushing_yards,0)||1600;
  const subTabs=`<div class="sub-tabs">
    <button class="sub-tab ${rushingSubTab==='carries'?'active':''}" onclick="setRushSub('carries')">Carry Share</button>
    <button class="sub-tab ${rushingSubTab==='rush_tds'?'active':''}" onclick="setRushSub('rush_tds')">Rush TD Share</button></div>`;
  const weekSlider=weekRangeSliderHTML(team,state);
  const body = rushingSubTab==='carries' ? renderRushCarries(team,state,baseAtt,baseYds,subTabs) : renderRushTDs(team,state,subTabs);
  return weekSlider + body;
}
function setRushSub(t){rushingSubTab=t;renderContent();}

function renderRushCarries(team,state,baseAtt,baseYds,subTabs){
  const r=state.rushing;
  const qbRushAtt=state.qbs.reduce((s,q)=>s+q.qb_rush_attempts,0);
  const totalIncQB=(r.total_attempts||0)+qbRushAtt;
  const totalTDs=teamRushTDs(state);
  const order=sortedIdx(r.shares,'share');
  const rows=order.map(i=>{
    const p=r.shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.share*100).toFixed(1);
    const att=Math.round(p.share*r.total_attempts);
    const yds=Math.round(att*(p.ypc||r.ypa||4));
    const tds=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="rblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, (p.pos||'RB'), (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span><span class="pos-badge pos-RB">RB</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>${weekFilterPaceButton(state,p.player_id,'rush')}
        <span class="share-pct" id="rp-${i}">${pct}%</span>
        <span class="share-vol" id="ra-${i}">${att} att</span>
        ${activeSeason!=='proj'&&p.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking('${p.player_id}','RB')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
        </div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="rs_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Att <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editCarries(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-att-${i}">${att}</span></span>
        <span class="share-stat">Y/Carry <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editYpc(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-ypc-${i}">${(p.ypc||r.ypa||4).toFixed(2)}</span></span>
        <span class="share-stat">Yds <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushYds(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ryd-${i}">${yds}</span></span>
        <span class="share-stat">TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushTDsCarry(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtdv-${i}">${tds}</span></span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Team Rushing Volume</div>
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>Set total RB carries and total rushing yards. Each RB's yards = their carries × their Y/Carry;
      changing the team total scales every RB's efficiency proportionally.</div></div>
    ${sRow('rush_total_att','RB Carries (excl QB)',r.total_attempts,baseAtt,0,600,5,'var(--rb)')}
    ${sRow('rush_total_yds','Total RB Rush Yards',r.total_yards,baseYds,0,3500,25,'var(--rb)')}
    <div class="derived-note" id="rushDerived">${rushNote(state)}</div></div>
  <div class="card"><div class="card-title">RB Carry Share</div>${subTabs}
    ${vacatedRushNote(team)}
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="rushPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="rushTotalLbl">${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds</div></div>
      <div class="pie-controls" id="rushShareControls">${rows}</div></div></div>`;
}

function renderRushTDs(team,state,subTabs){
  const r=state.rushing;
  const totalTDs=teamRushTDs(state);
  const order=sortedIdx(r.shares,'td_share');
  const rows=order.map(i=>{
    const p=r.shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const pct=(p.td_share*100).toFixed(1);
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    return `<div class="share-block" id="rblk-${i}"><div class="share-row">
        <div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, (p.pos||'RB'), (p.team||currentTeam||''))}">${imgSm(hsURL(p))}</span><span class="pos-badge pos-RB">RB</span>
        <span class="share-name clickable-player" title="${p.name}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${p.name}</span>${weekFilterPaceButton(state,p.player_id,'rush')}
        <span class="share-pct" id="rtdp-${i}">${pct}%</span>
        <span class="share-vol">proj TDs</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="rtds_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"></div>
      <div class="share-stats">
        <span class="share-stat">Rush TDs <span class="mini-edit" contenteditable="true" spellcheck="false"
          onfocus="selAll(this)" onblur="editRushTDsAbs(${i},this.textContent)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtdt-${i}">${projTDs}</span></span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Team Rushing TDs</div>
    ${sRow('rush_total_tds','Total RB Rush TDs',totalTDs,Math.round(totalTDs),0,40,1,'var(--rb)')}
    <div class="derived-note">Set the team's total RB rushing TDs; each back's share below splits this total.</div></div>
  <div class="card"><div class="card-title">Rushing TD Share</div>${subTabs}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTDs.toFixed(0)} projected RB rushing TDs. QB rushing TDs are set separately on the QB tab.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="rushPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="rushTDLbl">${totalTDs.toFixed(0)} rush TDs</div></div>
      <div class="pie-controls" id="rushShareControls">${rows}</div></div></div>`;
}
function rushNote(state){
  const r=state.rushing;
  const qbRushAtt=state.qbs.reduce((s,q)=>s+q.qb_rush_attempts,0);
  const totalIncQB=(r.total_attempts||0)+qbRushAtt;
  return `RB carries: ${r.total_attempts} · team YPA: ${(r.ypa||0).toFixed(2)} · RB yards: ${(r.total_yards||0).toLocaleString()} · incl QB: ~${totalIncQB} carries`;
}

// Rushing counterpart of vacatedProduction: carries/rush-yards/rush-TDs left behind by
// players (RB/WR/QB) who were on the team last season but aren't on the current roster.
function vacatedRushing(team){
  if(activeSeason!=='proj') return null;
  const lastYear = (HISTORY_SEASONS&&HISTORY_SEASONS.length)?HISTORY_SEASONS[0]:String(PROJ_SEASON-1);
  if(!seasonStatsCache[lastYear]){
    if(HISTORY && Object.keys(HISTORY).length){
      const built=buildSeedFromHistory(lastYear); if(built) seasonStatsCache[lastYear]=built;
    } else {
      ensureSeasonStats(lastYear);
    }
  }
  const prev=seasonStatsCache[lastYear] && seasonStatsCache[lastYear][team];
  if(!prev) return null;
  const curIds=new Set();
  const ps=projSeed||seasonStatsCache['proj']||{};
  ['QB','RB','WR','TE'].forEach(pos=>(ps[team]&&ps[team][pos]||[]).forEach(p=>p.player_id&&curIds.add(p.player_id)));
  if(sleeperPlayers){
    for(const pid in sleeperPlayers){ if(sleeperPlayers[pid].team===team) curIds.add(pid); }
  }
  let att=0,yds=0,td=0; const gone=[];
  // RBs carry most rushing; include WR/QB rushers too since they leave carries behind as well.
  ['RB','WR','QB'].forEach(pos=>(prev[pos]||[]).forEach(p=>{
    const carries = (p.rushing_attempts||p.qb_rush_attempts||0);
    if(p.player_id && !curIds.has(p.player_id) && carries>0){
      att+=carries;
      yds+=(p.rushing_yards||p.qb_rush_yards||0);
      td+=(p.rushing_tds||p.qb_rush_tds||0);
      gone.push({name:p.name, att:carries});
    }
  }));
  if(!gone.length) return null;
  gone.sort((a,b)=>b.att-a.att);
  return {season:lastYear, att:Math.round(att), yds:Math.round(yds), td:Math.round(td),
          players:gone.map(g=>g.name)};
}
function vacatedRushNote(team){
  const v=vacatedRushing(team);
  if(!v) return '';
  const names = v.players.length>3 ? v.players.slice(0,3).join(', ')+` +${v.players.length-3} more` : v.players.join(', ');
  return `<div class="vacated-note">
    <span class="vacated-icon">📤</span>
    <div><b>Vacated from ${v.season}:</b> ${v.att} carries · ${v.yds.toLocaleString()} yds · ${v.td} TD
    <span style="color:var(--muted)"> — left by ${names}.</span>
    <span style="color:var(--muted)">These carries are up for grabs among the current backfield.</span></div></div>`;
}