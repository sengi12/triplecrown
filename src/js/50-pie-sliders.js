// ─────────────────────────────────────────────────────────────────────────────
// Pie charts
// ─────────────────────────────────────────────────────────────────────────────
function initPie(team,kind){
  const state=userProj[team];
  if(kind==='pass'){
    // Receptions / Rec-Yards tabs: a separate canvas. Build pie data in ORIGINAL player
    // order (same index basis as PCOLORS[i] used by the rows) so slice colors line up.
    if(passingSubTab==='rec'||passingSubTab==='recyds'){
      const ctx=document.getElementById('derivedPieChart');if(!ctx)return;
      if(pieChart){pieChart.destroy();pieChart=null;}
      if(!state.passing_shares) return;
      const totalTgts=teamTargetPool(state);
      const isYds=passingSubTab==='recyds';
      const value=p=>{const tgts=p.share*totalTgts;return isYds?tgts*(p.ypt||9):tgts*(p.catch_rate||0.65);};
      const vals=state.passing_shares.map(value);
      const pool=vals.reduce((s,v)=>s+v,0)||1;
      const data=vals.map(v=>v/pool); // original order → matches PCOLORS[i] in the rows
      const labels=state.passing_shares.map(p=>p.name.split(' ').pop());
      pieChart=mkDoughnut(ctx,labels,data);
      return;
    }
    if(!state.passing_shares) return;
    const ctx=document.getElementById('pieChart');if(!ctx)return;
    if(pieChart){pieChart.destroy();pieChart=null;}
    const data=passingSubTab==='targets'?state.passing_shares.map(p=>p.share):state.passing_shares.map(p=>p.td_share);
    pieChart=mkDoughnut(ctx,state.passing_shares.map(p=>p.name.split(' ').pop()),data);
  } else {
    if(!state.rushing.shares) return;
    const ctx=document.getElementById('rushPieChart');if(!ctx)return;
    if(pieChart){pieChart.destroy();pieChart=null;}
    const data=rushingSubTab==='carries'?state.rushing.shares.map(p=>p.share):state.rushing.shares.map(p=>p.td_share);
    pieChart=mkDoughnut(ctx,state.rushing.shares.map(p=>p.name.split(' ').pop()),data);
  }
}
function mkDoughnut(ctx,labels,data){
  return new Chart(ctx,{type:'doughnut',data:{labels,
    datasets:[{data,backgroundColor:PCOLORS.slice(0,data.length),borderWidth:0,hoverOffset:3}]},
    options:{cutout:'55%',plugins:{legend:{display:false},
      tooltip:{callbacks:{label:c=>` ${(c.raw*100).toFixed(1)}%`}}},animation:{duration:150}}});
}
function updatePie(data){ if(pieChart){pieChart.data.datasets[0].data=data;pieChart.update('none');} }

function normalizeShares(shares,idx,field){
  field=field||'share';
  const v=shares[idx][field];
  const rest=shares.filter((_,i)=>i!==idx);
  const restTotal=rest.reduce((s,p)=>s+p[field],0);
  const rem=Math.max(0,1-v);
  if(restTotal>0) rest.forEach(p=>{p[field]=p[field]/restTotal*rem;});
  else rest.forEach(p=>{p[field]=rem/rest.length;});
}


// ─────────────────────────────────────────────────────────────────────────────
// Slider / edit handlers
// ─────────────────────────────────────────────────────────────────────────────
function handleSlider(el){
  // Snapshot once at the start of a drag (coalesced by the slider's key so a continuous
  // drag pushes a single undo step, not one per tick).
  if(!sliderDragging) pushUndo(el.dataset.team, 'slider:'+(el.dataset.key||''));
  sliderDragging=true;
  handleSliderKey(el.dataset.key,parseFloat(el.value),el.dataset.team,false);
}

