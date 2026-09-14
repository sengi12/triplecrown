// In season, defenders keep updating: the player card asks for the frozen seasons' file by
// LAST season's readiness (the live merge alone must not satisfy it), tries once per open,
// and the Roster tab of the season in progress leads with the live depth chart.
const elStore={};
function mkEl(id){ if(!elStore[id]) elStore[id]={innerHTML:'',style:{},textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}}; return elStore[id]; }
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}},addEventListener(){}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},matchMedia:()=>({matches:false})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};global.confirm=()=>true;global.btoa=s=>s;global.FileReader=function(){};global.Range=function(){};global.AbortController=class{constructor(){this.signal={};}abort(){}};
global.fetch=()=>Promise.reject(new Error('offline'));global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const fs=require('fs');const code=fs.readFileSync(require('path').join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  const calls=[];
  ensureNflverseSection=(sec,season)=>{ calls.push([sec,String(season)]); return Promise.resolve(false); };
  sleeperFetch=()=>Promise.reject(new Error('offline'));
  return { calls, renderTeamAdditions, setPcardStatsMode, TC_SEASON,
    setSeason:(s)=>{activeSeason=s;}, setNflverse:(n)=>{NFLVERSE=n;}, setPlayers:(p)=>{sleeperPlayers=p;},
    setPcardState:(s)=>{pcardState=s; pcardOpen=true;}, setMode:(m)=>{pcardStatsMode=m;},
    setLazy:(v)=>{ _nflverseLazyLoaded.def_weekly=v; }, body:()=>document.getElementById('pcardBody').innerHTML };
`)();
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};
app.TC_SEASON.year=2026; app.TC_SEASON.phase='regular'; app.TC_SEASON.week=1;
const JONES={name:'Ernest Jones',team:'SEA',pos:'LB',group:'LB',totals:{games:1,tackles:8,sacks:0,pressures:1},weeks:[{week:1,opp:'NE',tackles:8,sacks:0,pressures:1}]};

console.log('=== the Roster tab in the season in progress ===');
app.setNflverse({'2026':{rosters:{SEA:[['Ernest Jones','LB'],['Sam Darnold','QB']]}},'2025':{rosters:{SEA:[['Sam Darnold','QB']]}}});
app.setSeason('2026');
let h=app.renderTeamAdditions('SEA');
chk(/Depth Chart[\s\S]*Loading depth chart from ESPN/.test(h), 'the live depth chart leads (fetched from ESPN, like the projection season)');
chk(h.indexOf('Depth Chart') < h.indexOf('Ernest Jones') && /Ernest Jones/.test(h), 'the nflverse roster follows beneath');
app.setSeason('2025'); h=app.renderTeamAdditions('SEA');
chk(!/Loading depth chart/.test(h) && /Sam Darnold/.test(h), 'a completed season: the roster alone, no live chart');

console.log('=== the defender card asks for the frozen file by last season ===');
app.setPlayers({'7':{name:'Ernest Jones',pos:'LB'}});
app.setNflverse({'2026':{def_weekly:{'ernest jones':JONES}}});   // only the live merge is in memory
app.setSeason('2026'); app.setLazy(false);
app.setPcardState({pid:'7',posc:'LB',isSkill:false,isOl:false,isDefense:true}); app.setMode('college');
app.setPcardStatsMode('pro');
chk(/Loading defensive weekly stats/.test(app.body()), 'the live season alone is not "ready" — the file is asked for');
chk(app.calls.length===1 && app.calls[0][0]==='def_weekly' && app.calls[0][1]==='2025', 'readiness is asked of last season (2025), which only the file can answer');
setTimeout(()=>{
  chk(app.calls.length===1, 'a failed fetch is not re-armed (one try per card open)');
  chk(/PRS|TKL|Defensive weekly/.test(app.body()) && /2026/.test(app.body()), 'the card falls through to the season in memory (2026)');
  app.setLazy(true); app.calls.length=0;
  app.setPcardState({pid:'7',posc:'LB',isSkill:false,isOl:false,isDefense:true}); app.setPcardStatsMode('pro');
  chk(app.calls.length===0 && !/Loading defensive/.test(app.body()), 'once the file is loaded no card asks again');
  console.log(`\nRESULT: ${pass}/${total} ${pass===total?'ALL PASS':'SOME FAILED'}`);
  process.exit(pass===total?0:1);
}, 30);
