// ═════════════════════════════════════════════════════════════════════════════
// Game detail — the play feed, the quarter line, the box score, the fantasy pane
// ═════════════════════════════════════════════════════════════════════════════
// One ESPN game summary (CORS-open, like the scoreboard) carries the whole game: every
// play typed (Rush, Pass Reception, Rushing Touchdown, Field Goal Good, Sack, Interception
// Return …) with its down & distance, spot, clock, yardage and the score after it; the
// drives; the box score per athlete with ESPN ids; the quarter line. From that:
//   Feed  — the plays newest first (key plays by default: scores, misses, turnovers, sacks,
//           20+ yard plays, fourth downs; "all" adds the rest), each with the situation, a
//           headline, the players involved with their game line AS OF that play (+delta),
//           the clock and the score after.
//   Stats — the quarter line, then Away | Fantasy | Home: a side's box score by stat group,
//           or the fantasy pane (the week's stat rows under any synced league's scoring, the
//           owner in that league beside the name, the projection under the points).
// Plays name players as "J.Burrow"; the box score names them in full with ids, so the two
// are joined by first initial + last name within the team, then to Sleeper ids by espn_id.
var _gcd = { sum:{}, busy:{}, tab:null, side:'fantasy', feedAll:false };
const GC_SUMMARY_URL = (eid)=>`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eid}`;
const GC_SUM_TTL_LIVE = 12*1000, GC_SUM_TTL_FINAL = 6*60*60*1000, GC_SUM_TTL_PRE = 10*60*1000;
// While a picked game is on and the panel is in view, the summary (and the scoreboard) are
// re-read every GC_LIVE_POLL ms — ESPN posts a play within seconds; the sheet's own 61 s
// repaint was the ceiling before. One timer, restarted by every repaint.
const GC_LIVE_POLL = 5*1000;
var _gcLiveTimer = null;
// Change-driven: the scoreboard's situation carries the last play's id. When the picked
// game's changes, its summary is re-read at once (the plays land within seconds of ESPN
// posting them); between plays the situation line alone repaints. No last play on the
// board (an older payload) → the summary's own live TTL stands in.
function gcStreamOnBoard(teams){
  if(typeof _gc==='undefined' || _gc.view==='feed' || !_gc.game || !teams) return;
  const [away, home]=String(_gc.game).split('@'); const g=teams[home]||teams[away]; if(!g || g.state!=='in') return;
  const eid=String(g.eid||''); const sit=g.sit||null; if(!eid) return;
  const key=sit ? `${sit.lastPlayId}|${sit.ddt}|${sit.spot}|${sit.clock}` : '';
  if(!_gcd.seen) _gcd.seen={};
  if(!sit || key===_gcd.seen[eid]) return;
  const playChanged = !sit.lastPlayId || !_gcd.seen[eid] || String(_gcd.seen[eid]).split('|')[0]!==sit.lastPlayId;
  _gcd.seen[eid]=key;
  if(playChanged && _gcd.sum[eid]) _gcd.sum[eid].at=0;            // stale the instant a play posts
  if(playChanged) gcSummary({eid, state:'in'});                      // fetch now; repaints when it lands
  else gcDetailRepaint();                                            // the down moved: the situation line
}
function gcPanelVisible(){
  if(typeof _gc!=='undefined' && _gc && _gc.mode==='max') return true;
  return !!(typeof _gcm!=='undefined' && _gcm && _gcm.open && _gcm.open!=='closed');
}
function gcLiveTick(game){
  if(_gcLiveTimer){ clearTimeout(_gcLiveTimer); _gcLiveTimer=null; }
  if(!game || game.state!=='in' || !gcPanelVisible()) return;
  _gcLiveTimer=setTimeout(()=>{
    _gcLiveTimer=null;
    if(typeof _gc==='undefined' || _gc.game!==game.id || !gcPanelVisible()) return;
    try{ if(typeof tcWeekBoard==='function') tcWeekBoard(); }catch(e){}   // the score, the clock, the last play's id (→ gcStreamOnBoard)
    if(!game.sit){ try{ gcSummary(game); }catch(e){} }                      // no situation on the board: the summary's own TTL
    else { try{ gcSummaryCatchUp(game); }catch(e){} }                       // the summary posts a play later than the scoreboard: keep reading until it has it
    gcLiveTick(game);
  }, GC_LIVE_POLL);
}
// The scoreboard names the last play seconds before the summary carries it (verified live:
// the summary was still on the timeout when the board had the kickoff). A summary read on
// the play's first sighting can miss it, and it would then surface only with the NEXT play
// — one play behind all night. So every tick, while the summary's plays do not yet include
// the board's last play, the summary is read again (its cache staled first).
function gcSummaryBehind(game){
  const eid=game && game.eid, id=game && game.sit && String(game.sit.lastPlayId||'');
  if(!eid || !id) return false;
  const c=_gcd.sum[eid]; if(!c || !c.data) return false;
  const dr=c.data.drives||{};
  const drives=[].concat(dr.previous||[], dr.current?[dr.current]:[]);
  return !drives.some(d=>(d.plays||[]).some(p=>String(p.id||'')===id));
}
function gcSummaryCatchUp(game){
  const eid=game && game.eid; if(!eid || _gcd.busy[eid]) return false;
  if(!gcSummaryBehind(game)) return false;
  if(_gcd.sum[eid]) _gcd.sum[eid].at=0;
  gcSummary(game);
  return true;
}
const GC_SKIP_TYPES = new Set(['Timeout','Official Timeout','End Period','End of Half','End of Game','Two-minute warning']);
const GC_BOX_GROUPS = [['passing','Passing'],['rushing','Rushing'],['receiving','Receiving'],['fumbles','Fumbles'],['defensive','Defense'],['interceptions','Interceptions'],['kickReturns','Kick returns'],['puntReturns','Punt returns'],['kicking','Kicking'],['punting','Punting']];

// The summary for a game (cached; live games re-read every 30 s, finals rest).
function gcSummary(game){
  const eid=game && game.eid; if(!eid) return null;
  const c=_gcd.sum[eid];
  const ttl=game.state==='post'?GC_SUM_TTL_FINAL:(game.state==='in'?GC_SUM_TTL_LIVE:GC_SUM_TTL_PRE);
  if(c && Date.now()-c.at<ttl) return c.data;
  if(!_gcd.busy[eid] && typeof sleeperFetch==='function'){
    _gcd.busy[eid]=true;
    sleeperFetch(GC_SUMMARY_URL(eid), {fresh: game.state==='in'}).then(d=>{ if(d && (d.drives||d.boxscore||d.header)){ _gcd.sum[eid]={data:d, at:Date.now()}; const added=typeof lfSummaryLanded==='function'?lfSummaryLanded(eid,d):0; gcSummaryRepaint(added); } }).catch(()=>{}).finally(()=>{ _gcd.busy[eid]=false; });
  }
  return c?c.data:null;
}
function gcSummaryRepaint(added){
  if(typeof _gc!=='undefined' && _gc.view==='feed'){
    if(added>0 && typeof lfRepaint==='function') lfRepaint();
    return;
  }
  gcDetailRepaint();
}
function gcDetailRepaint(){
  if(typeof renderRightSidebar!=='function') return;
  const paint=()=>{ if(typeof tcPreserveViewScroll==='function') tcPreserveViewScroll(()=>renderRightSidebar(), ['.gc-detail','.gcm-sheet','.gc-body']); else renderRightSidebar(); };
  if(typeof tcRepaintWhenIdle==='function') tcRepaintWhenIdle('rsb', paint); else paint();   // never under a finger or an open picker
}
function gcdSetTab(t){ _gcd.tab=t; gcDetailRepaint(); }
function gcdSetSide(s){ _gcd.side=s; gcDetailRepaint(); }
function gcdSetFeedAll(v){ _gcd.feedAll=!!v; gcDetailRepaint(); }
function gcdTab(game){ return _gcd.tab || (game && game.state==='pre' ? 'stats' : 'feed'); }

