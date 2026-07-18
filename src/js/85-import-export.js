// Import — with corrected multi-analyst averaging
// ─────────────────────────────────────────────────────────────────────────────
function triggerImport(){document.getElementById('importFile').click();}
function handleImport(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const p=JSON.parse(ev.target.result);
      if(!p.projections||!Array.isArray(p.projections)) throw new Error('Expected {projections:[...]}');
      loadProjections(p);
    }catch(err){toast('Import failed: '+err.message,'err');}
  };
  r.readAsText(f); e.target.value='';
}

// Average a group of same-player rows across analysts.
// IMPORTANT: receiving_targets can be a string; parse defensively. Average each
// numeric field independently (true per-field mean) to match expectations.
function averageGroup(group){
  if(group.length===1) return {...group[0]};
  const out={...group[0]};
  const NUM=['passing_yards','passing_touchdowns','passing_completions','passing_attempts',
    'rushing_yards','rushing_touchdowns','rushing_attempts','rushing_yards_per_attempt',
    'receptions','receiving_yards','receiving_touchdowns','receiving_yards_per_reception',
    'receiving_targets','interceptions_thrown','fumbles_lost','risk','upside',
    'adp','adp_ppr','adp_half_ppr','adp_2qb'];
  NUM.forEach(k=>{
    let sum=0,cnt=0;
    group.forEach(p=>{
      let v=p[k];
      if(v===null||v===undefined||v==='') return;
      v=parseFloat(v);
      if(!isNaN(v)){sum+=v;cnt++;}
    });
    out[k]= cnt>0 ? sum/cnt : 0;
  });
  out.analyst_name=[...new Set(group.map(p=>p.analyst_name).filter(Boolean))].join('+');
  return out;
}

