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
  let copied=0, skipped=0, zeroed=0;
  const copiedIds=new Set();
  ['QB','RB','WR','TE'].forEach(pos=>{
    (ref[pos]||[]).forEach(refp=>{
      if(!refp.player_id) return;
      if(canFilter && !onTeam.has(refp.player_id)){ skipped++; return; }   // no longer a member → skip
      const arr=ps[team][pos]||(ps[team][pos]=[]);
      const copy=deepCopy(refp); copy.team=team;
      const ex=arr.findIndex(p=>p.player_id===refp.player_id);
      // Keep the projection row's ADP/meta on the copied line — the reference season's ADP is
      // stale and several option filters use ADP as a "fantasy-relevant" signal.
      if(ex>=0){
        ['adp','adp_ppr','adp_half_ppr','adp_2qb','adp_std'].forEach(k=>{ if(arr[ex][k]!=null) copy[k]=arr[ex][k]; });
        // Remember the row's PROJECTED role before the historical line replaces it. The copy
        // mutates the projection seed in place, so this snapshot is the only surviving record
        // of "how involved is this player expected to be THIS season" — the option filters
        // consult it so a tiny historical line can't hide a featured current player.
        copy._proj_role = arr[ex]._proj_role || {tgt:arr[ex].receiving_targets||0, rec:arr[ex].receptions||0, att:arr[ex].rushing_attempts||0};
        arr[ex]=copy;
      }
      else arr.push(copy);
      copiedIds.add(refp.player_id);
      copied++;
    });
  });
  // ROSTER CONSISTENCY: the copy must never change WHO is on the projected roster — only
  // whose stats it overwrites. Members without a line that season (rookies, injured, new
  // arrivals) stay selectable with ZEROED stats, so the working set reads as "that season's
  // reality for this roster" and the user dials anyone up from 0 — instead of leftover 2026
  // projections silently polluting the baseline (or, worse, a tiny historical line knocking
  // a player out of the receiving/rushing option filters).
  const ZERO_STATS=['passing_yards','passing_touchdowns','passing_attempts','passing_completions',
    'interceptions_thrown','rushing_yards','rushing_tds','rushing_attempts',
    'receiving_targets','receptions','receiving_yards','receiving_tds','games_played'];
  ['QB','RB','WR','TE'].forEach(pos=>{
    (ps[team][pos]||[]).forEach(p=>{
      if(p.player_id && !copiedIds.has(p.player_id)){
        // Snapshot projected role before zeroing (see note above) so filters keep them listed.
        if(!p._proj_role) p._proj_role={tgt:p.receiving_targets||0, rec:p.receptions||0, att:p.rushing_attempts||0};
        ZERO_STATS.forEach(k=>{ if(p[k]!=null) p[k]=0; });
        if(p.games!=null) p.games=0;
        zeroed++;
      }
    });
  });
  delete workingProj[team];
  activeSeason='proj'; userProj=workingProj; SEED=ps; currentTeam=team;
  dirtySinceImport=true;
  ensureTeam(team);
  saveSession();
  renderSeasonTabs(); renderSidebar(); renderContent();
  const filterNote = ((!canFilter) ? ' (roster unverified — copied all; ↻ Sleeper to refine)' : (skipped?` · skipped ${skipped} no longer on roster`:''))
    + (zeroed?` · ${zeroed} without a ${refSeason} line kept at 0`:'');
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
  if(ex>=0){
    // Same roster-consistency guarantees as the team copy: keep the projection row's ADP and
    // snapshot the projected role, so a small historical line can't knock this player out of
    // the receiving/rushing option filters.
    ['adp','adp_ppr','adp_half_ppr','adp_2qb','adp_std'].forEach(k=>{ if(arr[ex][k]!=null) copy[k]=arr[ex][k]; });
    copy._proj_role = arr[ex]._proj_role || {tgt:arr[ex].receiving_targets||0, rec:arr[ex].receptions||0, att:arr[ex].rushing_attempts||0};
    arr[ex]=copy;
  } else arr.push(copy);
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

