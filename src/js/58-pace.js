// ═════════════════════════════════════════════════════════════════════════════
// Pace — how every player's live season tracks the projections frozen at kickoff.
//
// Deliberately NOT a mode of its own. The projection season has two views —
// the editable working projections ('proj') and the season to date ('live') —
// and pace surfaces inside them as small, opt-in touches: a Δ column on the
// Live board (rankLiveDelta), the player card's live strip, and the League
// Analyzer's Trends boards. The index below is the one shared engine.
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
  const title=`Pace ${e.pace17.toFixed(0)} vs proj ${e.base.toFixed(0)} (${e.gp} gm${e.gp===1?'':'s'})`;
  return `<span class="pace-chip ${e.cls}" title="${title}">${arrow}${pctTxt}</span>`;
}

// Which mode the season bar should show as active right now. Two modes only — the editable
// projections ('proj') and the season to date ('live'); pace detail lives INSIDE live as an
// opt-in Δ column, not as a mode of its own. null on a past-season tab.
function currentProjViewMode(){
  if(typeof hasSeasonStarted!=='function' || !hasSeasonStarted()) return activeSeason==='proj' ? 'proj' : null;
  if(activeSeason===String(TC_SEASON.year)) return 'live';
  return activeSeason==='proj' ? 'proj' : null;
}

function setProjViewMode(mode){
  if(mode==='pace') mode='live';   // retired mode — its one number now lives inside Live
  if(mode!=='proj' && mode!=='live') return;
  const started = (typeof hasSeasonStarted==='function') && hasSeasonStarted();
  if(!started) mode='proj';
  const yr=String(TC_SEASON.year);
  if(mode==='live'){
    if(activeSeason!==yr){
      // Make sure the live season is fetchable/fresh, then enter it like any reference year.
      if(typeof refreshLiveSeasonStats==='function') refreshLiveSeasonStats().catch(()=>{});
      loadSeason(yr);
    } else renderSeasonTabs();
    return;
  }
  if(activeSeason!=='proj') loadSeason('proj');   // re-renders via afterSeasonSwitch
}

// Live-view opt-in: one Δ-vs-projection column in the rankings, off by default so the live
// board stays a clean stat sheet until the comparison is asked for.
let rankLiveDelta = false;
function toggleRankLiveDelta(){
  rankLiveDelta = !rankLiveDelta;
  if(rankLiveDelta && typeof maybeFreezePaceBaseline==='function'){ try{ maybeFreezePaceBaseline(); }catch(e){} }
  if(typeof renderRankings==='function' && currentPhase==='Rankings') renderRankings();
}

