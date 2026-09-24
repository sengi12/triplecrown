// ── Local app-data tools for the AI loops ───────────────────────────────────
// "Ask TripleCrown" could ground YOUR team; everything else the app can render
// (any league team, the analyzer's standings, the nflverse advanced tables,
// defense-vs-position, coaching) was visible to the user but invisible to the
// model. These tools close that gap ON-DEVICE: they resolve from app state, so
// they cost no network, no tokens of transport, and work on the free engines.
// They ride the existing loops — tcMcpCallTool tries local first, the keyless
// JSON protocol and the tool-capable path both advertise them — under the same
// 3-round cap and the same data-never-instructions quarantine as everything
// else. Every resolver is best-effort: missing state returns a short "not
// available" line, never a throw (a lookup that explodes would eat one of the
// model's three rounds with a stack trace).

function tcLocalToolDefs(){
  return [
    { name:'league_team', description:'Any team in the synced league: roster with the board’s numbers plus the Analyzer’s verdict (power rank, persona, positional ranks, projected starters). args: {name} — owner or team name, fuzzy.',
      inputSchema:{ type:'object', properties:{ name:{type:'string'} }, required:['name'] } },
    { name:'league_overview', description:'The synced league at a glance: every team’s power rank, persona and record.',
      inputSchema:{ type:'object', properties:{} } },
    { name:'adv_team', description:'nflverse advanced team tables (the Advanced tab): offense, defense, tendencies, O-line, coverage, pace, personnel — values with league ranks. args: {team, table?}.',
      inputSchema:{ type:'object', properties:{ team:{type:'string'}, table:{type:'string'} }, required:['team'] } },
    { name:'dvp', description:'Defense-vs-position for the season in progress: which defenses give up the most to each position. args: {pos?}.',
      inputSchema:{ type:'object', properties:{ pos:{type:'string'} } } },
    { name:'coaching', description:'A team’s coaching staff with career fantasy track records (offense/defense z-scores). args: {team}.',
      inputSchema:{ type:'object', properties:{ team:{type:'string'} }, required:['team'] } },
    { name:'my_leagues', description:'Every league the user has synced (all of them, not just the one open in the Analyzer): format, teams, FAAB left, teams alive in a Chopped league, the top waiver adds with bids.',
      inputSchema:{ type:'object', properties:{} } },
    { name:'available', description:'Free agents across the user’s leagues with this season’s weekly usage — target share of team targets, targets, catches, yards, carries, EPA per touch — and the bid the wire would price them at, with the leagues each is available in. args: {league?} one league by name (default all), {pos?}, {week?} (default the latest completed), {sort?} share|targets|carries|touches|bid.',
      inputSchema:{ type:'object', properties:{ league:{type:'string'}, pos:{type:'string'}, week:{type:'number'}, sort:{type:'string'} } } },
    { name:'week_usage', description:'Weekly usage from the in-season data: one player’s week-by-week targets, target share, carries, yards and EPA per touch (args {name}), or a position’s leaders by target share for a week (args {pos, week?}).',
      inputSchema:{ type:'object', properties:{ name:{type:'string'}, pos:{type:'string'}, week:{type:'number'} } } },
    { name:'lineup', description:'This week in the user’s leagues from the Multi-League hub: my optimal lineup, START/SIT calls with the point gaps, the top waiver adds with the drop each beats and the bid. args: {league?} one league by name (default every league).',
      inputSchema:{ type:'object', properties:{ league:{type:'string'} } } },
    { name:'standings', description:'The synced league’s standings and playoff picture (seed, record, points for, games back, clinched/alive/out) — or, in a Chopped league, who is still alive.',
      inputSchema:{ type:'object', properties:{} } },
    { name:'app_data', description:'Browse ANY data the app holds, on-device. Roots: nflverse (every season: <season>.team.{offense, defense, tendencies, pace, …} with values + league ranks incl. Rush/Pass Success Rate; <season>.tendencies.teams.<TEAM>.{offense, defense} — play-calling tendencies: situations, predictability, sequencing, play action, motion, blitz habits, with .league beside; <season>.coaching_scheme.<TEAM> once its Playbook opened — formations and views, charted sets with estimated routes in the live season), inseason (the season sidecar: player_weekly, def_vs_pos, adv_weekly, schedule, games, nflverse.<season>.{team, players, qb_passing_weekly, rb_fan_weekly, ol_weekly, scheme_weekly, target_trees, ngs_weekly, def_weekly, tendencies}), leagues (every synced league’s hub result: lineup, adds, drops, faab.wire, rostered), snapshot (the Analyzer’s league: teamList with rosters and records), leaders (the weekly scoring leaders), games (this week’s scoreboard), season (week/phase). args: {path} dotted, e.g. "inseason.nflverse.2026.def_weekly.ernest jones" or "leagues"; {find?} keeps only keys containing this text. An object answers with its keys; a leaf with its value.',
      inputSchema:{ type:'object', properties:{ path:{type:'string'}, find:{type:'string'} }, required:['path'] } },
  ];
}
const TC_LOCAL_TOOL_NAMES = new Set(tcLocalToolDefs().map(t=>t.name));
// One line appended to both AI hints — the model learns these exist.
const TC_LOCAL_TOOL_HINT = ' Local app tools (instant): league_team{name} — any synced-league team’s '
  +'roster + analyzer verdict; league_overview{} — all power ranks; adv_team{team,table?} — nflverse '
  +'advanced tables; dvp{pos?} — defense-vs-position; coaching{team}; my_leagues{} — every synced league '
  +'(FAAB left, teams alive, top adds); available{league?,pos?,week?,sort?} — free agents across the user’s '
  +'leagues with weekly usage (target share, targets, carries, EPA/touch) and the wire’s bid; '
  +'week_usage{name} or {pos,week?} — weekly usage for a player or a position’s target-share leaders; '
  +'lineup{league?} — my optimal lineup, START/SIT calls and adds per league; standings{} — the synced league’s '
  +'standings and playoff picture; app_data{path,find?} — browse ANY table the app holds (roots: nflverse — '
  +'every season’s team tables, tendencies and coaching payloads; inseason, leagues, snapshot, leaders, games, '
  +'season). The app is in season: use these before saying data is not at hand.';

