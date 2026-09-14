// The Trends pane after one week: every board says something. Pace and usage from the first
// game (marked thin under three), the Trending tab shows this week's targets and carries
// against the projection plus Sleeper's 24-hour adds and drops, Teams shows the season so
// far, and from week 2 the week-over-week board takes over with a window that grows.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){},classList:{add(){},remove(){}}}),body:{appendChild(){},classList:{add(){},remove(){}},style:{}},documentElement:{style:{}},addEventListener(){},visibilityState:'visible'};
global.window={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};global.Chart=function(){return{destroy(){}}};global.confirm=()=>1;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};global.fetch=()=>Promise.reject(new Error('offline'));
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){};
  let trendReply={add:[{player_id:'6',count:41200},{player_id:'1',count:900}], drop:[{player_id:'9',count:3100}]};
  sleeperFetch=async(url)=>{ const m=/trending\\/(add|drop)/.exec(url); if(m) return trendReply[m[1]]; throw new Error('no net'); };
  sleeperPlayers={'1':{name:'Star Back',pos:'RB',team:'NE'},'6':{name:'Jaxon Smith-Njigba',pos:'WR',team:'SEA'},'9':{name:'Free Back',pos:'RB',team:'SEA'},'7':{name:'Tee Higgins',pos:'WR',team:'CIN'}};
  laPidFromGsis=(g)=>({g1:'1',g6:'6',g9:'9',g7:'7'}[g]||null);
  // The kickoff baseline: projected per-game targets/carries and season points.
  const IDX=new Map();
  const put=(name,pos,id,base,act,gp,tg,ca)=>{ const e={id,name,pos,team:'X',base,act,gp,projGames:17,pace17:gp?act/gp*17:0,pct:gp?(act/gp*17-base)/base:0,cls:'',stats:{receiving_targets:tg?{aRate:tg[0],bRate:tg[1],pct:(tg[0]-tg[1])/tg[1]}:null, rushing_attempts:ca?{aRate:ca[0],bRate:ca[1],pct:(ca[0]-ca[1])/ca[1]}:null}}; IDX.set(ecrNormName(name)+'|'+pos,e); IDX.set(String(id),e); };
  put('Jaxon Smith-Njigba','WR','6',260,31,1,[11,8]); put('Star Back','RB','1',220,9,1,[3,4],[12,17]); put('Free Back','RB','9',90,20,1,[2,2],[18,8]); put('Tee Higgins','WR','7',200,4,1,[2,7]);
  buildPaceIndex=()=>IDX;
  const COLS=['tgt','rec','rec_yd','rec_td','air_yd','carry','rush_yd','rush_td','pass_att','pass_yd','pass_td','pass_int','epa_touch','team_tgt'];
  const wk1={ g6:{n:'jaxon smithnjigba',p:'WR',t:'SEA',w:{'1':[11,8,122,1,80,0,0,0,0,0,0,0,7,30]}}, g1:{n:'star back',p:'RB',t:'NE',w:{'1':[3,3,20,0,5,12,50,0,0,0,0,0,1,28]}},
              g9:{n:'free back',p:'RB',t:'SEA',w:{'1':[2,2,10,0,3,18,90,1,0,0,0,0,3,30]}}, g7:{n:'tee higgins',p:'WR',t:'CIN',w:{'1':[2,1,9,0,20,0,0,0,0,0,0,0,-1,33]}} };
  TC_INSEASON={season:2026, weeks:[1], player_weekly:{cols:COLS, players:wk1}};
  NFLVERSE['2026']=Object.assign(NFLVERSE['2026']||{}, {adv_weekly:{cols:['off_plays','off_epa','off_pass_plays','off_run_plays'], weeks:[1], teams:{SEA:[[60,6,40,20]], NE:[[62,-5,30,32]], CIN:[[58,2,36,22]]}}});
  const s={provider:'sleeper', leagueId:'L', season:'2026', myUserId:'me', rosterPositions:['QB','RB','WR','BN'],
    teamList:[{rosterId:1, ownerId:'me', teamName:'Mine', players:[{id:'6',name:'Jaxon Smith-Njigba',pos:'WR',team:'SEA'},{id:'1',name:'Star Back',pos:'RB',team:'NE'}]},
              {rosterId:2, ownerId:'u2', teamName:'Theirs', players:[{id:'7',name:'Tee Higgins',pos:'WR',team:'CIN'}]}]};
  leagueSnapshot=s; currentPhase='League';
  return { trends:(tab,scope)=>{ laState.trndTab=tab; laState.trndScope=scope||'league'; return laTrendsView(s); }, TC_SEASON, addWeek2:()=>{ wk1.g6.w['2']=[4,3,30,0,20,0,0,0,0,0,0,0,1,30]; wk1.g1.w['2']=[5,4,40,0,6,20,90,1,0,0,0,0,4,28]; wk1.g9.w['2']=[1,1,5,0,2,6,20,0,0,0,0,0,0,30]; wk1.g7.w['2']=[9,7,90,1,70,0,0,0,0,0,0,0,5,33]; TC_INSEASON.weeks=[1,2]; } };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=2;   // week 1 complete

