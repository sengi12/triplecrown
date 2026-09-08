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
  ];
}
const TC_LOCAL_TOOL_NAMES = new Set(tcLocalToolDefs().map(t=>t.name));
// One line appended to both AI hints — the model learns these exist.
const TC_LOCAL_TOOL_HINT = ' Local app tools (instant): league_team{name} — any synced-league team’s '
  +'roster + analyzer verdict; league_overview{} — all power ranks; adv_team{team,table?} — nflverse '
  +'advanced tables; dvp{pos?} — defense-vs-position; coaching{team}.';

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
    }
  }catch(e){ return 'lookup failed locally: '+String(e&&e.message||e); }
  return null;
}
