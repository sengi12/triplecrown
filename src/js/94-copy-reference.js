// ═════════════════════════════════════════════════════════════════════════════
// Copy reference-season stats into the working (projection) set
// ═════════════════════════════════════════════════════════════════════════════
// Copy a team's reference-season production into the working set, but ONLY for players
// who are still on that team in the projection season. Players who left (traded, retired,
// signed elsewhere) are skipped; brand-new players keep their existing 2026 projection.
function copyTeamToWorking(team){
  if(activeSeason==='proj') return;
  const refSeason=activeSeason;
  const refSeasonSeed=seasonStatsCache[activeSeason]||{};
  const ref=refSeasonSeed[team]; if(!ref){ toast('Nothing to copy','err'); return; }
  // Snapshot the team's CURRENT working state AND proj-seed roster row before we touch
  // either, so this whole copy can be undone in one step (e.g. you copy 2025 Colts stats
  // onto Michael Pittman's new Steelers slot, don't like it, and want it all back exactly
  // as it was — this must run before any mutation below, not after).
  pushUndo(team);
  const ps=projSeed||seasonStatsCache['proj']||{};
  ps[team]=ps[team]||{QB:[],RB:[],WR:[],TE:[]};
  // Build the set of player_ids currently on this team (projection roster + full Sleeper DB).
  const onTeam=new Set();
  ['QB','RB','WR','TE'].forEach(pos=>(ps[team][pos]||[]).forEach(p=>p.player_id&&onTeam.add(p.player_id)));
  if(sleeperPlayers){ for(const pid in sleeperPlayers){ if(sleeperPlayers[pid].team===team) onTeam.add(pid); } }
  // The "still on the roster?" filter is only meaningful when we actually have a roster to
  // check against. When the app was loaded from a seed with no live Sleeper DB (sleeperPlayers
  // is null) AND this team's projection roster is empty, we have no way to know who's still on
  // the team — so filtering would wrongly skip EVERYONE and the button appears to do nothing.
  // In that case, copy the whole reference roster (that's the intent of "copy last season").
  const canFilter = !!sleeperPlayers || onTeam.size>0;
  let copied=0, skipped=0;
  ['QB','RB','WR','TE'].forEach(pos=>{
    (ref[pos]||[]).forEach(refp=>{
      if(!refp.player_id) return;
      if(canFilter && !onTeam.has(refp.player_id)){ skipped++; return; }   // no longer a member → skip
      const arr=ps[team][pos]||(ps[team][pos]=[]);
      const copy=deepCopy(refp); copy.team=team;
      const ex=arr.findIndex(p=>p.player_id===refp.player_id);
      if(ex>=0) arr[ex]=copy; else arr.push(copy);
      copied++;
    });
  });
  delete workingProj[team];
  activeSeason='proj'; userProj=workingProj; SEED=ps; currentTeam=team;
  dirtySinceImport=true;
  ensureTeam(team);
  saveSession();
  renderSeasonTabs(); renderSidebar(); renderContent();
  const filterNote = (!canFilter) ? ' (roster unverified — copied all; ↻ Sleeper to refine)' : (skipped?` · skipped ${skipped} no longer on roster`:'');
  toast(`Copied ${copied} ${team} player${copied===1?'':'s'} from ${refSeason}${filterNote} ✓`,'ok');
}

// Copy a single player's reference line into the working set, on the team they're
// projected to play for THIS season (falls back to their historical team).
function copyPlayerToWorking(pid,pos){
  if(activeSeason==='proj') return;
  const refSeason=activeSeason;
  const refSeasonSeed=seasonStatsCache[activeSeason]||{};
  let src=null;
  const rt=currentTeam;
  for(const p of ['QB','RB','WR','TE']){
    const e=(refSeasonSeed[rt]&&refSeasonSeed[rt][p]||[]).find(x=>x.player_id===pid);
    if(e){ src=e; break; }
  }
  if(!src){ toast('Could not find that player','err'); return; }
  const ps=projSeed||seasonStatsCache['proj']||{};
  // find where they're projected this season
  let destTeam=rt;
  outer: for(const tm in ps){ for(const p of ['QB','RB','WR','TE']){
    if((ps[tm][p]||[]).some(x=>x.player_id===pid)){ destTeam=tm; break outer; }
  }}
  // Snapshot destTeam's working state AND proj-seed roster row before ANY mutation below
  // (including creating the roster skeleton if this team never had one), so a single undo
  // fully removes this copy.
  pushUndo(destTeam);
  ps[destTeam]=ps[destTeam]||{QB:[],RB:[],WR:[],TE:[]};
  const arr=ps[destTeam][src.pos]||(ps[destTeam][src.pos]=[]);
  const copy=deepCopy(src); copy.team=destTeam;
  const ex=arr.findIndex(p=>p.player_id===pid);
  if(ex>=0) arr[ex]=copy; else arr.push(copy);
  delete workingProj[destTeam];   // rebuild that working team to include the copied line
  activeSeason='proj'; userProj=workingProj; SEED=ps; currentTeam=destTeam;
  dirtySinceImport=true;
  const sameTeam = destTeam===rt;
  ensureTeam(destTeam);
  saveSession();
  renderSeasonTabs(); renderSidebar(); renderContent();
  toast(`Copied ${src.name}'s ${refSeason} line → ${destTeam} working set ✓${sameTeam?' · back on the live build view':` · switched to ${destTeam} ${PROJ_SEASON} view`}`,'ok');
  updateUndoButton();
}

