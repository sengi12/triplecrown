// Regression: "copy team from previous season" must not silently copy 0 players when the
// app was loaded from a seed with no live Sleeper DB and a thin/empty projection roster.
const elStore={};
function mkEl(id){if(!elStore[id])elStore[id]={innerHTML:'',style:{},textContent:'',value:'',disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return '';},appendChild(){},querySelectorAll:()=>[]};return elStore[id];}
global.document={getElementById:(id)=>mkEl(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({click(){},style:{},appendChild(){}}),activeElement:null,body:{appendChild(){},removeChild(){}}};
global.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
global.Chart=function(){return{destroy(){},update(){},data:{datasets:[{}]}};};
global.confirm=()=>true;global.btoa=s=>Buffer.from(s,'binary').toString('base64');global.FileReader=function(){};global.Range=function(){};global.fetch=()=>Promise.reject(new Error('no net'));
let toasts=[];
const fs=require('fs');const path=require('path');
const code=fs.readFileSync(path.join(__dirname,'check.js'),'utf8');
const app=new Function(code+`
  toast=function(m,t){toasts.push({m,t});};
  return {
    ensureTeam, copyTeamToWorking, canUndo, undoTeam,
    setProjSeed:(s)=>{SEED=s;projSeed=s;seasonStatsCache.proj=s;workingProj={};userProj=workingProj;activeSeason='proj';},
    setRefSeason:(season,seed)=>{seasonStatsCache[season]=seed;activeSeason=season;referenceProj={};userProj=referenceProj;},
    setCurrentTeam:(t)=>{currentTeam=t;}, setSleeper:(p)=>{sleeperPlayers=p;},
    getWorkingProj:()=>workingProj, getToasts:()=>toasts };
`)();
global.toasts=toasts;
const mkTeams=(o)=>{['ATL','ARI','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'].forEach(t=>{if(!o[t])o[t]={QB:[],RB:[],WR:[],TE:[]};});return o;};

const ref=mkTeams({CIN:{QB:[{player_id:'burrow',name:'Joe Burrow',pos:'QB',team:'CIN',passing_yards:4900,passing_attempts:610,passing_touchdowns:43,games_played:17}],
  WR:[{player_id:'chase',name:"Ja'Marr Chase",pos:'WR',team:'CIN',receiving_targets:175,receptions:127,receiving_yards:1708,receiving_tds:17,games_played:17}],RB:[],TE:[]}});

console.log('=== Copy with empty proj roster + no Sleeper DB (the reported bug) ===');
app.setProjSeed(mkTeams({}));   // empty rosters
// sleeperPlayers stays null
app.setRefSeason('2025',ref); app.setCurrentTeam('CIN');
toasts.length=0;
app.copyTeamToWorking('CIN');
const m=app.getToasts()[0].m;
console.log('Toast:', m);
const copiedAll = /Copied 2 CIN/.test(m);
console.log('RESULT 1:', copiedAll?'PASS (copies all when roster cannot be verified)':'FAIL (still copying 0!)');

console.log('\n=== Undo after that copy actually reverts ===');
app.setCurrentTeam('CIN');
const can=app.canUndo('CIN');
app.undoTeam('CIN');
console.log('canUndo was:', can, '| undo toast:', app.getToasts().slice(-1)[0].m);
console.log('RESULT 2:', can?'PASS (undo has something to revert)':'FAIL');
