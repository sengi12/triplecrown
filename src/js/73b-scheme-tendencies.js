// ═════════════════════════════════════════════════════════════════════════════
// Tendencies — the Playbook's fifth tab: when a team calls what, and how much of it
// an opponent could guess
// ═════════════════════════════════════════════════════════════════════════════
// The Playbook tab shows what a team runs; this tab shows WHEN it calls it. The methods
// follow The Side Quest's coaching work (Michael MacKelvie and Nick Gurol, thesidequest.com,
// "The Coaching Report Card"), re-derived in src/nflverse/tendencies.py from the nflverse
// play-by-play and FTN charting the app already ingests: the pass rate in each situation
// beside the league's; predictability beyond the situation (their finding: the best callers
// are MORE predictable once the situation is held, and it costs nothing); the streak lift and
// formation hold; play action after a run vs cold (cold works fine); motion's real effect;
// and the defence's blitz habits, its streak (callers run hot) and what a blitz buys.
// Rendered in the modal's paper idiom (the same wrap the Red Zone, Regression and Scheme
// tabs use — Courier, black rules, the yellow/green/pink stamps), with the run/pass bar.
// Data: NFLVERSE[season].tendencies = {teams:{TEAM:{offense, defense}}, league, n_teams}
// — the frozen seasons in the seed, the season in progress in the in-season sidecar, so the
// modal's season row reaches the live season here before its playsheet publishes.
function _schemeHasTendencies(season, team){
  if(typeof NFLVERSE==='undefined' || !NFLVERSE || !season) return false;
  const t=NFLVERSE[String(season)] && NFLVERSE[String(season)].tendencies;
  if(!t || !t.teams) return false;
  return team ? !!t.teams[String(team).toUpperCase()] : Object.keys(t.teams).length>0;
}
// rank among the teams that have the number (1 = most, or least when dir is 'asc')
function _schemeTendRank(teams, getter, dir){
  const vals=Object.entries(teams||{}).map(([k,t])=>{ let v=null; try{ v=getter(t); }catch(e){} return [k, (v==null||Number.isNaN(+v))?null:+v]; }).filter(x=>x[1]!=null)
    .sort((a,b)=>dir==='asc' ? a[1]-b[1] : b[1]-a[1]);
  return { n:vals.length, of:(k)=>{ const i=vals.findIndex(x=>x[0]===k); return i<0?null:i+1; } };
}
const _tnPct=(v,dp)=> (v==null||Number.isNaN(+v)) ? '—' : `${(+v).toFixed(dp==null?0:dp)}%`;
const _tnEpa=(v)=> (v==null||Number.isNaN(+v)) ? '—' : `${(+v)>=0?'+':''}${(+v).toFixed(2)}`;
const _tnPp=(v)=> (v==null||Number.isNaN(+v)) ? '—' : `${(+v)>=0?'+':''}${(+v).toFixed(1)} pp`;
function _tnOrd(n){ return (typeof _schemeOrdinal==='function') ? _schemeOrdinal(n) : String(n); }
// a rank stamp: yellow, green for the top third, pink for the bottom third
// A label of the form 'most X|least X' flips for the bottom half: the 32nd most predictable
// offense reads 1st of 32 least predictable — the rank counted from the other end.
function _tnStamp(rank, n, label, neutral){
  if(!rank || !n) return '';
  // neutral: a rank that is not a grade (predictability cuts both ways) stays yellow
  const cls = (neutral || n<2) ? '' : (rank<=Math.ceil(n/3) ? 'hi' : (rank>n-Math.ceil(n/3) ? 'lo' : ''));
  let lbl = label || '', shown = rank;
  if(lbl.indexOf('|')>=0){ const [hi, lo] = lbl.split('|'); if(rank > n/2){ lbl = lo; shown = n - rank + 1; } else lbl = hi; }
  return `<span class="tn-rank ${cls}">${_tnOrd(shown)} of ${n}${lbl?` ${escHtml(lbl)}`:''}</span>`;
}
// Every number on the tab is taggable into a player's notes (tap it → the picker), the
// way the Red Zone / Regression / Scheme tabs' are. `meta` carries the tab's source,
// context, team, relevance and the nav back here; the value stored is the text shown.
function _tnTag(html, label, meta, value){
  if(!meta || typeof noteWrapHtml!=='function') return html;
  const v = value!=null ? String(value) : String(html).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  return noteWrapHtml(html, Object.assign({label, value:v, statKey:label}, meta), 'note-tag-hit');
}
// the same, as attributes on a block (a bar) rather than a wrapping span
function _tnTagAttrs(label, value, meta){
  if(!meta || typeof noteTagAttrs!=='function') return '';
  return noteTagAttrs(Object.assign({label, value:String(value), statKey:label}, meta));
}
// a run/pass bar with the league's pass rate as a black tick
function _tnPassBar(pass, lg, attrs){
  if(pass==null) return '<div class="tn-bar"></div>';
  const p=Math.max(0, Math.min(100, +pass)), r=100-p;
  const tick=(lg!=null) ? `<span class="lg" style="left:${(100-Math.max(0,Math.min(100,+lg))).toFixed(1)}%" title="league ${_tnPct(lg,0)} pass"></span>` : '';
  return `<div class="tn-bar"${attrs||''}><div class="run" style="width:${r.toFixed(1)}%">${r>=22?`RUN ${r.toFixed(0)}%`:''}</div><div class="pass" style="width:${p.toFixed(1)}%">${p>=22?`PASS ${p.toFixed(0)}%`:''}</div>${tick}</div>`;
}
// a one-value bar (a blitz rate) with the league's as a tick
function _tnFillBar(v, lg, scale, attrs){
  if(v==null) return '<div class="tn-bar"></div>';
  const w=Math.max(0, Math.min(100, (+v)*(scale||1)));
  const tick=(lg!=null) ? `<span class="lg" style="left:${Math.max(0,Math.min(100,(+lg)*(scale||1))).toFixed(1)}%" title="league ${_tnPct(lg,0)}"></span>` : '';
  return `<div class="tn-bar"${attrs||''}><div class="fill" style="width:${w.toFixed(1)}%">${w>=18?_tnPct(v,0):''}</div>${tick}</div>`;
}
// a label/value line; with `meta` the value (and its rank, when there is one) are taggable
const _tnKv=(label, val, lgVal, extra, meta)=>`<div class="stat"><span>${escHtml(label)}</span><b>${meta?_tnTag(val, label, meta):val}${lgVal!=null?`<small>lg ${lgVal}</small>`:''}${(extra&&meta)?_tnTag(extra, `${label} rank`, meta):(extra||'')}</b></div>`;
// The Tendencies tab for the team in the modal's season (p.season).
function _schemeRenderTendencies(p){
  const team=String((p && p.team) || (typeof schemeTeam!=='undefined' && schemeTeam) || '').toUpperCase();
  const season=String((p && p.season) || '');
  const live=(typeof TC_SEASON!=='undefined' && TC_SEASON && String(TC_SEASON.year)===season);
  const blk=(season && typeof NFLVERSE!=='undefined' && NFLVERSE && NFLVERSE[season] && NFLVERSE[season].tendencies) || null;
  const t=blk && blk.teams && blk.teams[team];
  // The method, behind the info button (the page itself stays numbers).
  const about = (typeof _schemeInfoTip==='function') ? _schemeInfoTip('Tendencies', `The methods follow The Side Quest's coaching work (Michael MacKelvie and Nick Gurol, thesidequest.com — The Coaching Report Card), re-derived from nflverse pbp + FTN charting${season?`, ${season} REG`:''}. Predictability: how often a defence knowing only the situation (down, distance, field, score, quarter) and the league's habits would call run or pass right; the team's own situation rates, shrunk toward the league's where thin, give its number. "Beyond the situation" is that rate less the league's situation-only rate (the same baseline for every team), in pp = percentage points — what this caller adds. The stamp ranks the teams from whichever end is nearer (1st of 32 most predictable … 1st of 32 least predictable) and stays yellow because it is NOT a grade: being hard to predict sounds like a virtue, but The Side Quest's finding is that the best callers are MORE predictable once the situation is held — they call the right play and don't pay for the defence knowing — while a low rank can mean creativity or indecision. Read it with the EPA beside it. Bars: green run / blue pass, the black tick is the league. EPA is per play; n in grey.`) : '';
  if(!t){
    const why = season ? `No tendencies for ${escHtml(team)} in ${season} yet.` : 'Tendencies build from the season\'s play-by-play once games are in the books.';
    return `<div class="scheme-insights-wrap scheme-tend"><div class="scheme-insights-head"><span class="scheme-insights-pill">Tendencies${season?` · ${season}`:''}</span>${about}</div><div class="scheme-empty">${why}</div></div>`;
  }
  const lg=blk.league||{}; const O=t.offense||{}, LO=lg.offense||{}, D=t.defense||{}, LD=lg.defense||{}; const teams=blk.teams; const N=Object.keys(teams).length;
  // Tag metadata: offense values reach the team's skill players; the defense's reach its
  // D/ST and its defenders (IDP). Both navigate back to this tab from a note.
  const tmName=(typeof teamDisplayName==='function') ? teamDisplayName(team) : team;
  const ctx=`${tmName} tendencies · ${season}`;
  const nav={type:'coaching', team, season, tab:'tendencies'};
  const OM={source:'coaching_tendencies', context:ctx, team, relevance:'QB,RB,WR,TE', nav};
  const DM={source:'coaching_tendencies', context:ctx, team, relevance:'DEF,IDP', nav};
  const g=O.guess||{};
  const rBeyond=_schemeTendRank(teams, x=>x.offense&&x.offense.guess&&x.offense.guess.beyond, 'desc');
  const guess=`<div class="tn-card"><div class="tn-h">How predictable is the call? <small>situation known</small></div>
    <div class="tn-stamp"><b>${_tnTag(_tnPct(g.team,1), 'Predicted right', OM)}</b><span class="lbl">predicted right</span>${_tnTag(_tnStamp(rBeyond.of(team), rBeyond.n, 'most predictable|least predictable', true), 'Predictability rank', OM)}</div>
    <div class="tn-line">${_tnTag(_tnPct(g.situation,1), 'Predicted from the situation alone', OM)} from the situation alone · <b>${_tnTag(_tnPp(g.beyond), 'Predictable beyond the situation', OM)}</b> beyond it · naive ${_tnTag(_tnPct(g.naive,0), 'Naive guess rate', OM)} (pass or run, whichever is commoner)</div></div>`;
  const sits=O.situations||{};
  const sitRows=Object.keys(sits).filter(k=>sits[k] && sits[k].pass!=null).map(k=>{ const s=sits[k]; return `<div class="tn-row"><span class="lbl">${escHtml(k)}<small>${s.n}</small></span>${_tnPassBar(s.pass, s.lg, _tnTagAttrs(`Pass rate · ${k}`, `${_tnPct(s.pass,0)} pass`, OM))}<span class="epa">${_tnTag(_tnEpa(s.epa), `EPA/play · ${k}`, OM)}</span></div>`; }).join('');
  const situations=`<div class="tn-card"><div class="tn-h">When we throw <small>run / pass by situation · tick = league · EPA/play</small></div>${sitRows||'<div class="scheme-empty">Not enough plays yet.</div>'}</div>`;
  const sq=O.sequencing||{}, lsq=LO.sequencing||{};
  const rStreak=_schemeTendRank(teams, x=>x.offense&&x.offense.sequencing&&x.offense.sequencing.streak_lift, 'desc');
  const rHold=_schemeTendRank(teams, x=>x.offense&&x.offense.sequencing&&x.offense.sequencing.formation_hold, 'desc');
  const sequencing=`<div class="tn-card"><div class="tn-h">Sequencing <small>within a drive</small></div><div class="tn-kv">
    ${_tnKv('Pass after a pass', _tnPct(sq.pass_after_pass,0), _tnPct(lsq.pass_after_pass,0), '', OM)}
    ${_tnKv('Pass after a run', _tnPct(sq.pass_after_run,0), _tnPct(lsq.pass_after_run,0), '', OM)}
    ${_tnKv('Streak lift', _tnPp(sq.streak_lift), _tnPp(lsq.streak_lift), _tnStamp(rStreak.of(team), rStreak.n), OM)}
    ${_tnKv('Formation hold', _tnPct(sq.formation_hold,0), _tnPct(lsq.formation_hold,0), _tnStamp(rHold.of(team), rHold.n), OM)}
    ${_tnKv('No-huddle', _tnPct(sq.no_huddle,0), _tnPct(lsq.no_huddle,0), '', OM)}
  </div></div>`;
  const pa=O.play_action||{}, lpa=LO.play_action||{};
  const rPa=_schemeTendRank(teams, x=>x.offense&&x.offense.play_action&&x.offense.play_action.rate_early, 'desc');
  const playAction=`<div class="tn-card"><div class="tn-h">Play action <small>the setup test: after a run vs cold</small></div><div class="tn-kv">
    ${_tnKv('Rate, early downs', _tnPct(pa.rate_early,0), _tnPct(lpa.rate_early,0), _tnStamp(rPa.of(team), rPa.n), OM)}
    ${_tnKv('EPA with', _tnEpa(pa.epa)+`<small>${pa.n||0}</small>`, _tnEpa(lpa.epa), '', OM)}
    ${_tnKv('EPA without', _tnEpa(pa.epa_without), _tnEpa(lpa.epa_without), '', OM)}
    ${_tnKv('After a run', _tnEpa(pa.epa_after_run)+`<small>${pa.n_after_run||0}</small>`, _tnEpa(lpa.epa_after_run), '', OM)}
    ${_tnKv('Cold', _tnEpa(pa.epa_cold)+`<small>${pa.n_cold||0}</small>`, _tnEpa(lpa.epa_cold), '', OM)}
  </div></div>`;
  const mo=O.motion||{}, lmo=LO.motion||{};
  const rMo=_schemeTendRank(teams, x=>x.offense&&x.offense.motion&&x.offense.motion.rate, 'desc');
  const motion=`<div class="tn-card"><div class="tn-h">Motion <small>pre-snap, FTN</small></div><div class="tn-kv">
    ${_tnKv('Motion rate', _tnPct(mo.rate,0), _tnPct(lmo.rate,0), _tnStamp(rMo.of(team), rMo.n), OM)}
    ${_tnKv('EPA with', _tnEpa(mo.epa), _tnEpa(lmo.epa), '', OM)}
    ${_tnKv('EPA without', _tnEpa(mo.epa_without), _tnEpa(lmo.epa_without), '', OM)}
    ${_tnKv('Passes with', _tnEpa(mo.epa_pass), _tnEpa(lmo.epa_pass), '', OM)}
    ${_tnKv('Passes without', _tnEpa(mo.epa_pass_without), _tnEpa(lmo.epa_pass_without), '', OM)}
  </div></div>`;
  const bz=D.blitz||{}, lbz=LD.blitz||{}, bx=D.box||{}, lbx=LD.box||{};
  const rBlitz=_schemeTendRank(teams, x=>x.defense&&x.defense.blitz&&x.defense.blitz.rate, 'desc');
  const rStreakD=_schemeTendRank(teams, x=>x.defense&&x.defense.blitz&&x.defense.blitz.streak_lift, 'desc');
  const bySit=['1st down','3rd & long','Red zone','Trailing 9+','Leading 9+'].filter(k=>bz[k] && bz[k].rate!=null)
    .map(k=>`<div class="tn-row"><span class="lbl">${escHtml(k)}<small>${bz[k].n}</small></span>${_tnFillBar(bz[k].rate, lbz[k]&&lbz[k].rate, 1.6, _tnTagAttrs(`Blitz rate · ${k}`, _tnPct(bz[k].rate,0), DM))}<span class="epa"></span></div>`).join('');
  const defense=`<div class="tn-card"><div class="tn-h">The defense: blitz habits <small>5+ rushers, FTN</small></div>
    <div class="tn-stamp"><b>${_tnTag(_tnPct(bz.rate,0), 'Blitz rate', DM)}</b><span class="lbl">blitz rate</span>${_tnTag(_tnStamp(rBlitz.of(team), rBlitz.n), 'Blitz rate rank', DM)}</div>
    ${bySit}
    <div class="tn-kv" style="margin-top:6px">
      ${_tnKv('After a blitz', _tnPct(bz.after_blitz,0)+`<small>${bz.n_after_blitz||0}</small>`, _tnPct(lbz.after_blitz,0), '', DM)}
      ${_tnKv('After none', _tnPct(bz.after_none,0)+`<small>${bz.n_after_none||0}</small>`, _tnPct(lbz.after_none,0), '', DM)}
      ${_tnKv('Streak lift', _tnPp(bz.streak_lift), _tnPp(lbz.streak_lift), _tnStamp(rStreakD.of(team), rStreakD.n, 'hottest|coldest'), DM)}
      ${_tnKv('Pressure with a blitz', _tnPct(bz.pressure_with,0), _tnPct(lbz.pressure_with,0), '', DM)}
      ${_tnKv('Pressure without', _tnPct(bz.pressure_without,0), _tnPct(lbz.pressure_without,0), '', DM)}
      ${_tnKv('EPA allowed, blitz', _tnEpa(bz.epa_with), _tnEpa(lbz.epa_with), '', DM)}
      ${_tnKv('EPA allowed, none', _tnEpa(bz.epa_without), _tnEpa(lbz.epa_without), '', DM)}
      ${_tnKv('Light box vs run', _tnPct(bx.light,0), _tnPct(lbx.light,0), '', DM)}
      ${_tnKv('Stacked box vs run', _tnPct(bx.heavy,0), _tnPct(lbx.heavy,0), '', DM)}
    </div></div>`;
  const ftn=blk.has_ftn===false ? `<span class="scheme-insights-pill warn">FTN pending${(typeof _schemeInfoTip==='function') ? _schemeInfoTip('FTN charting pending', 'FTN charting has not posted for this season yet: play action, motion, formation hold and the blitz figures wait for it; the situations and predictability are from the play-by-play.') : ''}</span>` : '';
  const head=`<div class="scheme-insights-head"><span><span class="scheme-insights-pill${live?' neutral':''}">Tendencies · ${season}${live?' · live':''}</span>${about}${ftn}</span><span class="scheme-insights-sample">${Number(O.plays||0).toLocaleString()} plays · ${N} teams ranked</span></div>`;
  return `<div class="scheme-insights-wrap scheme-tend">${head}<div class="tn-grid">${guess}${situations}${sequencing}${playAction}${motion}${defense}</div></div>`;
}
