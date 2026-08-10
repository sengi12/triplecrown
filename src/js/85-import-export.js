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
  playerNotes = (data.playerNotes && typeof data.playerNotes==='object') ? data.playerNotes : {};
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
  const projKey=p=>p.player_id!=null?('id:'+p.player_id):('nm:'+normName(p.name));

  const sn=multiAnalyst?`Avg: ${analysts.join('+')} ${merged[0]?.season||''}`
    :`${merged[0]?.analyst_name||'Imported'} ${merged[0]?.season||''}`;
  document.getElementById('scenarioName').value=sn.trim();

  const byTeam={};
  merged.forEach(p=>{if(p.team)(byTeam[p.team]=byTeam[p.team]||[]).push(p);});
  userProj={};
  workingProj=userProj;
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
        games_played:parseFloat(qb.games_played)||0,
        snap_share:1/qbs.length,
      }));
      // Games decide who counts toward team totals: teamPassAtt/teamPassTDs (and therefore
      // the receiving target pool) only include QBs with games>0. Imported files almost never
      // carry games_played, so estimate each QB's games from their share of the team's
      // projected passing yards — the same committee-aware rule the Sleeper import uses
      // (projectQBGames). This keeps a genuine timeshare (e.g. LV Cousins/Mendoza) with BOTH
      // QBs active instead of crowning the top-yardage QB with a full season and zeroing the
      // rest, which otherwise halves that team's receiving projections.
      const hasExplicitGames=state.qbs.some(q=>(q.games_played||0)>0);
      if(hasExplicitGames){
        state.qbs.forEach(q=>{ q.games=(q.games_played||0)>0?q.games_played:0; });
      } else {
        projectQBGames(state.qbs);   // sets q.games (+ q.games_played) from passing-yards share
      }
      // base_games converts each QB's SEASON totals to a per-game pace; anchor it to their
      // projected games so pace×games reproduces the imported line (a 0-game backup keeps a
      // 1-game denominator so its rate survives if dialed up later).
      state.qbs.forEach(q=>{ q.base_games=(q.games||0)>0?q.games:1; });
      // Preserve roster QBs the import omits (no passing line) at a ZERO baseline — the same
      // guarantee as the WR/RB fill below, so a backup/rookie QB on the projected roster stays
      // selectable instead of disappearing. games=0 keeps them out of team totals until dialed
      // up; appended last (gp=0) so the imported starter stays qbs[0] for snap-share assignment.
      const qbSeen=new Set(state.qbs.map(projKey));
      getBase(team,'QB').forEach(qb=>{
        const k=projKey(qb); if(qbSeen.has(k)) return; qbSeen.add(k);
        state.qbs.push({
          name:qb.name,headshot:qb.headshot||null,slug:qb.slug||null,player_id:qb.player_id||null,
          adp:parseFloat(qb.adp)||999,adp_ppr:parseFloat(qb.adp_ppr)||999,
          adp_half_ppr:parseFloat(qb.adp_half_ppr)||999,adp_2qb:parseFloat(qb.adp_2qb)||999,
          passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,interceptions_thrown:0,
          qb_rush_yards:0,qb_rush_tds:0,qb_rush_attempts:0,
          games_played:0,games:0,base_games:1,snap_share:0,
        });
      });
      assignQBSnapShares(state.qbs);
      state.activeQB=0;
    }
    const recv=[...wrs,...tes,...rbs.filter(p=>parseFloat(p.receiving_targets||0)>5)]
      .filter(p=>parseFloat(p.receiving_targets||0)>0)
      .sort((a,b)=>parseFloat(b.receiving_targets||0)-parseFloat(a.receiving_targets||0));
    // Preserve the initial projected roster: any WR/TE (or receiving RB) the import omits stays
    // selectable at a ZERO baseline — the same guarantee as copying a previous season, so a
    // player without an imported line isn't dropped as an option. ensureTeam() (above) already
    // merged the live Sleeper roster into the seed, so getBase carries the full projected corps.
    const rosterRecv=[...getBase(team,'WR'),...getBase(team,'TE'),
      ...getBase(team,'RB').filter(p=>(parseFloat(p.receiving_targets)||0)>5||(parseFloat(p.receptions)||0)>5)];
    const recvRows=[]; const recvSeen=new Set();
    recv.forEach(p=>{ const k=projKey(p); if(recvSeen.has(k)) return; recvSeen.add(k);
      recvRows.push({name:p.name,pos:p.fantasy_position,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
        tgts:parseFloat(p.receiving_targets)||0,yds:parseFloat(p.receiving_yards)||0,rec:parseFloat(p.receptions)||0,tds:parseFloat(p.receiving_touchdowns)||0,
        adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999}); });
    rosterRecv.forEach(p=>{ const k=projKey(p); if(recvSeen.has(k)) return; recvSeen.add(k);
      recvRows.push({name:p.name,pos:p.pos,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
        tgts:0,yds:0,rec:0,tds:0,
        adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999}); });
    if(recvRows.length){
      const importedTargetTotal=recvRows.reduce((s,p)=>s+p.tgts,0);
      const tot=importedTargetTotal||1;
      const totTDs=recvRows.reduce((s,p)=>s+p.tds,0)||0;
      const qbPassTDTotal=teamPassTDs(state);
      // Preserve imported receiving TD lines exactly on load by pegging share to the QB
      // passing-TD pool when available. If the file has no QB pass-TD context, fall back
      // to the receivers' own total so ratios still render deterministically.
      const tdPool=(qbPassTDTotal>0?qbPassTDTotal:totTDs);
      state.passing_shares=recvRows.map(p=>{
        return {name:p.name,pos:p.pos,headshot:p.headshot,slug:p.slug,player_id:p.player_id,
          baseline_targets:p.tgts,baseline_yards:p.yds,baseline_tds:p.tds,baseline_rec:p.rec,
          share:p.tgts/tot, td_share:tdPool>0?p.tds/tdPool:1/recvRows.length,
          ypt:p.tgts>0?p.yds/p.tgts:9, catch_rate:p.tgts>0?p.rec/p.tgts:0.65,
          adp:p.adp,adp_ppr:p.adp_ppr,adp_half_ppr:p.adp_half_ppr,adp_2qb:p.adp_2qb};
      });
      // Anchor target math to imported totals so receiver lines remain exactly as imported;
      // mismatch vs QB attempts is surfaced by the existing discrepancy banner + reconcile.
      state.team_targets=importedTargetTotal;
      state.base_pass_att=teamPassAtt(state);
    }
    const rushers=rbs.filter(p=>parseFloat(p.rushing_attempts||0)>0)
      .sort((a,b)=>parseFloat(b.rushing_attempts||0)-parseFloat(a.rushing_attempts||0));
    // Preserve roster RBs the import omits at a ZERO baseline (still selectable), mirroring the
    // copy-from-season behavior; team totals stay anchored to the imported (real) carries only.
    const rosterRush=getBase(team,'RB').filter(p=>(parseFloat(p.rushing_attempts)||0)>0||(parseFloat(p.adp)||999)<300);
    const rushRows=[]; const rushSeen=new Set();
    rushers.forEach(p=>{ const k=projKey(p); if(rushSeen.has(k)) return; rushSeen.add(k);
      rushRows.push({name:p.name,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
        att:parseFloat(p.rushing_attempts)||0,yds:parseFloat(p.rushing_yards)||0,tds:parseFloat(p.rushing_touchdowns)||0,
        adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999}); });
    rosterRush.forEach(p=>{ const k=projKey(p); if(rushSeen.has(k)) return; rushSeen.add(k);
      rushRows.push({name:p.name,headshot:p.headshot||null,slug:p.slug||null,player_id:p.player_id||null,
        att:0,yds:0,tds:0,
        adp:parseFloat(p.adp)||999,adp_ppr:parseFloat(p.adp_ppr)||999,adp_half_ppr:parseFloat(p.adp_half_ppr)||999,adp_2qb:parseFloat(p.adp_2qb)||999}); });
    if(rushRows.length){
      const tot=rushRows.reduce((s,p)=>s+p.att,0)||1;
      const totYds=rushRows.reduce((s,p)=>s+p.yds,0)||0;
      const totTDs=rushRows.reduce((s,p)=>s+p.tds,0)||0;
      state.rushing.total_attempts=tot;
      state.rushing.total_yards=totYds;
      state.rushing.ypa=tot>0?totYds/tot:4.0;
      state.rushing.total_rush_tds=totTDs;
      state.rushing.shares=rushRows.map(p=>{
        return {name:p.name,pos:'RB',headshot:p.headshot,slug:p.slug,player_id:p.player_id,
          baseline_att:p.att,baseline_yards:p.yds,baseline_tds:p.tds,
          share:p.att/tot, td_share:totTDs>0?p.tds/totTDs:1/rushRows.length,
          ypc:p.att>0?p.yds/p.att:4.0,
          adp:p.adp,adp_ppr:p.adp_ppr,adp_half_ppr:p.adp_half_ppr,adp_2qb:p.adp_2qb};
      });
    }
  });
  // Snapshot for two-stage reset
  importedSnapshot=deepCopy(userProj);
  dirtySinceImport=false;

  // Imported files define projection-season working data; force projection context and
  // bust all rankings/player caches so repeated imports cannot reuse stale rows/FPTS/VOR.
  activeSeason='proj';
  if(typeof invalidateBuildPlayerCache==='function') invalidateBuildPlayerCache();
  else if(typeof invalidateRankingsRenderCache==='function') invalidateRankingsRenderCache();

  renderSidebar();
  if(multiAnalyst) toast(`⚠️ ${analysts.length} analysts averaged: ${analysts.join(', ')}`,'ok');
  else toast(`Loaded ${merged.length} players · ${Object.keys(byTeam).length} teams`,'ok');
  if(currentPhase==='Rankings') renderContent();
  else if(currentTeam&&userProj[currentTeam]) renderContent();
  else{currentTeam=null;document.getElementById('content').innerHTML=`<div class="empty">
    <div class="empty-icon">${TC_ICON("check","tc-ico-lg")}</div><div class="empty-title">Projections loaded${multiAnalyst?' (averaged)':''}</div>
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
  return {projections:out, playerNotes:playerNotes};
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

let _dlOpen = false;

function openDownloadPicker(){
  if(_dlOpen) return;
  _dlOpen = true;
  const ov = document.createElement('div');
  ov.id = 'dlOverlay';
  ov.className = 'ps-overlay';
  ov.innerHTML = `
    <div class="ps-modal dl-modal" role="dialog" aria-label="Download projections">
      <div class="ps-head dl-head">
        <span class="ps-search-ico">${TC_ICON('download')}</span>
        <div class="dl-title-wrap">
          <div class="dl-title">Download Projections</div>
          <div class="dl-sub">Choose a file format</div>
        </div>
        <button class="ps-close" onclick="closeDownloadPicker()" aria-label="Close">${TC_ICON('close')}</button>
      </div>
      <div class="dl-actions">
        <button class="ps-row dl-row" onclick="downloadAsFormat('json')">
          <span class="dl-fmt">JSON</span>
          <span class="dl-desc">Full projections + notes metadata</span>
        </button>
        <button class="ps-row dl-row" onclick="downloadAsFormat('csv')">
          <span class="dl-fmt">CSV</span>
          <span class="dl-desc">Spreadsheet-friendly projections</span>
        </button>
      </div>
    </div>`;
  ov.addEventListener('mousedown', e=>{ if(e.target===ov) closeDownloadPicker(); });
  document.body.appendChild(ov);
}

function closeDownloadPicker(){
  _dlOpen = false;
  const el = document.getElementById('dlOverlay');
  if(el) el.remove();
}

function downloadAsFormat(fmt){
  closeDownloadPicker();
  const f = String(fmt||'').toLowerCase();
  if(f==='json') return exportJSON();
  if(f==='csv') return exportCSV();
  toast('Unknown download format','err');
}

function menuDownloadPrompt(){
  openDownloadPicker();
}

// ─────────────────────────────────────────────────────────────────────────────
// Download format menu (one ⬇ Download button → choose JSON or CSV)
// ─────────────────────────────────────────────────────────────────────────────
// ── App menu (☰) ────────────────────────────────────────────────────────────
// Replaces the old header button row. Same open/close contract as the download menu it
// supersedes: stop the opening click, then keep it open until an actual menu action is
// clicked or the user clicks outside the menu.
let _appMenuDocListenerOn = false;

function onAppMenuDocClick(e){
  const m=document.getElementById('appMenu');
  const btn=document.getElementById('appMenuBtn');
  const t=e&&e.target;
  if(!m || m.hasAttribute('hidden')){ closeAppMenu(); return; }
  if(btn && t && (t===btn || (btn.contains && btn.contains(t)))) return;
  if(t && m.contains && m.contains(t)){
    const action=(t.closest && t.closest('button.hdr-menu-item, .hdr-menu-item button, [data-menu-close="1"]')) || null;
    if(action && m.contains(action)) closeAppMenu();
    return;
  }
  closeAppMenu();
}

function toggleAppMenu(e){
  if(e) e.stopPropagation();
  const m=document.getElementById('appMenu'); if(!m) return;
  const btn=document.getElementById('appMenuBtn');
  if(m.hasAttribute('hidden')){
    m.removeAttribute('hidden');
    if(btn){ btn.classList.add('open'); btn.setAttribute('aria-expanded','true'); }
    if(!_appMenuDocListenerOn){
      document.addEventListener('click', onAppMenuDocClick);
      _appMenuDocListenerOn = true;
    }
  } else {
    closeAppMenu();
  }
}
function closeAppMenu(){
  const m=document.getElementById('appMenu'); if(m) m.setAttribute('hidden','');
  const btn=document.getElementById('appMenuBtn');
  if(btn){ btn.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
  if(_appMenuDocListenerOn){
    document.removeEventListener('click', onAppMenuDocClick);
    _appMenuDocListenerOn = false;
  }
}
// The app has two top-level VIEWS: Projections (the builder — season tabs, team sidebar) and
// the League Analyzer (snapshot-driven, season-agnostic). This returns to the former.
// Where the user was in the projections builder before they opened the League Analyzer, so
// returning puts them back rather than dumping them on Passing. Stores the phase, the team and
// the scroll offset — being returned to the right tab but the top of a long page is still a
// loss of place.
let _preLeagueView = null;
function rememberProjectionsView(){
  if(currentPhase==='League') return;   // already in the analyzer; don't overwrite the stash
  _preLeagueView = {
    phase: currentPhase,
    team: currentTeam,
    scope: (typeof rankScope!=='undefined' ? rankScope : null),
    y: window.scrollY || document.documentElement.scrollTop || 0,
  };
}
function showProjectionsView(){
  if(currentPhase==='League'){
    const v=_preLeagueView;
    // Restore the remembered spot when it's still valid; otherwise fall back as before.
    if(v && v.phase && v.phase!=='League' && (v.team ? v.team===currentTeam || !currentTeam : true)){
      if(v.team && !currentTeam) currentTeam=v.team;
      currentPhase = v.phase;
      if(v.scope && typeof rankScope!=='undefined') rankScope = v.scope;
    } else {
      currentPhase = currentTeam ? 'Passing' : 'Rankings';
    }
    renderContent();
    syncAppChrome();
    // Restore scroll after layout, clamped to the rebuilt page height.
    if(_preLeagueView && _preLeagueView.y){
      const y=_preLeagueView.y;
      requestAnimationFrame(()=>{
        const max=Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, Math.min(y, max));
      });
    }
    return;
  }
  // From global views (Rankings / league-wide Advanced), jump back into the
  // projection builder phases instead of re-rendering the same global view.
  if(currentPhase==='Rankings' || currentPhase==='AdvancedLeague'){
    const stashed = _preLeagueView && _preLeagueView.phase;
    const usableStash = stashed && !['League','Rankings','AdvancedLeague'].includes(stashed);
    currentPhase = usableStash ? stashed : 'Passing';
  }
  renderContent();
  syncAppChrome();
}
// Show/hide chrome that only belongs to one view. The season tabs do nothing in the League
// Analyzer (a snapshot isn't a season), so they'd just be dead controls taking a row of
// screen — hide them there. Also keeps the menu's view items in sync.
function syncAppChrome(){
  const setCls = (el, cls, on)=>{
    if(!el || !el.classList) return;
    if(el.classList.toggle) el.classList.toggle(cls, !!on);
    else if(on) el.classList.add(cls);
    else el.classList.remove(cls);
  };
  const setHidden = (el, hidden)=>{
    if(!el) return;
    if(hidden){
      if(typeof el.setAttribute==='function') el.setAttribute('hidden','');
      else el.hidden = true;
    } else {
      if(typeof el.removeAttribute==='function') el.removeAttribute('hidden');
      else el.hidden = false;
    }
  };
  const phase = String((typeof currentPhase!=='undefined' && currentPhase) || '');
  const inLeague = (phase==='League' || phase==='AdvancedLeague');
  const inRankings = phase==='Rankings';
  const inProjections = !inLeague && !inRankings;
  const viewLabel = inProjections ? 'Projections' : (inRankings ? 'Rankings' : 'Leagues');
  // Season tabs AND the NFL team sidebar are both projection-builder chrome: a snapshot
  // isn't a season, and picking the Lions does nothing to your dynasty league. Hiding both
  // in the analyzer removes two dead controls and ~75px of vertical space on a phone.
  const bar=document.getElementById('seasonBar');
  setCls(bar, 'hidden-view', inLeague);
  const side=document.getElementById('sidebar');
  setCls(side, 'hidden-view', inLeague);
  const mp=document.getElementById('menuProjView');
  const mr=document.getElementById('menuRankView');
  const ml=document.getElementById('menuLeagueView');
  setCls(mp, 'active', inProjections);
  setCls(mr, 'active', inRankings);
  setCls(ml, 'active', inLeague);

  document.querySelectorAll('.menu-view-proj').forEach(el=>{
    setHidden(el, !inProjections);
  });
  document.querySelectorAll('.menu-view-rank').forEach(el=>{
    setHidden(el, !inRankings);
  });
  document.querySelectorAll('.menu-view-league').forEach(el=>{
    setHidden(el, !inLeague);
  });

  const viewSpecificSec = document.getElementById('menuViewSpecificSec');
  if(viewSpecificSec) viewSpecificSec.textContent = `View-specific: ${viewLabel}`;

  if(typeof refreshLeagueSyncBtn==='function') refreshLeagueSyncBtn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset — clear all edits and re-pull the latest Sleeper projections
// ─────────────────────────────────────────────────────────────────────────────
async function resetAll(){
  if(!confirm('Reset all projections and pull the latest projections from Sleeper?\n\nThis clears your current edits and imported/loaded data.')) return;
  userProj={}; workingProj=userProj; importedSnapshot=null; dirtySinceImport=false;
  playerNotes={};
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
syncAppChrome();

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
(async function boot(){
  const hasEmbeddedProj = SEED && Object.keys(SEED).some(t=>SEED[t] && (SEED[t].QB.length||SEED[t].RB.length||SEED[t].WR.length||SEED[t].TE.length));
  const hasEmbeddedECR  = ECR && Object.keys(ECR).some(f=>ECR[f] && Object.keys(ECR[f]).length);
  if(!hasEmbeddedProj && typeof syncProjSeasonFromSleeper==='function'){
    await syncProjSeasonFromSleeper();
  }
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
    // Also refresh projection-season ADP live in the background so VONA/VOR stay current without a rebuild.
    backgroundRefreshADP();
    return;
  }
  document.getElementById('content').innerHTML=`<div class="empty">
    <div class="empty-icon">${TC_ICON("signal","tc-ico-lg")}</div><div class="empty-title">Loading ${PROJ_SEASON} data…</div>
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
    // gz-first: build_seed ships a pre-compressed .json.gz twin — ~5x smaller on hosts that
    // don't compress, never worse (fetchSeedJson falls back to plain .json automatically).
    const raw = await fetchSeedJson('seeds/triplecrown_seed.json');
    if(!raw) return false;
    const j = decodeAnySeed(raw);
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
    if(j.dynasty_values){ DYNASTY_VALUES=j.dynasty_values; got=true;
      if(typeof laOnValuesLoaded==="function") laOnValuesLoaded(); }   // FP dynasty trade values → refresh analyzer
    if(j.nflverse){ NFLVERSE=j.nflverse; if(typeof resetNflverseLazy==='function') resetNflverseLazy(); got=true; }   // nflverse advanced metrics payload (heavy sections lazy-load)
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
      if(typeof prewarmRankingsFromSeed==='function') prewarmRankingsFromSeed();
    }
    return got;
  }catch(e){
    // CORS (file://) or network error — expected when opened directly; fall back silently.
    return false;
  }
}


