// ═════════════════════════════════════════════════════════════════════════════
// Tendencies — the Playbook's fourth tab: when a team calls what, and how much of it
// an opponent could guess
// ═════════════════════════════════════════════════════════════════════════════
// The Playbook shows what a team runs; this shows WHEN it calls it. The methods follow
// The Side Quest's coaching work (Michael MacKelvie and Nick Gurol, thesidequest.com,
// "The Coaching Report Card"), re-derived in src/nflverse/tendencies.py from the nflverse
// play-by-play and FTN charting the app already ingests: the pass rate in each situation
// beside the league's; guessability beyond the situation (their finding: the best callers
// are MORE guessable once the situation is held, and it costs them nothing); the streak
// lift and formation hold; play action after a run vs cold (cold works fine); motion's real
// effect; and the defence's blitz habits, its streak (callers run hot) and what a blitz buys.
// Data: NFLVERSE[season].tendencies = {teams:{TEAM:{offense, defense}}, league, n_teams}
// — the frozen seasons in the seed, the season in progress in the in-season sidecar.
let schemeTendSeason = null;
function _schemeTendSeasons(){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE) return [];
  return Object.keys(NFLVERSE).filter(s=>{ const t=NFLVERSE[s]&&NFLVERSE[s].tendencies; return t && t.teams && Object.keys(t.teams).length; }).sort((a,b)=>b-a);
}
function _schemeTendPick(p){
  const seasons=_schemeTendSeasons(); if(!seasons.length) return null;
  if(schemeTendSeason && seasons.includes(String(schemeTendSeason))) return String(schemeTendSeason);
  const want=String((p && p.season)||''); return seasons.includes(want) ? want : seasons[0];
}
function setTeamCoachingSchemeTendSeason(s){ schemeTendSeason=String(s); if(typeof _renderTeamCoachingScheme==='function') _renderTeamCoachingScheme(); }
// rank among the teams that have the number (1 = most, or least when dir is 'asc')
function _schemeTendRank(teams, getter, dir){
  const vals=Object.entries(teams||{}).map(([k,t])=>{ let v=null; try{ v=getter(t); }catch(e){} return [k, (v==null||Number.isNaN(+v))?null:+v]; }).filter(x=>x[1]!=null)
    .sort((a,b)=>dir==='asc' ? a[1]-b[1] : b[1]-a[1]);
  return { n:vals.length, of:(k)=>{ const i=vals.findIndex(x=>x[0]===k); return i<0?null:i+1; } };
}
const _tPct=(v,dp)=> (v==null||Number.isNaN(+v)) ? '—' : `${(+v).toFixed(dp==null?0:dp)}%`;
const _tEpa=(v)=> (v==null||Number.isNaN(+v)) ? '—' : `${(+v)>=0?'+':''}${(+v).toFixed(2)}`;
const _tPp=(v)=> (v==null||Number.isNaN(+v)) ? '—' : `${(+v)>=0?'+':''}${(+v).toFixed(1)} pp`;
function _tRankBadge(rank, n){
  if(!rank || !n) return '';
  const cls=(typeof _schemeRankClass==='function')?_schemeRankClass(rank, n):'';
  const ord=(typeof _schemeOrdinal==='function')?_schemeOrdinal(rank):String(rank);
  return `<span class="scheme-tend-rank ${cls}">${ord} of ${n}</span>`;
}
function _tTip(label, text){ return (typeof _schemeInfoTip==='function') ? _schemeInfoTip(label, text) : ''; }
// a team-vs-league row: label, the team's number, the league's, a bar of the gap
function _tRow(label, team, lg, fmt, opts){
  const o=opts||{};
  const d=(team!=null && lg!=null) ? (+team - +lg) : null;
  const w=d==null ? 0 : Math.min(100, Math.abs(d)*(o.scale||2));
  const cls=d==null ? '' : (d>0 ? 'up' : 'dn');
  return `<div class="scheme-tend-row">
    <span class="scheme-tend-lbl">${escHtml(label)}${o.n!=null?`<small>${o.n}</small>`:''}</span>
    <b class="scheme-tend-val">${fmt(team)}</b>
    <span class="scheme-tend-lg" title="league">${fmt(lg)}</span>
    <span class="scheme-tend-barwrap"><span class="scheme-tend-bar ${cls}" style="width:${w.toFixed(0)}%"></span></span>
    <span class="scheme-tend-diff ${cls}">${d==null?'':(o.diff||_tPp)(d)}</span>${o.rank||''}
  </div>`;
}
function _schemeRenderTendencies(p){
  const team=String((p && p.team) || (typeof schemeTeam!=='undefined' && schemeTeam) || '').toUpperCase();
  const season=_schemeTendPick(p);
  const blk=season ? NFLVERSE[season].tendencies : null;
  const t=blk && blk.teams && blk.teams[team];
  const seasons=_schemeTendSeasons();
  const chips=seasons.length>1 ? `<div class="scheme-tend-seasons">${seasons.map(s=>`<button class="scheme-tend-season ${s===season?'active':''}" onclick="setTeamCoachingSchemeTendSeason('${s}')">${s}${(typeof TC_SEASON!=='undefined'&&String(TC_SEASON.year)===s)?' · live':''}</button>`).join('')}</div>` : '';
  const credit=_tTip('Where these come from', 'The methods follow The Side Quest\'s coaching work (Michael MacKelvie and Nick Gurol, thesidequest.com — The Coaching Report Card), re-derived from the nflverse play-by-play and FTN charting this app already carries. Their headline findings: the best play-callers are MORE guessable once the situation is held, and it costs them nothing; play action works cold, not only after runs; defensive callers run hot on the blitz. Rates are over the plays named; EPA is per play.');
  if(!t){
    return `<div class="scheme-tend"><div class="scheme-tend-head"><span class="scheme-tend-title">Tendencies${season?` · ${season}`:''}</span>${credit}${chips}</div>
      <div class="scheme-empty">${season ? `No tendencies for ${escHtml(team)} in ${season} yet.` : 'Tendencies build from the season\'s play-by-play once games are in the books.'}</div></div>`;
  }
  const lg=(blk.league||{});
  const O=t.offense||{}, LO=lg.offense||{}, D=t.defense||{}, LD=lg.defense||{};
  const teams=blk.teams;
  const N=Object.keys(teams).length;
  // guessability
  const g=O.guess||{}, lgG=LO.guess||{};
  const rBeyond=_schemeTendRank(teams, x=>x.offense&&x.offense.guess&&x.offense.guess.beyond, 'desc');
  const guess=`<div class="scheme-tend-tile">
      <div class="scheme-tend-tile-h">How guessable is the call? ${_tTip('Guessability', 'A defence that knew only the situation (down, distance, field, score, quarter) and the league\'s habits would guess run or pass right this often: the baseline. This team\'s own situation rates, shrunk toward the league\'s where the sample is thin, give its number. "Beyond the situation" is what the caller adds on top — positive means more predictable than the situation alone, negative means the caller mixes it up. The Side Quest\'s finding: the best callers score HIGH here, and it costs them nothing.')}</div>
      <div class="scheme-tend-big"><b>${_tPct(g.team,1)}</b><span>guessed right</span>${_tRankBadge(rBeyond.of(team), rBeyond.n)}</div>
      <div class="scheme-tend-sub">${_tPct(g.situation,1)} from the situation alone · <b class="${(g.beyond||0)>=0?'up':'dn'}">${_tPp(g.beyond)}</b> beyond it · naive ${_tPct(g.naive,0)} (pass or run, whichever is commoner)</div>
    </div>`;
  // situations
  const sits=O.situations||{};
  const sitRows=Object.keys(sits).filter(k=>sits[k] && sits[k].pass!=null).map(k=>{ const s=sits[k]; return _tRow(k, s.pass, s.lg, v=>_tPct(v,0), {n:s.n, scale:2, rank:`<span class="scheme-tend-epa" title="EPA per play in the situation">${_tEpa(s.epa)}</span>`}); }).join('');
  const situations=`<div class="scheme-tend-sec"><div class="scheme-tend-sec-h">Pass rate by situation <small>team · league · gap · EPA/play</small></div>${sitRows||'<div class="scheme-empty">Not enough plays yet.</div>'}</div>`;
  // sequencing
  const sq=O.sequencing||{}, lsq=LO.sequencing||{};
  const rStreak=_schemeTendRank(teams, x=>x.offense&&x.offense.sequencing&&x.offense.sequencing.streak_lift, 'desc');
  const rHold=_schemeTendRank(teams, x=>x.offense&&x.offense.sequencing&&x.offense.sequencing.formation_hold, 'desc');
  const sequencing=`<div class="scheme-tend-sec"><div class="scheme-tend-sec-h">Sequencing ${_tTip('Sequencing', 'Pass after a pass vs pass after a run, within a drive: the streak lift says how much the last call predicts the next. Formation hold: how often the quarterback lines up where he did on the previous snap (FTN\'s under centre / shotgun / pistol). No-huddle: the share of snaps without a huddle.')}</div>
      ${_tRow('Pass after a pass', sq.pass_after_pass, lsq.pass_after_pass, v=>_tPct(v,0), {n:sq.n_after_pass})}
      ${_tRow('Pass after a run', sq.pass_after_run, lsq.pass_after_run, v=>_tPct(v,0), {n:sq.n_after_run})}
      ${_tRow('Streak lift', sq.streak_lift, lsq.streak_lift, v=>_tPp(v), {scale:3, rank:_tRankBadge(rStreak.of(team), rStreak.n)})}
      ${_tRow('Formation hold', sq.formation_hold, lsq.formation_hold, v=>_tPct(v,0), {rank:_tRankBadge(rHold.of(team), rHold.n)})}
      ${_tRow('No-huddle', sq.no_huddle, lsq.no_huddle, v=>_tPct(v,0), {scale:3})}
    </div>`;
  // play action
  const pa=O.play_action||{}, lpa=LO.play_action||{};
  const rPa=_schemeTendRank(teams, x=>x.offense&&x.offense.play_action&&x.offense.play_action.rate_early, 'desc');
  const playAction=`<div class="scheme-tend-sec"><div class="scheme-tend-sec-h">Play action ${_tTip('Play action', 'The rate on early downs before the fourth quarter, EPA per dropback with and without it, and the setup test: play action after a run in the same drive vs cold (the drive\'s first play, or after a pass). The Side Quest found cold play action works as well as the set-up kind, league-wide.')}</div>
      ${_tRow('Rate, early downs', pa.rate_early, lpa.rate_early, v=>_tPct(v,0), {n:pa.n_early, rank:_tRankBadge(rPa.of(team), rPa.n)})}
      ${_tRow('EPA with', pa.epa, lpa.epa, _tEpa, {n:pa.n, scale:150, diff:_tEpa})}
      ${_tRow('EPA without', pa.epa_without, lpa.epa_without, _tEpa, {n:pa.n_without, scale:150, diff:_tEpa})}
      ${_tRow('After a run', pa.epa_after_run, lpa.epa_after_run, _tEpa, {n:pa.n_after_run, scale:150, diff:_tEpa})}
      ${_tRow('Cold', pa.epa_cold, lpa.epa_cold, _tEpa, {n:pa.n_cold, scale:150, diff:_tEpa})}
    </div>`;
  // motion
  const mo=O.motion||{}, lmo=LO.motion||{};
  const rMo=_schemeTendRank(teams, x=>x.offense&&x.offense.motion&&x.offense.motion.rate, 'desc');
  const motion=`<div class="scheme-tend-sec"><div class="scheme-tend-sec-h">Motion ${_tTip('Motion', 'Pre-snap motion (FTN) on the share of snaps, and EPA per play with and without it, all plays and passes alone. A gap near zero is the league-wide finding: motion helps at the margin, not by itself.')}</div>
      ${_tRow('Motion rate', mo.rate, lmo.rate, v=>_tPct(v,0), {n:mo.n, rank:_tRankBadge(rMo.of(team), rMo.n)})}
      ${_tRow('EPA with', mo.epa, lmo.epa, _tEpa, {n:mo.n_with, scale:150, diff:_tEpa})}
      ${_tRow('EPA without', mo.epa_without, lmo.epa_without, _tEpa, {n:mo.n_without, scale:150, diff:_tEpa})}
      ${_tRow('Passes with', mo.epa_pass, lmo.epa_pass, _tEpa, {scale:150, diff:_tEpa})}
      ${_tRow('Passes without', mo.epa_pass_without, lmo.epa_pass_without, _tEpa, {scale:150, diff:_tEpa})}
    </div>`;
  // defence
  const bz=D.blitz||{}, lbz=LD.blitz||{}, bx=D.box||{}, lbx=LD.box||{};
  const rBlitz=_schemeTendRank(teams, x=>x.defense&&x.defense.blitz&&x.defense.blitz.rate, 'desc');
  const rStreakD=_schemeTendRank(teams, x=>x.defense&&x.defense.blitz&&x.defense.blitz.streak_lift, 'desc');
  const bySit=['1st down','3rd & long','Red zone','Trailing 9+','Leading 9+'].filter(k=>bz[k] && bz[k].rate!=null)
    .map(k=>_tRow(k, bz[k].rate, lbz[k]&&lbz[k].rate, v=>_tPct(v,0), {n:bz[k].n})).join('');
  const defense=`<div class="scheme-tend-sec"><div class="scheme-tend-sec-h">The defence: blitz habits ${_tTip('Blitz habits', 'Blitz = five or more rushers (FTN), on the dropbacks this defence faced. The streak: how often it blitzes right after a blitz vs right after a non-blitz — The Side Quest found every defensive caller runs hot, none mixes. What a blitz buys: the pressure rate (hit or sack) and EPA allowed with and without one. Box counts: light (six or fewer) and stacked (eight or more) against the run.')}</div>
      ${_tRow('Blitz rate', bz.rate, lbz.rate, v=>_tPct(v,0), {n:bz.n, rank:_tRankBadge(rBlitz.of(team), rBlitz.n)})}
      ${bySit}
      ${_tRow('After a blitz', bz.after_blitz, lbz.after_blitz, v=>_tPct(v,0), {n:bz.n_after_blitz})}
      ${_tRow('After none', bz.after_none, lbz.after_none, v=>_tPct(v,0), {n:bz.n_after_none})}
      ${_tRow('Streak lift', bz.streak_lift, lbz.streak_lift, v=>_tPp(v), {scale:3, rank:_tRankBadge(rStreakD.of(team), rStreakD.n)})}
      ${_tRow('Pressure with a blitz', bz.pressure_with, lbz.pressure_with, v=>_tPct(v,0), {})}
      ${_tRow('Pressure without', bz.pressure_without, lbz.pressure_without, v=>_tPct(v,0), {})}
      ${_tRow('EPA allowed, blitz', bz.epa_with, lbz.epa_with, _tEpa, {scale:150, diff:_tEpa})}
      ${_tRow('EPA allowed, none', bz.epa_without, lbz.epa_without, _tEpa, {scale:150, diff:_tEpa})}
      ${_tRow('Light box vs run', bx.light, lbx.light, v=>_tPct(v,0), {n:bx.n})}
      ${_tRow('Stacked box vs run', bx.heavy, lbx.heavy, v=>_tPct(v,0), {})}
    </div>`;
  return `<div class="scheme-tend">
    <div class="scheme-tend-head"><span class="scheme-tend-title">Tendencies · ${season}</span>${credit}${chips}</div>
    ${blk.has_ftn===false ? '<div class="scheme-tend-note">FTN charting has not posted for this season yet: play action, motion, formation hold and the blitz figures wait for it; the situations and guessability are from the play-by-play.</div>' : ''}
    ${guess}${situations}${sequencing}${playAction}${motion}${defense}
    <div class="scheme-tend-foot">${O.plays||0} offensive plays · ${D.plays||0} faced on defence · ${N} teams ranked</div>
  </div>`;
}