// ── ESPN ↔ app identities ────────────────────────────────────────────────────
function gcAbbr(ab){ ab=String(ab||'').toUpperCase(); return (typeof TC_BOARD_ABBR!=='undefined' && TC_BOARD_ABBR[ab]) || ab; }
var _gcEspnIdx = null;
function gcEspnIndex(){
  if(_gcEspnIdx) return _gcEspnIdx;
  _gcEspnIdx={};
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers : {};
  for(const pid in sp){ const e=sp[pid] && sp[pid].espn_id; if(e) _gcEspnIdx[String(e)]=pid; }
  return _gcEspnIdx;
}
function gcNameNorm(s){ return String(s||'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g,'').replace(/[^a-z]/g,''); }
function gcShort(name){
  const n=String(name||'').trim(); if(!n) return '';
  if(typeof ldShortName==='function'){ const s=ldShortName(n); if(s) return s; }
  const i=n.indexOf(' '); return i>0 ? `${n[0]}. ${n.slice(i+1)}` : n;
}
// Every athlete the box score names, by team: {id, name, team, groups, pid, pos}.
function gcAthletes(sum){
  if(sum && sum._gcAth) return sum._gcAth;
  const out={ byId:{}, byKey:{}, teams:{} };
  const idx=gcEspnIndex();
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers : {};
  ((sum && sum.boxscore && sum.boxscore.teams)||[]).forEach(t=>{ if(t.team) out.teams[String(t.team.id)]=gcAbbr(t.team.abbreviation); });
  ((sum && sum.boxscore && sum.boxscore.players)||[]).forEach(tp=>{
    const team=gcAbbr(tp.team && tp.team.abbreviation);
    (tp.statistics||[]).forEach(g=>{
      (g.athletes||[]).forEach(a=>{
        const ath=a.athlete||{}; const id=String(ath.id||''); if(!id) return;
        let rec=out.byId[id];
        if(!rec){
          const name=String(ath.displayName||ath.shortName||'').trim();
          let pid=idx[id]||null;
          if(!pid && typeof lfPidFor==='function'){
            const sp1=name.indexOf(' ');
            if(sp1>0) pid=lfPidFor(`${name[0]}.${name.slice(sp1+1)}`, team, null);
          }
          const spp=pid?sp[pid]:null;
          rec={ id, name, team, groups:new Set(), pid, pos:spp?String(spp.pos||'').toUpperCase():'' };
          out.byId[id]=rec;
          const sp1=name.indexOf(' '); const last=sp1>0?name.slice(sp1+1):name;
          const key=`${team}|${name[0]||''}.${gcNameNorm(last)}`.toLowerCase();
          const line=new Set(['C','G','T','OL','OT','OG','LS']);
          const had=out.byKey[key];
          if(!had || (line.has(String(had.pos||'')) && !line.has(String(rec.pos||'')))) out.byKey[key]=rec;
        }
        rec.groups.add(g.name);
      });
    });
  });
  // a position for the athletes Sleeper's map does not carry: by the groups they appear
  // in, priority first (a kicker who made a tackle is still a K)
  for(const id in out.byId){ const r=out.byId[id]; if(r.pos) continue; const G=r.groups;
    r.pos = G.has('passing')?'QB':G.has('kicking')?'K':G.has('punting')?'P':G.has('rushing')?'RB':G.has('receiving')?'WR':(G.has('defensive')||G.has('interceptions'))?'DEF':''; }
  if(sum) sum._gcAth=out;
  return out;
}
// ── Live lines from the box score ────────────────────────────────────────────
// ESPN's box score moves with every play the summary carries; Sleeper's week rows trail it
// by a minute or more. While a game is on, the fantasy pane scores the box score: each
// athlete's groups mapped onto Sleeper's stat keys, laid over his Sleeper row (or standing
// in for it before Sleeper has one). Finals go back to Sleeper's rows.
const GC_BOX_STAT = {
  passing:      { 'completions/passingAttempts':['pass_cmp','pass_att'], passingYards:'pass_yd', passingTouchdowns:'pass_td', interceptions:'pass_int', 'sacks-sackYardsLost':['pass_sack'] },
  rushing:      { rushingAttempts:'rush_att', rushingYards:'rush_yd', rushingTouchdowns:'rush_td' },
  receiving:    { receptions:'rec', receivingYards:'rec_yd', receivingTouchdowns:'rec_td', receivingTargets:'rec_tgt' },
  fumbles:      { fumbles:'fum', fumblesLost:'fum_lost' },
  kicking:      { 'fieldGoalsMade/fieldGoalAttempts':['fgm','fga'], 'extraPointsMade/extraPointAttempts':['xpm','xpa'] },
  defensive:    { totalTackles:'idp_tkl', soloTackles:'idp_tkl_solo', sacks:'idp_sack', tacklesForLoss:'idp_tkl_loss', passesDefended:'idp_pass_def', QBHits:'idp_qb_hit', defensiveTouchdowns:'idp_def_td' },
  interceptions:{ interceptions:'idp_int' },
  kickReturns:  { kickReturnYards:'kr_yd', kickReturnTouchdowns:'kr_td' },
  puntReturns:  { puntReturnYards:'pr_yd', puntReturnTouchdowns:'pr_td' },
};
function gcBoxRows(sum){
  if(!sum || !sum.boxscore) return [];
  if(sum._gcBoxRows) return sum._gcBoxRows;
  const ath=gcAthletes(sum);
  const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers) ? sleeperPlayers : {};
  const out={};
  (sum.boxscore.players||[]).forEach(tp=>{
    const team=gcAbbr(tp.team && tp.team.abbreviation);
    (tp.statistics||[]).forEach(g=>{
      const map=GC_BOX_STAT[g.name]; if(!map) return;
      const keys=g.keys||[];
      (g.athletes||[]).forEach(a=>{
        const id=String((a.athlete||{}).id||''); const rec=ath.byId[id]; if(!rec || !rec.pid) return;
        if(!out[rec.pid]){
          const p=sp[rec.pid]||{}; const nm=String(p.name||rec.name||''); const i=nm.indexOf(' ');
          out[rec.pid]={ player_id:rec.pid, team, position:String(p.pos||rec.pos||'').toUpperCase(), live:true,
            player:{ first_name:i>0?nm.slice(0,i):nm, last_name:i>0?nm.slice(i+1):'', position:String(p.pos||rec.pos||'').toUpperCase(), team }, stats:{gp:1} };
        }
        const st=out[rec.pid].stats;
        (a.stats||[]).forEach((v,i)=>{
          const k=map[keys[i]]; if(!k) return;
          if(Array.isArray(k)){ const parts=String(v).split(/[\/-]/).map(Number); k.forEach((kk,j)=>{ if(Number.isFinite(parts[j])) st[kk]=parts[j]; }); }
          else { const n=Number(v); if(Number.isFinite(n)) st[k]=n; }
        });
      });
    });
  });
  const rows=Object.values(out);
  sum._gcBoxRows=rows;
  return rows;
}
// The week's rows with the box score laid over them for a game in progress.
function gcLiveRows(rows, game){
  if(!game || game.state!=='in' || !game.eid) return rows;
  const c=_gcd.sum[String(game.eid)]; const sum=c && c.data; if(!sum) return rows;
  const box=gcBoxRows(sum); if(!box.length) return rows;
  const base=Array.isArray(rows)?rows:[];
  const byPid={}; base.forEach((r,i)=>{ byPid[String(r.player_id)]=i; });
  const out=base.slice();
  box.forEach(b=>{
    const i=byPid[String(b.player_id)];
    if(i==null) out.push(b);
    else out[i]=Object.assign({}, out[i], { stats:Object.assign({}, out[i].stats||{}, b.stats), live:true });
  });
  return out;
}
// "J.Burrow" / "A.St. Brown" → the box-score athlete on that team (null when unknown).
function gcFindAth(ath, team, token){
  if(!token) return null;
  const m=/^([A-Za-z])\.(.+)$/.exec(token); if(!m) return null;
  const key=`${team}|${m[1]}.${gcNameNorm(m[2])}`.toLowerCase();
  if(ath.byKey[key]) return ath.byKey[key];
  // the other team (a defender in an offensive play's text), then any team by last name
  for(const k in ath.byKey){ if(k.endsWith(`|${m[1]}.${gcNameNorm(m[2])}`.toLowerCase())) return ath.byKey[k]; }
  return null;
}
const GC_TOKEN = '([A-Z])\\.((?:St\\. )?[A-Z][A-Za-z\'\\-]+(?:-[A-Z][a-z]+)?)';
function gcTok(re, text){ const m=new RegExp(re).exec(text||''); return m ? `${m[1]}.${m[2]}` : ''; }
// The play, with its lead-ins removed: the formation note ("(Shotgun)", "(No Huddle,
// Shotgun)") and the linemen who report eligible — "C.Vinson reported in as eligible.
// D.Henry right end to IND 25 …" is a Derrick Henry run, and reading the first name in
// the text made it a Caleb Vinson run.
// One name: "J.Ezeudu", "G.Van Roten", "K.Walker III". A list of them: "J.Ezeudu, J.Moore and
// K.Tonga reported in as eligible." — every one of them a lineman, none of them the play.
const GC_ELIG_NAME = "[A-Z]\\.[A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+)*";
const GC_ELIG_RE = new RegExp('^\\s*(?:'+GC_ELIG_NAME+'(?:,\\s*|\\s+and\\s+|\\s*&\\s*))*'+GC_ELIG_NAME+'\\s+reported in as eligible\\.\\s*');
function gcPlayBody(text){
  let t=String(text||'');
  for(let i=0;i<4;i++){
    const before=t;
    t=t.replace(/^\s*\([^)]*\)\s*/,'');
    t=t.replace(GC_ELIG_RE,'');
    if(t===before) break;
  }
  return t;
}
// The people in a play, from its text: the primary actor (rusher, passer, kicker), the
// receiver, the intended target, the interceptor.
function gcPlayNames(text){
  const t=gcPlayBody(text);
  return {
    primary: gcTok('^\\s*(?:\\([^)]*\\)\\s*)*'+GC_TOKEN, t),
    receiver: gcTok(' to '+GC_TOKEN, t),
    intended: gcTok('intended for '+GC_TOKEN, t),
    picker: gcTok('INTERCEPTED by '+GC_TOKEN, t),
    recoverer: gcTok('RECOVERED by [A-Z]{2,3}-'+GC_TOKEN, t),
  };
}

