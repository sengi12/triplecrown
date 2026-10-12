// Replay a real matchup through the app's own swing-chart code (tests/check.js) with live network,
// for previews: node tools/swing_preview_data.js <league_id> <week> [out.json]. Run from the repo root
// after a build + tests/extract_app.js. Writes the built series, the SVG and recap with headshots
// embedded as data URIs (the artifact sandbox cannot reach sleepercdn).
const fs=require('fs'), path=require('path');
const WT=process.cwd();
const OUT=process.argv[4]||path.join(process.cwd(),'swing_data.json');
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){}};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};
const code=fs.readFileSync(path.join(WT,'tests/check.js'),'utf8');
const app=new Function(code+`return {TC_SEASON, tcParseBoard, TC_BOARD_URL, GC_SUMMARY_URL, LA_WEEK_PROJ_URL, LA_MATCHUPS_URL, LA_ROSTERS_URL, LA_LEAGUE_URL, laSwingBuild, laSwingPlayEvents, laWeekProjPts, SLEEPER_HEADSHOT, laSwingSVG, laSwingRecapHTML, laSwingTickLabel, SLEEPER_PLAYERS_URL,
  setPlayers:(s)=>{sleeperPlayers=s;}, setSnapshot:(s)=>{leagueSnapshot=s;}};`)();