function loadProjections(data){
  const players=data.projections;
  // Group by player_id when present, else name+team. Only treat as "same player"
  // when BOTH id matches AND team matches (avoids merging a traded player's two teams).
  const useIds=players.some(p=>p.player_id!==undefined&&p.player_id!==null);
  const groupsMap={};
  players.forEach(p=>{
    const idPart=useIds?(p.player_id!=null?p.player_id:('name:'+p.name)):('name:'+p.name);
    const key=`${idPart}::${p.team||'FA'}::${p.fantasy_position||'?'}`;
    (groupsMap[key]=groupsMap[key]||[]).push(p);
  });
  const groups=Object.values(groupsMap);
  const multiAnalyst=groups.some(g=>g.length>1);
  const analysts=[...new Set(players.map(p=>p.analyst_name).filter(Boolean))];
  const merged=groups.map(averageGroup);

  const sn=multiAnalyst?`Avg: ${analysts.join('+')} ${merged[0]?.season||''}`
    :`${merged[0]?.analyst_name||'Imported'} ${merged[0]?.season||''}`;
  document.getElementById('scenarioName').value=sn.trim();

  const byTeam={};
  merged.forEach(p=>{if(p.team)(byTeam[p.team]=byTeam[p.team]||[]).push(p);});
  userProj={};
  TEAMS.forEach(team=>{
    const tp=byTeam[team]; if(!tp||!tp.length) return;
    const qbs=tp.filter(p=>p.fantasy_position==='QB'
      && (parseFloat(p.passing_attempts)>0 || parseFloat(p.passing_yards)>0 || parseFloat(p.games_played)>0))
      .sort((a,b)=>b.passing_yards-a.passing_yards);
    const wrs=tp.filter(p=>p.fantasy_position==='WR');
    const tes=tp.filter(p=>p.fantasy_position==='TE');
    const rbs=tp.filter(p=>p.fantasy_position==='RB');
    ensureTeam(team,qbs.length?qbs:null);
    const state=userProj[team];
    if(qbs.length){
      state.qbs=qbs.map((qb,i)=>({
        name:qb.name,headshot:qb.headshot||null,slug:qb.slug||null,player_id:qb.player_id||null,
        adp:parseFloat(qb.adp)||999,adp_ppr:parseFloat(qb.adp_ppr)||999,
        adp_half_ppr:parseFloat(qb.adp_half_ppr)||999,adp_2qb:parseFloat(qb.adp_2qb)||999,
        passing_yards:parseFloat(qb.passing_yards)||0,
        passing_tds:parseFloat(qb.passing_touchdowns)||0,
        passing_attempts:parseFloat(qb.passing_attempts)||0,
        passing_completions:parseFloat(qb.passing_completions)||0,
        interceptions_thrown:parseFloat(qb.interceptions_thrown)||0,
        qb_rush_yards:parseFloat(qb.rushing_yards)||0,
        qb_rush_tds:parseFloat(qb.rushing_touchdowns)||0,
        qb_rush_attempts:parseFloat(qb.rushing_attempts)||0,
        // games is what teamPassAtt/teamPassTDs/etc. now check (0-game QBs are excluded
        // from team totals). Imported data rarely carries games_played, so default the
        // primary (first/highest-yardage) QB to a full season — same rule ensureTeam uses.
        games_played:parseFloat(qb.games_played)||0,
        games:parseFloat(qb.games_played)>0?parseFloat(qb.games_played):(i===0?SEASON_GAMES:0),
        base_games:parseFloat(qb.games_played)>0?parseFloat(qb.games_played):(i===0?SEASON_GAMES:1),
        snap_share:1/qbs.length,
      }));
      assignQBSnapShares(state.qbs);
      state.activeQB=0;
    }
    const recv=[...wrs,...tes,...rbs.filter(p=>parseFloat(p.receiving_targets||0)>5)]
      .filter(p=>parseFloat(p.receiving_targets||0)>0)
      .sort((a,b)=>parseFloat(b.receiving_targets||0)-parseFloat(a.receiving_targets||0));
    if(recv.length){
      const tot=recv.reduce((s,p)=>s+parseFloat(p.receiving_targets||0),0)||1;
      const totTDs=recv.reduce((s,p)=>s+(parseFloat(p.receiving_touchdowns)||0),0)||0;
      state.passing_shares=recv.map(p=>{
        const tgts=parseFloat(p.receiving_targets)||0;
        const yds=parseFloat(p.receiving_yards)||0;
        const rec=parseFloat(p.receptions)||0;
        return {name:p.name,pos:p.fantasy_position,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
          baseline_targets:tgts,baseline_yards:yds,baseline_tds:parseFloat(p.receiving_touchdowns)||0,baseline_rec:rec,
          share:tgts/tot, td_share:totTDs>0?(parseFloat(p.receiving_touchdowns)||0)/totTDs:1/recv.length,
          ypt:tgts>0?yds/tgts:9, catch_rate:tgts>0?rec/tgts:0.65,
          adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999};
      });
    }
    const rushers=rbs.filter(p=>parseFloat(p.rushing_attempts||0)>0)
      .sort((a,b)=>parseFloat(b.rushing_attempts||0)-parseFloat(a.rushing_attempts||0));
    if(rushers.length){
      const tot=rushers.reduce((s,p)=>s+parseFloat(p.rushing_attempts||0),0)||1;
      const totYds=rushers.reduce((s,p)=>s+parseFloat(p.rushing_yards||0),0)||0;
      const totTDs=rushers.reduce((s,p)=>s+(parseFloat(p.rushing_touchdowns)||0),0)||0;
      state.rushing.total_attempts=tot;
      state.rushing.total_yards=totYds;
      state.rushing.ypa=tot>0?totYds/tot:4.0;
      state.rushing.total_rush_tds=totTDs;
      state.rushing.shares=rushers.map(p=>{
        const att=parseFloat(p.rushing_attempts)||0;
        const yds=parseFloat(p.rushing_yards)||0;
        return {name:p.name,pos:'RB',headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
          baseline_att:att,baseline_yards:yds,baseline_tds:parseFloat(p.rushing_touchdowns)||0,
          share:att/tot, td_share:totTDs>0?(parseFloat(p.rushing_touchdowns)||0)/totTDs:1/rushers.length,
          ypc:att>0?yds/att:4.0,
          adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999};
      });
    }
  });
  // Snapshot for two-stage reset
  importedSnapshot=deepCopy(userProj);
  dirtySinceImport=false;

  renderSidebar();
  if(multiAnalyst) toast(`⚠️ ${analysts.length} analysts averaged: ${analysts.join(', ')}`,'ok');
  else toast(`Loaded ${merged.length} players · ${Object.keys(byTeam).length} teams`,'ok');
  if(currentTeam&&userProj[currentTeam]) renderContent();
  else{currentTeam=null;document.getElementById('content').innerHTML=`<div class="empty">
    <div class="empty-icon">✅</div><div class="empty-title">Projections loaded${multiAnalyst?' (averaged)':''}</div>
    <div class="empty-body">${merged.length} players · ${analysts.length>1?analysts.join(', ')+' averaged':'analyst: '+(analysts[0]||'n/a')}<br>Select any team to review and edit.</div></div>`;}
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────
function buildOutput(){
  const analyst=document.getElementById('scenarioName').value||'Me';
  const out=[];
  TEAMS.forEach(team=>{
    const state=userProj[team]; if(!state) return;
    const totalTgts=teamTargetPool(state);
    const totalPassTDs=teamPassTDs(state);
    state.qbs.forEach(qb=>{
      const bp=getBase(team,'QB').find(x=>x.name===qb.name)||getBase(team,'QB')[0]||{};
      out.push({season:PROJ_SEASON,analyst_name:analyst,name:qb.name,fantasy_position:'QB',team,
        headshot:qb.headshot||null,slug:qb.slug||null,
        passing_yards:Math.round(qb.passing_yards),passing_touchdowns:Math.round(qb.passing_tds),
        passing_attempts:Math.round(qb.passing_attempts),passing_completions:Math.round(qb.passing_completions),
        interceptions_thrown:Math.round(qb.interceptions_thrown),
        rushing_yards:Math.round(qb.qb_rush_yards),rushing_touchdowns:Math.round(qb.qb_rush_tds),
        rushing_attempts:Math.round(qb.qb_rush_attempts),
        rushing_yards_per_attempt:qb.qb_rush_attempts>0?+(qb.qb_rush_yards/qb.qb_rush_attempts).toFixed(2):0,
        receptions:0,receiving_yards:0,receiving_touchdowns:0,receiving_targets:'0',receiving_yards_per_reception:0,
        fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
        bye_week:bp.bye_week||null});
    });
    if(state.passing_shares){
      state.passing_shares.forEach(p=>{
        const projTgts=Math.round(p.share*totalTgts);
        const projRec=Math.round(projTgts*(p.catch_rate||0.65));
        const projYds=Math.round(projTgts*(p.ypt||9));
        const projTDs=+(p.td_share*totalPassTDs).toFixed(1);
        const bp=[...getBase(team,'WR'),...getBase(team,'TE'),...getBase(team,'RB')].find(x=>x.name===p.name)||{};
        const ex=out.findIndex(x=>x.name===p.name&&x.team===team);
        const rec={receptions:projRec,receiving_yards:projYds,receiving_touchdowns:projTDs,
          receiving_targets:projTgts.toString(),receiving_yards_per_reception:projRec>0?+(projYds/projRec).toFixed(2):0};
        if(ex>=0) Object.assign(out[ex],rec);
        else out.push({season:PROJ_SEASON,analyst_name:analyst,name:p.name,fantasy_position:p.pos,team,
          headshot:p.headshot||null,slug:p.slug||null,
          passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          rushing_yards:bp.rushing_yards||0,rushing_touchdowns:0,rushing_attempts:bp.rushing_attempts||0,rushing_yards_per_attempt:0,
          ...rec,fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
          bye_week:bp.bye_week||null});
      });
    }
    if(state.rushing.shares){
      const r=state.rushing;
      const totRushTDs=teamRushTDs(state);
      r.shares.forEach(p=>{
        const att=Math.round(p.share*r.total_attempts);
        const yds=Math.round(att*(p.ypc||r.ypa||4));
        const tds=+(p.td_share*totRushTDs).toFixed(1);
        const bp=getBase(team,'RB').find(x=>x.name===p.name)||{};
        const ex=out.findIndex(x=>x.name===p.name&&x.team===team);
        const rush={rushing_yards:yds,rushing_touchdowns:tds,rushing_attempts:att,
          rushing_yards_per_attempt:att>0?+(yds/att).toFixed(2):0};
        if(ex>=0) Object.assign(out[ex],rush);
        else out.push({season:PROJ_SEASON,analyst_name:analyst,name:p.name,fantasy_position:'RB',team,
          headshot:p.headshot||null,slug:p.slug||null,
          passing_yards:0,passing_touchdowns:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          ...rush,receptions:0,receiving_yards:0,receiving_touchdowns:0,receiving_targets:'0',receiving_yards_per_reception:0,
          fumbles_lost:0,adp:bp.adp||999,adp_ppr:bp.adp_ppr||999,adp_half_ppr:bp.adp_half_ppr||999,adp_2qb:bp.adp_2qb||999,
          bye_week:bp.bye_week||null});
      });
    }
  });
  return {projections:out};
}
function dlFile(content,filename,mime){
  const b64=btoa(unescape(encodeURIComponent(content)));
  const a=document.createElement('a');
  a.href=`data:${mime};charset=utf-8;base64,${b64}`;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}
function exportJSON(){
  const d=buildOutput();
  if(!d.projections.length){toast('No projections to export','err');return;}
  const n=(document.getElementById('scenarioName').value||'projections').replace(/[^a-z0-9]/gi,'_');
  dlFile(JSON.stringify(d,null,2),`${n}.json`,'application/json');
  toast(`Exported ${d.projections.length} players ✓`,'ok');
}
function exportCSV(){
  const d=buildOutput();
  if(!d.projections.length){toast('No projections','err');return;}
  const keys=Object.keys(d.projections[0]);
  const csv=[keys.join(','),...d.projections.map(r=>keys.map(k=>{
    const v=r[k];return(v===null||v===undefined)?'':String(v).includes(',')?`"${v}"`:v;}).join(','))].join('\n');
  const n=(document.getElementById('scenarioName').value||'projections').replace(/[^a-z0-9]/gi,'_');
  dlFile(csv,`${n}.csv`,'text/csv');toast('CSV exported ✓','ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// Download format menu (one ⬇ Download button → choose JSON or CSV)
// ─────────────────────────────────────────────────────────────────────────────
// ── App menu (☰) ────────────────────────────────────────────────────────────
// Replaces the old header button row. Same open/close contract as the download menu it
// supersedes: stop the opening click, then close on the next outside click (a menu-item
// click bubbles here too, so choosing an action closes the menu after it fires).
function toggleAppMenu(e){
  if(e) e.stopPropagation();
  const m=document.getElementById('appMenu'); if(!m) return;
  const btn=document.getElementById('appMenuBtn');
  if(m.hasAttribute('hidden')){
    m.removeAttribute('hidden');
    if(btn){ btn.classList.add('open'); btn.setAttribute('aria-expanded','true'); }
    setTimeout(()=>document.addEventListener('click', closeAppMenu, {once:true}), 0);
  } else {
    closeAppMenu();
  }
}
function closeAppMenu(){
  const m=document.getElementById('appMenu'); if(m) m.setAttribute('hidden','');
  const btn=document.getElementById('appMenuBtn');
  if(btn){ btn.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
}
// The app has two top-level VIEWS: Projections (the builder — season tabs, team sidebar) and
// the League Analyzer (snapshot-driven, season-agnostic). This returns to the former.
function showProjectionsView(){
  if(currentPhase==='League') currentPhase = currentTeam ? 'Passing' : 'Rankings';
  renderContent();
  syncAppChrome();
}
// Show/hide chrome that only belongs to one view. The season tabs do nothing in the League
// Analyzer (a snapshot isn't a season), so they'd just be dead controls taking a row of
// screen — hide them there. Also keeps the menu's view items in sync.
function syncAppChrome(){
  const inLeague = (typeof currentPhase!=='undefined' && currentPhase==='League');
  // Season tabs AND the NFL team sidebar are both projection-builder chrome: a snapshot
  // isn't a season, and picking the Lions does nothing to your dynasty league. Hiding both
  // in the analyzer removes two dead controls and ~75px of vertical space on a phone.
  const bar=document.getElementById('seasonBar');
  if(bar) bar.classList.toggle('hidden-view', inLeague);
  const side=document.getElementById('sidebar');
  if(side) side.classList.toggle('hidden-view', inLeague);
  const mp=document.getElementById('menuProjView'), ml=document.getElementById('menuLeagueView');
  if(mp) mp.classList.toggle('active', !inLeague);
  if(ml) ml.classList.toggle('active', inLeague);
  // League actions only exist once there's a snapshot to act on.
  const hasSnap = (typeof leagueSnapshot!=='undefined' && !!leagueSnapshot);
  document.querySelectorAll('.la-menu-only').forEach(el=>{
    if(hasSnap) el.removeAttribute('hidden'); else el.setAttribute('hidden','');
  });
  if(typeof refreshLeagueSyncBtn==='function') refreshLeagueSyncBtn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset — clear all edits and re-pull the latest Sleeper projections
// ─────────────────────────────────────────────────────────────────────────────
async function resetAll(){
  if(!confirm('Reset all projections and pull the latest projections from Sleeper?\n\nThis clears your current edits and imported/loaded data.')) return;
  userProj={}; workingProj=userProj; importedSnapshot=null; dirtySinceImport=false;
  currentTeam=null; undoStacks={};
  clearSession();   // wipe the saved session so the fresh pull isn't overwritten on next boot
  // refreshFromSleeper resets the working set to the fresh seed, re-renders, and toasts.
  await refreshFromSleeper();
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
seasonStatsCache['proj'] = SEED;
projSeed = SEED;
renderSeasonTabs();
renderSidebar();

// If no seed is embedded (the default now — we pull live from Sleeper), fetch the
// current-season projections automatically on first load. A prebuilt triplecrown_seed.json
// (via the 📦 Seed button) or ↻ Sleeper can refresh/replace it at any time.
//
// On boot we ALSO try to fetch triplecrown_seed.json sitting next to the HTML, so the
// FantasyPros ECR (and any prebuilt projections/history) load automatically without a
// manual 📦 click. This works when the file is served over http(s); on a bare file://
// open the browser blocks it (CORS), and we silently fall back to the live Sleeper pull.
// Close the player card on Escape.
if(document&&document.addEventListener) document.addEventListener('keydown', e=>{ if(e.key==='Escape' && pcardOpen) closePlayerCard(); });
(function boot(){
  const hasEmbeddedProj = SEED && Object.keys(SEED).some(t=>SEED[t] && (SEED[t].QB.length||SEED[t].RB.length||SEED[t].WR.length||SEED[t].TE.length));
  const hasEmbeddedECR  = ECR && Object.keys(ECR).some(f=>ECR[f] && Object.keys(ECR[f]).length);
  // If a seed was baked into this file (bake_seed.py), everything is already in memory —
  // no fetch, so it works when opened directly from a phone (file://) with no CORS issue.
  if(hasEmbeddedProj){
    const restored = restoreSession();
    _persistReady = true;
    renderSeasonTabs(); renderSidebar(); document.getElementById('content').innerHTML=emptyHTML();
    toast(`Loaded embedded seed${hasEmbeddedECR?' · ECR ready':''}${restored?' · session restored':''} ✓`,'ok');
    // Best-effort: pull the Sleeper player DB in the background so roster-membership checks
    // (used by "copy team to working set") have real data. Harmless if it fails (file://).
    loadSleeperPlayers(true).catch(()=>{});
    // Also refresh 2026 ADP live in the background so VONA/VOR stay current without a rebuild.
    backgroundRefreshADP();
    return;
  }
  document.getElementById('content').innerHTML=`<div class="empty">
    <div class="empty-icon">📡</div><div class="empty-title">Loading ${PROJ_SEASON} data…</div>
    <div class="empty-body">Checking for a prebuilt seed, then pulling live from Sleeper if needed.</div></div>`;
  // No embedded projections. Try a local seed file (works when served over http), which at
  // minimum gives us ECR; then fall back to a live Sleeper pull for projections.
  tryAutoLoadSeed().then(loaded=>{
    const hasProj = SEED && Object.keys(SEED).some(t=>SEED[t] && (SEED[t].QB.length||SEED[t].RB.length||SEED[t].WR.length||SEED[t].TE.length));
    if(hasProj){
      const restored = restoreSession();
      _persistReady = true;
      renderSeasonTabs(); renderSidebar(); document.getElementById('content').innerHTML=emptyHTML();
      if(restored) toast('Session restored ✓','ok');
      // Same background load so copy-to-working can verify current rosters.
      loadSleeperPlayers(true).catch(()=>{});
      backgroundRefreshADP();
    }
    else refreshFromSleeper(true);   // ECR (if any) already adopted by tryAutoLoadSeed; restore happens there
  });
})();

// ── Resume / back-forward-cache recovery ─────────────────────────────────────
// Mobile browsers freeze a backgrounded tab in the bfcache and later restore the frozen DOM
// WITHOUT re-running any scripts. If the page was mid-load (or the OS discarded the renderer
// and repainted a stale frame) when you switched away, coming back showed a blank/half-loaded
// app until a manual refresh forced a fresh execution. boot() is a run-once IIFE, so nothing
// re-rendered on its own. These handlers fix that:
//   • pageshow{persisted:true} — a genuine bfcache restore. The JS heap is intact, so we just
//     re-render the current view rather than reload (instant, keeps your working edits).
//   • visibilitychange — when the tab becomes visible again, verify the content actually
//     rendered; if the seed is in memory but the DOM is empty (a discarded/stale paint),
//     re-render. Only if the seed itself is gone (heap was wiped) do we hard-reload.
(function installResumeRecovery(){
  if(typeof window==='undefined' || !window.addEventListener) return;

  // Is the app's data actually in memory right now?
  function seedInMemory(){
    try{ return typeof SEED!=='undefined' && SEED && Object.keys(SEED).some(t=>SEED[t] &&
      (SEED[t].QB.length||SEED[t].RB.length||SEED[t].WR.length||SEED[t].TE.length)); }
    catch(e){ return false; }
  }
  // Did the current view actually paint something?
  function contentRendered(){
    const c=document.getElementById('content');
    return !!c && c.innerHTML && c.innerHTML.trim().length>40;
  }
  // Re-render whatever view we're on, without touching data or re-fetching.
  function rerender(){
    try{
      if(typeof renderSeasonTabs==='function') renderSeasonTabs();
      if(typeof renderSidebar==='function') renderSidebar();
      if(typeof renderContent==='function') renderContent();
      else if(typeof emptyHTML==='function'){ const c=document.getElementById('content'); if(c) c.innerHTML=emptyHTML(); }
      if(typeof syncAppChrome==='function') syncAppChrome();
    }catch(e){ /* if a re-render throws, the reload path below is the safety net */ }
  }

  let _recoverAt=0;
  function recover(reason){
    // Debounce duplicate events (some browsers emit pageshow AND visibilitychange together) —
    // but NEVER swallow a recovery when the view is actually broken. A blank content div must
    // always be repaired, even if we just ran; only skip the redundant re-render of a view
    // that's already fine.
    const now=Date.now();
    const broken=!contentRendered();
    if(!broken && now-_recoverAt < 1200) return;
    _recoverAt=now;
    if(seedInMemory()){
      // Heap survived — cheapest correct fix is to re-render the frozen/blank view.
      if(broken || reason==='pageshow') rerender();
      // The dynasty-value table (DYNASTY_VALUES) is a SEPARATE global from SEED and may have
      // been dropped/emptied while SEED survived, which would show the analyzer with every
      // value, rank and persona at 0. If we're in the League view and the values look empty,
      // pull the seed again and re-render once it lands.
      try{
        if(typeof currentPhase!=='undefined' && currentPhase==='League'){
          const valsEmpty = !(typeof DYNASTY_VALUES!=='undefined' && DYNASTY_VALUES &&
                              DYNASTY_VALUES.players && Object.keys(DYNASTY_VALUES.players).length);
          if(valsEmpty && typeof tryAutoLoadSeed==='function'){
            tryAutoLoadSeed().then(()=>{
              if(typeof _laTierVals!=='undefined') _laTierVals=null;         // rebuild against fresh values
              if(typeof _laPosRankCache!=='undefined') _laPosRankCache=null;
              rerender();
            }).catch(()=>{});
          }
        }
      }catch(e){}
    } else if(_persistReady){
      // The renderer was discarded and the heap wiped, but we HAD booted once. A reload will
      // re-run boot() and restore the session from localStorage. This is the rare hard case.
      location.reload();
    }
    // If we never finished booting (!_persistReady, no seed), boot() is still in flight — leave it alone.
  }

  window.addEventListener('pageshow', e=>{ if(e.persisted) recover('pageshow'); });
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='visible') recover('visible');
  });
})();

// Attempt to fetch triplecrown_seed.json next to the page. Returns true if it loaded anything
// useful (at minimum ECR). Never throws — a file:// open or missing file just returns false.
async function tryAutoLoadSeed(){
  try{
    const res = await fetch('seeds/triplecrown_seed.json', {cache:'no-store'});
    if(!res.ok) return false;
    const j = decodeAnySeed(await res.json());
    let got=false;
    if(j.ecr){ ECR=j.ecr; got=true; }
    if(j.contracts){ CONTRACTS=j.contracts; got=true; }
    if(j.sharp){ SHARP=j.sharp; got=true; }
    if(j.sos){ SOS=j.sos; got=true; }
    if(j.team_names){ TEAM_NAMES=j.team_names; got=true; }
    if(j.coordinators){ COORDINATORS=j.coordinators; got=true; }
    if(j.hc_playcallers){ HC_PLAYCALLERS=j.hc_playcallers; got=true; }
    if(j.hc_history){ HC_HISTORY=j.hc_history; got=true; }
    if(j.additions){ ADDITIONS=j.additions; got=true; }
    if(j.sharp_season){ SHARP_SEASON=j.sharp_season; got=true; }
    if(j.sumer){ SUMER=j.sumer; SUMER_SEASONS=j.sumer_seasons||Object.keys(j.sumer); got=true; }
    if(j.ktc){ KTC=j.ktc; got=true; }   // KeepTradeCut dynasty player-page slugs (player-card links)
    if(j.dynasty_values){ DYNASTY_VALUES=j.dynasty_values; got=true; }   // FP dynasty trade values
    if(j.nflverse){ NFLVERSE=j.nflverse; if(typeof resetNflverseLazy==='function') resetNflverseLazy(); got=true; }   // nflverse advanced metrics (opt-in A/B source; heavy sections lazy-load)
    // Only adopt prebuilt projections/history if present and non-trivial.
    if(j.seed && Object.keys(j.seed).length){
      SEED=j.seed; projSeed=SEED; seasonStatsCache={proj:SEED}; rosterMergedTeams.clear();
      HISTORY=j.history||{}; HISTORY_SEASONS=j.history_seasons||[];
      workingProj={}; userProj=workingProj; activeSeason='proj';
      got=true;
    }
    if(got){
      const n=j.seed?Object.values(j.seed).reduce((s,t)=>s+(t.QB||[]).length+(t.RB||[]).length+(t.WR||[]).length+(t.TE||[]).length,0):0;
      const ecrN=j.ecr?Object.keys(ecrTableFor(rankFormat)||{}).length:0;
      toast(`Auto-loaded seed${ecrN?` · ${ecrN} ECR ranks`:''}${n?` · ${n} players`:''} ✓`,'ok');
    }
    return got;
  }catch(e){
    // CORS (file://) or network error — expected when opened directly; fall back silently.
    return false;
  }
}


