// Trends · Snaps: snap share week over week from Sleeper's cached weekly rows, the sidecar's
// nflverse snaps filling a blank player-week, last season as the baseline in week 1, role
// tiers, season highs, the scope filter — and a missing week is unknown, never a benching.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){}},children:[],appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){},classList:{add(){},remove(){}}},addEventListener(){},visibilityState:'visible'};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
global.Chart=function(){return{destroy(){}}};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));global.AbortController=class{constructor(){this.signal={}}abort(){}};
global.localStorage={_s:{},getItem(k){return this._s[k]||null;},setItem(k,v){this._s[k]=String(v);},removeItem(k){delete this._s[k];}};
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; const renders=[]; renderLeagueAnalyzer=function(){ renders.push(1); };
  return { TC_SEASON, laState, renders, trends:laTrendsView, tier:laSnapTier, trend:laSnapTrend,
    reset:()=>{ _laSnapMem={sig:null,index:null,loading:false,failed:false}; },
    setInseason:(x)=>{ TC_INSEASON=x; }, setHistory:(h)=>{ HISTORY=h; }, setPlayers:(p)=>{ sleeperPlayers=p; },
    setSnapshot:(s)=>{ leagueSnapshot=s; }, setPhase:(p)=>{ currentPhase=p; }, setWeekStats:(f)=>{ fetchWeekStats=f; } };`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
const tick=()=>new Promise(r=>setTimeout(r,30));
const strip=h=>h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

// Five backs. p1 rises into an every-down role (season high). p2 falls out of one. p3 has
// no Sleeper snap pair in week 3 but the sidecar has PFR's 90%. p4 has no week-3 row at
// all (inactive, or Sleeper hasn't posted it) — unknown, not a drop. p5 barely plays.
app.setPlayers({p1:{name:'Riser Back',position:'RB',team:'KC',gsis_id:'00-1'}, p2:{name:'Fader Back',position:'RB',team:'DET',gsis_id:'00-2'},
  p3:{name:'Filled Back',position:'RB',team:'SF',gsis_id:'00-3'}, p4:{name:'Absent Back',position:'RB',team:'BUF',gsis_id:'00-4'}, p5:{name:'Fringe Back',position:'RB',team:'NYJ',gsis_id:'00-5'}});
const R=(pid,off,tm)=>({player_id:pid, position:'RB', team:{p1:'KC',p2:'DET',p3:'SF',p4:'BUF',p5:'NYJ'}[pid], stats: tm==null?{gp:1}:{off_snp:off, tm_off_snp:tm, gp:1}});
const QB=(wk)=>[{player_id:'q1', position:'QB', team:'SEA', player:{first_name:'Backup',last_name:'Passer'}, stats:{off_snp:wk===3?60:2, tm_off_snp:60, gp:1}}];
const WEEKS={1:[R('p1',24,60),R('p2',48,60),R('p3',36,60),R('p4',42,60),R('p5',6,60)],
             2:[R('p1',27,60),R('p2',48,60),R('p3',36,60),R('p4',42,60),R('p5',6,60)],
             3:[R('p1',48,60),R('p2',30,60),R('p3',null),R('p5',12,60)]};
const calls=[];
app.setWeekStats(async(season,wk,pos)=>{ calls.push(`${season}|${wk}|${pos}`); return pos==='RB'?WEEKS[wk]:pos==='QB'?QB(wk):[]; });
app.setInseason({asof:'x', schedule:{}, player_weekly:{cols:['tgt','snaps','snap_pct'], players:{'00-3':{n:'filled back',p:'RB',t:'SF',w:{'3':[0,54,90]}}}}});
app.setHistory({});
app.setPhase('League');
const SNAP={provider:'sleeper', leagueId:'L1', season:'2026', myUserId:'u1', rosterPositions:['RB','BN'],
  teamList:[{rosterId:1, ownerId:'u1', teamName:'Me', players:[{id:'p1',name:'Riser Back',pos:'RB',team:'KC'}]},
            {rosterId:2, ownerId:'u2', teamName:'Them', players:[{id:'p2',name:'Fader Back',pos:'RB',team:'DET'}]}]};
app.setSnapshot(SNAP);
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=4;
app.laState.trndTab='snaps'; app.laState.trndScope='league';

(async()=>{
  console.log('=== tiers ===');
  chk(app.tier(0.8)==='every-down' && app.tier(0.6)==='lead' && app.tier(0.4)==='committee' && app.tier(0.1)==='rotational', 'share tiers: every-down ≥75, lead ≥55, committee ≥35, else rotational');

  console.log('=== the board loads the completed weeks once, then renders ===');
  app.reset();
  let h=app.trends(SNAP);
  chk(/Snaps/.test(h) && /Loading snap counts for weeks 1–3/.test(h), 'first paint: a Snaps tab and a loading line for weeks 1–3');
  await tick();
  chk(calls.length===12 && calls.filter(c=>/\|RB$/.test(c)).length===3, 'three weeks × four positions fetched through the week cache');
  chk(app.renders.length>=1, 'the board re-renders when the rows land');
  h=app.trends(SNAP);
  const s=strip(h);
  chk(/SNAP SHARE/.test(h) && /RISING/.test(h) && /FALLING/.test(h), 'the board is up with rising and falling columns');
  const up=strip(h.slice(h.indexOf('RISING'), h.indexOf('FALLING'))), dn=strip(h.slice(h.indexOf('FALLING')));
  chk(/Riser Back/.test(up) && /43% \(wks 1–2\) → 80% wk 3/.test(up) && /committee → every-down/.test(up) && /season high/.test(up), 'Riser Back: 43% over weeks 1–2 → 80% in week 3, committee → every-down, a season high');
  chk(/\+38/.test(up), 'with the move in share points');
  chk(/Fader Back/.test(dn) && /80% \(wks 1–2\) → 50% wk 3/.test(dn) && /every-down → committee/.test(dn), 'Fader Back: 80% → 50%, every-down → committee');
  chk(/Filled Back/.test(up) && /90% wk 3/.test(up) && /nflverse/.test(up), 'Filled Back: Sleeper had no pair in week 3, the sidecar’s 90% fills it and is tagged nflverse');
  chk(!/Absent Back/.test(s), 'Absent Back has no week-3 data anywhere — unknown, so he is not a faller');
  chk(!/Fringe Back/.test(s), 'Fringe Back never reaches 25% of snaps — not listed');
  chk(/la-snp-pos/.test(h) && /pos-filter-btn active" onclick="laSetSnapPos\('FLEX'\)">Flex/.test(h) && !/Backup Passer/.test(s), 'Flex is the default position pick — the quarterback (2 snaps → 60) is not on it');
  app.laState.snapPos='QB'; const hq=app.trends(SNAP);
  chk(/Backup Passer/.test(strip(hq)) && !/Riser Back/.test(strip(hq)) && /3% \(wks 1–2\) → 100% wk 3/.test(strip(hq)), 'QB shows the passer alone: 3% → 100%');
  app.laState.snapPos='RB'; chk(/Riser Back/.test(strip(app.trends(SNAP))), 'RB shows the backs'); app.laState.snapPos='FLEX';
  const n=(app.calls||calls).length;
  app.trends(SNAP);
  chk(calls.length===n, 'a second render reads the index, no new fetches');

  console.log('=== scope ===');
  app.laState.trndScope='rostered'; h=app.trends(SNAP); const sr=strip(h);
  chk(/Riser Back/.test(sr) && /Fader Back/.test(sr) && !/Filled Back/.test(sr), 'Rostered keeps the two rostered backs and drops the free agent');
  app.laState.trndScope='myteam'; h=app.trends(SNAP);
  chk(/Riser Back/.test(strip(h)) && !/Fader Back/.test(strip(h)) && /la-trnd-mine/.test(h), 'My Team keeps only mine, starred');
  app.laState.trndScope='league';

  console.log('=== week 1: last season is the baseline ===');
  app.TC_SEASON.week=2; app.reset(); calls.length=0;
  app.setHistory({p1:{'2025':[{team:'KC',games_played:15,snap_pct:30},{team:'LV',games_played:2,snap_pct:90}]}, p2:{'2025':[{team:'DET',games_played:16,snap_pct:85}]},
    // the usual non-starter record: no pre-computed percent, raw snaps in the stats block, two stints
    p3:{'2025':[{team:'SF',games_played:10,snap_pct:null,stats:{off_snaps:200,team_off_snaps:600}},{team:'MIA',games_played:5,snap_pct:null,stats:{off_snaps:100,team_off_snaps:400}}]}});
  h=app.trends(SNAP); await tick(); h=app.trends(SNAP);
  chk(calls.length===4, 'one completed week: four fetches');
  const u1=strip(h.slice(h.indexOf('RISING'), h.indexOf('FALLING'))), d1=strip(h.slice(h.indexOf('FALLING')));
  chk(/Riser Back/.test(u1) && /30% \(2025 avg\) → 40% wk 1/.test(u1), 'Riser Back: 30% last season (the most-played stint, not the 2-game one) → 40% in week 1');
  chk(!/Fader Back/.test(d1) && !/Fader Back/.test(u1), 'Fader Back: 85% → 80% is under the 8-point threshold, not listed either way');
  chk(/Filled Back/.test(u1) && /30% \(2025 avg\) → 60% wk 1/.test(u1), 'Filled Back: no pre-computed percent, so 300 of 1000 snaps across two stints = 30% → 60% in week 1');
  chk(!/Absent Back/.test(strip(h)), 'Absent Back played week 1 but has no 2025 history — nothing to compare, not listed');

  console.log('=== before week 1 completes ===');
  app.TC_SEASON.week=1; app.reset();
  h=app.trends(SNAP);
  chk(/Snap shares light up once week 1 completes/.test(h), 'no completed week → the tab says so and fetches nothing');

  console.log('=== the fetch failing is a message, not a crash ===');
  app.TC_SEASON.week=4; app.reset();
  app.setWeekStats(async()=>{ throw new Error('no net'); });
  h=app.trends(SNAP); await tick(); h=app.trends(SNAP);
  chk(/Couldn’t reach Sleeper/.test(h), 'every fetch failing → a retry line');

  console.log(`\n${pass}/${total} passed`);
  if(pass!==total) process.exit(1);
})();
