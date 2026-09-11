// ── Live-data provenance ──────────────────────────────────────────────────────
// The in-season sidecar says which games its plays cover (`games`: {week: [[AWAY, HOME,
// 'YYYY-MM-DD'], …]}) and which nflverse release stamps it was built from (`upstream`).
// One short line answers "did last night's game land?" wherever the live tabs render:
//   tcLiveDataNote()  → "thru Thu 9/10 · LAR@SF"                      (a sub-line)
//   tcLiveDataTitle() → "plays through Thu 9/10 (LAR@SF) · nflverse pbp Fri 10:01 EDT · baked Fri 11:56 AM"
function tcLiveDataFacts(){
  const ins=(typeof TC_INSEASON!=='undefined')&&TC_INSEASON;
  if(!ins||!ins.season) return null;
  const games=ins.games||{}; const all=[];
  Object.keys(games).forEach(wk=>(games[wk]||[]).forEach(g=>{ if(g&&g.length>=2) all.push({wk:+wk, away:g[0], home:g[1], date:g[2]||''}); }));
  all.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:(a.away<b.away?-1:1));
  const last=all.length?all[0].date:'';
  return {asof:ins.asof||'', upstream:ins.upstream||{}, last, lastGames:all.filter(g=>g.date===last), nGames:all.length, weeks:ins.weeks||[]};
}
function _tcFmtDay(iso){ // '2026-09-10' → 'Thu 9/10'
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||''); if(!m) return '';
  const d=new Date(+m[1],+m[2]-1,+m[3]);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]+' '+(+m[2])+'/'+(+m[3]);
}
function _tcFmtBaked(iso){ // sidecar asof (UTC) → the viewer's clock, 'Fri 11:56 AM'
  const d=new Date(iso||''); if(isNaN(d)) return '';
  try{ return d.toLocaleString([], {weekday:'short', hour:'numeric', minute:'2-digit'}); }catch(e){ return d.toISOString().slice(0,16); }
}
function _tcFmtStamp(ts){ // nflverse '2026-09-11 10:01:38 EDT' → 'Fri 10:01 EDT'
  const m=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2} (\w+)$/.exec(String(ts||'')); if(!m) return String(ts||'');
  return _tcFmtDay(`${m[1]}-${m[2]}-${m[3]}`).slice(0,3)+' '+m[4]+' '+m[5];
}
function tcLiveDataNote(){
  const f=tcLiveDataFacts(); if(!f) return '';
  if(!f.last) return f.weeks.length?`thru wk ${f.weeks[f.weeks.length-1]}`:'schedule only';
  // A weeknight names its game(s); a Sunday slate is a count (the title lists them all).
  const g=f.lastGames;
  return `thru ${_tcFmtDay(f.last)} · ${g.length<=3?g.map(x=>x.away+'@'+x.home).join(', '):g.length+' games'}`;
}
function tcLiveDataTitle(){
  const f=tcLiveDataFacts(); if(!f) return '';
  const parts=[];
  if(f.last) parts.push(`plays through ${_tcFmtDay(f.last)} (${f.lastGames.map(x=>x.away+'@'+x.home).join(', ')}) · ${f.nGames} game${f.nGames===1?'':'s'}`);
  else if(f.weeks.length) parts.push(`plays through week ${f.weeks[f.weeks.length-1]}`);
  else parts.push('schedule only — no plays yet');
  if(f.upstream.pbp) parts.push(`nflverse pbp ${_tcFmtStamp(f.upstream.pbp)}`);
  if(f.upstream.nextgen_stats) parts.push(`NGS ${_tcFmtStamp(f.upstream.nextgen_stats)}`);
  if(f.asof) parts.push(`baked ${_tcFmtBaked(f.asof)}`);
  return parts.join(' · ');
}
// The span the in-season panes drop into their header bars (empty when there is no live season).
function tcLiveFreshHTML(){
  const note=tcLiveDataNote(); if(!note) return '';
  return `<span class="la-ins-fresh" title="${tcLiveDataTitle().replace(/"/g,'&quot;')}">${note}</span>`;
}
