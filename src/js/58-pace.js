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
    // Per-category lines are PER-GAME: actual rate (when he plays) vs the projected rate
    // (projection ÷ projected games — a QB in a 12-game timeshare froze games=12, everyone
    // else 17). Comparing 17-game extrapolations to full-season totals punished every
    // missed game twice; rates answer the real question — is he producing as projected
    // when he's on the field — and the missed time shows up once, in the GP badge.
    const projGames = Number(base.proj_games)>0 ? Number(base.proj_games) : 17;
    const stats={};
    _PB_FIELDS.forEach(f=>{
      if(f==='proj_games') return;
      const b=Number(base[f]||0), a=act?Number(act[f]||0):0;
      const bRate=b/projGames, aRate=gp>0?a/gp:0;
      const pc = gp>0 ? a/gp*17 : 0;
      const d = aRate-bRate;
      const pctR = bRate>0 ? d/bRate : 0;
      stats[f]={act:a, base:b, pace:pc, aRate, bRate, delta:pc-b, pct:pctR,
        cls:bRate>0?paceBadgeCls(pctR, gp):'pace-thin'};
    });
    const entry={name:base.name, team:base.team, pos:base.pos, id:base.player_id||null,
      base:baseF, act:actF, gp, projGames, pace17, delta, pct, cls:paceBadgeCls(pct, gp), stats};
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

// ── Per-category pace strips (team phase views, pace mode) ───────────────────
// Which categories each view talks about, with short labels.
const PACE_STRIP_FIELDS = {
  rec:  [['receiving_targets','Tgts'],['receptions','Rec'],['receiving_yards','Yds'],['receiving_tds','TD']],
  rush: [['rushing_attempts','Att'],['rushing_yards','Yds'],['rushing_tds','TD'],['receptions','Rec']],
  qb:   [['passing_attempts','Att'],['passing_yards','Pass Yds'],['passing_tds','Pass TD'],['interceptions_thrown','INT'],['rushing_yards','Rush Yds'],['rushing_tds','Rush TD']],
};
function _paceFmt(v, f){
  if(v==null || !Number.isFinite(v)) return '—';
  if(/_tds$/.test(f)||/interceptions/.test(f)) return (Math.round(v*10)/10).toLocaleString(undefined,{maximumFractionDigits:1});
  return Math.round(v).toLocaleString();
}
function _paceRateFmt(v, f){
  if(v==null || !Number.isFinite(v)) return '—';
  if(/_tds$/.test(f)||/interceptions/.test(f)) return (Math.round(v*100)/100).toFixed(2);
  return v>=100 ? Math.round(v).toLocaleString() : (Math.round(v*10)/10).toFixed(1);
}
// One chip per category: "Yds 74.9 vs 82.8/gm ▼10%" — actual per-game vs projected per-game.
function paceStatChipsHTML(name, pos, pid, view){
  const e=paceForPlayer(name, pos, pid);
  if(!e || !e.stats) return '';
  const fields=PACE_STRIP_FIELDS[view]||PACE_STRIP_FIELDS.rec;
  const gp=e.gp||0;
  const chips=fields.map(([f,label])=>{
    const st=e.stats[f]; if(!st) return '';
    if(!(st.base>0) && !(st.act>0)) return '';            // nothing projected, nothing done
    const cls = gp>0 ? st.cls : 'pace-thin';
    const pctTxt = (gp>0 && st.bRate>0) ? `${st.pct>=0?'+':'−'}${Math.round(Math.abs(st.pct)*100)}%` : '—';
    const arrow = cls==='pace-ahead'?'▲':cls==='pace-behind'?'▼':'';
    const title=`${label}: ${_paceRateFmt(st.aRate,f)}/gm over ${gp} game${gp===1?'':'s'} (${_paceFmt(st.act,f)} total) vs your ${_paceRateFmt(st.bRate,f)}/gm (${_paceFmt(st.base,f)} over ${e.projGames} games)`;
    return `<span class="pace-stat ${cls}" title="${title}"><span class="ps-l">${label}</span><span class="ps-a">${_paceRateFmt(st.aRate,f)}</span><span class="ps-b">vs ${_paceRateFmt(st.bRate,f)}/gm</span><b class="ps-d">${arrow}${pctTxt}</b></span>`;
  }).filter(Boolean).join('');
  if(!chips) return '';
  const gpTxt = gp>0 ? `${gp} gm${gp===1?'':'s'}` : 'no games yet';
  return `<div class="pace-strip" title="actual per game vs your projected per game (projection ÷ projected games)"><span class="pace-strip-gp">${gpTxt}</span>${chips}</div>`;
}
function projPaceStrip(name, pos, pid, view){
  if(typeof currentProjViewMode!=='function' || currentProjViewMode()!=='pace') return '';
  return paceStatChipsHTML(name, pos, pid, view);
}
// Team-level line for the pace banner: games played + team pass/rush volume pace vs frozen.
// Team line, also per game: Σ actual ÷ team games played vs Σ projections ÷ 17. Totals-based
// team sums went "super wonky" the moment one starter missed time; rates always add up.
function paceTeamSummaryHTML(team){
  const idx=buildPaceIndex(); if(!idx) return '';
  const tm=String(team||'').toUpperCase();
  const seen=new Set(); let gp=0; const tot={passing_attempts:[0,0],rushing_attempts:[0,0],receiving_targets:[0,0],passing_tds:[0,0],rushing_tds:[0,0]};
  idx.forEach((e,key)=>{ if(key.indexOf('|')<0) return; if(seen.has(key)) return; seen.add(key);
    if(String(e.team||'').toUpperCase()!==tm || !e.stats) return;
    gp=Math.max(gp, e.gp||0);
    for(const f in tot){ const st=e.stats[f]; if(!st) continue; tot[f][0]+=st.act; tot[f][1]+=st.base; } });
  if(!gp) return '';
  const cell=(f,label)=>{ const [a,b]=tot[f]; if(!(b>0)) return ''; const aR=a/gp, bR=b/17; const pct=bR>0?(aR-bR)/bR:0; const cls=paceBadgeCls(pct,gp); return `<span class="pace-stat ${cls}" title="team ${label}: ${_paceRateFmt(aR,f)}/gm over ${gp} game${gp===1?'':'s'} vs ${_paceRateFmt(bR,f)}/gm projected (${_paceFmt(b,f)} over 17)"><span class="ps-l">${label}</span><span class="ps-a">${_paceRateFmt(aR,f)}</span><span class="ps-b">vs ${_paceRateFmt(bR,f)}/gm</span><b class="ps-d">${cls==='pace-ahead'?'▲':cls==='pace-behind'?'▼':''}${pct>=0?'+':'−'}${Math.round(Math.abs(pct)*100)}%</b></span>`; };
  return `<div class="pace-strip pace-strip-team"><span class="pace-strip-gp">${tm} · ${gp} gm${gp===1?'':'s'} played</span>${cell('passing_attempts','Pass att')}${cell('passing_tds','Pass TD')}${cell('receiving_targets','Targets')}${cell('rushing_attempts','Rush att')}${cell('rushing_tds','Rush TD')}</div>`;
}