// ── The plays, flattened and typed ───────────────────────────────────────────
function gcPlayKind(p){
  const t=String((p.type&&p.type.text)||'');
  if(GC_SKIP_TYPES.has(t)) return 'skip';
  if(/Touchdown/.test(t) || (p.scoringPlay && /Two Point|Safety/.test(t))) return 'td';
  if(t==='Field Goal Good') return 'fg';
  if(t==='Extra Point Good') return 'xp';
  if(/Field Goal Missed|Blocked Field Goal|Extra Point Missed|Blocked Extra Point/.test(t)) return 'miss';
  if(p.isTurnover || /Interception|Fumble Recovery \(Opponent\)|Opp Fumble Recovery/.test(t)) return 'to';
  if(/^Sack/.test(t)) return 'sack';
  if((t==='Rush' || t==='Pass Reception') && Number(p.statYardage||0)>=20) return 'big';
  if(t==='Penalty') return 'pen';
  if(p.start && Number(p.start.down)===4 && !/Punt|Field Goal|Kickoff/.test(t)) return 'fourth';
  return 'play';
}
function gcPlays(sum){
  const dr=(sum && sum.drives)||{};
  // While a drive is in progress ESPN lists it under BOTH `previous` and `current` (verified
  // live, DET@BUF 2026-09-17: the same twelve plays in each) — every play of the live drive
  // came through twice, doubling the rows and the running lines. One pass per play id.
  const drives=[].concat(dr.previous||[], dr.current?[dr.current]:[]);
  const out=[], seen=new Set();
  drives.forEach(d=>{
    const team=gcAbbr(d.team && d.team.abbreviation);
    (d.plays||[]).forEach(p=>{
      const pid=String(p.id||'');
      if(pid){ if(seen.has(pid)) return; seen.add(pid); }
      const kind=gcPlayKind(p); if(kind==='skip') return;
      out.push({ id:pid, seq:Number(p.sequenceNumber||0), kind, type:String((p.type&&p.type.text)||''), text:String(p.text||''),
        at:p.wallclock ? Date.parse(p.wallclock)||0 : 0,
        q:Number((p.period&&p.period.number)||0), clock:String((p.clock&&p.clock.displayValue)||''),
        as:p.awayScore!=null?Number(p.awayScore):null, hs:p.homeScore!=null?Number(p.homeScore):null,
        yds:Number(p.statYardage||0), scoring:!!p.scoringPlay, turnover:!!p.isTurnover, team,
        down:Number((p.start&&p.start.down)||0), ddt:String((p.start&&p.start.shortDownDistanceText)||''), spot:String((p.start&&p.start.possessionText)||''),
        yte:(p.start&&p.start.yardsToEndzone!=null)?Number(p.start.yardsToEndzone):null });
    });
  });
  return out.sort((a,b)=>a.seq-b.seq || a.id.localeCompare(b.id));
}
// Game lines as of each play: {playId: {who:[{ath, line, delta}]}} plus a headline per play.
function gcFeedBuild(sum){
  const ath=gcAthletes(sum);
  const tot={};   // athlete id → running totals
  const T=(a)=>{ if(!tot[a.id]) tot[a.id]={cmp:0,att:0,pyds:0,ptd:0,int:0,car:0,ryds:0,rtd:0,rec:0,recyds:0,rectd:0,fgm:0,fga:0,xpm:0,xpa:0,sacked:0}; return tot[a.id]; };
  const plays=gcPlays(sum);
  let pa=0, ph=0;
  plays.forEach(p=>{
    const n=gcPlayNames(p.text);
    const A=(tok, team)=>gcFindAth(ath, team||p.team, tok);
    const prim=A(n.primary), recv=A(n.receiver), picker=A(n.picker), y=p.yds;
    const who=[];
    const line=(a, kind, delta)=>{ const t=T(a); let s='';
      if(kind==='rush') s=`${t.car} CAR, ${t.ryds} YD${t.rtd?`, ${t.rtd} TD`:''}`;
      else if(kind==='rec') s=`${t.rec} REC, ${t.recyds} YD${t.rectd?`, ${t.rectd} TD`:''}`;
      else if(kind==='pass') s=`${t.cmp}/${t.att} CMP, ${t.pyds} YD${t.ptd?`, ${t.ptd} TD`:''}${t.int?`, ${t.int} INT`:''}`;
      else if(kind==='kick') s=`${t.fgm}/${t.fga} FG, ${t.xpm}/${t.xpa} XP`;
      else if(kind==='sacked') s=`sacked ${t.sacked}×`;
      else s=kind;
      who.push({ath:a, line:s, delta:delta||''}); };
    let title='';
    const nm=(a, tok)=>a?gcShort(a.name):(tok||'');
    switch(p.type){
      case 'Rush': case 'Rushing Touchdown': {
        if(prim){ const t=T(prim); t.car++; t.ryds+=y; if(p.type==='Rushing Touchdown') t.rtd++; line(prim,'rush',`+${y} YD`); }
        title = p.type==='Rushing Touchdown' ? `${nm(prim,n.primary)} ${y} yd rush TD 🎉` : `${nm(prim,n.primary)} ${y} yd rush`; break; }
      case 'Pass Reception': case 'Passing Touchdown': {
        if(prim){ const t=T(prim); t.att++; t.cmp++; t.pyds+=y; if(p.type==='Passing Touchdown') t.ptd++; }
        if(recv){ const t=T(recv); t.rec++; t.recyds+=y; if(p.type==='Passing Touchdown') t.rectd++; line(recv,'rec',`+${y} YD`); }
        if(prim) line(prim,'pass',`+${y} YD`);
        title = p.type==='Passing Touchdown' ? `${nm(recv,n.receiver)} ${y} yd TD catch 🎉` : `${nm(prim,n.primary)} ${y} yd pass to ${nm(recv,n.receiver)}`; break; }
      case 'Pass Incompletion': {
        if(prim){ const t=T(prim); t.att++; line(prim,'pass'); }
        title=`${nm(prim,n.primary)} incomplete${n.receiver?` to ${nm(recv,n.receiver)}`:''}`; break; }
      case 'Interception Return': case 'Interception Return Touchdown': {
        if(prim){ const t=T(prim); t.att++; t.int++; line(prim,'pass'); }
        if(picker) who.push({ath:picker, line:'INT'+(p.type==='Interception Return Touchdown'?`, ${y} yd TD`:''), delta:''});
        title=`INT! ${nm(prim,n.primary)} picked off by ${nm(picker,n.picker)}${p.type==='Interception Return Touchdown'?' — pick six 🎉':''}`; break; }
      case 'Field Goal Good': case 'Field Goal Missed': case 'Blocked Field Goal': {
        if(prim){ const t=T(prim); t.fga++; if(p.type==='Field Goal Good') t.fgm++; line(prim,'kick'); }
        title = p.type==='Field Goal Good' ? `${nm(prim,n.primary)} ${y} yd FG 🙌` : `${nm(prim,n.primary)} ${y} yd FG, no good`; break; }
      case 'Extra Point Good': case 'Extra Point Missed': case 'Blocked Extra Point': {
        if(prim){ const t=T(prim); t.xpa++; if(p.type==='Extra Point Good') t.xpm++; line(prim,'kick'); }
        title = p.type==='Extra Point Good' ? `${nm(prim,n.primary)} XP, good` : `${nm(prim,n.primary)} XP, ${p.type==='Blocked Extra Point'?'blocked':'missed'}`; break; }
      case 'Sack': case 'Sack Opp Fumble Recovery': {
        if(prim){ const t=T(prim); t.sacked++; line(prim,'sacked'); }
        title = p.type==='Sack' ? `${nm(prim,n.primary)} sacked, ${y} yds` : `Fumble! ${nm(prim,n.primary)} sacked and stripped`; break; }
      case 'Fumble Recovery (Opponent)': case 'Fumble Return Touchdown': {
        title=`Fumble! ${nm(prim,n.primary)} loses it${n.recoverer?`, ${nm(A(n.recoverer,''),n.recoverer)} recovers`:''}${/Touchdown/.test(p.type)?' — TD 🎉':''}`; break; }
      case 'Punt': title=`${nm(prim,n.primary)} punts ${/punts (\d+)/.test(p.text)?RegExp.$1:''} yds`; break;
      case 'Kickoff': title=`${nm(prim,n.primary)} kicks off`; break;
      case 'Penalty': { const m=/penalty on ([A-Z]{2,3})-([^,]+), ([^,.]+)(?:, (\d+) yards?)?(?:, (declined))?/i.exec(p.text); title = m ? `Flag: ${m[3]} on ${m[1]}${m[4]?`, ${m[4]} yds`:''}${m[5]?', declined':''}` : 'Penalty'; break; }
      default: title = p.text.replace(/^\s*(\([^)]*\)\s*)+/,'').slice(0, 90);
    }
    // The try rides in the touchdown's own text ("… TOUCHDOWN. E.McPherson extra point is
    // GOOD …"): count it for the kicker, and show him under the scorer.
    if(/Touchdown/.test(p.type)){
      const xp=new RegExp(GC_TOKEN+' extra point is (GOOD|No Good|BLOCKED|Aborted)', 'i').exec(p.text);
      if(xp){ const k=A(`${xp[1]}.${xp[2]}`); if(k){ const t=T(k); t.xpa++; if(/good/i.test(xp[3]) && !/no good/i.test(xp[3])) t.xpm++; line(k,'kick'); } }
    }
    // whose score moved: the away side, the home side, or neither
    p.scoredBy = (p.as!=null && p.hs!=null) ? (p.as>pa?'away':(p.hs>ph?'home':'')) : '';
    if(p.as!=null) pa=p.as; if(p.hs!=null) ph=p.hs;
    p.title=title; p.who=who;
  });
  return plays;
}
const GC_KEY_KINDS = new Set(['td','fg','xp','miss','to','sack','big','fourth']);
function gcFeedRows(sum, all){
  const plays=gcFeedBuild(sum);
  return plays.filter(p=>all || GC_KEY_KINDS.has(p.kind)).reverse();
}
function gcFeedPlayerHTML(w, game){
  const a=w.ath; const pid=a.pid||''; const pos=a.pos||'';
  const owner = pid ? gcOwnerOf(pid) : '';
  const click = (pid && pos && pos!=='DEF' && typeof pcardOnclick==='function') ? ` onclick="event.stopPropagation();${pcardOnclick(pid, pos, a.team||'')}"` : '';
  return `<div class="gcf-who"${click}><span class="gcf-name${pid&&typeof gcSideClass==='function'?gcSideClass(pid):''}">${escHtml(gcShort(a.name))}</span>${pos?`<span class="gcf-pos gcf-pos-${escAttr(pos.toLowerCase())}">${escHtml(pos)}</span>`:''}${owner?`<span class="gcf-owner">${escHtml(owner)}</span>`:''}<span class="gcf-stat">${escHtml(w.line)}${w.delta?` <em>(${escHtml(w.delta)})</em>`:''}</span></div>`;
}
// The ball right now (a game on): possession, the down, the spot, the clock — the line
// above the feed that moves between plays, the way the next play is "coming".
function gcSituationHTML(game){
  if(!game || game.state!=='in') return '';
  const stamp=(typeof tcFreshHTML==='function')?tcFreshHTML(game.eid):'';
  const sit=game.sit;
  // no situation block at all (ESPN drops it between halves at times): the status says where we are
  if(!sit) return game.detail ? `<div class="gcf-now"><span class="gcf-dot"></span><b>${escHtml(game.detail)}</b>${stamp}</div>` : '';
  // halftime / the end of a quarter: say so, no down and no clock to read
  if(sit.phase) return `<div class="gcf-now"><span class="gcf-dot"></span><b>${escHtml(sit.phase)}</b>${stamp}</div>`;
  const poss=sit.poss||'';
  return `<div class="gcf-now"><span class="gcf-dot"></span>${poss?`<img src="${NFL_LOGO(poss)}" class="gc-glogo" onerror="this.style.display='none'"><b>${escHtml(poss)} ball</b>`:'<b>Live</b>'}${sit.ddt?`<span class="gcf-now-dd">${escHtml(sit.ddt)}${sit.spot?` @ ${escHtml(sit.spot)}`:''}</span>`:''}${sit.rz?'<span class="gcf-rz">RZ</span>':''}<span class="gcf-now-clock">${sit.period?`Q${sit.period}`:''} ${escHtml(sit.clock||'')}</span>${stamp}</div>`;
}
function gcFeedHTML(game, sum){
  if(game.state==='pre') return `<div class="ld-empty">no plays yet · ${escHtml(game.detail||'kickoff ahead')}</div>`;
  const now='';   // the situation lives in the hero now (gcSituationHTML stays for the phone's compact paths)
  if(!sum) return now+`<div class="ld-empty">${game.eid?'loading the plays…':'plays unavailable for this game'}</div>`;
  const rows=gcFeedRows(sum, _gcd.feedAll);
  // plays newer than the top of the last paint flash in (a live game's fresh play)
  if(!_gcd.topSeq) _gcd.topSeq={};
  const eid=String(game.eid||''); const prevTop=_gcd.topSeq[eid];
  const isNew=(p)=>game.state==='in' && prevTop!=null && p.seq>prevTop;
  if(rows.length) _gcd.topSeq[eid]=rows[0].seq;
  const toggle=`<div class="gcf-bar"><span>${_gcd.feedAll?'every play':'key plays'}</span><button class="ld-pos ${_gcd.feedAll?'':'active'}" onclick="gcdSetFeedAll(false)">Key</button><button class="ld-pos ${_gcd.feedAll?'active':''}" onclick="gcdSetFeedAll(true)">All</button></div>`;
  // The scoreboard names a play 10-20 s before the summary carries it: while the summary is
  // behind, the board's last play leads the feed as a provisional row — the headline now,
  // the running lines when the summary lands (the row then becomes the real one).
  const soon=gcProvisionalRow(game, sum);
  if(!rows.length && !soon) return now+toggle+`<div class="ld-empty">no plays yet</div>`;
  const badge=(p)=>p.kind==='td'?'TD':p.kind==='fg'?'FG':p.kind==='xp'?'XP':p.kind==='to'?'TO':p.kind==='sack'?'SACK':p.kind==='big'?'BIG':p.kind==='fourth'?'4TH':p.kind==='miss'?'MISS':'';
  const html=rows.map(p=>{
    const rz = p.yte!=null && p.yte<=20 && p.type!=='Kickoff' && p.type!=='Punt';
    const sit = p.down>0 ? `${p.ddt}${p.spot?` @ ${p.spot}`:''}` : (p.kind==='xp'||p.kind==='miss'&&/Extra/.test(p.type)?'End zone':(p.type==='Kickoff'?'Kickoff':''));
    const score = (p.as!=null && p.hs!=null) ? `<span class="${p.scoredBy==='away'?'gcf-sc-hit':''}">${game.away} ${p.as}</span><span class="gcf-dash">–</span><span class="${p.scoredBy==='home'?'gcf-sc-hit':''}">${p.hs} ${game.home}</span>` : '';
    return `<div class="gcf-row gcf-${p.kind}${isNew(p)?' gcf-new':''}">
      <img src="${NFL_LOGO(p.team||game.home)}" class="gcf-logo" onerror="this.style.display='none'">
      <div class="gcf-main">
        <div class="gcf-sit">${escHtml(sit)}${rz?' <span class="gcf-rz">RZ</span>':''}</div>
        <div class="gcf-title">${(()=>{ let t=escHtml(p.title); (p.who||[]).forEach(w=>{ const pid=w.ath&&w.ath.pid; if(!pid||typeof gcSideClass!=='function') return; const c=gcSideClass(pid).trim(); if(!c) return; const esc=escHtml(gcShort(w.ath.name)); if(t.indexOf(esc)>=0) t=t.replace(esc, `<span class="${c}">${esc}</span>`); }); return t; })()}</div>
        ${p.who.map(w=>gcFeedPlayerHTML(w, game)).join('')}
      </div>
      <div class="gcf-right"><div class="gcf-clock">${p.q?`Q${p.q}`:''} ${escHtml(p.clock)}</div><div class="gcf-score">${score}</div>${badge(p)?`<span class="gcf-badge gcf-b-${p.kind}">${badge(p)}</span>`:''}</div>
    </div>`;
  }).join('');
  return now+toggle+`<div class="gcf">${soon||''}${html}</div>`;
}
// The board's last play as a feed row while the summary does not have it yet.
function gcProvisionalRow(game, sum){
  if(!game || game.state!=='in' || !game.sit || !game.sit.lastPlay || !game.sit.lastPlayId) return '';
  if(typeof gcSummaryBehind!=='function' || !gcSummaryBehind(game)) return '';
  const lp=game.sit.lastPlay;
  if(!lp.text || GC_SKIP_TYPES.has(String(lp.type||''))) return '';
  const read=(typeof lfReadPlay==='function') ? lfReadPlay(lp) : null;
  const title=(read && read.title) || String(lp.text||'').replace(/^\s*(\([^)]*\)\s*)+/,'').slice(0,90);
  const k=read?read.kind:'other';
  const kind = (k==='rushTd'||k==='recTd') ? 'td' : k==='fg' ? 'fg' : k==='xp' ? 'xp' : (k==='int'||k==='fum') ? 'to' : k==='sack' ? 'sack' : (k==='fgMiss'||k==='xpMiss') ? 'miss' : (Number(lp.yds||0)>=20 ? 'big' : 'play');
  if(!_gcd.feedAll && !GC_KEY_KINDS.has(kind)) return '';
  const sit = lp.down>0 ? `${lp.ddt||''}${lp.spot?` @ ${lp.spot}`:''}` : '';
  const rz = lp.yte!=null && lp.yte<=20;
  const score=`<span>${game.away} ${game.as!=null?game.as:'–'}</span><span class="gcf-dash">–</span><span>${game.hs!=null?game.hs:'–'} ${game.home}</span>`;
  const badge = kind==='td'?'TD':kind==='fg'?'FG':kind==='xp'?'XP':kind==='to'?'TO':kind==='sack'?'SACK':kind==='big'?'BIG':kind==='miss'?'MISS':'';
  return `<div class="gcf-row gcf-${kind} gcf-new gcf-soon" title="Just posted — the full line lands in a moment">
      <img src="${NFL_LOGO(lp.team||game.home)}" class="gcf-logo" onerror="this.style.display='none'">
      <div class="gcf-main">
        <div class="gcf-sit">${escHtml(sit)}${rz?' <span class="gcf-rz">RZ</span>':''}</div>
        <div class="gcf-title">${escHtml(title)}</div>
        <div class="gcf-soon-tag">just in</div>
      </div>
      <div class="gcf-right"><div class="gcf-clock">${game.sit.period?`Q${game.sit.period}`:''} ${escHtml(game.sit.clock||'')}</div><div class="gcf-score">${score}</div>${badge?`<span class="gcf-badge gcf-b-${kind}">${badge}</span>`:''}</div>
    </div>`;
}

