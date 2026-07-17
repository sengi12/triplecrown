// ─────────────────────────────────────────────────────────────────────────────
// Live DOM updaters
// ─────────────────────────────────────────────────────────────────────────────
function liveQB(state,idx,team,changedKey){
  const q=state.qbs[idx];
  const cp=q.passing_attempts>0?(q.passing_completions/q.passing_attempts*100).toFixed(1):'0';
  const ypa=q.passing_attempts>0?(q.passing_yards/q.passing_attempts).toFixed(2):'-';
  const ytd=q.passing_tds>0?Math.round(q.passing_yards/q.passing_tds):'-';
  const d=document.getElementById('qbDerived'); if(d) d.textContent=`Comp%: ${cp}% · YPA: ${ypa} · Yds/TD: ${ytd} · per game: ${perGame(q,'passing_yards').toFixed(1)} yds`;
  const m={'sb-py':Math.round(q.passing_yards).toLocaleString(),'sb-ptd':Math.round(q.passing_tds),'sb-int':Math.round(q.interceptions_thrown),
    'sb-ry':Math.round(q.qb_rush_yards),'sb-rtd':Math.round(q.qb_rush_tds),'sb-att':Math.round(q.passing_attempts)};
  Object.entries(m).forEach(([id,v])=>{const e=document.getElementById(id);if(e)e.textContent=v;});
  const seed=getBase(team,'QB').find(qq=>qq.name===q.name)||getBase(team,'QB')[0]||{};
  const bases={py:seed.passing_yards||4000,ptd:seed.passing_tds||25,patt:seed.passing_attempts||560,
    pcomp:seed.passing_completions||360,int:seed.interceptions_thrown||10,
    qbry:seed.rushing_yards||0,qbrtd:seed.rushing_tds||0,qbratt:seed.rushing_attempts||0};
  if(changedKey){const sd=document.getElementById(`sd-${changedKey}`);if(sd)sd.innerHTML=mkDelta(state.qbs[idx][({py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',pcomp:'passing_completions',int:'interceptions_thrown',qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'})[changedKey]],bases[changedKey]||0,changedKey==='int');}
  const tot=document.getElementById('qbTeamTotals'); if(tot) tot.textContent=qbTotalsText(state);
}

// Update the workload card text (per-QB sub line, team-games budget, the active QB's
// games/snap sub spans) without a full re-render, so dragging stays smooth.
function updateWorkloadUI(state,qi,team){
  const q=state.qbs[qi];
  const sub=document.getElementById(`wl-sub-${qi}`);
  if(sub) sub.textContent=`${Math.round(q.games||0)} games · ${perGame(q,'passing_yards').toFixed(1)} pass yds/gm`;
  const gv=document.getElementById(`sv-games_${qi}`); if(gv&&document.activeElement!==gv) gv.textContent=Math.round(q.games||0);
  if((state.activeQB||0)===qi){
    const gsub=document.getElementById('qb-games-sub'); if(gsub) gsub.textContent=Math.round(q.games||0);
  }
  const teamGames=state.qbs.reduce((s,x)=>s+(x.games||0),0);
  const over=teamGames>SEASON_GAMES+0.5;
  const note=document.getElementById('qbWorkloadNote');
  if(note){
    note.style.color = over?'var(--warn)':'';
    note.textContent=`Team QB-games: ${teamGames.toFixed(0)} of ${SEASON_GAMES}`+(over?' ⚠️ over a full season — combined QB workload exceeds 17 games':'');
  }
}

