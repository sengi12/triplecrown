// ═════════════════════════════════════════════════════════════════════════════
// Pace — how every player's live season tracks the projections frozen at kickoff.
//
// Modes on the projection season (see renderSeasonTabs):
//   proj  — the normal editable working projections (today's behavior)
//   live  — the current season to date, viewed through the standard read-only
//           reference machinery (enterReference on the current year)
//   pace  — stays on the editable 'proj' dataset, with actual per-game pace ×17
//           compared to PACE_BASELINE per player. Editing stays enabled: pace
//           reads live actuals vs the frozen baseline, never the working edits.
// ═════════════════════════════════════════════════════════════════════════════

// Sum a HISTORY season record (list of team stints) into one calcFpts-ready row.
// HISTORY stat names use *_touchdowns; calcFpts reads *_tds — translate here.
function _paceSumStints(rec){
  const list = Array.isArray(rec) ? rec : [rec];
  const sum={passing_yards:0,passing_tds:0,passing_attempts:0,passing_completions:0,
    interceptions_thrown:0,rushing_yards:0,rushing_tds:0,rushing_attempts:0,
    receiving_yards:0,receiving_tds:0,receptions:0,receiving_targets:0,fumbles_lost:0,
    games_played:0,pos:null};
  list.forEach(r=>{
    const s=(r&&r.stats)||{};
    sum.passing_yards+=s.passing_yards||0; sum.passing_tds+=s.passing_touchdowns||0;
    sum.passing_attempts+=s.passing_attempts||0; sum.passing_completions+=s.passing_completions||0;
    sum.interceptions_thrown+=s.interceptions_thrown||0;
    sum.rushing_yards+=s.rushing_yards||0; sum.rushing_tds+=s.rushing_touchdowns||0;
    sum.rushing_attempts+=s.rushing_attempts||0;
    sum.receiving_yards+=s.receiving_yards||0; sum.receiving_tds+=s.receiving_touchdowns||0;
    sum.receptions+=s.receptions||0; sum.receiving_targets+=s.receiving_targets||0;
    sum.fumbles_lost+=s.fumbles_lost||0;
    sum.games_played+=(r.games_played!=null?r.games_played:(s.games_played||0));
    if(!sum.pos) sum.pos=r.pos||null;
  });
  return sum;
}

function paceBadgeCls(pct, gp){
  if(!(gp>=3)) return 'pace-thin';          // small sample — grey, no verdict yet
  if(pct>=0.10) return 'pace-ahead';
  if(pct<=-0.10) return 'pace-behind';
  return 'pace-on';
}

// key `${pid}` and `${ecrNormName(name)}|${pos}` → {name, team, pos, base, act, gp, pace17,
// delta, pct, cls}. Memoized on (live epoch, scoring signature, baseline identity) — the
// scoring signature keeps league-scoring switches honest, the epoch advances per completed week.
var _paceIdx=null, _paceIdxSig='';
function buildPaceIndex(){
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return null;
  const b = (typeof loadPaceBaseline==='function') ? loadPaceBaseline() : null;
  if(!b || Number(b.season)!==Number(TC_SEASON.year)) return null;
  const epoch = (typeof liveSeasonEpoch==='function') ? liveSeasonEpoch() : 0;
  const sig = [epoch, buildPlayerScoringSig(), b.frozenAt].join('~');
  if(_paceIdx && _paceIdxSig===sig) return _paceIdx;
  const yr=String(TC_SEASON.year);
  const idx=new Map();
  for(const key in b.players){
    const base=b.players[key];
    const baseF=calcFpts(base);
    const pid=base.player_id;
    const rec = (pid && typeof HISTORY!=='undefined' && HISTORY[pid]) ? HISTORY[pid][yr] : null;
    const act = rec ? _paceSumStints(rec) : null;
    if(act && !act.pos) act.pos=base.pos;   // TE reception bonus needs the position
    const gp = act ? Number(act.games_played||0) : 0;
    const actF = act ? calcFpts(act) : 0;
    const pace17 = gp>0 ? actF/gp*17 : 0;
    const delta = pace17-baseF;
    const pct = baseF>0 ? delta/baseF : 0;
    const entry={name:base.name, team:base.team, pos:base.pos,
      base:baseF, act:actF, gp, pace17, delta, pct, cls:paceBadgeCls(pct, gp)};
    idx.set(key, entry);
    idx.set(`${ecrNormName(base.name)}|${base.pos}`, entry);
  }
  _paceIdx=idx; _paceIdxSig=sig;
  return idx;
}

function paceForPlayer(name, pos, pid){
  const idx=buildPaceIndex();
  if(!idx) return null;
  if(pid!=null && idx.has(String(pid))) return idx.get(String(pid));
  return idx.get(`${ecrNormName(name)}|${pos}`) || null;
}

// Tiny ▲ +8% / ▼ −12% chip beside a player's name (team phase views, pace mode only).
function paceChipHTML(name, pos, pid){
  const e=paceForPlayer(name, pos, pid);
  if(!e || !(e.base>0)) return '';
  if(!(e.gp>0)) return `<span class="pace-chip pace-thin" title="No games yet">—</span>`;
  const pctTxt=`${e.pct>=0?'+':'−'}${Math.round(Math.abs(e.pct)*100)}%`;
  const arrow=e.cls==='pace-thin' ? '' : (e.delta>=0?'▲':'▼');
  const title=`Pace ${e.pace17.toFixed(0)} vs your frozen ${e.base.toFixed(0)} (${e.gp} gm${e.gp===1?'':'s'})`;
  return `<span class="pace-chip ${e.cls}" title="${title}">${arrow}${pctTxt}</span>`;
}

// Chip wrapper for the team phase views: renders only while pace mode is on, so the
// insertion sites stay a single unconditional template call.
function projPaceChip(name, pos, pid){
  if(typeof currentProjViewMode!=='function' || currentProjViewMode()!=='pace') return '';
  return paceChipHTML(name, pos, pid);
}

// Which mode the season bar should show as active right now. null on a past-season tab.
function currentProjViewMode(){
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return activeSeason==='proj' ? 'proj' : null;
  if(activeSeason===String(TC_SEASON.year)) return 'live';
  if(activeSeason==='proj') return projViewMode==='pace' ? 'pace' : 'proj';
  return null;
}

function setProjViewMode(mode){
  if(mode!=='proj' && mode!=='live' && mode!=='pace') return;
  const started = (typeof hasSeasonStarted==='function') && hasSeasonStarted();
  if(!started) mode='proj';
  const yr=String(TC_SEASON.year);
  if(mode==='live'){
    projViewMode='proj';   // live is a dataset (the current-year reference), not a proj sub-mode
    if(activeSeason!==yr){
      // Make sure the live season is fetchable/fresh, then enter it like any reference year.
      if(typeof refreshLiveSeasonStats==='function') refreshLiveSeasonStats().catch(()=>{});
      loadSeason(yr);
    } else renderSeasonTabs();
    return;
  }
  const changed = (projViewMode!==mode);
  projViewMode=mode;
  if(activeSeason!=='proj'){ loadSeason('proj'); return; }   // re-renders via afterSeasonSwitch
  if(changed){
    if(mode==='pace' && typeof refreshLiveSeasonStats==='function') refreshLiveSeasonStats().catch(()=>{});
    renderSeasonTabs();
    if(currentPhase==='Rankings') renderRankings();
    else if(currentTeam) renderContent();
  }
}