// ── The quarter line and the box score ───────────────────────────────────────
function gcLinescoreHTML(game, sum){
  const comp=sum && sum.header && sum.header.competitions && sum.header.competitions[0];
  const comps=(comp && comp.competitors)||[];
  const away=comps.find(c=>c.homeAway==='away'), home=comps.find(c=>c.homeAway==='home');
  const ls=(c)=>((c&&c.linescores)||[]).map(l=>l.displayValue!=null?String(l.displayValue):(l.value!=null?String(Math.round(l.value)):'–'));
  const la=ls(away), lh=ls(home);
  const n=Math.max(4, la.length, lh.length);
  if(!away && !home) return '';
  const head=Array.from({length:n},(_,i)=>`<th>${i<4?`Q${i+1}`:(n-4===1?'OT':`OT${i-3}`)}</th>`).join('');
  const row=(code, arr, tot)=>`<tr><td class="gcls-t"><img src="${NFL_LOGO(code)}" class="gc-glogo" onerror="this.style.display='none'">${code}</td>${Array.from({length:n},(_,i)=>`<td>${arr[i]!=null?arr[i]:'–'}</td>`).join('')}<td class="gcls-tot">${tot!=null?tot:'–'}</td></tr>`;
  return `<div class="gcls-wrap"><table class="gcls"><thead><tr><th>Team</th>${head}<th>TOT</th></tr></thead><tbody>${row(game.away, la, game.as)}${row(game.home, lh, game.hs)}</tbody></table></div>`;
}
function gcBoxHTML(game, sum, team){
  if(!sum) return `<div class="ld-empty">${game.eid?'loading the box score…':'box score unavailable'}</div>`;
  const tp=((sum.boxscore&&sum.boxscore.players)||[]).find(t=>gcAbbr(t.team&&t.team.abbreviation)===team);
  if(!tp) return `<div class="ld-empty">no box score yet for ${escHtml(team)}</div>`;
  const ath=gcAthletes(sum);
  const groups=GC_BOX_GROUPS.map(([key,label])=>{
    const g=(tp.statistics||[]).find(s=>s.name===key); if(!g || !(g.athletes||[]).length) return '';
    const labels=g.labels||[]; const nCols=Math.min(labels.length, 8);
    const rows=g.athletes.map(a=>{
      const A=a.athlete||{}; const rec=ath.byId[String(A.id||'')]; const pid=rec&&rec.pid; const pos=rec&&rec.pos;
      const click=(pid && pos && pos!=='DEF' && typeof pcardOnclick==='function') ? ` onclick="${pcardOnclick(pid, pos, team)}"` : '';
      return `<tr${click?' class="gcb-click"':''}${click}><td class="gcb-n"><span class="${pid&&typeof gcSideClass==='function'?gcSideClass(pid).trim():''}">${escHtml(gcShort(A.displayName||A.shortName||''))}</span>${pid&&gcOwnerOf(pid)?`<small class="gcf-owner">${escHtml(gcOwnerOf(pid))}</small>`:''}</td>${(a.stats||[]).slice(0,nCols).map(v=>`<td>${escHtml(String(v))}</td>`).join('')}</tr>`;
    }).join('');
    return `<div class="gcb-group"><div class="gc-gh">${label}</div><div class="gcb-wrap"><table class="gcb"><thead><tr><th></th>${labels.slice(0,nCols).map(l=>`<th>${escHtml(l)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');
  return groups || `<div class="ld-empty">no box score yet for ${escHtml(team)}</div>`;
}

// ── The fantasy pane's league switcher ───────────────────────────────────────
// 'snap' = the Analyzer's league (the app's usual scoring), a league id = one of the user's
// synced leagues (its own scoring and owners, from the player card's league map), 'app' =
// the app's scoring alone.
function gcLeagueOptions(){
  const opts=[];
  if(typeof leagueSnapshot!=='undefined' && leagueSnapshot && leagueSnapshot.scoringRaw) opts.push({id:'snap', name:leagueSnapshot.name||'League'});
  const lg=(typeof _pcardLg!=='undefined' && _pcardLg && _pcardLg.byLeague) ? _pcardLg.byLeague : {};
  Object.keys(lg).forEach(id=>{ const L=lg[id]; if(!L || L.inactive || L.error || L.noRoster) return; if(typeof leagueSnapshot!=='undefined' && leagueSnapshot && String(leagueSnapshot.leagueId)===String(id)) return; opts.push({id:String(id), name:L.name||'League'}); });
  opts.push({id:'app', name:'TripleCrown'});
  return opts;
}
function gcLeague(){
  const opts=gcLeagueOptions();
  const want=_gc.league && opts.find(o=>o.id===_gc.league) ? _gc.league : opts[0].id;
  return want;
}
function gcSetLeague(id){ _gc.league=String(id||''); gcDetailRepaint(); }
function gcLeagueEntry(){
  const id=gcLeague();
  if(id==='snap' || id==='app') return null;
  return (typeof _pcardLg!=='undefined' && _pcardLg && _pcardLg.byLeague && _pcardLg.byLeague[id]) || null;
}
function gcLeagueSelectHTML(){
  const opts=gcLeagueOptions(), cur=gcLeague();
  // The synced leagues load on the first paint that needs them (three small reads each,
  // kept ten minutes); the list says so until they land, then repaints with every league.
  let loading=false;
  if(typeof pcardLeaguesLoad==='function' && typeof _pcardLg!=='undefined' && _pcardLg && typeof pcardLeaguesAvailable==='function' && pcardLeaguesAvailable()){
    if(!_pcardLg.at && !_pcardLg.loading){ try{ const pr=pcardLeaguesLoad(); if(pr && pr.then) pr.then(()=>gcDetailRepaint()).catch(()=>{}); }catch(e){} }
    loading = !_pcardLg.at && !!_pcardLg.loading;
  }
  return `<div class="gc-lgrow"><span class="gc-lglbl">Fantasy</span><select class="ld-sel gc-lgsel" onchange="gcSetLeague(this.value)">${opts.map(o=>`<option value="${escAttr(o.id)}" ${o.id===cur?'selected':''}>${escHtml(o.name)}</option>`).join('')}${loading?'<option disabled>loading your leagues…</option>':''}</select></div>`;
}
// The projected points for a player under the pane's scoring, from the week's projection feed.
function gcProjPts(pid, wk){
  const feed=(typeof laWeekProjFeed==='function') ? laWeekProjFeed(wk) : null;
  const r=feed && feed[String(pid)]; if(!r || !r.stats) return null;
  return gcPoints({player_id:pid, position:String(r.pos||'').toUpperCase(), stats:r.stats});
}

// ── Under the hero: the last play, the drive on the field, the win probability ─
// The Sleeper tracker's grammar: one line for the play that just happened; the drive in
// progress drawn on a field strip with a sentence under it; ESPN's win probability as a
// thin area with the two live numbers. All of it from what the tracker already reads.
function gcTopHTML(game, sum){
  if(!game || game.state==='pre') return '';
  return gcLastPlayHTML(game, sum)+gcDriveChartHTML(game, sum)+gcWinProbHTML(game, sum);
}
// The drives, each play once (the drive in progress is listed under previous AND current).
function gcDrives(sum){
  const dr=(sum && sum.drives)||{}; const seen=new Set(); const out=[];
  const add=(d, live)=>{
    if(!d) return; const id=String(d.id||''); if(id && seen.has(id)) return; if(id) seen.add(id);
    const team=gcAbbr(d.team && d.team.abbreviation); const plays=[]; const pseen=new Set();
    (d.plays||[]).forEach(p=>{
      const pid=String(p.id||''); if(pid && pseen.has(pid)) return; if(pid) pseen.add(pid);
      const kind=gcPlayKind(p); if(kind==='skip') return;
      plays.push({ id:pid, kind, type:String((p.type&&p.type.text)||''), text:String(p.text||''), yds:Number(p.statYardage||0),
        yte:(p.start && p.start.yardsToEndzone!=null)?Number(p.start.yardsToEndzone):null, scoring:!!p.scoringPlay, turnover:!!p.isTurnover,
        q:Number((p.period&&p.period.number)||0), clock:String((p.clock&&p.clock.displayValue)||'') });
    });
    out.push({ id, team, plays, result:String(d.result||d.shortDisplayResult||''), desc:String(d.description||''), score:!!d.isScore, live:!!live });
  };
  (dr.previous||[]).forEach(d=>add(d, false));
  if(dr.current){ const cid=String(dr.current.id||''); const i=out.findIndex(x=>x.id===cid); if(i>=0) out[i].live=true; else add(dr.current, true); }
  return out;
}
// The drive to draw: the one in progress while the game is on, else the last one.
function gcDriveInView(game, sum){
  const ds=gcDrives(sum).filter(d=>d.plays.length); if(!ds.length) return null;
  return (game && game.state==='in' && ds.find(d=>d.live)) || ds[ds.length-1];
}
// "BUF from own 39: 8 plays, 5 rush 24 yds, 3/3 pass 37 yds · TD"
function gcDriveSentence(d){
  if(!d || !d.plays.length) return '';
  const first=d.plays.find(p=>p.yte!=null); const yte=first?first.yte:null;
  const from = yte==null ? '' : (yte>50 ? `from own ${100-yte}` : (yte===50 ? 'from the 50' : `from the ${yte}`));
  let rush=0, rushY=0, cmp=0, att=0, passY=0, sacks=0;
  d.plays.forEach(p=>{
    if(p.type==='Rush' || p.type==='Rushing Touchdown'){ rush++; rushY+=p.yds; }
    else if(p.type==='Pass Reception' || p.type==='Passing Touchdown'){ cmp++; att++; passY+=p.yds; }
    else if(p.type==='Pass Incompletion' || /Interception/.test(p.type)){ att++; }
    else if(/^Sack/.test(p.type)) sacks++;
  });
  const parts=[`${d.plays.length}-play${d.plays.length===1?'':'s'}`];
  if(rush) parts.push(`${rush} rush, ${rushY} yds`);
  if(att) parts.push(`${cmp}/${att} pass, ${passY} yds`);
  if(sacks) parts.push(`${sacks} sack${sacks===1?'':'s'}`);
  const res = d.result ? ` ${escHtml(d.result)}${/TD/.test(d.result)?' 🎉':''}` : (d.live ? ' in progress' : '');
  return `${d.team}${from?' '+from:''}: ${parts.join('. ')}.${res}`;
}
// The drive on the field, Sleeper's way: the field in perspective (the near sideline wide
// at the bottom, the far one narrow at the top), ten-yard bands alternating, each end zone
// solid in its club's colour, yellow uprights standing on both back lines. The offense
// drives left → right from its own goal line: ONE continuous path through the successive
// snap spots — a run a straight line, a pass an arc spanning the throw, a flag a yellow
// marker with a dotted hop — then the last play's own move to where the ball sits now, with
// a pin above it wearing the face of the man who made it. A kick flies from the spot
// through the uprights (or wide, in red). A turnover hands the ball over: the pass or run
// to the spot it was taken, then the defender's return the other way in his club's colour —
// to the left end zone on a pick six — with HIS face on the pin. The newest play animates
// in: the segment draws, the ball travels it, the pin lands; a big play takes longer and pulses.
function _gcFieldGeom(){
  const W=360, top=34, bot=100, xTopL=92, xTopR=268, xBotL=46, xBotR=314;
  const xAt=(yd, y)=>{ const t=(y-top)/(bot-top); const xt=xTopL+(xTopR-xTopL)*yd/100, xb=xBotL+(xBotR-xBotL)*yd/100; return xt+(xb-xt)*t; };
  return {W, top, bot, xAt, lane:top+(bot-top)*0.5};   // the drive and the uprights on the field's centre line
}
// "BUF 30" / "50" → yards from the offense's own goal line
function _gcSpotYd(spot, offense){
  const t=String(spot||'').trim(); if(t==='50') return 50;
  const m=/^([A-Z]{2,3}) (\d{1,2})$/.exec(t); if(!m) return null;
  const n=Number(m[2]); return gcAbbr(m[1])===offense ? n : 100-n;
}
// A turnover in the play's words: who took it, where, where he carried it, and whether he scored.
function gcTurnoverRead(p, offense){
  const t=String(p.text||''); let m, kind=null, who='';
  m=/INTERCEPTED by ([A-Z]\.[A-Za-z'\-]+(?: [A-Z][A-Za-z'\-]+)?)(?: \[[^\]]*\])? at ([A-Z]{2,3} \d{1,2}|50)/.exec(t);
  if(m){ kind='int'; who=m[1]; }
  else { m=/RECOVERED by ([A-Z]{2,3})-([A-Z]\.[A-Za-z'\-]+(?: [A-Z][A-Za-z'\-]+)?) at ([A-Z]{2,3} \d{1,2}|50)/.exec(t); if(m){ kind='fum'; who=m[2]; } }
  if(!kind) return null;
  const at=_gcSpotYd(kind==='int'?m[2]:m[3], offense); if(at==null) return null;
  const rest=t.slice(m.index+m[0].length);
  const td=/TOUCHDOWN/.test(rest);
  let end=at; const r=/ to ([A-Z]{2,3} \d{1,2}|50) for /.exec(rest); if(r){ const e=_gcSpotYd(r[1], offense); if(e!=null) end=e; }
  if(td) end=0;
  const ret=Math.max(0, Math.round(at-end));
  return {kind, who, at, end, td, ret};
}
// A punt in the play's words: where it was fielded, and by whom (fair catch, a real return,
// or a muffed catch the receiving team still comes up with) — a kick with no name after it
// (out of bounds, a touchback, an unrecognized sentence) reads as no returner, and the caller
// falls back to the single arc it always drew.
function gcPuntRead(text, offense){
  const t=String(text||'');
  const km=/punts? \d+ yards? to (?:the )?([A-Z]{2,3} \d{1,2}|50|end zone)/i.exec(t);
  if(!km) return null;
  const catchYd = km[1].toLowerCase()==='end zone' ? 100 : _gcSpotYd(km[1], offense);
  if(catchYd==null) return null;
  const rest=t.slice(km.index+km[0].length);
  const tok="([A-Z]\\.[A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+)*)";
  let m=new RegExp('fair catch by '+tok,'i').exec(rest);
  if(!m) m=new RegExp(tok+'\\s+MUFFS catch','i').exec(rest);
  if(!m) m=new RegExp(tok+'\\s+(?:ran ob|pushed ob|to|at)','i').exec(rest);
  return {catchYd, returner: m ? m[1] : ''};
}
function gcDriveChartHTML(game, sum){
  const d=gcDriveInView(game, sum); if(!d) return '';
  const G=_gcFieldGeom(); const {W, top, bot, xAt, lane}=G; const H=138;
  const f1=(v)=>(+v).toFixed(1);
  const opp = d.team===game.home ? game.away : game.home;
  const col=(t)=>(typeof pwTeamColor==='function' ? pwTeamColor(t) : '#556');
  const quad=(x0,x1,c)=>({x0,x1,d:`M${f1(x0)},${f1(lane)} Q${f1((x0+x1)/2)},${f1(lane-c)} ${f1(x1)},${f1(lane)}`, len:Math.abs(x1-x0)*1.15+c*0.6});
  const line=(x0,x1)=>({x0,x1,d:`M${f1(x0)},${f1(lane)} L${f1(x1)},${f1(lane)}`, len:Math.abs(x1-x0)});
  const parts=[];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="gc-drive-svg" role="img" aria-label="${escAttr(d.team)} drive">`);
  parts.push(`<defs><linearGradient id="gcFieldG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2330"/><stop offset="1" stop-color="#253040"/></linearGradient><linearGradient id="gcEzA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${escAttr(col(d.team))}"/><stop offset="1" stop-color="${escAttr(col(d.team))}" stop-opacity="0.75"/></linearGradient><linearGradient id="gcEzH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${escAttr(col(opp))}" stop-opacity="0.75"/><stop offset="1" stop-color="${escAttr(col(opp))}"/></linearGradient></defs>`);
  const poly=(y0,y1)=>`${f1(xAt(y0,top))},${top} ${f1(xAt(y1,top))},${top} ${f1(xAt(y1,bot))},${bot} ${f1(xAt(y0,bot))},${bot}`;
  parts.push(`<polygon points="${poly(0,100)}" fill="url(#gcFieldG)"/>`);
  for(let yd=0; yd<100; yd+=10){ if((yd/10)%2) parts.push(`<polygon points="${poly(yd,yd+10)}" fill="#fff" opacity="0.04"/>`); }
  for(let yd=10; yd<100; yd+=10) parts.push(`<line x1="${f1(xAt(yd,top))}" y1="${top}" x2="${f1(xAt(yd,bot))}" y2="${bot}" stroke="${yd===50?'#5a6270':'#39414c'}" stroke-width="${yd===50?1.4:1}"/>`);
  // the end zones: solid, the clubs' colours, nothing in them
  parts.push(`<polygon points="${poly(-10,0)}" fill="url(#gcEzA)"/><polygon points="${poly(100,110)}" fill="url(#gcEzH)"/>`);
  // the uprights standing on the back lines, rising above the field
  // the uprights, Sleeper's exactly: a tall vertical stem from the ground at the back line
  // (about two fifths of the field's height), the crossbar tilted with the field — it runs
  // parallel to the back line, so it climbs toward mid-field on both sides — and two short
  // vertical uprights from its ends, rising a little past the field's top edge
  const post=(yd)=>{
    const x=xAt(yd,lane), stem=Math.round((bot-top)*0.24), up=Math.round((bot-top)*0.34), half=6;   // a short stem, tall uprights
    const k0=(bot-top)/(xAt(yd,top)-xAt(yd,bot));   // the back line's slope: positive on the left (leans left going down), negative on the right
    const k=Math.sign(k0)*Math.min(Math.abs(k0), 0.5);   // the crossbar takes its direction, at a gentler pitch (Sleeper's ~25°)
    const cy=lane-stem, y1=cy+k*half, y2=cy-k*half;   // the crossbar's ends
    parts.push(`<g class="gc-posts"><path d="M${f1(x)},${f1(lane+2)} V${f1(cy)} M${f1(x-half)},${f1(y1)} L${f1(x+half)},${f1(y2)} M${f1(x-half)},${f1(y1)} V${f1(y1-up)} M${f1(x+half)},${f1(y2)} V${f1(y2-up)}" fill="none" stroke="#e6b23c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>`);
  };
  const xPostL=xAt(-10,lane), xPostR=xAt(110,lane); post(-10); post(110);
  [[20,'20'],[50,'50'],[80,'20']].forEach(([yd,lab])=>{ parts.push(`<text x="${f1(xAt(yd,top))}" y="${top-7}" fill="#8b94a3" font-size="9" font-weight="800" text-anchor="middle">${lab}</text>`); });
  // the drive: the snap spots in order, then the last play's own move
  const spots=d.plays.filter(p=>p.yte!=null).map(p=>({p, yd:100-p.yte}));
  const eid=String(game.eid||'');
  if(!_gcd.driveSeen) _gcd.driveSeen={};
  const flag=(x)=>`<path class="gc-flag" d="M${f1(x)},${f1(lane+2)} v-11 l7,2.5 l-7,2.5" fill="#f5c542" stroke="#f5c542" stroke-width="1.4" stroke-linejoin="round"/>`;
  if(spots.length){
    const shape=(p, x0, x1)=>{
      const t=p.type;
      if(/Pass|Sack/.test(t)) return Object.assign(quad(x0,x1,Math.min(24, Math.max(8, Math.abs(x1-x0)*0.4))), {cls:''});
      if(t==='Penalty') return Object.assign(line(x0,x1), {cls:' gc-seg-flag'});
      if(/Punt|Kickoff/.test(t)) return Object.assign(quad(x0,x1,26), {cls:' gc-seg-kick'});
      return Object.assign(line(x0,x1), {cls:''});
    };
    // the drive so far is one quiet line from the first snap to the newest — the older plays'
    // shapes, dots and flags are noise once the next snap comes
    const segs=[];
    if(spots.length>1 && Math.abs(spots[spots.length-1].yd-spots[0].yd)>=0.01) segs.push(Object.assign(line(xAt(spots[0].yd,lane), xAt(spots[spots.length-1].yd,lane)), {cls:' gc-seg-prog'}));
    const last=spots[spots.length-1], lp=last.p, x0=xAt(last.yd,lane);
    const kick=/Field Goal|Extra Point/.test(lp.type), kickGood=/Good/.test(lp.type);
    const to=(lp.turnover || /Interception|Fumble/.test(lp.type)) ? gcTurnoverRead(lp, d.team) : null;
    let punt=null;
    const big = kick || !!to || lp.scoring || Math.abs(lp.yds)>=20;
    let fin=null, pre=null, endX=null, endY=lane, retCol='#39c15a';
    if(kick){
      const ex = kickGood ? xPostR : xPostR+11, ey = kickGood ? top+2 : lane+14, c = kickGood ? 40 : 30;
      fin={x0, x1:ex, d:`M${f1(x0)},${f1(lane)} Q${f1((x0+ex)/2)},${f1(lane-c)} ${f1(ex)},${f1(ey)}`, len:Math.abs(ex-x0)*1.3, cls: kickGood ? ' gc-seg-fg' : ' gc-seg-fg gc-seg-miss', ey};
      endX=ex; endY=ey;
    } else if(to){
      // the offense's part to where it was taken, then the return the other way
      const xa=xAt(to.at,lane), xe=xAt(to.end,lane);
      pre = to.kind==='int' ? Object.assign(quad(x0,xa,Math.min(24, Math.max(8, Math.abs(xa-x0)*0.4))), {cls:''}) : Object.assign(line(x0,xa), {cls:''});
      retCol='#e5484d';   // a turnover runs back in red
      fin = Math.abs(xe-xa)>=0.5 ? Object.assign(line(xa,xe), {cls:' gc-seg-ret'}) : null;
      endX=xe;
    } else if(lp.type==='Punt' && (punt=gcPuntRead(lp.text, d.team)) && punt.returner){
      // the kick to where it was fielded, then — a real return, or just the credit for
      // catching it clean. Not a turnover: the receiving team's own drive, so it draws and
      // animates the way any other gain does (green), the returner's face on the pin.
      const endYd=Math.max(0, Math.min(100, last.yd+lp.yds)), xCatch=xAt(punt.catchYd,lane);
      endX=xAt(endYd,lane);
      if(Math.abs(punt.catchYd-endYd)>=1){
        pre=Object.assign(quad(x0,xCatch,26), {cls:' gc-seg-kick'});
        fin=Object.assign(line(xCatch,endX), {cls:' gc-seg-ret'});
      } else {
        fin=Object.assign(quad(x0,endX,26), {cls:' gc-seg-kick'});
      }
    } else {
      const endYd = lp.type==='Penalty' ? last.yd : Math.max(0, Math.min(100, last.yd+lp.yds));
      endX=xAt(endYd,lane);
      fin = Math.abs(endYd-last.yd)>=0.01 ? shape(lp, x0, endX) : null;
    }
    const animate = _gcd.driveSeen[eid]!==lp.id; _gcd.driveSeen[eid]=lp.id;
    const dur = big ? 1.4 : 0.7;
    const puntReturner = (punt && punt.returner) || '';
    // a punt's flight is its own stage: the kick draws and the ball travels it first, then
    // the return (if there was one) picks up right where the kick left off
    const preDur = (puntReturner && pre) ? 0.8 : 0;
    segs.forEach(sg=>parts.push(`<path class="gc-seg${sg.cls}" d="${sg.d}" fill="none" stroke="#39c15a" stroke-width="2" stroke-linecap="round" opacity="0.55"/>`));
    if(pre){
      if(preDur && animate){
        parts.push(`<path class="gc-seg gc-seg-pre${pre.cls}" d="${pre.d}" fill="none" stroke="#39c15a" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${f1(pre.len)}" stroke-dashoffset="${f1(pre.len)}"><animate attributeName="stroke-dashoffset" from="${f1(pre.len)}" to="0" dur="${preDur}s" fill="freeze"/></path>`);
        parts.push(`<circle class="gc-ball-dot" cx="0" cy="0" r="4.6" fill="#fff" stroke="#101214" stroke-width="1.5"><animateMotion dur="${preDur}s" fill="freeze" path="${pre.d}"/></circle>`);
      } else {
        parts.push(`<path class="gc-seg gc-seg-pre${pre.cls||''}" d="${pre.d}" fill="none" stroke="#39c15a" stroke-width="2.2" stroke-linecap="round"/>`);
      }
    }
    // the drive's start, and the newest play's snap; a flag only when the newest play is one
    parts.push(`<circle cx="${f1(xAt(spots[0].yd,lane))}" cy="${f1(lane)}" r="3.4" fill="#39c15a" stroke="#39c15a" stroke-width="1.5"/>`);
    if(spots.length>1) parts.push(`<circle cx="${f1(x0)}" cy="${f1(lane)}" r="2.6" fill="#0f1318" stroke="#39c15a" stroke-width="1.5"/>`);
    if(lp.type==='Penalty') parts.push(flag(x0+3));
    if(to) parts.push(`<circle cx="${f1(xAt(to.at,lane))}" cy="${f1(lane)}" r="3.6" fill="${escAttr(retCol)}" stroke="#fff" stroke-width="1.4"/>`);
    const strokeOf = to ? retCol : (/miss/.test((fin&&fin.cls)||'') ? '#e5484d' : '#39c15a');
    if(fin){
      const anim = animate ? `<animate attributeName="stroke-dashoffset" from="${f1(fin.len)}" to="0" begin="${preDur}s" dur="${dur}s" fill="freeze"/>` : '';
      parts.push(`<path class="gc-seg gc-seg-last${fin.cls}" d="${fin.d}" fill="none" stroke="${escAttr(strokeOf)}" stroke-width="2.6" stroke-linecap="round"${animate?` stroke-dasharray="${f1(fin.len)}" stroke-dashoffset="${f1(fin.len)}"`:''}>${anim}</path>`);
      if(animate) parts.push(`<circle class="gc-ball-dot" cx="0" cy="0" r="4.6" fill="#fff" stroke="#101214" stroke-width="1.5"><animateMotion begin="${preDur}s" dur="${dur}s" fill="freeze" path="${fin.d}"/></circle>`);
      else parts.push(`<circle class="gc-ball-dot" cx="${f1(endX)}" cy="${f1(endY)}" r="4.6" fill="#fff" stroke="#101214" stroke-width="1.5"/>`);
      if(animate && big) parts.push(`<circle cx="${f1(endX)}" cy="${f1(endY)}" r="5" fill="none" stroke="${escAttr(strokeOf)}" stroke-width="2" opacity="0"><animate attributeName="r" from="5" to="22" begin="${(preDur+dur).toFixed(2)}s" dur="0.9s" fill="freeze"/><animate attributeName="opacity" values="0;0.9;0" begin="${(preDur+dur).toFixed(2)}s" dur="0.9s" fill="freeze"/></circle>`);
    } else {
      parts.push(`<circle class="gc-ball-dot" cx="${f1(endX)}" cy="${f1(endY)}" r="4.6" fill="#fff" stroke="#101214" stroke-width="1.5"/>`);
    }
    // the pin: the man who made the play — the defender who took it on a turnover, the
    // returner on a punt, the receiver on a completion, the kicker on a kick, the runner
    // on a run
    let src='', label='';
    const n=(typeof gcPlayNames==='function') ? gcPlayNames(lp.text) : {primary:'',receiver:'',picker:''};
    if(typeof hsPack==='function'){
      const ath=gcAthletes(sum);
      const who = to ? (gcFindAth(ath, opp, to.who) || gcFindAth(ath, opp, n.picker||n.recoverer))
        : puntReturner ? gcFindAth(ath, opp, puntReturner)
        : (((/Pass Reception|Passing Touchdown/.test(lp.type)) ? gcFindAth(ath, d.team, n.receiver) : null) || gcFindAth(ath, d.team, n.primary));
      // his Sleeper id: the box score's man, else the name against the club's roster (a
      // defender without a stat line yet); Sleeper's headshot, else ESPN's by his box-score id
      let pid=who && who.pid;
      if(!pid && typeof lfPidFor==='function'){
        const tok = to ? to.who : puntReturner ? puntReturner : (/Pass Reception|Passing Touchdown/.test(lp.type) ? n.receiver : n.primary);
        pid=lfPidFor(tok, (to||puntReturner)?opp:d.team, null, to?'picker':'primary')||null;
      }
      const sp=(typeof sleeperPlayers!=='undefined' && sleeperPlayers && pid) ? sleeperPlayers[pid] : null;
      src=(pid && sp) ? ((hsPack({player_id:pid, name:sp.name, pos:sp.pos, team:sp.team})||{}).src||'') : '';
      if(!src && who && who.id && typeof ESPN_HEADSHOT==='function') src=ESPN_HEADSHOT('nfl', who.id)||'';
    }
    // a flag's pin wears the flagged club
    const flagTeam = lp.type==='Penalty' ? gcAbbr((/PENALTY on ([A-Z]{2,3})-/.exec(lp.text||'')||[])[1]||'') : '';
    const pinX=Math.max(20, Math.min(W-20, endX)); const py=lane-34;
    const pinIn = animate ? `<animate attributeName="opacity" from="0" to="1" begin="${(preDur+dur*0.7).toFixed(2)}s" dur="0.3s" fill="freeze"/>` : '';
    parts.push(`<g class="gc-pin" opacity="${animate?'0':'1'}">${pinIn}<line x1="${f1(endX)}" y1="${f1(endY-5)}" x2="${f1(pinX)}" y2="${f1(py+15)}" stroke="#fff" stroke-width="1.4" opacity="0.8"/><circle cx="${f1(pinX)}" cy="${f1(py)}" r="15" fill="#101214" stroke="${to?escAttr(retCol):'#fff'}" stroke-width="2"/>${src?`<image href="${escAttr(src)}" x="${f1(pinX-13)}" y="${f1(py-13)}" width="26" height="26" style="clip-path:circle(50%)" preserveAspectRatio="xMidYMid slice"/>`:`<image href="${escAttr(NFL_LOGO(to?opp:(puntReturner?opp:(flagTeam||d.team))))}" x="${f1(pinX-9)}" y="${f1(py-9)}" width="18" height="18" preserveAspectRatio="xMidYMid meet"/>`}</g>`);
    if(to){
      const nm=String(to.who||'').replace('.', '. ');
      label = to.td ? (to.kind==='int' ? `${nm} pick six!` : `${nm} fumble return TD!`) : `${nm} ${to.kind==='int'?'INT':'recovers'}${to.ret?` · ${to.ret} yd return`:''}`;
    } else if(puntReturner){
      const nm=String(puntReturner).replace('.', '. ');
      label = pre ? `${nm} ${Math.abs(Math.round((last.yd+lp.yds)-punt.catchYd))} yd return` : `${nm} fair catch`;
    } else {
      const t=(typeof lfReadPlay==='function') ? lfReadPlay({id:lp.id, type:lp.type, text:lp.text, yds:lp.yds, team:d.team, athletes:[]}).title : lp.text.slice(0,40);
      label=String(t||'').replace(/ 🎉| 🙌/g,'');
    }
    label=label.slice(0,42);
    const anchor = endX>W*0.66 ? 'end' : (endX<W*0.34 ? 'start' : 'middle');
    parts.push(`<text x="${f1(endX)}" y="${bot+18}" fill="#fff" font-size="10.5" font-weight="800" text-anchor="${anchor}" stroke="#101214" stroke-width="3" paint-order="stroke">${escHtml(label)}</text>`);
  }
  parts.push('</svg>');
  return `<div class="gc-drive${d.live?' gc-drive-live':''}">${parts.join('')}<div class="gc-drive-sum">${gcDriveSentence(d)}</div></div>`;
}
// ESPN's win probability, play by play. Folded to one line — the two numbers as they stand
// — and a tap opens the chart: the away club at the top, the home club at the bottom (their
// marks on the axis), the line running toward whoever is winning with the winner's side
// filled in the winner's colour.
function gcWinProbToggle(){ _gcd.wpOpen=!_gcd.wpOpen; gcDetailRepaint(); }
function gcWinProbHTML(game, sum){
  const wp=(sum && Array.isArray(sum.winprobability)) ? sum.winprobability.filter(w=>w && w.homeWinPercentage!=null) : [];
  if(wp.length<3) return '';
  const n=wp.length; const last=wp[n-1].homeWinPercentage, home=Math.round(last*100), away=100-home;
  const open=!!_gcd.wpOpen;
  const nums=`<span class="gc-wp-n"><img src="${NFL_LOGO(game.away)}" class="gc-glogo" onerror="this.style.display='none'"><b>${away}%</b></span><span class="gc-wp-n"><b>${home}%</b><img src="${NFL_LOGO(game.home)}" class="gc-glogo" onerror="this.style.display='none'"></span>`;
  const head=`<button class="gc-wp-head" onclick="gcWinProbToggle()" aria-expanded="${open?'true':'false'}" title="Win probability, play by play — ESPN's model"><span class="gc-wp-lbl">Win probability</span>${nums}<span class="rt-gp-caret">${open?'▴':'▾'}</span></button>`;
  if(!open) return `<div class="gc-wp">${head}</div>`;
  const W=360, H=72, L=0, R=330, top=8, bot=64, f1=(v)=>(+v).toFixed(1);
  const x=(i)=>L+(R-L)*(n===1?0:i/(n-1)); const y=(h)=>top+(bot-top)*Math.max(0, Math.min(1, h));   // home at the bottom
  const pts=wp.map((w,i)=>`${f1(x(i))},${f1(y(w.homeWinPercentage))}`);
  const col=(t)=>(typeof pwTeamColor==='function' ? pwTeamColor(t) : '#3d9bff');
  // the line's height from the top IS the home side's share: the region above it is the
  // home share, below it the away share — the winner's share is filled in the winner's
  // colour, so a 100% finish fills the whole chart
  const homeWinning = last>=0.5;
  const fill = homeWinning
    ? `<path d="M${pts[0]} L${pts.join(' L')} L${f1(x(n-1))},${top} L${f1(x(0))},${top} Z" fill="${escAttr(col(game.home))}" opacity="0.45"/>`
    : `<path d="M${pts[0]} L${pts.join(' L')} L${f1(x(n-1))},${bot} L${f1(x(0))},${bot} Z" fill="${escAttr(col(game.away))}" opacity="0.45"/>`;
  return `<div class="gc-wp gc-wp-open">${head}
    <svg viewBox="0 0 ${W} ${H}" class="gc-wp-svg" role="img" aria-label="Win probability">
      <image href="${escAttr(NFL_LOGO(game.away))}" x="${R+8}" y="${top-2}" width="18" height="18" preserveAspectRatio="xMidYMid meet"/>
      <image href="${escAttr(NFL_LOGO(game.home))}" x="${R+8}" y="${bot-16}" width="18" height="18" preserveAspectRatio="xMidYMid meet"/>
      ${fill}
      <line x1="${L}" y1="${f1(y(0.5))}" x2="${R}" y2="${f1(y(0.5))}" stroke="#5a6270" stroke-width="1" stroke-dasharray="3 4"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="#f2f5f8" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="${f1(x(n-1))}" cy="${f1(y(last))}" r="3.2" fill="#fff"/>
    </svg><div class="gc-wp-src">ESPN's model · ${escHtml(game.away)} at the top, ${escHtml(game.home)} at the bottom</div></div>`;
}
// One line: the play that just happened — the board's last play while the game is on (the
// scoreboard names it first), else the summary's newest — with the freshness stamp.
function gcLastPlayHTML(game, sum){
  if(!game || game.state==='pre') return '';
  const live=game.state==='in';
  const sit=game.sit||null; const lp=(live && sit && sit.lastPlay && sit.lastPlay.text) ? sit.lastPlay : null;
  let title='', spot='', team='';
  if(lp && !GC_SKIP_TYPES.has(String(lp.type||''))){
    const read=(typeof lfReadPlay==='function') ? lfReadPlay(lp) : null; title=(read && read.title) || String(lp.text||'').slice(0,90);
    spot = lp.down>0 ? `${lp.ddt||''}${lp.spot?` @ ${lp.spot}`:''}` : (/Extra Point|Field Goal/.test(String(lp.type||'')) ? 'End zone' : (lp.type==='Kickoff'?'Kickoff':'')); team=lp.team||'';
  } else if(sum){
    const rows=gcFeedRows(sum, true); const p=rows[0];
    if(p){ title=p.title; spot=p.down>0 ? `${p.ddt}${p.spot?` @ ${p.spot}`:''}` : ''; team=p.team||''; }
  }
  if(!title && !(live && sit && sit.phase)) return '';
  const stamp=(live && typeof tcFreshHTML==='function') ? tcFreshHTML(game.eid) : '';
  const head=`<span class="gc-last-lbl">${live?'<i class="gcf-dot"></i>':''}${live?'LAST PLAY':'FINAL PLAY'}</span>${team?`<img src="${NFL_LOGO(team)}" class="gc-glogo" onerror="this.style.display='none'">`:''}${spot?`<span class="gc-last-spot">${escHtml(spot)}</span>`:''}${stamp}`;
  return `<div class="gc-last"><div class="gc-last-head">${head}</div><div class="gc-last-text">${escHtml(title || (sit && sit.phase) || '')}</div></div>`;
}