// ── Injury designations (Sleeper player DB) ──────────────────────────────────
// {code, sev:'q'|'d'|'o', note, body} or null when healthy/unknown. sev drives the badge
// color: questionable amber, doubtful orange, out/IR/PUP/suspended red.
// Season-ending detection often lives ONLY in news copy (Sleeper's structured fields for
// Biadasz: status IR, body part Knee, note null — nothing to parse). ESPN's athlete
// overview carries the headline ("…placed on season-ending injured reserve"), so probe it
// lazily when an IR/OUT popup opens, cache per player for the session, and let the ROS
// engine see the answer through tcInjuryInfo.
var _injNewsCache = {};   // pid → {seasonOut, headline} | 'pending' | null(failed)
function tcInjuryNewsProbe(pid){
  const sp=(pid!=null && typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers[String(pid)] : null;
  if(!sp || !sp.espn_id) return;
  if(_injNewsCache[String(pid)]!==undefined) return;
  _injNewsCache[String(pid)]='pending';
  fetch(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${sp.espn_id}/overview`)
    .then(r=>r&&r.ok?r.json():null)
    .then(j=>{
      const items=(j && Array.isArray(j.news)) ? j.news : [];
      const re=/season[-\s]?ending|out for (the )?(season|year)|miss (the )?(rest of the )?(season|year)|lost for the (season|year)/i;
      const hit=items.slice(0,5).map(n=>(n&&n.headline)||'').find(h=>re.test(h));
      _injNewsCache[String(pid)]={seasonOut:!!hit, headline:hit||''};
      const pop=document.getElementById('tcInjPop');
      if(hit && pop && pop.dataset && pop.dataset.pid===String(pid)){
        const i=tcInjuryInfo(pid);
        if(i) pop.innerHTML=_injPopHTML(pid, i);
      }
    })
    .catch(()=>{ _injNewsCache[String(pid)]=null; });
}
function tcInjuryInfo(pid){
  const sp = (pid!=null && typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers[String(pid)] : null;
  const st = sp && sp.injury_status ? String(sp.injury_status) : '';
  if(!st) return null;
  const code = /^ir/i.test(st)?'IR' : /^out/i.test(st)?'OUT' : /^doubtful/i.test(st)?'D'
    : /^questionable/i.test(st)?'Q' : /^sus/i.test(st)?'SUS' : /^pup/i.test(st)?'PUP'
    : st.slice(0,3).toUpperCase();
  const sev = code==='Q' ? 'q' : code==='D' ? 'd' : 'o';
  // No structured "season-ending" flag exists on Sleeper — but the note text nearly always
  // says it. Parse for it so IR-for-the-year reads (and discounts) as exactly that.
  const txt=`${sp.injury_body_part||''} ${sp.injury_note||''}`;
  let seasonOut = /season[-\s]?ending|out for (the )?(season|year)|miss (the )?(rest of the )?(season|year)|lost for the (season|year)|placed on (the )?injured reserve.*(season|year)/i.test(txt);
  let newsLine='';
  const nc=_injNewsCache[String(pid)];
  if(nc && nc!=='pending' && nc.seasonOut){ seasonOut=true; newsLine=nc.headline||''; }
  return {code, sev, seasonOut, newsLine, note:(sp.injury_note||''), body:(sp.injury_body_part||'')};
}
function tcInjuryTag(pid){
  const i=tcInjuryInfo(pid);
  if(!i) return '';
  const title=[i.body, i.note].filter(Boolean).join(' — ');
  return `<span class="inj-tag inj-${i.sev}" title="${typeof escAttr==='function'?escAttr(title||i.code):''}">${i.code}</span>`;
}
// Clickable variant (player card): tapping opens the detail popup.
function tcInjuryTagBtn(pid){
  const i=tcInjuryInfo(pid);
  if(!i) return '';
  return `<span class="inj-tag inj-click inj-${i.sev}" onclick="tcInjuryPop(event,'${String(pid)}')" title="Injury details">${i.code}</span>`;
}
// Small detail popup, clamped inside the viewport; any outside tap dismisses it.
function _injPopHTML(pid, i){
  const sp=(typeof sleeperPlayers!=='undefined'&&sleeperPlayers&&sleeperPlayers[String(pid)])||{};
  const est=tcInjuryAbsenceWeeks(i);
  const book=tcInjuryOutlook(i);
  const desig = (i.sev==='o' && i.seasonOut)
    ? `${i.code} — season-ending. Not expected back this year.`
    : i.sev==='o'
    ? `${i.code} — typically ${est>=4?`${est}+ weeks`:`${est} week${est===1?'':'s'}`} out at minimum.`
    : i.sev==='d' ? 'Doubtful — sits far more often than he plays.'
    : 'Questionable — game-time decision.';
  return `<b>${escHtml(sp.name||'Injury')} · ${i.code}${i.seasonOut?' · out for the season':''}</b>
    ${i.body?`<div>${escHtml(i.body)}</div>`:''}
    ${i.note?`<div>${escHtml(i.note)}</div>`:''}
    ${i.newsLine?`<div class="inj-pop-news">${escHtml(i.newsLine)}</div>`:''}
    <div class="inj-pop-sub">${desig}${book&&!i.seasonOut?` ${book.blurb}${book.range?` Typical timetable: <b>${book.range}</b>`:''}`:''}</div>
    ${(book||i.sev!=='q')&&!i.seasonOut?'<div class="inj-pop-sub">Ranges are typical for the injury type, not a diagnosis.</div>':''}`;
}
function tcInjuryPop(ev, pid){
  try{ ev.stopPropagation(); }catch(e){}
  const old=document.getElementById('tcInjPop'); if(old) old.remove();
  const i=tcInjuryInfo(pid); if(!i) return;
  if(i.sev==='o' && !i.seasonOut) tcInjuryNewsProbe(pid);   // the answer may live in the news
  const div=document.createElement('div');
  div.id='tcInjPop'; div.className='inj-pop';
  if(div.dataset) div.dataset.pid=String(pid);
  div.innerHTML=_injPopHTML(pid, i);
  document.body.appendChild(div);
  const r=(ev.target&&ev.target.getBoundingClientRect)?ev.target.getBoundingClientRect():{left:40,top:40,bottom:40};
  const pw=div.offsetWidth||240, ph=div.offsetHeight||80;
  const vw=window.innerWidth||360, vh=window.innerHeight||640;
  div.style.left=Math.max(8, Math.min(vw-pw-8, r.left))+'px';
  div.style.top=(r.bottom+6+ph>vh ? Math.max(8, r.top-ph-6) : r.bottom+6)+'px';
  setTimeout(()=>{ const off=(e)=>{ if(!div.contains(e.target)){ div.remove(); document.removeEventListener('click',off,true); } };
    document.addEventListener('click',off,true); },0);
}
// What we know about common injury TYPES: a typical return range, a one-line read on what
// it means for fantasy, and an absence estimate in weeks (18 = effectively the season).
// Matched against Sleeper's injury_body_part + note text. Ranges are population-typical for
// NFL players — context, never a diagnosis.
const TC_INJURY_BOOK=[
  {re:/\bacl\b/i, range:'season (8–12 months)', est:18, blurb:'A torn ACL ends the season in nearly every case; early-season tears sometimes allow a late playoff return, but production rarely follows.'},
  {re:/achilles/i, range:'season (9–12 months)', est:18, blurb:'Achilles ruptures are season-ending, and explosiveness often lags into the following year.'},
  {re:/pector/i, range:'often season (4–6 months torn)', est:18, blurb:'A torn pec usually requires surgery and ends the season.'},
  {re:/lisfranc/i, range:'6+ weeks, often season', est:10, blurb:'Lisfranc injuries are slow healers with frequent setbacks.'},
  {re:/jones fracture|fifth metatarsal/i, range:'6–10 weeks', est:8, blurb:'Jones fractures typically need surgery and a couple of months.'},
  {re:/high ankle/i, range:'4–6 weeks', est:5, blurb:'High ankle sprains linger — cutting and burst are limited for a stretch after the return.'},
  {re:/ankle/i, range:'1–3 weeks', est:2, blurb:'Low ankle sprains often mean a game or two, with limited mobility in the first game back.'},
  {re:/hamstring/i, range:'1–3 weeks', est:2, blurb:'Soft-tissue with a real re-injury risk; snap counts are usually capped in the first game back, and speed players are hit hardest.'},
  {re:/groin|adductor/i, range:'1–3 weeks', est:2, blurb:'Groin strains recur when rushed — watch practice reports over designations.'},
  {re:/\bcalf\b/i, range:'1–3 weeks', est:2, blurb:'Calf strains behave like hamstrings: quick returns, frequent setbacks.'},
  {re:/quad/i, range:'1–3 weeks', est:2, blurb:'Quad strains sap burst; usage often eases back over two weeks.'},
  {re:/\bmcl\b/i, range:'2–6 weeks', est:4, blurb:'MCL sprains usually heal without surgery; grade decides the timeline.'},
  {re:/meniscus/i, range:'4–8 weeks (scope)', est:6, blurb:'A scoped meniscus is a month-plus; repairs run far longer.'},
  {re:/concussion/i, range:'protocol, usually 1–2 weeks', est:1, blurb:'Five-stage protocol — clearing it is binary, so the practice-week signals matter more than the tag.'},
  {re:/collarbone|clavicle/i, range:'4–8 weeks', est:6, blurb:'Fractured collarbones cost a month-plus; non-throwing-side returns come quicker.'},
  {re:/shoulder|labrum|rotator|\bac joint\b/i, range:'1–4 weeks (sprain)', est:2, blurb:'AC sprains are often played through with pain management; labrum/rotator damage tends to be managed until offseason surgery.'},
  {re:/\brib/i, range:'1–3 weeks', est:2, blurb:'Ribs are usually pain-tolerance calls — effectiveness suffers more than availability.'},
  {re:/oblique|core muscle|abdomen|sports hernia/i, range:'2–6 weeks', est:4, blurb:'Core injuries limit rotation — throwing and cutting both suffer, and they recur when rushed.'},
  {re:/\bback\b|spine|disc/i, range:'1–4 weeks, recurring', est:2, blurb:'Back injuries are the classic in-and-out designation — treat week-to-week.'},
  {re:/\bhip\b/i, range:'1–4 weeks', est:2, blurb:'Hip injuries range widely; watch whether practice participation trends up.'},
  {re:/forearm/i, range:'4–6 weeks', est:5, blurb:'Forearm fractures usually mean about a month; skill players need grip strength back first.'},
  {re:/wrist|thumb|finger|\bhand\b/i, range:'1–4 weeks', est:2, blurb:'Hand injuries are often played through with a cast or club — catching and ball security take the hit.'},
  {re:/elbow/i, range:'2–6 weeks', est:3, blurb:'For QBs an elbow on the throwing arm is the one to worry about; grade decides everything.'},
  {re:/turf toe|\btoe\b/i, range:'1–4 weeks, lingering', est:2, blurb:'Turf toe limits push-off and lingers all season for bigger-bodied players.'},
  {re:/\bfoot\b/i, range:'varies — 2–8+ weeks', est:6, blurb:'Foot injuries span sprains to fractures; surgical cases (like a plantar plate or navicular) often threaten the season.'},
  {re:/\bknee\b/i, range:'varies — 1–6+ weeks', est:3, blurb:'Unspecified knee injuries span hyperextensions to structural damage — the practice week tells you which.'},
  {re:/illness|flu/i, range:'day-to-day', est:0, blurb:'Illness rarely costs a game; late-week practice returns are the signal.'},
];
function tcInjuryOutlook(info){
  if(!info) return null;
  const text=`${info.body||''} ${info.note||''}`;
  if(!text.trim()) return null;
  for(const b of TC_INJURY_BOOK){ if(b.re.test(text)) return b; }
  return null;
}
// Absence estimate in weeks — the injury TYPE first (when we recognize it), floored by the
// designation's minimum stay. Used to discount rest-of-season outlooks, never to silently
// rewrite the user's projections.
function tcInjuryAbsenceWeeks(info){
  if(!info) return 0;
  if(info.seasonOut) return 18;            // note text says the year is over
  const floor = info.code==='IR' ? 4 : info.code==='PUP' ? 4 : info.code==='SUS' ? 2 : info.code==='OUT' ? 1 : 0;
  if(!floor) return 0;                     // Q/D: no multi-week absence assumed
  const book=tcInjuryOutlook(info);
  return book ? Math.max(floor, book.est) : floor;
}

// ── Per-category pace strips (player card, live tab) ─────────────────────────
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
    const title=`${label}: ${_paceRateFmt(st.aRate,f)}/gm over ${gp} game${gp===1?'':'s'} (${_paceFmt(st.act,f)} total) vs proj ${_paceRateFmt(st.bRate,f)}/gm (${_paceFmt(st.base,f)} over ${e.projGames} games)`;
    const chip=`<span class="pace-stat ${cls}" title="${title}"><span class="ps-l">${label}</span><span class="ps-a">${_paceRateFmt(st.aRate,f)}</span><span class="ps-b">vs ${_paceRateFmt(st.bRate,f)}/gm</span><b class="ps-d">${arrow}${pctTxt}</b></span>`;
    // Taggable like every other stat: tap-to-tag into player notes with full context.
    if(typeof noteWrapHtml==='function' && typeof noteTargetFromArgs==='function'){
      const target=noteTargetFromArgs(pid, pos, (e.team||''));
      return noteWrapHtml(chip, { label:`${label} pace`,
        value:`${_paceRateFmt(st.aRate,f)}/gm vs proj ${_paceRateFmt(st.bRate,f)}/gm (${gp} gm${gp===1?'':'s'})`,
        source:'pcard_live_pace', statKey:`pace_${f}`,
        context:`${TC_SEASON.year} season to date`, player:target, team:(e.team||'') }, 'note-tag-hit');
    }
    return chip;
  }).filter(Boolean).join('');
  if(!chips) return '';
  const gpTxt = gp>0 ? `${gp} gm${gp===1?'':'s'}` : 'no games yet';
  return `<div class="pace-strip" title="actual per game vs projected per game (projection ÷ projected games)"><span class="pace-strip-gp">${gpTxt}</span>${chips}</div>`;
}