(async()=>{
  console.log('=== week 1: every board has something ===');
  let h=app.trends('pace');
  chk(/PACE VS PROJECTION/.test(h) && /thin under 3 games/.test(h) && /1 gm · thin · pace/.test(h) && /Jaxon Smith-Njigba/.test(h), 'pace shows from one game, marked thin');
  h=app.trends('usage');
  chk(/TARGETS VS PROJECTION/.test(h) && /11\.0\/gm vs proj 8\.0 · 1 gm · thin/.test(h) && /CARRIES VS PROJECTION/.test(h) && /18\.0\/gm vs proj 8\.0/.test(h), 'usage shows from one game (JSN 11 v 8 targets, Free Back 18 v 8 carries)');
  h=app.trends('teams');
  chk(/PASS ↔ RUN LEAN · THRU WK 1/.test(h) && /PASS-HEAVY/.test(h) && /RUN-HEAVY/.test(h) && /HOTTEST/.test(h) && /COLDEST/.test(h), 'teams before week 3: the season so far, not a swing');
  chk(/SEA[\s\S]*67% pass/.test(h) && /NE[\s\S]*48% pass/.test(h), 'pass rates read off the weekly pack');
  h=app.trends('trending');
  chk(/WEEK 1 TARGETS VS THE PROJECTION/.test(h) && /▲ FED/.test(h) && /▼ QUIET/.test(h), 'the Trending tab shows week 1 against the projection');
  chk(/Jaxon Smith-Njigba[\s\S]*11 tgt · 37% of team · proj 8\.0\/gm/.test(h) && /\+38%/.test(h), 'JSN: 11 targets, 37% of the team, +38% on his projection');
  chk(/Tee Higgins[\s\S]*2 tgt/.test(h) && /−71%/.test(h), 'Higgins quiet: 2 targets on a 7-target projection');
  chk(/WEEK 1 CARRIES VS THE PROJECTION/.test(h) && /Free Back[\s\S]*18 carries · proj 8\.0\/gm/.test(h) && /\+125%/.test(h), 'the backfield board: Free Back 18 carries on 8 projected');
  await new Promise(r=>setTimeout(r,20));
  h=app.trends('trending');
  chk(/TRENDING ON SLEEPER · 24H/.test(h) && /MOST ADDED[\s\S]*Jaxon Smith-Njigba[\s\S]*41\.2k/.test(h) && /MOST DROPPED[\s\S]*Free Back[\s\S]*3,100 leagues in 24h/.test(h), 'Sleeper\'s 24-hour adds and drops, with counts');
  chk(/la-trnd-mine/.test(h), 'my players are starred');
  h=app.trends('trending','myteam');
  chk(/MOST ADDED[\s\S]*Jaxon Smith-Njigba/.test(h) && !/Free Back/.test(h.slice(h.indexOf('TRENDING ON SLEEPER'))), 'the scope filter applies to the Sleeper board too');

  console.log('=== week 2: week-over-week takes over ===');
  app.addWeek2(); app.TC_SEASON.week=3;
  h=app.trends('trending','league');
  chk(/TRENDING · LAST WEEK VS THE ONE BEFORE/.test(h) && /TRENDING UP/.test(h), 'two weeks: the latest against the one before');
  chk(/Tee Higgins/.test(h.slice(0, h.indexOf('TRENDING DOWN'))) && /Jaxon Smith-Njigba/.test(h.slice(h.indexOf('TRENDING DOWN'), h.indexOf('TRENDING ON SLEEPER'))), 'Higgins (2 → 9 targets) trends up, JSN (11 → 4) down');
  chk(/TRENDING ON SLEEPER/.test(h), 'and the Sleeper board still rides under it');

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