// ── Pace mode is read-only ───────────────────────────────────────────────────
// The pace view compares live production to the FROZEN projection; editing there implied
// the comparison would follow the sliders (it never did — the frozen line can't move). The
// projections stay editable one tap away on the Proj tab.
function paceLockActive(){
  return typeof currentProjViewMode==='function' && currentProjViewMode()==='pace';
}
// A second mark on a slider: where the player actually is. For a stat slider the mark sits
// at "current per-game rate × his projected games" (what he finishes with at this rate).
function paceMarker(name, pos, pid, field){
  if(!paceLockActive()) return null;
  const e=paceForPlayer(name, pos, pid);
  const st=e && e.stats && e.stats[field];
  if(!st || !(e.gp>0)) return null;
  const val=st.aRate*e.projGames;
  return {value:val, cls:st.cls,
    title:`Current pace: ${_paceRateFmt(st.aRate,field)}/gm × ${e.projGames} games = ${_paceFmt(val,field)} (you projected ${_paceFmt(st.base,field)})`};
}
// Actual share of the team pie to date (target share / carry share / TD share), 0–100.
function paceActualShare(team, name, pos, pid, kind){
  if(!paceLockActive()) return null;
  const idx=buildPaceIndex(); if(!idx) return null;
  const e=paceForPlayer(name, pos, pid);
  if(!e || !e.stats || !(e.gp>0)) return null;
  const tm=String(team||'').toUpperCase();
  const F={tgt:'receiving_targets', rush:'rushing_attempts', tdrec:'receiving_tds', tdrush:'rushing_tds'}[kind];
  if(!F) return null;
  let team_act=0; const seen=new Set();
  idx.forEach((x,key)=>{ if(key.indexOf('|')<0 || seen.has(key)) return; seen.add(key);
    if(String(x.team||'').toUpperCase()!==tm || !x.stats) return;
    team_act+=x.stats[F]?x.stats[F].act:0; });
  if(!(team_act>0)) return null;
  const mine=e.stats[F]?e.stats[F].act:0;
  return {pct:100*mine/team_act, mine, team:team_act,
    title:`Actual to date: ${_paceFmt(mine,F)} of the team's ${_paceFmt(team_act,F)} (${(100*mine/team_act).toFixed(1)}%)`};
}
function paceShareMarkHTML(team, name, pos, pid, kind){
  const m=paceActualShare(team, name, pos, pid, kind);
  if(!m) return '';
  return `<div class="pace-marker" style="left:${Math.max(0,Math.min(100,m.pct)).toFixed(1)}%" title="${m.title}"></div>`;
}