function _ltNorm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function _ltSnap(){
  return (typeof leagueSnapshot!=='undefined' && leagueSnapshot
          && Array.isArray(leagueSnapshot.teamList)) ? leagueSnapshot : null;
}

function _ltLeagueTeam(args){
  const sn=_ltSnap();
  if(!sn) return 'No league is synced in the League Analyzer — ask the user to sync one first.';
  const q=_ltNorm(args && args.name);
  if(!q) return 'league_team needs {name}: an owner or team name from the synced league.';
  const t=sn.teamList.find(x=>_ltNorm(x.teamName)===q || _ltNorm(x.owner)===q)
       || sn.teamList.find(x=>_ltNorm(x.teamName).includes(q) || _ltNorm(x.owner).includes(q));
  if(!t) return `No team matching "${args.name}" — teams: ${sn.teamList.map(x=>x.teamName||x.owner).join(', ')}`;
  const out=[`TEAM "${t.teamName||t.owner}" (owner ${t.owner||'?'}) in ${sn.name||'the synced league'}`
    +((t.wins!=null)?` · ${t.wins}-${t.losses}`:'')];
  try{
    const v=(typeof _chatTeamVerdict==='function')?_chatTeamVerdict(sn,t):{lines:[]};
    if(v.lines && v.lines.length) out.push(v.lines.join('\n'));
  }catch(e){}
  try{
    const byPos={};
    for(const p of (t.players||[])){ const k=p.pos||'?'; (byPos[k]=byPos[k]||[]).push('  '+((typeof _chatBoardLine==='function')?_chatBoardLine(p):p.name)); }
    const order=['QB','RB','WR','TE','K','DEF'];
    out.push('Roster (the app’s numbers — evaluate from these, not from memory):\n'
      +[...order.filter(k=>byPos[k]), ...Object.keys(byPos).filter(k=>!order.includes(k))]
        .map(k=>`${k}:\n${byPos[k].join('\n')}`).join('\n'));
  }catch(e){}
  return out.join('\n');
}