function handleSliderKey(key,val,team,fromManual){
  const state=userProj[team]; if(!state) return;
  markDirty();
  // mirror numeric into the editable display (unless user is editing it)
  const svEl=document.getElementById(`sv-${key}`);
  if(svEl&&document.activeElement!==svEl) svEl.textContent=(val%1!==0&&val<200)?(+val).toFixed(2):Math.round(val);

  // ── QB stats ──
  const QB_MAP={py:'passing_yards',ptd:'passing_tds',patt:'passing_attempts',
    pcomp:'passing_completions',int:'interceptions_thrown',
    qbry:'qb_rush_yards',qbrtd:'qb_rush_tds',qbratt:'qb_rush_attempts'};
  if(key in QB_MAP){
    const idx=state.activeQB||0;
    state.qbs[idx][QB_MAP[key]]=val;
    liveQB(state,idx,team,key);
    if(key==='patt') livePassDependents(state,team); // attempts drive the target pool
    return;
  }
  // ── QB Games Played (drives pace extrapolation) ──
  if(key.startsWith('games_')){
    const qi=parseInt(key.slice(6));
    const q=state.qbs[qi];
    const newGames=Math.max(0,Math.round(val));
    const STATK=['passing_yards','passing_tds','passing_attempts','passing_completions',
      'interceptions_thrown','qb_rush_yards','qb_rush_tds','qb_rush_attempts'];
    // Capture per-game rates from the CURRENT totals/games before changing games, so the
    // pace survives even a trip to 0 games (totals→0 but rates remembered on q._rate).
    const fromGames = q.games||0;
    if(fromGames>0){
      q._rate = {}; STATK.forEach(k=>{ q._rate[k]=(q[k]||0)/fromGames; });
    } else if(!q._rate){
      // never had recorded games and no stored rate: treat current totals as a 1-game rate
      q._rate = {}; STATK.forEach(k=>{ q._rate[k]=(q[k]||0); });
    }
    // else: coming back from 0 games — keep the previously stored q._rate.
    // Apply rate × newGames (newGames may be 0 → zero contribution, rates kept on q._rate)
    STATK.forEach(k=>{ q[k]=(q._rate[k]||0)*newGames; });
    q.games=newGames;
    q.base_games=newGames||1;
    updateWorkloadUI(state,qi,team);
    liveQB(state,qi,team,null);
    refreshQBStatSliders(state,qi);
    livePassDependents(state,team);
    return;
  }
  // ── Target share ──
  if(key.startsWith('ps_')){
    const i=parseInt(key.slice(3));
    state.passing_shares[i].share=val/100;
    normalizeShares(state.passing_shares,i,'share');
    if(passingSubTab==='targets') updatePie(state.passing_shares.map(p=>p.share));
    livePassTargets(state,team);
    return;
  }
  // ── Rec TD share ──
  if(key.startsWith('tds_')){
    const i=parseInt(key.slice(4));
    state.passing_shares[i].td_share=val/100;
    normalizeShares(state.passing_shares,i,'td_share');
    if(passingSubTab==='rec_tds') updatePie(state.passing_shares.map(p=>p.td_share));
    liveTDRows('tdp','tdt',state.passing_shares,teamPassTDs(state),'tds_',true);
    return;
  }
  // ── Receptions share (edit catch rates so each player hits the new rec share) ──
  if(key.startsWith('recyds_')){
    const i=parseInt(key.slice(7));
    setDerivedShare(state,team,i,val/100,'recyds');
    return;
  }
  if(key.startsWith('rec_')){
    const i=parseInt(key.slice(4));
    setDerivedShare(state,team,i,val/100,'rec');
    return;
  }
  // ── Team rush carries ──
  if(key==='rush_total_att'){
    state.rushing.total_attempts=val;
    recomputeTeamRushYards(state);
    liveRush(state,team);
    // keep the yards slider in sync (carries change → yards recompute)
    const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
    if(ys){ys.value=state.rushing.total_yards;setFill(ys,'var(--rb)');
      const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=state.rushing.total_yards;}
    return;
  }
  // ── Team total rush yards: scale each RB's Y/Carry to hit the target ──
  if(key==='rush_total_yds'){
    scaleTeamRushYards(state,val);
    liveRush(state,team);
    return;
  }
  // ── Team total RB rushing TDs ──
  if(key==='rush_total_tds'){
    state.rushing.total_rush_tds=Math.max(0,val);
    const lbl=document.getElementById('rushTDLbl'); if(lbl) lbl.textContent=`${Math.round(val)} rush TDs`;
    if(rushingSubTab==='rush_tds'){
      liveTDRows('rtdp','rtdt',state.rushing.shares,teamRushTDs(state),'rtds_',true);
    }
    return;
  }
  // ── RB carry share ──
  if(key.startsWith('rs_')){
    const i=parseInt(key.slice(3));
    state.rushing.shares[i].share=val/100;
    normalizeShares(state.rushing.shares,i,'share');
    recomputeTeamRushYards(state);
    if(rushingSubTab==='carries') updatePie(state.rushing.shares.map(p=>p.share));
    liveRushRows(state,team);
    return;
  }
  // ── Rush TD share ──
  if(key.startsWith('rtds_')){
    const i=parseInt(key.slice(5));
    state.rushing.shares[i].td_share=val/100;
    normalizeShares(state.rushing.shares,i,'td_share');
    if(rushingSubTab==='rush_tds') updatePie(state.rushing.shares.map(p=>p.td_share));
    const totalTDs=teamRushTDs(state);
    liveTDRows('rtdp','rtdt',state.rushing.shares,totalTDs,'rtds_',true);
    return;
  }
}