// After a games-pace rescale, move the QB stat sliders + value badges to the new totals.
function refreshQBStatSliders(state,qi){
  if((state.activeQB||0)!==qi) return; // only the visible QB has stat sliders rendered
  const q=state.qbs[qi];
  const map={py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',
    pcomp:'passing_completions',int:'interceptions_thrown',
    qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'};
  Object.entries(map).forEach(([k,prop])=>{
    const v=Math.round(q[prop]||0);
    const sl=document.querySelector(`input.sl[data-key="${k}"]`);
    if(sl){ sl.value=v; setFill(sl,sl.dataset.col||null); }
    const sv=document.getElementById(`sv-${k}`); if(sv&&document.activeElement!==sv) sv.textContent=v;
  });
}

// Receivers/rushing depend on QB pass attempts (via teamTargetPool). Refresh whatever
// passing/rushing view is currently shown so volume cascades from QB workload changes.
function livePassDependents(state,team){
  if(currentPhase!=='Receiving') return;
  if(passingSubTab==='targets') livePassTargets(state,team);
  else liveTDRows('tdp','tdt',state.passing_shares||[],teamPassTDs(state),'tds_',true);
}

function livePassTargets(state,team){
  const totalTgts=teamTargetPool(state);
  const totalTDs=teamPassTDs(state);
  state.passing_shares.forEach((p,i)=>{
    const pct=(p.share*100).toFixed(1);
    const projTgts=Math.round(p.share*totalTgts);
    const projRec=Math.round(projTgts*(p.catch_rate||0.65));
    const projYds=Math.round(projTgts*(p.ypt||9));
    const projTDs=(p.td_share*totalTDs).toFixed(1);
    setTxt(`pp-${i}`,`${pct}%`); setTxt(`pt-${i}`,`${projTgts} tgt`);
    setEditTxt(`yd-${i}`,projYds); setEditTxt(`ypt-${i}`,(p.ypt||9).toFixed(1));
    setEditTxt(`cr-${i}`,((p.catch_rate||0.65)*100).toFixed(0)); setEditTxt(`rtd-${i}`,projTDs);
    setEditTxt(`ed-tgt-${i}`,projTgts); setEditTxt(`ed-rec-${i}`,projRec);
    const sl=document.querySelector(`input.sl[data-key="ps_${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  const sub=document.getElementById('pieSub'); if(sub) sub.textContent=`${totalTgts} targets`;
  reorderShareBlocks('shareControls','pblk-',state.passing_shares,'share');
}

// Reorder share-block DOM nodes so the category leader floats to the top.
// Skipped during an active slider drag — resortAfterRelease() handles that on pointer-up,
// which keeps the drag from feeling glitchy. Manual text edits still reorder immediately.
function reorderShareBlocks(containerId,prefix,shares,field){
  if(sliderDragging) return;
  const host=document.getElementById(containerId); if(!host||!host.children) return;
  const order=shares.map((p,i)=>i).sort((a,b)=>shares[b][field]-shares[a][field]);
  const cur=Array.from(host.children).map(c=>c.id);
  const want=order.map(i=>`${prefix}${i}`);
  if(cur.join(',')===want.join(',')) return;
  order.forEach(i=>{ const el=document.getElementById(`${prefix}${i}`); if(el) host.appendChild(el); });
}

function liveTDRows(pctId,volId,shares,totalTDs,keyPrefix,editable){
  shares.forEach((p,i)=>{
    const pct=(p.td_share*100).toFixed(1);
    const proj=(p.td_share*totalTDs).toFixed(1);
    setTxt(`${pctId}-${i}`,`${pct}%`);
    if(editable) setEditTxt(`${volId}-${i}`,proj);
    else setTxt(`${volId}-${i}`,`${proj} TD`);
    const sl=document.querySelector(`input.sl[data-key="${keyPrefix}${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  // resort by TD share (on release / manual edit, not mid-drag)
  if(keyPrefix==='tds_') reorderShareBlocks('shareControls','pblk-',shares,'td_share');
  else if(keyPrefix==='rtds_') reorderShareBlocks('rushShareControls','rblk-',shares,'td_share');
}

function liveRush(state,team){
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  liveRushRows(state,team);
}

function liveRushRows(state,team){
  const r=state.rushing;
  const totalTDs=teamRushTDs(state);
  r.shares.forEach((p,i)=>{
    const att=Math.round(p.share*r.total_attempts);
    const yds=Math.round(att*(p.ypc||r.ypa||4));
    const pct=(p.share*100).toFixed(1);
    const tds=(p.td_share*totalTDs).toFixed(1);
    setTxt(`rp-${i}`,`${pct}%`); setTxt(`ra-${i}`,`${att} att`);
    setEditTxt(`ryd-${i}`,yds); setEditTxt(`rtdv-${i}`,tds);
    setEditTxt(`ed-att-${i}`,att); setEditTxt(`ed-ypc-${i}`,(p.ypc||r.ypa||4).toFixed(2));
    const sl=document.querySelector(`input.sl[data-key="rs_${i}"]`);
    if(sl){sl.value=pct;setFill(sl,PCOLORS[i%PCOLORS.length]);}
  });
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds`;
  if(rushingSubTab==='carries') updatePie(r.shares.map(p=>p.share));
  reorderShareBlocks('rushShareControls','rblk-',r.shares,'share');
  // keep the team total-yards slider in sync (carries/ypc edits change the sum)
  const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
  if(ys){ys.value=r.total_yards;setFill(ys,'var(--rb)');
    const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=r.total_yards;}
}

function setTxt(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function setEditTxt(id,v){const e=document.getElementById(id);if(e&&document.activeElement!==e)e.textContent=v;}


