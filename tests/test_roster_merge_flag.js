// Regression: selecting a team runs mergeRosterPlayers, which must NOT pollute SEED[team]
// with a non-array flag. A stray `_rosterMerged` boolean inside the positions object made
// buildSeedFromHistory's `for(pos in base[t])` call .forEach on a boolean → threw → season
// switching (and the Targets tab) silently died after any team had been opened.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[],addEventListener(){}};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
let toasts=[];
const fs=require('fs');const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){toasts.push({m,t});};
  return { selectTeam, loadSeason, buildSeedFromHistory,
    setProjSeed:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
    setHistory:(h,seasons)=>{HISTORY=h;HISTORY_SEASONS=seasons;},
    setSleeper:(p)=>{sleeperPlayers=p;},
    getSEEDteam:(t)=>SEED[t], getActiveSeason:()=>activeSeason };
`)();
global.toasts=toasts;
const mkTeams=(o)=>{['CIN','ATL','BUF'].forEach(t=>{if(!o[t])o[t]={QB:[],RB:[],WR:[],TE:[]};});return o;};
app.setProjSeed(mkTeams({CIN:{QB:[{player_id:'burrow',name:'Joe Burrow',pos:'QB',team:'CIN',passing_yards:4800,games:17}],WR:[],RB:[],TE:[]}}));
app.setHistory({burrow:{'2025':{team:'CIN',pos:'QB',name:'Joe Burrow',games_played:17,stats:{pass_yd:4900,gp:17}}}},['2025','2024']);
app.setSleeper({burrow:{player_id:'burrow',name:'Joe Burrow',pos:'QB',team:'CIN'},chase:{player_id:'chase',name:"Ja'Marr Chase",pos:'WR',team:'CIN'}});

let pass=0,total=0;
const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

app.selectTeam('CIN');   // triggers mergeRosterPlayers
const seed=app.getSEEDteam('CIN');
const keys=Object.keys(seed);
chk(keys.every(k=>Array.isArray(seed[k])), 'SEED[team] contains ONLY position arrays (no stray flag): '+JSON.stringify(keys));

let threw=false;
try{ app.buildSeedFromHistory('2025'); }catch(e){ threw=true; console.log('  (threw:',e.message+')'); }
chk(!threw, 'buildSeedFromHistory works after selecting a team');

(async()=>{
  await app.loadSeason('2025'); await new Promise(r=>setTimeout(r,10));
  chk(app.getActiveSeason()==='2025', 'season switch works after team select (the reported bug)');
  console.log(`RESULT: ${pass}/${total} `+(pass===total?'PASS':'FAIL'));
})();
