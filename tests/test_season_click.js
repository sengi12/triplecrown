// Regression: selecting a team must NOT block subsequent season-tab clicks. A background
// Sleeper load (added so copy-to-working can verify rosters) must not strand loadSeason.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};
global.AbortController=class{constructor(){this.signal={};}abort(){}};
let hangResolve;
global.fetch=(u)=>{ if(u.includes('/players/nfl')) return new Promise(res=>{hangResolve=res;}); return Promise.reject(new Error('no net')); };
let toasts=[];
const fs=require('fs');const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){toasts.push({m,t});};
  return { selectTeam, loadSeason, loadSleeperPlayers,
    setProjSeed:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
    setHistory:(h,seasons)=>{HISTORY=h;HISTORY_SEASONS=seasons;},
    getActiveSeason:()=>activeSeason };
`)();
global.toasts=toasts;
const mkTeams=(o)=>{['CIN','ATL','BUF'].forEach(t=>{if(!o[t])o[t]={QB:[],RB:[],WR:[],TE:[]};});return o;};
app.setProjSeed(mkTeams({CIN:{QB:[{player_id:'burrow',name:'Joe Burrow',pos:'QB',team:'CIN',passing_yards:4800,games:17}],WR:[],RB:[],TE:[]}}));
app.setHistory({burrow:{'2025':{team:'CIN',pos:'QB',name:'Joe Burrow',games_played:17,stats:{pass_yd:4900,gp:17}}}},['2025','2024']);

(async()=>{
  let pass=0,total=0;
  const bg=app.loadSleeperPlayers(true).catch(()=>{});   // hanging background boot load
  await new Promise(r=>setTimeout(r,5));
  app.selectTeam('CIN');   // select team FIRST (the reported trigger)

  total++; await app.loadSeason('2025'); await new Promise(r=>setTimeout(r,10));
  if(app.getActiveSeason()==='2025'){pass++;console.log('PASS: season w/ embedded history opens after selecting a team');}
  else console.log('FAIL: could not open 2025 after selecting a team (activeSeason='+app.getActiveSeason()+')');

  total++; await app.loadSeason('proj'); await new Promise(r=>setTimeout(r,10));
  if(app.getActiveSeason()==='proj'){pass++;console.log('PASS: proj switch works during in-flight load');}
  else console.log('FAIL: proj switch blocked');

  total++; await app.loadSeason('2025'); await new Promise(r=>setTimeout(r,10));
  if(app.getActiveSeason()==='2025'){pass++;console.log('PASS: can re-enter cached season');}
  else console.log('FAIL: cached season re-entry blocked');

  console.log(`RESULT: ${pass}/${total} `+(pass===total?'PASS':'FAIL'));
})();
