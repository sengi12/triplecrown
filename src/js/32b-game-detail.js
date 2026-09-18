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
  if(typeof _gc==='undefined' || !_gc.game || !teams) return;
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
    sleeperFetch(GC_SUMMARY_URL(eid), {fresh: game.state==='in'}).then(d=>{ if(d && (d.drives||d.boxscore||d.header)){ _gcd.sum[eid]={data:d, at:Date.now()}; gcDetailRepaint(); } }).catch(()=>{}).finally(()=>{ _gcd.busy[eid]=false; });
  }
  return c?c.data:null;
}
function gcDetailRepaint(){
  if(typeof renderRightSidebar!=='function') return;
  if(typeof tcPreserveViewScroll==='function') tcPreserveViewScroll(()=>renderRightSidebar(), ['.gc-detail','.gcm-sheet','.gc-body']);
  else renderRightSidebar();
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
  const now=gcSituationHTML(game);
  if(!sum) return now+`<div class="ld-empty">${game.eid?'loading the plays…':'plays unavailable for this game'}</div>`;
  const rows=gcFeedRows(sum, _gcd.feedAll);
  // plays newer than the top of the last paint flash in (a live game's fresh play)
  if(!_gcd.topSeq) _gcd.topSeq={};
  const eid=String(game.eid||''); const prevTop=_gcd.topSeq[eid];
  const isNew=(p)=>game.state==='in' && prevTop!=null && p.seq>prevTop;
  if(rows.length) _gcd.topSeq[eid]=rows[0].seq;
  const toggle=`<div class="gcf-bar"><span>${_gcd.feedAll?'every play':'key plays'}</span><button class="ld-pos ${_gcd.feedAll?'':'active'}" onclick="gcdSetFeedAll(false)">Key</button><button class="ld-pos ${_gcd.feedAll?'active':''}" onclick="gcdSetFeedAll(true)">All</button></div>`;
  if(!rows.length) return now+toggle+`<div class="ld-empty">no plays yet</div>`;
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
  return now+toggle+`<div class="gcf">${html}</div>`;
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
  opts.push({id:'app', name:'App scoring'});
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