// ── Editable stat fields (targets, receptions, carries, ypc) ──
function editTargets(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  state.passing_shares[i].share=Math.max(0,Math.min(1,v/totalTgts));
  normalizeShares(state.passing_shares,i,'share');
  if(passingSubTab==='targets') updatePie(state.passing_shares.map(p=>p.share));
  livePassTargets(state,currentTeam);
}
function editRec(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  const projTgts=Math.max(1,Math.round(state.passing_shares[i].share*totalTgts));
  // set catch rate = rec / projected targets
  state.passing_shares[i].catch_rate=Math.max(0,Math.min(1.2,v/projTgts));
  livePassTargets(state,currentTeam);
}
function editCarries(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const tot=Math.max(1,state.rushing.total_attempts);
  state.rushing.shares[i].share=Math.max(0,Math.min(1,v/tot));
  normalizeShares(state.rushing.shares,i,'share');
  recomputeTeamRushYards(state);
  if(rushingSubTab==='carries') updatePie(state.rushing.shares.map(p=>p.share));
  liveRushRows(state,currentTeam);
  // update the team total label/derived
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
}
function editYpc(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  state.rushing.shares[i].ypc=Math.max(0,Math.min(15,v));
  recomputeTeamRushYards(state);
  liveRushRows(state,currentTeam);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${state.rushing.total_attempts} att / ${(state.rushing.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  syncRushYdsSlider(state);
}
// Edit a player's absolute rushing yards → back out Y/Carry so att×ypc = entered, feeds team total
function editRushYds(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const r=state.rushing;
  const att=Math.max(1,Math.round(r.shares[i].share*r.total_attempts));
  r.shares[i].ypc=Math.max(0,Math.min(15,v/att));
  recomputeTeamRushYards(state);
  liveRushRows(state,currentTeam);
  const lbl=document.getElementById('rushTotalLbl');
  if(lbl) lbl.textContent=`${r.total_attempts} att / ${(r.total_yards||0).toLocaleString()} yds`;
  const d=document.getElementById('rushDerived'); if(d) d.textContent=rushNote(state);
  syncRushYdsSlider(state);
}
// Edit a player's absolute rushing TDs from the carry view → grows/shrinks team rush-TD total
function editRushTDsCarry(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw);
  const totalTDs=teamRushTDs(state);
  if(isNaN(v)){liveRushRows(state,currentTeam);return;}
  markDirty();
  const others=state.rushing.shares.filter((_,j)=>j!==i).reduce((s,p)=>s+p.td_share*totalTDs,0);
  const newTotal=Math.max(0.1,others+Math.max(0,v));
  state.rushing.total_rush_tds=newTotal;
  state.rushing.shares.forEach((p,j)=>{ p.td_share=(j===i?Math.max(0,v):p.td_share*totalTDs)/newTotal; });
  liveRushRows(state,currentTeam);
}

// Scale every RB's Y/Carry proportionally so team yards = target.
function scaleTeamRushYards(state,targetYds){
  const r=state.rushing;
  markDirty();
  const cur=r.total_yards||0;
  if(cur>0){
    const factor=targetYds/cur;
    r.shares.forEach(p=>{ p.ypc=Math.max(0,Math.min(15,(p.ypc||r.ypa||4)*factor)); });
  } else if(r.total_attempts>0){
    const flat=targetYds/r.total_attempts;
    r.shares.forEach(p=>{ p.ypc=Math.max(0,Math.min(15,flat)); });
  }
  recomputeTeamRushYards(state);
}
function syncRushYdsSlider(state){
  const ys=document.querySelector('input.sl[data-key="rush_total_yds"]');
  if(ys){ys.value=state.rushing.total_yards;setFill(ys,'var(--rb)');
    const ysv=document.getElementById('sv-rush_total_yds');if(ysv&&document.activeElement!==ysv)ysv.textContent=state.rushing.total_yards;}
}

// ── Passing: editable Catch%, Receiving Yards, Y/Tgt, Receiving TDs ──
function editCatchPct(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  state.passing_shares[i].catch_rate=Math.max(0,Math.min(1.2,v/100));
  livePassTargets(state,currentTeam);
}
function editRecYds(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTgts=Math.max(1,teamTargetPool(state));
  const projTgts=Math.max(1,Math.round(state.passing_shares[i].share*totalTgts));
  // back out Y/Tgt so projected yards = entered value
  state.passing_shares[i].ypt=Math.max(0,Math.min(25,v/projTgts));
  livePassTargets(state,currentTeam);
}
function editYpt(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  state.passing_shares[i].ypt=Math.max(0,Math.min(25,v));
  livePassTargets(state,currentTeam);
}

// Set player i's share of receptions ('rec') or receiving yards ('recyds'). Works exactly
// like the target-share tab: the dragged player gets the new share, the others rebalance
// proportionally to fill the remainder. The share is stored on its own field (rec_share /
// recyds_share) and the per-player rate (catch_rate / ypt) is back-solved so totals match.
function setDerivedShare(state,team,i,share,metric){
  markDirty();
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const shares=state.passing_shares;
  ensureDerivedShares(state,metric);            // make sure the share field is populated
  shares[i][field]=Math.max(0,Math.min(1,share));
  normalizeShares(shares,i,field);              // rebalance the others (same as targets)
  // back-solve the per-player rate so the pool distributes by the new shares
  applyDerivedShares(state,metric);
  liveDerivedRows(state,team,metric);
}

// Populate rec_share / recyds_share from the current per-player values if not present.
function ensureDerivedShares(state,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const shares=state.passing_shares;
  const valOf=p=>{const tg=p.share*totalTgts;return isYds?tg*(p.ypt||9):tg*(p.catch_rate||0.65);};
  const pool=shares.reduce((s,p)=>s+valOf(p),0)||1;
  let needs=false;
  shares.forEach(p=>{ if(typeof p[field]!=='number') needs=true; });
  if(needs) shares.forEach(p=>{ p[field]=valOf(p)/pool; });
}

// Convert rec_share / recyds_share back into per-player catch_rate / ypt against the pool.
function applyDerivedShares(state,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const shares=state.passing_shares;
  // pool stays anchored to the team's available receptions / receiving yards
  const pool=isYds?teamRecYardsPool(state):teamRecPool(state);
  shares.forEach(p=>{
    const tg=Math.max(1,p.share*totalTgts);
    const target=(p[field]||0)*pool;
    if(isYds) p.ypt=Math.max(0,Math.min(40,target/tg));
    else p.catch_rate=Math.max(0,Math.min(1.5,target/tg));
  });
}

// Update the receptions/rec-yards rows + pie in place after a share edit. Mirrors
// livePassTargets: ALL sibling sliders update live (not gated by sliderDragging).
function liveDerivedRows(state,team,metric){
  const isYds=metric==='recyds';
  const field=isYds?'recyds_share':'rec_share';
  const totalTgts=Math.max(1,teamTargetPool(state));
  const pool=isYds?teamRecYardsPool(state):teamRecPool(state);
  const shares=state.passing_shares;
  shares.forEach((p,i)=>{
    const sh=p[field]||0;
    const v=Math.round(sh*pool);
    const pctEl=document.getElementById(`dp-${i}`); if(pctEl) pctEl.textContent=(sh*100).toFixed(1)+'%';
    const volEl=document.getElementById(`dv-${i}`); if(volEl) volEl.textContent=`${v.toLocaleString()} ${isYds?'rec yds':'rec'}`;
    const projTgts=Math.round(p.share*totalTgts);
    const crEl=document.getElementById(`cr-${i}`); if(crEl&&document.activeElement!==crEl) crEl.textContent=((p.catch_rate||0.65)*100).toFixed(0);
    const ydEl=document.getElementById(`yd-${i}`); if(ydEl&&document.activeElement!==ydEl) ydEl.textContent=Math.round(projTgts*(p.ypt||9));
    const yptEl=document.getElementById(`ypt-${i}`); if(yptEl&&document.activeElement!==yptEl) yptEl.textContent=(p.ypt||9).toFixed(1);
    const recEl=document.getElementById(`ed-rec-${i}`); if(recEl&&document.activeElement!==recEl) recEl.textContent=Math.round(projTgts*(p.catch_rate||0.65));
    // Update ALL sliders' fill/value (including siblings) — but never fight the one being dragged.
    const sl=document.querySelector(`input.sl[data-key="${isYds?'recyds':'rec'}_${i}"]`);
    if(sl && document.activeElement!==sl){ sl.value=(sh*100).toFixed(1); setFill(sl,sl.dataset.col||PCOLORS[i%PCOLORS.length]); }
  });
  if(pieChart) updatePie(shares.map(p=>p[field]||0));
  const sub=document.getElementById('derivedSub');
  if(sub) sub.textContent=isYds?Math.round(pool).toLocaleString()+' yds':Math.round(pool)+' rec';
}
// Edit a player's absolute receiving TDs (from the Targets view) → set td_share of team passing TDs
function editRecTDs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){livePassTargets(state,currentTeam);return;}
  markDirty();
  const totalTDs=teamPassTDs(state);
  if(totalTDs>0){
    state.passing_shares[i].td_share=Math.max(0,Math.min(1,v/totalTDs));
    normalizeShares(state.passing_shares,i,'td_share');
  }
  livePassTargets(state,currentTeam);
}
// Edit absolute receiving TDs from the TD-share view (same logic, refreshes that view)
function editRecTDsAbs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw); if(isNaN(v)){liveTDRows('tdp','tdt',state.passing_shares,teamPassTDs(state),'tds_',true);return;}
  markDirty();
  const totalTDs=teamPassTDs(state);
  if(totalTDs>0){
    state.passing_shares[i].td_share=Math.max(0,Math.min(1,v/totalTDs));
    normalizeShares(state.passing_shares,i,'td_share');
  }
  if(passingSubTab==='rec_tds') updatePie(state.passing_shares.map(p=>p.td_share));
  liveTDRows('tdp','tdt',state.passing_shares,totalTDs,'tds_',true);
}
// Edit absolute rushing TDs → adjusts that player's share AND the team total grows/shrinks
function editRushTDsAbs(i,raw){
  const state=userProj[currentTeam]; if(!state) return;
  const v=parseFloat(raw);
  const totalTDs=teamRushTDs(state);
  if(isNaN(v)){liveTDRows('rtdp','rtdt',state.rushing.shares,totalTDs,'rtds_',true);return;}
  markDirty();
  const others=state.rushing.shares.filter((_,j)=>j!==i)
    .reduce((s,p)=>s+p.td_share*totalTDs,0);
  const newTotal=Math.max(0.1,others+Math.max(0,v));
  state.rushing.total_rush_tds=newTotal;
  state.rushing.shares.forEach((p,j)=>{ p.td_share=(j===i?Math.max(0,v):p.td_share*totalTDs)/newTotal; });
  if(rushingSubTab==='rush_tds') updatePie(state.rushing.shares.map(p=>p.td_share));
  liveTDRows('rtdp','rtdt',state.rushing.shares,newTotal,'rtds_',true);
  // refresh the "X rush TDs" pie subtitle
  const sub=document.querySelector('#rushPieChart')&&document.querySelector('.pie-sub');
}