function _ltLeagueOverview(){
  const sn=_ltSnap();
  if(!sn) return 'No league is synced in the League Analyzer.';
  try{
    const pm=laProjMap();
    const traj=laTrajectories(sn,pm);
    const rows=sn.teamList.map(t=>{
      const my=traj[t.rosterId]||{};
      return { rank:my.rank||99, line:`#${my.rank||'?'} ${t.teamName||t.owner}`
        +((t.wins!=null)?` (${t.wins}-${t.losses})`:'')
        +(my.title?` · "${my.title}"`:'') };
    }).sort((a,b)=>a.rank-b.rank).map(r=>r.line);
    return `${sn.name||'League'} — power ranks (Analyzer):\n`+rows.join('\n');
  }catch(e){ return 'Analyzer standings unavailable right now.'; }
}

function _ltAdvTeam(args){
  const team=String(args&&args.team||'').toUpperCase().trim();
  if(!team) return 'adv_team needs {team}: an NFL team code like DET.';
  try{
    const SRC=(typeof nflverseSharpTables==='function')?nflverseSharpTables():{};
    const keys=Object.keys(SRC);
    if(!keys.length) return 'Advanced tables not loaded (seed still booting?).';
    const want=args&&args.table?_ltNorm(args.table):null;
    const out=[];
    for(const k of keys){
      if(want && !_ltNorm(k).includes(want) && !_ltNorm(SRC[k].title||'').includes(want)) continue;
      const tbl=SRC[k]; const row=tbl.teams&&tbl.teams[team];
      if(!row) continue;
      const vals=Array.isArray(row)?row[0]:null, ranks=Array.isArray(row)?row[1]:null;
      const cols=(tbl.columns||[]);
      const parts=cols.map((c,i)=>{
        const v=vals?vals[i]:(row.values&&row.values[c]);
        const r=ranks?ranks[i]:(row.ranks&&row.ranks[c]);
        return (v==null)?null:`${c} ${v}${r!=null?` (#${r})`:''}`;
      }).filter(Boolean);
      if(parts.length) out.push(`${tbl.title||k}: ${parts.join(' · ')}`);
    }
    return out.length ? `${team} advanced (${(typeof advTeamSeason==='function')?advTeamSeason():''} season, rank of 32):\n`+out.join('\n')
                      : `No advanced rows for ${team}${want?` matching "${args.table}"`:''}. Tables: ${keys.join(', ')}`;
  }catch(e){ return 'Advanced tables unavailable right now.'; }
}

function _ltDvp(args){
  try{
    const tbl=(typeof laDvpTable==='function')?laDvpTable():null;
    if(!tbl) return 'Defense-vs-position needs the season in progress (no weekly data yet).';
    const want=String(args&&args.pos||'').toUpperCase().trim();
    const out=[];
    for(const pos of (want?[want]:['QB','RB','WR','TE'])){
      const rows=tbl[pos]; if(!rows) continue;
      const rank=Object.entries(rows).sort((a,b)=>b[1]-a[1]);
      out.push(`${pos} — most points allowed first: `+rank.map(([tm,v],i)=>`${tm} ${v.toFixed(1)}`).slice(0,32).join(' · '));
    }
    return out.length?('Defense vs position (avg fantasy pts allowed/game):\n'+out.join('\n')):'No DvP data.';
  }catch(e){ return 'Defense-vs-position unavailable right now.'; }
}

function _ltCoaching(args){
  const team=String(args&&args.team||'').toUpperCase().trim();
  if(!team) return 'coaching needs {team}: an NFL team code like DET.';
  try{
    const c=(typeof COORDINATORS!=='undefined' && COORDINATORS)?COORDINATORS[team]:null;
    if(!c) return `No coaching data for ${team}.`;
    const rec=(name)=>{
      try{
        const r=(typeof coachRecFor==='function')?coachRecFor(name):null;
        const d=(typeof coachDefRecFor==='function')?coachDefRecFor(name):null;
        const bits=[];
        if(r && r.n>=2) bits.push(`offense ${r.z>0?'+':''}${r.z.toFixed(2)}z over ${r.n} seasons`);
        if(d && d.dn>=2) bits.push(`defense ${d.dz>0?'+':''}${d.dz.toFixed(2)}z over ${d.dn} seasons`);
        return bits.length?` — career: ${bits.join(', ')}`:'';
      }catch(e){ return ''; }
    };
    const lines=[];
    if(c.hc) lines.push(`HC: ${c.hc}${rec(c.hc)}`);
    if(c.oc) lines.push(`OC: ${c.oc}${rec(c.oc)}`);
    if(c.dc) lines.push(`DC: ${c.dc}${rec(c.dc)}`);
    return lines.length?`${team} coaching:\n`+lines.join('\n'):`No coaching data for ${team}.`;
  }catch(e){ return 'Coaching data unavailable right now.'; }
}

// ── Every league, and the season in progress ─────────────────────────────────
// "Of all my leagues, who is available with the biggest target share?" needs two
// things the single-league tools never had: every synced league's rosters (the
// Multi-League hub loads them — hubState.results) and the in-season weekly usage
// (the nflverse sidecar — TC_INSEASON.player_weekly). Both resolve on-device.
function _ltHubLeagues(){
  if(typeof hubLeagueList!=='function' || typeof hubState==='undefined') return [];
  try{ return hubLeagueList().list||[]; }catch(e){ return []; }
}
function _ltHubRes(id){ return (typeof hubState!=='undefined' && hubState.results && hubState.results[id] && !hubState.results[id].error) ? hubState.results[id] : null; }
// Kick the hub load when a league is missing and wait a bounded moment for it.
async function _ltHubReady(){
  const list=_ltHubLeagues(); if(!list.length) return false;
  if(list.some(l=>!_ltHubRes(l.league_id)) && typeof hubLoadAll==='function'){
    try{ if(!hubState.busy) hubLoadAll(true); }catch(e){}
    const t0=Date.now(); while(hubState.busy && Date.now()-t0<20000) await new Promise(r=>setTimeout(r,250));
  }
  return list.some(l=>_ltHubRes(l.league_id));
}
function _ltLeagueLabel(l, res){
  const t=(res&&res.league&&res.league.settings)||{}; const type=+t.type;
  const kind=type===3?'Chopped':type===2?'dynasty':type===1?'keeper':'redraft';
  return `${l.name||'League'} (${(res&&res.teams)||l.total_rosters||'?'}-team${l.sf?' superflex':''} · ${kind})`;
}
// Weekly usage rows for one week from the sidecar (or a player's rows across weeks).
function _ltUsage(week){
  const pw=(typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.player_weekly)||null;
  if(!pw || !pw.players) return null;
  const ci={}; (pw.cols||[]).forEach((c,i)=>ci[c]=i);
  const weeks=(TC_INSEASON.weeks||[]).map(Number).filter(Boolean);
  const wk=week||(weeks.length?Math.max.apply(null,weeks):null); if(!wk) return null;
  const rows=[];
  for(const g in pw.players){
    const p=pw.players[g]; const r=p.w&&p.w[String(wk)]; if(!r) continue;
    const v=(c)=>+(r[ci[c]]||0);
    const tgt=v('tgt'), tt=v('team_tgt'), carry=v('carry');
    const compTgt=v('comp_tgt'), garbageTgt=v('garbage_tgt');
    const compCarry=v('comp_carry'), garbageCarry=v('garbage_carry');
    const compTouches=compTgt+compCarry, garbageTouches=garbageTgt+garbageCarry;
    rows.push({ gsis:g, id:(typeof laPidFromGsis==='function')?laPidFromGsis(g):null, name:p.n, pos:p.p, team:p.t, wk,
      tgt, teamTgt:tt, share:tt?tgt/tt:0, rec:v('rec'), recYd:v('rec_yd'), recTd:v('rec_td'), airYd:v('air_yd'),
      carry, rushYd:v('rush_yd'), rushTd:v('rush_td'), touches:tgt+carry,
      compTgt, garbageTgt, compCarry, garbageCarry, compTouches, garbageTouches,
      compShare:(tgt+carry)?compTouches/(tgt+carry):null,
      garbageShare:(tgt+carry)?garbageTouches/(tgt+carry):null,
      epa:v('epa_touch'), passAtt:v('pass_att'), passYd:v('pass_yd'), passTd:v('pass_td') });
  }
  return {wk, weeks, rows};
}
function _ltUsageLine(u){
  const bits=[];
  if(u.pos==='QB' && u.passAtt) bits.push(`${u.passAtt} att · ${u.passYd} yds · ${u.passTd} TD`);
  if(u.tgt || u.pos!=='QB') bits.push(`${Math.round(u.share*100)}% of team targets (${u.tgt} tgt${u.teamTgt?` of ${u.teamTgt}`:''}, ${u.rec} rec, ${u.recYd} yds${u.recTd?`, ${u.recTd} TD`:''})`);
  if(u.carry) bits.push(`${u.carry} car · ${u.rushYd} yds${u.rushTd?` · ${u.rushTd} TD`:''}`);
  if(u.compTouches || u.garbageTouches) bits.push(`gameplan: ${u.compTouches} competitive · ${u.garbageTouches} garbage (${Math.round((u.compShare||0)*100)}% / ${Math.round((u.garbageShare||0)*100)}% of touches)`);
  if(u.touches) bits.push(`EPA/touch ${u.epa>=0?'+':''}${(+u.epa).toFixed(2)}`);
  return bits.join(' · ');
}
function _ltCap(s){ return String(s||'').replace(/\b\w/g,c=>c.toUpperCase()); }
function _ltMyLeagues(){
  const list=_ltHubLeagues();
  if(!list.length) return 'No Sleeper leagues are synced — ask the user to sync one (League → Sync) first.';
  const lines=list.map(l=>{
    const res=_ltHubRes(l.league_id);
    let s=`• ${_ltLeagueLabel(l,res)}`;
    if(!res) return s+' — not loaded yet (open This Week, or ask again in a moment)';
    if(res.faab) s+=` · FAAB $${res.faab.left} left of $${res.faab.budget}`;
    if(res.faab && res.faab.chop) s+=` · ${res.faab.chop.alive} of ${res.faab.chop.total} teams alive`;
    if(res.lineup && res.lineup.opponent) s+=` · week ${res.wk} vs ${res.lineup.opponent}`;
    if(res.adds && res.adds.length) s+=`\n    top adds: `+res.adds.slice(0,4).map(a=>`${a.name} (${a.pos})${a.faab?` $${a.faab.bid}`:''}`).join(', ');
    return s;
  });
  return `MY LEAGUES (${list.length}):\n`+lines.join('\n');
}
// The wire across every league, with the week's usage — sync core, so the chat can attach it.
function _ltAvailableSync(args){
  const a=args||{};
  const list=_ltHubLeagues();
  if(!list.length) return 'No Sleeper leagues are synced — ask the user to sync one first.';
  const want=_ltNorm(a.league);
  const lgs=list.filter(l=>!want || _ltNorm(l.name).includes(want)).map(l=>({l, res:_ltHubRes(l.league_id)}));
  if(!lgs.length) return `No synced league matching "${a.league}" — leagues: ${list.map(l=>l.name).join(', ')}`;
  const loaded=lgs.filter(x=>x.res);
  if(!loaded.length) return 'Your leagues are still loading — ask again in a moment.';
  const U=_ltUsage(a.week?+a.week:null);
  if(!U) return 'No weekly usage yet — the in-season data lands after the first week’s games.';
  const pos=String(a.pos||'').toUpperCase().trim();
  const sort=String(a.sort||'share').toLowerCase();
  const keyOf={share:u=>u.share, targets:u=>u.tgt, carries:u=>u.carry, touches:u=>u.touches, bid:u=>u._bid||0}[sort]||(u=>u.share);
  const out=[];
  U.rows.forEach(u=>{
    if(pos && u.pos!==pos) return;
    if(!u.id) return;
    const inL=[]; let best=0;
    loaded.forEach(({l,res})=>{
      if(res.rostered && res.rostered.has(String(u.id))) return;
      const w=(res.faab&&res.faab.wire||[]).find(r=>r.id===String(u.id));
      if(w && w.faab) best=Math.max(best, w.faab.bid);
      inL.push(`${l.name}${w&&w.faab?` $${w.faab.bid}${w.faab.chop?` (mkt $${w.faab.market})`:''}`:''}`);
    });
    if(!inL.length) return;
    u._bid=best; u._in=inL; out.push(u);
  });
  out.sort((x,y)=>keyOf(y)-keyOf(x) || y.touches-x.touches);
  const top=out.slice(0,15);
  if(!top.length) return `Nobody unrostered${pos?` at ${pos}`:''} has week ${U.wk} usage in ${loaded.map(x=>x.l.name).join(', ')}.`;
  return `AVAILABLE — week ${U.wk} usage, sorted by ${sort}; leagues checked: ${loaded.map(x=>x.l.name).join(', ')}${lgs.length>loaded.length?` (${lgs.length-loaded.length} still loading)`:''}\n`
    +top.map((u,i)=>`${i+1}. ${_ltCap(u.name)} (${u.pos} ${u.team}) — ${_ltUsageLine(u)}\n    available in: ${u._in.join('; ')}`).join('\n');
}
async function _ltAvailable(args){
  if(typeof ensureInseasonSidecar==='function'){ try{ await ensureInseasonSidecar(); }catch(e){} }
  await _ltHubReady();
  return _ltAvailableSync(args);
}
async function _ltWeekUsage(args){
  const a=args||{};
  if(typeof ensureInseasonSidecar==='function'){ try{ await ensureInseasonSidecar(); }catch(e){} }
  const pw=(typeof TC_INSEASON!=='undefined' && TC_INSEASON && TC_INSEASON.player_weekly)||null;
  if(!pw || !pw.players) return 'No weekly usage yet — the in-season data lands after the first week’s games.';
  if(a.name){
    const q=_ltNorm(a.name);
    const g=Object.keys(pw.players).find(k=>_ltNorm(pw.players[k].n)===q) || Object.keys(pw.players).find(k=>_ltNorm(pw.players[k].n).includes(q));
    if(!g) return `No weekly usage for "${a.name}" this season.`;
    const p=pw.players[g]; const lines=[];
    Object.keys(p.w).map(Number).sort((x,y)=>x-y).forEach(wk=>{ const U=_ltUsage(wk); const u=U&&U.rows.find(r=>r.gsis===g); if(u) lines.push(`week ${wk}: ${_ltUsageLine(u)}`); });
    return `${_ltCap(p.n)} (${p.p} ${p.t}) — weekly usage:\n`+lines.join('\n');
  }
  const U=_ltUsage(a.week?+a.week:null); if(!U) return 'No weekly usage yet.';
  const pos=String(a.pos||'WR').toUpperCase();
  const rows=U.rows.filter(u=>u.pos===pos && u.tgt+u.carry>0).sort((x,y)=>(pos==='RB'?(y.touches-x.touches):(y.share-x.share))).slice(0,15);
  return `${pos} usage leaders, week ${U.wk} (${pos==='RB'?'by touches':'by share of team targets'}):\n`+rows.map((u,i)=>`${i+1}. ${_ltCap(u.name)} (${u.team}) — ${_ltUsageLine(u)}`).join('\n');
}

async function _ltLineup(args){
  await _ltHubReady();
  const list=_ltHubLeagues();
  if(!list.length) return 'No Sleeper leagues are synced — ask the user to sync one first.';
  const want=_ltNorm(args&&args.league);
  const lgs=list.filter(l=>!want || _ltNorm(l.name).includes(want));
  if(!lgs.length) return `No synced league matching "${args.league}" — leagues: ${list.map(l=>l.name).join(', ')}`;
  return lgs.map(l=>{
    const res=_ltHubRes(l.league_id);
    if(!res) return `${_ltLeagueLabel(l,null)} — not loaded yet.`;
    const L=res.lineup; const out=[`${_ltLeagueLabel(l,res)} — week ${res.wk}${L&&L.opponent?` vs ${L.opponent}`:''}`];
    if(!res.mine) out.push('  (your team was not found in this league — sync it from your Sleeper account)');
    if(L && Array.isArray(L.optimal)) out.push('  optimal lineup: '+L.optimal.map(f=>`${f.slot} ${f.player?`${f.player.name} ${(+f.player.value||0).toFixed(1)}`:'—'}`).join(' · '));
    if(L && Array.isArray(L.callouts) && L.callouts.length) out.push('  calls: '+L.callouts.slice(0,6).map(c=>`${c.kind}${c.start?` start ${c.start.name}`:''}${c.sit?` over ${c.sit.name}`:''}${c.delta!=null?` (+${(+c.delta).toFixed(1)})`:''}`).join(' · '));
    if(res.adds && res.adds.length) out.push('  adds: '+res.adds.slice(0,5).map(a=>`${a.name} (${a.pos})${a.drop?` for ${a.drop.name}`:''}${a.faab?` $${a.faab.bid}`:''}`).join(' · '));
    if(res.faab) out.push(`  FAAB $${res.faab.left} of $${res.faab.budget}${res.faab.chop?` · ${res.faab.chop.alive} of ${res.faab.chop.total} alive`:''}`);
    return out.join('\n');
  }).join('\n');
}
function _ltStandings(){
  const sn=_ltSnap();
  if(!sn) return 'No league is synced in the League Analyzer.';
  try{
    if(typeof laIsChopped==='function' && laIsChopped(sn)){
      const wk=(typeof laCurrentWeek==='function')?laCurrentWeek():1;
      const gone=(typeof laChopEliminated==='function')?laChopEliminated(sn, wk):null;
      const isGone=(t)=> gone ? (gone.has ? gone.has(t.rosterId) : (Array.isArray(gone) ? gone.includes(t.rosterId) : false)) : false;
      const rows=sn.teamList.slice().sort((a,b)=>(+b.fpts||0)-(+a.fpts||0));
      return `${sn.name||'League'} — Chopped, week ${wk}: ${rows.filter(t=>!isGone(t)).length} of ${rows.length} alive (season points):\n`
        +rows.map((t,i)=>`${i+1}. ${t.teamName||t.owner} — ${(+t.fpts||0).toFixed(1)} pts${isGone(t)?' · CHOPPED':''}${t.ownerId===sn.myUserId?' · (me)':''}`).join('\n');
    }
    if(typeof laPlayoffPicture!=='function') return 'Standings unavailable right now.';
    const pic=laPlayoffPicture(sn);
    const rows=(pic&&pic.rows)||[];
    if(!rows.length) return 'No standings yet.';
    return `${sn.name||'League'} — standings (${pic.spots||'?'} playoff spots, regular season ${pic.regularWeeks||'?'} weeks):\n`
      +rows.map(r=>{ const t=r.team||r; return `${r.seed?`#${r.seed} `:''}${t.teamName||t.owner||'?'} — ${t.wins||0}-${t.losses||0}${t.ties?`-${t.ties}`:''} · ${(+t.fpts||0).toFixed(1)} PF${r.gb!=null&&r.gb>0?` · ${r.gb} GB`:''}${r.status?` · ${r.status}`:''}${r.divLeader?' · div leader':''}${t.ownerId===sn.myUserId?' · (me)':''}`; }).join('\n');
  }catch(e){ return 'Standings unavailable right now.'; }
}
// Anything the app holds, by dotted path — the model browses what a user can see.
function _ltRoots(){
  const wk=(typeof laCurrentWeek==='function')?laCurrentWeek():null;
  return {
    inseason:(typeof TC_INSEASON!=='undefined')?TC_INSEASON:null,
    // every nflverse season the app holds (the frozen ones plus the live one merged in):
    // team tables, tendencies, players, routes, and coaching_scheme once a Playbook opened
    nflverse:(typeof NFLVERSE!=='undefined')?NFLVERSE:null,
    leagues:(typeof hubState!=='undefined')?hubState.results:null,
    snapshot:_ltSnap(),
    leaders:(typeof _ld!=='undefined')?_ld.rows:null,
    games:(typeof _gc!=='undefined' && typeof gcGames==='function' && wk!=null)?gcGames(_gc.boards[wk]||_gc.boards.current||{}):null,
    season:(typeof TC_SEASON!=='undefined')?TC_SEASON:null,
  };
}
function _ltPlain(v){
  if(v instanceof Map){ const o={}; let n=0; for(const [k,x] of v){ if(n++>=200){ o['…']=`${v.size-200} more`; break; } o[String(k)]=x; } return o; }
  if(v instanceof Set) return Array.from(v);
  return v;
}
function _ltAppData(args){
  const a=args||{}; const path=String(a.path||'').trim();
  const roots=_ltRoots();
  if(!path) return 'app_data needs {path}. Roots: '+Object.keys(roots).filter(k=>roots[k]!=null).join(', ');
  const segs=path.split(/[./]/).map(s=>s.trim()).filter(Boolean);
  let cur=roots, walked=[];
  for(const s of segs){
    cur=_ltPlain(cur);
    if(cur==null || typeof cur!=='object') return `"${walked.join('.')}" is a value, not a table: ${JSON.stringify(cur).slice(0,400)}`;
    const key=Object.prototype.hasOwnProperty.call(cur,s) ? s : Object.keys(cur).find(k=>_ltNorm(k)===_ltNorm(s));
    if(key==null) return `No "${s}" under "${walked.join('.')||'roots'}". Keys: ${Object.keys(cur).slice(0,60).join(', ')}${Object.keys(cur).length>60?' …':''}`;
    cur=cur[key]; walked.push(key);
  }
  cur=_ltPlain(cur);
  if(cur==null) return `"${path}" holds nothing right now (not loaded yet).`;
  const find=_ltNorm(a.find);
  if(Array.isArray(cur)){
    const items=find ? cur.filter(x=>_ltNorm(JSON.stringify(x)).includes(find)) : cur;
    return `${path}: ${items.length} item${items.length===1?'':'s'}${find?` matching "${a.find}"`:''}\n`+JSON.stringify(items.slice(0,25), (k,v)=>_ltPlain(v)).slice(0,TC_AI_TOOL_RESULT_CAP-200);
  }
  if(typeof cur==='object'){
    const keys=Object.keys(cur).filter(k=>!find || _ltNorm(k).includes(find));
    const leafy=keys.length<=40 && keys.every(k=>cur[k]==null || typeof cur[k]!=='object' || Array.isArray(cur[k]) && cur[k].length<=24 && cur[k].every(x=>typeof x!=='object'));
    if(leafy) return `${path}:\n`+JSON.stringify(_ltPlain(cur), (k,v)=>_ltPlain(v)).slice(0,TC_AI_TOOL_RESULT_CAP-200);
    return `${path}: ${keys.length} key${keys.length===1?'':'s'}${find?` matching "${a.find}"`:''} — ask for one by extending the path:\n`
      +keys.slice(0,80).map(k=>{ const v=_ltPlain(cur[k]); const d=Array.isArray(v)?`[${v.length}]`:(v&&typeof v==='object')?`{${Object.keys(v).length}}`:JSON.stringify(v); return `${k} ${String(d).slice(0,60)}`; }).join(' · ')+(keys.length>80?' …':'');
  }
  return `${path}: ${JSON.stringify(cur)}`;
}

// The dispatcher: local name → resolved string; anything else → null (caller
// falls through to the worker). Never throws.
async function tcLocalToolCall(name, args){
  if(!TC_LOCAL_TOOL_NAMES.has(name)) return null;
  try{
    switch(name){
      case 'league_team':     return _ltLeagueTeam(args);
      case 'league_overview': return _ltLeagueOverview();
      case 'adv_team':        return _ltAdvTeam(args);
      case 'dvp':             return _ltDvp(args);
      case 'coaching':        return _ltCoaching(args);
      case 'my_leagues':      return _ltMyLeagues();
      case 'available':       return await _ltAvailable(args);
      case 'week_usage':      return await _ltWeekUsage(args);
      case 'lineup':          return await _ltLineup(args);
      case 'standings':       return _ltStandings();
      case 'app_data':        return _ltAppData(args);
    }
  }catch(e){ return 'lookup failed locally: '+String(e&&e.message||e); }
  return null;
}