const LID=process.argv[2]||'1312146993191096320', UID='318054040384589824', SEASON=2026, WK=Number(process.argv[3]||5);
const get=async(u)=>{ const r=await fetch(u,{headers:{Accept:'application/json'}}); if(!r.ok) throw new Error(u+' '+r.status); return r.json(); };
(async()=>{
  app.TC_SEASON.year=SEASON; app.TC_SEASON.week=WK; app.TC_SEASON.phase='regular';
  const [league, rosters, users, matchups]=await Promise.all([get(app.LA_LEAGUE_URL(LID)), get(app.LA_ROSTERS_URL(LID)), get(`https://api.sleeper.app/v1/league/${LID}/users`), get(app.LA_MATCHUPS_URL(LID, WK))]);
  const scoring=league.scoring_settings;
  let me=rosters.find(r=>String(r.owner_id)===UID || (r.co_owners||[]).map(String).includes(UID));
  if(!me){ console.error('no roster for user; using roster 1'); me=rosters[0]; }
  const myRow=matchups.find(m=>m.roster_id===me.roster_id);
  const oppRow=matchups.find(m=>m.matchup_id===myRow.matchup_id && m.roster_id!==myRow.roster_id);
  const userOf=(r)=>users.find(u=>String(u.user_id)===String(r.owner_id))||{};
  const oppR=rosters.find(r=>r.roster_id===oppRow.roster_id);
  const tname=(r)=>{ const u=userOf(r); return (u.metadata&&u.metadata.team_name)||u.display_name||`Roster ${r.roster_id}`; };
  console.error('league', league.name, 'me', tname(me), 'vs', tname(oppR), 'pts', myRow.points, oppRow.points);
  // players DB → the app's shape
  const raw=await get(app.SLEEPER_PLAYERS_URL);
  const sp={}; for(const pid in raw){ const p=raw[pid]; if(!p||!p.position) continue; sp[pid]={player_id:pid, name:`${p.first_name||''} ${p.last_name||''}`.trim(), pos:p.position, team:p.team||null}; }
  app.setPlayers(sp); app.setSnapshot({scoringRaw:scoring});
  // the board, the games, the summaries
  const board=app.tcParseBoard(await get(app.TC_BOARD_URL(SEASON, WK)));
  const st=(row)=>(row.starters||[]).filter(x=>x&&x!=='0').map(String);
  const mine=st(myRow), opp=st(oppRow);
  const teamOf={}, pos={}, names={}, games={}, actualFinal={};
  const pts=(row)=>{ const m={}; (row.starters||[]).forEach((pid,i)=>{ if(pid&&pid!=='0') m[String(pid)]=Number((row.starters_points||[])[i]||0); }); return m; };
  const pm={...pts(myRow), ...pts(oppRow)};
  [...mine, ...opp].forEach(pid=>{
    const p=sp[pid]||(raw[pid]?{name:raw[pid].first_name+' '+raw[pid].last_name, pos:raw[pid].position, team:raw[pid].team}:null);
    const isDef=!sp[pid] && /^[A-Z]{2,3}$/.test(pid);
    teamOf[pid]=isDef?pid:String((p&&p.team)||'').toUpperCase(); pos[pid]=isDef?'DEF':String((p&&p.pos)||''); names[pid]=isDef?`${pid} D/ST`:(p&&p.name)||pid;
    const g=board[teamOf[pid]]; if(g&&g.eid&&!games[teamOf[pid]]) games[teamOf[pid]]={eid:String(g.eid), kick:g.date?Date.parse(g.date)||0:0, state:g.state, loaded:false};
    if(g&&g.state==='post') actualFinal[pid]=pm[pid]||0;
  });
  const plays=[]; const seen={};
  for(const tm of Object.keys(games)){ const g=games[tm]; if(g.state==='pre'||seen[g.eid]){ if(seen[g.eid]) g.loaded=true; continue; }
    const sum=await get(app.GC_SUMMARY_URL(g.eid)); seen[g.eid]=1; g.loaded=true; const ev=app.laSwingPlayEvents(sum, g.eid); plays.push(...ev); console.error('game', tm, g.state, 'plays', ev.length); }
  // projections: Sleeper's weekly line under the league's table
  const projList=await get(app.LA_WEEK_PROJ_URL(SEASON, WK));
  const rows={}; projList.forEach(r=>{ const pid=r.player_id||(r.player&&r.player.player_id); if(pid&&r.stats) rows[String(pid)]={stats:r.stats}; });
  const proj={}; [...mine,...opp].forEach(pid=>{ const r=rows[pid]; proj[pid]=r?Number(app.laWeekProjPts(r, scoring)||0):0; });
  const inp={mine, opp, proj, teamOf, pos, games, plays, scoring, actualFinal};
  const built=app.laSwingBuild(inp);
  console.error('series', built.series.length, 'keys', built.keys.length, 'decided', built.decided, 'final', built.final);
  built.keys.forEach(k=>console.error('  ', app.laSwingTickLabel(k.t), names[k.pid], k.title, k.delta, (k.dp*100).toFixed(1)+'%'));
  // headshots + avatars as data URIs (the artifact sandbox has no network)
  const dataUri=async(u)=>{ try{ const r=await fetch(u); if(!r.ok) return ''; const b=Buffer.from(await r.arrayBuffer()); return `data:${r.headers.get('content-type')||'image/jpeg'};base64,${b.toString('base64')}`; }catch(e){ return ''; } };
  const heads={}; for(const k of built.keys){ if(k.pid && !heads[k.pid]) heads[k.pid]=await dataUri(app.SLEEPER_HEADSHOT(k.pid)); }
  const av=async(r)=>{ const u=userOf(r); return u.avatar ? await dataUri(`https://sleepercdn.com/avatars/thumbs/${u.avatar}`) : ''; };
  const teams={ mine:{name:tname(me), owner:userOf(me).display_name||'', rec:`${me.settings.wins}-${me.settings.losses}`, pts:Number(myRow.points||0), avatar:await av(me)},
                opp:{name:tname(oppR), owner:userOf(oppR).display_name||'', rec:`${oppR.settings.wins}-${oppR.settings.losses}`, pts:Number(oppRow.points||0), avatar:await av(oppR)} };
  let svg=app.laSwingSVG(built, {label:'how the chance moved'}); let recap=app.laSwingRecapHTML(built, names);
  for(const pid in heads){ if(heads[pid]){ svg=svg.split(app.SLEEPER_HEADSHOT(pid)).join(heads[pid]); recap=recap.split(app.SLEEPER_HEADSHOT(pid)).join(heads[pid]); } }
  const series=built.series.map(s=>({t:s.t,p:s.p,mine:s.mine,opp:s.opp,pm:s.pts.mine,po:s.pts.opp,pid:s.pid||null,dp:s.dp||0,title:s.title||'',delta:s.delta||0,side:s.side||''}));
  fs.writeFileSync(OUT, JSON.stringify({league:league.name, wk:WK, teams, names, built:{decided:built.decided, final:built.final, windows:built.windows, slates:built.slates, keys:built.keys, t0:built.t0}, series, svg, recap, proj, heads:Object.keys(heads).length}));
  console.error('written', OUT);
})().catch(e=>{ console.error('ERR', e); process.exit(1); });
