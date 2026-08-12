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
  const lockStats = activeSeason!=='proj';
  const noteTeam=String(team||currentTeam||'').toUpperCase();
  const totalsCtx=activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} rushing totals`
    : historicalTagContext(`${activeSeason} rushing totals`, noteTeam, activeSeason);
  const r=state.rushing;
  const qbRushAtt=state.qbs.reduce((s,q)=>s+q.qb_rush_attempts,0);
  const totalIncQB=(r.total_attempts||0)+qbRushAtt;
  const totalTDs=teamRushTDs(state);
  const order=sortedIdx(r.shares,'share');
  const rows=order.map(i=>{
    const p=r.shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const nameAttr = escAttr(p.name);
    const nameText = escHtml(p.name);
    const noteTeam=String((p&&p.team)||team||currentTeam||'').toUpperCase();
    const notePlayer=noteTargetFromArgs((p&&((p.player_id)||p.name))||'', (p&&p.pos)||'RB', noteTeam);
    const noteCtx=activeSeason==='proj'
      ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} rushing shares`
      : historicalTagContext(`${activeSeason} rushing shares`, noteTeam, activeSeason);
    const tagVal=(display,labelTxt,statKey)=>noteWrapHtml(`<span class="share-stat-val">${escHtml(String(display))}</span>`, {
      label:labelTxt, value:String(display), source:'projection_builder_rushing', statKey,
      context:noteCtx, player:notePlayer, team:noteTeam, relevance:'RB'
    }, 'note-tag-hit');
    const pct=(p.share*100).toFixed(1);
    const sharePct = tagVal(`${pct}%`,'Carry Share','carry_share_pct');
    const att=Math.round(p.share*r.total_attempts);
    const yds=Math.round(att*(p.ypc||r.ypa||4));
    const tds=(p.td_share*totalTDs).toFixed(1);
    const attCell = lockStats
      ? tagVal(att,'Rushing Attempts','rushing_attempts')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editCarries(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-att-${i}">${att}</span>`;
    const ypcCell = lockStats
      ? tagVal((p.ypc||r.ypa||4).toFixed(2),'Yards Per Carry','yards_per_carry')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editYpc(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ed-ypc-${i}">${(p.ypc||r.ypa||4).toFixed(2)}</span>`;
    const ydsCell = lockStats
      ? tagVal(yds,'Rushing Yards','rushing_yards')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRushYds(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="ryd-${i}">${yds}</span>`;
    const tdsCell = lockStats
      ? tagVal(tds,'Rushing TDs','rushing_tds')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRushTDsCarry(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtdv-${i}">${tds}</span>`;
    return `<div class="share-block" id="rblk-${i}">
      <div class="share-row"><div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, (p.pos||'RB'), (p.team||currentTeam||''))}">${imgSm(hsPack(p))}</span><span class="pos-badge pos-RB">RB</span>
        <span class="share-name clickable-player" title="${nameAttr}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${ nameText}</span>${weekFilterPaceButton(state,p.player_id,'rush')}${sidebarFptsTag(p,'rush')}
        <span class="share-pct" id="rp-${i}">${sharePct}</span>
        <span class="share-vol" id="ra-${i}">${tagVal(att+' att','Rushing Attempts','rushing_attempts')}</span>
        ${activeSeason!=='proj'&&p.player_id?`<button class="copy-btn" onclick="copyPlayerToWorking(${pcardArg(p.player_id)},'RB')" title="Copy to ${PROJ_SEASON} working set">⤵</button>`:''}
        </div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="rs_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"${lockStats?' disabled':''}></div>
      <div class="share-stats">
        <span class="share-stat">Att ${attCell}</span>
        <span class="share-stat">Y/Carry ${ypcCell}</span>
        <span class="share-stat">Yds ${ydsCell}</span>
        <span class="share-stat">TDs ${tdsCell}</span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Team Rushing Volume</div>
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>Set total RB carries and total rushing yards. Each RB's yards = their carries × their Y/Carry;
      changing the team total scales every RB's efficiency proportionally.</div></div>
    ${sRow('rush_total_att','RB Carries (excl QB)',r.total_attempts,baseAtt,0,600,5,'var(--rb)',false,{ readOnly:lockStats, noteMeta:{ label:'Team RB Carries', source:'projection_builder_rushing', statKey:'team_rb_carries', context:totalsCtx, team:noteTeam, relevance:'RB' } })}
    ${sRow('rush_total_yds','Total RB Rush Yards',r.total_yards,baseYds,0,3500,25,'var(--rb)',false,{ readOnly:lockStats, noteMeta:{ label:'Team RB Rushing Yards', source:'projection_builder_rushing', statKey:'team_rb_total_yards', context:totalsCtx, team:noteTeam, relevance:'RB' } })}
    <div class="derived-note" id="rushDerived">${rushNote(state,{asHtml:true,team})}</div></div>
  <div class="card"><div class="card-title">RB Carry Share</div>${subTabs}
    ${vacatedRushNote(team)}
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="rushPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="rushTotalLbl">${rushTotalLabelHtml(state,team)}</div></div>
      <div class="pie-controls" id="rushShareControls">${rows}</div></div></div>`;
}

function renderRushTDs(team,state,subTabs){
  const lockStats = activeSeason!=='proj';
  const noteTeam=String(team||currentTeam||'').toUpperCase();
  const totalsCtx=activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} rushing totals`
    : historicalTagContext(`${activeSeason} rushing totals`, noteTeam, activeSeason);
  const r=state.rushing;
  const totalTDs=teamRushTDs(state);
  const order=sortedIdx(r.shares,'td_share');
  const rows=order.map(i=>{
    const p=r.shares[i];
    const col=PCOLORS[i%PCOLORS.length];
    const nameAttr = escAttr(p.name);
    const nameText = escHtml(p.name);
    const noteTeam=String((p&&p.team)||team||currentTeam||'').toUpperCase();
    const notePlayer=noteTargetFromArgs((p&&((p.player_id)||p.name))||'', (p&&p.pos)||'RB', noteTeam);
    const noteCtx=activeSeason==='proj'
      ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} rushing shares`
      : historicalTagContext(`${activeSeason} rushing shares`, noteTeam, activeSeason);
    const tagVal=(display,labelTxt,statKey)=>noteWrapHtml(`<span class="share-stat-val">${escHtml(String(display))}</span>`, {
      label:labelTxt, value:String(display), source:'projection_builder_rushing', statKey,
      context:noteCtx, player:notePlayer, team:noteTeam, relevance:'RB'
    }, 'note-tag-hit');
    const pct=(p.td_share*100).toFixed(1);
    const sharePct = tagVal(`${pct}%`,'Rushing TD Share','rushing_td_share_pct');
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    const tdCell = lockStats
      ? tagVal(projTDs,'Rushing TDs','rushing_tds')
      : `<span class="mini-edit" contenteditable="true" spellcheck="false" onfocus="selAll(this)" onblur="editRushTDsAbs(${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" id="rtdt-${i}">${projTDs}</span>`;
    return `<div class="share-block" id="rblk-${i}"><div class="share-row">
        <div class="share-dot" style="background:${col}"></div>
        <span class="clickable-player" onclick="${pcardOnclick(p.player_id||p.name, (p.pos||'RB'), (p.team||currentTeam||''))}">${imgSm(hsPack(p))}</span><span class="pos-badge pos-RB">RB</span>
        <span class="share-name clickable-player" title="${nameAttr}" onclick="${pcardOnclick(p.player_id||p.name, p.pos, (p.team||currentTeam||''))}">${nameText}</span>${weekFilterPaceButton(state,p.player_id,'rush')}${sidebarFptsTag(p,'rush')}
        <span class="share-pct" id="rtdp-${i}">${sharePct}</span>
        <span class="share-vol">${tagVal(projTDs+' TD','Rushing TDs','rushing_tds')}</span></div>
      <div class="slider-track"><div class="slider-fill" style="width:${pct}%;background:${col}"></div>
        <input class="sl" type="range" min="0" max="100" step="1" value="${pct}"
          data-key="rtds_${i}" data-team="${team}" data-col="${col}" style="--col:${col}"${lockStats?' disabled':''}></div>
      <div class="share-stats">
        <span class="share-stat">Rush TDs ${tdCell}</span>
      </div></div>`;
  }).join('');
  return `<div class="card"><div class="card-title">Team Rushing TDs</div>
    ${sRow('rush_total_tds','Total RB Rush TDs',totalTDs,Math.round(totalTDs),0,40,1,'var(--rb)',false,{ readOnly:lockStats, noteMeta:{ label:'Team RB Rushing TDs', source:'projection_builder_rushing', statKey:'team_rb_rushing_tds', context:totalsCtx, team:noteTeam, relevance:'RB' } })}
    <div class="derived-note">Set the team's total RB rushing TDs; each back's share below splits this total.</div></div>
  <div class="card"><div class="card-title">Rushing TD Share</div>${subTabs}
    <div class="alert alert-info"><span class="alert-icon">ℹ️</span>
      <div>${totalTDs.toFixed(0)} projected RB rushing TDs. QB rushing TDs are set separately on the QB tab.</div></div>
    <div class="pie-section">
      <div class="pie-wrap"><canvas id="rushPieChart" width="150" height="150"></canvas>
        <div class="pie-sub" id="rushTDLbl">${totalTDs.toFixed(0)} rush TDs</div></div>
      <div class="pie-controls" id="rushShareControls">${rows}</div></div></div>`;
}
function rushNote(state, opts){
  const r=state.rushing;
  const qbRushAtt=state.qbs.reduce((s,q)=>s+q.qb_rush_attempts,0);
  const totalIncQB=(r.total_attempts||0)+qbRushAtt;
  const plain=`RB carries: ${r.total_attempts} · team YPA: ${(r.ypa||0).toFixed(2)} · RB yards: ${(r.total_yards||0).toLocaleString()} · incl QB: ~${totalIncQB} carries`;
  if(!opts || !opts.asHtml) return plain;
  const noteTeam=String((opts&&opts.team)||currentTeam||'').toUpperCase();
  const ctx=activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} rushing derived`
    : historicalTagContext(`${activeSeason} rushing derived`, noteTeam, activeSeason);
  return `RB carries: ${noteWrapHtml(escHtml(String(r.total_attempts)), { label:'RB Carries', value:String(r.total_attempts), source:'projection_builder_rushing', statKey:'rb_carries', context:ctx, team:noteTeam, relevance:'RB' }, 'note-tag-hit')} · team YPA: ${noteWrapHtml(escHtml((r.ypa||0).toFixed(2)), { label:'Team RB Yards Per Carry', value:(r.ypa||0).toFixed(2), source:'projection_builder_rushing', statKey:'team_rb_ypa', context:ctx, team:noteTeam, relevance:'RB' }, 'note-tag-hit')} · RB yards: ${noteWrapHtml(escHtml((r.total_yards||0).toLocaleString()), { label:'Team RB Rushing Yards', value:(r.total_yards||0).toLocaleString(), source:'projection_builder_rushing', statKey:'team_rb_yards', context:ctx, team:noteTeam, relevance:'RB' }, 'note-tag-hit')} · incl QB: ${noteWrapHtml(escHtml('~'+String(totalIncQB)+' carries'), { label:'Team Carries Including QB', value:'~'+String(totalIncQB)+' carries', source:'projection_builder_rushing', statKey:'team_carries_incl_qb', context:ctx, team:noteTeam, relevance:'QB,RB' }, 'note-tag-hit')}`;
}

function rushTotalLabelHtml(state, team){
  const r=state.rushing;
  const noteTeam=String(team||currentTeam||'').toUpperCase();
  const ctx=activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} rushing totals`
    : historicalTagContext(`${activeSeason} rushing totals`, noteTeam, activeSeason);
  const attShown=String(r.total_attempts||0)+' att';
  const ydsShown=(r.total_yards||0).toLocaleString()+' yds';
  return `${noteWrapHtml(escHtml(attShown), { label:'Team RB Carries', value:attShown, source:'projection_builder_rushing', statKey:'team_rb_carries', context:ctx, team:noteTeam, relevance:'RB' }, 'note-tag-hit')} / ${noteWrapHtml(escHtml(ydsShown), { label:'Team RB Rushing Yards', value:ydsShown, source:'projection_builder_rushing', statKey:'team_rb_total_yards', context:ctx, team:noteTeam, relevance:'RB' }, 'note-tag-hit')}`;
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
function vacatedCarriesLeagueRank(team){
  if(activeSeason!=='proj') return null;
  const tms=(typeof TEAMS!=='undefined' && Array.isArray(TEAMS) && TEAMS.length)
    ? TEAMS
    : ['CIN','PIT','BAL','CLE','HOU','JAX','TEN','IND','BUF','NE','MIA','NYJ','KC','LAC','LV','DEN','GB','DET','MIN','CHI','TB','CAR','ATL','NO','PHI','DAL','WAS','NYG','LAR','SF','SEA','ARI'];
  const rows=tms.map(tm=>({team:tm, v:vacatedRushing(tm)})).filter(x=>x.v && x.v.att>0);
  if(!rows.length) return null;
  rows.sort((a,b)=>((b.v.att||0)-(a.v.att||0)) || a.team.localeCompare(b.team));
  const idx=rows.findIndex(x=>x.team===team);
  if(idx<0) return null;
  return {rank:idx+1,total:rows.length};
}
function vacatedRushNote(team){
  const v=vacatedRushing(team);
  if(!v) return '';
  const noteTeam=String(team||currentTeam||'').toUpperCase();
  const ctx=activeSeason==='proj'
    ? `${PROJ_SEASON} projections · ${(teamDisplayName(noteTeam)||noteTeam||'Team')} vacated rushing`
    : historicalTagContext(`${activeSeason} vacated rushing`, noteTeam, activeSeason);
  const rk=vacatedCarriesLeagueRank(noteTeam);
  const rankText=rk?`${vacatedOrdinal(rk.rank)} most vacated carries in ${PROJ_SEASON}`:'';
  const tagValue=`${v.att} carries · ${v.yds.toLocaleString()} yds · ${v.td} TD${rankText?` · ${rankText}`:''}`;
  const rankLead=rk?`${vacatedOrdinal(rk.rank)}`:'Rank N/A';
  const lineHtml=`<b>${escHtml(rankLead)} Vacated Carries from ${v.season}:</b> ${escHtml(`${v.att} carries · ${v.yds.toLocaleString()} yds · ${v.td} TD`)}`;
  const names = v.players.length>3 ? v.players.slice(0,3).join(', ')+` +${v.players.length-3} more` : v.players.join(', ');
  return `<div class="vacated-note">
    <span class="vacated-icon">${TC_ICON("export")}</span>
    <div>${noteWrapHtml(lineHtml, { label:'Vacated Carries', value:tagValue, source:'projection_builder_vacated', statKey:'vacated_carries', context:ctx, team:noteTeam, relevance:'RB,QB,WR' }, 'note-tag-hit')}
    <span style="color:var(--muted)"> — left by ${names}.</span>
    <span style="color:var(--muted)">These carries are up for grabs among the current backfield.</span></div></div>`;
}