// ═════════════════════════════════════════════════════════════════════════════
// Load a prebuilt seed file (triplecrown_seed.json from build_seed.py)
// This is the no-edit path: run the script, then load the JSON here.
// ═════════════════════════════════════════════════════════════════════════════
function triggerSeedLoad(){ document.getElementById('seedFile').click(); }
function handleSeedLoad(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const j=JSON.parse(ev.target.result);
      // Accept the file if it has EITHER projections or ECR (an ECR-only seed is valid —
      // it still populates the rankings ECR/Tier columns).
      const hasSeed = j.seed && Object.keys(j.seed).length;
      const hasECR  = j.ecr && Object.keys(j.ecr).some(k=>j.ecr[k] && Object.keys(j.ecr[k]).length);
      if(!hasSeed && !hasECR) throw new Error('Not an triplecrown_seed.json (no "seed" projections or "ecr" data found)');
      if(j.ecr) ECR=j.ecr;   // FantasyPros ECR (replaces ADP) — set FIRST so it survives even if seed is empty
      if(j.contracts) CONTRACTS=j.contracts;   // OverTheCap contracts (dynasty Age/APY/FA)
      if(j.sharp) SHARP=j.sharp;   // Warren Sharp advanced offensive stats
      if(j.sos) SOS=j.sos;   // 2026 strength of schedule
      if(j.team_names) TEAM_NAMES=j.team_names;   // full team display names
      if(j.coordinators) COORDINATORS=j.coordinators;   // OC/DC from Wikipedia
      if(j.hc_playcallers) HC_PLAYCALLERS=j.hc_playcallers;   // HC-as-playcaller list
      if(j.hc_history) HC_HISTORY=j.hc_history;   // HC former-team history
      if(j.additions) ADDITIONS=j.additions;   // Spotrac roster changes
      if(j.sharp_season) SHARP_SEASON=j.sharp_season;   // season the Sharp stats describe
      if(j.sumer){ SUMER=j.sumer; SUMER_SEASONS=j.sumer_seasons||Object.keys(j.sumer); }   // SumerSports advanced per-player stats
      if(j.ktc) KTC=j.ktc;   // KeepTradeCut dynasty player-page slugs (player-card links)
      if(j.nflverse) NFLVERSE=j.nflverse;   // nflverse advanced metrics (opt-in A/B source)
      if(hasSeed){
        SEED=j.seed; rosterMergedTeams.clear();
        HISTORY=j.history||{};
        HISTORY_SEASONS=j.history_seasons||[];
        seasonStatsCache={proj:SEED};
        projSeed=SEED;
        workingProj={}; userProj=workingProj; importedSnapshot=null; dirtySinceImport=false; activeSeason='proj';
        currentTeam=null;
      }
      renderSeasonTabs(); renderSidebar();
      // If the rankings page is open, re-render it so ECR/Tier appear immediately.
      if(currentPhase==='Rankings') renderRankings();
      else document.getElementById('content').innerHTML=emptyHTML();
      const n=hasSeed?Object.values(SEED).reduce((s,t)=>s+t.QB.length+t.RB.length+t.WR.length+t.TE.length,0):0;
      const ecrN=hasECR?Object.keys(ecrTableFor(rankFormat)||{}).length:0;
      toast(`Loaded seed${n?`: ${n} players, ${HISTORY_SEASONS.length} prior seasons`:''}${ecrN?` · ${ecrN} ECR ranks`:''} ✓`,'ok');
    }catch(err){ toast('Seed load failed: '+err.message,'err'); }
  };
  r.readAsText(f); e.target.value='';
}

