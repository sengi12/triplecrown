// Time machine (build_seed.py --as-of SEASON:WEEK): a seed whose state block is frozen
// pins TC_SEASON, silences the live state probe, and truncates every live pull to the
// completed weeks — so the in-season tools can be exercised in the offseason.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={id,innerHTML:'',style:{},textContent:'',value:'',title:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},children:[],appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:(t)=>mkEl('new-'+t+Math.random()),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};
global.AbortController=class{constructor(){this.signal={};}abort(){}};
let fetched=[];
global.fetch=(u)=>{ fetched.push(String(u)); return Promise.resolve({ok:true,json:async()=>({season:'2026',league_season:'2026',season_type:'pre',week:3})}); };
const fs=require('fs');
const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(){}; renderSeasonTabs=function(){}; renderSidebar=function(){}; renderContent=function(){};
  let __weekCalls=[];
  sleeperFetch=async(u)=>{ __weekCalls.push(u);
    const m=/stats\\/nfl\\/(\\d{4})\\/(\\d+)\\?/.exec(u);
    if(m){ const wk=Number(m[2]); if(wk>9) return [{player_id:'x',stats:{rec:99,gp:1}}];
      return [ {player_id:'p1',team:wk>5?'KC':'NYJ',position:'WR',stats:{rec:5,rec_yd:60,rec_tgt:7,gp:1,pos_rank_ppr:30,rec_ypr:12}},
               {player_id:'p2',team:'CIN',position:'RB',stats:{rush_att:15,rush_yd:70,gp:1}} ]; }
    if(/stats\\/nfl\\/player\\//.test(u)) return {'1':{stats:{rec:1}},'9':{stats:{rec:9}},'10':{stats:{rec:10}},'17':{stats:{rec:17}}};
    if(/stats\\/nfl\\/2025\\?/.test(u)) return [{player_id:'p1',team:'KC',position:'WR',stats:{rec:100,gp:17}}];
    return null; };
  return {
    applySeed:(st)=>_tcApplySeedState(st), applySleeper:(s)=>_tcApplySleeperState(s), season:()=>TC_SEASON,
    sync:(f)=>syncProjSeasonFromSleeper(f), recheck:(f)=>tcSeasonRecheck(f),
    started:()=>hasSeasonStarted(), completed:()=>completedWeeks(), tm:()=>tcTimeMachine(),
    projSeason:()=>PROJ_SEASON,
    agg:(y,w)=>liveSeasonRowsThroughWeek(y,w), weekCalls:()=>__weekCalls,
    weekly:(pid,s)=>fetchPlayerWeekly(pid,s),
    live:()=>refreshLiveSeasonStats(true), history:()=>HISTORY,
    laWeek:()=>laCurrentWeek(),
    setIns:(x)=>{TC_INSEASON=x;}, setPlayers:(p)=>{sleeperPlayers=p;}, adj:(p,wk,pm,dvp)=>laAdjWeekProj(p,wk,pm,dvp),
  };`)();

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

(async()=>{
  console.log('=== frozen seed state pins the clock ===');
  app.applySeed({season:2025, season_type:'regular', week:10, frozen:true});
  const s=app.season();
  chk(s.year===2025 && s.phase==='regular' && s.week===10 && s.frozen===true && s.source==='frozen','TC_SEASON = 2025 regular wk 10, frozen');
  chk(app.projSeason()===2025,'PROJ_SEASON follows the frozen year');
  chk(app.started() && app.completed()===9,'season started, 9 completed weeks');
  chk(app.laWeek()===10,'league analyzer week is 10');

  console.log('=== live probe is a no-op while frozen ===');
  fetched=[];
  await app.sync(true); await app.recheck(true);
  console.log('    fetched:', fetched.join(' | ').slice(0,300)); chk(!fetched.some(u=>/state\/nfl/.test(u)),'syncProjSeasonFromSleeper / tcSeasonRecheck never hit /state/nfl');
  app.applySleeper({season:'2026',season_type:'pre',week:3});
  chk(app.season().year===2025 || app.season().frozen,'(defensive) a stray live payload cannot unfreeze');
  app.applySeed({season:2025, season_type:'regular', week:10, frozen:true});

  console.log('=== live season aggregate is rebuilt from completed weeks only ===');
  const rows=await app.agg('2025', 9);
  const p1=rows.find(r=>r.player_id==='p1');
  chk(rows.length===2 && !rows.some(r=>r.player_id==='x'),'weeks 10+ are never requested/aggregated');
  chk(p1 && p1.stats.rec===45 && p1.stats.rec_yd===540 && p1.stats.gp===9,'counting stats sum across 9 weeks, gp = weeks played');
  chk(p1 && p1.team==='KC','team follows the latest week (trade-aware)');
  chk(p1 && p1.stats.pos_rank_ppr==null && p1.stats.rec_ypr===12,'rank columns are not summed; rate stats are re-derived');
  chk(!app.weekCalls().some(u=>/stats\/nfl\/2025\/1[0-9]\?/.test(u)),'no fetch for week 10+');

  console.log('=== refreshLiveSeasonStats uses the truncated path ===');
  app.weekCalls().length=0;
  const ok=await app.live();
  chk(ok===true,'live refresh succeeds');
  chk(!app.weekCalls().some(u=>/stats\/nfl\/2025\?season_type/.test(u)),'the whole-season aggregate endpoint is never called while frozen');
  const h=app.history()['p1'] && app.history()['p1']['2025'];
  chk(h && h[0].games_played===9 && h[0].stats.receptions===45,'HISTORY[2025] holds the 9-week line, not the 17-game season');

  console.log('=== per-player weekly rows are cut at the frozen week ===');
  const w=await app.weekly('p9','2025');
  chk(w && Object.keys(w).sort().join(',')==='1,9','weeks 10 and 17 are dropped for the frozen season');
  const w24=await app.weekly('p9','2024');
  chk(w24 && '17' in w24,'a completed past season is untouched');

  console.log('=== lineup helper: bye / out players project zero ===');
  app.setIns({season:2025, weeks:[1,2,3,4,5,6,7,8,9], schedule:{KC:{'9':'BUF','11':'DEN'}, MIN:{'10':'CHI'}}});
  app.setPlayers({'w':{name:'Xavier Worthy',pos:'WR',team:'KC'}, 'j':{name:'Justin Jefferson',pos:'WR',team:'MIN',injury_status:'Out'}, 'a':{name:'Jordan Addison',pos:'WR',team:'MIN'}});
  const pm=new Map([['xavier worthy|WR',170],['justin jefferson|WR',289],['jordan addison|WR',170]]);
  const bye=app.adj({id:'w',name:'Xavier Worthy',pos:'WR',team:'KC'},10,pm,null);
  chk(bye.bye===true && bye.adj===0 && bye.base>0,'KC on bye in week 10 → adj 0, flagged bye (was: 12.6 and "started")');
  const play=app.adj({id:'w',name:'Xavier Worthy',pos:'WR',team:'KC'},11,pm,null);
  chk(!play.bye && play.adj>0,'same player week 11 → projects normally');
  const out=app.adj({id:'j',name:'Justin Jefferson',pos:'WR',team:'MIN'},10,pm,null);
  chk(out.out===true && out.adj===0 && out.status==='Out','Sleeper injury status Out → adj 0, flagged');
  const ok2=app.adj({id:'a',name:'Jordan Addison',pos:'WR',team:'MIN'},10,pm,null);
  chk(!ok2.bye && !ok2.out && Math.abs(ok2.adj-10)<0.01,'healthy player with a game → base/17');

  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
})();
